import { expect } from "chai";
import { ethers } from "hardhat";

// HyperEVM (Hyperliquid, chainId 999) — HyperSwap V3 (standard Uniswap V3).
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
const WHYPE = "0x5555555555555555555555555555555555555555";

const SUPPLY = ethers.parseEther("1000000000");
const BPS = 10_000n;
const CREATOR_BPS = 8_000n;

// Launch model on HyperSwap V3: plain, ownerless, tax-free ERC20; full supply
// seeded single-sided into the coin's own HyperSwap V3 pool at a target market
// cap; the position is held by the factory forever; the pool's 1% fee tier is
// the trading cost, and those fees are harvested 80% creator / 20% platform.
// This fork test runs the whole lifecycle against the LIVE HyperSwap V3 factory
// and a real WHYPE pool: launch, buy, sell, harvest, owner-collect.
describe("HyperSwap launchpad: WHYPE-paired V3, 1% fee harvested 80/20 (fork)", function () {
  this.timeout(600_000);
  if (process.env.FORK !== "1") { it.skip("requires FORK=1", () => {}); return; }

  async function deploySystem(owner: any, feeRecipient: any) {
    const tokenDeployer = await (await ethers.getContractFactory("TokenDeployer")).deploy();
    await tokenDeployer.waitForDeployment();

    const factory = await (await ethers.getContractFactory("ArcLaunchpadFactory")).deploy(
      owner.address, feeRecipient.address, await tokenDeployer.getAddress(), V3_FACTORY, WHYPE,
    );
    await factory.waitForDeployment();
    await (await tokenDeployer.setFactory(await factory.getAddress())).wait();

    const router = await (await ethers.getContractFactory("HyperSwapRouter")).deploy(V3_FACTORY, WHYPE);
    await router.waitForDeployment();
    return { tokenDeployer, factory, router };
  }

  async function createToken(factory: any, creator: any) {
    const p = { name: "Hyper Coin", symbol: "HYPC", metadataURI: JSON.stringify({ description: "test" }), quote: WHYPE, marketCapUsd8: 0n };
    const rc = await (await factory.connect(creator).createToken(p)).wait();
    const ev = rc.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "TokenCreated");
    return ev.args.token as string;
  }

  it("launches a coin into a live HyperSwap V3 pool holding ~full supply at the 1% tier", async () => {
    const [, owner, feeRecipient, creator] = await ethers.getSigners();
    const { factory } = await deploySystem(owner, feeRecipient);
    const token = await createToken(factory, creator);

    const listing = await factory.listings(token);
    expect(listing.creator).to.equal(creator.address);
    expect(listing.pool).to.not.equal(ethers.ZeroAddress);
    expect(listing.quote).to.equal(WHYPE);

    const erc20 = await ethers.getContractAt("LaunchpadERC20", token);
    const pooled = await erc20.balanceOf(listing.pool);
    expect(pooled).to.be.greaterThan((SUPPLY * 999_999n) / 1_000_000n);
    expect(pooled).to.be.lessThanOrEqual(SUPPLY);

    // The pool is the canonical 1% (10000) tier pool for token/WHYPE.
    const v3 = await ethers.getContractAt("IUniswapV3FactoryCore", V3_FACTORY);
    expect(await v3.getPool(token, WHYPE, 10_000)).to.equal(listing.pool);
  });

  it("buys and sells through the native-HYPE router", async () => {
    const [, owner, feeRecipient, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deploySystem(owner, feeRecipient);
    const token = await createToken(factory, creator);
    const erc20 = await ethers.getContractAt("LaunchpadERC20", token);

    await (await router.connect(trader).buy(token, 0, { value: ethers.parseEther("1") })).wait();
    const bought = await erc20.balanceOf(trader.address);
    expect(bought, "received coins for HYPE").to.be.greaterThan(0n);

    // Absurd minOut trips the slippage guard.
    await expect(router.connect(trader).buy(token, ethers.parseEther("999999999999"), { value: ethers.parseEther("1") }))
      .to.be.revertedWithCustomError(router, "SlippageExceeded");

    const half = bought / 2n;
    await (await erc20.connect(trader).approve(await router.getAddress(), half)).wait();
    const nativeBefore = await ethers.provider.getBalance(trader.address);
    const rc = await (await router.connect(trader).sell(token, half, 0)).wait();
    const gas = rc.gasUsed * rc.gasPrice;
    const nativeAfter = await ethers.provider.getBalance(trader.address);
    expect(nativeAfter + gas, "net HYPE received on sell").to.be.greaterThan(nativeBefore);
    expect(await erc20.balanceOf(trader.address)).to.equal(bought - half);
  });

  it("harvests the 1% pool fee 80/20 to creator and platform", async () => {
    const [, owner, feeRecipient, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deploySystem(owner, feeRecipient);
    const token = await createToken(factory, creator);
    const whype = await ethers.getContractAt("IERC20", WHYPE);

    await (await router.connect(trader).buy(token, 0, { value: ethers.parseEther("5") })).wait();

    const creatorBefore = await whype.balanceOf(creator.address);
    const platformBefore = await whype.balanceOf(feeRecipient.address);
    await (await factory.connect(trader).harvestFees(token)).wait(); // permissionless
    const creatorGain = (await whype.balanceOf(creator.address)) - creatorBefore;
    const platformGain = (await whype.balanceOf(feeRecipient.address)) - platformBefore;

    expect(creatorGain, "creator earns fees").to.be.greaterThan(0n);
    const total = creatorGain + platformGain;
    expect(creatorGain, "80% creator split").to.equal((total * CREATOR_BPS) / BPS);
    await expect(factory.harvestFees(token)).to.be.revertedWithCustomError(factory, "NothingToCollect");
  });

  it("lets only the owner collect the position", async () => {
    const [, owner, feeRecipient, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deploySystem(owner, feeRecipient);
    const token = await createToken(factory, creator);
    await (await router.connect(trader).buy(token, 0, { value: ethers.parseEther("2") })).wait();

    await expect(factory.connect(trader).collectFees(token)).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");

    const erc20 = await ethers.getContractAt("LaunchpadERC20", token);
    const before = await erc20.balanceOf(owner.address);
    await (await factory.connect(owner).collectFees(token)).wait();
    expect(await factory.positionLiquidity(token)).to.equal(0n);
    expect(await erc20.balanceOf(owner.address)).to.be.greaterThan(before);
  });
});
