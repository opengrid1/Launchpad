import { expect } from "chai";
import { ethers, network } from "hardhat";

// Inkypump (Estonks model) on an Ink mainnet fork: real Uniswap V4 PoolManager,
// Uniswap V3 SwapRouter02, WETH and the wrapped Backed xStocks.
//   FORK=1 ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com ROBINHOOD_CHAIN_ID=57073 BLOCK_GAS_LIMIT=30000000 \
//   HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat test test/v4/inkypump-ink.fork.test.ts
const POOL_MANAGER = "0x360e68faccca8ca495c1b759fd9eee466db9fb32";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER02 = "0x177778F19E89dD1012BdBe603F144088A95C4B53";
const USDG = "0xe343167631d89B6Ffc58B88d6b7fB0228795491D";
const NVDA = "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5"; // wNVDAx
const SPY = "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540"; // wSPYx
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
// Basket route on Ink today: WETH -(1%)-> USDG -(0.05%)-> wStock, all Uniswap V3.
const routeFor = (stock: string) =>
  ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [ethers.solidityPacked(["address", "uint24", "address", "uint24", "address"], [WETH, 10000, USDG, 500, stock]), EMPTY_KEY]);
const NO_ROUTE = "0x";
const ETH_USD_8 = 2_431n * 10n ** 8n;
const SUPPLY = 10n ** 27n;
const TAX_BPS = 200n, CREATOR_BPS = 3500n, HOLDER_BPS = 2500n; // platform 40% = 0.8%
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function deposit() payable"];
let saltN = 1n;
const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(saltN++), 32);

async function deployAll(admin: any) {
  const deployer = (await ethers.getSigners())[9];
  const c2 = await (await ethers.getContractFactory("HookDeployer", deployer)).deploy();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("InkypumpHook");
  const init = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address"], [POOL_MANAGER])]);
  const hash = ethers.keccak256(init);
  let hookAddr = "", salt = "";
  for (let i = 0n; i < 3_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
  }
  await (await c2.deploy(salt, init)).wait();
  const hook = await ethers.getContractAt("InkypumpHook", hookAddr, deployer);
  const td = await (await ethers.getContractFactory("InkypumpTokenDeployer", deployer)).deploy();
  const factory = await (await ethers.getContractFactory("InkypumpFactory", deployer)).deploy(
    deployer.address, admin.address, POOL_MANAGER, hookAddr, await td.getAddress(), WETH, ETH_USD_8, TAX_BPS, CREATOR_BPS, HOLDER_BPS, ethers.ZeroAddress,
  );
  const fAddr = await factory.getAddress();
  await (await td.setFactory(fAddr)).wait();
  await (await hook.setFactory(fAddr)).wait();
  const ledger = await (await ethers.getContractFactory("InkypumpLedger", deployer)).deploy(hookAddr, WETH);
  await (await hook.setLedger(await ledger.getAddress())).wait();
  const router = await (await ethers.getContractFactory("InkypumpRouter", deployer)).deploy(POOL_MANAGER, fAddr, WETH, ROUTER02);
  await (await factory.setConverter(await router.getAddress())).wait();
  await (await factory.setQuoteAsset(NVDA, true, 185n * 10n ** 8n, ethers.ZeroAddress)).wait();
  await (await factory.setQuoteAsset(SPY, true, 650n * 10n ** 8n, ethers.ZeroAddress)).wait();
  const payout = await (await ethers.getContractFactory("InkypumpPayout", deployer)).deploy(WETH, admin.address, await ledger.getAddress());
  const treasury = await (await ethers.getContractFactory("InkypumpTreasury", deployer)).deploy(WETH, admin.address, await payout.getAddress());
  await (await factory.connect(admin).setFeeRecipient(await treasury.getAddress())).wait();
  const foreign = await (await ethers.getContractFactory("ForeignSwapper", deployer)).deploy(POOL_MANAGER);
  return { hook, factory, router, ledger, payout, treasury, foreign, deployer };
}

async function launch(factory: any, creator: any, ethIn = 0n, basket: string[] = [], meta = '{"description":"ink fork test"}', holderRewards = true, pair = WETH) {
  const n = Number(await factory.totalTokens());
  const route = pair === WETH ? NO_ROUTE : routeFor(pair);
  await (await factory.connect(creator).launch({ name: "Gorb", symbol: "GORB", metadataURI: meta, pair, minPairOut: 0, basket, holderRewards }, nextSalt(), route, { value: ethIn })).wait();
  return ethers.getContractAt("InkypumpToken", await factory.allTokens(n));
}
const usd8 = (wei: bigint, px: bigint) => (wei * px) / 10n ** 18n;

async function pastSnipe() {
  await network.provider.send("evm_increaseTime", [30]);
  for (let i = 0; i < 4; i++) await network.provider.send("evm_mine", []);
}

describe("Inkypump on Ink (mainnet fork)", function () {
  this.timeout(600_000);
  const E = ethers.parseEther;

  it("launch + ETH first buy; trades split 2% as 35/25/40; creator and platform are paid; holders claim in WETH or ETH", async () => {
    const [admin, creator, trader, stranger] = await ethers.getSigners();
    const { factory, router, treasury } = await deployAll(admin);
    const coin = await launch(factory, creator, E("0.05"));
    const coinAddr = await coin.getAddress();
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n);
    expect(await factory.feeRecipient()).to.eq(await treasury.getAddress());
    await pastSnipe();

    // The launch buy's holder share goes to the creator (no holders exist yet); measure the split on trades after it.
    const h0 = await coin.totalHolderRewards(), c0 = await coin.totalCreatorFees(), p0 = await coin.totalPlatformFees();
    const rAddr = await router.getAddress();
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: E("0.1") })).wait();
    const got = await coin.balanceOf(trader.address);
    expect(got).to.be.gt(0n);
    await (await coin.connect(trader).approve(rAddr, got)).wait();
    await (await router.connect(trader).sell(coinAddr, got / 2n, NO_ROUTE, 0)).wait();

    const h = (await coin.totalHolderRewards()) - h0, c = (await coin.totalCreatorFees()) - c0, p = (await coin.totalPlatformFees()) - p0;
    const total = h + c + p;
    expect(total).to.be.gt(0n);
    // 35 / 25 / 40, within rounding
    expect((c * 10_000n) / total).to.be.within(3499n, 3501n);
    expect((h * 10_000n) / total).to.be.within(2499n, 2501n);
    expect((p * 10_000n) / total).to.be.within(3999n, 4001n);

    const weth = await ethers.getContractAt(ERC20, WETH);
    const cb0 = await weth.balanceOf(creator.address);
    await (await coin.connect(stranger).payCreator()).wait();
    expect((await weth.balanceOf(creator.address)) - cb0).to.eq(c + c0);
    await (await factory.connect(stranger).pushPlatformFees([coinAddr])).wait();
    expect(await weth.balanceOf(await treasury.getAddress())).to.eq(p + p0);

    const pending = await coin.pendingRewards(trader.address);
    expect(pending).to.be.gt(0n);
    const tb0 = await weth.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewards()).wait();
    expect((await weth.balanceOf(trader.address)) - tb0).to.eq(pending);
    const eb0 = await ethers.provider.getBalance(creator.address);
    const rc = await (await coin.connect(creator).claimRewardsAsEth(0, NO_ROUTE)).wait();
    const gas = rc!.gasUsed * rc!.gasPrice;
    expect((await ethers.provider.getBalance(creator.address)) + gas).to.be.gt(eb0);
  });

  it("basket: fixed at launch, rewards claimed as equal shares of wNVDAx and wSPYx through the Ink routes", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    await expect(launch(factory, creator, 0n, [NVDA, NVDA])).to.be.reverted; // repeats
    await expect(launch(factory, creator, 0n, [WETH])).to.be.reverted; // WETH is not a basket asset
    const coin = await launch(factory, creator, 0n, [NVDA, SPY]);
    const coinAddr = await coin.getAddress();
    expect(await coin.basketAssets()).to.deep.eq([NVDA, SPY]);
    await pastSnipe();
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: E("0.5") })).wait();
    await (await coin.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).sell(coinAddr, (await coin.balanceOf(trader.address)) / 3n, NO_ROUTE, 0)).wait();
    const pending = await coin.pendingRewards(trader.address);
    expect(pending).to.be.gt(0n);
    const nvda = await ethers.getContractAt(ERC20, NVDA), spy = await ethers.getContractAt(ERC20, SPY);
    const n0 = await nvda.balanceOf(trader.address), s0 = await spy.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewardsAsBasket(NO_ROUTE, [routeFor(NVDA), routeFor(SPY)], [1n, 1n])).wait();
    const nOut = (await nvda.balanceOf(trader.address)) - n0, sOut = (await spy.balanceOf(trader.address)) - s0;
    expect(nOut).to.be.gt(0n);
    expect(sOut).to.be.gt(0n);
    expect(await coin.pendingRewards(trader.address)).to.eq(0n);
    console.log("      basket claim:", ethers.formatEther(pending), "WETH ->", ethers.formatEther(nOut), "wNVDAx +", ethers.formatEther(sOut), "wSPYx");
  });

  it("ledger: every swap is recorded to the signing wallet (our router, a foreign router, and the launch buy); PnL and fees per epoch", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router, ledger, foreign } = await deployAll(admin);
    const coin = await launch(factory, creator, E("0.02"));
    const coinAddr = await coin.getAddress();
    const epoch = await ledger.currentEpoch();
    const cPos = await ledger.positions(creator.address, coinAddr);
    expect(cPos.units).to.eq(await coin.balanceOf(creator.address)); // first buy attributed to the creator
    expect(cPos.basis).to.eq(E("0.02"));
    await pastSnipe();

    // buy through our router (hookData = trader)
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: E("0.1") })).wait();
    let pos = await ledger.positions(trader.address, coinAddr);
    expect(pos.units).to.eq(await coin.balanceOf(trader.address));
    expect(pos.basis).to.eq(E("0.1"));
    let st = await ledger.stats(epoch, trader.address);
    expect(st.fees).to.eq(usd8(E("0.1") * TAX_BPS / 10_000n, ETH_USD_8));
    expect(st.volume).to.eq(usd8(E("0.1"), ETH_USD_8));
    expect(st.trades).to.eq(1n);

    // sell half through a FOREIGN router with empty hook data: attributed by tx.origin
    const key = await factory.poolKeyOf(coinAddr);
    const half = (await coin.balanceOf(trader.address)) / 2n;
    await (await coin.connect(trader).approve(await foreign.getAddress(), half)).wait();
    const weth = await ethers.getContractAt(ERC20, WETH);
    const w0 = await weth.balanceOf(trader.address);
    await (await foreign.connect(trader).swap({ currency0: key.currency0, currency1: key.currency1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks }, coinAddr, half)).wait();
    const received = (await weth.balanceOf(trader.address)) - w0;
    expect(received).to.be.gt(0n);
    pos = await ledger.positions(trader.address, coinAddr);
    expect(pos.units).to.eq(await coin.balanceOf(trader.address));
    expect(pos.basis).to.be.closeTo(E("0.05"), 2n); // half the basis left (floor rounding)
    st = await ledger.stats(epoch, trader.address);
    expect(st.trades).to.eq(2n);
    // stats are USD (8 dp) at the factory's ETH price: realized = net proceeds - basis of the half
    const pnlUsd = ((received - E("0.05")) * ETH_USD_8) / 10n ** 18n;
    expect(st.pnl).to.be.closeTo(pnlUsd, 10n);
    expect(st.volume).to.be.closeTo(usd8(E("0.1"), ETH_USD_8) + usd8(received, ETH_USD_8), 2n);
    console.log("      trader pnl this epoch: $" + (Number(st.pnl) / 1e8).toFixed(2), "| fees paid: $" + (Number(st.fees) / 1e8).toFixed(2));
  });

  it("ledger: coins received by transfer realize nothing when sold (no fake profit on a fresh wallet)", async () => {
    const [admin, creator, trader, fresh] = await ethers.getSigners();
    const { factory, router, ledger } = await deployAll(admin);
    const coin = await launch(factory, creator);
    const coinAddr = await coin.getAddress();
    await pastSnipe();
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: E("0.2") })).wait();
    const bal = await coin.balanceOf(trader.address);
    await (await coin.connect(trader).transfer(fresh.address, bal)).wait();
    await (await coin.connect(fresh).approve(await router.getAddress(), bal)).wait();
    await (await router.connect(fresh).sell(coinAddr, bal, NO_ROUTE, 0)).wait();
    const st = await ledger.stats(await ledger.currentEpoch(), fresh.address);
    expect(st.pnl).to.eq(0n); // nothing bought by this wallet -> nothing realized
    expect(st.fees).to.be.gt(0n); // but the fee it paid still counts on the volume board
    const tp = await ledger.positions(trader.address, coinAddr);
    expect(tp.units).to.eq(bal); // the buyer's ledger position is untouched by the transfer
  });

  it("treasury splits platform WETH 1/8 to the payout pool; admin settles a finished epoch to 5+5 winners by tier; winners claim ETH", async () => {
    const [admin, creator, trader, w1, w2, w3] = await ethers.getSigners();
    const { factory, router, ledger, payout, treasury } = await deployAll(admin);
    const coin = await launch(factory, creator);
    const coinAddr = await coin.getAddress();
    await pastSnipe();
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: E("1") })).wait();
    await (await factory.pushPlatformFees([coinAddr])).wait();
    const weth = await ethers.getContractAt(ERC20, WETH);
    const tBal = await weth.balanceOf(await treasury.getAddress());
    expect(tBal).to.be.gt(0n);
    await (await treasury.sweep(WETH)).wait();
    const pool = await weth.balanceOf(await payout.getAddress());
    expect(pool).to.eq((tBal * 1250n) / 10_000n);
    expect(await weth.balanceOf(admin.address)).to.eq(tBal - pool);

    const epoch = await ledger.currentEpoch();
    await expect(payout.connect(admin).settle(epoch, [w1.address, w2.address, w3.address, ethers.ZeroAddress, ethers.ZeroAddress], [trader.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress])).to.be.revertedWithCustomError(payout, "EpochNotOver");
    await network.provider.send("evm_increaseTime", [3 * 86400 + 1]);
    await network.provider.send("evm_mine", []);
    await expect(payout.connect(trader).settle(epoch, [w1.address, w2.address, w3.address, ethers.ZeroAddress, ethers.ZeroAddress], [trader.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress])).to.be.revertedWithCustomError(payout, "NotAdmin");
    await (await payout.connect(admin).settle(epoch, [w1.address, w2.address, w3.address, ethers.ZeroAddress, ethers.ZeroAddress], [trader.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress])).wait();
    const half = pool / 2n;
    expect(await payout.claimable(w1.address)).to.eq((half * 4000n) / 10_000n);
    expect(await payout.claimable(w2.address)).to.eq((half * 2500n) / 10_000n);
    expect(await payout.claimable(w3.address)).to.eq((half * 1500n) / 10_000n);
    expect(await payout.claimable(trader.address)).to.eq((half * 4000n) / 10_000n);
    await expect(payout.connect(admin).settle(epoch, [w1.address, w2.address, w3.address, ethers.ZeroAddress, ethers.ZeroAddress], [trader.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress])).to.be.revertedWithCustomError(payout, "AlreadySettled");
    const b0 = await ethers.provider.getBalance(w1.address);
    const rc = await (await payout.connect(w1).claim()).wait();
    expect((await ethers.provider.getBalance(w1.address)) - b0 + rc!.gasUsed * rc!.gasPrice).to.eq((half * 4000n) / 10_000n);
    expect(await payout.claimable(w1.address)).to.eq(0n);
    // unpaid tiers (the empty slots) stay in the pool for the next epoch
    expect(await payout.available()).to.eq(pool - ((half * 8000n) / 10_000n) - ((half * 4000n) / 10_000n) + 0n - 0n);
  });

  it("stock pair: a coin paired with wNVDAx; ETH first buy and trades route through USDG; fees and rewards are in wNVDAx; claim as ETH; the leaderboard counts it in USD", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router, ledger } = await deployAll(admin);
    const nvda = await ethers.getContractAt(ERC20, NVDA);
    const coin = await launch(factory, creator, E("0.05"), [], '{"description":"nvda pair"}', true, NVDA);
    const coinAddr = await coin.getAddress();
    expect(await coin.pairAsset()).to.eq(NVDA);
    expect(await coin.rewardToken()).to.eq(NVDA);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n); // ETH -> USDG -> wNVDAx -> coin, in the launch tx
    const listing = await factory.listings(coinAddr);
    expect(listing.pair).to.eq(NVDA);
    await pastSnipe();

    const epoch = await ledger.currentEpoch();
    await (await router.connect(trader).buy(coinAddr, routeFor(NVDA), 0, { value: E("0.2") })).wait();
    const got = await coin.balanceOf(trader.address);
    expect(got).to.be.gt(0n);
    const pos = await ledger.positions(trader.address, coinAddr);
    expect(pos.units).to.eq(got);
    expect(pos.basis).to.be.gt(0n); // in wNVDAx wei
    const st = await ledger.stats(epoch, trader.address);
    expect(st.trades).to.eq(1n);
    expect(st.volume).to.be.gt(0n); // USD, priced from the factory's wNVDAx price
    const nvdaUsd = await factory.pairUsdPrice(NVDA);
    expect(st.volume).to.eq(usd8(pos.basis, nvdaUsd));

    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    const e0 = await ethers.provider.getBalance(trader.address);
    const rc = await (await router.connect(trader).sell(coinAddr, got / 2n, routeFor(NVDA), 0)).wait();
    expect((await ethers.provider.getBalance(trader.address)) + rc!.gasUsed * rc!.gasPrice).to.be.gt(e0); // ETH came back

    // fees landed in the coin as wNVDAx; the holder claims wNVDAx, then the creator takes their share
    const pending = await coin.pendingRewards(trader.address);
    expect(pending).to.be.gt(0n);
    const n0 = await nvda.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewards()).wait();
    expect((await nvda.balanceOf(trader.address)) - n0).to.eq(pending);
    const c0 = await nvda.balanceOf(creator.address);
    await (await coin.payCreator()).wait();
    expect((await nvda.balanceOf(creator.address)) - c0).to.be.gt(0n);
    // and a holder can take rewards as ETH along the same route, backwards
    await (await router.connect(trader).buy(coinAddr, routeFor(NVDA), 0, { value: E("0.1") })).wait();
    await (await coin.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).sell(coinAddr, (await coin.balanceOf(trader.address)) / 4n, routeFor(NVDA), 0)).wait();
    expect(await coin.pendingRewards(trader.address)).to.be.gt(0n);
    const e1 = await ethers.provider.getBalance(trader.address);
    const rc2 = await (await coin.connect(trader).claimRewardsAsEth(0, routeFor(NVDA))).wait();
    expect((await ethers.provider.getBalance(trader.address)) + rc2!.gasUsed * rc2!.gasPrice).to.be.gt(e1);
    console.log("      wNVDAx pair: trader volume $" + (Number(st.volume) / 1e8).toFixed(2), "| holder claim", ethers.formatEther(pending), "wNVDAx");
  });

  it("holder rewards off: no basket allowed, the holder share goes to the creator (1.2%), holders earn nothing, platform unchanged", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    await expect(launch(factory, creator, 0n, [NVDA], '{}', false)).to.be.revertedWithCustomError(factory, "InvalidParams"); // basket needs rewards
    const coin = await launch(factory, creator, 0n, [], '{}', false);
    const coinAddr = await coin.getAddress();
    expect(await coin.holderBps()).to.eq(0n);
    expect(await coin.creatorBps()).to.eq(CREATOR_BPS + HOLDER_BPS);
    expect(await coin.basketAssets()).to.deep.eq([]);
    await pastSnipe();
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: E("0.1") })).wait();
    const got = await coin.balanceOf(trader.address);
    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    await (await router.connect(trader).sell(coinAddr, got / 2n, NO_ROUTE, 0)).wait();
    const h = await coin.totalHolderRewards(), c = await coin.totalCreatorFees(), p = await coin.totalPlatformFees();
    expect(h).to.eq(0n);
    expect(await coin.pendingRewards(trader.address)).to.eq(0n);
    const total = c + p;
    expect((c * 10_000n) / total).to.be.within(5999n, 6001n); // 0.7 + 0.5 = 1.2% of the 2%
    expect((p * 10_000n) / total).to.be.within(3999n, 4001n); // platform still 0.8%
    await expect(coin.connect(trader).claimRewardsAsBasket(NO_ROUTE, [], [])).to.be.revertedWithCustomError(coin, "NoBasket");
  });

  it("admin: pause/resume, hide, metadata override, fee recipient, collect liquidity any time; the coin itself has no owner", async () => {
    const [admin, creator, stranger] = await ethers.getSigners();
    const { factory } = await deployAll(admin);
    const coin = await launch(factory, creator);
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
    expect(pair).to.eq(0n); // no trades yet: the position is still all coins
  });
});
