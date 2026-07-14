import { expect } from "chai";
import { ethers } from "hardhat";

import UniswapV3FactoryArtifact from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import SwapRouterArtifact from "@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json";
import PositionManagerArtifact from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";

const DEADLINE = 4_000_000_000n;
const ETH_USD_8 = 2_000n * 10n ** 8n; // 2,000 USD per native token
const GRADUATION_USD_8 = 40_000n * 10n ** 8n;
const SUPPLY = ethers.parseEther("1000000000"); // fixed 1B
const FEE_BPS = 100n; // fixed 1%

async function deployFixture() {
  const [admin, creator, alice, bob] = await ethers.getSigners();

  const weth = await (await ethers.getContractFactory("WETH9")).deploy();

  const uniFactory = await new ethers.ContractFactory(
    UniswapV3FactoryArtifact.abi,
    UniswapV3FactoryArtifact.bytecode,
    admin
  ).deploy();

  const positionManager = await new ethers.ContractFactory(
    PositionManagerArtifact.abi,
    PositionManagerArtifact.bytecode,
    admin
  ).deploy(await uniFactory.getAddress(), await weth.getAddress(), ethers.ZeroAddress);

  const swapRouter = await new ethers.ContractFactory(
    SwapRouterArtifact.abi,
    SwapRouterArtifact.bytecode,
    admin
  ).deploy(
    ethers.ZeroAddress,
    await uniFactory.getAddress(),
    await positionManager.getAddress(),
    await weth.getAddress()
  );

  const tokenFactory = await (await ethers.getContractFactory("TokenFactory")).deploy();
  const treasury = await (await ethers.getContractFactory("Treasury")).deploy(admin.address);
  const feeDistributor = await (
    await ethers.getContractFactory("FeeDistributor")
  ).deploy(admin.address);

  const launchpad = await (
    await ethers.getContractFactory("Launchpad")
  ).deploy(
    admin.address,
    await tokenFactory.getAddress(),
    await uniFactory.getAddress(),
    await positionManager.getAddress(),
    await swapRouter.getAddress(),
    await weth.getAddress(),
    await feeDistributor.getAddress(),
    await treasury.getAddress(),
    GRADUATION_USD_8,
    ETH_USD_8
  );
  await feeDistributor.setLaunchpad(await launchpad.getAddress());
  await tokenFactory.setLaunchpad(await launchpad.getAddress());

  return { admin, creator, alice, bob, weth, uniFactory, swapRouter, positionManager, tokenFactory, treasury, feeDistributor, launchpad };
}

type Fixture = Awaited<ReturnType<typeof deployFixture>>;

const BASE_PARAMS = {
  name: "Test Token",
  symbol: "TEST",
  metadataURI: JSON.stringify({
    description: "A test token",
    logo: "ipfs://logo",
    website: "https://example.com",
    twitter: "https://x.com/test",
    telegram: "https://t.me/test",
  }),
};

async function launchToken(f: Fixture, overrides: Partial<typeof BASE_PARAMS> = {}, valueEth = "0") {
  const params = { ...BASE_PARAMS, ...overrides };
  const tx = await f.launchpad
    .connect(f.creator)
    .createToken(params, { value: ethers.parseEther(valueEth) });
  const receipt = await tx.wait();
  const log = receipt!.logs
    .map((l: any) => {
      try {
        return f.launchpad.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l: any) => l && l.name === "TokenLaunched");
  const tokenAddress: string = log!.args.token;
  const token = await ethers.getContractAt("LaunchToken", tokenAddress);
  return { token, tokenAddress, params, event: log!.args };
}

// All buys in these tests stay under the fixed 1% of supply max transaction.
const SMALL_BUY = ethers.parseEther("0.008");
const NEAR_MAX_BUY = ethers.parseEther("0.019");

describe("Launchpad", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await deployFixture();
  });

  describe("createToken", () => {
    it("deploys token, creates a real V3 pool, seeds it single-sided and enables trading immediately", async () => {
      const { token, tokenAddress, event } = await launchToken(f);

      expect(await token.totalSupply()).to.equal(SUPPLY);
      expect(await token.creator()).to.equal(f.creator.address);
      expect(await token.limitsActive()).to.equal(true);

      const pool = await f.uniFactory.getFunction("getPool")(
        tokenAddress,
        await f.weth.getAddress(),
        10000
      );
      expect(pool).to.equal(event.pool);
      expect(pool).to.not.equal(ethers.ZeroAddress);

      const owner = await f.positionManager.getFunction("ownerOf")(event.positionTokenId);
      expect(owner).to.equal(await f.launchpad.getAddress());

      await expect(
        f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.005") })
      ).to.emit(f.launchpad, "Trade");
      expect(await token.balanceOf(f.alice.address)).to.be.gt(0);
    });

    it("applies the fixed protocol rules to every launch", async () => {
      const { token, event } = await launchToken(f);
      expect(event.totalSupply).to.equal(SUPPLY);
      expect(event.feeTier).to.equal(10000);
      expect(await token.maxTxAmount()).to.equal((SUPPLY * 2n) / 100n); // 2%
      expect(await token.maxWalletAmount()).to.equal((SUPPLY * 2n) / 100n); // 2%
      expect(await token.buyCooldown()).to.equal(0n);
      expect(await f.launchpad.TRADE_FEE_BPS()).to.equal(100);
    });

    it("starts every token at the fixed initial market cap with no upfront liquidity", async () => {
      const { tokenAddress } = await launchToken(f);
      // INITIAL_MCAP_USD is 2,000 USD; tick-spacing snapping allows ~1% drift.
      const mcapUsd = await f.launchpad.marketCapUsd(tokenAddress);
      expect(mcapUsd).to.be.closeTo(2_000n * 10n ** 8n, 5n * 10n ** 9n);

      // At 2,000 USD per native token that is about 1 native of market cap.
      const mcapWeth = await f.launchpad.marketCapWeth(tokenAddress);
      expect(mcapWeth).to.be.closeTo(ethers.parseEther("1"), ethers.parseEther("0.025"));
    });

    it("executes an optional first buy for the creator in the launch transaction", async () => {
      const { token } = await launchToken(f, {}, "0.01");
      expect(await token.balanceOf(f.creator.address)).to.be.gt(0n);
      // The 1% fee on the first buy went back to the creator automatically.
      expect(await f.feeDistributor.creatorLifetimeEarned(f.creator.address)).to.equal(
        ethers.parseEther("0.01") / 100n
      );
    });

    it("rejects empty name or symbol", async () => {
      await expect(launchToken(f, { name: "" })).to.be.revertedWithCustomError(
        f.launchpad,
        "InvalidParams"
      );
      await expect(launchToken(f, { symbol: "" })).to.be.revertedWithCustomError(
        f.launchpad,
        "InvalidParams"
      );
    });

    it("factory: direct deployToken attributes msg.sender as creator, fixed rules applied", async () => {
      const tx = await f.tokenFactory.connect(f.bob).deployToken("Direct", "DIR", "{}");
      const receipt = await tx.wait();
      const log = receipt!.logs
        .map((l: any) => {
          try {
            return f.tokenFactory.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((l: any) => l && l.name === "TokenDeployed");
      expect(log!.args.creator).to.equal(f.bob.address);
      expect(log!.args.initialMarketCapUsd).to.equal(2_000n * 10n ** 8n);

      const token = await ethers.getContractAt("LaunchToken", log!.args.token);
      expect(await token.creator()).to.equal(f.bob.address);
      expect(await token.totalSupply()).to.equal(SUPPLY);
      expect(await token.maxTxAmount()).to.equal((SUPPLY * 2n) / 100n);
    });

    it("factory: deployTokenFor is launchpad-only and setLaunchpad is one-time", async () => {
      await expect(
        f.tokenFactory.connect(f.bob).deployTokenFor(f.bob.address, "X", "X", "{}")
      ).to.be.revertedWithCustomError(f.tokenFactory, "NotLaunchpad");
      await expect(
        f.tokenFactory.setLaunchpad(f.bob.address)
      ).to.be.revertedWithCustomError(f.tokenFactory, "LaunchpadAlreadySet");
    });

    it("respects the launch pause switch", async () => {
      await f.launchpad.setLaunchesPaused(true);
      await expect(launchToken(f)).to.be.revertedWithCustomError(f.launchpad, "LaunchesArePaused");
      await f.launchpad.setLaunchesPaused(false);
      await expect(launchToken(f)).to.not.be.reverted;
    });
  });

  describe("anti-whale limits", () => {
    it("blocks buys above the 2% max transaction", async () => {
      const { tokenAddress } = await launchToken(f);
      // ~4.5% of supply in one buy is far over the 2% per-transaction cap.
      await expect(
        f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.05") })
      ).to.be.reverted;
    });

    it("blocks buys that exceed the 2% max wallet", async () => {
      const { tokenAddress } = await launchToken(f);
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: NEAR_MAX_BUY });
      await expect(
        f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: NEAR_MAX_BUY })
      ).to.be.reverted;
    });

    it("lifts all limits automatically when market cap crosses 40,000 USD, with no admin call on the token", async () => {
      const { token, tokenAddress } = await launchToken(f);
      expect(await token.limitsActive()).to.equal(true);

      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: SMALL_BUY });
      expect(await token.limitsActive()).to.equal(true);

      // The native price rises so the pool's market cap crosses the
      // threshold; the very next transfer observes it and lifts limits.
      await f.launchpad.setEthUsdPrice(45_000n * 10n ** 8n);
      expect(await f.launchpad.shouldGraduate(tokenAddress)).to.equal(true);

      await f.launchpad.connect(f.bob).buy(tokenAddress, 0, DEADLINE, { value: SMALL_BUY });
      expect(await token.limitsActive()).to.equal(false);

      const limits = await f.launchpad.tradingLimits(tokenAddress);
      expect(limits.active).to.equal(false);
      expect(limits.remainingUsd).to.equal(0n);

      // Unrestricted trading: a transfer above the old maxTx now succeeds.
      const balance = await token.balanceOf(f.alice.address);
      const over = (SUPPLY * 101n) / 10000n;
      expect(balance).to.be.lt(over); // sanity: old limit forced small holdings
      await f.launchpad.connect(f.bob).buy(tokenAddress, 0, DEADLINE, { value: SMALL_BUY });
      await expect(token.connect(f.bob).transfer(f.alice.address, await token.balanceOf(f.bob.address))).to.not.be
        .reverted;
    });

    it("anyone can trigger the graduation check explicitly", async () => {
      const { token, tokenAddress } = await launchToken(f);
      await f.launchpad.setEthUsdPrice(50_000n * 10n ** 8n);
      await token.connect(f.bob).checkGraduation();
      expect(await token.limitsActive()).to.equal(false);
    });

    it("reports graduation progress through tradingLimits", async () => {
      const { tokenAddress } = await launchToken(f);
      const before = await f.launchpad.tradingLimits(tokenAddress);
      expect(before.active).to.equal(true);
      expect(before.remainingUsd).to.be.gt(0n);
      expect(before.maxTxAmount).to.equal((SUPPLY * 2n) / 100n);
      expect(before.maxWalletAmount).to.equal((SUPPLY * 2n) / 100n);

      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: SMALL_BUY });
      const after = await f.launchpad.tradingLimits(tokenAddress);
      expect(after.remainingUsd).to.be.lt(before.remainingUsd);
    });
  });

  describe("trading and fees", () => {
    it("takes a flat 1% fee on buys and pushes 100% of it to the creator instantly", async () => {
      const { tokenAddress } = await launchToken(f);

      const value = SMALL_BUY;
      const fee = (value * FEE_BPS) / 10000n;

      await expect(
        f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value })
      ).to.changeEtherBalance(f.creator, fee);

      expect(await f.feeDistributor.creatorLifetimeEarned(f.creator.address)).to.equal(fee);
      expect(await f.feeDistributor.tokenFees(tokenAddress)).to.equal(fee);
      // Nothing left pending: the push succeeded.
      expect(await f.feeDistributor.creatorPending(f.creator.address)).to.equal(0n);
    });

    it("supports sells with the 1% fee taken from native proceeds", async () => {
      const { token, tokenAddress } = await launchToken(f);
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: SMALL_BUY });

      const tokenBalance = await token.balanceOf(f.alice.address);
      await token.connect(f.alice).approve(await f.launchpad.getAddress(), tokenBalance);

      const before = await ethers.provider.getBalance(f.alice.address);
      const earnedBefore = await f.feeDistributor.creatorLifetimeEarned(f.creator.address);

      await f.launchpad.connect(f.alice).sell(tokenAddress, tokenBalance, 0, DEADLINE);

      expect(await ethers.provider.getBalance(f.alice.address)).to.be.gt(before);
      expect(await token.balanceOf(f.alice.address)).to.equal(0n);
      expect(await f.feeDistributor.creatorLifetimeEarned(f.creator.address)).to.be.gt(earnedBefore);
    });

    it("holds fees for later withdrawal when the push to the creator fails", async () => {
      // A creator contract with no receive function rejects pushes.
      const rejector = await (await ethers.getContractFactory("TokenFactory")).deploy();
      const rejectorAddress = await rejector.getAddress();

      await f.feeDistributor.setLaunchpad(f.admin.address);
      await expect(
        f.feeDistributor.accrue(f.alice.address, rejectorAddress, { value: 1000n })
      ).to.emit(f.feeDistributor, "FeeAccrued");
      expect(await f.feeDistributor.creatorPending(rejectorAddress)).to.equal(1000n);
    });

    it("rejects trades on unknown tokens", async () => {
      await expect(
        f.launchpad.connect(f.alice).buy(f.alice.address, 0, DEADLINE, { value: 1n })
      ).to.be.revertedWithCustomError(f.launchpad, "UnknownToken");
    });
  });

  describe("protocol-owned liquidity", () => {
    it("collects pool fees to the treasury", async () => {
      const { tokenAddress } = await launchToken(f);
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: SMALL_BUY });

      const treasuryAddress = await f.treasury.getAddress();
      const wethBefore = await f.weth.balanceOf(treasuryAddress);

      await expect(f.launchpad.getFunction("collectFees(address)")(tokenAddress)).to.emit(
        f.launchpad,
        "FeesCollected"
      );
      expect(await f.weth.balanceOf(treasuryAddress)).to.be.gt(wethBefore);
    });

    it("collectFees can settle 100% of the position to the treasury, before graduation", async () => {
      const { token, tokenAddress } = await launchToken(f);
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: SMALL_BUY });

      const treasuryAddress = await f.treasury.getAddress();
      await expect(f.launchpad.getFunction("collectFees(address,uint16)")(tokenAddress, 10000)).to.emit(
        f.launchpad,
        "FeesCollected"
      );

      const info = await f.launchpad.poolInfo(tokenAddress);
      expect(info.positionLiquidity).to.equal(0n);
      expect(await token.balanceOf(treasuryAddress)).to.be.gt(0n);
      expect(await f.weth.balanceOf(treasuryAddress)).to.be.gt(0n);
    });

    it("collectFees can settle a partial share of the position", async () => {
      const { tokenAddress } = await launchToken(f);
      const before = await f.launchpad.poolInfo(tokenAddress);

      await f.launchpad.getFunction("collectFees(address,uint16)")(tokenAddress, 5000);

      const after = await f.launchpad.poolInfo(tokenAddress);
      expect(after.positionLiquidity).to.be.closeTo(before.positionLiquidity / 2n, 2n);
    });

    it("adds liquidity back into the protocol position", async () => {
      const { token, tokenAddress } = await launchToken(f);

      await f.launchpad.connect(f.admin).buy(tokenAddress, 0, DEADLINE, { value: SMALL_BUY });
      const tokenAmount = await token.balanceOf(f.admin.address);
      await token.connect(f.admin).approve(await f.launchpad.getAddress(), tokenAmount);

      const before = await f.launchpad.poolInfo(tokenAddress);
      await expect(
        f.launchpad.addLiquidity(tokenAddress, tokenAmount, { value: ethers.parseEther("0.01") })
      ).to.emit(f.launchpad, "LiquidityAdded");
      const after = await f.launchpad.poolInfo(tokenAddress);
      expect(after.positionLiquidity).to.be.gt(before.positionLiquidity);
    });

    it("restricts liquidity management to the liquidity manager role", async () => {
      const { tokenAddress } = await launchToken(f);
      await expect(f.launchpad.connect(f.alice).getFunction("collectFees(address,uint16)")(tokenAddress, 10000)).to.be
        .reverted;
      await expect(f.launchpad.connect(f.alice).getFunction("collectFees(address)")(tokenAddress)).to.be.reverted;
      await expect(f.launchpad.connect(f.alice).addLiquidity(tokenAddress, 0, { value: 1n })).to.be
        .reverted;
    });
  });

  describe("admin and views", () => {
    it("features tokens", async () => {
      const { tokenAddress } = await launchToken(f);
      await expect(f.launchpad.setFeatured(tokenAddress, true))
        .to.emit(f.launchpad, "TokenFeaturedSet")
        .withArgs(tokenAddress, true);
      const info = await f.launchpad.tokenInfo(tokenAddress);
      expect(info.featured).to.equal(true);
    });

    it("uses a Chainlink-compatible feed when configured", async () => {
      const { tokenAddress } = await launchToken(f);
      const feed = await (await ethers.getContractFactory("MockAggregator")).deploy(4_000n * 10n ** 8n, 8);
      await f.launchpad.setPriceFeed(await feed.getAddress());

      // Market cap was 1 native at launch; doubling the native price to
      // 4,000 USD doubles the USD market cap to about 4,000 USD.
      const mcapUsd = await f.launchpad.marketCapUsd(tokenAddress);
      expect(mcapUsd).to.be.closeTo(4_000n * 10n ** 8n, 10n * 10n ** 9n);
    });

    it("exposes pool info", async () => {
      const { tokenAddress } = await launchToken(f);
      let info = await f.launchpad.poolInfo(tokenAddress);
      expect(info.pool).to.not.equal(ethers.ZeroAddress);
      expect(info.feeTier).to.equal(10000);
      // Single-sided seeding: the range sits above the price, so in-range
      // liquidity is zero until the first buy moves price into it.
      expect(info.positionLiquidity).to.be.gt(0n);
      expect(info.poolLiquidity).to.equal(0n);

      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: SMALL_BUY });
      info = await f.launchpad.poolInfo(tokenAddress);
      expect(info.poolLiquidity).to.equal(info.positionLiquidity);
    });

    it("tracks per-creator token lists and protocol totals", async () => {
      await launchToken(f);
      await launchToken(f, { symbol: "TWO", name: "Second" });
      expect(await f.launchpad.tokenCount()).to.equal(2n);
      expect(await f.launchpad.totalLaunches()).to.equal(2n);
      expect((await f.launchpad.tokensOf(f.creator.address)).length).to.equal(2);
    });
  });
});
