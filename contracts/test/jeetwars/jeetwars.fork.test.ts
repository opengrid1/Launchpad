import { expect } from "chai";
import { ethers, network } from "hardhat";

// Jeet Wars on a BNB Chain fork: real PancakeSwap Infinity Vault + CL pool
// manager, PancakeSwap V3 SmartRouter, WBNB, USDT and Binance bStocks.
//   FORK=1 ROBINHOOD_RPC_URL=https://bsc-mainnet.public.blastapi.io ROBINHOOD_CHAIN_ID=56 FORK_BLOCK=<recent> \
//   NODE_USE_ENV_PROXY=1 HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat test test/jeetwars/jeetwars.fork.test.ts
const VAULT = ethers.getAddress("0x238a358808379702088667322f80ac48bad5e6c4");
const CLPM = ethers.getAddress("0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b");
const WBNB = ethers.getAddress("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c");
const USDT = ethers.getAddress("0x55d398326f99059ff775485246999027b3197955");
const SMART_ROUTER = ethers.getAddress("0x13f4ea83d0bd40e75c8222255bc855a974568dd4");
const ARMIES: [string, string][] = [
  ["NVDA", "0x02fca66c1d1afb4e2a7884261eb00f63598a7436"],
  ["QQQ", "0x205812cdbed920aff76c6580abd681a46d11efc7"],
  ["TSLA", "0x5b1910eaad6450e50f816082aa078c41f10c292f"],
  ["GOOGL", "0x3f53de71c126bdabae20f9cd64848d317f6c3238"],
  ["BABA", "0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec"],
  ["AAPL", "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a"],
  ["CRCL", "0x80f3d493ebce97e343c53d29a137942416b4ffc0"],
  ["SPY", "0x7138b48df7d98d7e3cc221bfe7192d0a178182d8"],
];
const NVDAB = ethers.getAddress(ARMIES[0][1]);
// WBNB -(0.05%)-> USDT -(0.25%)-> NVDAB, both PancakeSwap V3.
const NVDA_PATH = ethers.solidityPacked(["address", "uint24", "address", "uint24", "address"], [WBNB, 500, USDT, 2500, NVDAB]);
const START_TICK = 191_000; // ~5 BNB starting market cap
const E = ethers.parseEther;

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function totalSupply() view returns (uint256)",
];

async function increase(sec: number) {
  await network.provider.send("evm_increaseTime", [sec]);
  await network.provider.send("evm_mine");
}
async function mine(n: number) {
  for (let i = 0; i < n; i++) await network.provider.send("evm_mine");
}
async function now() {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}

describe("Jeet Wars (BNB Chain fork)", function () {
  this.timeout(600_000);
  let deployer: any, admin: any, alice: any, bob: any, carol: any, dave: any, eve: any;
  let hook: any, arena: any, router: any, redeemer: any;
  let FROG: string, PUP: string, CAT: string;
  const coin = (a: string, s: any = dave) => ethers.getContractAt("JeetWarsToken", a, s);

  before(async function () {
    if (process.env.FORK !== "1") this.skip();
    [deployer, admin, alice, bob, carol, dave, eve] = await ethers.getSigners();
    const genesis = await now();
    hook = await (await ethers.getContractFactory("JeetWarsHook", deployer)).deploy(VAULT, CLPM);
    redeemer = await (await ethers.getContractFactory("JeetWarsRedeemer", deployer)).deploy();
    const td = await (await ethers.getContractFactory("JeetWarsTokenDeployer", deployer)).deploy();
    const codehash = ethers.keccak256(await ethers.provider.getCode(NVDAB));
    arena = await (await ethers.getContractFactory("JeetWarsArena", deployer)).deploy({
      owner: deployer.address, admin: admin.address, vault: VAULT, poolManager: CLPM, hook: await hook.getAddress(),
      tokenDeployer: await td.getAddress(), redeemer: await redeemer.getAddress(), genesis, startTick: START_TICK,
      bstockCodehash: codehash, tip: E("0.001"),
    });
    const arenaAddr = await arena.getAddress();
    await hook.setArena(arenaAddr);
    await redeemer.setArena(arenaAddr);
    await td.setArena(arenaAddr);
    router = await (await ethers.getContractFactory("JeetWarsRouter", deployer)).deploy(VAULT, CLPM, arenaAddr, WBNB, SMART_ROUTER);
    await arena.setConverter(await router.getAddress());
    for (let i = 0; i < ARMIES.length; i++) await arena.setArmy(i, ARMIES[i][1], true, ARMIES[i][0]);
    await arena.connect(eve).fundTips({ value: E("0.1") });
  });

  it("accepts only official bStocks as armies", async function () {
    for (const [, a] of ARMIES) expect(ethers.keccak256(await ethers.provider.getCode(a))).to.equal(await arena.bstockCodehash());
    await expect(arena.setArmy(8, USDT, true, "USDT")).to.be.revertedWithCustomError(arena, "NotBStock");
    expect((await arena.armies()).length).to.equal(8);
  });

  it("launches coins with the whole supply in the pool", async function () {
    await expect(arena.connect(alice).launch({ name: "Frog", symbol: "frog", metadataURI: "", army: 2 })).to.be.revertedWithCustomError(arena, "BadTicker");
    await expect(arena.connect(alice).launch({ name: "Frog", symbol: "FROG", metadataURI: "", army: 2 }, { value: E("0.6") })).to.be.revertedWithCustomError(arena, "FirstBuyTooBig");

    await (await arena.connect(alice).launch({ name: "Frog", symbol: "FROG", metadataURI: "ipfs://frog", army: 2 }, { value: E("0.2") })).wait();
    const lr = await (await arena.connect(bob).launch({ name: "Pup", symbol: "PUP", metadataURI: "", army: 0 })).wait();
    console.log("      gas: launch", lr!.gasUsed.toString());
    await (await arena.connect(carol).launch({ name: "Cat", symbol: "CAT", metadataURI: "", army: 1 })).wait();
    [FROG, PUP, CAT] = await arena.roundCoins(0);
    await expect(arena.connect(carol).launch({ name: "Cat 2", symbol: "CAT", metadataURI: "", army: 1 })).to.be.revertedWithCustomError(arena, "TickerTaken");

    const frog = await coin(FROG);
    expect(await frog.totalSupply()).to.be.lte(E("1000000000"));
    const aliceBag = await frog.balanceOf(alice.address);
    expect(aliceBag).to.be.gt(E("30000000")); // ~0.2 of a ~5 BNB cap: several % of supply
    expect(await frog.balanceOf(VAULT)).to.be.gt(E("900000000"));
    expect(await frog.stock()).to.equal(ethers.getAddress(ARMIES[2][1]));
    expect(await arena.liquidityOf(FROG)).to.be.gt(0n);
    expect((await arena.coins(PUP)).round).to.equal(0n);
    await mine(3); // past launch protection
  });

  it("charges 2% of the BNB side on buys and sells, wherever the trade comes from", async function () {
    const pup = await coin(PUP);
    const br = await (await router.connect(dave).buy(PUP, 0, dave.address, { value: E("1") })).wait();
    console.log("      gas: buy", br!.gasUsed.toString());
    const bag = await pup.balanceOf(dave.address);
    expect(bag).to.be.gt(0n);
    const fees1 = (await pup.totalCreatorFees()) + (await pup.totalPlatformFees()) + (await pup.totalHolderRewards());
    expect(fees1).to.equal(E("0.02"));

    await pup.approve(await router.getAddress(), bag / 2n);
    const before = await ethers.provider.getBalance(dave.address);
    const tx = await router.connect(dave).sell(PUP, bag / 2n, 0, dave.address);
    const rc = await tx.wait();
    const got = (await ethers.provider.getBalance(dave.address)) - before + rc!.gasUsed * rc!.gasPrice;
    const fees2 = (await pup.totalCreatorFees()) + (await pup.totalPlatformFees()) + (await pup.totalHolderRewards()) - fees1;
    // fee = 2% of the gross BNB out; dave got the other 98%
    expect(fees2 * 49n).to.be.closeTo(got, got / 1000n);
    expect(await pup.creatorFees()).to.be.gt(0n);
  });

  it("caps buys in the blocks right after a launch", async function () {
    // Fresh coin, then an immediate buy in the next block is capped at 3% of supply.
    await (await arena.connect(eve).launch({ name: "Snipe", symbol: "SNIPE", metadataURI: "", army: 0 })).wait();
    const coins0 = await arena.roundCoins(0);
    const snipe = coins0[coins0.length - 1];
    await expect(router.connect(dave).buy(snipe, 0, dave.address, { value: E("2") })).to.be.reverted; // > 3% cap
    await (await router.connect(dave).buy(snipe, 0, dave.address, { value: E("0.05") })).wait();
  });

  it("scores the 10-minute average and freezes the round at the bell", async function () {
    const bell = Number(await arena.bellOf(0));
    await increase(bell - 9 * 60 - (await now()));
    await (await router.connect(dave).buy(PUP, 0, dave.address, { value: E("3") })).wait();
    await (await router.connect(eve).buy(FROG, 0, eve.address, { value: E("0.3") })).wait();
    await increase(bell - (await now()) + 5);
    await expect(router.connect(eve).buy(FROG, 0, eve.address, { value: E("0.1") })).to.be.reverted; // frozen
    const pupAvg = await hook.windowAverageTick((await arena.coins(PUP)).poolId);
    const frogAvg = await hook.windowAverageTick((await arena.coins(FROG)).poolId);
    expect(pupAvg).to.be.lt(frogAvg); // lower tick = higher price
  });

  it("settles: the winner trades on, losers close and their pools become loot", async function () {
    const tipBefore = await ethers.provider.getBalance(carol.address);
    const rc = await (await arena.connect(carol).settle(0)).wait();
    console.log("      gas: settle (4 coins)", rc!.gasUsed.toString());
    expect(await ethers.provider.getBalance(carol.address)).to.equal(tipBefore + E("0.001") - rc!.gasUsed * rc!.gasPrice);
    const R = await arena.rounds(0);
    expect(R.winner).to.equal(PUP);
    expect(R.loot).to.be.gt(E("0.5"));
    expect(await arena.liquidityOf(FROG)).to.equal(0n);
    expect(await arena.liquidityOf(CAT)).to.equal(0n);
    expect(await arena.lootOf(FROG)).to.be.gt(0n);
    await expect(arena.settle(0)).to.be.revertedWithCustomError(arena, "AlreadySettled");
    await expect(router.connect(eve).buy(FROG, 0, eve.address, { value: E("0.1") })).to.be.reverted; // closed for good
    await (await router.connect(eve).buy(PUP, 0, eve.address, { value: E("0.1") })).wait(); // winner trades
  });

  it("merges in 10 capped hits and pays losers in the winner", async function () {
    const pup = await coin(PUP);
    for (let i = 0; i < 10; i++) {
      const hr = await (await arena.connect(eve).hit(0)).wait();
      if (i === 0) console.log("      gas: merge hit", hr!.gasUsed.toString());
      if (i === 0) await expect(arena.hit(0)).to.be.revertedWithCustomError(arena, "TooEarly");
      if (i < 9) await increase(180);
    }
    const R = await arena.rounds(0);
    expect(R.finalized).to.equal(true);
    expect(R.bought).to.be.gt(0n);
    expect(await pup.balanceOf(await redeemer.getAddress())).to.equal(R.bought);
    await expect(arena.hit(0)).to.be.revertedWithCustomError(arena, "MergeDone");

    const frog = await coin(FROG, alice);
    const bag = await frog.balanceOf(alice.address);
    const [qTokens, qBnb] = await redeemer.quote(FROG, bag);
    expect(qTokens).to.be.gt(0n);
    await frog.approve(await redeemer.getAddress(), bag);
    const pupBefore = await pup.balanceOf(alice.address);
    await (await redeemer.connect(alice).redeem(FROG, bag, alice.address)).wait();
    expect((await pup.balanceOf(alice.address)) - pupBefore).to.equal(qTokens);
    expect(await frog.balanceOf(alice.address)).to.equal(0n);
    void qBnb;
  });

  it("pays holder rewards in BNB and in the army bStock", async function () {
    const pup = await coin(PUP);
    const pending = await pup.pendingRewards(dave.address);
    expect(pending).to.be.gt(0n);
    const nvda = await ethers.getContractAt(ERC20, NVDAB);
    const before = await nvda.balanceOf(dave.address);
    await (await pup.claimRewardsAsStock(NVDA_PATH, 1n)).wait();
    expect(await nvda.balanceOf(dave.address)).to.be.gt(before);
    await (await router.connect(eve).buy(PUP, 0, eve.address, { value: E("0.5") })).wait();
    const bnbBefore = await ethers.provider.getBalance(dave.address);
    const rc = await (await pup.claimRewards()).wait();
    expect((await ethers.provider.getBalance(dave.address)) + rc!.gasUsed * rc!.gasPrice).to.be.gt(bnbBefore);
    await expect(pup.claimRewardsAsStock(ethers.solidityPacked(["address", "uint24", "address"], [WBNB, 500, USDT]), 0n)).to.not.be.reverted; // nothing pending: no-op
  });

  it("pushes creator and platform fees", async function () {
    const pup = await coin(PUP);
    const recipient = await arena.feeRecipient();
    const b = await ethers.provider.getBalance(recipient);
    await (await arena.connect(eve).pushPlatformFees([PUP, FROG])).wait();
    expect(await ethers.provider.getBalance(recipient)).to.be.gt(b);
    const c = await ethers.provider.getBalance(bob.address);
    await (await pup.connect(eve).payCreator()).wait();
    expect(await ethers.provider.getBalance(bob.address)).to.be.gt(c);
  });

  it("admin: pause, hide, metadata, fee recipient — admin only", async function () {
    await expect(arena.connect(eve).pause()).to.be.revertedWithCustomError(arena, "NotAdmin");
    await arena.connect(admin).pause();
    await expect(arena.connect(eve).launch({ name: "Late", symbol: "LATE", metadataURI: "", army: 0 })).to.be.revertedWithCustomError(arena, "LaunchesPaused");
    await arena.connect(admin).resume();
    await arena.connect(admin).setHidden(CAT, true);
    expect(await arena.hidden(CAT)).to.equal(true);
    await arena.connect(admin).setCoinMetadata(FROG, "ipfs://edited");
    expect(await arena.metadataOf(FROG)).to.equal("ipfs://edited");
    await arena.connect(admin).setCoinMetadata(FROG, "");
    expect(await arena.metadataOf(FROG)).to.equal("ipfs://frog");
    await expect(arena.connect(eve).setFeeRecipient(eve.address)).to.be.revertedWithCustomError(arena, "NotAdmin");
    await expect(arena.connect(eve).collect(PUP, 100, eve.address)).to.be.revertedWithCustomError(arena, "NotAdmin");
  });

  it("admin collect works any time; pulling a coin in battle takes it out of its round", async function () {
    // Partial collect on the live winner.
    const liq = await arena.liquidityOf(PUP);
    const b = await ethers.provider.getBalance(admin.address);
    const rc = await (await arena.connect(admin).collect(PUP, 1000, admin.address)).wait();
    expect(await ethers.provider.getBalance(admin.address)).to.be.gt(b - rc!.gasUsed * rc!.gasPrice);
    expect(await arena.liquidityOf(PUP)).to.be.closeTo((liq * 9n) / 10n, liq / 1000n);

    // Round 1: two coins; pull all of one mid-battle.
    await (await arena.connect(alice).launch({ name: "Xray", symbol: "XRAY", metadataURI: "", army: 3 })).wait();
    await (await arena.connect(bob).launch({ name: "Yolo", symbol: "YOLO", metadataURI: "", army: 4 })).wait();
    const [X, Y] = await arena.roundCoins(1);
    await increase(Number(await arena.roundStart(1)) + 20 * 60 - (await now()));
    await (await arena.connect(admin).collect(X, 10_000, admin.address)).wait();
    expect((await arena.coins(X)).pulled).to.equal(true);
    await expect(arena.connect(admin).collect(X, 10_000, admin.address)).to.be.revertedWithCustomError(arena, "NothingToCollect");
    await increase(Number(await arena.bellOf(1)) - (await now()) + 1);
    await (await arena.settle(1)).wait();
    const R = await arena.rounds(1);
    expect(R.winner).to.equal(Y);
    expect(R.finalized).to.equal(true); // nothing to merge
  });

  it("only the Arena can add liquidity to a Jeet Wars pool", async function () {
    const id = (await arena.coins(PUP)).poolId;
    expect(await hook.tradable(id)).to.equal(true);
    const key = await arena.poolKeyOf(PUP);
    const bitmap = await hook.getHooksRegistrationBitmap();
    expect(BigInt(key.parameters) & 0xffffn).to.equal(bitmap);
    const probe = await (await ethers.getContractFactory("JeetWarsLpProbe", eve)).deploy(VAULT, CLPM);
    const plainKey = { currency0: key.currency0, currency1: key.currency1, hooks: key.hooks, poolManager: key.poolManager, fee: key.fee, parameters: key.parameters };
    let data = "";
    try { await probe.addLiquidity.staticCall(plainKey); } catch (e: any) { data = e.data ?? ""; }
    expect(data).to.contain(hook.interface.getError("LiquidityLocked")!.selector.slice(2));
  });
});
