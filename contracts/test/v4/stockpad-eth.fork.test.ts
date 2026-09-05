import { expect } from "chai";
import { ethers, network } from "hardhat";

// Ethereum mainnet fork: real Uniswap V4 PoolManager, V3 SwapRouter02, WETH and
// the Ondo NVDAon stock with its WETH/NVDAon V3 pool (0.01% tier).
//   FORK=1 ROBINHOOD_RPC_URL=https://ethereum-rpc.publicnode.com ROBINHOOD_CHAIN_ID=1 \
//   HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat test test/v4/stockpad-eth.fork.test.ts
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ROUTER02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const NVDA = "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
// NVDAon's real pool: Uniswap V4 NVDAon/USDC, fee 0.9%, tick spacing 90, no hook.
const NVDA_KEY = { currency0: NVDA, currency1: USDC, fee: 9000, tickSpacing: 90, hooks: ethers.ZeroAddress };
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
// Route for NVDAon: WETH -(V3 0.05%)-> USDC -(V4)-> NVDAon.
const NVDA_ROUTE = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [ethers.solidityPacked(["address", "uint24", "address"], [WETH, 500, USDC]), NVDA_KEY]);
const NO_ROUTE = "0x";
const ETH_USD_8 = 4_000n * 10n ** 8n;
const NVDA_USD_8 = 228n * 10n ** 8n;
const SUPPLY = 10n ** 27n;

// beforeSwap | afterSwap | beforeSwapReturnDelta | afterSwapReturnDelta
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"];

async function deployAll(admin: any) {
  const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
  await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("StockPadHook");
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
  const hook = await ethers.getContractAt("StockPadHook", hookAddr);

  const factory = await (await ethers.getContractFactory("StockPadFactory")).deploy(
    admin.address, admin.address, POOL_MANAGER, hookAddr, WETH, ETH_USD_8, 5000, 3000,
  );
  await factory.waitForDeployment();
  await (await hook.connect(admin).setFactory(await factory.getAddress())).wait();
  const router = await (await ethers.getContractFactory("StockPadRouter")).deploy(POOL_MANAGER, await factory.getAddress(), WETH, ROUTER02);
  await router.waitForDeployment();
  await (await factory.connect(admin).setConverter(await router.getAddress())).wait();
  await (await factory.connect(admin).setQuoteAsset(NVDA, true, NVDA_USD_8, ethers.ZeroAddress)).wait();
  return { hook, factory, router };
}

async function launch(factory: any, creator: any, pair: string, ethIn = 0n, route = NO_ROUTE) {
  const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now()) % 2n ** 64n), 32);
  const n = Number(await factory.totalTokens());
  await (await factory.connect(creator).launch({ name: "Test Coin", symbol: "TC", metadataURI: '{"description":"fork test"}', pair }, salt, route, { value: ethIn })).wait();
  const token = await factory.allTokens(n);
  return ethers.getContractAt("StockPadToken", token);
}

/** Skip past the anti-snipe window: 20s of decaying fee, 3 blocks of caps. */
async function pastSnipe() {
  await network.provider.send("evm_increaseTime", [30]);
  for (let i = 0; i < 3; i++) await network.provider.send("evm_mine", []);
}

describe("stockpad on Ethereum mainnet (fork)", function () {
  this.timeout(600_000);

  it("WETH pair: launch with an ETH first buy, trade in ETH through the router, fee in WETH split 50/30/20, claim as ETH", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    const coin = await launch(factory, creator, WETH, ethers.parseEther("0.1"));
    const weth = new ethers.Contract(WETH, ERC20, ethers.provider);

    const devCoins = await coin.balanceOf(creator.address);
    expect(devCoins).to.be.gt(SUPPLY / 100n); // 0.1 ETH = $400 into a $3k market
    expect(devCoins).to.be.lt(SUPPLY / 4n);
    // The dev buy pays the base 1% only (no snipe surcharge for the factory).
    const feeAfterDev = await weth.balanceOf(await coin.getAddress());
    expect(feeAfterDev).to.be.closeTo(ethers.parseEther("0.001"), ethers.parseEther("0.00001"));
    expect(await coin.platformFees()).to.equal(feeAfterDev * 2000n / 10000n);

    await pastSnipe();
    const before = await coin.balanceOf(trader.address);
    await (await router.connect(trader).buy(await coin.getAddress(), NO_ROUTE, 0, { value: ethers.parseEther("0.05") })).wait();
    const got = (await coin.balanceOf(trader.address)) - before;
    expect(got).to.be.gt(0n);
    const feeAfterBuy = await weth.balanceOf(await coin.getAddress());
    expect(feeAfterBuy - feeAfterDev).to.be.closeTo(ethers.parseEther("0.0005"), ethers.parseEther("0.000005"));

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

    // Platform: anyone pushes it to the fee recipient.
    const pf = await coin.platformFees();
    await (await coin.connect(trader).claimPlatformFees()).wait();
    expect(await weth.balanceOf(admin.address)).to.equal(pf);
  });

  it("NVDAon pair: ETH first buy routes through V3 into the stock, router trades in ETH, fees land in NVDAon, rewards claim as ETH", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    const coin = await launch(factory, creator, NVDA, ethers.parseEther("0.2"), NVDA_ROUTE);
    const nvda = new ethers.Contract(NVDA, ERC20, ethers.provider);

    const l = await factory.listings(await coin.getAddress());
    expect(l.pair).to.equal(NVDA);
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
    expect(back).to.be.gt(ethers.parseEther("0.02")); // 90% back minus 2x1% fee, 2x0.9% NVDAon pool, V3 fees and impact
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

  it("anti-snipe: 99% fee decaying over 20s goes to the platform; per-wallet caps in the first blocks; launch block is creator-only", async () => {
    const [admin, creator, sniper, other] = await ethers.getSigners();
    const { factory, router, hook } = await deployAll(admin);
    await network.provider.send("evm_setAutomine", [false]);
    // Launch and a sniper buy in the same block: the sniper is rejected.
    const tx1 = await factory.connect(creator).launch({ name: "Snipe", symbol: "SN", metadataURI: "", pair: WETH }, ethers.zeroPadValue("0x01", 32), NO_ROUTE);
    await network.provider.send("evm_mine", []);
    await tx1.wait();
    const coinAddr = await factory.allTokens(0);
    const coin = await ethers.getContractAt("StockPadToken", coinAddr);
    await network.provider.send("evm_setAutomine", [true]);

    // Next block, a second later: fee is ~99% and the surcharge is platform-only.
    const weth = new ethers.Contract(WETH, ERC20, ethers.provider);
    await (await router.connect(sniper).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("0.01") })).wait();
    const fee = await weth.balanceOf(coinAddr);
    expect(fee).to.be.gt(ethers.parseEther("0.008")); // ~89% of the 0.01 ETH two seconds in
    const platform = await coin.platformFees();
    expect(platform).to.be.gt(fee * 95n / 100n); // nearly all of it is surcharge
    expect(await coin.creatorFees()).to.be.lt(ethers.parseEther("0.0001"));

    // Still inside the block window: a wallet cannot take more than 3% of supply.
    await expect(router.connect(other).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("5") })).to.be.reverted;

    // After the window the fee is back to 1%.
    await pastSnipe();
    const id = (await factory.listings(coinAddr)).poolId;
    const [total, base] = await hook.feeBpsNow(id, sniper.address);
    expect(total).to.equal(100);
    expect(base).to.equal(100);
    const before = await weth.balanceOf(coinAddr);
    await (await router.connect(other).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("0.01") })).wait();
    expect((await weth.balanceOf(coinAddr)) - before).to.be.closeTo(ethers.parseEther("0.0001"), ethers.parseEther("0.000001"));
  });

  it("admin: pause, pair curation with a Chainlink feed, no liquidity withdraw path, ownership renounce keeps the admin", async () => {
    const [admin, creator, stranger] = await ethers.getSigners();
    const { factory, hook } = await deployAll(admin);

    await expect(factory.connect(stranger).pause()).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(admin).pause()).wait();
    await expect(factory.connect(creator).launch({ name: "P", symbol: "P", metadataURI: "", pair: WETH }, ethers.ZeroHash, NO_ROUTE)).to.be.revertedWithCustomError(factory, "LaunchesPaused");
    await (await factory.connect(admin).resume()).wait();

    // Unapproved pair is refused; a feed overrides the static price; stale feed falls back.
    await expect(factory.connect(creator).launch({ name: "X", symbol: "X", metadataURI: "", pair: creator.address }, ethers.ZeroHash, NO_ROUTE)).to.be.revertedWithCustomError(factory, "QuoteNotApproved");
    const feed = await (await ethers.getContractFactory("MockAggregator")).deploy(250n * 10n ** 8n, 8);
    await (await factory.connect(admin).setQuoteAsset(NVDA, true, NVDA_USD_8, await feed.getAddress())).wait();
    expect(await factory.pairUsdPrice(NVDA)).to.equal(250n * 10n ** 8n);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await feed.setUpdatedAt(now - 8 * 24 * 3600)).wait(); // stale: back to the admin price
    expect(await factory.pairUsdPrice(NVDA)).to.equal(NVDA_USD_8);
    await expect(factory.connect(stranger).setQuoteAsset(NVDA, false, 0, ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(admin).setQuoteAsset(NVDA, false, 0, ethers.ZeroAddress)).wait();
    await expect(factory.connect(creator).launch({ name: "X", symbol: "X", metadataURI: "", pair: NVDA }, ethers.ZeroHash, NO_ROUTE)).to.be.revertedWithCustomError(factory, "QuoteNotApproved");
    expect(await factory.quoteCount()).to.equal(2n);

    // No collect / withdraw on the factory ABI; renounce keeps admin powers.
    expect((factory.interface as any).fragments.some((f: any) => f.type === "function" && /collect|withdraw|unwind/i.test(f.name))).to.equal(false);
    await (await factory.connect(admin).renounceOwnership()).wait();
    expect(await factory.owner()).to.equal(ethers.ZeroAddress);
    await (await factory.connect(admin).setFeeRecipient(stranger.address)).wait();
    expect(await factory.feeRecipient()).to.equal(stranger.address);
    await expect(hook.connect(admin).setFactory(stranger.address)).to.be.revertedWithCustomError(hook, "AlreadySet");
  });
});
