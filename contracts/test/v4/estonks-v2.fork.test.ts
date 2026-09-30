import { expect } from "chai";
import { ethers, network } from "hardhat";

// Estonks v2 on an Ethereum mainnet fork: real Uniswap V4 PoolManager, V3
// SwapRouter02, WETH and Ondo stocks.
//   FORK=1 ROBINHOOD_RPC_URL=https://ethereum-rpc.publicnode.com ROBINHOOD_CHAIN_ID=1 BLOCK_GAS_LIMIT=16000000 \
//   HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat test test/v4/estonks-v2.fork.test.ts
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ROUTER02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const NVDA = "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE";
const UL = "0x1598f7d25d0b0e1261eAB9BD2AD7924291EB26bB";
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
// NVDAon's deepest pool today: Uniswap V3 NVDAon/USDC 0.3%. Route: WETH -(0.05%)-> USDC -(0.3%)-> NVDAon.
const NVDA_ROUTE = ethers.AbiCoder.defaultAbiCoder().encode(
  ["bytes", KEY_T],
  [ethers.solidityPacked(["address", "uint24", "address", "uint24", "address"], [WETH, 500, USDC, 3000, NVDA]), EMPTY_KEY],
);
const NO_ROUTE = "0x";
const ETH_USD_8 = 2_700n * 10n ** 8n;
const NVDA_USD_8 = 229n * 10n ** 8n;
const SUPPLY = 10n ** 27n;
const TAX_BPS = 200n; // 2%
const CREATOR_BPS = 3500n, HOLDER_BPS = 1500n; // platform: the rest, 50%

const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"];

let saltN = 1n;
const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(saltN++), 32);

async function deployAll(admin: any) {
  const deployer = (await ethers.getSigners())[9]; // separate from the admin
  const c2 = await (await ethers.getContractFactory("HookDeployer", deployer)).deploy();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("EstonksHook");
  const hookInit = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address"], [POOL_MANAGER])]);
  const hookHash = ethers.keccak256(hookInit);
  let hookAddr = "", salt = "";
  for (let i = 0n; i < 2_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hookHash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
  }
  await (await c2.deploy(salt, hookInit)).wait();
  const hook = await ethers.getContractAt("EstonksHook", hookAddr, deployer);
  const td = await (await ethers.getContractFactory("EstonksTokenDeployer", deployer)).deploy();
  const factory = await (await ethers.getContractFactory("EstonksFactory", deployer)).deploy(
    deployer.address, admin.address, POOL_MANAGER, hookAddr, await td.getAddress(), WETH, ETH_USD_8, TAX_BPS, CREATOR_BPS, HOLDER_BPS,
  );
  const fAddr = await factory.getAddress();
  await (await td.setFactory(fAddr)).wait();
  await (await hook.setFactory(fAddr)).wait();
  const router = await (await ethers.getContractFactory("EstonksRouter", deployer)).deploy(POOL_MANAGER, fAddr, WETH, ROUTER02);
  await (await factory.setConverter(await router.getAddress())).wait();
  await (await factory.setQuoteAsset(NVDA, true, NVDA_USD_8, ethers.ZeroAddress)).wait();
  return { hook, factory, router, td, deployer };
}

async function launch(factory: any, creator: any, pair: string, ethIn = 0n, route = NO_ROUTE, meta = '{"description":"fork test"}') {
  const n = Number(await factory.totalTokens());
  await (await factory.connect(creator).launch({ name: "Test Coin", symbol: "TC", metadataURI: meta, pair, minPairOut: 0 }, nextSalt(), route, { value: ethIn })).wait();
  return ethers.getContractAt("EstonksToken", await factory.allTokens(n));
}

async function pastSnipe() {
  await network.provider.send("evm_increaseTime", [30]);
  for (let i = 0; i < 3; i++) await network.provider.send("evm_mine", []);
}

/** Every pair-asset unit the coin owes is backed: owed <= reserved <= balance, and the gap is rounding dust. */
async function expectSolvent(coin: any, pairAddr: string, holders: string[]) {
  const pair = new ethers.Contract(pairAddr, ERC20, ethers.provider);
  const coinAddr = await coin.getAddress();
  const bal = await pair.balanceOf(coinAddr);
  const reserved = await coin.reserved();
  let owed = (await coin.creatorFees()) + (await coin.platformFees());
  for (const h of holders) owed += await coin.pendingRewards(h);
  expect(reserved).to.be.lte(bal);
  expect(owed).to.be.lte(reserved);
  expect(reserved - owed).to.be.lte(1000n); // wei-level accumulator dust
}

describe("Estonks v2 (mainnet fork)", function () {
  this.timeout(900_000);

  it("the coin has no privileged function; the hook has no fee setter; the factory has no tax setter", async () => {
    const coinAbi = (await ethers.getContractFactory("EstonksToken")).interface;
    const writes = coinAbi.fragments.filter((f: any) => f.type === "function" && !["view", "pure"].includes(f.stateMutability)).map((f: any) => f.name).sort();
    // Standard ERC20 writes plus permissionless or self-serve actions only.
    expect(writes).to.deep.equal(["approve", "burn", "claimFor", "claimRewards", "claimRewardsAsEth", "fund", "payCreator", "payPlatform", "sync", "transfer", "transferFrom"]);
    const hookAbi = (await ethers.getContractFactory("EstonksHook")).interface;
    expect(hookAbi.getFunction("setPoolTax")).to.equal(null);
    const facAbi = (await ethers.getContractFactory("EstonksFactory")).interface;
    expect(facAbi.getFunction("setCoinTax")).to.equal(null);
  });

  it("WETH pair: dev buy pays the base fee; trades split 35/15/50 exactly; anyone pays creator and platform; holders claim in WETH or ETH", async () => {
    const [admin, creator, trader, stranger] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    const coin = await launch(factory, creator, WETH, ethers.parseEther("0.1"));
    const coinAddr = await coin.getAddress();
    const weth = new ethers.Contract(WETH, ERC20, ethers.provider);

    expect(await coin.owner()).to.equal(ethers.ZeroAddress);
    expect(await coin.balanceOf(creator.address)).to.be.gt(SUPPLY / 100n);
    const fee0 = await weth.balanceOf(coinAddr);
    expect(fee0).to.equal(ethers.parseEther("0.1") * TAX_BPS / 10_000n); // exactly 2%, no snipe surcharge
    expect(await coin.reserved()).to.equal(fee0); // synced by the hook
    expect(await coin.platformFees()).to.equal(fee0 - fee0 * HOLDER_BPS / 10_000n - fee0 * CREATOR_BPS / 10_000n);

    await pastSnipe();
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("0.05") })).wait();
    const got = await coin.balanceOf(trader.address);
    const fee1 = (await weth.balanceOf(coinAddr)) - fee0;
    expect(fee1).to.equal(ethers.parseEther("0.05") * TAX_BPS / 10_000n);
    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    await (await router.connect(trader).sell(coinAddr, got / 2n, NO_ROUTE, 0)).wait();
    expect(await coin.unsynced()).to.equal(0n);
    await expectSolvent(coin, WETH, [creator.address, trader.address]);

    // Lifetime split: platform exactly 50%; creator + holders the other 50% (the dev buy's fee lands
    // before anyone holds, so its holder slice goes to the creator by design).
    const total = await weth.balanceOf(coinAddr);
    const [tc, th, tp] = [await coin.totalCreatorFees(), await coin.totalHolderRewards(), await coin.totalPlatformFees()];
    expect(tc + th + tp).to.equal(total);
    expect(tp * 10_000n / total).to.be.closeTo(5000n, 1n);
    expect((tc + th) * 10_000n / total).to.be.closeTo(5000n, 1n);
    expect(th).to.be.gt(0n);

    // Creator share: anyone pushes it, it always lands with the creator.
    const cf = await coin.creatorFees();
    const cw = await weth.balanceOf(creator.address);
    await (await coin.connect(stranger).payCreator()).wait();
    expect((await weth.balanceOf(creator.address)) - cw).to.equal(cf);
    expect(await coin.creatorFees()).to.equal(0n);

    // Holder claims: in WETH, and as native ETH.
    const pt = await coin.pendingRewards(trader.address);
    expect(pt).to.be.gt(0n);
    await (await coin.connect(trader).claimRewards()).wait();
    expect(await weth.balanceOf(trader.address)).to.equal(pt);
    const pc = await coin.pendingRewards(creator.address);
    const e0 = await ethers.provider.getBalance(creator.address);
    const rc = await (await coin.connect(creator).claimRewardsAsEth(0, NO_ROUTE)).wait();
    expect((await ethers.provider.getBalance(creator.address)) + rc!.gasUsed * rc!.gasPrice - e0).to.equal(pc);

    // Platform share: pushed to the fee recipient by anyone, per coin or in bulk.
    const pf = await coin.platformFees();
    await expect(factory.connect(stranger).pushPlatformFees([stranger.address])).to.be.revertedWithCustomError(factory, "InvalidParams");
    await (await factory.connect(stranger).pushPlatformFees([coinAddr])).wait();
    expect(await weth.balanceOf(admin.address)).to.equal(pf);
    await expectSolvent(coin, WETH, [creator.address, trader.address]);
    expect(await weth.balanceOf(await router.getAddress())).to.equal(0n);
  });

  it("donations: a plain transfer plus sync() is split like a fee; fund() goes to holders only; sync is idempotent", async () => {
    const [admin, creator, trader, donor] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    const coin = await launch(factory, creator, WETH, ethers.parseEther("0.05"));
    const coinAddr = await coin.getAddress();
    await pastSnipe();
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("0.05") })).wait();
    const wethW = await ethers.getContractAt(["function deposit() payable", ...ERC20], WETH, donor);
    await (await wethW.deposit({ value: ethers.parseEther("1") })).wait();

    const [c0, p0, h0] = [await coin.creatorFees(), await coin.platformFees(), await coin.totalHolderRewards()];
    await (await wethW.transfer(coinAddr, ethers.parseEther("0.1"))).wait();
    expect(await coin.unsynced()).to.equal(ethers.parseEther("0.1"));
    await (await coin.connect(donor).sync()).wait();
    await (await coin.connect(donor).sync()).wait(); // nothing new: no double count
    expect((await coin.creatorFees()) - c0).to.equal(ethers.parseEther("0.035"));
    expect((await coin.platformFees()) - p0).to.equal(ethers.parseEther("0.05"));
    expect((await coin.totalHolderRewards()) - h0).to.equal(ethers.parseEther("0.015"));

    const h1 = await coin.totalHolderRewards();
    const c1 = await coin.creatorFees();
    await (await wethW.approve(coinAddr, ethers.parseEther("0.2"))).wait();
    await (await coin.connect(donor).fund(ethers.parseEther("0.2"))).wait();
    expect((await coin.totalHolderRewards()) - h1).to.equal(ethers.parseEther("0.2"));
    expect(await coin.creatorFees()).to.equal(c1);
    await expectSolvent(coin, WETH, [creator.address, trader.address]);
  });

  it("NVDAon pair: ETH first buy routes through V3 into the stock, router trades in ETH, fees land in NVDAon, rewards claim as ETH", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    await expect(factory.connect(creator).launch({ name: "G", symbol: "G", metadataURI: "", pair: NVDA, minPairOut: ethers.parseEther("1000") }, nextSalt(), NVDA_ROUTE, { value: ethers.parseEther("0.05") }))
      .to.be.revertedWithCustomError(router, "Slippage"); // first-buy floor on the ETH -> stock leg
    const coin = await launch(factory, creator, NVDA, ethers.parseEther("0.05"), NVDA_ROUTE);
    const coinAddr = await coin.getAddress();
    const nvda = new ethers.Contract(NVDA, ERC20, ethers.provider);
    expect((await factory.listings(coinAddr)).pair).to.equal(NVDA);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n);
    expect(await nvda.balanceOf(coinAddr)).to.be.gt(0n);

    await pastSnipe();
    await (await router.connect(trader).buy(coinAddr, NVDA_ROUTE, 0, { value: ethers.parseEther("0.03") })).wait();
    const got = await coin.balanceOf(trader.address);
    expect(got).to.be.gt(0n);
    expect(await nvda.balanceOf(await router.getAddress())).to.equal(0n);
    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    const e0 = await ethers.provider.getBalance(trader.address);
    const rc = await (await router.connect(trader).sell(coinAddr, got / 2n, NVDA_ROUTE, 0)).wait();
    expect((await ethers.provider.getBalance(trader.address)) + rc!.gasUsed * rc!.gasPrice - e0).to.be.gt(0n);
    await expectSolvent(coin, NVDA, [creator.address, trader.address]);

    const cf = await coin.creatorFees();
    await (await coin.connect(trader).payCreator()).wait();
    expect(await nvda.balanceOf(creator.address)).to.equal(cf);
    const t0 = await ethers.provider.getBalance(trader.address);
    const rc2 = await (await coin.connect(trader).claimRewardsAsEth(0, NVDA_ROUTE)).wait();
    expect((await ethers.provider.getBalance(trader.address)) + rc2!.gasUsed * rc2!.gasPrice - t0).to.be.gt(0n);
    await expectSolvent(coin, NVDA, [creator.address, trader.address]);
  });

  it("stock with no V4 pool (ULon): the fee is held as a claim, credited when delivered, and payouts pull it in first", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { hook, factory, router } = await deployAll(admin);
    await (await factory.connect(admin).setQuoteAsset(UL, true, 64n * 10n ** 8n, ethers.ZeroAddress)).wait();
    const coin = await launch(factory, creator, UL);
    const coinAddr = await coin.getAddress();
    await pastSnipe();
    const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [trader.address, ethers.zeroPadValue("0x33", 32)]));
    await network.provider.send("hardhat_setStorageAt", [UL, key, ethers.zeroPadValue(ethers.toBeHex(ethers.parseEther("100")), 32)]);
    const ul = new ethers.Contract(UL, ERC20, trader);
    expect(await ul.balanceOf(trader.address)).to.equal(ethers.parseEther("100"));

    await (await ul.approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).buyWithPair(coinAddr, ethers.parseEther("2"), 0)).wait();
    const held = await hook.owed(coinAddr);
    expect(held).to.equal(ethers.parseEther("2") * TAX_BPS / 10_000n);
    expect(await coin.creatorFees()).to.equal(0n); // not credited until delivered

    // payCreator pulls the held fee through the hook, credits it, then pays.
    await (await coin.connect(trader).payCreator()).wait();
    expect(await hook.owed(coinAddr)).to.equal(0n);
    expect(await ul.balanceOf(creator.address)).to.equal(held * CREATOR_BPS / 10_000n);
    expect(await coin.totalHolderRewards()).to.equal(held * HOLDER_BPS / 10_000n);
    await expectSolvent(coin, UL, [creator.address, trader.address]);

    // Next trade: the PoolManager now holds ULon, so the fee is delivered and credited at once.
    const got = await coin.balanceOf(trader.address);
    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    await (await router.connect(trader).sellForPair(coinAddr, got / 2n, 0)).wait();
    expect(await hook.owed(coinAddr)).to.equal(0n);
    expect(await coin.unsynced()).to.equal(0n);
    const pending = await coin.pendingRewards(trader.address);
    const t0 = await ul.balanceOf(trader.address);
    await (await coin.connect(trader).claimRewards()).wait();
    expect((await ul.balanceOf(trader.address)) - t0).to.equal(pending);
    await expectSolvent(coin, UL, [creator.address, trader.address]);
  });

  it("launch protection: creator-only launch block, 3% caps for three blocks, 99% fee decaying to 2% over 20s", async () => {
    const [admin, creator, sniper, other] = await ethers.getSigners();
    const { factory, router, hook } = await deployAll(admin);
    await network.provider.send("evm_setAutomine", [false]);
    const tx1 = await factory.connect(creator).launch({ name: "Snipe", symbol: "SN", metadataURI: "", pair: WETH, minPairOut: 0 }, nextSalt(), NO_ROUTE);
    const n = Number(await factory.totalTokens());
    await network.provider.send("evm_mine", []);
    await tx1.wait();
    const coinAddr = await factory.allTokens(n);
    await network.provider.send("evm_setAutomine", [true]);
    const weth = new ethers.Contract(WETH, ERC20, ethers.provider);

    await (await router.connect(sniper).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("0.01") })).wait();
    expect(await weth.balanceOf(coinAddr)).to.be.gt(ethers.parseEther("0.008"));
    await expect(router.connect(other).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("5") })).to.be.reverted;

    await pastSnipe();
    const id = (await factory.listings(coinAddr)).poolId;
    const [total, base] = await hook.feeBpsNow(id, sniper.address);
    expect(total).to.equal(TAX_BPS);
    expect(base).to.equal(TAX_BPS);
  });

  it("admin: pause, pairs, hide, metadata edits stored in the factory, collect, renounce keeps the admin; nothing touches fees or balances", async () => {
    const [admin, creator, stranger] = await ethers.getSigners();
    const { factory, hook, deployer } = await deployAll(admin);

    await expect(factory.connect(stranger).pause()).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(admin).pause()).wait();
    await expect(factory.connect(creator).launch({ name: "P", symbol: "P", metadataURI: "", pair: WETH, minPairOut: 0 }, nextSalt(), NO_ROUTE)).to.be.revertedWithCustomError(factory, "LaunchesPaused");
    await (await factory.connect(admin).resume()).wait();
    await expect(factory.connect(creator).launch({ name: "X", symbol: "X", metadataURI: "", pair: creator.address, minPairOut: 0 }, nextSalt(), NO_ROUTE)).to.be.revertedWithCustomError(factory, "QuoteNotApproved");

    const coin = await launch(factory, creator, WETH, 0n, NO_ROUTE, '{"description":"original"}');
    const coinAddr = await coin.getAddress();
    await expect(factory.connect(stranger).setCoinMetadata(coinAddr, "x")).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(admin).setCoinMetadata(coinAddr, '{"description":"edited"}')).wait();
    expect(await factory.metadataOf(coinAddr)).to.equal('{"description":"edited"}');
    expect(await coin.metadataURI()).to.equal('{"description":"original"}'); // the coin never changes
    await (await factory.connect(admin).setCoinMetadata(coinAddr, "")).wait();
    expect(await factory.metadataOf(coinAddr)).to.equal('{"description":"original"}');

    await (await factory.connect(admin).setHidden(coinAddr, true)).wait();
    expect(await factory.hidden(coinAddr)).to.equal(true);

    const before = await factory.positions(coinAddr);
    await expect(factory.connect(stranger).collect(coinAddr, 5000, stranger.address)).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(admin).collect(coinAddr, 5000, admin.address)).wait();
    expect((await factory.positions(coinAddr)).liquidity).to.equal(before.liquidity - before.liquidity / 2n);

    await expect(factory.connect(stranger).renounceOwnership()).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(deployer).renounceOwnership()).wait();
    expect(await factory.owner()).to.equal(ethers.ZeroAddress);
    await expect(factory.connect(deployer).setQuoteAsset(NVDA, false, 0, ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "NotAdmin");
    await (await factory.connect(admin).setQuoteAsset(NVDA, false, 0, ethers.ZeroAddress)).wait(); // the admin keeps its powers
    await (await factory.connect(admin).setFeeRecipient(stranger.address)).wait();
    expect(await factory.feeRecipient()).to.equal(stranger.address);
    await expect(hook.connect(deployer).setFactory(stranger.address)).to.be.revertedWithCustomError(hook, "AlreadySet");
    await expect(hook.connect(stranger).setFactory(stranger.address)).to.be.revertedWithCustomError(hook, "NotDeployer");
    const id = (await factory.listings(coinAddr)).poolId;
    expect((await hook.config(id)).taxBps).to.equal(TAX_BPS);
  });
});
