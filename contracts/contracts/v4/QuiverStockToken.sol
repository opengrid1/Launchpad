// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IStockRhHook {
    /// @dev Swap `coinAmount` of the caller (this coin) into its pool's pair
    ///      asset and send the proceeds to `to`. The token transfers the coin to
    ///      the hook first; the hook performs the V4 swap and returns the amount.
    function swapCoinToPair(uint256 coinAmount, address to) external returns (uint256 pairAmount);
}

/// @title QuiverStockToken
/// @notice The V4 stockpad coin: identical mechanics to the V3 SquidRewardToken,
///         on Uniswap V4. A 1% trade fee (skimmed by the pool hook in afterSwap)
///         accrues automatically per trade with NO harvest step — the hook hands
///         the coin fee to this contract and calls {accrue}, which records every
///         holder's share instantly (MasterChef accumulator). Rewards accrue in
///         COIN and are swapped into the pair asset (a tokenized stock or WETH)
///         at claim time, per holder, through the hook. Split: 50% holders /
///         40% creator / 10% platform. Sells are never fee'd. An anti-snipe
///         window throttles buys right after launch.
contract QuiverStockToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant ACC_PRECISION = 1e24;

    // Split of the collected fee: 50% holders / 40% creator / 10% platform.
    uint16 public constant HOLDER_FEE_BPS = 5_000;
    uint16 public constant CREATOR_FEE_BPS = 4_000;

    /// @notice Wallet credited as the token's creator (immutable attribution).
    address public immutable creator;
    /// @notice Trade tax in bps (the pool hook enforces it); exposed for parity.
    uint16 public immutable taxBps;
    /// @notice The coin's pair asset: rewards are paid in this (stock or WETH).
    address public immutable pairAsset;
    /// @notice The V4 PoolManager: on a buy it sends the coin to the buyer, so
    ///         `from == poolManager` identifies a buy for anti-snipe + the hook.
    address public immutable poolManager;
    address private immutable _factory;

    /// @notice The hook that skims fees and performs claim swaps; set once.
    address public hook;

    /// @dev Accumulated reward per eligible share (in coin), scaled by PRECISION.
    uint256 private accRewardPerShare;
    /// @notice Supply eligible for rewards (excludes pool/system holders).
    uint256 public eligibleSupply;
    mapping(address => uint256) private rewardDebt;
    /// @notice Settled-but-unclaimed rewards per holder, in COINS.
    mapping(address => uint256) public claimable;
    /// @notice Addresses that do not participate in rewards (pool, system).
    mapping(address => bool) public excluded;

    /// @notice Lifetime coins credited to holders (coin-denominated).
    uint256 public totalRewardsDistributed;
    /// @notice Creator / platform fees accrued and not yet claimed, in COINS.
    uint256 public creatorFees;
    uint256 public platformFees;

    // Anti-snipe launch protection (same as V3).
    uint256 public constant PROTECT_BLOCKS = 2;
    uint16 public constant MAX_HOLD_BPS = 500; // 5% of supply
    uint16 public constant MAX_BUY_BPS = 550;  // 5.5% of supply
    uint256 public launchBlock;
    mapping(address => uint256) private _boughtInWindow;

    string private _metadataURI;

    event RewardsAccrued(uint256 holderAmount, uint256 creatorAmount, uint256 platformAmount);
    event RewardsClaimed(address indexed holder, uint256 coinAmount, uint256 pairAmount);
    event CreatorFeesClaimed(address indexed creator, uint256 coinAmount, uint256 pairAmount);
    event PlatformFeesClaimed(address indexed recipient, uint256 coinAmount, uint256 pairAmount);
    event ExcludedSet(address indexed account, bool excluded);
    event HookSet(address indexed hook);

    error OnlyFactory();
    error OnlyHook();
    error OnlyCreator();
    error HookAlreadySet();
    error LaunchGuard();
    error BuyCap();
    error HoldCap();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 supply_,
        address creator_,
        address factory_,
        uint16 taxBps_,
        address pairAsset_,
        address poolManager_
    ) ERC20(name_, symbol_) {
        creator = creator_;
        taxBps = taxBps_;
        pairAsset = pairAsset_;
        poolManager = poolManager_;
        _factory = factory_;
        _metadataURI = metadataURI_;

        excluded[address(0)] = true;
        excluded[address(this)] = true;
        excluded[factory_] = true;
        excluded[poolManager_] = true;

        _mint(factory_, supply_);
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Interface parity with the other launchpad tokens: never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice The asset rewards are paid in: this coin's pair (stock or WETH).
    function rewardToken() external view returns (address) {
        return pairAsset;
    }

    /// @notice One-time wiring by the factory, in the same tx it opens the pool:
    ///         records the hook, excludes it, approves it to pull the coin for
    ///         claim swaps, and starts the anti-snipe window.
    function initHook(address hook_, address[] calldata excludedAddrs) external {
        if (msg.sender != _factory) revert OnlyFactory();
        if (hook != address(0)) revert HookAlreadySet();
        hook = hook_;
        emit HookSet(hook_);
        _setExcluded(hook_, true);
        for (uint256 i; i < excludedAddrs.length; ++i) _setExcluded(excludedAddrs[i], true);
        _approve(address(this), hook_, type(uint256).max);
        launchBlock = block.number;
    }

    // ------------------------------------------------------------------
    // Fee accrual (hook-driven, automatic — no harvest)
    // ------------------------------------------------------------------

    /// @notice The pool hook calls this after transferring `coinFee` of this coin
    ///         to the contract: the fee is split 50/40/10 and every holder's
    ///         share is recorded instantly. No swap here — coins are swapped into
    ///         the pair asset per holder at claim time.
    function accrue(uint256 coinFee) external {
        if (msg.sender != hook) revert OnlyHook();
        if (coinFee == 0) return;
        uint256 holderFee = (coinFee * HOLDER_FEE_BPS) / 10_000;
        uint256 creatorFee = (coinFee * CREATOR_FEE_BPS) / 10_000;
        uint256 platformFee = coinFee - holderFee - creatorFee;

        if (holderFee > 0) {
            uint256 supply = eligibleSupply;
            if (supply > 0) {
                accRewardPerShare += (holderFee * ACC_PRECISION) / supply;
                totalRewardsDistributed += holderFee;
            } else {
                creatorFee += holderFee;
                holderFee = 0;
            }
        }
        creatorFees += creatorFee;
        platformFees += platformFee;
        emit RewardsAccrued(holderFee, creatorFee, platformFee);
    }

    // ------------------------------------------------------------------
    // Views + claims
    // ------------------------------------------------------------------

    /// @notice Pending, not-yet-claimed holder rewards in COINS (the frontend
    ///         converts to the pair asset at the pool price for display).
    function pendingRewards(address holder) public view returns (uint256) {
        if (excluded[holder]) return claimable[holder];
        uint256 accrued = (balanceOf(holder) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[holder];
        return claimable[holder] + (accrued > debt ? accrued - debt : 0);
    }

    /// @notice Claim all accrued holder rewards to the caller, paid in the pair.
    function claimRewards() public returns (uint256 pairAmount) {
        return _claimTo(msg.sender);
    }

    function claim() external returns (uint256 pairAmount) {
        return claimRewards();
    }

    function claimFor(address holder) external returns (uint256 pairAmount) {
        return _claimTo(holder);
    }

    function claimForMany(address[] calldata holders) external {
        for (uint256 i; i < holders.length; ++i) _claimTo(holders[i]);
    }

    /// @notice Creator-only: claim accrued dev fees, paid in the pair asset.
    function claimCreatorFees() external nonReentrant returns (uint256 pairAmount) {
        if (msg.sender != creator) revert OnlyCreator();
        uint256 coinAmount = creatorFees;
        if (coinAmount == 0) return 0;
        creatorFees = 0;
        pairAmount = _swapToPair(coinAmount, creator);
        emit CreatorFeesClaimed(creator, coinAmount, pairAmount);
    }

    /// @notice Push accrued platform fees to the factory's fee recipient.
    function claimPlatformFees() external nonReentrant returns (uint256 pairAmount) {
        address to = IFeeRecipientSource(_factory).feeRecipient();
        uint256 coinAmount = platformFees;
        if (coinAmount == 0) return 0;
        platformFees = 0;
        pairAmount = _swapToPair(coinAmount, to);
        emit PlatformFeesClaimed(to, coinAmount, pairAmount);
    }

    /// @notice Burn tokens held by the caller.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _claimTo(address holder) private nonReentrant returns (uint256 pairAmount) {
        _settle(holder);
        uint256 coinAmount = claimable[holder];
        if (coinAmount == 0) return 0;
        claimable[holder] = 0;
        pairAmount = _swapToPair(coinAmount, holder);
        emit RewardsClaimed(holder, coinAmount, pairAmount);
    }

    /// @dev Swap `coinAmount` of this coin into the pair asset through the hook
    ///      (which owns the V4 swap path) and send it to `to`.
    function _swapToPair(uint256 coinAmount, address to) private returns (uint256) {
        // The hook is pre-approved to pull the coin; it swaps and pays `to`.
        return IStockRhHook(hook).swapCoinToPair(coinAmount, to);
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
        // Anti-snipe: throttle buys (coin sent from the PoolManager) during the
        // launch window. Sells and system transfers are unaffected. The fee
        // itself is skimmed by the pool hook, not here.
        if (from == poolManager && !excluded[to] && value > 0) {
            uint256 lb = launchBlock;
            if (lb != 0 && block.number < lb + PROTECT_BLOCKS) {
                if (block.number == lb) {
                    if (to != creator) revert LaunchGuard();
                } else {
                    uint256 supply = totalSupply();
                    uint256 bought = _boughtInWindow[to] + value;
                    if (bought > (supply * MAX_BUY_BPS) / 10_000) revert BuyCap();
                    if (balanceOf(to) + value > (supply * MAX_HOLD_BPS) / 10_000) revert HoldCap();
                    _boughtInWindow[to] = bought;
                }
            }
        }

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

interface IFeeRecipientSource {
    function feeRecipient() external view returns (address);
}
