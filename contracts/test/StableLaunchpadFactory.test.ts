import { expect } from "chai";
import { ethers } from "hardhat";

import UniswapV3FactoryArtifact from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import SwapRouterArtifact from "@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json";
import PositionManagerArtifact from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";

/**
 * StableLaunchpadFactory integration tests against the REAL Uniswap V3
 * bytecode (factory, position manager, SwapRouter02) — the same stack the
 * official Stable Mainnet deployment runs. The wrapped native stands in for
 * WUSDT0 ($1.00), and trading happens directly on the official router, never
 * through the launchpad.
 */

const SUPPLY = ethers.parseEther("1000000000");
const DEFAULT_MCAP_USD8 = 3_000n * 10n ** 8n;
const BPS = 10_000n;
const HOLDER_BPS = 5_000n;
const CREATOR_BPS = 4_000n;
const DEADLINE = 4_000_000_000n;

async function deployFixture() {
  const [deployer, owner, feeRecipient, creator, trader] = await ethers.getSigners();

  // Wrapped native: WUSDT0 — the native currency on Stable is a dollar.
  const wnative = await (await ethers.getContractFactory("WrappedNative")).deploy("Wrapped USDT0", "WUSDT0");

  const uniFactory = await new ethers.ContractFactory(
    UniswapV3FactoryArtifact.abi,
    UniswapV3FactoryArtifact.bytecode,
    deployer,
  ).deploy();

  const positionManager = await new ethers.ContractFactory(
    PositionManagerArtifact.abi,
    PositionManagerArtifact.bytecode,
    deployer,
  ).deploy(await uniFactory.getAddress(), await wnative.getAddress(), ethers.ZeroAddress);

  const swapRouter = await new ethers.ContractFactory(
    SwapRouterArtifact.abi,
    SwapRouterArtifact.bytecode,
    deployer,
  ).deploy(ethers.ZeroAddress, await uniFactory.getAddress(), await positionManager.getAddress(), await wnative.getAddress());

  const tokenDeployer = await (await ethers.getContractFactory("RewardTokenDeployer")).deploy();

  const factory = await (await ethers.getContractFactory("StableLaunchpadFactory")).deploy(
    owner.address,
    feeRecipient.address,
    await tokenDeployer.getAddress(),
    await uniFactory.getAddress(),
    await positionManager.getAddress(),
    await swapRouter.getAddress(),
    await wnative.getAddress(),
    5000,
    4000,
  );
  await tokenDeployer.setFactory(await factory.getAddress());

  return { deployer, owner, feeRecipient, creator, trader, wnative, uniFactory, positionManager, swapRouter, tokenDeployer, factory };
}

type Fixture = Awaited<ReturnType<typeof deployFixture>>;

const PARAMS = {
  name: "Steady Token",
  symbol: "STDY",
  metadataURI: JSON.stringify({ description: "test" }),
  devBuyQuote: 0n,
};


// Off-chain equivalents of the removed factory views: market cap from the
// pool's live sqrtPrice, and the position id straight from the listing.
async function mcapUsd8(f: Fixture, token: string): Promise<bigint> {
  const l = await f.factory.listings(token);
  const pool = new ethers.Contract(l.pool, ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"], f.deployer);
  const [sp] = await pool.slot0();
  const Q96 = 2n ** 96n;
  const supply = SUPPLY;
  const mcapQuote = l.tokenIsToken0
    ? (((supply * BigInt(sp)) / Q96) * BigInt(sp)) / Q96
    : (((supply * Q96) / BigInt(sp)) * Q96) / BigInt(sp);
  const q = await f.factory.quoteAssets(l.quote);
  return (mcapQuote * BigInt(q.usdPrice8)) / 10n ** BigInt(q.decimals);
}

async function createToken(f: Fixture, marketCapUsd8 = 0n, quote?: string) {
  const p = { ...PARAMS, quote: quote ?? (await f.wnative.getAddress()), marketCapUsd8 };
  const tx = await f.factory.connect(f.creator).createToken(p);
  const rc = await tx.wait();
  const ev = rc!.logs
    .map((l: any) => {
      try {
        return f.factory.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((x: any) => x?.name === "TokenCreated");
  return ev!.args.token as string;
}

async function buyOnRouter(f: Fixture, token: string, amountInNative: bigint) {
  // Trading happens directly on the official SwapRouter — wrap, approve, swap.
  await (await f.wnative.connect(f.trader).deposit({ value: amountInNative })).wait();
  await (await f.wnative.connect(f.trader).approve(await f.swapRouter.getAddress(), amountInNative)).wait();
  const router = new ethers.Contract(await f.swapRouter.getAddress(), SwapRouterArtifact.abi, f.trader);
  await (
    await router.exactInputSingle({
      tokenIn: await f.wnative.getAddress(),
      tokenOut: token,
      fee: 10_000,
      recipient: f.trader.address,
      amountIn: amountInNative,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    })
  ).wait();
}

describe("StableLaunchpadFactory (real Uniswap V3)", function () {
  this.timeout(300_000);

  it("launches at the $3,000 default market cap with the full supply single-sided", async () => {
    const f = await deployFixture();
    const token = await createToken(f);

    const erc20 = await ethers.getContractAt("LaunchpadRewardToken", token);
    expect(await erc20.totalSupply()).to.equal(SUPPLY);
    expect(await erc20.owner()).to.equal(ethers.ZeroAddress); // immutable from birth
    expect(await erc20.creator()).to.equal(f.creator.address);

    // Live pool market cap ≈ $3,000 (tick snapping allows small drift).
    const mcap = await mcapUsd8(f, token);
    expect(mcap).to.be.greaterThan((DEFAULT_MCAP_USD8 * 90n) / 100n);
    expect(mcap).to.be.lessThan((DEFAULT_MCAP_USD8 * 110n) / 100n);

    // LP NFT custodied by the factory.
    const positionId = (await f.factory.listings(token)).positionId;
    const pm = new ethers.Contract(await f.positionManager.getAddress(), PositionManagerArtifact.abi, f.deployer);
    expect(await pm.ownerOf(positionId)).to.equal(await f.factory.getAddress());
  });

  it("honors a creator-selected market cap", async () => {
    const f = await deployFixture();
    const token = await createToken(f, 10_000n * 10n ** 8n);
    const mcap = await mcapUsd8(f, token);
    expect(mcap).to.be.greaterThan(9_000n * 10n ** 8n);
    expect(mcap).to.be.lessThan(11_000n * 10n ** 8n);
  });

  it("rejects out-of-range market caps, bad quotes and paused launches", async () => {
    const f = await deployFixture();
    const wq = await f.wnative.getAddress();

    await expect(
      f.factory.connect(f.creator).createToken({ ...PARAMS, quote: wq, marketCapUsd8: 1n }),
    ).to.be.revertedWithCustomError(f.factory, "MarketCapOutOfRange");
    await expect(
      f.factory.connect(f.creator).createToken({ ...PARAMS, quote: f.creator.address, marketCapUsd8: 0n }),
    ).to.be.revertedWithCustomError(f.factory, "QuoteNotApproved");

    await (await f.factory.connect(f.owner).pause()).wait();
    await expect(
      f.factory.connect(f.creator).createToken({ ...PARAMS, quote: wq, marketCapUsd8: 0n }),
    ).to.be.revertedWithCustomError(f.factory, "LaunchesArePaused");
    await (await f.factory.connect(f.owner).resume()).wait();
    await createToken(f); // works again
  });

  it("trades on the router and harvests fees 50/40/10 holders/creator/platform", async () => {
    const f = await deployFixture();
    const token = await createToken(f);
    const erc20 = await ethers.getContractAt("LaunchpadRewardToken", token);

    await buyOnRouter(f, token, ethers.parseEther("50"));
    const traderBal = await erc20.balanceOf(f.trader.address);
    expect(traderBal).to.be.greaterThan(0n);
    // The trader is the only dividend-eligible holder (pool/factory excluded).
    expect(await erc20.eligibleSupply()).to.equal(traderBal);

    const creatorBefore = await f.wnative.balanceOf(f.creator.address);
    const platformBefore = await f.wnative.balanceOf(f.feeRecipient.address);

    await (await f.factory.harvestFees(token)).wait();

    const creatorGain = (await f.wnative.balanceOf(f.creator.address)) - creatorBefore;
    const platformGain = (await f.wnative.balanceOf(f.feeRecipient.address)) - platformBefore;
    const holderGain = await f.wnative.balanceOf(token); // holder pot lives in the token
    expect(creatorGain, "creator earns quote-side pool fees").to.be.greaterThan(0n);
    expect(holderGain, "holder share landed in the dividend tracker").to.be.greaterThan(0n);

    // Exact integer split of the collected quote side.
    const total = creatorGain + platformGain + holderGain;
    expect(holderGain).to.equal((total * HOLDER_BPS) / BPS);
    expect(creatorGain).to.equal((total * CREATOR_BPS) / BPS);
    expect(await erc20.totalRewardsDistributed()).to.equal(holderGain);

    // Manual claim: the trader pulls their accrued rewards themselves.
    const pending = await erc20.pendingRewards(f.trader.address);
    expect(pending, "trader accrued the full holder pot (sole holder)").to.be.greaterThan(0n);
    expect(pending).to.be.lessThanOrEqual(holderGain);
    expect(holderGain - pending, "only accumulator dust left behind").to.be.lessThan(1_000_000n);
    const traderQuoteBefore = await f.wnative.balanceOf(f.trader.address);
    await (await erc20.connect(f.trader).claim()).wait();
    expect((await f.wnative.balanceOf(f.trader.address)) - traderQuoteBefore).to.equal(pending);
    expect(await erc20.pendingRewards(f.trader.address)).to.equal(0n);

    // Nothing left to harvest right away.
    await expect(f.factory.harvestFees(token)).to.be.revertedWithCustomError(f.factory, "NothingToCollect");
  });

  it("folds the holder share into the creator's when nobody is eligible yet", async () => {
    const f = await deployFixture();
    const token = await createToken(f);
    const erc20 = await ethers.getContractAt("LaunchpadRewardToken", token);

    // Buy then send the coins to the pool's excluded twin: simplest way to
    // reach eligibleSupply == 0 with fees accrued is to buy and give the
    // tokens back to an excluded address — the factory itself.
    await buyOnRouter(f, token, ethers.parseEther("10"));
    await (await erc20.connect(f.trader).transfer(await f.factory.getAddress(), await erc20.balanceOf(f.trader.address))).wait();
    expect(await erc20.eligibleSupply()).to.equal(0n);

    const creatorBefore = await f.wnative.balanceOf(f.creator.address);
    const platformBefore = await f.wnative.balanceOf(f.feeRecipient.address);
    await (await f.factory.harvestFees(token)).wait();
    const creatorGain = (await f.wnative.balanceOf(f.creator.address)) - creatorBefore;
    const platformGain = (await f.wnative.balanceOf(f.feeRecipient.address)) - platformBefore;

    // Holder 50% folded into creator 40% => creator gets 90%, platform 10%
    // (exact integer math: each share floors independently).
    expect(await f.wnative.balanceOf(token), "nothing stranded in the tracker").to.equal(0n);
    const total = creatorGain + platformGain;
    expect(creatorGain).to.equal((total * HOLDER_BPS) / BPS + (total * CREATOR_BPS) / BPS);
  });

  it("collectFees is owner-only and unwinds the whole position to the owner", async () => {
    const f = await deployFixture();
    const token = await createToken(f);
    await buyOnRouter(f, token, ethers.parseEther("20"));

    await expect(f.factory.connect(f.creator).collectFees(token)).to.be.revertedWithCustomError(
      f.factory,
      "OwnableUnauthorizedAccount",
    );

    const erc20 = await ethers.getContractAt("LaunchpadRewardToken", token);
    const ownerTokenBefore = await erc20.balanceOf(f.owner.address);
    const ownerQuoteBefore = await f.wnative.balanceOf(f.owner.address);

    await (await f.factory.connect(f.owner).collectFees(token)).wait();

    expect(await erc20.balanceOf(f.owner.address)).to.be.greaterThan(ownerTokenBefore);
    expect(await f.wnative.balanceOf(f.owner.address)).to.be.greaterThan(ownerQuoteBefore);

    const listing = await f.factory.listings(token);
    const pm2 = new ethers.Contract(await f.positionManager.getAddress(), PositionManagerArtifact.abi, f.deployer);
    const pos = await pm2.positions(listing.positionId);
    expect(pos[7], "position liquidity drained").to.equal(0n);
  });

  it("supports an approved 6-decimal stablecoin as the quote asset", async () => {
    const f = await deployFixture();
    const usd = await (await ethers.getContractFactory("MockUSD")).deploy();
    const usdAddr = await usd.getAddress();
    await (await f.factory.connect(f.owner).setQuoteAsset(usdAddr, true, 100_000_000n)).wait();

    const token = await createToken(f, 0n, usdAddr);
    const mcap = await mcapUsd8(f, token);
    expect(mcap).to.be.greaterThan((DEFAULT_MCAP_USD8 * 90n) / 100n);
    expect(mcap).to.be.lessThan((DEFAULT_MCAP_USD8 * 110n) / 100n);
  });

  it("owner configuration and recovery paths work; others are locked out", async () => {
    const f = await deployFixture();

    await expect(f.factory.connect(f.creator).pause()).to.be.revertedWithCustomError(
      f.factory,
      "OwnableUnauthorizedAccount",
    );
    await expect(
      f.factory.connect(f.creator).setFeeRecipient(f.creator.address),
    ).to.be.revertedWithCustomError(f.factory, "OwnableUnauthorizedAccount");

    await expect(f.factory.connect(f.owner).setFeeRecipient(f.trader.address))
      .to.emit(f.factory, "FeeRecipientUpdated")
      .withArgs(f.feeRecipient.address, f.trader.address);

    // ERC20 recovery: send a stray token in, owner pulls it out.
    const usd = await (await ethers.getContractFactory("MockUSD")).deploy();
    await (await usd.transfer(await f.factory.getAddress(), 5_000_000n)).wait();
    await (await f.factory.connect(f.owner).recoverERC20(await usd.getAddress(), 5_000_000n)).wait();
    expect(await usd.balanceOf(f.owner.address)).to.equal(5_000_000n);

    // Native recovery — balance delta must equal the recovered amount less gas.
    const stray = ethers.parseEther("1");
    await f.deployer.sendTransaction({ to: await f.factory.getAddress(), value: stray });
    const before = await ethers.provider.getBalance(f.owner.address);
    const rc = await (await f.factory.connect(f.owner).recoverNative()).wait();
    const gas = rc!.gasUsed * rc!.gasPrice;
    expect(await ethers.provider.getBalance(f.owner.address)).to.equal(before + stray - gas);
    expect(await ethers.provider.getBalance(await f.factory.getAddress())).to.equal(0n);
  });
});
