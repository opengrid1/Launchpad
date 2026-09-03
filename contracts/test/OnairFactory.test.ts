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

const PARAMS = { name: "Moon Cat", symbol: "MCAT", metadataURI: JSON.stringify({ description: "test" }), marketCapUsd8: 0n, devBuyQuote: 0n };

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
});
