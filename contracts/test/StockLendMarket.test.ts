import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// Proves the lending-market logic end to end: interest accrual, LTV enforcement,
// liquidation math, the ERC-8056 dividend-in-lieu property (a raw-unit debt
// grows in value when the oracle's per-raw price rises), lender yield, reserves,
// and the oracle's staleness / deviation guards.

const WAD = 10n ** 18n;
const USDG_1 = 10n ** 6n; // 1 USDG (6-dec)
const MINT_ROLE = ethers.id("MINT_ROLE");

const RATE = { baseRateBps: 200n, slope1Bps: 1000n, slope2Bps: 5000n, kinkBps: 8000n }; // 2% + 10% to kink, +50% after
const RISK = { ltvBps: 5000, liqThresholdBps: 6500, liqBonusBps: 800, reserveFactorBps: 1000 }; // 50% LTV, 65% liq, 8% bonus, 10% reserve

async function setup() {
  const [deployer, lender, borrower, liquidator, feeRecipient] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockB20");
  const usdg = await Mock.deploy("USDG", "USDG", deployer.address, 6);
  const tsla = await Mock.deploy("Tesla", "TSLA", deployer.address, 18);
  for (const t of [usdg, tsla]) await t.grantRole(MINT_ROLE, deployer.address);

  const oracle = await (await ethers.getContractFactory("StockOracle")).deploy(deployer.address);
  await oracle.setKeeper(deployer.address, true);
  await oracle.setPrice(await tsla.getAddress(), 300n * WAD); // $300 per raw TSLA

  const market = await (await ethers.getContractFactory("StockLendMarket")).deploy(
    deployer.address, await usdg.getAddress(), await oracle.getAddress(), feeRecipient.address,
  );
  await market.listMarket(await tsla.getAddress(), RATE, RISK, 0, 0);

  // Fund: lender 100 TSLA, borrower 30,000 USDG (+ some TSLA to cover interest), liquidator 100 TSLA.
  await tsla.mint(lender.address, 100n * WAD);
  await usdg.mint(borrower.address, 30_000n * USDG_1);
  await tsla.mint(borrower.address, 10n * WAD);
  await tsla.mint(liquidator.address, 100n * WAD);

  const T = await tsla.getAddress();
  const M = await market.getAddress();
  for (const [tok, who] of [[tsla, lender], [tsla, borrower], [tsla, liquidator], [usdg, borrower]] as const) {
    await tok.connect(who).approve(M, ethers.MaxUint256);
  }
  return { deployer, lender, borrower, liquidator, feeRecipient, usdg, tsla, oracle, market, T, M };
}

const near = (a: bigint, b: bigint, tolBps = 5n) => {
  const diff = a > b ? a - b : b - a;
  expect(diff * 10_000n <= (b === 0n ? 1n : b) * tolBps, `${a} !~ ${b}`).to.be.true;
};

describe("StockLendMarket", () => {
  it("supply mints 1:1 shares at a fresh exchange rate", async () => {
    const { lender, market, T } = await setup();
    await market.connect(lender).supply(T, 100n * WAD);
    expect(await market.shares(T, lender.address)).to.equal(100n * WAD);
    expect(await market.exchangeRate(T)).to.equal(WAD);
    const m = await market.market(T);
    expect(m.cash).to.equal(100n * WAD);
  });

  it("enforces LTV on borrow (borrow factor against USDG collateral)", async () => {
    const { lender, borrower, market, T } = await setup();
    await market.connect(lender).supply(T, 100n * WAD);
    await market.connect(borrower).depositCollateral(30_000n * USDG_1); // $30k, 50% LTV -> $15k = 50 TSLA @ $300

    await market.connect(borrower).borrow(T, 40n * WAD); // $12k OK
    expect(await market.borrowBalance(T, borrower.address)).to.equal(40n * WAD);

    await expect(market.connect(borrower).borrow(T, 20n * WAD)) // total $18k > $15k
      .to.be.revertedWithCustomError(market, "InsufficientCollateral");

    // Just under the limit is allowed (9 more -> 49 TSLA = $14.7k; a few wei of
    // interest accrue between blocks, so the exact edge is not testable).
    await market.connect(borrower).borrow(T, 9n * WAD);
    const [coll, debt, borrowUsed] = await market.accountLiquidity(borrower.address);
    expect(coll).to.equal(30_000n * WAD);
    near(debt, 14_700n * WAD, 5n);
    near(borrowUsed, 29_400n * WAD, 5n); // 14.7k / 0.5
  });

  it("accrues interest to borrowers, lenders and reserves over time", async () => {
    const { lender, borrower, market, T } = await setup();
    await market.connect(lender).supply(T, 100n * WAD);
    await market.connect(borrower).depositCollateral(30_000n * USDG_1);
    await market.connect(borrower).borrow(T, 40n * WAD);

    // util 40% of an 80% kink -> 2% + 10% * 0.5 = 7% annual.
    expect(await market.borrowRateBps(T)).to.equal(700n);

    await time.increase(365 * 24 * 3600);
    await market.accrue(T);

    // 40 * 7% = 2.8 TSLA interest (single linear accrual over the year).
    near(await market.borrowBalance(T, borrower.address), 428n * WAD / 10n, 20n);
    const m = await market.market(T);
    near(m.totalReserves, 28n * WAD / 100n, 50n); // 10% of 2.8
    // exchange rate: (60 cash + 42.8 borrows - 0.28 reserves) / 100 shares = 1.0252
    near(await market.exchangeRate(T), 10252n * WAD / 10000n, 20n);
  });

  it("repay reduces debt and lender withdraws principal + interest", async () => {
    const { lender, borrower, market, tsla, T } = await setup();
    await market.connect(lender).supply(T, 100n * WAD);
    await market.connect(borrower).depositCollateral(30_000n * USDG_1);
    await market.connect(borrower).borrow(T, 40n * WAD);
    await time.increase(365 * 24 * 3600);

    // Repay everything (borrower holds 40 borrowed + 10 minted, enough for ~42.8).
    await market.connect(borrower).repay(T, 100n * WAD); // capped to debt
    expect(await market.borrowBalance(T, borrower.address)).to.equal(0n);

    const before = await tsla.balanceOf(lender.address);
    await market.connect(lender).withdraw(T, await market.shares(T, lender.address));
    const got = (await tsla.balanceOf(lender.address)) - before;
    // 100 principal + 2.8 interest - 0.28 reserves = 102.52
    near(got, 10252n * WAD / 100n, 20n);
    expect(got).to.be.gt(100n * WAD);
  });

  it("liquidates an undercollateralized borrower with the bonus, up to the close factor", async () => {
    const { lender, borrower, liquidator, market, oracle, usdg, T } = await setup();
    await market.connect(lender).supply(T, 100n * WAD);
    await market.connect(borrower).depositCollateral(30_000n * USDG_1);
    await market.connect(borrower).borrow(T, 40n * WAD); // $12k vs $30k, healthy
    expect(await market.isLiquidatable(borrower.address)).to.equal(false);
    await expect(market.connect(liquidator).liquidate(T, borrower.address, 1n * WAD))
      .to.be.revertedWithCustomError(market, "NotLiquidatable");

    // TSLA doubles to $600: debt $24k; liq limit used = 24k / 0.65 = $36.9k > $30k.
    await oracle.forcePrice(T, 600n * WAD);
    expect(await market.isLiquidatable(borrower.address)).to.equal(true);

    // More than the 50% close factor is refused.
    await expect(market.connect(liquidator).liquidate(T, borrower.address, 21n * WAD))
      .to.be.revertedWithCustomError(market, "TooMuchRepay");

    const liqBefore = await usdg.balanceOf(liquidator.address);
    await market.connect(liquidator).liquidate(T, borrower.address, 20n * WAD);
    // Seize = 20 * $600 * 1.08 = $12,960 USDG.
    expect((await usdg.balanceOf(liquidator.address)) - liqBefore).to.equal(12_960n * USDG_1);
    expect(await market.collateral(borrower.address)).to.equal((30_000n - 12_960n) * USDG_1);
    near(await market.borrowBalance(T, borrower.address), 20n * WAD, 5n); // 40 (+dust interest) - 20
  });

  it("ERC-8056 dividend-in-lieu: a per-raw price rise increases the borrower's debt value", async () => {
    const { lender, borrower, market, oracle, T } = await setup();
    await market.connect(lender).supply(T, 100n * WAD);
    await market.connect(borrower).depositCollateral(30_000n * USDG_1);
    await market.connect(borrower).borrow(T, 40n * WAD);
    const [, debtBefore] = await market.accountLiquidity(borrower.address);
    const hfBefore = await market.healthFactor(borrower.address);

    // A dividend raises uiMultiplier -> the keeper posts a higher price per raw
    // unit. Raw debt is unchanged; its USD value (what the short owes) rises.
    await oracle.setPrice(T, 310n * WAD); // +3.33%
    expect(await market.borrowBalance(T, borrower.address)).to.equal(40n * WAD); // raw unchanged
    const [, debtAfter] = await market.accountLiquidity(borrower.address);
    expect(debtAfter).to.equal(40n * 310n * WAD);
    expect(debtAfter).to.be.gt(debtBefore);
    expect(await market.healthFactor(borrower.address)).to.be.lt(hfBefore);
  });

  it("collects protocol reserves to the fee recipient", async () => {
    const { lender, borrower, market, tsla, feeRecipient, T } = await setup();
    await market.connect(lender).supply(T, 100n * WAD);
    await market.connect(borrower).depositCollateral(30_000n * USDG_1);
    await market.connect(borrower).borrow(T, 40n * WAD);
    await time.increase(365 * 24 * 3600);
    await market.accrue(T);
    const m = await market.market(T);
    await market.withdrawReserves(T, m.totalReserves);
    near(await tsla.balanceOf(feeRecipient.address), 28n * WAD / 100n, 50n);
  });

  it("pausing borrows blocks new loans but not repay/withdraw", async () => {
    const { lender, borrower, market, T } = await setup();
    await market.connect(lender).supply(T, 100n * WAD);
    await market.connect(borrower).depositCollateral(30_000n * USDG_1);
    await market.connect(borrower).borrow(T, 10n * WAD);
    await market.setBorrowsPaused(T, true);
    await expect(market.connect(borrower).borrow(T, 1n * WAD)).to.be.revertedWithCustomError(market, "BorrowsPaused");
    await market.connect(borrower).repay(T, 100n * WAD); // still works; capped to full debt incl. interest dust
    expect(await market.borrowBalance(T, borrower.address)).to.equal(0n);
  });

  it("withdrawCollateral is blocked when it would breach the LTV", async () => {
    const { lender, borrower, market, T } = await setup();
    await market.connect(lender).supply(T, 100n * WAD);
    await market.connect(borrower).depositCollateral(30_000n * USDG_1);
    await market.connect(borrower).borrow(T, 40n * WAD); // needs $24k coll at 50% LTV
    await expect(market.connect(borrower).withdrawCollateral(10_000n * USDG_1)) // would leave $20k
      .to.be.revertedWithCustomError(market, "InsufficientCollateral");
    await market.connect(borrower).withdrawCollateral(6_000n * USDG_1); // leaves $24k, exactly ok
  });

  describe("StockOracle guards", () => {
    it("rejects a single-update move beyond the deviation cap, allows forcePrice", async () => {
      const { oracle, T } = await setup();
      await expect(oracle.setPrice(T, 400n * WAD)).to.be.revertedWithCustomError(oracle, "Deviation"); // +33% > 20%
      await oracle.setPrice(T, 350n * WAD); // +16.7% ok
      await oracle.forcePrice(T, 700n * WAD); // owner override for a real gap
      expect(await oracle.getPrice(T)).to.equal(700n * WAD);
    });

    it("reverts reads once the price is stale, which freezes borrows", async () => {
      const { lender, borrower, market, oracle, T } = await setup();
      await market.connect(lender).supply(T, 100n * WAD);
      await market.connect(borrower).depositCollateral(30_000n * USDG_1);
      await time.increase(31 * 60); // past the 30-minute maxAge
      await expect(oracle.getPrice(T)).to.be.revertedWithCustomError(oracle, "Stale");
      await expect(market.connect(borrower).borrow(T, 1n * WAD)).to.be.revertedWithCustomError(oracle, "Stale");
    });
  });
});
