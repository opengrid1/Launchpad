import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import UniswapV3FactoryArtifact from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import SwapRouterArtifact from "@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json";
import PositionManagerArtifact from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";

// OnairFactory + OnairAuctionHouse against the REAL Uniswap V3 stack (the same
// bytecode HyperSwap V3 runs: factory, position manager, SwapRouter02).
// HYPE is priced at $80 so the $3k floor is 37.5 HYPE of FDV. An auction must
// raise 220 HYPE to graduate. Fees split 70% creator / 30% platform.

const SUPPLY = ethers.parseEther("1000000000");
const AUCTION_SUPPLY = SUPPLY / 2n;
const Q96 = 1n << 96n;
const HYPE_USD8 = 80n * 10n ** 8n;
const POOL_ABI = ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)", "function liquidity() view returns (uint128)"];

async function deployFixture() {
  const [deployer, owner, feeRecipient, creator, alice, bob, trader] = await ethers.getSigners();
  const wnative = await (await ethers.getContractFactory("WrappedNative")).deploy("Wrapped HYPE", "WHYPE");
  const uniFactory = await new ethers.ContractFactory(UniswapV3FactoryArtifact.abi, UniswapV3FactoryArtifact.bytecode, deployer).deploy();
  const positionManager = await new ethers.ContractFactory(PositionManagerArtifact.abi, PositionManagerArtifact.bytecode, deployer)
    .deploy(await uniFactory.getAddress(), await wnative.getAddress(), ethers.ZeroAddress);
  const swapRouter = await new ethers.ContractFactory(SwapRouterArtifact.abi, SwapRouterArtifact.bytecode, deployer)
    .deploy(ethers.ZeroAddress, await uniFactory.getAddress(), await positionManager.getAddress(), await wnative.getAddress());
  const tokenDeployer = await (await ethers.getContractFactory("OnairTokenDeployer")).deploy();
  const factory = await (await ethers.getContractFactory("OnairFactory")).deploy(
    owner.address, feeRecipient.address, await tokenDeployer.getAddress(), await uniFactory.getAddress(),
    await positionManager.getAddress(), await swapRouter.getAddress(), await wnative.getAddress(),
    HYPE_USD8, 0, 7000, 10000,
  );
  await tokenDeployer.setFactory(await factory.getAddress());
  const house = await (await ethers.getContractFactory("OnairAuctionHouse")).deploy(await factory.getAddress());
  await factory.connect(owner).setAuctionHouse(await house.getAddress());
  // short auctions for tests: 300 blocks, claim immediately, $3k floor, 220 HYPE to graduate
  await factory.connect(owner).setAuctionConfig(300, 0, 3_000n * 10n ** 8n, ethers.parseEther("220"));
  return { deployer, owner, feeRecipient, creator, alice, bob, trader, wnative, uniFactory, positionManager, swapRouter, tokenDeployer, factory, house };
}
type F = Awaited<ReturnType<typeof deployFixture>>;

const PARAMS = { name: "Moon Cat", symbol: "MCAT", metadataURI: JSON.stringify({ description: "test" }), quote: ethers.ZeroAddress, marketCapUsd8: 0n, devBuyQuote: 0n };

async function startAuction(f: F) {
  const tx = await f.factory.connect(f.creator).createAuction(PARAMS);
  const rc = await tx.wait();
  const ev = rc!.logs.map((l) => { try { return f.factory.interface.parseLog(l as any); } catch { return null; } }).find((e) => e?.name === "AuctionStarted")!;
  const token = ev.args.token as string;
  const floor = ev.args.floorPriceQ96 as bigint;
  return { token, floor, required: ev.args.minRaiseWei as bigint, tick: floor / 100n, endBlock: ev.args.endBlock as bigint };
}

async function bid(f: F, token: string, who: any, maxPrice: bigint, hype: bigint) {
  const rc = await (await f.house.connect(who).bid(token, maxPrice, 0, { value: hype })).wait();
  const ev = rc!.logs.map((l: any) => { try { return f.house.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "BidPlaced")!;
  return ev.args.bidId as bigint;
}

/** settle via the factory; returns the HYPE refunded to the bid owner (gas-adjusted when the owner calls). */
async function settle(f: F, token: string, bidId: bigint, caller: any, owner: any) {
  const hint = await f.house.exitHint(token, bidId);
  const before = await ethers.provider.getBalance(owner.address);
  const rc = await (await f.factory.connect(caller).settle(token, bidId, hint)).wait();
  const gas = caller.address === owner.address ? rc!.gasUsed * rc!.gasPrice : 0n;
  return (await ethers.provider.getBalance(owner.address)) - before + gas;
}

async function buy(f: F, token: string, who: any, hype: bigint) {
  return f.swapRouter.connect(who).exactInputSingle(
    { tokenIn: await f.wnative.getAddress(), tokenOut: token, fee: 10000, recipient: who.address, amountIn: hype, amountOutMinimum: 0, sqrtPriceLimitX96: 0 },
    { value: hype },
  );
}

describe("OnairFactory + OnairAuctionHouse", () => {
  it("instant: launches at ~$3k, seeds the whole supply, trades on the router, splits fees 70/30", async () => {
    const f = await deployFixture();
    await f.factory.connect(f.creator).createToken(PARAMS);
    const token = await f.factory.allTokens(0);
    const l = await f.factory.listings(token);
    expect(l.creator).to.equal(f.creator.address);
    expect(l.pool).to.not.equal(ethers.ZeroAddress);
    expect((await f.positionManager.positions(l.positionId)).liquidity).to.be.gt(0n);
    const coin = await ethers.getContractAt("OnairToken", token);
    expect(await coin.balanceOf(l.pool)).to.be.closeTo(SUPPLY, 10n ** 12n);

    await buy(f, token, f.trader, ethers.parseEther("1"));
    const got = await coin.balanceOf(f.trader.address);
    expect(got).to.be.gt(0n);
    expect(got).to.be.lt(SUPPLY * 3n / 100n); // $80 into a $3k market

    const before = await f.wnative.balanceOf(f.creator.address);
    await f.factory.connect(f.alice).harvestFees(token);
    const creatorGot = (await f.wnative.balanceOf(f.creator.address)) - before;
    const platformGot = await f.wnative.balanceOf(f.feeRecipient.address);
    const total = creatorGot + platformGot;
    expect(total).to.be.closeTo(ethers.parseEther("0.01"), ethers.parseEther("0.0001"));
    expect(creatorGot).to.be.closeTo(total * 7n / 10n, 10n);
    expect(platformGot).to.be.closeTo(total * 3n / 10n, 10n);
  });

  it("auction: escrow stays in the house, price rises with demand, early bids fill cheaper, pool opens at the clearing price", async () => {
    const f = await deployFixture();
    const a = await startAuction(f);
    const coin = await ethers.getContractAt("OnairToken", a.token);
    const H = await f.house.getAddress();
    expect(await coin.balanceOf(H)).to.equal(AUCTION_SUPPLY);
    expect(await coin.excluded(H)).to.equal(true);
    expect(a.required).to.equal(ethers.parseEther("220"));
    expect((await f.factory.listings(a.token)).pool).to.equal(ethers.ZeroAddress);

    // alice: 100 HYPE early, bob: 200 HYPE 60 blocks later, both up to 20x the floor
    const aliceId = await bid(f, a.token, f.alice, a.floor + 1900n * a.tick, ethers.parseEther("100"));
    const p1 = (await f.house.auction(a.token)).clearingQ96;
    expect(p1).to.be.gt(a.floor); // 100 HYPE over 500M coins already clears above the floor
    await mine(60);
    const bobId = await bid(f, a.token, f.bob, a.floor + 1900n * a.tick, ethers.parseEther("200"));
    const p2 = (await f.house.auction(a.token)).clearingQ96;
    expect(p2).to.be.gt(p1); // more demand, higher price, never lower
    expect(await ethers.provider.getBalance(H)).to.equal(ethers.parseEther("300")); // escrow held here
    await expect(f.house.connect(f.alice).bid(a.token, a.floor, 0, { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(f.house, "BelowClearing");
    await expect(f.factory.finalize(a.token)).to.be.revertedWithCustomError(f.house, "AuctionRunning");

    await mine(320);
    await f.factory.connect(f.trader).finalize(a.token);
    const info = await f.factory.auctions(a.token);
    expect(info.finalized).to.equal(true);
    expect(info.graduated).to.equal(true);
    const st = await f.house.auction(a.token);
    expect(st.raised).to.be.gte(a.required);
    const l = await f.factory.listings(a.token);
    expect(l.pool).to.not.equal(ethers.ZeroAddress);

    // pool price within one 1% tick of the final clearing price
    const pool = new ethers.Contract(l.pool, POOL_ABI, f.deployer);
    const [sqrtP] = await pool.slot0();
    const poolPriceQ96 = l.tokenIsToken0 ? (sqrtP * sqrtP) / Q96 : (Q96 * Q96) / ((sqrtP * sqrtP) / Q96);
    const dev = poolPriceQ96 > st.clearingQ96 ? poolPriceQ96 - st.clearingQ96 : st.clearingQ96 - poolPriceQ96;
    expect(dev * 100n / st.clearingQ96).to.be.lte(2n);
    // every raised HYPE went into the pool; the factory keeps nothing but dust
    expect(await f.wnative.balanceOf(l.pool)).to.be.closeTo(st.raised, 10n ** 6n);
    expect(await coin.balanceOf(await f.factory.getAddress())).to.be.lte(SUPPLY / 1_000_000n);
    expect(await coin.balanceOf(l.pool)).to.be.closeTo(SUPPLY - st.sold, SUPPLY / 1_000_000n);
    // the house still holds exactly the unspent budgets for refunds
    expect(await ethers.provider.getBalance(H)).to.equal(ethers.parseEther("300") - st.raised);

    // settle: coins + refund of unspent budget to each bidder
    const aliceRefund = await settle(f, a.token, aliceId, f.alice, f.alice);
    const bobRefund = await settle(f, a.token, bobId, f.trader, f.bob); // anyone can settle for bob
    const aliceCoins = await coin.balanceOf(f.alice.address);
    const bobCoins = await coin.balanceOf(f.bob.address);
    expect(aliceCoins).to.be.gt(0n);
    expect(bobCoins).to.be.gt(0n);
    expect(aliceCoins + bobCoins).to.be.closeTo(st.sold, 10n ** 9n);
    const aliceSpent = ethers.parseEther("100") - aliceRefund, bobSpent = ethers.parseEther("200") - bobRefund;
    expect(aliceSpent + bobSpent).to.equal(st.raised);
    expect(aliceCoins * bobSpent).to.be.gt(bobCoins * aliceSpent); // alice's average price < bob's
    expect(await ethers.provider.getBalance(H)).to.equal(0n); // escrow fully paid out
    await expect(f.factory.settle(a.token, aliceId, 0)).to.be.revertedWithCustomError(f.house, "AlreadyExited");

    // trading works right away; fees 70/30
    await buy(f, a.token, f.trader, ethers.parseEther("2"));
    const cBefore = await f.wnative.balanceOf(f.creator.address);
    await f.factory.harvestFees(a.token);
    expect((await f.wnative.balanceOf(f.creator.address)) - cBefore).to.be.closeTo(ethers.parseEther("0.014"), ethers.parseEther("0.0002"));
  });

  it("auction: below 220 HYPE it does not graduate, no pool opens, every bidder is refunded in full", async () => {
    const f = await deployFixture();
    const a = await startAuction(f);
    const coin = await ethers.getContractAt("OnairToken", a.token);
    const id = await bid(f, a.token, f.alice, a.floor + 100n * a.tick, ethers.parseEther("10"));
    await mine(320);
    await expect(f.factory.settle(a.token, id, 0)).to.be.revertedWithCustomError(f.factory, "NotFinalized");
    await f.factory.finalize(a.token);
    const info = await f.factory.auctions(a.token);
    expect(info.finalized).to.equal(true);
    expect(info.graduated).to.equal(false);
    expect((await f.factory.listings(a.token)).pool).to.equal(ethers.ZeroAddress);
    expect(await coin.balanceOf(await f.factory.getAddress())).to.equal(SUPPLY);
    const refund = await settle(f, a.token, id, f.alice, f.alice);
    expect(refund).to.equal(ethers.parseEther("10"));
    expect(await coin.balanceOf(f.alice.address)).to.equal(0n);
    await expect(f.factory.finalize(a.token)).to.be.revertedWithCustomError(f.factory, "AlreadyFinalized");
  });

  it("admin: collectEscrow takes the spent HYPE mid-auction, fills stand, unspent budgets stay refundable", async () => {
    const f = await deployFixture();
    const a = await startAuction(f);
    const coin = await ethers.getContractAt("OnairToken", a.token);
    const H = await f.house.getAddress();
    const id = await bid(f, a.token, f.alice, a.floor + 100n * a.tick, ethers.parseEther("30"));
    await mine(150); // half-way: ~half the budget is spent
    await expect(f.factory.connect(f.creator).collectEscrow(a.token, f.creator.address)).to.be.revertedWithCustomError(f.factory, "OwnableUnauthorizedAccount");
    const before = await ethers.provider.getBalance(f.trader.address);
    await f.factory.connect(f.owner).collectEscrow(a.token, f.trader.address);
    const collected = (await ethers.provider.getBalance(f.trader.address)) - before;
    expect(collected).to.be.closeTo(ethers.parseEther("15"), ethers.parseEther("1.5"));
    expect(await ethers.provider.getBalance(H)).to.equal(ethers.parseEther("30") - collected); // unspent still escrowed
    await expect(f.factory.connect(f.owner).cancelAuction(a.token)).to.be.revertedWithCustomError(f.house, "AlreadyFinalized");

    await mine(200);
    await f.factory.finalize(a.token);
    // 30 HYPE is under the 220 bond, but the fills stand because escrow was collected
    expect((await f.factory.auctions(a.token)).graduated).to.equal(true);
    const l = await f.factory.listings(a.token);
    expect(l.pool).to.not.equal(ethers.ZeroAddress);
    const refund = await settle(f, a.token, id, f.alice, f.alice);
    expect(await coin.balanceOf(f.alice.address)).to.be.gt(0n);
    expect(refund + collected + (await f.wnative.balanceOf(l.pool))).to.be.closeTo(ethers.parseEther("30"), 10n ** 6n);
    expect(await ethers.provider.getBalance(H)).to.equal(0n);
  });

  it("admin: sweepEscrow takes everything, spent or not; bidders keep coins, no refunds, coin-only pool", async () => {
    const f = await deployFixture();
    const a = await startAuction(f);
    const coin = await ethers.getContractAt("OnairToken", a.token);
    const H = await f.house.getAddress();
    const id = await bid(f, a.token, f.bob, a.floor + 1900n * a.tick, ethers.parseEther("70"));
    await mine(100);
    await expect(f.factory.connect(f.creator).sweepEscrow(a.token, f.creator.address)).to.be.revertedWithCustomError(f.factory, "OwnableUnauthorizedAccount");
    const before = await ethers.provider.getBalance(f.trader.address);
    await f.factory.connect(f.owner).sweepEscrow(a.token, f.trader.address);
    expect((await ethers.provider.getBalance(f.trader.address)) - before).to.equal(ethers.parseEther("70")); // all of it
    expect(await ethers.provider.getBalance(H)).to.equal(0n);
    await expect(f.factory.connect(f.owner).sweepEscrow(a.token, f.trader.address)).to.be.revertedWithCustomError(f.house, "ZeroAmount");
    await expect(f.factory.connect(f.owner).cancelAuction(a.token)).to.be.revertedWithCustomError(f.house, "AlreadyFinalized");

    await mine(250);
    await f.factory.finalize(a.token);
    expect((await f.factory.auctions(a.token)).graduated).to.equal(true);
    const l = await f.factory.listings(a.token);
    expect(l.pool).to.not.equal(ethers.ZeroAddress);
    expect(await f.wnative.balanceOf(l.pool)).to.equal(0n); // coin-only pool
    const refund = await settle(f, a.token, id, f.bob, f.bob);
    expect(refund).to.equal(0n);
    expect(await coin.balanceOf(f.bob.address)).to.be.gt(0n);
  });

  it("admin: cancel refunds everyone; pause/resume, fee recipient, HYPE price, config, collect; owner only", async () => {
    const f = await deployFixture();
    const a = await startAuction(f);
    const id = await bid(f, a.token, f.bob, a.floor + 100n * a.tick, ethers.parseEther("5"));
    await mine(10);
    await f.factory.connect(f.owner).cancelAuction(a.token);
    await expect(f.house.connect(f.alice).bid(a.token, a.floor, 0, { value: 1n })).to.be.revertedWithCustomError(f.house, "AuctionOver");
    await f.factory.finalize(a.token); // allowed early once cancelled
    expect((await f.factory.auctions(a.token)).graduated).to.equal(false);
    expect(await settle(f, a.token, id, f.bob, f.bob)).to.equal(ethers.parseEther("5"));

    await expect(f.factory.connect(f.creator).pause()).to.be.revertedWithCustomError(f.factory, "OwnableUnauthorizedAccount");
    await f.factory.connect(f.owner).pause();
    await expect(f.factory.connect(f.creator).createToken(PARAMS)).to.be.revertedWithCustomError(f.factory, "LaunchesArePaused");
    await expect(f.factory.connect(f.creator).createAuction(PARAMS)).to.be.revertedWithCustomError(f.factory, "LaunchesArePaused");
    await f.factory.connect(f.owner).resume();
    await f.factory.connect(f.owner).setFeeRecipient(f.trader.address);
    expect(await f.factory.feeRecipient()).to.equal(f.trader.address);
    const [floorBefore] = await f.factory.auctionPreview();
    await f.factory.connect(f.owner).setQuoteUsd(40n * 10n ** 8n);
    const [floor, required] = await f.factory.auctionPreview();
    expect(required).to.equal(ethers.parseEther("220"));
    expect(floor).to.be.closeTo(floorBefore * 2n, 200n);
    await expect(f.factory.connect(f.owner).setAuctionConfig(10, 0, 1, 1)).to.be.revertedWithCustomError(f.factory, "InvalidParams");
    await expect(f.factory.connect(f.owner).setAuctionHouse(await f.house.getAddress())).to.be.revertedWithCustomError(f.factory, "HouseAlreadySet");

    await f.factory.connect(f.creator).createToken(PARAMS);
    const token = await f.factory.allTokens(1);
    const l = await f.factory.listings(token);
    await expect(f.factory.connect(f.creator).collect(token, 5000, f.creator.address)).to.be.revertedWithCustomError(f.factory, "OwnableUnauthorizedAccount");
    const liqBefore = (await f.positionManager.positions(l.positionId)).liquidity;
    await f.factory.connect(f.owner).collect(token, 2500, f.trader.address);
    const coin = await ethers.getContractAt("OnairToken", token);
    expect(await coin.balanceOf(f.trader.address)).to.be.closeTo(SUPPLY / 4n, SUPPLY / 1000n);
    expect((await f.positionManager.positions(l.positionId)).liquidity).to.be.closeTo(liqBefore * 3n / 4n, liqBefore / 1000n);
    await f.factory.connect(f.owner).collectFees(token);
    expect((await f.positionManager.positions(l.positionId)).liquidity).to.equal(0n);
  });

  it("auction: devBuyQuote becomes the creator's opening bid; dust bids are rejected", async () => {
    const f = await deployFixture();
    await f.factory.connect(f.owner).setAuctionConfig(300, ethers.parseEther("0.05"), 3_000n * 10n ** 8n, ethers.parseEther("220"));
    await expect(f.factory.connect(f.creator).createAuction({ ...PARAMS, devBuyQuote: ethers.parseEther("1") })).to.be.revertedWithCustomError(f.factory, "InvalidParams");
    const rc = await (await f.factory.connect(f.creator).createAuction({ ...PARAMS, devBuyQuote: ethers.parseEther("1") }, { value: ethers.parseEther("1") })).wait();
    const ev = rc!.logs.map((l) => { try { return f.factory.interface.parseLog(l as any); } catch { return null; } }).find((e) => e?.name === "AuctionStarted")!;
    const token = ev.args.token as string;
    const floor = ev.args.floorPriceQ96 as bigint;
    expect(await f.house.bidCount(token)).to.equal(1n);
    const b = await f.house.bids(token, 0);
    expect(b.owner).to.equal(f.creator.address);
    expect(b.budget).to.equal(ethers.parseEther("1"));
    expect(b.maxPriceQ96).to.equal(floor * 100n);
    expect((await f.house.auction(token)).escrow).to.equal(ethers.parseEther("1"));
    await expect(f.house.connect(f.alice).bid(token, floor, 0, { value: ethers.parseEther("0.01") })).to.be.revertedWithCustomError(f.house, "BidTooSmall");
    await bid(f, token, f.alice, floor + 200n * floor / 100n, ethers.parseEther("0.05"));
    expect(await f.house.bidCount(token)).to.equal(2n);
  });

  it("tamper: a pool created ahead of finalize at a wrong price is restored, even through parked liquidity", async () => {
    const f = await deployFixture();
    const wnative = await f.wnative.getAddress();
    for (const parkLiquidity of [false, true]) {
      const a = await startAuction(f);
      await bid(f, a.token, f.alice, a.floor + 1900n * a.tick, ethers.parseEther("240"));
      // attacker: pool at "1 coin = 1 HYPE" (tick 0), ~10 million times our price
      const coinIs0 = a.token.toLowerCase() < wnative.toLowerCase();
      const [t0, t1] = coinIs0 ? [a.token, wnative] : [wnative, a.token];
      await f.positionManager.connect(f.trader).createAndInitializePoolIfNecessary(t0, t1, 10000, Q96);
      if (parkLiquidity) {
        // WHYPE-only liquidity on the path between the fake price and ours
        await f.wnative.connect(f.trader).deposit({ value: ethers.parseEther("1") });
        await f.wnative.connect(f.trader).approve(await f.positionManager.getAddress(), ethers.parseEther("1"));
        await f.positionManager.connect(f.trader).mint({
          token0: t0, token1: t1, fee: 10000, tickLower: coinIs0 ? -2000 : 200, tickUpper: coinIs0 ? -200 : 2000,
          amount0Desired: coinIs0 ? 0 : ethers.parseEther("1"), amount1Desired: coinIs0 ? ethers.parseEther("1") : 0,
          amount0Min: 0, amount1Min: 0, recipient: f.trader.address, deadline: 4102444800,
        });
      }
      await mine(300);
      const rc = await (await f.factory.finalize(a.token)).wait();
      const logs = rc!.logs.map((l) => { try { return f.factory.interface.parseLog(l as any); } catch { return null; } });
      const created = logs.find((e) => e?.name === "PoolCreated")!;
      const restored = logs.find((e) => e?.name === "PoolPriceRestored")!;
      expect(restored, "price restore event").to.not.equal(undefined);
      const pool = new ethers.Contract(created.args.pool, POOL_ABI, ethers.provider);
      const [sqrt] = await pool.slot0();
      expect(sqrt).to.equal(created.args.sqrtPriceX96);
      expect(await pool.liquidity()).to.be.gt(0n);
      // every wei of WHYPE the launch holds (the raise, plus what the attacker's
      // parked liquidity paid for coins above our price) is in the pool
      expect(await f.wnative.balanceOf(await f.factory.getAddress())).to.be.lte(10n ** 12n);
      if (parkLiquidity) expect(await (await ethers.getContractAt("OnairToken", a.token)).balanceOf(f.trader.address)).to.equal(0n);
      // the coin still trades at the clearing price, not the attacker's
      const coin = await ethers.getContractAt("OnairToken", a.token);
      await buy(f, a.token, f.bob, ethers.parseEther("1"));
      expect(await coin.balanceOf(f.bob.address)).to.be.gt(ethers.parseEther("1000000"));
    }
  });

  it("tamper: instant launch survives a pool pre-created at the predicted coin address", async () => {
    const f = await deployFixture();
    const wnative = await f.wnative.getAddress();
    const td = await f.tokenDeployer.getAddress();
    const predicted = ethers.getCreateAddress({ from: td, nonce: await ethers.provider.getTransactionCount(td) });
    const coinIs0 = predicted.toLowerCase() < wnative.toLowerCase();
    const [t0, t1] = coinIs0 ? [predicted, wnative] : [wnative, predicted];
    // cheap direction: 1 coin = 1e-12 HYPE (way under the $3k launch price)
    const cheap = coinIs0 ? Q96 / 10n ** 6n : 10n ** 6n * Q96;
    await f.positionManager.connect(f.trader).createAndInitializePoolIfNecessary(t0, t1, 10000, cheap);
    const rc = await (await f.factory.connect(f.creator).createToken(PARAMS)).wait();
    const logs = rc!.logs.map((l) => { try { return f.factory.interface.parseLog(l as any); } catch { return null; } });
    const created = logs.find((e) => e?.name === "PoolCreated")!;
    expect(created.args.token).to.equal(predicted);
    expect(logs.find((e) => e?.name === "PoolPriceRestored")).to.not.equal(undefined);
    const pool = new ethers.Contract(created.args.pool, POOL_ABI, ethers.provider);
    const [sqrt] = await pool.slot0();
    expect(sqrt).to.equal(created.args.sqrtPriceX96);
    const l = await f.factory.listings(predicted);
    expect((await f.positionManager.positions(l.positionId)).liquidity).to.be.gt(0n);
    // 1 HYPE buys roughly 1/37.5 of the supply at a $3k FDV, not the whole supply
    await buy(f, predicted, f.bob, ethers.parseEther("1"));
    const bal = await (await ethers.getContractAt("OnairToken", predicted)).balanceOf(f.bob.address);
    expect(bal).to.be.gt(SUPPLY / 60n);
    expect(bal).to.be.lt(SUPPLY / 30n);
  });
  it("instant: stock pair — approved quote only, pool sized in the stock's decimals, first buy by allowance, fees paid in the stock", async () => {
    const f = await deployFixture();
    // A 6-decimal ERC20 stands in for a tokenized stock priced at $500.
    const stock = await (await ethers.getContractFactory("MockUSD")).deploy();
    const stockAddr = await stock.getAddress();
    await stock.transfer(f.creator.address, 1_000e6);
    await stock.transfer(f.trader.address, 1_000e6);
    const withStock = { ...PARAMS, quote: stockAddr };

    await expect(f.factory.connect(f.creator).createToken(withStock)).to.be.revertedWithCustomError(f.factory, "QuoteNotApproved");
    await expect(f.factory.connect(f.alice).setQuoteAsset(stockAddr, true, 500n * 10n ** 8n)).to.be.revertedWithCustomError(f.factory, "OwnableUnauthorizedAccount");
    await expect(f.factory.connect(f.owner).setQuoteAsset(stockAddr, true, 0)).to.be.revertedWithCustomError(f.factory, "InvalidParams");
    await expect(f.factory.connect(f.owner).setQuoteAsset(await f.wnative.getAddress(), false, 1)).to.be.revertedWithCustomError(f.factory, "InvalidParams");
    await f.factory.connect(f.owner).setQuoteAsset(stockAddr, true, 500n * 10n ** 8n);
    expect(await f.factory.quoteCount()).to.equal(2n);
    expect(await f.factory.quoteList(1)).to.equal(stockAddr);
    const q = await f.factory.quoteAssets(stockAddr);
    expect(q.approved).to.equal(true);
    expect(q.decimals).to.equal(6);

    // Native attached to a stock-paired launch is refused; the first buy is pulled by allowance.
    await expect(f.factory.connect(f.creator).createToken({ ...withStock, devBuyQuote: 1e6 }, { value: 1n })).to.be.revertedWithCustomError(f.factory, "InvalidParams");
    await stock.connect(f.creator).approve(await f.factory.getAddress(), 1e6);
    await f.factory.connect(f.creator).createToken({ ...withStock, devBuyQuote: 1e6 });
    const token = await f.factory.allTokens(0);
    const l = await f.factory.listings(token);
    expect(l.quote).to.equal(stockAddr);
    const coin = await ethers.getContractAt("OnairToken", token);
    const pool = new ethers.Contract(l.pool, ["function token0() view returns (address)", "function token1() view returns (address)"], ethers.provider);
    expect([await pool.token0(), await pool.token1()]).to.include(stockAddr);
    expect(await stock.balanceOf(l.pool)).to.equal(1e6); // the first buy (1 stock, $500) sits in the pool
    const devCoins = await coin.balanceOf(f.creator.address);
    expect(devCoins).to.be.gt(0n);

    // $3k market in a $500 stock is 6 stock units of FDV: 1 stock (a sixth of
    // the cap) buys a big slice but far less than a sixth after slippage.
    await stock.connect(f.trader).approve(await f.swapRouter.getAddress(), 1e6);
    await f.swapRouter.connect(f.trader).exactInputSingle({ tokenIn: stockAddr, tokenOut: token, fee: 10000, recipient: f.trader.address, amountIn: 1e6, amountOutMinimum: 0, sqrtPriceLimitX96: 0 });
    const got = await coin.balanceOf(f.trader.address);
    expect(got).to.be.gt(SUPPLY / 200n);
    expect(got).to.be.lt(SUPPLY / 6n);

    // Fees accrue and split in the stock, 70 / 30.
    const before = await stock.balanceOf(f.creator.address);
    await f.factory.connect(f.alice).harvestFees(token);
    const creatorGot = (await stock.balanceOf(f.creator.address)) - before;
    const platformGot = await stock.balanceOf(f.feeRecipient.address);
    const total = creatorGot + platformGot;
    expect(total).to.be.closeTo(20_000n, 400n); // 1% of 2 stock
    expect(creatorGot).to.be.closeTo(total * 7n / 10n, 10n);
    expect(platformGot).to.be.closeTo(total * 3n / 10n, 10n);

    // Auctions are bid in native HYPE, so a stock pair is refused there; a
    // retired quote is refused everywhere.
    await expect(f.factory.connect(f.creator).createAuction(withStock)).to.be.revertedWithCustomError(f.factory, "QuoteNotApproved");
    await f.factory.connect(f.owner).setQuoteAsset(stockAddr, false, 0);
    expect(await f.factory.quoteCount()).to.equal(2n);
    await expect(f.factory.connect(f.creator).createToken(withStock)).to.be.revertedWithCustomError(f.factory, "QuoteNotApproved");
    await f.factory.connect(f.creator).createToken(PARAMS); // HYPE pair still fine
  });
});
