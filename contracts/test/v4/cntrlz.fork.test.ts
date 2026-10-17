import { expect } from "chai";
import { ethers, network } from "hardhat";

// cntrl-z on an Ethereum mainnet fork: the real Uniswap V4 PoolManager, the live Etherhook
// oracle (ETH, gold and the Ondo stocks), WETH and PAXG.
//   FORK=1 ETH_RPC_URL=https://ethereum-rpc.publicnode.com \
//   npx hardhat --config hardhat.config.cntrlz.ts test test/v4/cntrlz.fork.test.ts
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
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function totalSupply() view returns (uint256)"];
const E = ethers.parseEther;
const H6 = 6 * 3600;
let saltN = 1n;
const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(saltN++), 32);
const route = (hops: any[]) => (hops.length ? ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [hops]) : "0x");
const mins = async (m: number) => { await network.provider.send("evm_increaseTime", [Math.round(m * 60)]); await network.provider.send("evm_mine", []); };
const v2Pair = async (a: string, b: string) => (await ethers.getContractAt(["function getPair(address,address) view returns (address)"], UNI_V2_FACTORY)).getPair(a, b);
const bal = (a: string) => ethers.provider.getBalance(a);
const gasOf = async (tx: any) => { const rc = await tx.wait(); return { rc, gas: rc.gasUsed * rc.gasPrice }; };
const fmt = (v: bigint, d = 18) => Number(ethers.formatUnits(v, d));

async function deployAll(admin: any) {
  const deployer = (await ethers.getSigners())[9];
  const c2 = await (await ethers.getContractFactory("HookDeployer", deployer)).deploy();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("CtrlzHook");
  const init = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address"], [POOL_MANAGER, WETH, ORACLE])]);
  const hash = ethers.keccak256(init);
  let hookAddr = "", salt = "";
  for (let i = 0n; i < 3_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
  }
  await (await c2.deploy(salt, init)).wait();
  const hook = await ethers.getContractAt("CtrlzHook", hookAddr, deployer);
  const td = await (await ethers.getContractFactory("CtrlzTokenDeployer", deployer)).deploy();
  const factory = await (await ethers.getContractFactory("CtrlzFactory", deployer)).deploy(deployer.address, admin.address, POOL_MANAGER, hookAddr, await td.getAddress(), WETH, ORACLE, ethers.ZeroAddress);
  const fAddr = await factory.getAddress();
  await (await td.setFactory(fAddr)).wait();
  await (await hook.setFactory(fAddr)).wait();
  const router = await (await ethers.getContractFactory("CtrlzRouter", deployer)).deploy(POOL_MANAGER, fAddr, WETH);
  await (await factory.setConverter(await router.getAddress())).wait();
  return { hook, factory, router, deployer, hookAddr, routerAddr: await router.getAddress() };
}

async function launch(env: any, creator: any, o: { pair?: string; ethIn?: bigint; route?: string } = {}) {
  const n = Number(await env.factory.totalTokens());
  const tx = await env.factory.connect(creator).launch({ name: "Ctrl Z Test", symbol: "CZT", metadataURI: '{"description":"fork test"}', pair: o.pair ?? WETH, minPairOut: 0 }, nextSalt(), o.route ?? "0x", { value: o.ethIn ?? 0n });
  const rc = await tx.wait();
  const token = await env.factory.allTokens(n);
  const coin = await ethers.getContractAt("CtrlzToken", token);
  return { coin, token, gas: rc!.gasUsed };
}

describe("cntrl-z on Ethereum (mainnet fork)", function () {
  this.timeout(1_800_000);
  let env: any;
  let admin: any, creator: any, alice: any, bob: any, carol: any, dave: any;
  let token: string, coin: any;
  const weth = () => ethers.getContractAt(ERC20, WETH);

  before(async () => {
    await network.provider.send("evm_mine", []);
    [admin, creator, alice, bob, carol, dave] = await ethers.getSigners();
    for (const s of [alice, bob, carol, dave, creator, admin]) await network.provider.send("hardhat_setBalance", [s.address, "0x" + E("200").toString(16)]);
    env = await deployAll(admin);
  });

  it("launches a WETH-paired coin; the creator's first buy lands in the launch block", async () => {
    const r = await launch(env, creator, { ethIn: E("0.02") });
    token = r.token; coin = r.coin;
    console.log(`      launch + 0.02 ETH first buy: ${r.gas} gas`);
    expect(BigInt(token) < BigInt(WETH)).to.equal(true);
    expect(await coin.totalSupply()).to.equal(SUPPLY);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0);
    const book = await env.hook.book(token);
    expect(book.length).to.equal(1);
    // the slack plus a few wei of rounding from the seed position
    const slack = await env.hook.COIN_SLACK();
    expect(await coin.balanceOf(env.hookAddr)).to.be.gte(slack);
    expect(await coin.balanceOf(env.hookAddr)).to.be.lt(slack + 10n ** 6n);
  });

  it("anti-snipe: a buy right after launch pays far more than 1%", async () => {
    const owedBefore = await env.hook.creatorOwed(token);
    await (await env.router.connect(alice).buy(token, "0x", 0, { value: E("0.1") })).wait();
    const fee = (await env.hook.creatorOwed(token)) - owedBefore;
    // 0.7% of the tax; at 1% the creator's part would be 0.0007 ETH
    expect(fee).to.be.gt(E("0.01"));
    expect(await coin.balanceOf(alice.address)).to.be.gt(0);
  });

  it("plain buys and sells pay 1%, 0.7% to the creator", async () => {
    await mins(2);
    const owedBefore = await env.hook.creatorOwed(token);
    const platBefore = await env.hook.platformOwed(token);
    await (await env.router.connect(bob).buy(token, "0x", 0, { value: E("0.1") })).wait();
    expect((await env.hook.creatorOwed(token)) - owedBefore).to.equal(E("0.1") * 70n / 10000n);
    expect((await env.hook.platformOwed(token)) - platBefore).to.equal(E("0.1") * 30n / 10000n);
    const got = await coin.balanceOf(bob.address);
    await (await coin.connect(bob).approve(env.routerAddr, got)).wait();
    const before = await bal(bob.address);
    const { gas } = await gasOf(await env.router.connect(bob).sell(token, got, "0x", 0));
    const out = (await bal(bob.address)) - before + gas;
    console.log(`      bob bought 0.1 ETH of coins and sold them back for ${fmt(out).toFixed(5)} ETH`);
    expect(out).to.be.gt(E("0.09"));
    expect(out).to.be.lt(E("0.1"));
  });

  it("window buy: coins and the buy are held by the hook, the premium is 0.05 ETH for 6h", async () => {
    const q = await env.hook.quote(token, E("0.5"), H6, env.routerAddr);
    expect(q.ok).to.equal(true);
    expect(q.premium).to.equal(E("0.05"));
    const coinsBefore = await coin.balanceOf(alice.address);
    const before = await bal(alice.address);
    const { rc, gas } = await gasOf(await env.router.connect(alice).buyWithWindow(token, "0x", H6, 0, { value: E("0.5") }));
    const spent = before - (await bal(alice.address)) - gas;
    const w = await env.hook.windowAt(token, 0);
    console.log(`      window buy 0.5 ETH / 6h: ${rc.gasUsed} gas, cost ${fmt(w.cost).toFixed(5)} ETH, premium ${fmt(w.premium)} ETH, ${fmt(w.coins).toExponential(3)} coins, spent ${fmt(spent).toFixed(5)} ETH`);
    expect(w.owner).to.equal(alice.address);
    expect(w.open).to.equal(true);
    expect(w.premium).to.equal(E("0.05"));
    expect(w.coins).to.be.gt(0);
    expect(w.cost).to.be.gt(E("0.4"));
    expect(spent).to.be.lte(E("0.5"));
    expect(spent).to.be.gt(E("0.45"));
    expect(await coin.balanceOf(alice.address)).to.equal(coinsBefore);
    expect(await env.hook.heldCoins(token)).to.equal(w.coins);
    expect(await env.hook.heldPair(WETH)).to.equal(w.cost + w.premium);
    expect(await coin.balanceOf(env.hookAddr)).to.be.gte(w.coins);
    expect(await (await weth()).balanceOf(env.hookAddr)).to.be.gte(w.cost + w.premium);
    expect(q.coins).to.equal(w.coins);
  });

  it("the window can cost at most 30% of the buy; the length is 30 minutes to 7 days", async () => {
    await expect(env.router.connect(alice).buyWithWindow(token, "0x", H6, 0, { value: E("0.1") })).to.be.revertedWithCustomError(env.hook, "PremiumTooHigh");
    await expect(env.router.connect(alice).buyWithWindow(token, "0x", 600, 0, { value: E("0.5") })).to.be.revertedWithCustomError(env.hook, "BadWindow");
    await expect(env.router.connect(alice).buyWithWindow(token, "0x", 8 * 86400, 0, { value: E("5") })).to.be.revertedWithCustomError(env.hook, "BadWindow");
  });

  it("cancel: only the owner, before expiry; the whole buy comes back as ETH, the coins go back into the pool, the premium is burned", async () => {
    await expect(env.hook.connect(bob).cancel(token, 0)).to.be.revertedWithCustomError(env.hook, "NotOwner");
    const w = await env.hook.windowAt(token, 0);
    const supplyBefore = await coin.totalSupply();
    const booksBefore = (await env.hook.book(token)).length;
    const before = await bal(alice.address);
    const { rc, gas } = await gasOf(await env.hook.connect(alice).cancel(token, 0));
    const back = (await bal(alice.address)) - before + gas;
    console.log(`      cancel: ${rc.gasUsed} gas, ${fmt(back).toFixed(5)} ETH back, ${fmt(supplyBefore - (await coin.totalSupply())).toExponential(3)} coins burned`);
    expect(back).to.equal(w.cost);
    expect(await coin.totalSupply()).to.be.lt(supplyBefore);
    expect(await env.hook.heldCoins(token)).to.equal(0);
    expect(await env.hook.heldPair(WETH)).to.equal(0);
    expect((await env.hook.book(token)).length).to.be.gte(booksBefore);
    expect((await env.hook.windowAt(token, 0)).open).to.equal(false);
    await expect(env.hook.connect(alice).cancel(token, 0)).to.be.revertedWithCustomError(env.hook, "NoWindow");
  });

  it("keep: the coins go to the buyer, the buy goes into the pool as liquidity, the premium is burned; the coins then sell for ETH", async () => {
    const { rc } = await gasOf(await env.router.connect(bob).buyWithWindow(token, "0x", 3600, 0, { value: E("0.3") }));
    const id = 1;
    const w = await env.hook.windowAt(token, id);
    expect(w.owner).to.equal(bob.address);
    expect(w.premium).to.equal(E("0.05") / 6n);
    const supplyBefore = await coin.totalSupply();
    const liqBefore = (await env.hook.book(token)).reduce((s: bigint, x: any) => s + x.liquidity, 0n);
    const { rc: rc2 } = await gasOf(await env.hook.connect(bob).keep(token, id));
    console.log(`      window buy 0.3 ETH / 1h: ${rc.gasUsed} gas; keep: ${rc2.gasUsed} gas`);
    expect(await coin.balanceOf(bob.address)).to.equal(w.coins);
    expect(await coin.totalSupply()).to.be.lt(supplyBefore);
    expect((await env.hook.book(token)).reduce((s: bigint, x: any) => s + x.liquidity, 0n)).to.be.gt(liqBefore);
    expect(await env.hook.heldCoins(token)).to.equal(0);
    await (await coin.connect(bob).approve(env.routerAddr, w.coins)).wait();
    const before = await bal(bob.address);
    const { gas } = await gasOf(await env.router.connect(bob).sell(token, w.coins, "0x", 0));
    const out = (await bal(bob.address)) - before + gas;
    console.log(`      sold the kept coins for ${fmt(out).toFixed(5)} ETH`);
    expect(out).to.be.gt(E("0.2"));
  });

  it("expiry: nobody else can keep before it closes; anyone can after, and the coins go to the owner", async () => {
    await (await env.router.connect(carol).buyWithWindow(token, "0x", 1800, 0, { value: E("0.2") })).wait();
    const id = 2;
    await expect(env.hook.connect(alice).keep(token, id)).to.be.revertedWithCustomError(env.hook, "WindowStillOpen");
    await mins(31);
    await expect(env.hook.connect(carol).cancel(token, id)).to.be.revertedWithCustomError(env.hook, "WindowExpired");
    const w = await env.hook.windowAt(token, id);
    await (await env.hook.connect(alice).keep(token, id)).wait();
    expect(await coin.balanceOf(carol.address)).to.equal(w.coins);
  });

  it("cancel after the price moved past the cut still refunds the whole buy", async () => {
    await (await env.router.connect(dave).buyWithWindow(token, "0x", H6, 0, { value: E("0.4") })).wait();
    const id = 3;
    const w = await env.hook.windowAt(token, id);
    await mins(1);
    await (await env.router.connect(alice).buy(token, "0x", 0, { value: E("1") })).wait();
    const before = await bal(dave.address);
    const { gas } = await gasOf(await env.hook.connect(dave).cancel(token, id));
    expect((await bal(dave.address)) - before + gas).to.equal(w.cost);
    expect(await env.hook.heldCoins(token)).to.equal(0);
  });

  it("the creator and the platform are paid their tax shares", async () => {
    const owed = await env.hook.creatorOwed(token);
    expect(owed).to.be.gt(0);
    // a WETH pair pays out as ETH
    const before = await bal(creator.address);
    await (await env.hook.connect(alice).payCreator(token)).wait();
    expect((await bal(creator.address)) - before).to.equal(owed);
    const plat = await env.hook.platformOwed(token);
    const aBefore = await bal(admin.address);
    await (await env.factory.connect(alice).pushPlatformFees([token])).wait();
    expect((await bal(admin.address)) - aBefore).to.equal(plat);
    console.log(`      creator paid ${fmt(owed).toFixed(5)} ETH, platform ${fmt(plat).toFixed(5)} ETH`);
  });

  it("nobody but the hook can add liquidity or open a pool with the hook", async () => {
    const pm = await ethers.getContractAt(["function initialize((address,address,uint24,int24,address),uint160) returns (int24)"], POOL_MANAGER);
    await expect(pm.connect(alice).initialize([ethers.ZeroAddress, WETH, 0, 10, env.hookAddr], 2n ** 96n)).to.be.reverted;
  });

  it("admin: collect pulls a share of the pool liquidity out; pause and hide work; others can't", async () => {
    const cBefore = await coin.balanceOf(admin.address);
    const pBefore = await (await weth()).balanceOf(admin.address);
    const liqBefore = (await env.hook.book(token)).reduce((s: bigint, x: any) => s + x.liquidity, 0n);
    await expect(env.factory.connect(alice).collect(token, 2500, alice.address)).to.be.revertedWithCustomError(env.factory, "NotAdmin");
    await (await env.factory.connect(admin).collect(token, 2500, admin.address)).wait();
    const coinsGot = (await coin.balanceOf(admin.address)) - cBefore;
    const pairGot = (await (await weth()).balanceOf(admin.address)) - pBefore;
    console.log(`      collect 25%: ${fmt(coinsGot).toExponential(3)} coins + ${fmt(pairGot).toFixed(5)} WETH`);
    expect(coinsGot).to.be.gt(0);
    expect(pairGot).to.be.gt(0);
    const liqAfter = (await env.hook.book(token)).reduce((s: bigint, x: any) => s + x.liquidity, 0n);
    expect(liqAfter * 4n).to.be.closeTo(liqBefore * 3n, liqBefore / 100n);
    await (await env.factory.connect(admin).pause()).wait();
    await expect(launch(env, creator)).to.be.revertedWithCustomError(env.factory, "LaunchesPaused");
    await (await env.factory.connect(admin).resume()).wait();
    await (await env.factory.connect(admin).setHidden(token, true)).wait();
    expect(await env.factory.hidden(token)).to.equal(true);
    await expect(env.factory.connect(alice).pause()).to.be.revertedWithCustomError(env.factory, "NotAdmin");
    // trading still works after a collect
    await (await env.router.connect(alice).buy(token, "0x", 0, { value: E("0.05") })).wait();
  });

  it("a coin paired with tokenized gold (PAXG): windows are priced in PAXG at the oracle's rate, refunds come back in PAXG", async () => {
    const pair = await v2Pair(PAXG, WETH);
    const rt = route([{ dex: V2, pool: pair, key: EMPTY_KEY }]);
    const r = await launch(env, creator, { pair: PAXG, route: rt, ethIn: E("0.01") });
    console.log(`      PAXG launch + 0.01 ETH first buy: ${r.gas} gas`);
    const gold = await ethers.getContractAt(ERC20, PAXG);
    expect(await r.coin.balanceOf(creator.address)).to.be.gt(0);
    const prem = await env.hook.premiumFor(r.token, H6);
    console.log(`      6h window on the PAXG coin costs ${fmt(prem).toFixed(6)} PAXG`);
    expect(prem).to.be.gt(0);
    expect(prem).to.be.lt(E("0.1"));
    await mins(2);
    await (await env.router.connect(alice).buyWithWindow(r.token, rt, H6, 0, { value: E("0.5") })).wait();
    const w = await env.hook.windowAt(r.token, 0);
    // the router refreshes the oracle's PAXG price on the way in, so the premium moves a hair
    expect(w.premium).to.be.closeTo(prem, prem / 100n);
    expect(await env.hook.heldPair(PAXG)).to.equal(w.cost + w.premium);
    const gBefore = await gold.balanceOf(alice.address);
    await (await env.hook.connect(alice).cancel(r.token, 0)).wait();
    expect((await gold.balanceOf(alice.address)) - gBefore).to.equal(w.cost);
    // and the router can turn that PAXG back into ETH
    await (await gold.connect(alice).approve(env.routerAddr, w.cost)).wait();
    const before = await bal(alice.address);
    const { gas } = await gasOf(await env.router.connect(alice).pairToEth(PAXG, w.cost, alice.address, 0, rt));
    const out = (await bal(alice.address)) - before + gas;
    console.log(`      refund ${fmt(w.cost).toFixed(6)} PAXG -> ${fmt(out).toFixed(5)} ETH`);
    expect(out).to.be.gt(E("0.35"));
  });
});
