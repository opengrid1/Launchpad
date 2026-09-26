import { expect } from "chai";
import { ethers, network } from "hardhat";

// Ethereum mainnet fork: real Uniswap V4 PoolManager, V3 SwapRouter02, WETH,
// the Ondo SLVon stock (deepest Ondo pool) and UNI as an "any token" pair.
//   FORK=1 ROBINHOOD_RPC_URL=https://ethereum-rpc.publicnode.com ROBINHOOD_CHAIN_ID=1 \
//   HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat test test/v4/alicorn.fork.test.ts
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ROUTER02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const SLV = "0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4";
const UNI = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
const UNI_FEED = "0x553303d460EE0afB37EdFf9bE42922D8FF63220e"; // Chainlink UNI/USD
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
// Route for SLVon: WETH -(V3 0.05%)-> USDC -(V3 1%)-> SLVon, no V4 leg.
const NVDA_ROUTE = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [ethers.solidityPacked(["address", "uint24", "address", "uint24", "address"], [WETH, 500, USDC, 10000, SLV]), EMPTY_KEY]);
// Route for UNI: WETH -(V3 0.3%)-> UNI.
const UNI_ROUTE = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [ethers.solidityPacked(["address", "uint24", "address"], [WETH, 3000, UNI]), EMPTY_KEY]);
// Route for USDC (self-registered): WETH -(V3 0.05%)-> USDC, the deepest WETH/USDC pool.
const USDC_ROUTE = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [ethers.solidityPacked(["address", "uint24", "address"], [WETH, 500, USDC]), EMPTY_KEY]);
const NO_ROUTE = "0x";
const ETH_USD_8 = 4_000n * 10n ** 8n;
const NVDA_USD_8 = 60n * 10n ** 8n; // SLVon
const SUPPLY = 10n ** 27n;
const TAX_BPS = 400; // 4% of the pair side on every swap

// beforeSwap | afterSwap | beforeSwapReturnDelta | afterSwapReturnDelta
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"];

async function deployAll(admin: any) {
  const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
  await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("AlicornHook");
  const hookInit = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [POOL_MANAGER, admin.address])]);
  const hookHash = ethers.keccak256(hookInit);
  let hookAddr = "", salt = "";
  for (let i = 0n; i < 2_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hookHash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
  }
  if (!hookAddr) throw new Error("no hook salt");
  await (await c2.deploy(salt, hookInit)).wait();
  const hook = await ethers.getContractAt("AlicornHook", hookAddr);

  const pairs = await (await ethers.getContractFactory("AlicornPairs")).deploy(admin.address, admin.address, WETH, V3_FACTORY, ETH_USD_FEED, ETH_USD_8);
  await pairs.waitForDeployment();
  const factory = await (await ethers.getContractFactory("AlicornFactory")).deploy(
    admin.address, admin.address, POOL_MANAGER, hookAddr, WETH, await pairs.getAddress(), TAX_BPS, 5000, 3000,
  );
  await factory.waitForDeployment();
  await (await hook.connect(admin).setFactory(await factory.getAddress())).wait();
  const router = await (await ethers.getContractFactory("AlicornRouter")).deploy(POOL_MANAGER, await factory.getAddress(), WETH, ROUTER02);
  await router.waitForDeployment();
  await (await factory.connect(admin).setConverter(await router.getAddress())).wait();
  await (await pairs.connect(admin).setQuoteAsset(SLV, true, NVDA_USD_8, ethers.ZeroAddress)).wait();
  await (await pairs.connect(admin).setQuoteAsset(UNI, true, 8n * 10n ** 8n, UNI_FEED)).wait();
  return { hook, factory, router, pairs };
}

async function launch(factory: any, creator: any, pair: string, ethIn = 0n, route = NO_ROUTE) {
  const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now()) % 2n ** 64n), 32);
  const n = Number(await factory.totalTokens());
  await (await factory.connect(creator).launch({ name: "Test Coin", symbol: "TC", metadataURI: '{"description":"fork test"}', pair }, salt, route, { value: ethIn })).wait();
  const token = await factory.allTokens(n);
  return ethers.getContractAt("AlicornToken", token);
}

/** Skip past the anti-snipe window: 30s of decaying fee, 10 blocks of caps. */
async function pastSnipe() {
  await network.provider.send("evm_increaseTime", [40]);
  for (let i = 0; i < 11; i++) await network.provider.send("evm_mine", []);
}

describe("Alicorn on Ethereum mainnet (fork)", function () {
  this.timeout(600_000);

  it("WETH pair: launch with an ETH first buy, trade in ETH through the router, fee in WETH split 50/30/20, claim as ETH", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    const coin = await launch(factory, creator, WETH, ethers.parseEther("0.1"));
    const weth = new ethers.Contract(WETH, ERC20, ethers.provider);

    const devCoins = await coin.balanceOf(creator.address);
    expect(devCoins).to.be.gt(SUPPLY / 100n); // 0.1 ETH = $400 into a $3k market
    expect(devCoins).to.be.lt(SUPPLY / 4n);
    // The dev buy pays the base 4% only (no snipe surcharge for the factory).
    const feeAfterDev = await weth.balanceOf(await coin.getAddress());
    expect(feeAfterDev).to.be.closeTo(ethers.parseEther("0.004"), ethers.parseEther("0.00001"));
    expect(await coin.platformFees()).to.equal(feeAfterDev * 2000n / 10000n);

    await pastSnipe();
    const before = await coin.balanceOf(trader.address);
    await (await router.connect(trader).buy(await coin.getAddress(), NO_ROUTE, 0, { value: ethers.parseEther("0.05") })).wait();
    const got = (await coin.balanceOf(trader.address)) - before;
    expect(got).to.be.gt(0n);
    const feeAfterBuy = await weth.balanceOf(await coin.getAddress());
    expect(feeAfterBuy - feeAfterDev).to.be.closeTo(ethers.parseEther("0.002"), ethers.parseEther("0.000005"));

    // Sell half back for ETH: the fee comes off the WETH output.
    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    const ethBefore = await ethers.provider.getBalance(trader.address);
    const rc = await (await router.connect(trader).sell(await coin.getAddress(), got / 2n, NO_ROUTE, 0)).wait();
    const ethAfter = await ethers.provider.getBalance(trader.address);
    expect(ethAfter + rc!.gasUsed * rc!.gasPrice - ethBefore).to.be.gt(ethers.parseEther("0.01"));
    expect(await weth.balanceOf(await coin.getAddress())).to.be.gt(feeAfterBuy);

    // Creator: 50% of every fee, claimable as ETH.
    const creatorFees = await coin.creatorFees();
    expect(creatorFees).to.be.gt(0n);
    const cBefore = await ethers.provider.getBalance(creator.address);
    const rc2 = await (await coin.connect(creator).claimCreatorFees(true, 0, NO_ROUTE)).wait();
    const cAfter = await ethers.provider.getBalance(creator.address);
    expect(cAfter + rc2!.gasUsed * rc2!.gasPrice - cBefore).to.equal(creatorFees);
    expect(await coin.creatorFees()).to.equal(0n);

    // Holders: the trader earned WETH from the sell (creator held coins too, so shares split).
    const pending = await coin.pendingRewards(trader.address);
    expect(pending).to.be.gt(0n);
    await (await coin.connect(trader).claimRewards()).wait();
    expect(await weth.balanceOf(trader.address)).to.equal(pending);
    expect(await coin.pendingRewards(trader.address)).to.equal(0n);

    // Platform: anyone pushes it to the fee recipient, per coin or in bulk through the factory.
    const pf = await coin.platformFees();
    expect(pf).to.be.gt(0n);
    await expect(factory.connect(trader).pushPlatformFees([trader.address])).to.be.revertedWithCustomError(factory, "InvalidParams");
    await (await factory.connect(trader).pushPlatformFees([await coin.getAddress()])).wait();
    expect(await weth.balanceOf(admin.address)).to.equal(pf);
    expect(await coin.platformFees()).to.equal(0n);
  });

  it("SLVon pair: ETH first buy routes through V3 into the stock, router trades in ETH, fees land in SLVon, rewards claim as ETH", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    const coin = await launch(factory, creator, SLV, ethers.parseEther("0.2"), NVDA_ROUTE);
    const nvda = new ethers.Contract(SLV, ERC20, ethers.provider);

    const l = await factory.listings(await coin.getAddress());
    expect(l.pair).to.equal(SLV);
    expect(await coin.balanceOf(creator.address)).to.be.gt(SUPPLY / 100n);
    const devFee = await nvda.balanceOf(await coin.getAddress());
    expect(devFee).to.be.gt(0n); // 1% of the NVDAon spent

    await pastSnipe();
    await (await router.connect(trader).buy(await coin.getAddress(), NVDA_ROUTE, 0, { value: ethers.parseEther("0.05") })).wait();
    const got = await coin.balanceOf(trader.address);
    expect(got).to.be.gt(0n);
    expect(await nvda.balanceOf(await coin.getAddress())).to.be.gt(devFee);
    // Nothing sticks to the router.
    expect(await nvda.balanceOf(await router.getAddress())).to.equal(0n);
    expect(await ethers.provider.getBalance(await router.getAddress())).to.equal(0n);

    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    const ethBefore = await ethers.provider.getBalance(trader.address);
    const rc = await (await router.connect(trader).sell(await coin.getAddress(), got * 9n / 10n, NVDA_ROUTE, 0)).wait();
    const ethAfter = await ethers.provider.getBalance(trader.address);
    const back = ethAfter + rc!.gasUsed * rc!.gasPrice - ethBefore;
    expect(back).to.be.gt(ethers.parseEther("0.018")); // 90% back minus 2x4% fee, 2x1% SLVon pool, V3 fees and impact
    expect(back).to.be.lt(ethers.parseEther("0.045"));

    // Creator claims in the stock, then the trader's holder rewards as ETH.
    const cf = await coin.creatorFees();
    await (await coin.connect(creator).claimCreatorFees(false, 0, NO_ROUTE)).wait();
    expect(await nvda.balanceOf(creator.address)).to.equal(cf);
    const pending = await coin.pendingRewards(trader.address);
    expect(pending).to.be.gt(0n);
    const tBefore = await ethers.provider.getBalance(trader.address);
    const rc2 = await (await coin.connect(trader).claimRewardsAsEth(0, NVDA_ROUTE)).wait();
    const tAfter = await ethers.provider.getBalance(trader.address);
    expect(tAfter + rc2!.gasUsed * rc2!.gasPrice - tBefore).to.be.gt(0n);
  });

  it("stock with no V4 pool yet (ULon): the fee is held as a V4 claim, delivered on the next swap or when someone claims", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { hook, factory, router, pairs } = await deployAll(admin);
    const UL = "0x1598f7d25d0b0e1261eAB9BD2AD7924291EB26bB";
    await (await pairs.connect(admin).setQuoteAsset(UL, true, 64n * 10n ** 8n, ethers.ZeroAddress)).wait();
    const coin = await launch(factory, creator, UL);
    const coinAddr = await coin.getAddress();
    await pastSnipe();
    // Hand the trader 100 ULon by writing its balance slot (mapping at slot 0x33).
    const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [trader.address, ethers.zeroPadValue("0x33", 32)]));
    await network.provider.send("hardhat_setStorageAt", [UL, key, ethers.zeroPadValue(ethers.toBeHex(ethers.parseEther("100")), 32)]);
    const ul = new ethers.Contract(UL, ERC20, trader);
    expect(await ul.balanceOf(trader.address)).to.equal(ethers.parseEther("100"));
    expect(await ul.balanceOf(POOL_MANAGER)).to.equal(0n);

    // First buy: the PoolManager holds no ULon during afterSwap, so the fee is kept as a claim.
    await (await ul.approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).buyWithPair(coinAddr, ethers.parseEther("2"), 0)).wait();
    const held = await hook.owed(coinAddr);
    expect(held).to.equal(ethers.parseEther("2") * BigInt(TAX_BPS) / 10_000n);
    expect(await ul.balanceOf(coinAddr)).to.equal(0n);
    const creatorFees = await coin.creatorFees();
    expect(creatorFees).to.be.gt(0n);

    // Claiming pulls the held fee in through the hook first.
    const before = await ul.balanceOf(creator.address);
    await (await coin.connect(creator).claimCreatorFees(false, 0, NO_ROUTE)).wait();
    expect((await ul.balanceOf(creator.address)) - before).to.equal(creatorFees);
    expect(await hook.owed(coinAddr)).to.equal(0n);
    expect(await ul.balanceOf(coinAddr)).to.equal(held - creatorFees);

    // Second trade: the PoolManager now holds ULon, so the fee lands in the coin at once.
    const got = await coin.balanceOf(trader.address);
    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    await (await router.connect(trader).sellForPair(coinAddr, got / 2n, 0)).wait();
    expect(await hook.owed(coinAddr)).to.equal(0n);
    const pending = await coin.pendingRewards(trader.address);
    expect(pending).to.be.gt(0n);
    const t0 = await ul.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewards()).wait();
    expect((await ul.balanceOf(trader.address)) - t0).to.equal(pending);
    const platform = await coin.platformFees();
    expect(platform).to.be.gt(0n);
    await (await coin.connect(trader).claimPlatformFees()).wait();
    expect(await ul.balanceOf(await factory.feeRecipient())).to.be.gte(platform);
  });

  it("UNI pair (any approved token): ETH routes through the UNI/WETH V3 pool, fees and rewards land in UNI, price from the Chainlink feed", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router, pairs } = await deployAll(admin);
    // The feed prices the pair, not the admin's placeholder.
    const px = await pairs.pairUsdPrice(UNI);
    expect(px).to.be.gt(1n * 10n ** 8n);
    expect(px).to.not.equal(8n * 10n ** 8n);
    const coin = await launch(factory, creator, UNI, ethers.parseEther("0.1"), UNI_ROUTE);
    const coinAddr = await coin.getAddress();
    const uni = new ethers.Contract(UNI, ERC20, ethers.provider);
    expect(await coin.creatorFees()).to.be.gt(0n); // first buy paid its fee in UNI
    await pastSnipe();
    await (await router.connect(trader).buy(coinAddr, UNI_ROUTE, 0, { value: ethers.parseEther("0.05") })).wait();
    const got = await coin.balanceOf(trader.address);
    expect(got).to.be.gt(0n);
    // A second trader's buy pays the first holder in UNI.
    const [, , , other] = await ethers.getSigners();
    await (await router.connect(other).buy(coinAddr, UNI_ROUTE, 0, { value: ethers.parseEther("0.05") })).wait();
    const pending = await coin.pendingRewards(trader.address);
    expect(pending).to.be.gt(0n);
    const u0 = await uni.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewards()).wait();
    expect((await uni.balanceOf(trader.address)) - u0).to.equal(pending);
    // Creator claims straight as ETH along the same route.
    const e0 = await ethers.provider.getBalance(creator.address);
    const rc = await (await coin.connect(creator).claimCreatorFees(true, 0, UNI_ROUTE)).wait();
    expect((await ethers.provider.getBalance(creator.address)) + rc!.gasUsed * rc!.gasPrice - e0).to.be.gt(0n);
  });

  it("anti-snipe: 99% fee decaying over 30s goes to the platform; per-wallet caps (1%) for ten blocks; launch block is creator-only", async () => {
    const [admin, creator, sniper, other] = await ethers.getSigners();
    const { factory, router, hook } = await deployAll(admin);
    await network.provider.send("evm_setAutomine", [false]);
    // Launch and a sniper buy in the same block: the sniper is rejected.
    const tx1 = await factory.connect(creator).launch({ name: "Snipe", symbol: "SN", metadataURI: "", pair: WETH }, ethers.zeroPadValue("0x01", 32), NO_ROUTE);
    await network.provider.send("evm_mine", []);
    await tx1.wait();
    const coinAddr = await factory.allTokens(0);
    const coin = await ethers.getContractAt("AlicornToken", coinAddr);
    await network.provider.send("evm_setAutomine", [true]);

    // Next block, a second later: fee is ~99% and the surcharge is platform-only.
    const weth = new ethers.Contract(WETH, ERC20, ethers.provider);
    await (await router.connect(sniper).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("0.01") })).wait();
    const fee = await weth.balanceOf(coinAddr);
    expect(fee).to.be.gt(ethers.parseEther("0.008")); // ~89% of the 0.01 ETH two seconds in
    const platform = await coin.platformFees();
    expect(platform).to.be.gt(fee * 95n / 100n); // nearly all of it is surcharge
    // Only the base 4% slice reaches the creator (plus the holder share while nobody holds).
    expect(await coin.creatorFees()).to.be.lt(ethers.parseEther("0.0005"));

    // Still inside the block window: a wallet cannot take more than 1% of supply.
    await expect(router.connect(other).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("5") })).to.be.reverted;

    // After the window the fee is back to the base 4%.
    await pastSnipe();
    const id = (await factory.listings(coinAddr)).poolId;
    const [total, base] = await hook.feeBpsNow(id, sniper.address);
    expect(total).to.equal(TAX_BPS);
    expect(base).to.equal(TAX_BPS);
    const before = await weth.balanceOf(coinAddr);
    await (await router.connect(other).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("0.01") })).wait();
    expect((await weth.balanceOf(coinAddr)) - before).to.be.closeTo(ethers.parseEther("0.0004"), ethers.parseEther("0.000001"));
  });

  it("admin: pause, pair curation with a Chainlink feed, admin-only liquidity recovery, ownership renounce keeps the admin", async () => {
    const [admin, creator, stranger] = await ethers.getSigners();
    const { factory, hook, pairs } = await deployAll(admin);

    await expect(factory.connect(stranger).pause()).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(admin).pause()).wait();
    await expect(factory.connect(creator).launch({ name: "P", symbol: "P", metadataURI: "", pair: WETH }, ethers.ZeroHash, NO_ROUTE)).to.be.revertedWithCustomError(factory, "LaunchesPaused");
    await (await factory.connect(admin).resume()).wait();

    // A non-token (EOA) cannot register; a token without a deep WETH pool cannot either.
    await expect(factory.connect(creator).launch({ name: "X", symbol: "X", metadataURI: "", pair: creator.address }, ethers.ZeroHash, NO_ROUTE)).to.be.reverted;
    const dust = await (await ethers.getContractFactory("AlicornToken")).deploy("Dust", "DUST", "", SUPPLY, creator.address, creator.address, WETH, POOL_MANAGER, 5000, 3000);
    await expect(pairs.register(await dust.getAddress())).to.be.revertedWithCustomError(pairs, "NoPool");
    // A feed overrides the static price; stale feed falls back.
    const feed = await (await ethers.getContractFactory("MockAggregator")).deploy(250n * 10n ** 8n, 8);
    await (await pairs.connect(admin).setQuoteAsset(SLV, true, NVDA_USD_8, await feed.getAddress())).wait();
    expect(await pairs.pairUsdPrice(SLV)).to.equal(250n * 10n ** 8n);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await feed.setUpdatedAt(now - 8 * 24 * 3600)).wait(); // stale: back to the admin price
    expect(await pairs.pairUsdPrice(SLV)).to.equal(NVDA_USD_8);
    await expect(pairs.connect(stranger).setQuoteAsset(SLV, false, 0, ethers.ZeroAddress)).to.be.revertedWithCustomError(pairs, "NotAdmin");
    await (await pairs.connect(admin).setQuoteAsset(SLV, false, 0, ethers.ZeroAddress)).wait();
    await expect(factory.connect(creator).launch({ name: "X", symbol: "X", metadataURI: "", pair: SLV }, ethers.ZeroHash, NO_ROUTE)).to.be.revertedWithCustomError(pairs, "Blocked");
    // Admin can block a self-registrable token outright.
    await (await pairs.connect(admin).setBlocked(USDC, true)).wait();
    await expect(factory.connect(creator).launch({ name: "X", symbol: "X", metadataURI: "", pair: USDC }, ethers.ZeroHash, NO_ROUTE)).to.be.revertedWithCustomError(pairs, "Blocked");
    await (await pairs.connect(admin).setBlocked(USDC, false)).wait();
    expect(await pairs.quoteCount()).to.equal(3n); // WETH, SLVon, UNI

    // No collect / withdraw on the factory ABI; renounce keeps admin powers.
    // Liquidity recovery is admin-only: pull half of a launch position to any wallet.
    const lc = await launch(factory, creator, WETH);
    const lcAddr = await lc.getAddress();
    await pastSnipe(); // recovery sends coins from the PoolManager; inside the window that would hit the hold cap
    const before = await factory.positions(lcAddr);
    await expect(factory.connect(stranger).collect(lcAddr, 5000, stranger.address)).to.be.revertedWithCustomError(factory, "NotAdmin");
    await expect(factory.connect(admin).collect(lcAddr, 0, stranger.address)).to.be.revertedWithCustomError(factory, "InvalidParams");
    await (await factory.connect(admin).collect(lcAddr, 5000, stranger.address)).wait();
    const after = await factory.positions(lcAddr);
    expect(after.liquidity).to.equal(before.liquidity - before.liquidity / 2n);
    expect(await lc.balanceOf(stranger.address)).to.be.gt(0n);
    await (await factory.connect(admin).renounceOwnership()).wait();
    expect(await factory.owner()).to.equal(ethers.ZeroAddress);
    await (await pairs.connect(admin).renounceOwnership()).wait();
    expect(await pairs.owner()).to.equal(ethers.ZeroAddress);
    await (await factory.connect(admin).setFeeRecipient(stranger.address)).wait();
    expect(await factory.feeRecipient()).to.equal(stranger.address);
    await expect(hook.connect(admin).setFactory(stranger.address)).to.be.revertedWithCustomError(hook, "AlreadySet");
  });
  it("any token: USDC (6 decimals) registers itself at launch from its deepest WETH pool; priced from the pool; ETH routes through it; fees and rewards in USDC; claim as ETH", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router, pairs } = await deployAll(admin);
    const usdc = new ethers.Contract(USDC, ERC20, admin);

    // Preview: not registered yet, but registrable from the 0.05% WETH/USDC pool at about $1.
    const pv = await pairs.preview(USDC);
    expect(pv.ok).to.equal(true);
    expect(pv.approved).to.equal(false);
    expect(pv.decimals).to.equal(6);
    expect(pv.v3Fee).to.equal(500);
    expect(pv.poolWeth).to.be.gt(ethers.parseEther("1"));
    expect(pv.usdPrice8).to.be.closeTo(10n ** 8n, 3n * 10n ** 6n);

    // Launch with a first buy: the factory registers USDC in the same transaction.
    const ethIn = ethers.parseEther("0.01");
    const coin = await launch(factory, creator, USDC, ethIn, USDC_ROUTE);
    const coinAddr = await coin.getAddress();
    const q = await pairs.quoteAssets(USDC);
    expect(q.approved).to.equal(true);
    expect(q.v3Fee).to.equal(500);
    expect(await pairs.routeOf(USDC)).to.equal(USDC_ROUTE);
    expect(await pairs.quoteCount()).to.equal(4n);
    // Opening cap is $3,000: 0.01 ETH buys about ethUsd/100 / 3000 of the supply.
    const ethUsd = Number(await pairs.ethUsdPrice()) / 1e8;
    const expectShare = (ethUsd * 0.01) / 3000;
    const got = Number(await coin.balanceOf(creator.address)) / 1e27;
    expect(got).to.be.gt(expectShare * 0.6);
    expect(got).to.be.lt(expectShare * 1.05);

    await pastSnipe();
    const before = await usdc.balanceOf(coinAddr);
    await (await router.connect(trader).buy(coinAddr, USDC_ROUTE, 0, { value: ethers.parseEther("0.05") })).wait();
    expect(await coin.balanceOf(trader.address)).to.be.gt(0n);
    const fee = (await usdc.balanceOf(coinAddr)) - before;
    // 4% of ~0.05 ETH worth of USDC, 6 decimals.
    expect(Number(fee) / 1e6).to.be.closeTo(0.05 * ethUsd * 0.04, 0.05 * ethUsd * 0.04 * 0.2);
    expect(await coin.totalHolderRewards()).to.be.closeTo((fee * 3n) / 10n, fee / 50n);

    // Holder rewards accrue in USDC with 6-decimal precision; creator claims as ETH.
    const pending = await coin.pendingRewards(creator.address);
    expect(pending).to.be.gt(0n);
    const ub = await usdc.balanceOf(creator.address);
    await (await coin.connect(creator).claimRewards()).wait();
    expect((await usdc.balanceOf(creator.address)) - ub).to.equal(pending);
    const eb = await ethers.provider.getBalance(creator.address);
    const rc = await (await coin.connect(creator).claimCreatorFees(true, 0, USDC_ROUTE)).wait();
    expect((await ethers.provider.getBalance(creator.address)) + rc!.gasUsed * rc!.gasPrice - eb).to.be.gt(0n);

    // Selling routes back USDC -> WETH -> ETH.
    const bal = await coin.balanceOf(trader.address);
    await (await coin.connect(trader).approve(await router.getAddress(), bal)).wait();
    const tb = await ethers.provider.getBalance(trader.address);
    const rs = await (await router.connect(trader).sell(coinAddr, bal / 2n, USDC_ROUTE, 0)).wait();
    expect((await ethers.provider.getBalance(trader.address)) + rs!.gasUsed * rs!.gasPrice - tb).to.be.gt(0n);
  });

});
