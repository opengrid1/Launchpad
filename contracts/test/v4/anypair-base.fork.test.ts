import { expect } from "chai";
import { ethers, network } from "hardhat";

// Anypair on a Base mainnet fork: real Uniswap V4 PoolManager, Uniswap V3,
// PancakeSwap V3, Aerodrome Slipstream and Aerodrome volatile pools, Chainlink
// ETH/USD and USDC/USD, and tokens that trade on each of them.
//   FORK=1 FORK_HARDFORK=cancun ROBINHOOD_RPC_URL=https://mainnet.base.org ROBINHOOD_CHAIN_ID=8453 \
//   BLOCK_GAS_LIMIT=60000000 HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat test test/v4/anypair-base.fork.test.ts
const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b";
const UNI_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
const SLIPSTREAM_FACTORY = "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A";
const SLIPSTREAM_FACTORY2 = "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a";
const AERO_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";
const ETH_USD_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const USDC_USD_FEED = "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // 6 dp, listed (Chainlink)
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"; // 8 dp
const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";
const CAKE = "0x3055913c90Fcc1A6CE9a358911721eEb942013A1";
const DEGEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
const BLOOB = "0x960fc5E59BC6055c825846cF2c41A124209b321b"; // trades only in a native-ETH Uniswap V4 pool
const UNI = 1, PANCAKE = 2, SLIP = 3, AEROV2 = 4, V4 = 5;
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const BLOOB_KEY = { currency0: ethers.ZeroAddress, currency1: BLOOB, fee: 30000, tickSpacing: 200, hooks: ethers.ZeroAddress };
// One pool per token on the DEX it is tested on (WETH side), scanned from Base.
const SRC: Record<string, { dex: number; pool: string; key: typeof EMPTY_KEY }> = {
  [CBBTC]: { dex: UNI, pool: "0x7AeA2E8A3843516afa07293a10Ac8E49906dabD1", key: EMPTY_KEY },
  [AERO]: { dex: AEROV2, pool: "0x7f670f78B17dEC44d5Ef68a48740b6f8849cc2e6", key: EMPTY_KEY },
  [BRETT]: { dex: SLIP, pool: "0x4e829F8A5213c42535AB84AA40BD4aDCCE9cBa02", key: EMPTY_KEY },
  [CAKE]: { dex: PANCAKE, pool: "0x03C33a2fC0D444a5B61E573f9e1A285357a694fc", key: EMPTY_KEY },
  [DEGEN]: { dex: UNI, pool: "0x0cA6485b7e9cF814A3Fd09d81672B07323535b64", key: EMPTY_KEY },
  [BLOOB]: { dex: V4, pool: ethers.ZeroAddress, key: BLOOB_KEY },
};
const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
const NO_ROUTE = "0x";
const ETH_USD_8 = 2_700n * 10n ** 8n; // fallback only; the feed prices ETH
const SUPPLY = 10n ** 27n;
const TAX_BPS = 200n, CREATOR_BPS = 3500n, HOLDER_BPS = 2500n;
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function decimals() view returns (uint8)"];
let saltN = 1n;
const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(saltN++), 32);

let usdcPool = "";
async function hopFor(token: string) {
  if (token === USDC) {
    if (!usdcPool) usdcPool = await (await ethers.getContractAt(["function getPool(address,address,uint24) view returns (address)"], UNI_V3_FACTORY)).getPool(USDC, WETH, 500);
    return { dex: UNI, pool: usdcPool, key: EMPTY_KEY };
  }
  return SRC[token];
}
const routeFor = async (token: string) => { const h = token === WETH ? undefined : await hopFor(token); return h ? ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [[h]]) : NO_ROUTE; };
const sourcesFor = (tokens: string[]) => tokens.filter((t) => SRC[t]).map((t) => SRC[t]);

async function deployAll(admin: any) {
  const deployer = (await ethers.getSigners())[9];
  const c2 = await (await ethers.getContractFactory("HookDeployer", deployer)).deploy();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("AnypairHook");
  const init = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address"], [POOL_MANAGER])]);
  const hash = ethers.keccak256(init);
  let hookAddr = "", salt = "";
  for (let i = 0n; i < 3_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
  }
  await (await c2.deploy(salt, init)).wait();
  const hook = await ethers.getContractAt("AnypairHook", hookAddr, deployer);
  const oracle = await (await ethers.getContractFactory("AnypairOracle", deployer)).deploy({
    admin: admin.address, weth: WETH, poolManager: POOL_MANAGER, uniV3Factory: UNI_V3_FACTORY, pancakeV3Factory: PANCAKE_V3_FACTORY,
    slipstreamFactory: SLIPSTREAM_FACTORY, slipstreamFactory2: SLIPSTREAM_FACTORY2, aeroFactory: AERO_FACTORY, ethUsdFeed: ETH_USD_FEED, ethUsd8: ETH_USD_8,
  });
  await (await oracle.connect(admin).setListed(USDC, true, 10n ** 8n, USDC_USD_FEED)).wait();
  const td = await (await ethers.getContractFactory("AnypairTokenDeployer", deployer)).deploy();
  const factory = await (await ethers.getContractFactory("AnypairFactory", deployer)).deploy(
    deployer.address, admin.address, POOL_MANAGER, hookAddr, await td.getAddress(), WETH, await oracle.getAddress(), TAX_BPS, CREATOR_BPS, HOLDER_BPS, ethers.ZeroAddress,
  );
  const fAddr = await factory.getAddress();
  await (await td.setFactory(fAddr)).wait();
  await (await hook.setFactory(fAddr)).wait();
  const router = await (await ethers.getContractFactory("AnypairRouter", deployer)).deploy(POOL_MANAGER, fAddr, WETH);
  await (await factory.setConverter(await router.getAddress())).wait();
  return { hook, oracle, factory, router, deployer };
}

type LaunchOpts = { ethIn?: bigint; basket?: string[]; holderRewards?: boolean; pair?: string; sources?: any[] };
async function launch(factory: any, creator: any, o: LaunchOpts = {}) {
  const pair = o.pair ?? WETH;
  const basket = o.basket ?? [];
  const n = Number(await factory.totalTokens());
  await (await factory.connect(creator).launch(
    { name: "Basey", symbol: "BASEY", metadataURI: '{"description":"base fork test"}', pair, minPairOut: 0, basket, holderRewards: o.holderRewards ?? true, sources: o.sources ?? sourcesFor([pair, ...basket]) },
    nextSalt(), await routeFor(pair), { value: o.ethIn ?? 0n },
  )).wait();
  return ethers.getContractAt("AnypairToken", await factory.allTokens(n));
}
const usdWhole = async (oracle: any, t: string) => {
  const dec = t === WETH ? 18n : BigInt(await (await ethers.getContractAt(ERC20, t)).decimals());
  return Number(((await oracle.price(t)) * 10n ** dec) / 10n ** 18n) / 1e18; // USD per whole token
};

async function pastSnipe() {
  await network.provider.send("evm_increaseTime", [30]);
  for (let i = 0; i < 4; i++) await network.provider.send("evm_mine", []);
}

describe("Anypair on Base (mainnet fork)", function () {
  this.timeout(900_000);
  const E = ethers.parseEther;

  before(async () => { await network.provider.send("evm_mine", []); });

  it("prices tokens from every Base DEX: Chainlink ETH/USDC, Uniswap V3, PancakeSwap V3, Slipstream, Aerodrome, Uniswap V4 (native ETH)", async () => {
    const [admin, anyone] = await ethers.getSigners();
    const { oracle } = await deployAll(admin);
    for (const t of [CBBTC, AERO, BRETT, CAKE, DEGEN, BLOOB]) await (await oracle.connect(anyone).register(SRC[t])).wait();
    const px: Record<string, number> = {};
    for (const [n, t] of [["ETH", WETH], ["USDC", USDC], ["cbBTC", CBBTC], ["AERO", AERO], ["BRETT", BRETT], ["CAKE", CAKE], ["DEGEN", DEGEN], ["BLOOB", BLOOB]] as const) px[n] = await usdWhole(oracle, t);
    console.log("      USD:", Object.entries(px).map(([k, v]) => `${k} ${v < 1 ? v.toPrecision(4) : v.toFixed(2)}`).join(" | "));
    expect(px.ETH).to.be.gt(500).and.lt(20_000);
    expect(px.USDC).to.be.closeTo(1, 0.02);
    expect(px.cbBTC).to.be.gt(20_000).and.lt(500_000);
    for (const k of ["AERO", "BRETT", "CAKE", "DEGEN", "BLOOB"]) expect(px[k], k).to.be.gt(0);
    // the same token priced from another DEX agrees: AERO from its Uniswap V3 pool vs Aerodrome
    const { oracle: o2 } = await deployAll(admin);
    await (await o2.register({ dex: UNI, pool: "0x3d5D143381916280ff91407FeBEB52f2b60f33Cf", key: EMPTY_KEY })).wait();
    const aeroUni = await usdWhole(o2, AERO);
    expect(aeroUni / px.AERO).to.be.within(0.97, 1.03);
    for (const t of [CBBTC, AERO, BRETT, CAKE, BLOOB]) expect(await oracle.depthUsd(t)).to.be.gte(2_500n * 10n ** 18n);
  });

  it("every pair starts at a $3,000 cap, whatever DEX prices it: the same ETH buy gets about the same share of supply", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router, oracle } = await deployAll(admin);
    const ethUsd = await usdWhole(oracle, WETH);
    const buyEth = E("0.005");
    const shares: Record<string, number> = {};
    for (const [name, pair] of [["WETH", WETH], ["USDC", USDC], ["cbBTC/uniV3", CBBTC], ["AERO/aeroV2", AERO], ["BRETT/slipstream", BRETT], ["CAKE/pancake", CAKE], ["BLOOB/uniV4", BLOOB]] as const) {
      const coin = await launch(factory, creator, { pair });
      await pastSnipe();
      await (await router.connect(trader).buy(await coin.getAddress(), await routeFor(pair), 0, { value: buyEth })).wait();
      shares[name] = Number(((await coin.balanceOf(trader.address)) * 1_000_000n) / SUPPLY) / 10_000;
    }
    const expected = (0.005 * ethUsd * 0.98) / 3000 * 100;
    console.log("      % of supply for 0.005 ETH:", JSON.stringify(shares), "expected ~" + expected.toFixed(3));
    // routing fees differ per pool (0.01%..3%) and V4 BLOOB pays a 3% pool fee
    for (const [name, s] of Object.entries(shares)) expect(s, name).to.be.within(expected * 0.85, expected * 1.05);
  });

  it("USDC pair with a 4-DEX basket (cbBTC on Uniswap, AERO on Aerodrome, BRETT on Slipstream, CAKE on PancakeSwap): fees in USDC; claim USDC, ETH or the basket", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    const usdc = await ethers.getContractAt(ERC20, USDC);
    const basket = [CBBTC, AERO, BRETT, CAKE];
    const coin = await launch(factory, creator, { ethIn: E("0.01"), pair: USDC, basket });
    const coinAddr = await coin.getAddress();
    expect(await coin.pairAsset()).to.eq(USDC);
    expect(await coin.basketAssets()).to.deep.eq(basket);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n);
    await pastSnipe();

    const r = await routeFor(USDC);
    await (await router.connect(trader).buy(coinAddr, r, 0, { value: E("0.2") })).wait();
    const got = await coin.balanceOf(trader.address);
    expect(got).to.be.gt(0n);
    await (await coin.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).sell(coinAddr, got / 3n, r, 0)).wait();

    const pending = await coin.pendingRewards(trader.address);
    expect(pending).to.be.gt(0n);
    const u0 = await usdc.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewards()).wait();
    expect((await usdc.balanceOf(trader.address)) - u0).to.eq(pending);
    await (await coin.payCreator()).wait();
    const p = await coin.totalPlatformFees();
    const a0 = await usdc.balanceOf(admin.address);
    await (await factory.pushPlatformFees([coinAddr])).wait();
    expect((await usdc.balanceOf(admin.address)) - a0).to.eq(p); // platform fees go straight to the admin wallet

    await (await router.connect(trader).buy(coinAddr, r, 0, { value: E("0.3") })).wait();
    await (await router.connect(trader).sell(coinAddr, (await coin.balanceOf(trader.address)) / 3n, r, 0)).wait();
    const pend2 = await coin.pendingRewards(trader.address);
    const toks = await Promise.all(basket.map((t) => ethers.getContractAt(ERC20, t)));
    const b0 = await Promise.all(toks.map((t) => t.balanceOf(trader.address)));
    await (await coin.connect(trader).claimRewardsAsBasket(r, await Promise.all(basket.map(routeFor)), [1n, 1n, 1n, 1n])).wait();
    const outs = await Promise.all(toks.map(async (t, i) => (await t.balanceOf(trader.address)) - b0[i]));
    for (const o of outs) expect(o).to.be.gt(0n);
    console.log(`      basket claim: ${Number(pend2) / 1e6} USDC -> ${Number(outs[0]) / 1e8} cbBTC, ${ethers.formatEther(outs[1])} AERO, ${ethers.formatEther(outs[2])} BRETT, ${ethers.formatEther(outs[3])} CAKE`);

    await (await router.connect(trader).buy(coinAddr, r, 0, { value: E("0.1") })).wait();
    await (await router.connect(trader).sell(coinAddr, (await coin.balanceOf(trader.address)) / 3n, r, 0)).wait();
    const e1 = await ethers.provider.getBalance(trader.address);
    const rc = await (await coin.connect(trader).claimRewardsAsEth(0, r)).wait();
    expect((await ethers.provider.getBalance(trader.address)) + rc!.gasUsed * rc!.gasPrice).to.be.gt(e1);
  });

  it("Uniswap V4 pair (native-ETH pool): register in the launch, ETH first buy, trade, claim; launches wait while the pool's price runs away from the slow price", async () => {
    const [admin, creator, trader, whale] = await ethers.getSigners();
    const { factory, router, oracle } = await deployAll(admin);
    const bloob = await ethers.getContractAt(ERC20, BLOOB);
    const coin = await launch(factory, creator, { ethIn: E("0.01"), pair: BLOOB, basket: [AERO] });
    const coinAddr = await coin.getAddress();
    expect(await coin.pairAsset()).to.eq(BLOOB);
    expect((await oracle.sources(BLOOB)).dex).to.eq(BigInt(V4));
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n);
    await pastSnipe();
    const r = await routeFor(BLOOB);
    await (await router.connect(trader).buy(coinAddr, r, 0, { value: E("0.05") })).wait();
    await (await coin.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    const e0 = await ethers.provider.getBalance(trader.address);
    const rc = await (await router.connect(trader).sell(coinAddr, (await coin.balanceOf(trader.address)) / 2n, r, 0)).wait();
    expect((await ethers.provider.getBalance(trader.address)) + rc!.gasUsed * rc!.gasPrice).to.be.gt(e0);
    const pend = await coin.pendingRewards(trader.address);
    expect(pend).to.be.gt(0n);
    const bl0 = await bloob.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewards()).wait();
    expect((await bloob.balanceOf(trader.address)) - bl0).to.eq(pend);
    const aero = await ethers.getContractAt(ERC20, AERO);
    await (await router.connect(trader).sell(coinAddr, (await coin.balanceOf(trader.address)) / 2n, r, 0)).wait();
    const a0 = await aero.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewardsAsBasket(r, [await routeFor(AERO)], [1n])).wait();
    expect((await aero.balanceOf(trader.address)) - a0).to.be.gt(0n);

    // pump BLOOB in its own V4 pool well past the band: new launches wait for the slow price
    const slow0 = (await oracle.sources(BLOOB)).slowTick;
    await (await router.connect(whale).ethToPair(BLOOB, r, whale.address, 0, { value: E("8") })).wait();
    await expect(launch(factory, creator, { pair: BLOOB })).to.be.revertedWithCustomError(oracle, "PriceMoving");
    // trades keep pricing at the slow price, which follows ~1%/min
    for (let i = 0; i < 40; i++) {
      await network.provider.send("evm_increaseTime", [300]);
      await network.provider.send("evm_mine", []);
      await (await oracle.poke(BLOOB)).wait();
      try { await launch(factory, creator, { pair: BLOOB }); console.log(`      BLOOB pumped; launches resumed after ${(i + 1) * 5} min (slow tick ${slow0} -> ${(await oracle.sources(BLOOB)).slowTick})`); return; } catch { /* still moving */ }
    }
    throw new Error("launch never resumed");
  });

  it("WETH pair: 2% split 35/25/40; creator paid in WETH; platform fees go straight to the admin wallet; DEGEN basket", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    expect(await factory.feeRecipient()).to.eq(admin.address);
    const coin = await launch(factory, creator, { ethIn: E("0.02"), basket: [DEGEN] });
    const coinAddr = await coin.getAddress();
    await pastSnipe();
    const h0 = await coin.totalHolderRewards(), c0 = await coin.totalCreatorFees(), p0 = await coin.totalPlatformFees();
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: E("0.1") })).wait();
    await (await coin.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).sell(coinAddr, (await coin.balanceOf(trader.address)) / 2n, NO_ROUTE, 0)).wait();
    const h = (await coin.totalHolderRewards()) - h0, c = (await coin.totalCreatorFees()) - c0, p = (await coin.totalPlatformFees()) - p0;
    const total = h + c + p;
    expect((c * 10_000n) / total).to.be.within(3499n, 3501n);
    expect((h * 10_000n) / total).to.be.within(2499n, 2501n);
    expect((p * 10_000n) / total).to.be.within(3999n, 4001n);
    const degen = await ethers.getContractAt(ERC20, DEGEN);
    const d0 = await degen.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewardsAsBasket(NO_ROUTE, [await routeFor(DEGEN)], [1n])).wait();
    expect((await degen.balanceOf(trader.address)) - d0).to.be.gt(0n);
    const weth = await ethers.getContractAt(ERC20, WETH);
    const cw0 = await weth.balanceOf(creator.address);
    await (await coin.payCreator()).wait();
    expect((await weth.balanceOf(creator.address)) - cw0).to.eq(c + c0);
    const aw0 = await weth.balanceOf(admin.address);
    await (await factory.pushPlatformFees([coinAddr])).wait();
    expect((await weth.balanceOf(admin.address)) - aw0).to.eq(p + p0);
  });

  it("trades from any other app or router (no hook data) still pay the fee and feed holder rewards", async () => {
    const [admin, creator, trader, holder] = await ethers.getSigners();
    const { factory, router, deployer } = await deployAll(admin);
    const foreign = await (await ethers.getContractFactory("ForeignSwapper", deployer)).deploy(POOL_MANAGER);
    const coin = await launch(factory, creator, { pair: USDC });
    const coinAddr = await coin.getAddress();
    await pastSnipe();
    const r = await routeFor(USDC);
    await (await router.connect(holder).buy(coinAddr, r, 0, { value: E("0.05") })).wait();
    const h0 = await coin.totalHolderRewards(), pend0 = await coin.pendingRewards(holder.address);
    await (await router.connect(trader).buy(coinAddr, r, 0, { value: E("0.1") })).wait();
    const key = await factory.poolKeyOf(coinAddr);
    const half = (await coin.balanceOf(trader.address)) / 2n;
    await (await coin.connect(trader).approve(await foreign.getAddress(), half)).wait();
    await (await foreign.connect(trader).swap({ currency0: key.currency0, currency1: key.currency1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks }, coinAddr, half)).wait();
    expect(await coin.totalHolderRewards()).to.be.gt(h0);
    expect(await coin.pendingRewards(holder.address)).to.be.gt(pend0);
  });

  it("sources: unpriced, shallow, non-canonical and blocked tokens are refused; deeper time-weighted pools take over; the admin lists, clears and blocks", async () => {
    const [admin, creator, stranger] = await ethers.getSigners();
    const { factory, oracle } = await deployAll(admin);
    const coin = await launch(factory, creator);
    const coinAddr = await coin.getAddress();
    await expect(launch(factory, creator, { pair: coinAddr, sources: [] })).to.be.revertedWithCustomError(oracle, "NoPrice");
    await expect(launch(factory, creator, { pair: DEGEN, sources: [] })).to.be.revertedWithCustomError(oracle, "NoPrice"); // nobody registered DEGEN
    // DEGEN's PancakeSwap 0.05% pool holds ~0.5 WETH: too shallow
    await expect(oracle.register({ dex: PANCAKE, pool: "0x54D281c7cc029a9Dd71F9ACb7487dd95B1EecF5a", key: EMPTY_KEY })).to.be.revertedWithCustomError(oracle, "TooShallow");
    // a Uniswap pool presented as a PancakeSwap pool is not canonical
    await expect(oracle.register({ dex: PANCAKE, pool: SRC[CBBTC].pool, key: EMPTY_KEY })).to.be.revertedWithCustomError(oracle, "BadSource");
    await expect(oracle.register({ dex: UNI, pool: usdcPool || (await hopFor(USDC)).pool, key: EMPTY_KEY })).to.be.revertedWithCustomError(oracle, "BadSource"); // USDC/WETH: both anchors
    await expect(launch(factory, creator, { basket: [WETH] })).to.be.revertedWithCustomError(factory, "InvalidParams");
    await expect(launch(factory, creator, { basket: [AERO, AERO] })).to.be.revertedWithCustomError(factory, "InvalidParams");
    await expect(launch(factory, creator, { basket: [AERO], holderRewards: false })).to.be.revertedWithCustomError(factory, "InvalidParams");

    // replacement: only a time-weighted pool over twice as deep, unless the admin does it
    await (await oracle.connect(stranger).register({ dex: AEROV2, pool: "0x2578365B3dfA7FfE60108e181EFb79FeDdec2319", key: EMPTY_KEY })).wait(); // cbBTC on Aerodrome
    const d1 = await oracle.depthUsd(CBBTC);
    const [, changed] = await oracle.connect(stranger).register.staticCall(SRC[CBBTC]);
    await (await oracle.connect(stranger).register(SRC[CBBTC])).wait();
    const now = (await oracle.sources(CBBTC)).pool;
    expect(now === SRC[CBBTC].pool).to.eq(changed);
    console.log(`      cbBTC: Aerodrome depth $${Number(d1 / 10n ** 18n)} -> Uniswap 0.05% ${changed ? "took over" : "kept Aerodrome"} (depth $${Number((await oracle.depthUsd(CBBTC)) / 10n ** 18n)})`);
    await (await oracle.connect(stranger).register(SRC[BLOOB])).wait();
    // a V4 pool never replaces a source unless the admin sets it
    const [, v4changed] = await oracle.connect(stranger).register.staticCall({ dex: V4, pool: ethers.ZeroAddress, key: { ...BLOOB_KEY } });
    expect(v4changed).to.eq(false);
    await expect(oracle.connect(stranger).clearSource(CBBTC)).to.be.revertedWithCustomError(oracle, "NotAdmin");
    await (await oracle.connect(admin).clearSource(CBBTC)).wait();
    expect(await oracle.hasPrice(CBBTC)).to.eq(false);
    await (await oracle.connect(admin).register({ dex: AEROV2, pool: "0x2578365B3dfA7FfE60108e181EFb79FeDdec2319", key: EMPTY_KEY })).wait();

    // the admin lists a fixed price: an unpooled token becomes usable
    await (await oracle.connect(admin).setListed(coinAddr, true, 5n * 10n ** 7n, ethers.ZeroAddress)).wait();
    expect(await oracle.price(coinAddr)).to.eq(5n * 10n ** 17n);
    await launch(factory, creator, { basket: [coinAddr] });

    // blocklist (factory)
    await expect(factory.connect(stranger).setTokenBlocked(AERO, true)).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(admin).setTokenBlocked(AERO, true)).wait();
    await expect(launch(factory, creator, { pair: AERO })).to.be.revertedWithCustomError(factory, "Blocked");
    await expect(launch(factory, creator, { basket: [CBBTC, AERO] })).to.be.revertedWithCustomError(factory, "Blocked");
    await (await factory.connect(admin).setTokenBlocked(AERO, false)).wait();
    await launch(factory, creator, { basket: [CBBTC, AERO] });
    await (await oracle.connect(admin).setMinDepthUsd(10n ** 30n)).wait();
    await expect(oracle.register(SRC[DEGEN])).to.be.revertedWithCustomError(oracle, "TooShallow");
  });

  it("admin: pause/resume, hide, metadata override, fee recipient, collect liquidity; the coin has no owner", async () => {
    const [admin, creator, stranger] = await ethers.getSigners();
    const { factory } = await deployAll(admin);
    const coin = await launch(factory, creator, { pair: USDC });
    const coinAddr = await coin.getAddress();
    expect(await coin.owner()).to.eq(ethers.ZeroAddress);
    await expect(factory.connect(stranger).pause()).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(admin).pause()).wait();
    await expect(launch(factory, creator)).to.be.revertedWithCustomError(factory, "LaunchesPaused");
    await (await factory.connect(admin).resume()).wait();
    await (await factory.connect(admin).setHidden(coinAddr, true)).wait();
    expect(await factory.hidden(coinAddr)).to.eq(true);
    await (await factory.connect(admin).setCoinMetadata(coinAddr, '{"image":"x"}')).wait();
    expect(await factory.metadataOf(coinAddr)).to.eq('{"image":"x"}');
    await (await factory.connect(admin).setFeeRecipient(stranger.address)).wait();
    expect(await factory.feeRecipient()).to.eq(stranger.address);
    await expect(factory.connect(stranger).collect(coinAddr, 1000, stranger.address)).to.be.revertedWithCustomError(factory, "NotAdmin");
    const [tok, pair] = await factory.connect(admin).collect.staticCall(coinAddr, 1000, admin.address);
    await (await factory.connect(admin).collect(coinAddr, 1000, admin.address)).wait();
    expect(tok).to.be.gt(0n);
    expect(await coin.balanceOf(admin.address)).to.eq(tok);
    expect(pair).to.eq(0n);
  });
});
