import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time, mine } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Liqio (Equo on HyperEVM) on a fresh local chain with a real Uniswap v4 PoolManager.
 *
 * What this proves on top of the Equo suite:
 *   - liquidity: the hook has none, trading never moves it, and the only function that touches a launch
 *     position is the admin's disclosed collect, as on Equo;
 *   - a coin is an EIP-1167 clone whose implementation can never be initialised, and a launch (clone + pool +
 *     wiring + dev buy) fits HyperEVM's 3M-gas small block;
 *   - the oracle reads HyperCore's price precompile (mocked at 0x…0807): szDecimals scaling, HIP-3 market
 *     indices, the ERC-4626 ratio of a wrapped xStock and a multiplier (SPY at a tenth of the S&P 500);
 *   - launches against HYPE, USDC (through a Uniswap V3-style pool) and a wrapped xStock (through an Algebra
 *     pool) open at the chosen cap, and buys and sells go in and out of HYPE through the same routes;
 *   - the fee engine, cashback and referral, holder rewards, buyback, anti-snipe and max wallet all run on
 *     clone coins exactly as on Equo.
 */

const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ORACLE_PX = "0x0000000000000000000000000000000000000807";
const SUPPLY = 1_000_000_000n * 10n ** 18n;
const SMALL_BLOCK_GAS = 3_000_000n;
const E18 = 10n ** 18n;

// HyperCore markets as the precompile numbers them (mock values, real indices are set at deploy time)
const HYPE_IDX = 159, HYPE_SZ = 2, HYPE_RAW = 776_400n; // $77.64 with 6 - 2 = 4 decimals
const NVDA_IDX = 10_000 * 1 + 0, STOCK_SZ = 1, NVDA_RAW = 18_000_000n; // HIP-3 dex 1 market 0, $180.00 with 5 decimals
const SP500_IDX = 10_000 * 1 + 1, SP500_RAW = 670_000_000n; // $6,700.00
const USDC_USD18 = 10n ** 30n; // $1 per 1e18 base units of a 6-decimal token

const FLAT = { feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n };
const NO_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
const route = (dex: number, pool: string) => ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [[{ dex, pool, key: NO_KEY }]]);

describe("Liqio: clone coins, HyperCore oracle, stock pairs, admin collect (local)", function () {
  this.timeout(600_000);

  async function deployStack() {
    const [admin, creator, trader, feeWallet, referrer, outsider] = await ethers.getSigners();
    const whype = await (await ethers.getContractFactory("WETH9")).deploy();
    const WHYPE = await whype.getAddress();
    const art = JSON.parse(readFileSync(join(__dirname, "../../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"));
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, admin).deploy(admin.address);
    const POOL_MANAGER = await pm.getAddress();

    // HyperCore's price precompile, mocked at its real address
    const coreImpl = await (await ethers.getContractFactory("MockHyperCore")).deploy();
    await network.provider.send("hardhat_setCode", [ORACLE_PX, await ethers.provider.getCode(await coreImpl.getAddress())]);
    const core = await ethers.getContractAt("MockHyperCore", ORACLE_PX);
    await (await core.set(HYPE_IDX, HYPE_RAW)).wait();
    await (await core.set(NVDA_IDX, NVDA_RAW)).wait();
    await (await core.set(SP500_IDX, SP500_RAW)).wait();

    // pair tokens: USDC (6 decimals), two wrapped xStocks (ERC-4626 shares of the xStock)
    const usdc = await (await ethers.getContractFactory("LiqioMockERC20")).deploy("USD Coin", "USDC", 6);
    const USDC = await usdc.getAddress();
    const nvdax = await (await ethers.getContractFactory("LiqioMockERC20")).deploy("NVIDIA xStock", "NVDAx", 18);
    const wnvda = await (await ethers.getContractFactory("MockWrappedXStock")).deploy("Wrapped NVDAx", "wNVDAx", await nvdax.getAddress());
    const WNVDA = await wnvda.getAddress();
    await (await wnvda.setRatio(102n * 10n ** 16n)).wait(); // 1 share = 1.02 NVDAx
    const spyx = await (await ethers.getContractFactory("LiqioMockERC20")).deploy("SPY xStock", "SPYx", 18);
    const wspy = await (await ethers.getContractFactory("MockWrappedXStock")).deploy("Wrapped SPYx", "wSPYx", await spyx.getAddress());
    const WSPY = await wspy.getAddress();

    const oracle = await (await ethers.getContractFactory("LiqioOracle")).deploy(admin.address);
    await (await oracle.setCore(WHYPE, HYPE_IDX, HYPE_SZ, E18, false)).wait();
    await (await oracle.setFixed(USDC, USDC_USD18)).wait();
    await (await oracle.setCore(WNVDA, NVDA_IDX, STOCK_SZ, E18, true)).wait();
    await (await oracle.setCore(WSPY, SP500_IDX, STOCK_SZ, E18 / 10n, true)).wait();

    // the DEX pools the router hops through: WHYPE/USDC like PRJX (V3 callback), WHYPE/wNVDAx like KittenSwap (Algebra callback)
    const poolUsdc = await (await ethers.getContractFactory("MockCpPool")).deploy(WHYPE, USDC, false);
    const poolNvda = await (await ethers.getContractFactory("MockCpPool")).deploy(WHYPE, WNVDA, true);
    const POOL_USDC = await poolUsdc.getAddress(), POOL_NVDA = await poolNvda.getAddress();
    await (await whype.connect(admin).deposit({ value: ethers.parseEther("1000") })).wait();
    await (await whype.transfer(POOL_USDC, ethers.parseEther("500"))).wait();
    await (await usdc.mint(POOL_USDC, 38_820n * 10n ** 6n)).wait(); // 500 HYPE × $77.64
    await (await whype.transfer(POOL_NVDA, ethers.parseEther("500"))).wait();
    await (await wnvda.mint(POOL_NVDA, (38_820n * E18 * 10n) / 1836n)).wait(); // 500 HYPE worth at $183.6 per share

    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("EquoHook");
    const initCode = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [POOL_MANAGER, WHYPE])]);
    const hash = ethers.keccak256(initCode);
    let salt = "", hookAddr = "";
    for (let i = 0n; i < 4_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { salt = s; hookAddr = a; break; }
    }
    await (await c2.deploy(salt, initCode)).wait();
    const hook = await ethers.getContractAt("EquoHook", hookAddr);

    const tokenDeployer = await (await ethers.getContractFactory("LiqioTokenDeployer")).deploy(admin.address);
    const factory = await (await ethers.getContractFactory("LiqioFactory")).deploy(
      admin.address, admin.address, POOL_MANAGER, hookAddr, await tokenDeployer.getAddress(), WHYPE, await oracle.getAddress(), feeWallet.address,
    );
    const FACTORY = await factory.getAddress();
    const router = await (await ethers.getContractFactory("EquoRouter")).deploy(POOL_MANAGER, FACTORY, WHYPE);
    await (await tokenDeployer.setFactory(FACTORY)).wait();
    await (await hook.setFactory(FACTORY)).wait();
    await (await factory.setConverter(await router.getAddress())).wait();
    return { admin, creator, trader, feeWallet, referrer, outsider, whype, WHYPE, usdc, USDC, wnvda, WNVDA, wspy, WSPY, core, oracle, pm, hook, hookAddr, tokenDeployer, factory, FACTORY, router, POOL_USDC, POOL_NVDA };
  }

  async function launch(factory: any, creator: any, genes: any, value: bigint, tag = "A", pair = ethers.ZeroAddress, routeBytes = "0x", capPreset = 0) {
    const p = { name: `Coin ${tag}`, symbol: `C${tag}`, metadataURI: "ipfs://x", pair, minPairOut: 0, capPreset, genes, stages: [] as any[] };
    const rc = await (await factory.connect(creator).launch(p, ethers.id(`salt-${tag}`), routeBytes, "0x", { value })).wait();
    const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Launched");
    return { token: ev!.args.token as string, pairUsd: ev!.args.pairUsdPrice as bigint, gas: rc!.gasUsed as bigint };
  }

  function feeEvent(rc: any, hook: any): { fee: bigint; bps: bigint } {
    const ev = rc.logs.map((l: any) => { try { return hook.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "FeeTaken");
    return ev ? { fee: ev.args.fee as bigint, bps: ev.args.bps as bigint } : { fee: 0n, bps: 0n };
  }

  it("only the admin's disclosed collect touches liquidity (as on Equo); the hook has none; trading never moves it", async () => {
    const { factory, hook, hookAddr, admin, creator, trader, router, pm, whype } = await deployStack();
    const facNames = factory.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
    expect(facNames).to.include("collect");
    for (const n of ["unwindPosition", "removeLiquidity", "withdraw"]) expect(facNames).to.not.include(n);
    expect(factory.interface.fragments.some((f: any) => f.type === "event" && f.name === "Collected")).to.equal(true);
    const hookNames = hook.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
    for (const n of ["collect", "removeLiquidity"]) expect(hookNames).to.not.include(n);
    const perms = await hook.getHookPermissions();
    expect(perms.beforeAddLiquidity).to.equal(false);
    expect(perms.beforeRemoveLiquidity).to.equal(false);
    expect(BigInt(hookAddr) & FLAG_MASK).to.equal(HOOK_FLAGS);

    const { token } = await launch(factory, creator, FLAT, ethers.parseEther("1"));
    const pos = await factory.positionOf(token);
    expect(pos.liquidity).to.be.gt(0n);
    await expect(factory.connect(trader).collect(token, 10_000, trader.address)).to.be.revertedWithCustomError(factory, "NotAdmin");
    await expect(pm.connect(admin).unlock(ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "bytes"], [2, "0x"]))).to.be.reverted;
    await (await router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("2") })).wait();
    expect((await factory.positionOf(token)).liquidity).to.equal(pos.liquidity);

    // the admin's collect pulls the share it names, logs it, and leaves the fee pots alone
    const owedBefore = await hook.creatorOwed(token);
    const coin = await ethers.getContractAt("LiqioToken", token);
    const w0 = await whype.balanceOf(admin.address), c0 = await coin.balanceOf(admin.address);
    await expect(factory.connect(admin).collect(token, 1_000, admin.address)).to.emit(factory, "Collected");
    expect((await factory.positionOf(token)).liquidity).to.equal(pos.liquidity - pos.liquidity / 10n);
    expect((await whype.balanceOf(admin.address)) + (await coin.balanceOf(admin.address))).to.be.gt(w0 + c0);
    expect(await hook.creatorOwed(token)).to.equal(owedBefore);
    await expect(router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("0.1") })).to.emit(hook, "FeeTaken");
  });

  it("launches a clone coin on HYPE inside a small block, implementation sealed, creator paid in HYPE", async () => {
    const { factory, hook, tokenDeployer, creator, trader, outsider, router, WHYPE } = await deployStack();
    const { token, pairUsd, gas } = await launch(factory, creator, FLAT, ethers.parseEther("0.5"));
    console.log(`      launch with dev buy: ${gas} gas (small block ${SMALL_BLOCK_GAS})`);
    expect(gas).to.be.lt(SMALL_BLOCK_GAS);
    const { gas: gasPlain } = await launch(factory, creator, FLAT, 0n, "P");
    console.log(`      launch without dev buy: ${gasPlain} gas`);
    expect(pairUsd).to.equal(7_764n * 10n ** 16n); // $77.64 per HYPE from the precompile
    expect(await factory.capOf(token)).to.equal(3_000n * 10n ** 8n);
    expect(BigInt(token) < BigInt(WHYPE)).to.equal(true); // the coin is currency0

    // the coin is a 45-byte EIP-1167 clone with the whole supply minted once; the implementation cannot be initialised
    expect((await ethers.provider.getCode(token)).length).to.equal(2 + 45 * 2);
    const coin = await ethers.getContractAt("LiqioToken", token);
    expect(await coin.totalSupply()).to.equal(SUPPLY);
    expect(await coin.name()).to.equal("Coin A");
    expect(await tokenDeployer.isCoin(token)).to.equal(true);
    const impl = await ethers.getContractAt("LiqioToken", await tokenDeployer.tokenImpl());
    await expect(impl.initialize("x", "x", "x", 1, creator.address)).to.be.reverted;
    await expect(coin.initialize("x", "x", "x", 1, creator.address)).to.be.reverted;
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n); // dev buy

    // trades pay the fee in WHYPE; the creator is paid in HYPE
    await expect(router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("1") })).to.emit(hook, "FeeTaken");
    const bought = await coin.balanceOf(trader.address);
    await (await coin.connect(trader).approve(await router.getAddress(), bought)).wait();
    await expect(router.connect(trader).sell(token, bought / 2n, "0x", 0, ethers.ZeroAddress)).to.emit(hook, "FeeTaken");
    const owed = await hook.creatorOwed(token);
    expect(owed).to.be.gt(0n);
    const before = await ethers.provider.getBalance(creator.address);
    await (await hook.connect(outsider).payCreator(token)).wait();
    expect((await ethers.provider.getBalance(creator.address)) - before).to.equal(owed);
  });

  it("prices pairs from HyperCore: szDecimals, HIP-3 indices, ERC-4626 ratio, multiplier, and refuses unknown markets", async () => {
    const { oracle, core, admin, WHYPE, USDC, WNVDA, WSPY, wnvda, usdc } = await deployStack();
    expect(await oracle.price(WHYPE)).to.equal(7_764n * 10n ** 16n);
    expect(await oracle.price(USDC)).to.equal(USDC_USD18);
    expect(await oracle.price(WNVDA)).to.equal(1_836n * 10n ** 17n); // $180.00 × 1.02
    expect(await oracle.price(WSPY)).to.equal(670n * E18); // $6,700 × 0.1 × 1.00
    await (await wnvda.setRatio(105n * 10n ** 16n)).wait();
    expect(await oracle.price(WNVDA)).to.equal(189n * E18);
    await (await core.set(HYPE_IDX, 800_000n)).wait();
    expect(await oracle.price(WHYPE)).to.equal(80n * E18);
    expect(await oracle.launchPrice(WHYPE)).to.equal(80n * E18);
    expect(await oracle.settled(WHYPE)).to.equal(true);

    const other = await (await ethers.getContractFactory("LiqioMockERC20")).deploy("X", "X", 18);
    const OTHER = await other.getAddress();
    expect(await oracle.settled(OTHER)).to.equal(false);
    await expect(oracle.price(OTHER)).to.be.revertedWithCustomError(oracle, "NoPrice");
    // a market the precompile does not answer cannot be listed
    await expect(oracle.connect(admin).setCore(OTHER, 20_123, 2, E18, false)).to.be.revertedWithCustomError(oracle, "NoPrice");
    await expect(oracle.connect(admin).setCore(OTHER, HYPE_IDX, 7, E18, false)).to.be.revertedWithCustomError(oracle, "InvalidParams");
    const [, , , , , nonAdmin] = await ethers.getSigners();
    await expect(oracle.connect(nonAdmin).setFixed(OTHER, E18)).to.be.revertedWithCustomError(oracle, "NotAdmin");
    await (await oracle.connect(admin).remove(USDC)).wait();
    await expect(oracle.price(USDC)).to.be.revertedWithCustomError(oracle, "NoPrice");
    expect(await usdc.decimals()).to.equal(6);
  });

  it("launches on USDC through a V3-style pool and trades in and out of HYPE along the same route", async () => {
    const { factory, hook, creator, trader, referrer, router, usdc, USDC, POOL_USDC, admin } = await deployStack();
    await (await factory.connect(admin).setRewardSplit(2_500, 2_500)).wait();
    const r = route(2, POOL_USDC);
    const { token, pairUsd, gas } = await launch(factory, creator, FLAT, ethers.parseEther("0.5"), "U", USDC, r);
    console.log(`      launch on USDC with routed dev buy: ${gas} gas`);
    expect(gas).to.be.lt(SMALL_BLOCK_GAS);
    expect(pairUsd).to.equal(USDC_USD18);
    const coin = await ethers.getContractAt("LiqioToken", token);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n);
    expect(await usdc.balanceOf(await factory.poolManager())).to.be.gt(0n); // the dev buy landed as USDC in the pool
    const key = await factory.poolKeyOf(token);
    expect(key.currency1).to.equal(USDC);

    // a buy with HYPE: router hops HYPE -> USDC, fee taken in USDC, split 60/40 with cashback and referral from the platform part
    const c0 = await hook.creatorOwed(token), p0 = await hook.platformOwed(token); // the dev buy already paid a fee
    const rc = await (await router.connect(trader).buy(token, r, 0, referrer.address, { value: ethers.parseEther("1") })).wait();
    const { fee, bps } = feeEvent(rc, hook);
    expect(bps).to.equal(100n);
    expect(fee).to.be.gt(0n);
    expect(fee).to.be.lt(2n * 10n ** 6n); // about 1% of ~$77 in USDC units
    const creatorPart = (fee * 6_000n) / 10_000n, platformPart = fee - creatorPart;
    expect((await hook.creatorOwed(token)) - c0).to.equal(creatorPart);
    expect((await hook.platformOwed(token)) - p0).to.equal(platformPart - 2n * ((platformPart * 2_500n) / 10_000n));
    expect(await hook.rewardsOwed(trader.address, USDC)).to.equal((platformPart * 2_500n) / 10_000n);
    expect(await hook.rewardsOwed(referrer.address, USDC)).to.equal((platformPart * 2_500n) / 10_000n);
    const bought = await coin.balanceOf(trader.address);
    expect(bought).to.be.gt(0n);

    // claims pay USDC; the creator is paid USDC
    await (await hook.connect(trader).claimRewards([USDC])).wait();
    expect(await usdc.balanceOf(trader.address)).to.equal((platformPart * 2_500n) / 10_000n);
    await (await hook.payCreator(token)).wait();
    expect(await usdc.balanceOf(creator.address)).to.equal(creatorPart + c0);

    // a sell back to HYPE: coin -> USDC in the v4 pool, USDC -> HYPE through the same route reversed
    await (await coin.connect(trader).approve(await router.getAddress(), bought)).wait();
    const before = await ethers.provider.getBalance(trader.address);
    const src = await (await router.connect(trader).sell(token, bought, r, 0, ethers.ZeroAddress)).wait();
    const gasCost = src!.gasUsed * src!.gasPrice;
    expect((await ethers.provider.getBalance(trader.address)) + gasCost).to.be.gt(before);
    expect(await coin.balanceOf(trader.address)).to.equal(0n);
    // and a trade paid directly in the pair asset
    await (await usdc.mint(trader.address, 50n * 10n ** 6n)).wait();
    await (await usdc.connect(trader).approve(await router.getAddress(), 50n * 10n ** 6n)).wait();
    await (await router.connect(trader).buyWithPair(token, 50n * 10n ** 6n, 0, ethers.ZeroAddress)).wait();
    expect(await coin.balanceOf(trader.address)).to.be.gt(0n);
  });

  it("launches on a wrapped xStock through an Algebra pool at the oracle's share price", async () => {
    const { factory, hook, creator, trader, router, wnvda, WNVDA, POOL_NVDA, pm } = await deployStack();
    const r = route(4, POOL_NVDA);
    const { token, pairUsd, gas } = await launch(factory, creator, FLAT, ethers.parseEther("0.5"), "N", WNVDA, r);
    console.log(`      launch on wNVDAx with routed dev buy: ${gas} gas`);
    expect(gas).to.be.lt(SMALL_BLOCK_GAS);
    expect(pairUsd).to.equal(1_836n * 10n ** 17n);
    expect(await factory.capOf(token)).to.equal(3_000n * 10n ** 8n);
    const key = await factory.poolKeyOf(token);
    expect(key.currency1).to.equal(WNVDA);

    // the pool opened at the cap: 1B coins worth $3,000 at $183.6 per wNVDAx is about 16.34 wNVDAx for the supply
    const coin = await ethers.getContractAt("LiqioToken", token);
    const rc = await (await router.connect(trader).buy(token, r, 0, ethers.ZeroAddress, { value: ethers.parseEther("0.1") })).wait();
    const { fee } = feeEvent(rc, hook);
    expect(fee).to.be.gt(0n);
    const got = await coin.balanceOf(trader.address);
    // 0.1 HYPE ≈ $7.76 ≈ 0.0423 wNVDAx; at an opening cap of $3,000 that is about 0.26% of the supply (less slippage and fee)
    expect(got).to.be.gt(SUPPLY / 1000n);
    expect(got).to.be.lt(SUPPLY / 300n);
    expect(await wnvda.balanceOf(await pm.getAddress())).to.be.gt(0n);

    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    await (await router.connect(trader).sellForPair(token, got / 2n, 0, ethers.ZeroAddress)).wait();
    expect(await wnvda.balanceOf(trader.address)).to.be.gt(0n);
    await (await router.connect(trader).sell(token, got / 2n, r, 0, ethers.ZeroAddress)).wait();
    expect(await coin.balanceOf(trader.address)).to.equal(0n);
  });

  it("runs holder rewards and buyback on a clone rewards coin, paid as HYPE on the HYPE pair", async () => {
    const { factory, hook, creator, trader, router, tokenDeployer } = await deployStack();
    const genes = { ...FLAT, buybackShareBps: 2_000, buybackThreshold: 1_000n, divShareBps: 3_000 };
    const { token, gas } = await launch(factory, creator, genes, ethers.parseEther("1"), "D");
    console.log(`      launch of a rewards coin with dev buy: ${gas} gas`);
    expect(gas).to.be.lt(SMALL_BLOCK_GAS);
    const coin = await ethers.getContractAt("LiqioDivToken", token);
    expect((await ethers.provider.getCode(token)).length).to.equal(2 + 45 * 2);
    const impl = await ethers.getContractAt("LiqioDivToken", await tokenDeployer.divTokenImpl());
    await expect(impl.initialize("x", "x", "x", 1, creator.address)).to.be.revertedWithCustomError(impl, "WrongInit");
    const supplyBefore = await coin.totalSupply();

    await expect(router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("1") })).to.emit(hook, "BuybackBurned");
    expect(await coin.totalSupply()).to.be.lt(supplyBefore);
    await (await router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("1") })).wait();
    expect(await hook.dividendPot(token)).to.be.gt(0n);
    await expect(hook.pushDividends(token)).to.emit(hook, "DividendsPushed");
    const owed = await coin.withdrawableDividends(trader.address);
    expect(owed).to.be.gt(0n);
    const before = await ethers.provider.getBalance(trader.address);
    const rc = await (await coin.connect(trader).claimDividends()).wait();
    const gasCost = rc!.gasUsed * rc!.gasPrice;
    expect((await ethers.provider.getBalance(trader.address)) + gasCost - before).to.equal(owed);
    expect(await coin.withdrawableDividends(trader.address)).to.equal(0n);
  });

  it("applies anti-snipe for the first blocks and the max wallet for the first hours", async () => {
    const { factory, hook, creator, trader, outsider, router } = await deployStack();
    const genes = { ...FLAT, snipeBps: 2_000, snipeBlocks: 20, maxWalletBps: 100, maxWalletSecs: 3_600 };
    const { token } = await launch(factory, creator, genes, 0n, "S");
    const coin = await ethers.getContractAt("LiqioToken", token);

    // in the snipe window a buy pays more than the 1% base fee; after the window it pays the base fee
    const rc1 = await (await router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("0.05") })).wait();
    expect(feeEvent(rc1, hook).bps).to.be.gt(100n);
    await mine(25);
    const rc2 = await (await router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("0.05") })).wait();
    expect(feeEvent(rc2, hook).bps).to.equal(100n);

    // 1% of the supply is the cap for the first hour: a buy that would take a wallet past it fails, a smaller one passes
    await expect(router.connect(outsider).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("2") })).to.be.reverted;
    await (await router.connect(outsider).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("0.05") })).wait();
    expect(await coin.balanceOf(outsider.address)).to.be.lt(SUPPLY / 100n);
    await time.increase(3_601);
    await (await router.connect(outsider).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("2") })).wait();
    expect(await coin.balanceOf(outsider.address)).to.be.gt(SUPPLY / 100n);
  });

  it("keeps the Equo admin surface: pause, hidden, blocked pair, presets, fee recipient", async () => {
    const { factory, admin, creator, trader, feeWallet, USDC, POOL_USDC, whype, hook, router } = await deployStack();
    await (await factory.connect(admin).pause()).wait();
    await expect(launch(factory, creator, FLAT, 0n, "X")).to.be.revertedWithCustomError(factory, "LaunchesPaused");
    await (await factory.connect(admin).resume()).wait();
    await (await factory.connect(admin).setTokenBlocked(USDC, true)).wait();
    await expect(launch(factory, creator, FLAT, 0n, "X", USDC, route(2, POOL_USDC))).to.be.revertedWithCustomError(factory, "Blocked");
    await (await factory.connect(admin).setTokenBlocked(USDC, false)).wait();
    await (await factory.connect(admin).setCapPresets([5_000n * 10n ** 8n, 25_000n * 10n ** 8n])).wait();
    const { token } = await launch(factory, creator, FLAT, 0n, "X", ethers.ZeroAddress, "0x", 1);
    expect(await factory.capOf(token)).to.equal(25_000n * 10n ** 8n);
    await expect(factory.connect(trader).pause()).to.be.revertedWithCustomError(factory, "NotAdmin");
    await expect(factory.connect(trader).setCapPresets([1n])).to.be.reverted;

    // platform fees reach the fee recipient in the pair asset (HYPE unwrapped from WHYPE)
    await (await router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("1") })).wait();
    const owed = await hook.platformOwed(token);
    expect(owed).to.be.gt(0n);
    const before = await ethers.provider.getBalance(feeWallet.address);
    await (await factory.pushPlatformFees([token])).wait();
    const after = await ethers.provider.getBalance(feeWallet.address);
    expect(after - before + (await whype.balanceOf(feeWallet.address))).to.equal(owed);
  });
});
