// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IStockOracle} from "./interfaces/IStockOracle.sol";

/// @title StockLendMarket
/// @notice On-chain securities lending for Robinhood-chain tokenized stocks.
///
///         Lenders supply a stock and earn the borrow fee. Borrowers post USDG
///         collateral and borrow the stock (to short, hedge, or hold market-maker
///         inventory), paying a utilization-based rate. Undercollateralized
///         positions are liquidated: a liquidator repays stock debt and seizes
///         USDG collateral at a bonus.
///
///         Every stock position is kept in RAW ERC-20 units. Robinhood stock
///         tokens (ERC-8056) express splits and dividends through a display
///         multiplier that leaves raw balances untouched, so the ledger here never
///         needs corporate-action handling: a lender's raw claim and a borrower's
///         raw debt scale together. Only the oracle applies the multiplier
///         (price per raw unit), which makes a dividend raise the value of the
///         borrower's debt -- the "dividend in lieu" a short seller owes.
///
///         Risk is carried on the BORROWED side: each market has its own LTV and
///         liquidation threshold (a volatile stock gets a lower LTV), applied as
///         Compound-style borrow factors against the single USDG collateral.
contract StockLendMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    /// @dev USDG is 6-decimal; positions and prices are 18-decimal.
    uint256 private constant USDG_TO_WAD = 1e12;
    uint256 public constant CLOSE_FACTOR_BPS = 5_000; // liquidate up to 50% of a debt per call

    struct RateParams {
        uint64 baseRateBps;   // annual, at 0% utilization
        uint64 slope1Bps;     // annual, added linearly up to the kink
        uint64 slope2Bps;     // annual, added linearly from the kink to 100%
        uint64 kinkBps;       // utilization where slope2 starts
    }

    struct RiskParams {
        uint16 ltvBps;              // max borrow value per unit of collateral (borrow factor)
        uint16 liqThresholdBps;     // above this the position is liquidatable
        uint16 liqBonusBps;         // collateral bonus paid to the liquidator
        uint16 reserveFactorBps;    // protocol cut of interest
    }

    struct Market {
        bool listed;
        bool borrowsPaused;
        uint256 cash;           // raw stock held, not lent out
        uint256 totalBorrows;   // raw stock lent out, incl. accrued interest
        uint256 totalReserves;  // raw stock owed to the protocol
        uint256 borrowIndex;    // cumulative interest index, WAD
        uint256 lastAccrue;
        uint256 totalShares;    // lender shares
        uint256 supplyCap;      // raw, 0 = none
        uint256 borrowCap;      // raw, 0 = none
        RateParams rate;
        RiskParams risk;
    }

    struct BorrowSnapshot {
        uint256 principal;  // raw debt at last interaction
        uint256 index;      // borrowIndex at last interaction
    }

    IERC20 public immutable usdg;
    IStockOracle public oracle;
    address public feeRecipient;

    address[] public listedStocks;
    mapping(address stock => Market) internal _markets;
    mapping(address stock => mapping(address user => uint256)) public shares;
    mapping(address stock => mapping(address user => BorrowSnapshot)) internal _borrows;
    /// @notice USDG collateral per account, in USDG units (6-dec).
    mapping(address user => uint256) public collateral;

    event MarketListed(address indexed stock);
    event MarketParamsSet(address indexed stock);
    event BorrowsPausedSet(address indexed stock, bool paused);
    event Supplied(address indexed stock, address indexed user, uint256 amount, uint256 sharesMinted);
    event Withdrawn(address indexed stock, address indexed user, uint256 amount, uint256 sharesBurned);
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event Borrowed(address indexed stock, address indexed user, uint256 amount);
    event Repaid(address indexed stock, address indexed user, address indexed payer, uint256 amount);
    event Liquidated(address indexed stock, address indexed borrower, address indexed liquidator, uint256 repaid, uint256 collateralSeized);
    event Accrued(address indexed stock, uint256 interest, uint256 borrowIndex);
    event ReservesWithdrawn(address indexed stock, uint256 amount, address to);
    event OracleSet(address indexed oracle);
    event FeeRecipientSet(address indexed recipient);

    error NotListed();
    error AlreadyListed();
    error BorrowsPaused();
    error ZeroAmount();
    error InsufficientCash();
    error InsufficientCollateral();
    error NotLiquidatable();
    error CapExceeded();
    error BadParams();
    error TooMuchRepay();

    constructor(address owner_, IERC20 usdg_, IStockOracle oracle_, address feeRecipient_) Ownable(owner_) {
        require(address(usdg_) != address(0) && address(oracle_) != address(0) && feeRecipient_ != address(0), "zero");
        usdg = usdg_;
        oracle = oracle_;
        feeRecipient = feeRecipient_;
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function listMarket(address stock, RateParams calldata rate, RiskParams calldata risk, uint256 supplyCap, uint256 borrowCap)
        external
        onlyOwner
    {
        Market storage m = _markets[stock];
        if (m.listed) revert AlreadyListed();
        _validate(rate, risk);
        m.listed = true;
        m.borrowIndex = WAD;
        m.lastAccrue = block.timestamp;
        m.rate = rate;
        m.risk = risk;
        m.supplyCap = supplyCap;
        m.borrowCap = borrowCap;
        listedStocks.push(stock);
        emit MarketListed(stock);
    }

    function setMarketParams(address stock, RateParams calldata rate, RiskParams calldata risk, uint256 supplyCap, uint256 borrowCap)
        external
        onlyOwner
    {
        Market storage m = _market(stock);
        _accrue(stock, m);
        _validate(rate, risk);
        m.rate = rate;
        m.risk = risk;
        m.supplyCap = supplyCap;
        m.borrowCap = borrowCap;
        emit MarketParamsSet(stock);
    }

    /// @notice Halt new borrows (e.g. around earnings / market open) without
    ///         touching supply, repay or liquidation.
    function setBorrowsPaused(address stock, bool paused) external onlyOwner {
        _market(stock).borrowsPaused = paused;
        emit BorrowsPausedSet(stock, paused);
    }

    function setOracle(IStockOracle oracle_) external onlyOwner {
        require(address(oracle_) != address(0), "zero");
        oracle = oracle_;
        emit OracleSet(address(oracle_));
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        require(recipient != address(0), "zero");
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice Pull accrued protocol reserves (in the stock) to the fee recipient.
    function withdrawReserves(address stock, uint256 amount) external onlyOwner nonReentrant {
        Market storage m = _market(stock);
        _accrue(stock, m);
        require(amount <= m.totalReserves, "reserves");
        if (amount > m.cash) revert InsufficientCash();
        m.totalReserves -= amount;
        m.cash -= amount;
        IERC20(stock).safeTransfer(feeRecipient, amount);
        emit ReservesWithdrawn(stock, amount, feeRecipient);
    }

    function _validate(RateParams calldata rate, RiskParams calldata risk) private pure {
        if (rate.kinkBps == 0 || rate.kinkBps > BPS) revert BadParams();
        if (risk.ltvBps == 0 || risk.ltvBps >= risk.liqThresholdBps || risk.liqThresholdBps > BPS) revert BadParams();
        if (risk.liqBonusBps > 3_000 || risk.reserveFactorBps > 5_000) revert BadParams();
    }

    // ------------------------------------------------------------------
    // Interest accrual
    // ------------------------------------------------------------------

    function accrue(address stock) external {
        _accrue(stock, _market(stock));
    }

    function _accrue(address stock, Market storage m) internal {
        uint256 dt = block.timestamp - m.lastAccrue;
        if (dt == 0) return;
        m.lastAccrue = block.timestamp;
        if (m.totalBorrows == 0) return;
        uint256 ratePerSec = _borrowRatePerSec(m);
        uint256 factor = ratePerSec * dt;                       // WAD-scaled growth over dt
        uint256 interest = (m.totalBorrows * factor) / WAD;
        m.totalBorrows += interest;
        m.totalReserves += (interest * m.risk.reserveFactorBps) / BPS;
        m.borrowIndex = (m.borrowIndex * (WAD + factor)) / WAD;
        emit Accrued(stock, interest, m.borrowIndex);
    }

    function _utilization(Market storage m) internal view returns (uint256) {
        uint256 total = m.cash + m.totalBorrows;
        if (total == 0) return 0;
        return (m.totalBorrows * WAD) / total;
    }

    /// @dev Kinked annual borrow rate in bps at the current utilization.
    function _annualBorrowBps(Market storage m) internal view returns (uint256 annualBps) {
        uint256 util = _utilization(m);
        uint256 kink = (uint256(m.rate.kinkBps) * WAD) / BPS;
        if (util <= kink) {
            annualBps = m.rate.baseRateBps + (uint256(m.rate.slope1Bps) * util) / kink;
        } else {
            annualBps = m.rate.baseRateBps + m.rate.slope1Bps
                + (uint256(m.rate.slope2Bps) * (util - kink)) / (WAD - kink);
        }
    }

    /// @dev Per-second WAD rate derived from the annual bps rate.
    function _borrowRatePerSec(Market storage m) internal view returns (uint256) {
        return (_annualBorrowBps(m) * WAD) / BPS / SECONDS_PER_YEAR;
    }

    // ------------------------------------------------------------------
    // Lend side
    // ------------------------------------------------------------------

    /// @dev Stock per share, WAD. Backed by cash + outstanding loans, minus the
    ///      protocol's reserves.
    function exchangeRate(address stock) public view returns (uint256) {
        Market storage m = _market(stock);
        if (m.totalShares == 0) return WAD;
        uint256 backing = m.cash + m.totalBorrows - m.totalReserves;
        return (backing * WAD) / m.totalShares;
    }

    function supply(address stock, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Market storage m = _market(stock);
        _accrue(stock, m);
        if (m.supplyCap != 0 && m.cash + m.totalBorrows + amount > m.supplyCap) revert CapExceeded();
        uint256 minted = (amount * WAD) / exchangeRate(stock);
        IERC20(stock).safeTransferFrom(msg.sender, address(this), amount);
        m.cash += amount;
        m.totalShares += minted;
        shares[stock][msg.sender] += minted;
        emit Supplied(stock, msg.sender, amount, minted);
    }

    function withdraw(address stock, uint256 sharesToBurn) external nonReentrant {
        if (sharesToBurn == 0) revert ZeroAmount();
        Market storage m = _market(stock);
        _accrue(stock, m);
        uint256 amount = (sharesToBurn * exchangeRate(stock)) / WAD;
        if (amount > m.cash) revert InsufficientCash(); // lent out; wait for repayments
        shares[stock][msg.sender] -= sharesToBurn;
        m.totalShares -= sharesToBurn;
        m.cash -= amount;
        IERC20(stock).safeTransfer(msg.sender, amount);
        emit Withdrawn(stock, msg.sender, amount, sharesToBurn);
    }

    // ------------------------------------------------------------------
    // Borrow side
    // ------------------------------------------------------------------

    function depositCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdg.safeTransferFrom(msg.sender, address(this), amount);
        collateral[msg.sender] += amount;
        emit CollateralDeposited(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        collateral[msg.sender] -= amount;
        _requireHealthyForBorrow(msg.sender);
        usdg.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    function borrow(address stock, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Market storage m = _market(stock);
        if (m.borrowsPaused) revert BorrowsPaused();
        _accrue(stock, m);
        if (amount > m.cash) revert InsufficientCash();
        if (m.borrowCap != 0 && m.totalBorrows + amount > m.borrowCap) revert CapExceeded();

        uint256 debt = borrowBalance(stock, msg.sender) + amount;
        _borrows[stock][msg.sender] = BorrowSnapshot({principal: debt, index: m.borrowIndex});
        m.totalBorrows += amount;
        m.cash -= amount;
        _requireHealthyForBorrow(msg.sender);
        IERC20(stock).safeTransfer(msg.sender, amount);
        emit Borrowed(stock, msg.sender, amount);
    }

    function repay(address stock, uint256 amount) external nonReentrant {
        _repay(stock, msg.sender, msg.sender, amount);
    }

    function repayOnBehalf(address stock, address borrower, uint256 amount) external nonReentrant {
        _repay(stock, borrower, msg.sender, amount);
    }

    function _repay(address stock, address borrower, address payer, uint256 amount) internal returns (uint256 paid) {
        if (amount == 0) revert ZeroAmount();
        Market storage m = _market(stock);
        _accrue(stock, m);
        uint256 debt = borrowBalance(stock, borrower);
        paid = amount > debt ? debt : amount;
        if (paid == 0) revert ZeroAmount();
        IERC20(stock).safeTransferFrom(payer, address(this), paid);
        _borrows[stock][borrower] = BorrowSnapshot({principal: debt - paid, index: m.borrowIndex});
        m.totalBorrows -= paid;
        m.cash += paid;
        emit Repaid(stock, borrower, payer, paid);
    }

    /// @notice Repay up to CLOSE_FACTOR of an undercollateralized borrower's
    ///         stock debt and seize USDG collateral worth the repayment plus the
    ///         market's liquidation bonus.
    function liquidate(address stock, address borrower, uint256 repayAmount) external nonReentrant {
        if (repayAmount == 0) revert ZeroAmount();
        Market storage m = _market(stock);
        _accrue(stock, m);
        if (!isLiquidatable(borrower)) revert NotLiquidatable();

        uint256 debt = borrowBalance(stock, borrower);
        uint256 maxRepay = (debt * CLOSE_FACTOR_BPS) / BPS;
        if (repayAmount > maxRepay) revert TooMuchRepay();

        // Value the repaid raw stock via the oracle, add the bonus, convert to USDG.
        uint256 price = oracle.getPrice(stock);
        uint256 repayUsd = (repayAmount * price) / WAD;                       // WAD USD
        uint256 seizeUsd = (repayUsd * (BPS + m.risk.liqBonusBps)) / BPS;
        uint256 seize = seizeUsd / USDG_TO_WAD;                                // USDG 6-dec
        uint256 have = collateral[borrower];
        if (seize > have) seize = have;

        IERC20(stock).safeTransferFrom(msg.sender, address(this), repayAmount);
        _borrows[stock][borrower] = BorrowSnapshot({principal: debt - repayAmount, index: m.borrowIndex});
        m.totalBorrows -= repayAmount;
        m.cash += repayAmount;
        collateral[borrower] = have - seize;
        usdg.safeTransfer(msg.sender, seize);
        emit Liquidated(stock, borrower, msg.sender, repayAmount, seize);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function borrowBalance(address stock, address user) public view returns (uint256) {
        BorrowSnapshot memory s = _borrows[stock][user];
        if (s.principal == 0) return 0;
        Market storage m = _markets[stock];
        return (s.principal * m.borrowIndex) / s.index;
    }

    /// @notice Collateral value (WAD USD), total debt (WAD USD), and the debt
    ///         weighted by each market's borrow factor / liquidation threshold.
    function accountLiquidity(address user)
        public
        view
        returns (uint256 collateralUsd, uint256 debtUsd, uint256 borrowLimitUsed, uint256 liqLimitUsed)
    {
        collateralUsd = collateral[user] * USDG_TO_WAD;
        uint256 n = listedStocks.length;
        for (uint256 i; i < n; ++i) {
            address stock = listedStocks[i];
            uint256 debt = borrowBalance(stock, user);
            if (debt == 0) continue;
            Market storage m = _markets[stock];
            uint256 usd = (debt * oracle.getPrice(stock)) / WAD;
            debtUsd += usd;
            borrowLimitUsed += (usd * BPS) / m.risk.ltvBps;
            liqLimitUsed += (usd * BPS) / m.risk.liqThresholdBps;
        }
    }

    function isLiquidatable(address user) public view returns (bool) {
        (uint256 coll, , , uint256 liqUsed) = accountLiquidity(user);
        return liqUsed > coll;
    }

    /// @notice Health factor, WAD (1e18 = at the liquidation line). max if no debt.
    function healthFactor(address user) external view returns (uint256) {
        (uint256 coll, , , uint256 liqUsed) = accountLiquidity(user);
        if (liqUsed == 0) return type(uint256).max;
        return (coll * WAD) / liqUsed;
    }

    function utilization(address stock) external view returns (uint256) {
        return _utilization(_market(stock));
    }

    /// @notice Current annual borrow rate in bps.
    function borrowRateBps(address stock) external view returns (uint256) {
        return _annualBorrowBps(_market(stock));
    }

    /// @notice Current annual supply rate in bps (borrow rate * utilization,
    ///         net of the reserve factor).
    function supplyRateBps(address stock) external view returns (uint256) {
        Market storage m = _market(stock);
        uint256 borrowBps = _annualBorrowBps(m);
        uint256 util = _utilization(m);
        return (borrowBps * util * (BPS - m.risk.reserveFactorBps)) / WAD / BPS;
    }

    function market(address stock) external view returns (Market memory) {
        return _markets[stock];
    }

    function listedCount() external view returns (uint256) {
        return listedStocks.length;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _market(address stock) internal view returns (Market storage m) {
        m = _markets[stock];
        if (!m.listed) revert NotListed();
    }

    function _requireHealthyForBorrow(address user) internal view {
        (uint256 coll, , uint256 borrowUsed, ) = accountLiquidity(user);
        if (borrowUsed > coll) revert InsufficientCollateral();
    }
}
