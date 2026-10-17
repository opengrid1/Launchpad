import { expect } from "chai";
import { ethers, network } from "hardhat";

// OneHook on an Ethereum mainnet fork: the real Uniswap V4 PoolManager, the live Etherhook
// oracle (ETH, gold and the Ondo stocks), WETH and PAXG.
//   FORK=1 ETH_RPC_URL=https://ethereum-rpc.publicnode.com \
//   npx hardhat --config hardhat.config.onehook.ts test test/v4/onehook.fork.test.ts
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const ORACLE = "0xD1Ca49bd44A447c48d2a1FAC5F35cF583D8a7b1b";
const UNI_V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const PAXG = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
const V2 = 1;
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
// beforeInitialize, beforeAddLiquidity, beforeRemoveLiquidity, beforeSwap, afterSwap, beforeDonate, beforeSwapReturnDelta, afterSwapReturnDelta
const HOOK_FLAGS = (1n << 13n) | (1n << 11n) | (1n << 9n) | (1n << 7n) | (1n << 6n) | (1n << 5n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const SUPPLY = 10n ** 27n;
const BPS = 10_000n;
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function totalSupply() view returns (uint256)", "function transfer(address,uint256) returns (bool)"];
const E = ethers.parseEther;
let saltN = 1n;
const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(saltN++), 32);
const route = (hops: any[]) => (hops.length ? ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [hops]) : "0x");
const mine = async (n = 1) => network.provider.send("hardhat_mine", ["0x" + n.toString(16)]);
const mins = async (m: number) => { await network.provider.send("evm_increaseTime", [Math.round(m * 60)]); await network.provider.send("evm_mine", []); };
const v2Factory = () => ethers.getContractAt(["function getPair(address,address) view returns (address)", "function createPair(address,address) returns (address)"], UNI_V2_FACTORY);
const bal = (a: string) => ethers.provider.getBalance(a);
const gasOf = async (tx: any) => { const rc = await tx.wait(); return { rc, gas: rc.gasUsed * rc.gasPrice }; };
const fmt = (v: bigint, d = 18) => Number(ethers.formatUnits(v, d));

// a coin's instincts; override per test
const G = (o: any = {}) => ({
  feeMode: 0, feeBps: 100,
  snipeBps: 0, snipeBlocks: 0,
  buybackShareBps: 0, divShareBps: 0,
  maxWalletBps: 0, maxWalletSecs: 0,
  buybackThreshold: 0,
  ...o,
});

// a later evolution stage: a market-cap milestone (whole USD) and the genes it switches to
const S = (mcapUsd: number | bigint, o: any = {}) => ({ mcapUsd8: BigInt(mcapUsd) * 10n ** 8n, genes: G(o) });

async function deployAll(admin: any) {
  const deployer = (await ethers.getSigners())[9];
  const c2 = await (await ethers.getContractFactory("HookDeployer", deployer)).deploy();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("OneHook");
  const init = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [POOL_MANAGER, WETH])]);
  const hash = ethers.keccak256(init);
  let hookAddr = "", salt = "";
  for (let i = 0n; i < 3_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
  }
  await (await c2.deploy(salt, init)).wait();
  const hook = await ethers.getContractAt("OneHook", hookAddr, deployer);
  const td = await (await ethers.getContractFactory("OneTokenDeployer", deployer)).deploy();
  const factory = await (await ethers.getContractFactory("OneFactory", deployer)).deploy(deployer.address, admin.address, POOL_MANAGER, hookAddr, await td.getAddress(), WETH, ORACLE, ethers.ZeroAddress);
  const fAddr = await factory.getAddress();
  await (await td.setFactory(fAddr)).wait();
  await (await hook.setFactory(fAddr)).wait();
  const router = await (await ethers.getContractFactory("OneRouter", deployer)).deploy(POOL_MANAGER, fAddr, WETH);
  await (await factory.setConverter(await router.getAddress())).wait();
  return { hook, factory, router, deployer, hookAddr, routerAddr: await router.getAddress() };
}

async function launch(env: any, creator: any, o: { genes?: any; stages?: any[]; pair?: string; ethIn?: bigint; route?: string; name?: string; abi?: string } = {}) {
  const n = Number(await env.factory.totalTokens());
  const stages = o.stages ?? [];
  const tx = await env.factory.connect(creator).launch(
    { name: o.name ?? "OneHook Test", symbol: "OHT", metadataURI: '{"description":"fork test"}', pair: o.pair ?? WETH, minPairOut: 0, genes: o.genes ?? G(), stages },
    nextSalt(),
    o.route ?? "0x",
    { value: o.ethIn ?? 0n }
  );
  const rc = await tx.wait();
  const token = await env.factory.allTokens(n);
  const anyDiv = ((o.genes?.divShareBps ?? 0) !== 0) || stages.some((s: any) => (s.genes?.divShareBps ?? 0) !== 0);
  const coin = await ethers.getContractAt(o.abi ?? (anyDiv ? "OneDivToken" : "OneToken"), token);
  return { coin, token, gas: rc!.gasUsed };
}

describe("OneHook on Ethereum (mainnet fork)", function () {
  this.timeout(1_800_000);
  let env: any;
  let admin: any, creator: any, alice: any, bob: any, carol: any, dave: any;
  let token: string, coin: any;
  const weth = () => ethers.getContractAt(ERC20, WETH);

  before(async () => {
    await network.provider.send("evm_mine", []);
    [admin, creator, alice, bob, carol, dave] = await ethers.getSigners();
    for (const s of [alice, bob, carol, dave, creator, admin]) await network.provider.send("hardhat_setBalance", [s.address, "0x" + E("500").toString(16)]);
    env = await deployAll(admin);
  });

  // Evolved stages emitted in a tx, read from the receipt's logs (no eth_getLogs — public fork RPCs forbid it)
  const evolvedStages = (rc: any): number[] => rc.logs
    .filter((l: any) => l.address.toLowerCase() === env.hookAddr.toLowerCase())
    .map((l: any) => { try { return env.hook.interface.parseLog(l); } catch { return null; } })
    .filter((p: any) => p && p.name === "Evolved")
    .map((p: any) => Number(p.args.stage));

  it("launches a flat-fee coin; the creator's first buy lands in the launch block", async () => {
    const r = await launch(env, creator, { ethIn: E("0.02") });
    token = r.token; coin = r.coin;
    console.log(`      launch + 0.02 ETH first buy: ${r.gas} gas`);
    expect(BigInt(token) < BigInt(WETH)).to.equal(true);
    expect(await coin.totalSupply()).to.equal(SUPPLY);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0);
    const pos = await env.hook.positionOf(token);
    expect(pos.liquidity).to.be.gt(0);
    const slack = await env.hook.COIN_SLACK();
    expect(await coin.balanceOf(env.hookAddr)).to.be.gte(slack);
    expect(await coin.balanceOf(env.hookAddr)).to.be.lt(slack + 10n ** 6n);
    expect(await env.hook.feeBpsNow(token, true)).to.equal(100n);
    const genes = await env.hook.genesOf(token);
    expect(genes.feeBps).to.equal(100n);
  });

  it("flat fee: a buy pays 1% of the pair side, split 60/40 after the pots (none here)", async () => {
    const cBefore = await env.hook.creatorOwed(token);
    const pBefore = await env.hook.platformOwed(token);
    await (await env.router.connect(bob).buy(token, "0x", 0, { value: E("0.1") })).wait();
    const fee = E("0.1") / 100n;
    expect((await env.hook.creatorOwed(token)) - cBefore).to.equal((fee * 6_000n) / BPS);
    expect((await env.hook.platformOwed(token)) - pBefore).to.equal((fee * 4_000n) / BPS);
    const got = await coin.balanceOf(bob.address);
    await (await coin.connect(bob).approve(env.routerAddr, got)).wait();
    const before = await bal(bob.address);
    const { gas } = await gasOf(await env.router.connect(bob).sell(token, got, "0x", 0));
    const out = (await bal(bob.address)) - before + gas;
    console.log(`      bob bought 0.1 ETH of coins and sold them back for ${fmt(out).toFixed(5)} ETH`);
    expect(out).to.be.gt(E("0.09"));
    expect(out).to.be.lt(E("0.1"));
  });

  it("constitution: a same-block buy and sell both pass (what a honeypot simulator runs)", async () => {
    // get coins and approve first, in their own blocks
    await (await env.router.connect(alice).buy(token, "0x", 0, { value: E("0.02") })).wait();
    await (await coin.connect(alice).approve(env.routerAddr, ethers.MaxUint256)).wait();
    const half = (await coin.balanceOf(alice.address)) / 2n;
    await network.provider.send("evm_setAutomine", [false]);
    const tx1 = await env.router.connect(alice).buy(token, "0x", 0, { value: E("0.01"), gasLimit: 1_500_000 });
    const tx2 = await env.router.connect(alice).sell(token, half, "0x", 0, { gasLimit: 1_500_000 });
    await network.provider.send("evm_mine", []);
    await network.provider.send("evm_setAutomine", [true]);
    const r1 = await ethers.provider.getTransactionReceipt(tx1.hash);
    const r2 = await ethers.provider.getTransactionReceipt(tx2.hash);
    expect(r1!.status).to.equal(1);
    expect(r2!.status).to.equal(1);
  });

  it("constitution: the launch block belongs to the creator; a same-block snipe dies at the pool", async () => {
    const sniper = await (await ethers.getContractFactory("LaunchSniper", alice)).deploy();
    await expect(
      sniper.connect(alice).snipe(
        await env.factory.getAddress(),
        env.routerAddr,
        { name: "Snipe Me", symbol: "SNP", metadataURI: "{}", pair: WETH, minPairOut: 0, genes: G(), stages: [] },
        nextSalt(),
        { value: E("0.05") }
      )
    ).to.be.reverted; // LaunchBlockClosed, wrapped by the PoolManager's hook-call bubbling
  });

  it("the creator and the platform are paid their fee shares as ETH; anyone can push", async () => {
    const owed = await env.hook.creatorOwed(token);
    expect(owed).to.be.gt(0);
    const before = await bal(creator.address);
    await (await env.hook.connect(alice).payCreator(token)).wait();
    expect((await bal(creator.address)) - before).to.equal(owed);
    const plat = await env.hook.platformOwed(token);
    const aBefore = await bal(admin.address);
    await (await env.factory.connect(alice).pushPlatformFees([token])).wait();
    expect((await bal(admin.address)) - aBefore).to.equal(plat);
    console.log(`      creator paid ${fmt(owed).toFixed(5)} ETH, platform ${fmt(plat).toFixed(5)} ETH`);
  });

  it("anti-snipe: an early buy pays the decaying launch tax, then the base fee", async () => {
    const r = await launch(env, creator, { genes: G({ snipeBps: 3000, snipeBlocks: 50 }) });
    const early = await env.hook.feeBpsNow(r.token, true);
    expect(early).to.be.gt(2800n);
    expect(await env.hook.feeBpsNow(r.token, false)).to.equal(100n); // sells never pay it
    const cBefore = await env.hook.creatorOwed(r.token);
    await (await env.router.connect(alice).buy(r.token, "0x", 0, { value: E("0.1") })).wait();
    const creatorCut = (await env.hook.creatorOwed(r.token)) - cBefore;
    // at ~29% the creator's 60% is ~0.0175 ETH; at 1% it would be 0.0006
    expect(creatorCut).to.be.gt(E("0.01"));
    await mine(50);
    expect(await env.hook.feeBpsNow(r.token, true)).to.equal(100n);
    const c2 = await env.hook.creatorOwed(r.token);
    await (await env.router.connect(bob).buy(r.token, "0x", 0, { value: E("0.1") })).wait();
    expect((await env.hook.creatorOwed(r.token)) - c2).to.equal((E("0.1") / 100n) * 6_000n / BPS);
    console.log(`      first-block fee ${early} bps, after 50 blocks 100 bps`);
  });

  it("reflexive buyback: past the threshold the pot buys the coin and burns it inside the swap", async () => {
    const r = await launch(env, creator, { genes: G({ buybackShareBps: 3000, buybackThreshold: E("0.002") }) });
    // per 0.1 ETH buy: fee 0.001, pot share 0.0003; the creator/platform split the rest 60/40
    const cBefore = await env.hook.creatorOwed(r.token);
    await (await env.router.connect(alice).buy(r.token, "0x", 0, { value: E("0.1") })).wait();
    expect(await env.hook.buybackPot(r.token)).to.equal(E("0.0003"));
    expect((await env.hook.creatorOwed(r.token)) - cBefore).to.equal((E("0.0007") * 6_000n) / BPS);
    const supplyBefore = await r.coin.totalSupply();
    const buyers = [bob, carol, dave, alice, bob, carol];
    for (const b of buyers) await (await env.router.connect(b).buy(r.token, "0x", 0, { value: E("0.1") })).wait();
    // 7 buys x 0.0003 = 0.0021 >= 0.002: the 7th buy triggered the burn
    const burned = supplyBefore - (await r.coin.totalSupply());
    expect(burned).to.be.gt(0);
    expect(await env.hook.buybackPot(r.token)).to.be.lt(E("0.002"));
    console.log(`      burned ${fmt(burned).toExponential(3)} coins; pot left ${fmt(await env.hook.buybackPot(r.token)).toFixed(6)} ETH`);
    // manual push also works once something is in the pot
    await (await env.router.connect(dave).buy(r.token, "0x", 0, { value: E("0.1") })).wait();
    const s2 = await r.coin.totalSupply();
    await (await env.hook.connect(alice).buybackBurn(r.token)).wait();
    expect(await r.coin.totalSupply()).to.be.lt(s2);
    expect(await env.hook.buybackPot(r.token)).to.equal(0);
  });

  it("dividends: holders claim the fee share pro-rata, in ETH", async () => {
    const r = await launch(env, creator, { genes: G({ divShareBps: 4000 }) });
    await (await env.router.connect(alice).buy(r.token, "0x", 0, { value: E("0.2") })).wait();
    await (await env.router.connect(bob).buy(r.token, "0x", 0, { value: E("0.1") })).wait();
    const pot = await env.hook.dividendPot(r.token);
    expect(pot).to.equal((E("0.3") / 100n) * 4_000n / BPS);
    await (await env.hook.connect(carol).pushDividends(r.token)).wait();
    expect(await env.hook.dividendPot(r.token)).to.equal(0);
    expect(await (await weth()).balanceOf(await r.coin.getAddress())).to.equal(pot);
    const wA = await r.coin.withdrawableDividends(alice.address);
    const wB = await r.coin.withdrawableDividends(bob.address);
    const balA = await r.coin.balanceOf(alice.address);
    const balB = await r.coin.balanceOf(bob.address);
    expect(wA + wB).to.be.closeTo(pot, 1000n);
    // pro-rata to balances
    expect(wA * balB).to.be.closeTo(wB * balA, wB * balA / 1000n);
    // the pool, the hook and the launchpad's contracts hold no claimable shares
    expect(await r.coin.withdrawableDividends(env.hookAddr)).to.equal(0);
    expect(await r.coin.withdrawableDividends(POOL_MANAGER)).to.equal(0);
    const before = await bal(alice.address);
    const { gas } = await gasOf(await r.coin.connect(alice).claimDividends());
    expect((await bal(alice.address)) - before + gas).to.equal(wA);
    expect(await r.coin.withdrawableDividends(alice.address)).to.equal(0);
    // a transfer moves future dividends, not what was already earned
    await (await r.coin.connect(bob).transfer(carol.address, balB / 2n)).wait();
    expect(await r.coin.withdrawableDividends(bob.address)).to.equal(wB);
    expect(await r.coin.withdrawableDividends(carol.address)).to.equal(0);
    console.log(`      pot ${fmt(pot).toFixed(6)} ETH; alice claimed ${fmt(wA).toFixed(6)} ETH`);
  });

  it("max-wallet: the hook caps what one wallet can buy in the opening window, never a sell; lifts on time", async () => {
    const r = await launch(env, creator, { genes: G({ maxWalletBps: 100, maxWalletSecs: 3600 }) });
    // ~1% of a $5k cap is ~$50 of coins: a 0.1 ETH buy blows through it
    await expect(env.router.connect(alice).buy(r.token, "0x", 0, { value: E("0.1"), gasLimit: 1_500_000 })).to.be.reverted; // BuyCapExceeded
    await (await env.router.connect(alice).buy(r.token, "0x", 0, { value: E("0.002") })).wait();
    const got = await r.coin.balanceOf(alice.address);
    expect(got).to.be.gt(0);
    expect(await env.hook.windowBought(await env.hook.poolOf(r.token), alice.address)).to.equal(got);
    // the cap is on buying from the pool, not on holding: plain transfers stay free
    await (await r.coin.connect(alice).transfer(carol.address, got / 4n)).wait();
    // selling is never blocked
    await (await r.coin.connect(alice).approve(env.routerAddr, got)).wait();
    await (await env.router.connect(alice).sell(r.token, got / 2n, "0x", 0)).wait();
    // after the window the cap lifts
    await mins(61);
    await (await env.router.connect(bob).buy(r.token, "0x", 0, { value: E("0.1") })).wait();
    expect(await r.coin.balanceOf(bob.address)).to.be.gt(SUPPLY / 100n);
  });

  it("dynamic fee: clustered swaps widen the fee; quiet blocks relax it", async () => {
    const r = await launch(env, creator, { genes: G({ feeMode: 1 }) });
    expect(await env.hook.feeBpsNow(r.token, true)).to.equal(100n);
    await (await env.router.connect(alice).buy(r.token, "0x", 0, { value: E("0.1") })).wait();
    const after1 = await env.hook.feeBpsNow(r.token, true);
    expect(after1).to.be.gt(100n); // the first swap's bump, barely decayed
    const cBefore = await env.hook.creatorOwed(r.token);
    await (await env.router.connect(bob).buy(r.token, "0x", 0, { value: E("0.1") })).wait();
    const paid = (await env.hook.creatorOwed(r.token)) - cBefore;
    expect(paid).to.be.gt((E("0.1") / 100n) * 6_000n / BPS); // bob paid more than the base 1%
    await mine(40);
    expect(await env.hook.feeBpsNow(r.token, true)).to.equal(100n);
    console.log(`      fee after one swap ${after1} bps, after 40 quiet blocks 100 bps`);
  });

  it("MEV-tax is constitutional: on every coin the fee grows with the priority fee above 1 gwei", async () => {
    const r = await launch(env, creator, { genes: G() }); // plain flat coin
    const fee1 = ethers.parseUnits("1", "gwei");
    const cB1 = await env.hook.creatorOwed(r.token);
    await (await env.router.connect(alice).buy(r.token, "0x", 0, { value: E("0.1"), maxPriorityFeePerGas: fee1, maxFeePerGas: ethers.parseUnits("1000", "gwei") })).wait();
    expect((await env.hook.creatorOwed(r.token)) - cB1).to.equal((E("0.1") / 100n) * 6_000n / BPS);
    // 11 gwei tip: 10 gwei over the free band = 200 extra bps, 3% all in
    const cB2 = await env.hook.creatorOwed(r.token);
    await (await env.router.connect(bob).buy(r.token, "0x", 0, { value: E("0.1"), maxPriorityFeePerGas: ethers.parseUnits("11", "gwei"), maxFeePerGas: ethers.parseUnits("1000", "gwei") })).wait();
    expect((await env.hook.creatorOwed(r.token)) - cB2).to.equal(((E("0.1") * 300n) / BPS) * 6_000n / BPS);
    console.log(`      flat coin: 1 gwei tip paid 100 bps, 11 gwei tip paid 300 bps`);
  });

  it("the mev-tax gene doubles the slope", async () => {
    const r = await launch(env, creator, { genes: G({ feeMode: 2 }) });
    // 11 gwei tip at double slope: 400 extra bps, 5% all in
    const cB = await env.hook.creatorOwed(r.token);
    await (await env.router.connect(carol).buy(r.token, "0x", 0, { value: E("0.1"), maxPriorityFeePerGas: ethers.parseUnits("11", "gwei"), maxFeePerGas: ethers.parseUnits("1000", "gwei") })).wait();
    expect((await env.hook.creatorOwed(r.token)) - cB).to.equal(((E("0.1") * 500n) / BPS) * 6_000n / BPS);
    console.log(`      mev-tax coin: 11 gwei tip paid 500 bps`);
  });

  it("the coin is a plain ERC-20: no transfer can be blocked, permit works, nobody owns it", async () => {
    // even a transfer to a V2 pair or the PoolManager is just a transfer
    const pairAddr = await (await v2Factory()).createPair.staticCall(token, WETH);
    await (await (await v2Factory()).createPair(token, WETH)).wait();
    await (await coin.connect(creator).transfer(pairAddr, 1000n)).wait();
    await (await coin.connect(creator).transfer(POOL_MANAGER, 1000n)).wait();
    expect(await coin.owner()).to.equal(ethers.ZeroAddress);
    expect(await coin.nonces(creator.address)).to.equal(0); // EIP-2612 surface exists
    expect((await coin.DOMAIN_SEPARATOR()).length).to.equal(66);
    // but nobody can open a second pool WITH the hook, or add liquidity to the real one
    const pm = await ethers.getContractAt(["function initialize((address,address,uint24,int24,address),uint160) returns (int24)"], POOL_MANAGER);
    await expect(pm.connect(alice).initialize([ethers.ZeroAddress, WETH, 0, 10, env.hookAddr], 2n ** 96n)).to.be.reverted;
  });

  it("the constitution bounds the genes at launch", async () => {
    const bad = async (genes: any) => expect(launch(env, creator, { genes })).to.be.revertedWithCustomError(env.factory, "BadGenes");
    await bad(G({ feeBps: 5 }));
    await bad(G({ feeBps: 400 }));
    await bad(G({ feeMode: 3 }));
    await bad(G({ snipeBps: 3000 })); // no decay length
    await bad(G({ snipeBps: 3500, snipeBlocks: 50 })); // above the 30% snipe ceiling
    await bad(G({ buybackShareBps: 3000 })); // no threshold
    await bad(G({ buybackShareBps: 5500, buybackThreshold: E("0.01") }));
    await bad(G({ buybackShareBps: 5000, buybackThreshold: E("0.01"), divShareBps: 4000 })); // pots > 80%
    await bad(G({ maxWalletBps: 100 })); // no window
    await bad(G({ maxWalletBps: 30, maxWalletSecs: 3600 }));
    await bad(G({ maxWalletBps: 100, maxWalletSecs: 60 }));
  });

  it("admin: collect pulls a share of the pool liquidity; pause, hide, metadata, recipient, blocklist, start cap; others can't", async () => {
    const cBefore = await coin.balanceOf(admin.address);
    const pBefore = await (await weth()).balanceOf(admin.address);
    const liqBefore = (await env.hook.positionOf(token)).liquidity;
    await expect(env.factory.connect(alice).collect(token, 2500, alice.address)).to.be.revertedWithCustomError(env.factory, "NotAdmin");
    await (await env.factory.connect(admin).collect(token, 2500, admin.address)).wait();
    const coinsGot = (await coin.balanceOf(admin.address)) - cBefore;
    const pairGot = (await (await weth()).balanceOf(admin.address)) - pBefore;
    console.log(`      collect 25%: ${fmt(coinsGot).toExponential(3)} coins + ${fmt(pairGot).toFixed(5)} WETH`);
    expect(coinsGot).to.be.gt(0);
    expect(pairGot).to.be.gt(0);
    const liqAfter = (await env.hook.positionOf(token)).liquidity;
    expect(liqAfter * 4n).to.be.closeTo(liqBefore * 3n, liqBefore / 100n);
    // trading still works after a collect
    await (await env.router.connect(carol).buy(token, "0x", 0, { value: E("0.05") })).wait();

    await (await env.factory.connect(admin).pause()).wait();
    await expect(launch(env, creator)).to.be.revertedWithCustomError(env.factory, "LaunchesPaused");
    await (await env.factory.connect(admin).resume()).wait();

    await (await env.factory.connect(admin).setHidden(token, true)).wait();
    expect(await env.factory.hidden(token)).to.equal(true);
    await (await env.factory.connect(admin).setHidden(token, false)).wait();

    await (await env.factory.connect(admin).setCoinMetadata(token, '{"name":"edited"}')).wait();
    expect(await env.factory.metadataOf(token)).to.equal('{"name":"edited"}');
    await (await env.factory.connect(admin).setCoinMetadata(token, "")).wait();
    expect(await env.factory.metadataOf(token)).to.equal('{"description":"fork test"}');

    await (await env.factory.connect(admin).setFeeRecipient(dave.address)).wait();
    await (await env.router.connect(bob).buy(token, "0x", 0, { value: E("0.05") })).wait();
    const owed = await env.hook.platformOwed(token);
    const dBefore = await bal(dave.address);
    await (await env.factory.connect(alice).pushPlatformFees([token])).wait();
    expect((await bal(dave.address)) - dBefore).to.equal(owed);
    await (await env.factory.connect(admin).setFeeRecipient(admin.address)).wait();

    await (await env.factory.connect(admin).setTokenBlocked(PAXG, true)).wait();
    await expect(launch(env, creator, { pair: PAXG })).to.be.revertedWithCustomError(env.factory, "Blocked");
    await (await env.factory.connect(admin).setTokenBlocked(PAXG, false)).wait();

    await expect(env.factory.connect(admin).setStartCap(999n * 10n ** 8n)).to.be.revertedWithCustomError(env.factory, "InvalidParams");
    await (await env.factory.connect(admin).setStartCap(20_000n * 10n ** 8n)).wait();
    expect(await env.factory.startCapUsd8()).to.equal(20_000n * 10n ** 8n);
    await (await env.factory.connect(admin).setStartCap(5_000n * 10n ** 8n)).wait();

    for (const call of [
      env.factory.connect(alice).pause(),
      env.factory.connect(alice).setHidden(token, true),
      env.factory.connect(alice).setCoinMetadata(token, "x"),
      env.factory.connect(alice).setFeeRecipient(alice.address),
      env.factory.connect(alice).setTokenBlocked(PAXG, true),
      env.factory.connect(alice).setStartCap(10_000n * 10n ** 8n),
    ]) await expect(call).to.be.revertedWithCustomError(env.factory, "NotAdmin");
    await expect(env.factory.connect(alice).setConverter(alice.address)).to.be.revertedWithCustomError(env.factory, "NotAdmin");
    await expect(env.factory.connect(admin).setConverter(alice.address)).to.be.revertedWithCustomError(env.factory, "InvalidParams"); // one-time, already set
  });

  it("the deployer's setup rights can be renounced; the admin keeps its own", async () => {
    await expect(env.factory.connect(alice).renounceOwnership()).to.be.revertedWithCustomError(env.factory, "NotAdmin");
    await (await env.factory.connect(env.deployer).renounceOwnership()).wait();
    expect(await env.factory.owner()).to.equal(ethers.ZeroAddress);
    await (await env.factory.connect(admin).pause()).wait();
    await (await env.factory.connect(admin).resume()).wait();
  });

  it("a coin paired with tokenized gold (PAXG): fees accrue in PAXG, the creator is paid in PAXG", async () => {
    const pair = await (await v2Factory()).getPair(PAXG, WETH);
    const rt = route([{ dex: V2, pool: pair, key: EMPTY_KEY }]);
    const r = await launch(env, creator, { pair: PAXG, route: rt, ethIn: E("0.01") });
    console.log(`      PAXG launch + 0.01 ETH first buy: ${r.gas} gas`);
    const gold = await ethers.getContractAt(ERC20, PAXG);
    expect(await r.coin.balanceOf(creator.address)).to.be.gt(0);
    await mine(2);
    await (await env.router.connect(alice).buy(r.token, rt, 0, { value: E("0.2") })).wait();
    const owed = await env.hook.creatorOwed(r.token);
    expect(owed).to.be.gt(0);
    const gBefore = await gold.balanceOf(creator.address);
    await (await env.hook.connect(alice).payCreator(r.token)).wait();
    expect((await gold.balanceOf(creator.address)) - gBefore).to.equal(owed);
    // and the coins sell back to ETH along the same route
    const got = await r.coin.balanceOf(alice.address);
    await (await r.coin.connect(alice).approve(env.routerAddr, got)).wait();
    const before = await bal(alice.address);
    const { gas } = await gasOf(await env.router.connect(alice).sell(r.token, got, rt, 0));
    const out = (await bal(alice.address)) - before + gas;
    console.log(`      alice's 0.2 ETH round trip came back as ${fmt(out).toFixed(5)} ETH`);
    expect(out).to.be.gt(E("0.15"));
  });

  it("evolution: a coin advances through its pre-committed stages as market cap climbs, swapping in holder-favorable genes", async () => {
    const stages = [
      S(5_500, { feeBps: 150, buybackShareBps: 2000, buybackThreshold: E("0.01") }),
      S(7_000, { feeBps: 100, buybackShareBps: 2000, buybackThreshold: E("0.01"), divShareBps: 3000 }),
    ];
    const r = await launch(env, creator, { genes: G({ feeBps: 200 }), stages, abi: "OneDivToken" });
    const poolId = await env.hook.poolOf(r.token);
    // launches at stage 0 with the genesis genes; the whole path is stored and the token supports dividends
    expect((await env.hook.config(poolId)).currentStage).to.equal(0n);
    expect((await env.hook.config(poolId)).stageCount).to.equal(3n);
    const g0 = await env.hook.genesOf(r.token);
    expect(g0.feeBps).to.equal(200n);
    expect(g0.divShareBps).to.equal(0n);
    const path = await env.hook.stagesOf(r.token);
    expect(path.length).to.equal(3);
    expect(path[0].sqrtThreshold).to.equal(0n);
    expect(path[1].mcapUsd8).to.equal(5_500n * 10n ** 8n);
    expect(path[2].mcapUsd8).to.equal(7_000n * 10n ** 8n);
    expect(path[2].sqrtThreshold).to.be.gt(path[1].sqrtThreshold);
    expect(await r.coin.withdrawableDividends(creator.address)).to.equal(0n); // OneDivToken surface exists

    // buys push the price up; the coin advances forward-only through the stages
    const buyers = [alice, bob, carol, dave, creator];
    const seen: number[] = [];
    let stage = 0, i = 0;
    while (stage < 2 && i < 80) {
      const amt = E("0.1") * BigInt(1 + Math.floor(i / 8));
      const rc = await (await env.router.connect(buyers[i % buyers.length]).buy(r.token, "0x", 0, { value: amt })).wait();
      seen.push(...evolvedStages(rc));
      const s = Number((await env.hook.config(poolId)).currentStage);
      expect(s).to.be.gte(stage); // forward-only: never moves back
      stage = s; i++;
    }
    expect(stage).to.equal(2);
    const g2 = await env.hook.genesOf(r.token);
    expect(g2.feeBps).to.equal(100n);
    expect(g2.buybackShareBps).to.equal(2000n);
    expect(g2.divShareBps).to.equal(3000n);
    expect(seen.length).to.be.gte(1); // Evolved fired at least once
    expect(seen[seen.length - 1]).to.equal(2); // the last advance reached the final stage
    console.log(`      evolved to stage 2 after ${i} buys (Evolved: ${seen.join("→")}); fee 200→100 bps, dividends on`);

    // a sell lowers the price but can never move the coin back a stage
    const got = await r.coin.balanceOf(alice.address);
    expect(got).to.be.gt(0n);
    await (await r.coin.connect(alice).approve(env.routerAddr, got)).wait();
    await (await env.router.connect(alice).sell(r.token, got, "0x", 0)).wait();
    expect((await env.hook.config(poolId)).currentStage).to.equal(2n);
  });

  it("evolution: one large buy can cross several milestones in a single swap", async () => {
    const stages = [S(5_500, { feeBps: 150 }), S(7_000, { feeBps: 100 })];
    const r = await launch(env, creator, { genes: G({ feeBps: 200 }), stages });
    const poolId = await env.hook.poolOf(r.token);
    expect((await env.hook.config(poolId)).currentStage).to.equal(0n);
    const rc = await (await env.router.connect(alice).buy(r.token, "0x", 0, { value: E("50") })).wait();
    expect((await env.hook.config(poolId)).currentStage).to.equal(2n);
    expect((await env.hook.genesOf(r.token)).feeBps).to.equal(100n);
    const seen = evolvedStages(rc);
    expect(seen[seen.length - 1]).to.equal(2); // one swap advanced straight to the final stage
    console.log(`      one 50 ETH buy jumped straight to stage 2 (Evolved: ${seen.join("→")})`);
  });

  it("evolution: the factory rejects stages that would hurt holders or milestones that don't rise", async () => {
    const bad = async (genes: any, stages: any[]) =>
      expect(launch(env, creator, { genes, stages })).to.be.revertedWithCustomError(env.factory, "BadGenes");
    await bad(G({ feeBps: 100 }), [S(6_000, { feeBps: 200 })]); // fee can't rise across a stage
    await bad(G({ feeBps: 100 }), [S(5_000, { feeBps: 100 })]); // milestone must exceed the start cap
    await bad(G({ feeBps: 100 }), [S(6_000, { feeBps: 100 }), S(6_000, { feeBps: 100 })]); // must strictly increase
    await bad(G({ feeBps: 100, feeMode: 0 }), [S(6_000, { feeMode: 1, feeBps: 100 })]); // fee engine can't change
    await bad(G({ feeBps: 100, divShareBps: 3000 }), [S(6_000, { feeBps: 100, divShareBps: 2000 })]); // dividends can't shrink
    await bad(G({ feeBps: 100, snipeBps: 1000, snipeBlocks: 20 }), [S(6_000, { feeBps: 100, snipeBps: 2000, snipeBlocks: 20 })]); // anti-snipe can't grow
    await bad(G({ feeBps: 100 }), [S(6_000, { feeBps: 100, maxWalletBps: 500, maxWalletSecs: 600 })]); // max-wallet can't be re-enabled
    await bad(G({ feeBps: 100 }), [S(6_000, { feeBps: 100 }), S(7_000, { feeBps: 100 }), S(8_000, { feeBps: 100 }), S(9_000, { feeBps: 100 }), S(10_000, { feeBps: 100 }), S(11_000, { feeBps: 100 })]); // too many stages
    console.log(`      holder-hostile and non-rising evolution paths all revert`);
  });
});
