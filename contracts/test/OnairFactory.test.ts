import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import UniswapV3FactoryArtifact from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import SwapRouterArtifact from "@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json";
import PositionManagerArtifact from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";

// OnairFactory against the REAL Uniswap V3 stack (factory, position manager,
// SwapRouter02) and the REAL, unmodified Uniswap Continuous Clearing Auction.
// HYPE is priced at $80 so the $3k floor is 37.5 HYPE of FDV. An auction must
// raise 220 HYPE to graduate. Fees split 70% creator / 30% platform.

const SUPPLY = ethers.parseEther("1000000000");
const AUCTION_SUPPLY = SUPPLY / 2n;
const Q96 = 1n << 96n;
const HYPE_USD8 = 80n * 10n ** 8n;
const DEADLINE = 4_000_000_000n;
const POOL_ABI = ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)", "function liquidity() view returns (uint128)"];

async function deployFixture() {
  const [deployer, owner, feeRecipient, creator, alice, bob, trader] = await ethers.getSigners();
  const wnative = await (await ethers.getContractFactory("WrappedNative")).deploy("Wrapped HYPE", "WHYPE");
  const uniFactory = await new ethers.ContractFactory(UniswapV3FactoryArtifact.abi, UniswapV3FactoryArtifact.bytecode, deployer).deploy();
  const positionManager = await new ethers.ContractFactory(PositionManagerArtifact.abi, PositionManagerArtifact.bytecode, deployer)
    .deploy(await uniFactory.getAddress(), await wnative.getAddress(), ethers.ZeroAddress);
  const swapRouter = await new ethers.ContractFactory(SwapRouterArtifact.abi, SwapRouterArtifact.bytecode, deployer)
    .deploy(ethers.ZeroAddress, await uniFactory.getAddress(), await positionManager.getAddress(), await wnative.getAddress());
  const ccaFactory = await (await ethers.getContractFactory("ContinuousClearingAuctionFactory")).deploy(ethers.ZeroAddress);
  const tokenDeployer = await (await ethers.getContractFactory("OnairTokenDeployer")).deploy();
  const factory = await (await ethers.getContractFactory("OnairFactory")).deploy(
    owner.address, feeRecipient.address, await tokenDeployer.getAddress(), await uniFactory.getAddress(),
    await positionManager.getAddress(), await swapRouter.getAddress(), await wnative.getAddress(),
    await ccaFactory.getAddress(), HYPE_USD8, 0, 7000, 10000,
  );
  await tokenDeployer.setFactory(await factory.getAddress());
  // short auctions for tests: 300 blocks, claim immediately, $3k floor, 220 HYPE to graduate
  await factory.connect(owner).setAuctionConfig(300, 0, 3_000n * 10n ** 8n, ethers.parseEther("220"));
  return { deployer, owner, feeRecipient, creator, alice, bob, trader, wnative, uniFactory, positionManager, swapRouter, ccaFactory, tokenDeployer, factory };
}
type F = Awaited<ReturnType<typeof deployFixture>>;

const PARAMS = { name: "Moon Cat", symbol: "MCAT", metadataURI: JSON.stringify({ description: "test" }), marketCapUsd8: 0n, devBuyQuote: 0n };

async function startAuction(f: F) {
  const tx = await f.factory.connect(f.creator).createAuction(PARAMS);
  const rc = await tx.wait();
  const ev = rc!.logs.map((l) => { try { return f.factory.interface.parseLog(l as any); } catch { return null; } }).find((e) => e?.name === "AuctionStarted")!;
  const token = ev.args.token as string, auction = ev.args.auction as string;
  const cca = await ethers.getContractAt("ContinuousClearingAuction", auction);
  const floor = ev.args.floorPriceQ96 as bigint;
  const required = ev.args.requiredCurrencyRaised as bigint;
  const tick = floor / 100n;
  return { token, auction, cca, floor, required, tick, endBlock: ev.args.endBlock as bigint };
}

async function bid(cca: any, who: any, maxPrice: bigint, hype: bigint) {
  const tx = await cca.connect(who)["submitBid(uint256,uint128,address,bytes)"](maxPrice, hype, who.address, "0x", { value: hype });
  const rc = await tx.wait();
  const ev = rc!.logs.map((l: any) => { try { return cca.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "BidSubmitted")!;
  return ev.args.id as bigint;
}

/** Exit hint for a bid that ended at (or below) the clearing price: the last
 *  checkpoint where the clearing price was still under the bid's max price. */
async function exitHint(cca: any, bidId: bigint): Promise<bigint | null> {
  const bid = await cca.bids(bidId);
  let b: bigint = bid.startBlock;
  let cp = await cca.checkpoints(b);
  while (cp.next !== 0n) {
    const nxt = await cca.checkpoints(cp.next);
    if (cp.clearingPrice < bid.maxPrice && nxt.clearingPrice >= bid.maxPrice) return b;
    b = cp.next; cp = nxt;
  }
  return null; // max price stayed above the final clearing price: plain exitBid
}
async function exit(cca: any, who: any, bidId: bigint) {
  const hint = await exitHint(cca, bidId);
  const tx = hint === null ? await cca.connect(who).exitBid(bidId) : await cca.connect(who).exitPartiallyFilledBid(bidId, hint, 0);
  return tx.wait();
}

async function buy(f: F, token: string, who: any, hype: bigint) {
  return f.swapRouter.connect(who).exactInputSingle(
    { tokenIn: await f.wnative.getAddress(), tokenOut: token, fee: 10000, recipient: who.address, amountIn: hype, amountOutMinimum: 0, sqrtPriceLimitX96: 0 },
    { value: hype },
  );
}

describe("OnairFactory", () => {
  it("instant: launches at ~$3k, seeds the whole supply, trades on the router, splits fees 70/30", async () => {
    const f = await deployFixture();
    await f.factory.connect(f.creator).createToken(PARAMS);
    const token = await f.factory.allTokens(0);
    const l = await f.factory.listings(token);
    expect(l.creator).to.equal(f.creator.address);
    expect(l.pool).to.not.equal(ethers.ZeroAddress);
    const pos = await f.positionManager.positions(l.positionId);
    expect(pos.liquidity).to.be.gt(0n);
    const coin = await ethers.getContractAt("OnairToken", token);
    expect(await coin.balanceOf(l.pool)).to.be.closeTo(SUPPLY, 10n ** 12n);

    await buy(f, token, f.trader, ethers.parseEther("1"));
    const got = await coin.balanceOf(f.trader.address);
    expect(got).to.be.gt(0n);
    // 1 HYPE = $80 into a $3k market: well under 3% of supply
    expect(got).to.be.lt(SUPPLY * 3n / 100n);

    // fees: 1% of 1 HYPE = 0.01 WHYPE accrued; harvest splits creator 70 / platform 30
    const before = await f.wnative.balanceOf(f.creator.address);
    await f.factory.connect(f.alice).harvestFees(token);
    const creatorGot = (await f.wnative.balanceOf(f.creator.address)) - before;
    const platformGot = await f.wnative.balanceOf(f.feeRecipient.address);
    expect(await coin.totalRewardsDistributed()).to.equal(0n);
    const total = creatorGot + platformGot;
    expect(total).to.be.closeTo(ethers.parseEther("0.01"), ethers.parseEther("0.0001"));
    expect(creatorGot).to.be.closeTo(total * 7n / 10n, 10n);
    expect(platformGot).to.be.closeTo(total * 3n / 10n, 10n);
  });

  it("auction: bids clear at one rising price, graduates, seeds a two-sided locked pool at the clearing price", async () => {
    const f = await deployFixture();
    const a = await startAuction(f);
    const coin = await ethers.getContractAt("OnairToken", a.token);
    expect(await coin.balanceOf(a.auction)).to.equal(AUCTION_SUPPLY);
    expect(await coin.excluded(a.auction)).to.equal(true);
    expect(a.required).to.equal(ethers.parseEther("220"));
    expect((await f.factory.listings(a.token)).pool).to.equal(ethers.ZeroAddress);

    // alice: 100 HYPE early, bob: 200 HYPE later, both willing to pay up to 20x the floor
    // (ticks are floor/100 steps). Together they clear the whole slice well above the floor.
    const aliceId = await bid(a.cca, f.alice, a.floor + 1900n * a.tick, ethers.parseEther("100"));
    await mine(60);
    const bobId = await bid(a.cca, f.bob, a.floor + 1900n * a.tick, ethers.parseEther("200"));
    expect(await a.cca.clearingPrice()).to.be.gte(a.floor);
    await expect(f.factory.finalize(a.token)).to.be.revertedWithCustomError(f.factory, "AuctionStillRunning");

    await mine(320);
    await f.factory.connect(f.trader).finalize(a.token);
    const info = await f.factory.auctions(a.token);
    expect(info.finalized).to.equal(true);
    expect(info.graduated).to.equal(true);
    const l = await f.factory.listings(a.token);
    expect(l.pool).to.not.equal(ethers.ZeroAddress);

    // the clearing price is above the floor and the pool opened at it
    const clearing = await a.cca.clearingPrice();
    expect(clearing).to.be.gt(a.floor);
    const raised = await a.cca.currencyRaised();
    expect(raised).to.be.gte(a.required);
    const pool = new ethers.Contract(l.pool, POOL_ABI, f.deployer);
    const [sqrtP] = await pool.slot0();
    // pool price (HYPE per token, Q96) within one 1% tick of the clearing price
    const tokenIs0 = l.tokenIsToken0;
    const poolPriceQ96 = tokenIs0 ? (sqrtP * sqrtP) / Q96 : (Q96 * Q96) / ((sqrtP * sqrtP) / Q96);
    const dev = poolPriceQ96 > clearing ? poolPriceQ96 - clearing : clearing - poolPriceQ96;
    expect(dev * 100n / clearing).to.be.lte(2n);

    // every raised HYPE and every unsold coin is in the pool; the factory keeps nothing
    expect(await f.wnative.balanceOf(await f.factory.getAddress())).to.be.lt(10n ** 6n); // mint rounding dust
    expect(await ethers.provider.getBalance(await f.factory.getAddress())).to.equal(0n);
    expect(await coin.balanceOf(await f.factory.getAddress())).to.be.lte(SUPPLY / 1_000_000n); // mint rounding dust
    expect(await f.wnative.balanceOf(l.pool)).to.be.closeTo(raised, 10n ** 6n);

    // bidders exit (settle fills, refund unspent budget) then claim their coins.
    // Alice bid earlier, so her fills were spread over cheaper blocks: at least as
    // many coins per HYPE as bob, never fewer.
    const aliceBefore = await ethers.provider.getBalance(f.alice.address);
    const rcA = await exit(a.cca, f.alice, aliceId);
    const aliceRefund = (await ethers.provider.getBalance(f.alice.address)) - aliceBefore + rcA!.gasUsed * rcA!.gasPrice;
    const bobBefore = await ethers.provider.getBalance(f.bob.address);
    const rcB = await exit(a.cca, f.bob, bobId);
    const bobRefund = (await ethers.provider.getBalance(f.bob.address)) - bobBefore + rcB!.gasUsed * rcB!.gasPrice;
    await a.cca.connect(f.alice).claimTokens(aliceId);
    await a.cca.connect(f.bob).claimTokens(bobId);
    const aliceCoins = await coin.balanceOf(f.alice.address);
    const bobCoins = await coin.balanceOf(f.bob.address);
    expect(aliceCoins).to.be.gt(0n);
    expect(bobCoins).to.be.gt(0n);
    expect(aliceCoins + bobCoins).to.be.lte(AUCTION_SUPPLY);
    const aliceSpent = ethers.parseEther("100") - aliceRefund, bobSpent = ethers.parseEther("200") - bobRefund;
    expect(aliceSpent + bobSpent).to.be.closeTo(raised, 10n);
    expect(aliceCoins * bobSpent).to.be.gte(bobCoins * aliceSpent); // alice's average price <= bob's
    // whatever the auction did not sell went into the pool (two-sided + overflow position)
    const sold = await a.cca.totalCleared();
    expect(await coin.balanceOf(l.pool)).to.be.closeTo(SUPPLY - sold, ethers.parseEther("1"));

    // trading works right away and fees flow 70/30 to creator / platform
    await buy(f, a.token, f.trader, ethers.parseEther("2"));
    const cBefore = await f.wnative.balanceOf(f.creator.address);
    await f.factory.harvestFees(a.token);
    const cGot = (await f.wnative.balanceOf(f.creator.address)) - cBefore;
    expect(cGot).to.be.closeTo(ethers.parseEther("0.014"), ethers.parseEther("0.0002"));
  });

  it("auction: below the minimum it does not graduate, no pool opens, bidders refund themselves", async () => {
    const f = await deployFixture();
    const a = await startAuction(f);
    const coin = await ethers.getContractAt("OnairToken", a.token);
    const id = await bid(a.cca, f.alice, a.floor + 100n * a.tick, ethers.parseEther("10"));
    await mine(320);
    await f.factory.finalize(a.token);
    const info = await f.factory.auctions(a.token);
    expect(info.finalized).to.equal(true);
    expect(info.graduated).to.equal(false);
    expect((await f.factory.listings(a.token)).pool).to.equal(ethers.ZeroAddress);
    // unsold supply came back to the factory; alice gets her HYPE back
    expect(await coin.balanceOf(await f.factory.getAddress())).to.equal(SUPPLY);
    const before = await ethers.provider.getBalance(f.alice.address);
    const rc = await (await a.cca.connect(f.alice).exitBid(id)).wait();
    const after = await ethers.provider.getBalance(f.alice.address);
    expect(after - before + rc!.gasUsed * rc!.gasPrice).to.equal(ethers.parseEther("10"));
    await expect(f.factory.finalize(a.token)).to.be.revertedWithCustomError(f.factory, "AlreadyFinalized");
  });

  it("auction: the first bidder to settle after the end migrates the coin to HyperSwap by itself", async () => {
    const f = await deployFixture();
    const a = await startAuction(f);
    const coin = await ethers.getContractAt("OnairToken", a.token);
    const aliceId = await bid(a.cca, f.alice, a.floor + 1900n * a.tick, ethers.parseEther("150"));
    const bobId = await bid(a.cca, f.bob, a.floor + 1900n * a.tick, ethers.parseEther("150"));
    await mine(320);
    // nobody called finalize; alice settles her own bid and that opens the pool
    const hintA = await exitHint(a.cca, aliceId);
    await f.factory.connect(f.alice).settle(a.token, aliceId, hintA ?? 0n);
    expect((await f.factory.auctions(a.token)).graduated).to.equal(true);
    expect((await f.factory.listings(a.token)).pool).to.not.equal(ethers.ZeroAddress);
    expect(await coin.balanceOf(f.alice.address)).to.be.gt(0n);
    // anyone can settle bob's bid; coins still land with bob
    const hintB = await exitHint(a.cca, bobId);
    await f.factory.connect(f.trader).settle(a.token, bobId, hintB ?? 0n);
    expect(await coin.balanceOf(f.bob.address)).to.be.gt(0n);
    expect(await coin.balanceOf(f.trader.address)).to.equal(0n);
    // settling twice is harmless
    await f.factory.connect(f.bob).settle(a.token, bobId, hintB ?? 0n);
  });

  it("admin: pause/resume, fee recipient, HYPE price, auction config, recover; only owner", async () => {
    const f = await deployFixture();
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
    expect(required).to.equal(ethers.parseEther("220")); // the bond is fixed in HYPE
    expect(floor).to.be.closeTo(floorBefore * 2n, 200n); // $3k floor costs twice the HYPE at $40 (tick-rounded)
    await expect(f.factory.connect(f.owner).setAuctionConfig(10, 0, 1, 1)).to.be.revertedWithCustomError(f.factory, "InvalidParams");
    await expect(f.factory.connect(f.owner).setAuctionConfig(300, 0, 3_000n * 10n ** 8n, 0)).to.be.revertedWithCustomError(f.factory, "InvalidParams");
    // owner can pull principal from a launched pool (collect / collectFees), nobody else
    await f.factory.connect(f.creator).createToken(PARAMS);
    const token = await f.factory.allTokens(0);
    const l = await f.factory.listings(token);
    await expect(f.factory.connect(f.creator).collectFees(token)).to.be.revertedWithCustomError(f.factory, "OwnableUnauthorizedAccount");
    await expect(f.factory.connect(f.creator).collect(token, 5000, f.creator.address)).to.be.revertedWithCustomError(f.factory, "OwnableUnauthorizedAccount");
    const liqBefore = (await f.positionManager.positions(l.positionId)).liquidity;
    await f.factory.connect(f.owner).collect(token, 2500, f.trader.address); // 25% to a chosen recipient
    const coin = await ethers.getContractAt("OnairToken", token);
    expect(await coin.balanceOf(f.trader.address)).to.be.closeTo(SUPPLY / 4n, SUPPLY / 1000n);
    expect((await f.positionManager.positions(l.positionId)).liquidity).to.be.closeTo(liqBefore * 3n / 4n, liqBefore / 1000n);
    await f.factory.connect(f.owner).collectFees(token); // the rest to the owner
    expect(await coin.balanceOf(f.owner.address)).to.be.closeTo(SUPPLY * 3n / 4n, SUPPLY / 1000n);
    expect((await f.positionManager.positions(l.positionId)).liquidity).to.equal(0n);
  });
});
