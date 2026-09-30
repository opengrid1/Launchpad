import { expect } from "chai";
import { ethers, network } from "hardhat";

import { commitmentOf, ETH, H, KIND, newKeys, partialOf, poseidonReady, prove, rand, Tree, assetId, type Note, type SpendPlan } from "./notes";

// Estonks private vault on an Ethereum mainnet fork, against the live Estonks v2
// factory, router and STONK distributor, with real Groth16 proofs.
//   FORK=1 ROBINHOOD_RPC_URL=https://ethereum-rpc.publicnode.com ROBINHOOD_CHAIN_ID=1 BLOCK_GAS_LIMIT=16000000 \
//   HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat test test/v4/private/vault.fork.test.ts
const FACTORY = "0x462cC9885188FE0f08597C9Df407f62E86c6D345";
const ROUTER = "0x467cDd862c36f17b67827Dbba8bdcf4160a8E369";
const DISTRIBUTOR = "0x007f76605B24822f89D41A4163D4eeB589BF235C";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const T3 = "0x3333333C0A88F9BE4fd23ed0536F9B6c427e3B93";
const T4 = "0x4443338EF595F44e0121df4C21102677B142ECF0";
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const NO_ENC: [string, string, string] = ["0x01", "0x02", "0x03"];
const E = (v: string) => ethers.parseEther(v);

describe("Estonks private vault (mainnet fork)", function () {
  this.timeout(1_800_000);
  let vault: any, sanctions: any, factory: any, router: any, coin: any, coinAddr: string;
  let admin: any, alice: any, bob: any, relayer: any, trader: any;
  let tree: Tree;
  let alk: ReturnType<typeof newKeys>, bok: ReturnType<typeof newKeys>;
  let aliceEth: Note, ethNote: Note, coinRest: Note, bobEth: Note;

  /** Mirror the vault's Note events into the local tree. */
  async function syncTree(rc: any) {
    for (const l of rc.logs) {
      try { const ev = vault.interface.parseLog(l); if (ev?.name === "Note") tree.insert(BigInt(ev.args.commitment)); } catch { /* other contract */ }
    }
    expect(await vault.root()).to.equal(tree.root());
  }

  async function deposit(from: any, keys: typeof alk, asset: string, amount: bigint): Promise<Note> {
    const blinding = rand();
    const idx = Number(await vault.nextIndex());
    const rc = await (await vault.connect(from).deposit(asset, amount, partialOf(keys.pk, blinding), "0xaa", { value: asset === ETH ? amount : 0n })).wait();
    await syncTree(rc);
    return { asset: assetId(asset), amount, blinding, pk: keys.pk, index: idx };
  }

  async function send(plan: SpendPlan, signer = relayer) {
    const s = await prove(tree, plan);
    const idx = Number(await vault.nextIndex());
    const rc = await (await vault.connect(signer).spend(s.proof, s.pub, s.ext, s.encrypted)).wait();
    await syncTree(rc);
    s.outs.forEach((o, i) => (o.index = idx + i));
    return { rc, outs: s.outs, resultIndex: idx + 2 };
  }

  async function solvent() {
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.be.gte((await vault.liabilities(ETH)) + (await vault.feesOwed()));
    const c = new ethers.Contract(coinAddr, ERC20, ethers.provider);
    expect(await c.balanceOf(await vault.getAddress())).to.be.gte(await vault.liabilities(coinAddr));
  }

  const ext = (o: Partial<SpendPlan["ext"]>): SpendPlan["ext"] => ({ kind: 0, recipient: ethers.ZeroAddress, relayer: ethers.ZeroAddress, relayerFee: 0n, coin: ethers.ZeroAddress, route: "0x", minOut: 0n, ...o });

  before(async () => {
    await poseidonReady();
    tree = new Tree();
    alk = newKeys(); bok = newKeys();
    [admin, alice, bob, relayer, trader] = await ethers.getSigners();
    factory = await ethers.getContractAt("EstonksFactory", FACTORY);
    router = await ethers.getContractAt("EstonksRouter", ROUTER);
    const verifier = await (await ethers.getContractFactory("SpendVerifier")).deploy();
    sanctions = await (await ethers.getContractFactory("MockSanctions")).deploy();
    const V = await ethers.getContractFactory("EstonksVault", { libraries: { "poseidon-solidity/PoseidonT3.sol:PoseidonT3": T3, "poseidon-solidity/PoseidonT4.sol:PoseidonT4": T4 } });
    vault = await V.deploy(await verifier.getAddress(), ROUTER, FACTORY, await sanctions.getAddress(), DISTRIBUTOR, admin.address);
    // A fresh coin on the live v2 factory, past its launch window.
    const n = Number(await factory.totalTokens());
    await (await factory.connect(trader).launch({ name: "Vault Test", symbol: "VT", metadataURI: "", pair: WETH, minPairOut: 0, basket: [] }, ethers.id("vault-test"), "0x", { value: E("0.05") })).wait();
    coinAddr = await factory.allTokens(n);
    coin = await ethers.getContractAt("EstonksToken", coinAddr);
    await network.provider.send("evm_increaseTime", [30]);
    for (let i = 0; i < 3; i++) await network.provider.send("evm_mine", []);
  });

  it("uses the same Poseidon on chain as the prover, and starts from the same empty root", async () => {
    const t3 = new ethers.Contract(T3, ["function hash(uint256[2]) pure returns (uint256)"], ethers.provider);
    const t4 = new ethers.Contract(T4, ["function hash(uint256[3]) pure returns (uint256)"], ethers.provider);
    expect(await t3.hash([1n, 2n])).to.equal(H(1n, 2n));
    expect(await t4.hash([1n, 2n, 3n])).to.equal(H(1n, 2n, 3n));
    expect(await vault.root()).to.equal(tree.root());
  });

  it("deposit ETH, withdraw part to a fresh address through a relayer; replay, tampering and double spend fail", async () => {
    const note = await deposit(alice, alk, ETH, E("1"));
    expect(await vault.liabilities(ETH)).to.equal(E("1"));
    const fresh = ethers.Wallet.createRandom().address;
    const change: Note = { asset: 0n, amount: E("0.7"), blinding: rand(), pk: alk.pk };
    const plan: SpendPlan = {
      keys: alk, asset: ETH, inputs: [note], outputs: [change], publicOut: E("0.3"), partialOut: 0n,
      ext: ext({ kind: KIND.withdraw, recipient: fresh, relayer: relayer.address, relayerFee: E("0.001") }), encrypted: NO_ENC,
    };
    const s = await prove(tree, plan);
    // Someone swaps the recipient: the proof no longer matches.
    await expect(vault.connect(relayer).spend(s.proof, s.pub, { ...s.ext, recipient: bob.address }, s.encrypted)).to.be.revertedWithCustomError(vault, "BadProof");
    // Or raises the relayer fee.
    await expect(vault.connect(relayer).spend(s.proof, s.pub, { ...s.ext, relayerFee: E("0.2") }, s.encrypted)).to.be.revertedWithCustomError(vault, "BadProof");
    const r0 = await ethers.provider.getBalance(relayer.address);
    const idx = Number(await vault.nextIndex());
    const rc = await (await vault.connect(bob).spend(s.proof, s.pub, s.ext, s.encrypted)).wait(); // anyone can submit
    await syncTree(rc);
    expect(await ethers.provider.getBalance(fresh)).to.equal(E("0.299"));
    expect((await ethers.provider.getBalance(relayer.address)) - r0).to.equal(E("0.001"));
    expect(await vault.liabilities(ETH)).to.equal(E("0.7"));
    // The same proof again: the notes are spent.
    await expect(vault.connect(relayer).spend(s.proof, s.pub, s.ext, s.encrypted)).to.be.revertedWithCustomError(vault, "AlreadySpent");
    change.index = idx;
    aliceEth = change;
    await solvent();
  });

  it("private buy then private sell: the vault trades, the result becomes a note, 0.5% fee in ETH", async () => {
    const eth: Note = aliceEth;
    const buyBlind = rand();
    const f0 = await vault.feesOwed();
    const { outs, resultIndex, rc } = await send({
      keys: alk, asset: ETH, inputs: [eth], outputs: [{ asset: 0n, amount: E("0.5"), blinding: rand(), pk: alk.pk }], publicOut: E("0.2"),
      partialOut: partialOf(alk.pk, buyBlind), ext: ext({ kind: KIND.buy, relayer: relayer.address, relayerFee: E("0.0005"), coin: coinAddr, minOut: 1n }), encrypted: NO_ENC,
    });
    const trade = rc.logs.map((l: any) => { try { return vault.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "PrivateTrade");
    const got = trade.args.amountOut as bigint;
    expect(got).to.be.gt(0n);
    expect((await vault.feesOwed()) - f0).to.equal(E("0.2") * 50n / 10_000n);
    expect(await vault.liabilities(coinAddr)).to.equal(got);
    expect(await coin.balanceOf(await vault.getAddress())).to.equal(got);
    // The result note is finished on chain; the owner rebuilds it from the event amount.
    const coinNote: Note = { asset: assetId(coinAddr), amount: got, blinding: buyBlind, pk: alk.pk, index: resultIndex };
    expect(tree.leaves[resultIndex]).to.equal(commitmentOf(coinNote));
    await solvent();

    // Sell half privately; the ETH comes back as a note.
    const sellBlind = rand();
    const half = got / 2n;
    const s2 = await send({
      keys: alk, asset: coinAddr, inputs: [coinNote], outputs: [{ asset: assetId(coinAddr), amount: got - half, blinding: rand(), pk: alk.pk }], publicOut: half,
      partialOut: partialOf(alk.pk, sellBlind), ext: ext({ kind: KIND.sell, relayer: relayer.address, relayerFee: E("0.0002"), coin: coinAddr, minOut: 1n }), encrypted: NO_ENC,
    });
    const t2 = s2.rc.logs.map((l: any) => { try { return vault.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "PrivateTrade");
    const ethNoteLocal: Note = { asset: 0n, amount: t2.args.amountOut as bigint, blinding: sellBlind, pk: alk.pk, index: s2.resultIndex };
    expect(tree.leaves[s2.resultIndex]).to.equal(commitmentOf(ethNoteLocal));
    expect(await vault.liabilities(coinAddr)).to.equal(got - half);
    await solvent();
    expect(outs[0].amount).to.equal(E("0.5"));
    coinRest = s2.outs[0];
    ethNote = ethNoteLocal;

    // A trade result can't be redirected: another partial is a different proof.
    // Fees reach the fee recipient.
    const owed = await vault.feesOwed();
    const a0 = await ethers.provider.getBalance(admin.address);
    await (await vault.connect(trader).claimFees()).wait();
    expect((await ethers.provider.getBalance(admin.address)) - a0).to.equal(owed);
    await solvent();
  });

  it("private transfer to another wallet, who withdraws it; a coin withdrawal pays out coins", async () => {
    const toBob: Note = { asset: assetId(coinAddr), amount: coinRest.amount, blinding: rand(), pk: bok.pk };
    const s = await send({ keys: alk, asset: coinAddr, inputs: [coinRest], outputs: [toBob], publicOut: 0n, partialOut: 0n, ext: ext({ kind: KIND.transfer }), encrypted: NO_ENC });
    toBob.index = Number(await vault.nextIndex()) - 2;
    // Alice can no longer spend it; Bob can.
    const dest = ethers.Wallet.createRandom().address;
    await send({ keys: bok, asset: coinAddr, inputs: [toBob], outputs: [], publicOut: toBob.amount, partialOut: 0n, ext: ext({ kind: KIND.withdraw, recipient: dest }), encrypted: NO_ENC });
    expect(await coin.balanceOf(dest)).to.equal(toBob.amount);
    expect(await vault.liabilities(coinAddr)).to.equal(0n);
    await solvent();
    expect(s.rc).to.not.equal(undefined);
  });

  it("the wrong key cannot spend a note, and value cannot be created", async () => {
    const note = await deposit(bob, bok, ETH, E("0.1"));
    // Alice's key on Bob's note: nullifier/partial mismatch, the prover itself refuses.
    await expect(prove(tree, { keys: alk, asset: ETH, inputs: [note], outputs: [], publicOut: E("0.1"), partialOut: 0n, ext: ext({ kind: KIND.withdraw, recipient: alice.address }), encrypted: NO_ENC })).to.be.rejected;
    // More out than in.
    await expect(prove(tree, { keys: bok, asset: ETH, inputs: [note], outputs: [{ asset: 0n, amount: E("0.1"), blinding: rand(), pk: bok.pk }], publicOut: E("0.1"), partialOut: 0n, ext: ext({ kind: KIND.withdraw, recipient: bob.address }), encrypted: NO_ENC })).to.be.rejected;
    bobEth = note;
  });

  it("admin pauses deposits and trades, never withdrawals; sanctioned addresses cannot deposit or receive", async () => {
    await expect(vault.connect(alice).setPaused(true, true)).to.be.revertedWithCustomError(vault, "NotAdmin");
    await (await vault.connect(admin).setPaused(true, true)).wait();
    await expect(vault.connect(alice).deposit(ETH, E("0.1"), partialOf(alk.pk, rand()), "0x", { value: E("0.1") })).to.be.revertedWithCustomError(vault, "Paused");
    const eth: Note = ethNote;
    await expect(send({ keys: alk, asset: ETH, inputs: [eth], outputs: [], publicOut: eth.amount, partialOut: partialOf(alk.pk, rand()), ext: ext({ kind: KIND.buy, coin: coinAddr, minOut: 1n }), encrypted: NO_ENC })).to.be.revertedWithCustomError(vault, "Paused");
    const dest = ethers.Wallet.createRandom().address;
    await send({ keys: alk, asset: ETH, inputs: [eth], outputs: [], publicOut: eth.amount, partialOut: 0n, ext: ext({ kind: KIND.withdraw, recipient: dest }), encrypted: NO_ENC });
    expect(await ethers.provider.getBalance(dest)).to.equal(eth.amount);
    await (await vault.connect(admin).setPaused(false, false)).wait();

    await (await sanctions.set(bob.address, true)).wait();
    await expect(vault.connect(bob).deposit(ETH, E("0.1"), partialOf(bok.pk, rand()), "0x", { value: E("0.1") })).to.be.revertedWithCustomError(vault, "Sanctioned");
    const note: Note = bobEth;
    await expect(send({ keys: bok, asset: ETH, inputs: [note], outputs: [], publicOut: note.amount, partialOut: 0n, ext: ext({ kind: KIND.withdraw, recipient: bob.address }), encrypted: NO_ENC })).to.be.revertedWithCustomError(vault, "Sanctioned");
    await (await sanctions.set(bob.address, false)).wait();
    await solvent();
  });

  it("coins held in the vault earn holder rewards; harvest sends them to the STONK distributor", async () => {
    // Put coins in the vault, then let others trade so the vault earns.
    await (await coin.connect(trader).approve(await vault.getAddress(), ethers.MaxUint256)).wait();
    const bal = await coin.balanceOf(trader.address);
    await deposit(trader, newKeys(), coinAddr, bal / 2n);
    await (await router.connect(alice).buy(coinAddr, "0x", 0, { value: E("0.5") })).wait();
    const weth = new ethers.Contract(WETH, ERC20, ethers.provider);
    const pending = await coin.pendingRewards(await vault.getAddress());
    expect(pending).to.be.gt(0n);
    const d0 = await weth.balanceOf(DISTRIBUTOR);
    await (await vault.connect(bob).harvest(coinAddr)).wait();
    expect((await weth.balanceOf(DISTRIBUTOR)) - d0).to.equal(pending);
    await solvent();
  });

  it("gas", async () => {
    const note = await deposit(alice, alk, ETH, E("0.05"));
    const { rc } = await send({ keys: alk, asset: ETH, inputs: [note], outputs: [{ asset: 0n, amount: E("0.02"), blinding: rand(), pk: alk.pk }], publicOut: E("0.03"), partialOut: partialOf(alk.pk, rand()), ext: ext({ kind: KIND.buy, coin: coinAddr, minOut: 1n }), encrypted: NO_ENC });
    console.log("      private buy gas:", rc.gasUsed.toString());
  });
});
