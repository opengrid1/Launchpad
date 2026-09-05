// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPairConverter {
    /// @dev Convert `amount` of `pair` (pulled from the caller by allowance)
    ///      into native ETH along `route` and send it to `to`.
    function pairToEth(address pair, uint256 amount, address to, uint256 minOut, bytes calldata route) external returns (uint256 ethOut);
}

interface IFeeRecipientSource {
    function feeRecipient() external view returns (address);
}

/// @title StockPadToken
/// @notice The mainnet stockpad coin. Fixed 1B supply, no owner, no mint, no
///         pause, metadata on-chain. Every swap in the coin's Uniswap V4 pool
///         pays a fee in the PAIR asset (ETH or a tokenized stock); the pool
///         hook hands that fee to this contract and calls {accrue}, which
///         credits creator / holders / platform on the spot (MasterChef
///         accumulator). No harvest step. Rewards are paid in the pair asset;
///         the creator and holders may also take theirs as native ETH through
///         the launchpad router.
///
///         Anti-snipe: in the launch block only the creator may receive coins
///         from the pool; for the next PROTECT_BLOCKS every wallet is capped at
///         MAX_BUY_BPS bought and MAX_HOLD_BPS held. The hook adds a decaying
///         fee on top for the first seconds.
contract StockPadToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant ACC_PRECISION = 1e24;
    uint16 internal constant BPS = 10_000;

    /// @notice Wallet credited as the coin's creator (immutable attribution).
    address public immutable creator;
    /// @notice The coin's pair asset. Fees and rewards are paid in this.
    address public immutable pairAsset;
    /// @notice The V4 PoolManager: coins arriving from it are buys.
    address public immutable poolManager;
    /// @notice Fee split, bps of every fee: creator / holders; the rest is platform.
    uint16 public immutable creatorBps;
    uint16 public immutable holderBps;
    address private immutable _factory;

    /// @notice The pool hook that skims fees; set once by the factory.
    address public hook;
    /// @notice The router that converts pair fees to ETH on request; set once.
    address public converter;

    uint256 private accRewardPerShare;
    /// @notice Supply eligible for rewards (excludes pool/system holders).
    uint256 public eligibleSupply;
    mapping(address => uint256) private rewardDebt;
    /// @notice Settled-but-unclaimed holder rewards, in the pair asset.
    mapping(address => uint256) public claimable;
    /// @notice Addresses that do not earn rewards (pool, factory, hook...).
    mapping(address => bool) public excluded;

    /// @notice Lifetime pair-asset credited to holders / creator / platform.
    uint256 public totalHolderRewards;
    uint256 public totalCreatorFees;
    uint256 public totalPlatformFees;
    /// @notice Accrued and not yet claimed, in the pair asset.
    uint256 public creatorFees;
    uint256 public platformFees;

    // Anti-snipe launch protection.
    uint256 public constant PROTECT_BLOCKS = 3;
    uint16 public constant MAX_HOLD_BPS = 300; // 3% of supply
    uint16 public constant MAX_BUY_BPS = 300;
    uint256 public launchBlock;
    uint256 public launchTime;
    mapping(address => uint256) private _boughtInWindow;

    string private _metadataURI;

    event FeesAccrued(uint256 holderAmount, uint256 creatorAmount, uint256 platformAmount);
    event RewardsClaimed(address indexed holder, uint256 amount, bool asEth);
    event CreatorFeesClaimed(address indexed creator, uint256 amount, bool asEth);
    event PlatformFeesClaimed(address indexed recipient, uint256 amount);
    event ExcludedSet(address indexed account, bool excluded);
    event HookSet(address indexed hook, address indexed converter);

    error OnlyFactory();
    error OnlyHook();
    error OnlyCreator();
    error AlreadyInit();
    error LaunchGuard();
    error BuyCap();
    error HoldCap();
    error NoConverter();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 supply_,
        address creator_,
        address factory_,
        address pairAsset_,
        address poolManager_,
        uint16 creatorBps_,
        uint16 holderBps_
    ) ERC20(name_, symbol_) {
        creator = creator_;
        pairAsset = pairAsset_;
        poolManager = poolManager_;
        creatorBps = creatorBps_;
        holderBps = holderBps_;
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

    /// @notice Interface parity with the other launchpad coins: never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice The asset rewards are paid in.
    function rewardToken() external view returns (address) {
        return pairAsset;
    }

    /// @notice One-time wiring by the factory in the launch transaction.
    function initHook(address hook_, address converter_, address[] calldata excludedAddrs) external {
        if (msg.sender != _factory) revert OnlyFactory();
        if (hook != address(0)) revert AlreadyInit();
        hook = hook_;
        converter = converter_;
        emit HookSet(hook_, converter_);
        _setExcluded(hook_, true);
        if (converter_ != address(0)) _setExcluded(converter_, true);
        for (uint256 i; i < excludedAddrs.length; ++i) _setExcluded(excludedAddrs[i], true);
        launchBlock = block.number;
        launchTime = block.timestamp;
    }

    // ------------------------------------------------------------------
    // Fee accrual (hook-driven, automatic)
    // ------------------------------------------------------------------

    /// @notice Called by the pool hook after it moved `fee + extra` of the pair
    ///         asset into this contract. `fee` is split creator / holders /
    ///         platform; `extra` (the anti-snipe surcharge) is platform only.
    function accrue(uint256 fee, uint256 extra) external {
        if (msg.sender != hook) revert OnlyHook();
        if (fee == 0 && extra == 0) return;
        uint256 holderFee = (fee * holderBps) / BPS;
        uint256 creatorFee = (fee * creatorBps) / BPS;
        uint256 platformFee = fee - holderFee - creatorFee + extra;

        if (holderFee > 0) {
            uint256 supply = eligibleSupply;
            if (supply > 0) {
                accRewardPerShare += (holderFee * ACC_PRECISION) / supply;
                totalHolderRewards += holderFee;
            } else {
                creatorFee += holderFee;
                holderFee = 0;
            }
        }
        creatorFees += creatorFee;
        platformFees += platformFee;
        totalCreatorFees += creatorFee;
        totalPlatformFees += platformFee;
        emit FeesAccrued(holderFee, creatorFee, platformFee);
    }

    // ------------------------------------------------------------------
    // Views + claims
    // ------------------------------------------------------------------

    /// @notice Pending holder rewards for `holder`, in the pair asset.
    function pendingRewards(address holder) public view returns (uint256) {
        if (excluded[holder]) return claimable[holder];
        uint256 accrued = (balanceOf(holder) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[holder];
        return claimable[holder] + (accrued > debt ? accrued - debt : 0);
    }

    /// @notice Claim holder rewards in the pair asset.
    function claimRewards() external nonReentrant returns (uint256 amount) {
        return _claimTo(msg.sender, false, 0, "");
    }

    /// @notice Claim holder rewards as native ETH, swapped by the router along
    ///         `route` (empty when the pair is WETH).
    function claimRewardsAsEth(uint256 minEthOut, bytes calldata route) external nonReentrant returns (uint256 amount) {
        return _claimTo(msg.sender, true, minEthOut, route);
    }

    /// @notice Anyone may push a holder's rewards to them, in the pair asset.
    function claimFor(address holder) external nonReentrant returns (uint256 amount) {
        return _claimTo(holder, false, 0, "");
    }

    /// @notice Creator-only: claim accrued creator fees, in the pair or as ETH.
    function claimCreatorFees(bool asEth, uint256 minEthOut, bytes calldata route) external nonReentrant returns (uint256 amount) {
        if (msg.sender != creator) revert OnlyCreator();
        amount = creatorFees;
        if (amount == 0) return 0;
        creatorFees = 0;
        _payout(creator, amount, asEth, minEthOut, route);
        emit CreatorFeesClaimed(creator, amount, asEth);
    }

    /// @notice Push accrued platform fees to the factory's fee recipient. Anyone.
    function claimPlatformFees() external nonReentrant returns (uint256 amount) {
        address to = IFeeRecipientSource(_factory).feeRecipient();
        amount = platformFees;
        if (amount == 0) return 0;
        platformFees = 0;
        IERC20(pairAsset).safeTransfer(to, amount);
        emit PlatformFeesClaimed(to, amount);
    }

    /// @notice Burn coins held by the caller.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _claimTo(address holder, bool asEth, uint256 minEthOut, bytes memory route) private returns (uint256 amount) {
        _settle(holder);
        amount = claimable[holder];
        if (amount == 0) return 0;
        claimable[holder] = 0;
        _payout(holder, amount, asEth, minEthOut, route);
        emit RewardsClaimed(holder, amount, asEth);
    }

    function _payout(address to, uint256 amount, bool asEth, uint256 minEthOut, bytes memory route) private {
        if (!asEth) {
            IERC20(pairAsset).safeTransfer(to, amount);
            return;
        }
        address c = converter;
        if (c == address(0)) revert NoConverter();
        IERC20(pairAsset).forceApprove(c, amount);
        IPairConverter(c).pairToEth(pairAsset, amount, to, minEthOut, route);
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
        // Anti-snipe: throttle buys (coins leaving the PoolManager) during the
        // launch window. Sells and system transfers are unaffected.
        // Coins reach a buyer straight from the PoolManager, or through the
        // launchpad router (PoolManager -> router -> buyer); both count.
        if ((from == poolManager || (from == converter && from != address(0))) && !excluded[to] && value > 0) {
            uint256 lb = launchBlock;
            if (lb != 0 && block.number < lb + PROTECT_BLOCKS) {
                if (block.number == lb) {
                    if (to != creator) revert LaunchGuard();
                } else {
                    uint256 supply = totalSupply();
                    uint256 bought = _boughtInWindow[to] + value;
                    if (bought > (supply * MAX_BUY_BPS) / BPS) revert BuyCap();
                    if (balanceOf(to) + value > (supply * MAX_HOLD_BPS) / BPS) revert HoldCap();
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
