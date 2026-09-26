// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title LaunchpadRewardToken
/// @notice Fixed-supply launchpad token with an on-chain, gas-safe holder
///         dividend tracker. The factory routes a share of every harvested
///         pool fee here, denominated in the coin's own pair asset (wrapped
///         native or a tokenized stock), and holders accrue it in proportion
///         to their balance using a MasterChef-style accumulator (O(1) per
///         distribution). The AMM pool and system addresses are excluded so
///         rewards only flow to real holders. Claims are pull-based: holders
///         call {claim} themselves (or anyone can push via {claimFor}, funds
///         only ever go to the holder).
///
///         No taxes, no owner: `owner()` is always the zero address and the
///         token has no privileged controls beyond the factory's one-time
///         pool wiring and reward crediting.
contract LaunchpadRewardToken is ERC20 {
    using SafeERC20 for IERC20;

    uint256 private constant ACC_PRECISION = 1e24;

    /// @notice Wallet credited as the token's creator (immutable attribution).
    address public immutable creator;
    /// @notice The asset rewards are paid in: the coin's pool pair.
    address public immutable rewardToken;
    /// @dev The launchpad factory: mints recipient, reward crediter, pool wirer.
    address private immutable _factory;

    /// @dev Accumulated reward per eligible share, scaled by ACC_PRECISION.
    uint256 private accRewardPerShare;
    /// @notice Supply eligible for dividends (excludes pool/system holders).
    uint256 public eligibleSupply;
    /// @dev Reward already accounted to a holder: balance * acc / PRECISION.
    mapping(address => uint256) private rewardDebt;
    /// @dev Settled-but-unclaimed rewards per holder.
    mapping(address => uint256) public claimable;
    /// @notice Addresses that do not participate in dividends (pool, system).
    mapping(address => bool) public excluded;
    /// @notice Lifetime rewards distributed to holders, in reward units.
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

        // Exclude system endpoints up front so rewards only flow to holders.
        excluded[address(0)] = true;
        excluded[address(this)] = true;
        excluded[factory_] = true;

        _mint(factory_, supply_);
    }

    /// @notice Off-chain metadata JSON (description, logo, website, socials).
    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Interface parity with LaunchpadERC20: never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice One-time pool wiring by the factory: the AMM pool holds the
    ///         seeded supply and must not accrue holder rewards.
    function initPool(address pool_) external {
        if (msg.sender != _factory) revert OnlyFactory();
        if (_poolInited) revert PoolAlreadySet();
        _poolInited = true;
        _setExcluded(pool_, true);
    }

    /// @notice Credit a reward distribution to all eligible holders. The
    ///         factory transfers `amount` of `rewardToken` here first. No-op
    ///         when there is no eligible supply.
    function distributeRewards(uint256 amount) external {
        if (msg.sender != _factory) revert OnlyFactory();
        uint256 supply = eligibleSupply;
        if (amount == 0 || supply == 0) return;
        accRewardPerShare += (amount * ACC_PRECISION) / supply;
        totalRewardsDistributed += amount;
        emit RewardsDistributed(amount);
    }

    /// @notice Pending, not-yet-claimed rewards for a holder.
    function pendingRewards(address holder) public view returns (uint256) {
        if (excluded[holder]) return claimable[holder];
        uint256 accrued = (balanceOf(holder) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[holder];
        uint256 extra = accrued > debt ? accrued - debt : 0;
        return claimable[holder] + extra;
    }

    /// @notice Claim all accrued rewards to the caller.
    function claim() external returns (uint256 amount) {
        return _claimTo(msg.sender);
    }

    /// @notice Push a holder's accrued rewards to THEIR wallet. Callable by
    ///         anyone; funds can only ever go to the holder.
    function claimFor(address holder) external returns (uint256 amount) {
        return _claimTo(holder);
    }

    /// @notice Batch push for keepers.
    function claimForMany(address[] calldata holders) external {
        for (uint256 i; i < holders.length; ++i) {
            _claimTo(holders[i]);
        }
    }

    function _claimTo(address holder) private returns (uint256 amount) {
        _settle(holder);
        amount = claimable[holder];
        if (amount == 0) return 0;
        claimable[holder] = 0;
        emit RewardsClaimed(holder, amount);
        IERC20(rewardToken).safeTransfer(holder, amount);
    }

    /// @dev Move a holder's freshly-accrued rewards into `claimable` and reset
    ///      their debt to the current balance basis.
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

    /// @dev Core transfer/mint/burn accounting: settle both sides, move the
    ///      balance, keep `eligibleSupply` in sync, rebase reward debts.
    function _update(address from, address to, uint256 value) internal override {
        bool fromEligible = from != address(0) && !excluded[from];
        bool toEligible = to != address(0) && !excluded[to];

        if (fromEligible) _settle(from);
        if (toEligible) _settle(to);

        super._update(from, to, value);

        if (fromEligible && !toEligible) {
            eligibleSupply -= value;
        } else if (!fromEligible && toEligible) {
            eligibleSupply += value;
        }

        if (fromEligible) _resetDebt(from);
        if (toEligible) _resetDebt(to);
    }
}
