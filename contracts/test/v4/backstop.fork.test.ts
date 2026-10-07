import { expect } from "chai";
import { ethers, network } from "hardhat";

// Backstop on an Ethereum mainnet fork: the real Uniswap V4 PoolManager, Uniswap
// V2 and V3 pools, Chainlink ETH/USD and USDC/USD, and real backing tokens.
//   FORK=1 ETH_RPC_URL=https://ethereum-rpc.publicnode.com \
//   npx hardhat --config hardhat.config.backstop.ts test test/v4/backstop.fork.test.ts
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const UNI_V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const UNI_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const USDC_USD_FEED = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const PEPE = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";
const NEIRO = "0x812Ba41e071C7b7fA4EBcFB62dF5F45f6fA853Ee";
const WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const WBTC_WETH_V3 = "0xCBCdF9626bC03E24f779434178A73a0B4bad62eD";
const V2 = 1, V3 = 2;
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const SUPPLY = 10n ** 27n;
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function deposit() payable"];
const E = ethers.parseEther;
let saltN = 1n;
const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(saltN++), 32);
const v2Pair = async (a: string, b: string) => (await ethers.getContractAt(["function getPair(address,address) view returns (address)"], UNI_V2_FACTORY)).getPair(a, b);
const route = (hops: any[]) => (hops.length ? ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [hops]) : "0x");
const mins = async (m: number) => { await network.provider.send("evm_increaseTime", [Math.round(m * 60)]); await network.provider.send("evm_mine", []); };

async function deployAll(admin: any) {
  const deployer = (await ethers.getSigners())[9];
  const c2 = await (await ethers.getContractFactory("HookDeployer", deployer)).deploy();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("BackstopHook");
  const init = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address"], [POOL_MANAGER])]);
  const hash = ethers.keccak256(init);
  let hookAddr = "", salt = "";
  for (let i = 0n; i < 3_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
  }
  await (await c2.deploy(salt, init)).wait();
  const hook = await ethers.getContractAt("BackstopHook", hookAddr, deployer);
  const oracle = await (await ethers.getContractFactory("BackstopOracle", deployer)).deploy({
    admin: admin.address, weth: WETH, poolManager: POOL_MANAGER, uniV2Factory: UNI_V2_FACTORY, uniV3Factory: UNI_V3_FACTORY,
    ethUsdFeed: ETH_USD_FEED, ethUsd8: 2_700n * 10n ** 8n, usdc: USDC, usdcUsdFeed: USDC_USD_FEED,
  });
  const td = await (await ethers.getContractFactory("BackstopTokenDeployer", deployer)).deploy();
  const sd = await (await ethers.getContractFactory("BackstopStrategyDeployer", deployer)).deploy();
  const factory = await (await ethers.getContractFactory("BackstopFactory", deployer)).deploy(
    deployer.address, admin.address, POOL_MANAGER, hookAddr, await td.getAddress(), await sd.getAddress(), WETH, await oracle.getAddress(), ethers.ZeroAddress,
  );
  const fAddr = await factory.getAddress();
  await (await td.setFactory(fAddr)).wait();
  await (await sd.setFactory(fAddr)).wait();
  await (await hook.setFactory(fAddr)).wait();
  const router = await (await ethers.getContractFactory("BackstopRouter", deployer)).deploy(POOL_MANAGER, fAddr, WETH);
  await (await factory.setConverter(await router.getAddress())).wait();
  return { hook, oracle, factory, router, deployer };
}

type Opts = {
  pair?: string; ethIn?: bigint; sources?: any[]; route?: string; tax?: number;
  split?: Partial<{ creator: number; holders: number; vault: number; buyback: number; lp: number; burn: number }>;
  rules?: Partial<{ dynMaxBps: number; snipeBps: number; snipeSecs: number; maxTxBps: number; mev: boolean }>;
  options?: Partial<{ tpBps: number; redeemable: boolean; vestSecs: number; payout: number }>; basket?: string[];
};
async function launch(env: any, creator: any, o: Opts = {}) {
  const tax = o.tax ?? 500;
  const split = { creator: 60, holders: 40, vault: 120, buyback: 100, lp: 50, burn: 30, ...o.split };
  const rules = { taxBps: tax, dynMaxBps: 0, snipeBps: 0, snipeSecs: 0, maxTxBps: 0, mev: false, ...o.rules };
  const options = { tpBps: 0, redeemable: true, vestSecs: 0, payout: 0, ...o.options };
  const n = Number(await env.factory.totalTokens());
  const tx = await env.factory.connect(creator).launch(
    { name: "Backstop Test", symbol: "BSTEST", metadataURI: '{"description":"fork test"}', pair: o.pair ?? WETH, minPairOut: 0, rules, split, options, basket: o.basket ?? [], sources: o.sources ?? [] },
    nextSalt(), o.route ?? "0x", { value: o.ethIn ?? 0n },
  );
  const rc = await tx.wait();
  const token = await env.factory.allTokens(n);
  const coin = await ethers.getContractAt("BackstopToken", token);
  const strategy = await ethers.getContractAt("BackstopStrategy", await env.factory.strategyOf(token));
  return { coin, strategy, token, gas: rc!.gasUsed };
}
let forkBlock = 0;
const burnedOf = async (strategy: any, kind: number) => {
  const logs = await strategy.queryFilter(strategy.filters.Burned(kind), forkBlock);
  return logs.reduce((s: bigint, l: any) => s + l.args.coinsBurned, 0n);
};

describe("Backstop on Ethereum (mainnet fork)", function () {
  this.timeout(1_800_000);
  let env: any;
  let admin: any, creator: any, alice: any, bob: any, carol: any, whale: any;

  before(async () => {
    await network.provider.send("evm_mine", []);
    forkBlock = await ethers.provider.getBlockNumber();
    [admin, creator, alice, bob, carol, whale] = await ethers.getSigners();
    for (const s of [alice, bob, carol, creator]) await network.provider.send("hardhat_setBalance", [s.address, "0x" + E("200").toString(16)]);
    await network.provider.send("hardhat_setBalance", [whale.address, "0x" + E("20000").toString(16)]);
    env = await deployAll(admin);
  });

  it("prices backing tokens from Chainlink, Uniswap V2 and Uniswap V3", async () => {
    const { oracle } = env;
    await (await oracle.register({ dex: V2, pool: await v2Pair(PEPE, WETH), key: EMPTY_KEY })).wait();
    await (await oracle.register({ dex: V2, pool: await v2Pair(NEIRO, WETH), key: EMPTY_KEY })).wait();
    await (await oracle.register({ dex: V3, pool: WBTC_WETH_V3, key: EMPTY_KEY })).wait();
    const whole = async (t: string, dec: number) => Number(((await oracle.price(t)) * 10n ** BigInt(dec)) / 10n ** 18n) / 1e18;
    const px = { ETH: await whole(WETH, 18), USDC: await whole(USDC, 6), WBTC: await whole(WBTC, 8), PEPE: await whole(PEPE, 18), NEIRO: await whole(NEIRO, 9) };
    console.log("      USD:", Object.entries(px).map(([k, v]) => `${k} ${v < 1 ? v.toPrecision(4) : v.toFixed(2)}`).join(" | "));
    expect(px.ETH).to.be.within(500, 20_000);
    expect(px.USDC).to.be.closeTo(1, 0.02);
    expect(px.WBTC).to.be.within(10_000, 500_000);
    expect(px.PEPE).to.be.gt(0);
    expect(px.NEIRO).to.be.gt(0);
    expect(await oracle.settled(PEPE)).to.equal(false); // V2: spot until a 30-minute snapshot exists
  });

  it("launches a WETH-backed coin with every strategy and protection; the creator's first buy lands in the launch block", async () => {
    const r = await launch(env, creator, {
      ethIn: E("0.05"),
      rules: { dynMaxBps: 800, snipeBps: 9000, snipeSecs: 60, mev: true },
      options: { tpBps: 5000, redeemable: true, vestSecs: 30 * 86400 },
    });
    console.log(`      launch + 0.05 ETH first buy: ${r.gas} gas`);
    expect(await r.coin.totalSupply()).to.equal(SUPPLY);
    expect(await r.coin.owner()).to.equal(ethers.ZeroAddress);
    expect(await r.coin.strategy()).to.equal(await r.strategy.getAddress());
    expect(await r.coin.balanceOf(creator.address)).to.be.gt(0);
    expect(await r.strategy.taxBps()).to.equal(500);
    env.main = r;
  });

  it("anti-snipe: buys pay up to 90% at open, falling to the coin's tax over 60 seconds", async () => {
    const { hook, router } = env; const { token } = env.main;
    const id = await hook.poolOf(token);
    const r = await router.getAddress();
    const early = Number(await hook.taxBpsFor(id, r, true, E("0.001")));
    const sellEarly = Number(await hook.taxBpsFor(id, r, false, E("0.001")));
    expect(early).to.be.gt(7000);
    expect(sellEarly).to.be.within(500, 520); // sells never pay the snipe tax (only the small dynamic part)
    await mins(1.1);
    const after = Number(await hook.taxBpsFor(id, r, true, E("0.001")));
    console.log(`      buy tax at open ${early} bps, after the window ${after} bps (dynamic part included)`);
    expect(after).to.be.within(500, 520);
  });

  it("splits the tax: 1% of the trade to the platform, the rest by the creator's split; holders earn", async () => {
    const { router } = env; const { coin, strategy, token } = env.main;
    const before = { plat: await strategy.platformOwed(), vault: await strategy.vault() };
    const rc = await (await router.connect(alice).buy(token, "0x", 0, { value: E("1") })).wait();
    console.log(`      router buy (1 ETH) incl. strategy run: ${rc!.gasUsed} gas`);
    const plat = (await strategy.platformOwed()) - before.plat;
    expect(Number(plat) / 1e18).to.be.closeTo(0.01, 0.0015); // 1% of 1 ETH (dynamic tax may lift it slightly)
    await (await router.connect(bob).buy(token, "0x", 0, { value: E("0.5") })).wait();
    const bal = await coin.balanceOf(alice.address);
    await (await coin.connect(alice).approve(await router.getAddress(), bal / 4n)).wait();
    const rs = await (await router.connect(alice).sell(token, bal / 4n, "0x", 0)).wait();
    console.log(`      router sell incl. strategy run: ${rs!.gasUsed} gas`);
    expect(await strategy.vault()).to.be.gt(before.vault);
    expect(await coin.totalHolderRewards()).to.be.gt(0);
    expect(await coin.pendingRewards(alice.address)).to.be.gt(0);
    const w = await ethers.getContractAt(ERC20, WETH);
    const pre = await w.balanceOf(alice.address);
    await (await coin.connect(alice).claimRewards()).wait();
    expect(await w.balanceOf(alice.address)).to.be.gt(pre);
  });

  it("dynamic tax: a trade big enough to move the price ~5% pays up to the 8% cap", async () => {
    const { hook, router } = env; const { token } = env.main;
    const id = await hook.poolOf(token);
    const small = Number(await hook.taxBpsFor(id, await router.getAddress(), true, E("0.0001")));
    const big = Number(await hook.taxBpsFor(id, await router.getAddress(), true, E("50")));
    console.log(`      tax on 0.0001 ETH: ${small} bps, on 50 ETH: ${big} bps`);
    expect(small).to.be.within(500, 505);
    expect(big).to.equal(800);
  });

  it("max per trade: a buy of more than 1% of the supply reverts, a smaller one goes through", async () => {
    const { router, hook } = env;
    const r = await launch(env, creator, { rules: { maxTxBps: 100 } });
    await mins(0.2);
    await expect(router.connect(carol).buy(r.token, "0x", 0, { value: E("1") })).to.be.reverted;
    await (await router.connect(carol).buy(r.token, "0x", 0, { value: E("0.003") })).wait();
    expect(await r.coin.balanceOf(carol.address)).to.be.lte(SUPPLY / 100n);
  });

  it("anti-MEV: a second swap by the same wallet in the same block reverts", async () => {
    const { router } = env; const { token } = env.main;
    const helper = await (await ethers.getContractFactory("BackstopTestHelper", carol)).deploy(POOL_MANAGER);
    await expect(helper.connect(carol).doubleBuy(await router.getAddress(), token, { value: E("0.02") })).to.be.reverted;
    await (await router.connect(carol).buy(token, "0x", 0, { value: E("0.01") })).wait(); // one per block is fine
  });

  it("one pool only: the coin can't go into another Uniswap V2 pair or another V4 pool (the mmETH case)", async () => {
    const { router } = env; const { coin, token } = env.main;
    await (await router.connect(bob).buy(token, "0x", 0, { value: E("0.2") })).wait();
    // Uniswap V2 pair
    const v2f = await ethers.getContractAt(["function createPair(address,address) returns (address)", "function getPair(address,address) view returns (address)"], UNI_V2_FACTORY);
    await (await v2f.connect(bob).createPair(token, WETH)).wait();
    const pair = await v2f.getPair(token, WETH);
    await expect(coin.connect(bob).transfer(pair, 1000n)).to.be.revertedWithCustomError(coin, "OtherPool");
    // a second, hookless V4 pool
    const helper = await (await ethers.getContractFactory("BackstopTestHelper", bob)).deploy(POOL_MANAGER);
    const h = await helper.getAddress();
    await (await coin.connect(bob).transfer(h, (await coin.balanceOf(bob.address)) / 2n)).wait(); // plain transfers still work
    const w = await ethers.getContractAt(ERC20, WETH);
    await (await w.connect(bob).deposit({ value: E("1") })).wait();
    await (await w.connect(bob).transfer(h, E("1"))).wait();
    await expect(helper.foreignPool(token, WETH, 2n ** 96n, 10n ** 12n)).to.be.reverted;
    // normal trading is untouched
    await (await router.connect(carol).buy(token, "0x", 0, { value: E("0.01") })).wait();
  });

  it("redeem: burning coins pays vault x amount / supply", async () => {
    const { strategy, coin } = env.main;
    const amt = (await coin.balanceOf(alice.address)) / 3n;
    const vault = await strategy.vault();
    const supply = await coin.totalSupply();
    const w = await ethers.getContractAt(ERC20, WETH);
    const pre = await w.balanceOf(alice.address);
    await (await coin.connect(alice).approve(await strategy.getAddress(), amt)).wait();
    await (await strategy.connect(alice).redeem(amt, 0, alice.address)).wait();
    const got = (await w.balanceOf(alice.address)) - pre;
    expect(got).to.be.closeTo((vault * amt) / supply, (vault * amt) / supply / 1000n + 10n);
    expect(await coin.totalSupply()).to.equal(supply - amt);
  });

  it("auto-burn and auto-LP run after trades; auto-LP liquidity is added to the pool", async () => {
    const { router, factory } = env; const { strategy, token } = env.main;
    await (await factory.connect(admin).setLpThreshold(E("50"))).wait();
    for (let i = 0; i < 4; i++) { await (await router.connect([alice, bob, carol, creator][i]).buy(token, "0x", 0, { value: E("0.3") })).wait(); }
    await (await strategy.execute()).wait();
    expect(await burnedOf(strategy, 1)).to.be.gt(0);
    expect(await strategy.totalLpAdded()).to.be.gt(0);
    console.log(`      burned by auto-burn: ${ethers.formatEther(await burnedOf(strategy, 1))} coins, LP added: ${ethers.formatEther(await strategy.totalLpAdded())} WETH`);
  });

  it("creator share vests over 30 days", async () => {
    const { strategy } = env.main;
    const w = await ethers.getContractAt(ERC20, WETH);
    const pre = await w.balanceOf(creator.address);
    await (await strategy.payCreator()).wait();
    const early = (await w.balanceOf(creator.address)) - pre;
    const earned = await strategy.creatorEarned();
    expect(early).to.be.lt(earned / 10n); // a few minutes into 30 days
    await mins(31 * 24 * 60);
    await (await strategy.payCreator()).wait();
    expect(await strategy.creatorClaimed()).to.equal(await strategy.creatorEarned());
  });

  it("dip buyback: a 20% fall in the 30-minute average spends half the fund and burns", async () => {
    const { router } = env;
    const r = await launch(env, creator, { split: { creator: 50, holders: 0, vault: 0, buyback: 350, lp: 0, burn: 0 }, options: { redeemable: false } });
    const traders = [alice, bob, carol, whale];
    for (let i = 0; i < 8; i++) await (await router.connect(traders[i % 4]).buy(r.token, "0x", 0, { value: E("0.5") })).wait();
    await mins(35);
    await (await r.strategy.execute()).wait(); // sets the high
    expect(await r.strategy.highSet()).to.equal(true);
    for (const t of traders) {
      const bal = await r.coin.balanceOf(t.address);
      await (await r.coin.connect(t).approve(await router.getAddress(), bal)).wait();
      await (await router.connect(t).sell(r.token, (bal * 9n) / 10n, "0x", 0)).wait();
    }
    const fundBefore = await r.strategy.fund();
    await mins(36);
    await (await r.strategy.execute()).wait();
    const dip = await burnedOf(r.strategy, 2);
    console.log(`      dip buyback burned ${ethers.formatEther(dip)} coins; fund ${ethers.formatEther(fundBefore)} -> ${ethers.formatEther(await r.strategy.fund())} WETH`);
    expect(dip).to.be.gt(0);
    expect(await r.strategy.fund()).to.be.lt(fundBefore);
  });

  it("PEPE-backed coin: launch with an ETH first buy along a V2 route, trade in ETH, and take profit when PEPE rallies", async () => {
    const { router, oracle } = env;
    const pepePair = await v2Pair(PEPE, WETH);
    const hop = { dex: V2, pool: pepePair, key: EMPTY_KEY };
    const r = await launch(env, creator, {
      pair: PEPE, ethIn: E("0.05"), route: route([hop]),
      split: { creator: 50, holders: 0, vault: 300, buyback: 0, lp: 0, burn: 50 }, options: { tpBps: 2500, redeemable: true },
    });
    const rt = route([hop]);
    for (const t of [alice, bob, carol]) await (await router.connect(t).buy(r.token, rt, 0, { value: E("1") })).wait();
    const bal = await r.coin.balanceOf(alice.address);
    await (await r.coin.connect(alice).approve(await router.getAddress(), bal)).wait();
    await (await router.connect(alice).sell(r.token, bal / 2n, rt, 0)).wait();
    await (await r.strategy.execute()).wait();
    expect(await r.strategy.vault()).to.be.gt(0);
    expect(await r.strategy.costUsd()).to.be.gt(0);
    console.log(`      PEPE in USD per 1e18: ${await oracle.price(PEPE)} before the pump`);
    // PEPE rallies: a whale buys 1,500 ETH of PEPE on Uniswap V2
    // swap straight through the PEPE/WETH pair: send WETH in, take PEPE out (x*y=k with the 0.3% fee)
    const pp = await ethers.getContractAt(["function getReserves() view returns (uint112,uint112,uint32)", "function swap(uint256,uint256,address,bytes)"], pepePair);
    const [rPepe, rWeth] = await pp.getReserves(); // PEPE is token0
    const inW = E("1500");
    const w = await ethers.getContractAt(ERC20, WETH);
    await (await w.connect(whale).deposit({ value: inW })).wait();
    await (await w.connect(whale).transfer(pepePair, inW)).wait();
    const out = (inW * 997n * rPepe) / (rWeth * 1000n + inW * 997n);
    await (await pp.connect(whale).swap(out, 0, whale.address, "0x")).wait();
    console.log(`      PEPE in USD per 1e18: ${await oracle.price(PEPE)} right after the pump (spot until a snapshot settles)`);
    await mins(31);
    await (await oracle.poke(PEPE)).wait();
    console.log(`      PEPE in USD per 1e18: ${await oracle.price(PEPE)} 31 minutes later (30-minute average)`);
    expect(await oracle.settled(PEPE)).to.equal(true);
    const px = await oracle.price(PEPE); const vault = await r.strategy.vault(); const cost = await r.strategy.costUsd();
    console.log(`      vault ${ethers.formatEther(vault)} PEPE, worth $${ethers.formatEther((vault * px) / 10n ** 18n)}, cost $${ethers.formatEther(cost)}, uncosted ${await r.strategy.vaultUncosted()}`);
    await (await r.strategy.execute()).wait();
    const tp = await burnedOf(r.strategy, 3);
    console.log(`      take-profit burned ${ethers.formatEther(tp)} coins`);
    expect(tp).to.be.gt(0);
  });

  it("NEIRO-backed coin: route through the NEIRO/WETH V2 pair both ways", async () => {
    const { router } = env;
    const hop = { dex: V2, pool: await v2Pair(NEIRO, WETH), key: EMPTY_KEY };
    const r = await launch(env, creator, { pair: NEIRO, sources: [hop], ethIn: E("0.02"), route: route([hop]) });
    await (await router.connect(bob).buy(r.token, route([hop]), 0, { value: E("0.3") })).wait();
    const bal = await r.coin.balanceOf(bob.address);
    await (await r.coin.connect(bob).approve(await router.getAddress(), bal)).wait();
    const pre = await ethers.provider.getBalance(bob.address);
    await (await router.connect(bob).sell(r.token, bal, route([hop]), 0)).wait();
    expect(await ethers.provider.getBalance(bob.address)).to.be.gt(pre - E("0.01"));
  });

  it("refuses bad launches: tax out of range, split not adding up, take profit without a vault", async () => {
    await expect(launch(env, creator, { tax: 1100 })).to.be.reverted;
    await expect(launch(env, creator, { tax: 500, split: { creator: 100 } })).to.be.reverted;
    await expect(launch(env, creator, { split: { creator: 160, vault: 0, buyback: 140 }, options: { tpBps: 2500, redeemable: false } })).to.be.reverted;
  });

  it("admin: pause, hide, metadata, block a token, start cap, platform fees, collect, renounce; others are refused", async () => {
    const { factory } = env; const { token } = env.main;
    await expect(factory.connect(alice).pause()).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(admin).pause()).wait();
    await expect(launch(env, creator)).to.be.revertedWithCustomError(factory, "LaunchesPaused");
    await (await factory.connect(admin).resume()).wait();
    await (await factory.connect(admin).setHidden(token, true)).wait();
    expect(await factory.hidden(token)).to.equal(true);
    await (await factory.connect(admin).setCoinMetadata(token, '{"description":"edited"}')).wait();
    expect(await factory.metadataOf(token)).to.contain("edited");
    await (await factory.connect(admin).setTokenBlocked(PEPE, true)).wait();
    await expect(launch(env, creator, { pair: PEPE })).to.be.revertedWithCustomError(factory, "Blocked");
    await (await factory.connect(admin).setTokenBlocked(PEPE, false)).wait();
    await (await factory.connect(admin).setStartCap(10_000n * 10n ** 8n)).wait();
    expect(await factory.startCapUsd8()).to.equal(10_000n * 10n ** 8n);
    const w = await ethers.getContractAt(ERC20, WETH);
    const pre = await w.balanceOf(admin.address);
    await (await factory.connect(carol).pushPlatformFees([token])).wait(); // anyone can push; it only goes to the fee recipient
    expect(await w.balanceOf(admin.address)).to.be.gt(pre);
    const coin = env.main.coin;
    const cPre = await coin.balanceOf(admin.address);
    await (await factory.connect(admin).collect(token, 100, admin.address)).wait();
    expect(await coin.balanceOf(admin.address)).to.be.gt(cPre);
    await expect(factory.connect(alice).renounceOwnership()).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(env.deployer).renounceOwnership()).wait();
    expect(await factory.owner()).to.equal(ethers.ZeroAddress);
  });
});
