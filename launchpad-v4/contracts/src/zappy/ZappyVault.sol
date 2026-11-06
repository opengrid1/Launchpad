// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title ZappyVault
 * @notice A public ETH lending vault for Zappy leverage. Anyone deposits ETH
 * and gets vault shares (zvETH); the one margin contract borrows from it to
 * open leveraged longs and pays back with interest. Interest, and any surplus
 * a liquidation pays on top of a debt, raise the value of every share; a debt
 * a liquidation cannot cover lowers it. A share is worth
 * (cash + debt - reserves) / supply.
 *
 * The borrow rate follows utilization: baseAprBps + slopeAprBps * utilization.
 * reserveFactorBps of the interest goes to protocol reserves. Borrowing stops
 * at maxUtilizationBps so depositors can always withdraw part of the vault;
 * a withdrawal larger than the idle ETH waits until positions close.
 *
 * The margin contract is set once and can never be changed, so the owner can
 * not point the vault's ETH at another borrower.
 */
contract ZappyVault is ERC20, Ownable2Step, ReentrancyGuard {
    uint256 private constant BPS = 10_000;
    uint256 private constant WAD = 1e18;
    uint256 private constant YEAR = 365 days;
    uint256 private constant VIRTUAL_SHARES = 1e3; // inflation-attack offset
    uint256 private constant MAX_BASE_APR_BPS = 5_000;
    uint256 private constant MAX_SLOPE_APR_BPS = 20_000;
    uint256 private constant MAX_RESERVE_FACTOR_BPS = 3_000;
    uint256 private constant MAX_UTILIZATION_CEILING_BPS = 9_500;

    error NotMargin();
    error MarginAlreadySet();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidParam();
    error InsufficientLiquidity(uint256 available, uint256 wanted);
    error Slippage(uint256 got, uint256 minimum);
    error TransferFailed();
    error OwnershipCannotBeRenounced();

    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 shares, uint256 assets);
    event Borrow(uint256 amount, uint256 scaled);
    event Repay(uint256 scaled, uint256 owed, uint256 paid);
    event Accrued(uint256 index, uint256 interest, uint256 toReserves);
    event RateModelUpdated(uint256 baseAprBps, uint256 slopeAprBps);
    event ReserveFactorUpdated(uint256 bps);
    event MaxUtilizationUpdated(uint256 bps);
    event MarginSet(address margin);
    event ReservesClaimed(address indexed to, uint256 amount);

    address public margin;
    uint256 public borrowIndex = WAD; // debt per scaled unit, grows with interest
    uint256 public totalScaledDebt;
    uint256 public reserves; // ETH held here that belongs to the protocol
    uint256 public lastAccrual;
    uint256 public baseAprBps = 500; // 5%
    uint256 public slopeAprBps = 3_000; // +30% at full use
    uint256 public reserveFactorBps = 1_000; // 10% of interest
    uint256 public maxUtilizationBps = 9_000;

    constructor(address initialOwner) ERC20("Zappy Vault ETH", "zvETH") Ownable(initialOwner) {
        lastAccrual = block.timestamp;
    }

    receive() external payable {
        if (msg.sender != margin) revert NotMargin();
    }

    // ------------------------------------------------------------------ views

    function totalDebt() public view returns (uint256) {
        return Math.mulDiv(totalScaledDebt, currentIndex(), WAD, Math.Rounding.Ceil);
    }

    /// @notice ETH the vault holds that is free to lend or withdraw.
    function idle() public view returns (uint256) {
        uint256 bal = address(this).balance;
        uint256 r = _reservesNow();
        return bal > r ? bal - r : 0;
    }

    function totalAssets() public view returns (uint256) {
        return idle() + totalDebt();
    }

    function utilizationBps() public view returns (uint256) {
        uint256 d = totalDebt();
        uint256 a = idle() + d;
        return a == 0 ? 0 : (d * BPS) / a;
    }

    function borrowAprBps() public view returns (uint256) {
        return baseAprBps + (slopeAprBps * utilizationBps()) / BPS;
    }

    /// @notice The supply APR depositors earn right now, before reserves are taken.
    function supplyAprBps() external view returns (uint256) {
        return (borrowAprBps() * utilizationBps() * (BPS - reserveFactorBps)) / BPS / BPS;
    }

    function currentIndex() public view returns (uint256) {
        (uint256 idx,) = _pending();
        return idx;
    }

    function debtOf(uint256 scaled) external view returns (uint256) {
        return Math.mulDiv(scaled, currentIndex(), WAD, Math.Rounding.Ceil);
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, totalSupply() + VIRTUAL_SHARES, totalAssets() + 1);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares, totalAssets() + 1, totalSupply() + VIRTUAL_SHARES);
    }

    /// @notice How much ETH the vault can lend now without passing the utilization cap.
    function borrowable() public view returns (uint256) {
        uint256 d = totalDebt();
        uint256 i = idle();
        uint256 a = i + d;
        uint256 cap = (a * maxUtilizationBps) / BPS;
        if (d >= cap) return 0;
        return Math.min(cap - d, i);
    }

    // ------------------------------------------------------------- depositors

    function deposit(uint256 minShares) external payable nonReentrant returns (uint256 shares) {
        if (msg.value == 0) revert ZeroAmount();
        _accrue();
        // value of the vault before this deposit arrived
        uint256 assetsBefore = totalAssets() - msg.value;
        shares = Math.mulDiv(msg.value, totalSupply() + VIRTUAL_SHARES, assetsBefore + 1);
        if (shares == 0 || shares < minShares) revert Slippage(shares, minShares);
        _mint(msg.sender, shares);
        emit Deposit(msg.sender, msg.value, shares);
    }

    function withdraw(uint256 shares, uint256 minAssets) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        _accrue();
        assets = convertToAssets(shares);
        if (assets < minAssets) revert Slippage(assets, minAssets);
        uint256 i = idle();
        if (assets > i) revert InsufficientLiquidity(i, assets);
        _burn(msg.sender, shares);
        _send(msg.sender, assets);
        emit Withdraw(msg.sender, shares, assets);
    }

    // ----------------------------------------------------------------- margin

    function borrow(uint256 amount) external nonReentrant returns (uint256 scaled) {
        if (msg.sender != margin) revert NotMargin();
        if (amount == 0) revert ZeroAmount();
        _accrue();
        uint256 b = borrowable();
        if (amount > b) revert InsufficientLiquidity(b, amount);
        scaled = Math.mulDiv(amount, WAD, borrowIndex, Math.Rounding.Ceil);
        totalScaledDebt += scaled;
        _send(msg.sender, amount);
        emit Borrow(amount, scaled);
    }

    /**
     * @notice Clears `scaled` of debt with the ETH sent. Less than owed is a
     * loss the depositors take; more is a gain they keep.
     */
    function repay(uint256 scaled) external payable nonReentrant returns (uint256 owed) {
        if (msg.sender != margin) revert NotMargin();
        _accrue();
        if (scaled > totalScaledDebt) scaled = totalScaledDebt;
        owed = Math.mulDiv(scaled, borrowIndex, WAD, Math.Rounding.Ceil);
        totalScaledDebt -= scaled;
        emit Repay(scaled, owed, msg.value);
    }

    // ------------------------------------------------------------------ owner

    function setMargin(address margin_) external onlyOwner {
        if (margin != address(0)) revert MarginAlreadySet();
        if (margin_ == address(0)) revert ZeroAddress();
        margin = margin_;
        emit MarginSet(margin_);
    }

    function setRateModel(uint256 base, uint256 slope) external onlyOwner {
        if (base > MAX_BASE_APR_BPS || slope > MAX_SLOPE_APR_BPS) revert InvalidParam();
        _accrue();
        baseAprBps = base;
        slopeAprBps = slope;
        emit RateModelUpdated(base, slope);
    }

    function setReserveFactor(uint256 bps) external onlyOwner {
        if (bps > MAX_RESERVE_FACTOR_BPS) revert InvalidParam();
        _accrue();
        reserveFactorBps = bps;
        emit ReserveFactorUpdated(bps);
    }

    function setMaxUtilization(uint256 bps) external onlyOwner {
        if (bps == 0 || bps > MAX_UTILIZATION_CEILING_BPS) revert InvalidParam();
        maxUtilizationBps = bps;
        emit MaxUtilizationUpdated(bps);
    }

    function claimReserves(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _accrue();
        uint256 r = Math.min(reserves, address(this).balance);
        if (amount > r) amount = r;
        reserves -= amount;
        _send(to, amount);
        emit ReservesClaimed(to, amount);
    }

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    // --------------------------------------------------------------- internal

    function _pending() private view returns (uint256 idx, uint256 interest) {
        idx = borrowIndex;
        uint256 dt = block.timestamp - lastAccrual;
        if (dt == 0 || totalScaledDebt == 0) return (idx, 0);
        uint256 debt = Math.mulDiv(totalScaledDebt, idx, WAD);
        uint256 bal = address(this).balance;
        uint256 i = bal > reserves ? bal - reserves : 0;
        uint256 util = (debt * BPS) / (i + debt);
        uint256 apr = baseAprBps + (slopeAprBps * util) / BPS;
        uint256 growth = (idx * apr * dt) / (BPS * YEAR);
        idx += growth;
        interest = Math.mulDiv(totalScaledDebt, growth, WAD);
    }

    function _reservesNow() private view returns (uint256) {
        (, uint256 interest) = _pending();
        return reserves + (interest * reserveFactorBps) / BPS;
    }

    function _accrue() private {
        (uint256 idx, uint256 interest) = _pending();
        lastAccrual = block.timestamp;
        if (idx == borrowIndex) return;
        borrowIndex = idx;
        uint256 toReserves = (interest * reserveFactorBps) / BPS;
        reserves += toReserves;
        emit Accrued(idx, interest, toReserves);
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
