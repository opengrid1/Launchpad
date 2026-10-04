import { expect } from "chai";
import { ethers, network } from "hardhat";

// Anypair on a Base mainnet fork: real Uniswap V4 PoolManager, V3 factory and
// SwapRouter02, Chainlink ETH/USD, WETH, USDC, cbBTC, AERO, DEGEN.
//   FORK=1 FORK_HARDFORK=cancun ROBINHOOD_RPC_URL=https://base-rpc.publicnode.com ROBINHOOD_CHAIN_ID=8453 \
//   BLOCK_GAS_LIMIT=60000000 HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat test test/v4/anypair-base.fork.test.ts
const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b";
const V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const ROUTER02 = "0x2626664c2603336E57B271c5C0b26F421741e481";
const ETH_USD_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // 6 dp
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"; // 8 dp
const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const DEGEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const NO_ROUTE = "0x";
const ETH_USD_8 = 2_700n * 10n ** 8n; // fallback only; the feed prices ETH
const SUPPLY = 10n ** 27n;
const TAX_BPS = 200n, CREATOR_BPS = 3500n, HOLDER_BPS = 2500n;
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function decimals() view returns (uint8)"];
let saltN = 1n;
const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(saltN++), 32);

// The deepest WETH pool tier per token, read once from the fork.
const feeOf: Record<string, number> = {};
async function bestFee(token: string): Promise<number> {
  if (feeOf[token]) return feeOf[token];
  const f = await ethers.getContractAt(["function getPool(address,address,uint24) view returns (address)"], V3_FACTORY);
  const weth = await ethers.getContractAt(ERC20, WETH);
  let best = 0, bal = -1n;
  for (const fee of [100, 500, 3000, 10000]) {
    const p: string = await f.getPool(token, WETH, fee);
    if (p === ethers.ZeroAddress) continue;
    const b = await weth.balanceOf(p);
    if (b > bal) { bal = b; best = fee; }
  }
  return (feeOf[token] = best);
}
const routeFor = async (token: string) =>
  ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [ethers.solidityPacked(["address", "uint24", "address"], [WETH, await bestFee(token), token]), EMPTY_KEY]);

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
  const td = await (await ethers.getContractFactory("AnypairTokenDeployer", deployer)).deploy();
  const factory = await (await ethers.getContractFactory("AnypairFactory", deployer)).deploy(
    deployer.address, admin.address, POOL_MANAGER, hookAddr, await td.getAddress(), WETH, V3_FACTORY, ETH_USD_FEED, ETH_USD_8, TAX_BPS, CREATOR_BPS, HOLDER_BPS, ethers.ZeroAddress,
  );
  const fAddr = await factory.getAddress();
  await (await td.setFactory(fAddr)).wait();
  await (await hook.setFactory(fAddr)).wait();
  const ledger = await (await ethers.getContractFactory("AnypairLedger", deployer)).deploy(hookAddr, WETH);
  await (await hook.setLedger(await ledger.getAddress())).wait();
  const router = await (await ethers.getContractFactory("AnypairRouter", deployer)).deploy(POOL_MANAGER, fAddr, WETH, ROUTER02);
  await (await factory.setConverter(await router.getAddress())).wait();
  const payout = await (await ethers.getContractFactory("AnypairPayout", deployer)).deploy(WETH, admin.address, await ledger.getAddress());
  const treasury = await (await ethers.getContractFactory("AnypairTreasury", deployer)).deploy(WETH, admin.address, await payout.getAddress());
  await (await factory.connect(admin).setFeeRecipient(await treasury.getAddress())).wait();
  return { hook, factory, router, ledger, payout, treasury, deployer };
}

async function launch(factory: any, creator: any, o: { ethIn?: bigint; basket?: string[]; holderRewards?: boolean; pair?: string } = {}) {
  const pair = o.pair ?? WETH;
  const n = Number(await factory.totalTokens());
  const route = pair === WETH ? NO_ROUTE : await routeFor(pair);
  await (await factory.connect(creator).launch(
    { name: "Basey", symbol: "BASEY", metadataURI: '{"description":"base fork test"}', pair, minPairOut: 0, basket: o.basket ?? [], holderRewards: o.holderRewards ?? true },
    nextSalt(), route, { value: o.ethIn ?? 0n },
  )).wait();
  return ethers.getContractAt("AnypairToken", await factory.allTokens(n));
}
// USD (8 dp) for an amount of pair base units at the factory's 18-dp price per 1e18 units
const usd8 = (amount: bigint, px18: bigint) => (amount * px18) / 10n ** 28n;

async function pastSnipe() {
  await network.provider.send("evm_increaseTime", [30]);
  for (let i = 0; i < 4; i++) await network.provider.send("evm_mine", []);
}

describe("Anypair on Base (mainnet fork)", function () {
  this.timeout(900_000);
  const E = ethers.parseEther;

  before(async () => { await network.provider.send("evm_mine", []); });

  it("prices any pair in USD: Chainlink for ETH, TWAP for USDC (6 dp), cbBTC (8 dp), AERO and DEGEN", async () => {
    const [admin, creator] = await ethers.getSigners();
    const { factory } = await deployAll(admin);
    // TWAP pools are pinned at first launch, so launch one coin per pair first.
    for (const p of [USDC, CBBTC, AERO, DEGEN]) await launch(factory, creator, { pair: p });
    const feed = await ethers.getContractAt(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], ETH_USD_FEED);
    const ethUsd8 = (await feed.latestRoundData())[1];
    const ethPx = await factory.pairUsdPrice(WETH);
    expect(ethPx).to.eq(ethUsd8 * 10n ** 10n);
    const usdcPx = await factory.pairUsdPrice(USDC);
    // $1 per 1e6 units -> $1e12 per 1e18 units, 18 dp
    expect(usdcPx).to.be.closeTo(10n ** 30n, 10n ** 28n);
    const btcPx = await factory.pairUsdPrice(CBBTC);
    const btcUsd = Number(btcPx / 10n ** 18n) / 1e10; // per whole cbBTC
    expect(btcUsd).to.be.gt(20_000).and.lt(500_000);
    const aeroUsd = Number(await factory.pairUsdPrice(AERO)) / 1e18;
    const degenUsd = Number(await factory.pairUsdPrice(DEGEN)) / 1e18;
    expect(aeroUsd).to.be.gt(0.01).and.lt(100);
    expect(degenUsd).to.be.gt(0).and.lt(1);
    console.log(`      ETH $${(Number(ethUsd8) / 1e8).toFixed(2)} | USDC $${(Number(usdcPx / 10n ** 12n) / 1e18).toFixed(4)} | cbBTC $${btcUsd.toFixed(0)} | AERO $${aeroUsd.toFixed(4)} | DEGEN $${degenUsd.toFixed(6)}`);
    for (const p of [USDC, CBBTC, AERO, DEGEN]) expect(await factory.oraclePool(p)).to.not.eq(ethers.ZeroAddress);
  });

  it("every pair starts at a $3,000 cap: the same ETH buy gets about the same share of supply on WETH, USDC, cbBTC and DEGEN", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    const ethUsd = Number(await factory.pairUsdPrice(WETH)) / 1e18;
    const buyEth = E("0.005"); // ~$13.5 at $2,700: ~0.45% of a $3,000 cap
    const shares: Record<string, number> = {};
    for (const [name, pair] of [["WETH", WETH], ["USDC", USDC], ["cbBTC", CBBTC], ["DEGEN", DEGEN]] as const) {
      const coin = await launch(factory, creator, { pair });
      await pastSnipe();
      const route = pair === WETH ? NO_ROUTE : await routeFor(pair);
      await (await router.connect(trader).buy(await coin.getAddress(), route, 0, { value: buyEth })).wait();
      const got = await coin.balanceOf(trader.address);
      shares[name] = Number((got * 1_000_000n) / SUPPLY) / 10_000; // percent of supply
    }
    // share bought ~= usd spent (net of 2% fee and pool fees) / $3,000
    const expected = (0.005 * ethUsd * 0.98) / 3000 * 100;
    for (const [name, s] of Object.entries(shares)) {
      expect(s, name).to.be.within(expected * 0.9, expected * 1.05);
    }
    console.log("      % of supply for 0.005 ETH:", JSON.stringify(shares), "expected ~" + expected.toFixed(3));
  });

  it("USDC pair with a cbBTC + AERO basket: ETH first buy routes through USDC; fees in USDC; holders claim USDC, ETH or the basket; ledger counts USD", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router, ledger, treasury } = await deployAll(admin);
    const usdc = await ethers.getContractAt(ERC20, USDC);
    const coin = await launch(factory, creator, { ethIn: E("0.01"), pair: USDC, basket: [CBBTC, AERO] });
    const coinAddr = await coin.getAddress();
    expect(await coin.pairAsset()).to.eq(USDC);
    expect(await coin.basketAssets()).to.deep.eq([CBBTC, AERO]);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n);
    await pastSnipe();

    const r = await routeFor(USDC);
    const epoch = await ledger.currentEpoch();
    await (await router.connect(trader).buy(coinAddr, r, 0, { value: E("0.2") })).wait();
    const got = await coin.balanceOf(trader.address);
    const pos = await ledger.positions(trader.address, coinAddr);
    expect(pos.units).to.eq(got);
    const px = await factory.pairUsdPrice(USDC);
    const st = await ledger.stats(epoch, trader.address);
    expect(st.volume).to.eq(usd8(pos.basis, px));
    expect(st.volume).to.be.gt(400n * 10n ** 8n); // ~$540 of USDC
    await (await coin.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    const e0 = await ethers.provider.getBalance(trader.address);
    const rc = await (await router.connect(trader).sell(coinAddr, got / 3n, r, 0)).wait();
    expect((await ethers.provider.getBalance(trader.address)) + rc!.gasUsed * rc!.gasPrice).to.be.gt(e0);

    // split 35/25/40 in USDC (6 dp: the 1e30 accumulator keeps this exact enough)
    const h = await coin.totalHolderRewards(), c = await coin.totalCreatorFees(), p = await coin.totalPlatformFees();
    expect(h).to.be.gt(0n);
    const pending = await coin.pendingRewards(trader.address);
    expect(pending).to.be.gt(0n);
    const u0 = await usdc.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewards()).wait();
    expect((await usdc.balanceOf(trader.address)) - u0).to.eq(pending);
    const c0 = await usdc.balanceOf(creator.address);
    await (await coin.payCreator()).wait();
    expect((await usdc.balanceOf(creator.address)) - c0).to.be.gt(0n);
    await (await factory.pushPlatformFees([coinAddr])).wait();
    expect(await usdc.balanceOf(await treasury.getAddress())).to.eq(p);
    // the treasury forwards non-WETH assets whole to the platform wallet
    await (await treasury.sweep(USDC)).wait();
    expect(await usdc.balanceOf(admin.address)).to.eq(p);

    // more trading, then the basket claim: USDC -> WETH -> cbBTC / AERO
    await (await router.connect(trader).buy(coinAddr, r, 0, { value: E("0.2") })).wait();
    await (await router.connect(trader).sell(coinAddr, (await coin.balanceOf(trader.address)) / 3n, r, 0)).wait();
    const pend2 = await coin.pendingRewards(trader.address);
    expect(pend2).to.be.gt(0n);
    const btc = await ethers.getContractAt(ERC20, CBBTC), aero = await ethers.getContractAt(ERC20, AERO);
    const b0 = await btc.balanceOf(trader.address), a0 = await aero.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewardsAsBasket(r, [await routeFor(CBBTC), await routeFor(AERO)], [1n, 1n])).wait();
    const bOut = (await btc.balanceOf(trader.address)) - b0, aOut = (await aero.balanceOf(trader.address)) - a0;
    expect(bOut).to.be.gt(0n);
    expect(aOut).to.be.gt(0n);
    // and as ETH
    await (await router.connect(trader).buy(coinAddr, r, 0, { value: E("0.1") })).wait();
    await (await router.connect(trader).sell(coinAddr, (await coin.balanceOf(trader.address)) / 3n, r, 0)).wait();
    const e1 = await ethers.provider.getBalance(trader.address);
    const rc2 = await (await coin.connect(trader).claimRewardsAsEth(0, r)).wait();
    expect((await ethers.provider.getBalance(trader.address)) + rc2!.gasUsed * rc2!.gasPrice).to.be.gt(e1);
    console.log(`      USDC pair: holder ${Number(pending) / 1e6} USDC, basket ${Number(pend2) / 1e6} USDC -> ${Number(bOut) / 1e8} cbBTC + ${ethers.formatEther(aOut)} AERO | creator ${Number(c) / 1e6} USDC`);
  });

  it("WETH pair: 2% split 35/25/40, leaderboard in USD at the Chainlink price, treasury 1/8 to the payout pool", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router, ledger, treasury, payout } = await deployAll(admin);
    const coin = await launch(factory, creator, { ethIn: E("0.02"), basket: [DEGEN] });
    const coinAddr = await coin.getAddress();
    await pastSnipe();
    const h0 = await coin.totalHolderRewards(), c0 = await coin.totalCreatorFees(), p0 = await coin.totalPlatformFees();
    const epoch = await ledger.currentEpoch();
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: E("0.1") })).wait();
    const st = await ledger.stats(epoch, trader.address);
    const px = await factory.pairUsdPrice(WETH);
    expect(st.volume).to.eq(usd8(E("0.1"), px));
    expect(st.fees).to.eq(usd8(E("0.1") * TAX_BPS / 10_000n, px));
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
    await (await factory.pushPlatformFees([coinAddr])).wait();
    const weth = await ethers.getContractAt(ERC20, WETH);
    const tBal = await weth.balanceOf(await treasury.getAddress());
    await (await treasury.sweep(WETH)).wait();
    expect(await weth.balanceOf(await payout.getAddress())).to.eq((tBal * 1250n) / 10_000n);
  });

  it("trades from any other app or router (no hook data) still pay the fee, feed holder rewards and count on the leaderboard", async () => {
    const [admin, creator, trader, holder] = await ethers.getSigners();
    const { factory, router, ledger, deployer } = await deployAll(admin);
    const foreign = await (await ethers.getContractFactory("ForeignSwapper", deployer)).deploy(POOL_MANAGER);
    const coin = await launch(factory, creator, { pair: USDC });
    const coinAddr = await coin.getAddress();
    await pastSnipe();
    await (await router.connect(holder).buy(coinAddr, await routeFor(USDC), 0, { value: E("0.05") })).wait();
    const h0 = await coin.totalHolderRewards(), pend0 = await coin.pendingRewards(holder.address);
    // trader sells through a foreign V4 router with empty hook data
    await (await router.connect(trader).buy(coinAddr, await routeFor(USDC), 0, { value: E("0.1") })).wait();
    const key = await factory.poolKeyOf(coinAddr);
    const half = (await coin.balanceOf(trader.address)) / 2n;
    await (await coin.connect(trader).approve(await foreign.getAddress(), half)).wait();
    const st0 = await ledger.stats(await ledger.currentEpoch(), trader.address);
    await (await foreign.connect(trader).swap({ currency0: key.currency0, currency1: key.currency1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks }, coinAddr, half)).wait();
    expect(await coin.totalHolderRewards()).to.be.gt(h0);
    expect(await coin.pendingRewards(holder.address)).to.be.gt(pend0);
    const st1 = await ledger.stats(await ledger.currentEpoch(), trader.address);
    expect(st1.trades).to.eq(st0.trades + 1n); // attributed to the signing wallet
    expect(st1.volume).to.be.gt(st0.volume);
  });

  it("refuses unpriced, blocked, WETH and repeated basket assets; admin can block, list a price, and repin a TWAP pool", async () => {
    const [admin, creator, stranger] = await ethers.getSigners();
    const { factory } = await deployAll(admin);
    const coin = await launch(factory, creator);
    const coinAddr = await coin.getAddress();
    // a fresh coin has no V3 pool against WETH: no price, so it can't be a pair or basket asset
    await expect(launch(factory, creator, { pair: coinAddr })).to.be.revertedWithCustomError(factory, "NoPrice");
    await expect(launch(factory, creator, { basket: [coinAddr] })).to.be.revertedWithCustomError(factory, "NoPrice");
    await expect(launch(factory, creator, { basket: [WETH] })).to.be.revertedWithCustomError(factory, "InvalidParams");
    await expect(launch(factory, creator, { basket: [AERO, AERO] })).to.be.revertedWithCustomError(factory, "InvalidParams");
    await expect(launch(factory, creator, { basket: [USDC, CBBTC, AERO, DEGEN, coinAddr] })).to.be.revertedWithCustomError(factory, "InvalidParams");
    await expect(launch(factory, creator, { basket: [AERO], holderRewards: false })).to.be.revertedWithCustomError(factory, "InvalidParams");

    await expect(factory.connect(stranger).setTokenBlocked(AERO, true)).to.be.revertedWithCustomError(factory, "NotAdmin");
    await expect(factory.connect(admin).setTokenBlocked(WETH, true)).to.be.revertedWithCustomError(factory, "InvalidParams");
    await (await factory.connect(admin).setTokenBlocked(AERO, true)).wait();
    await expect(launch(factory, creator, { pair: AERO })).to.be.revertedWithCustomError(factory, "Blocked");
    await expect(launch(factory, creator, { basket: [CBBTC, AERO] })).to.be.revertedWithCustomError(factory, "Blocked");
    await (await factory.connect(admin).setTokenBlocked(AERO, false)).wait();
    await launch(factory, creator, { basket: [CBBTC, AERO] });

    // an admin-listed price makes an unpooled token usable ($0.50 per whole coin)
    await (await factory.connect(admin).setQuoteAsset(coinAddr, true, 5n * 10n ** 7n, ethers.ZeroAddress)).wait();
    expect(await factory.pairUsdPrice(coinAddr)).to.eq(5n * 10n ** 17n);
    await launch(factory, creator, { basket: [coinAddr] });

    // repin: only a real V3 WETH pool of that token
    const f = await ethers.getContractAt(["function getPool(address,address,uint24) view returns (address)"], V3_FACTORY);
    const alt: string = await f.getPool(USDC, WETH, 3000);
    await expect(factory.connect(admin).setOraclePool(USDC, await f.getPool(AERO, WETH, await bestFee(AERO)))).to.be.revertedWithCustomError(factory, "InvalidParams");
    await (await factory.connect(admin).setOraclePool(USDC, alt)).wait();
    expect(await factory.oraclePool(USDC)).to.eq(alt);
    await (await factory.connect(admin).setMinOracleWeth(E("1000000"))).wait();
    await expect(launch(factory, creator, { pair: DEGEN })).to.be.revertedWithCustomError(factory, "NoPrice"); // no pool that deep
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
