// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title OnairToken
/// @notice Fixed-supply launchpad coin with an on-chain holder dividend tracker
///         (MasterChef-style accumulator, O(1) per distribution). The factory
///         routes the holders' share of every harvested pool fee here in the
///         coin's pair asset (WHYPE) and holders accrue it pro-rata. The AMM
///         pool, the auction contract and system addresses are excluded so
///         rewards only reach real holders. Claims are pull-based.
///
///         No taxes, no owner. The factory's only powers are the one-time pool
///         wiring, marking system addresses as excluded, and crediting rewards.
contract OnairToken is ERC20 {
    using SafeERC20 for IERC20;

    uint256 private constant ACC_PRECISION = 1e24;

    address public immutable creator;
    address public immutable rewardToken;
    address private immutable _factory;

    uint256 private accRewardPerShare;
    uint256 public eligibleSupply;
    mapping(address => uint256) private rewardDebt;
    mapping(address => uint256) public claimable;
    mapping(address => bool) public excluded;
    uint256 public totalRewardsDistributed;
    bool private _poolInited;
    string private _metadataURI;

    event ExcludedSet(address indexed account, bool excluded);
    event RewardsDistributed(uint256 amount);
    event RewardsClaimed(address indexed holder, uint256 amount);

    error OnlyFactory();
    error PoolAlreadySet();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 supply_,
        address creator_,
        address factory_,
        address rewardToken_
    ) ERC20(name_, symbol_) {
        creator = creator_;
        _factory = factory_;
        rewardToken = rewardToken_;
        _metadataURI = metadataURI_;
        excluded[address(0)] = true;
        excluded[address(this)] = true;
        excluded[factory_] = true;
        _mint(factory_, supply_);
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice One-time pool wiring by the factory.
    function initPool(address pool_) external {
        if (msg.sender != _factory) revert OnlyFactory();
        if (_poolInited) revert PoolAlreadySet();
        _poolInited = true;
        _setExcluded(pool_, true);
    }

    /// @notice Mark a system address (e.g. the auction contract that custodies
    ///         supply during a launch) as excluded from dividends.
    function setExcluded(address account, bool value) external {
        if (msg.sender != _factory) revert OnlyFactory();
        _setExcluded(account, value);
    }

    function distributeRewards(uint256 amount) external {
        if (msg.sender != _factory) revert OnlyFactory();
        uint256 supply = eligibleSupply;
        if (amount == 0 || supply == 0) return;
        accRewardPerShare += (amount * ACC_PRECISION) / supply;
        totalRewardsDistributed += amount;
        emit RewardsDistributed(amount);
    }

    function pendingRewards(address holder) public view returns (uint256) {
        if (excluded[holder]) return claimable[holder];
        uint256 accrued = (balanceOf(holder) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[holder];
        uint256 extra = accrued > debt ? accrued - debt : 0;
        return claimable[holder] + extra;
    }

    function claim() external returns (uint256 amount) {
        return _claimTo(msg.sender);
    }

    function claimFor(address holder) external returns (uint256 amount) {
        return _claimTo(holder);
    }

    function claimForMany(address[] calldata holders) external {
        for (uint256 i; i < holders.length; ++i) _claimTo(holders[i]);
    }

    function _claimTo(address holder) private returns (uint256 amount) {
        _settle(holder);
        amount = claimable[holder];
        if (amount == 0) return 0;
        claimable[holder] = 0;
        emit RewardsClaimed(holder, amount);
        IERC20(rewardToken).safeTransfer(holder, amount);
    }

    function _settle(address account) private {
        if (account == address(0) || excluded[account]) return;
        uint256 accrued = (balanceOf(account) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[account];
        if (accrued > debt) claimable[account] += accrued - debt;
        rewardDebt[account] = accrued;
    }

    function _resetDebt(address account) private {
        rewardDebt[account] = (balanceOf(account) * accRewardPerShare) / ACC_PRECISION;
    }

    function _setExcluded(address account, bool value) private {
        if (excluded[account] == value) return;
        uint256 bal = balanceOf(account);
        if (value) {
            _settle(account);
            if (bal != 0) eligibleSupply -= bal;
        } else {
            if (bal != 0) eligibleSupply += bal;
            _resetDebt(account);
        }
        excluded[account] = value;
        emit ExcludedSet(account, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        bool fromEligible = from != address(0) && !excluded[from];
        bool toEligible = to != address(0) && !excluded[to];
        if (fromEligible) _settle(from);
        if (toEligible) _settle(to);
        super._update(from, to, value);
        if (fromEligible && !toEligible) eligibleSupply -= value;
        else if (!fromEligible && toEligible) eligibleSupply += value;
        if (fromEligible) _resetDebt(from);
        if (toEligible) _resetDebt(to);
    }
}
