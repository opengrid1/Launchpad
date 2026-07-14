import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { Signer } from "ethers";

import UniswapV3FactoryArtifact from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import SwapRouterArtifact from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import PositionManagerArtifact from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";

const DEADLINE = 4_000_000_000n;
const ETH_USD_8 = 2_000n * 10n ** 8n; // 2,000 USD per native token
const GRADUATION_USD_8 = 40_000n * 10n ** 8n;

async function deployFixture() {
  const [admin, creator, alice, bob] = await ethers.getSigners();

  const weth = await (await ethers.getContractFactory("WETH9")).deploy();

  const uniFactory = await new ethers.ContractFactory(
    UniswapV3FactoryArtifact.abi,
    UniswapV3FactoryArtifact.bytecode,
    admin
  ).deploy();

  const swapRouter = await new ethers.ContractFactory(
    SwapRouterArtifact.abi,
    SwapRouterArtifact.bytecode,
    admin
  ).deploy(await uniFactory.getAddress(), await weth.getAddress());

  const positionManager = await new ethers.ContractFactory(
    PositionManagerArtifact.abi,
    PositionManagerArtifact.bytecode,
    admin
  ).deploy(await uniFactory.getAddress(), await weth.getAddress(), ethers.ZeroAddress);

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
  totalSupply: ethers.parseEther("1000000000"), // 1B
  feeTier: 3000,
  maxTxBps: 2000, // 20%
  maxWalletBps: 10000, // 100%
  buyCooldown: 0,
};

async function launchToken(f: Fixture, overrides: Partial<typeof BASE_PARAMS> = {}, valueEth = "1") {
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

describe("Launchpad", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await deployFixture();
  });

  describe("createToken", () => {
    it("deploys token, creates a real V3 pool, seeds full-range liquidity and enables trading immediately", async () => {
      const { token, tokenAddress, event } = await launchToken(f);

      expect(await token.totalSupply()).to.equal(BASE_PARAMS.totalSupply);
      expect(await token.creator()).to.equal(f.creator.address);
      expect(await token.limitsActive()).to.equal(true);

      const pool = await f.uniFactory.getFunction("getPool")(
        tokenAddress,
        await f.weth.getAddress(),
        BASE_PARAMS.feeTier
      );
      expect(pool).to.equal(event.pool);
      expect(pool).to.not.equal(ethers.ZeroAddress);

      // The launchpad owns the position NFT.
      const owner = await f.positionManager.getFunction("ownerOf")(event.positionTokenId);
      expect(owner).to.equal(await f.launchpad.getAddress());

      // Trading works right away.
      await expect(
        f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.01") })
      ).to.emit(f.launchpad, "Trade");
      expect(await token.balanceOf(f.alice.address)).to.be.gt(0);
    });

    it("prices the pool from initial liquidity: 1 ETH against 1B tokens gives a market cap near 1 ETH", async () => {
      const { tokenAddress } = await launchToken(f);
      const mcapWeth = await f.launchpad.marketCapWeth(tokenAddress);
      expect(mcapWeth).to.be.closeTo(ethers.parseEther("1"), ethers.parseEther("0.001"));

      const mcapUsd = await f.launchpad.marketCapUsd(tokenAddress);
      expect(mcapUsd).to.be.closeTo(2_000n * 10n ** 8n, 10n ** 7n);
    });

    it("rejects launches below the minimum initial liquidity", async () => {
      await expect(launchToken(f, {}, "0.001")).to.be.revertedWithCustomError(
        f.launchpad,
        "InsufficientLiquidity"
      );
    });

    it("rejects invalid anti-whale parameters", async () => {
      await expect(launchToken(f, { maxTxBps: 5 })).to.be.revertedWithCustomError(
        f.launchpad,
        "InvalidParams"
      );
      await expect(launchToken(f, { maxWalletBps: 100, maxTxBps: 500 })).to.be.revertedWithCustomError(
        f.launchpad,
        "InvalidParams"
      );
      await expect(launchToken(f, { buyCooldown: 7200 })).to.be.revertedWithCustomError(
        f.launchpad,
        "InvalidParams"
      );
    });

    it("respects the launch pause switch", async () => {
      await f.launchpad.setLaunchesPaused(true);
      await expect(launchToken(f)).to.be.revertedWithCustomError(f.launchpad, "LaunchesArePaused");
      await f.launchpad.setLaunchesPaused(false);
      await expect(launchToken(f)).to.not.be.reverted;
    });
  });

  describe("anti-whale limits", () => {
    it("blocks transfers above the max transaction amount", async () => {
      const { token, tokenAddress } = await launchToken(f);
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.1") });

      const maxTx = await token.maxTxAmount();
      const balance = await token.balanceOf(f.alice.address);
      expect(balance).to.be.lte(maxTx);

      // A wallet-to-wallet transfer over maxTx must revert.
      const supply = await token.totalSupply();
      const over = (supply * 2001n) / 10000n;
      await expect(token.connect(f.alice).transfer(f.bob.address, over)).to.be.revertedWithCustomError(
        token,
        "MaxTransactionExceeded"
      );
    });

    it("blocks buys that exceed the max wallet holding", async () => {
      const { tokenAddress } = await launchToken(f, { maxTxBps: 200, maxWalletBps: 300 });

      // ~1.9% of supply per buy is under maxTx, but the second buy breaks maxWallet (3%).
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.019") });
      await expect(
        f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.019") })
      ).to.be.reverted;
    });

    it("enforces the buy cooldown and releases it after the window", async () => {
      const { tokenAddress } = await launchToken(f, { buyCooldown: 60 });

      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.01") });
      await expect(
        f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.01") })
      ).to.be.reverted;

      await network.provider.send("evm_increaseTime", [61]);
      await network.provider.send("evm_mine");

      await expect(
        f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.01") })
      ).to.not.be.reverted;
    });

    it("lifts all limits automatically when market cap crosses 40,000 USD, with no admin call", async () => {
      const { token, tokenAddress } = await launchToken(f);

      expect(await token.limitsActive()).to.equal(true);

      // Push the market cap over the threshold with a series of buys from two wallets.
      const buyers = [f.alice, f.bob];
      let lifted = false;
      for (let i = 0; i < 60 && !lifted; i++) {
        const buyer = buyers[i % 2];
        await f.launchpad.connect(buyer).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.2") });
        lifted = !(await token.limitsActive());
      }

      expect(lifted).to.equal(true);
      const mcapUsd = await f.launchpad.marketCapUsd(tokenAddress);
      expect(mcapUsd).to.be.gte(GRADUATION_USD_8);

      const limits = await f.launchpad.tradingLimits(tokenAddress);
      expect(limits.active).to.equal(false);
      expect(limits.remainingUsd).to.equal(0n);

      // Unrestricted trading: a transfer far above the old maxTx now succeeds.
      const balance = await token.balanceOf(f.alice.address);
      await expect(token.connect(f.alice).transfer(f.bob.address, balance)).to.not.be.reverted;
    });

    it("reports graduation progress through tradingLimits", async () => {
      const { tokenAddress } = await launchToken(f);
      const before = await f.launchpad.tradingLimits(tokenAddress);
      expect(before.active).to.equal(true);
      expect(before.remainingUsd).to.be.gt(0n);

      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.2") });
      const after = await f.launchpad.tradingLimits(tokenAddress);
      expect(after.remainingUsd).to.be.lt(before.remainingUsd);
    });
  });

  describe("trading and fees", () => {
    it("takes the trade fee on buys and splits it 80/20 creator/platform", async () => {
      const { tokenAddress } = await launchToken(f);

      const value = ethers.parseEther("0.1");
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value });

      const fee = (value * 300n) / 10000n;
      const creatorShare = (fee * 8000n) / 10000n;
      const platformShare = fee - creatorShare;

      expect(await f.feeDistributor.creatorPending(f.creator.address)).to.equal(creatorShare);
      expect(await f.feeDistributor.platformPending()).to.equal(platformShare);
      expect(await f.feeDistributor.tokenCreatorFees(tokenAddress)).to.equal(creatorShare);
    });

    it("supports sells with the fee taken from native proceeds", async () => {
      const { token, tokenAddress } = await launchToken(f);
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.15") });

      const tokenBalance = await token.balanceOf(f.alice.address);
      await token.connect(f.alice).approve(await f.launchpad.getAddress(), tokenBalance);

      const before = await ethers.provider.getBalance(f.alice.address);
      const pendingBefore = await f.feeDistributor.creatorPending(f.creator.address);

      await f.launchpad.connect(f.alice).sell(tokenAddress, tokenBalance, 0, DEADLINE);

      const after = await ethers.provider.getBalance(f.alice.address);
      expect(after).to.be.gt(before); // received native proceeds net of gas
      expect(await token.balanceOf(f.alice.address)).to.equal(0n);
      expect(await f.feeDistributor.creatorPending(f.creator.address)).to.be.gt(pendingBefore);
    });

    it("lets the creator withdraw earnings with one call", async () => {
      const { tokenAddress } = await launchToken(f);
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.1") });

      const pending = await f.feeDistributor.creatorPending(f.creator.address);
      expect(pending).to.be.gt(0n);

      await expect(f.feeDistributor.connect(f.creator).withdrawCreator()).to.changeEtherBalance(
        f.creator,
        pending
      );
      expect(await f.feeDistributor.creatorPending(f.creator.address)).to.equal(0n);
      expect(await f.feeDistributor.creatorLifetimeEarned(f.creator.address)).to.equal(pending);
    });

    it("lets the admin withdraw the platform share to the treasury", async () => {
      const { tokenAddress } = await launchToken(f);
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.1") });

      const pending = await f.feeDistributor.platformPending();
      await expect(
        f.feeDistributor.withdrawPlatform(await f.treasury.getAddress())
      ).to.changeEtherBalance(f.treasury, pending);
    });

    it("rejects trades on unknown tokens", async () => {
      await expect(
        f.launchpad.connect(f.alice).buy(f.alice.address, 0, DEADLINE, { value: 1n })
      ).to.be.revertedWithCustomError(f.launchpad, "UnknownToken");
    });
  });

  describe("protocol-owned liquidity", () => {
    it("collects Uniswap V3 LP fees to the treasury", async () => {
      const { tokenAddress } = await launchToken(f);
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.1") });

      const treasuryAddress = await f.treasury.getAddress();
      const wethBefore = await f.weth.balanceOf(treasuryAddress);

      await expect(f.launchpad.collectLiquidityFees(tokenAddress)).to.emit(
        f.launchpad,
        "LiquidityFeesCollected"
      );

      // Buys pay WETH into the pool, so LP fees accrue in WETH.
      expect(await f.weth.balanceOf(treasuryAddress)).to.be.gt(wethBefore);
    });

    it("withdraws 100% of protocol liquidity to the treasury", async () => {
      const { token, tokenAddress } = await launchToken(f);
      await f.launchpad.connect(f.alice).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.15") });

      const treasuryAddress = await f.treasury.getAddress();

      await expect(f.launchpad.withdrawAllLP(tokenAddress)).to.emit(f.launchpad, "LPWithdrawn");

      const info = await f.launchpad.poolInfo(tokenAddress);
      expect(info.positionLiquidity).to.equal(0n);
      expect(await token.balanceOf(treasuryAddress)).to.be.gt(0n);
      expect(await f.weth.balanceOf(treasuryAddress)).to.be.gt(0n);
    });

    it("withdraws a partial share of liquidity", async () => {
      const { tokenAddress } = await launchToken(f);
      const before = await f.launchpad.poolInfo(tokenAddress);

      await f.launchpad.withdrawLP(tokenAddress, 5000);

      const after = await f.launchpad.poolInfo(tokenAddress);
      expect(after.positionLiquidity).to.be.closeTo(before.positionLiquidity / 2n, 2n);
    });

    it("adds liquidity back into the protocol position", async () => {
      const { token, tokenAddress } = await launchToken(f);

      // Acquire tokens as admin, then add both sides back to the position.
      await f.launchpad.connect(f.admin).buy(tokenAddress, 0, DEADLINE, { value: ethers.parseEther("0.15") });
      const tokenAmount = await token.balanceOf(f.admin.address);
      await token.connect(f.admin).approve(await f.launchpad.getAddress(), tokenAmount);

      const before = await f.launchpad.poolInfo(tokenAddress);
      await expect(
        f.launchpad.addLiquidity(tokenAddress, tokenAmount, { value: ethers.parseEther("0.2") })
      ).to.emit(f.launchpad, "LiquidityAdded");
      const after = await f.launchpad.poolInfo(tokenAddress);
      expect(after.positionLiquidity).to.be.gt(before.positionLiquidity);
    });

    it("restricts liquidity management to the liquidity manager role", async () => {
      const { tokenAddress } = await launchToken(f);
      await expect(f.launchpad.connect(f.alice).withdrawLP(tokenAddress, 10000)).to.be.reverted;
      await expect(f.launchpad.connect(f.alice).collectLiquidityFees(tokenAddress)).to.be.reverted;
      await expect(f.launchpad.connect(f.alice).removeLiquidity(tokenAddress, 1n)).to.be.reverted;
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

    it("caps the trade fee at 5%", async () => {
      await expect(f.launchpad.setTradeFeeBps(501)).to.be.revertedWithCustomError(
        f.launchpad,
        "InvalidParams"
      );
      await f.launchpad.setTradeFeeBps(500);
      expect(await f.launchpad.tradeFeeBps()).to.equal(500);
    });

    it("uses a Chainlink-compatible feed when configured", async () => {
      const { tokenAddress } = await launchToken(f);
      const feed = await (await ethers.getContractFactory("MockAggregator")).deploy(4_000n * 10n ** 8n, 8);
      await f.launchpad.setPriceFeed(await feed.getAddress());

      // Market cap in USD doubles when the native price doubles.
      const mcapUsd = await f.launchpad.marketCapUsd(tokenAddress);
      expect(mcapUsd).to.be.closeTo(4_000n * 10n ** 8n, 10n ** 7n);
    });

    it("exposes pool info", async () => {
      const { tokenAddress } = await launchToken(f);
      const info = await f.launchpad.poolInfo(tokenAddress);
      expect(info.pool).to.not.equal(ethers.ZeroAddress);
      expect(info.feeTier).to.equal(3000);
      expect(info.poolLiquidity).to.be.gt(0n);
      expect(info.positionLiquidity).to.equal(info.poolLiquidity);
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
