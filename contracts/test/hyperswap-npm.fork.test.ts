import { expect } from "chai";
import { ethers } from "hardhat";

// HyperEVM (chainId 999) — HyperSwap V3 live periphery. HyperSwap's pool
// contract rejects a direct pool.mint (canonical Uniswap V3 accepts the same
// call), so the launchpad seeds liquidity through HyperSwap's own
// NonfungiblePositionManager — which is exactly what StableLaunchpadFactory does.
// This fork test runs the whole lifecycle against LIVE HyperSwap V3: launch +
// single-sided seed via the NPM, trade on the live SwapRouter, harvest the 1%
// pool fee 50/40/10 to holders/creator/platform (holder pot manually
// claimable), and owner-collect the position.
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
const WHYPE = "0x5555555555555555555555555555555555555555";
// SwapRouter02 (deadline outside the params struct — matches ISwapRouter).
const SWAP_ROUTER = "0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77";
// HyperSwap "Hyperswap V3 Positions NFT-V1" — factory()==V3_FACTORY, WETH9()==WHYPE.
const NPM = (process.env.HS_NPM ?? "0x6eda206207c09e5428f281761ddc0d300851fbc8").toLowerCase();

const SUPPLY = ethers.parseEther("1000000000");
const BPS = 10_000n;
const HOLDER_BPS = 5_000n;
const CREATOR_BPS = 4_000n; // 50% holders / 40% creator / 10% platform

const WHYPE_ABI = [
  "function deposit() payable",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const ROUTER02_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
];

describe("HyperSwap launchpad via NonfungiblePositionManager (fork)", function () {
  this.timeout(600_000);
  if (process.env.FORK !== "1") { it.skip("requires FORK=1", () => {}); return; }

  async function deploySystem(owner: any, feeRecipient: any) {
    const tokenDeployer = await (await ethers.getContractFactory("RewardTokenDeployer")).deploy();
    await tokenDeployer.waitForDeployment();
    const factory = await (await ethers.getContractFactory("StableLaunchpadFactory")).deploy(
      owner.address, feeRecipient.address, await tokenDeployer.getAddress(),
      V3_FACTORY, NPM, SWAP_ROUTER, WHYPE, 5000, 4000,
    );
    await factory.waitForDeployment();
    await (await tokenDeployer.setFactory(await factory.getAddress())).wait();
    return { tokenDeployer, factory };
  }

  async function createToken(factory: any, creator: any) {
    const p = { name: "Hyper Coin", symbol: "HYPC", metadataURI: "{}", quote: WHYPE, marketCapUsd8: 0n, devBuyQuote: 0n };
    const rc = await (await factory.connect(creator).createToken(p)).wait();
    const ev = rc.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "TokenCreated");
    return ev.args.token as string;
  }

  async function buy(trader: any, token: string, amountNative: bigint) {
    const whype = new ethers.Contract(WHYPE, WHYPE_ABI, trader);
    await (await whype.deposit({ value: amountNative })).wait();
    await (await whype.approve(SWAP_ROUTER, amountNative)).wait();
    const router = new ethers.Contract(SWAP_ROUTER, ROUTER02_ABI, trader);
    await (await router.exactInputSingle({
      tokenIn: WHYPE, tokenOut: token, fee: 10_000, recipient: trader.address,
      amountIn: amountNative, amountOutMinimum: 0, sqrtPriceLimitX96: 0,
    })).wait();
  }

  it("launches a coin, seeding ~full supply into a HyperSwap V3 pool via the NPM", async () => {
    const [, owner, feeRecipient, creator] = await ethers.getSigners();
    const { factory } = await deploySystem(owner, feeRecipient);
    const token = await createToken(factory, creator);

    const listing = await factory.listings(token);
    expect(listing.creator).to.equal(creator.address);
    expect(listing.pool).to.not.equal(ethers.ZeroAddress);

    const erc20 = await ethers.getContractAt("LaunchpadRewardToken", token);
    expect(await erc20.owner(), "immutable from birth").to.equal(ethers.ZeroAddress);
    const pooled = await erc20.balanceOf(listing.pool);
    expect(pooled, "most of supply seeded").to.be.greaterThan((SUPPLY * 990_000n) / 1_000_000n);

    const v3 = await ethers.getContractAt("IUniswapV3FactoryCore", V3_FACTORY);
    expect(await v3.getPool(token, WHYPE, 10_000)).to.equal(listing.pool);
  });

  it("trades on the live HyperSwap router and harvests the 1% fee 50/40/10", async () => {
    const [, owner, feeRecipient, creator, trader] = await ethers.getSigners();
    const { factory } = await deploySystem(owner, feeRecipient);
    const token = await createToken(factory, creator);
    const erc20 = await ethers.getContractAt("LaunchpadRewardToken", token);
    const whype = new ethers.Contract(WHYPE, WHYPE_ABI, ethers.provider);

    await buy(trader, token, ethers.parseEther("5"));
    expect(await erc20.balanceOf(trader.address), "trader received coins").to.be.greaterThan(0n);

    const creatorBefore = await whype.balanceOf(creator.address);
    const platformBefore = await whype.balanceOf(feeRecipient.address);
    await (await factory.harvestFees(token)).wait(); // permissionless
    const creatorGain = (await whype.balanceOf(creator.address)) - creatorBefore;
    const platformGain = (await whype.balanceOf(feeRecipient.address)) - platformBefore;
    const holderGain = await whype.balanceOf(token); // holder pot inside the token

    expect(creatorGain, "creator earns pool fees").to.be.greaterThan(0n);
    expect(holderGain, "holders earn pool fees").to.be.greaterThan(0n);
    const total = creatorGain + platformGain + holderGain;
    expect(holderGain, "50% holder split").to.equal((total * HOLDER_BPS) / BPS);
    expect(creatorGain, "40% creator split").to.equal((total * CREATOR_BPS) / BPS);
    expect(await erc20.totalRewardsDistributed()).to.equal(holderGain);

    // Manual claim pays the trader (the sole eligible holder) in WHYPE.
    const pending = await erc20.pendingRewards(trader.address);
    expect(pending).to.be.greaterThan(0n);
    const traderBefore = await whype.balanceOf(trader.address);
    await (await erc20.connect(trader).claim()).wait();
    expect((await whype.balanceOf(trader.address)) - traderBefore).to.equal(pending);

    await expect(factory.harvestFees(token)).to.be.revertedWithCustomError(factory, "NothingToCollect");
  });

  it("collectFees is owner-only and unwinds the position to the owner", async () => {
    const [, owner, feeRecipient, creator, trader] = await ethers.getSigners();
    const { factory } = await deploySystem(owner, feeRecipient);
    const token = await createToken(factory, creator);
    await buy(trader, token, ethers.parseEther("2"));

    await expect(factory.connect(creator).collectFees(token)).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");

    const erc20 = await ethers.getContractAt("LaunchpadRewardToken", token);
    const before = await erc20.balanceOf(owner.address);
    await (await factory.connect(owner).collectFees(token)).wait();
    expect(await erc20.balanceOf(owner.address)).to.be.greaterThan(before);
  });
});
