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
    /// @dev Convert `amount` of `pair` (pulled from the caller) into equal
    ///      shares of `assets`, each bought along `routes[i]` with at least
    ///      `minOuts[i]` out, all sent to `to`.
    function pairToBasket(
        address pair,
        uint256 amount,
        address to,
        bytes calldata pairRoute,
        address[] calldata assets,
        bytes[] calldata routes,
        uint256[] calldata minOuts
    ) external returns (uint256[] memory outs);
}

interface IFeeRecipientSource {
    function feeRecipient() external view returns (address);
}

interface IAnypairHook {
    /// @dev Deliver fees the hook still holds for `token` as V4 claims.
    function flush(address token) external returns (uint256);
}

/// @title AnypairToken
/// @notice An Anypair coin. Fixed supply, no owner, no mint, no pause, no
///         blacklist, no setter of any kind, and no function that checks who
///         the caller is: every piece of state is fixed in the constructor or
///         moved by rules anyone can trigger.
///
///         Fees. Every swap in the coin's Uniswap V4 pool pays a fee in the
///         PAIR asset (WETH or any priced token). The pool hook sends that
///         fee here and calls {sync}. {sync} is permissionless: it credits
///         whatever pair asset arrived since the last sync, split creator /
///         holders / platform by fixed bps. Sending the pair asset here and
///         calling {sync} is simply a donation split the same way; {fund}
///         credits a donation to holders only.
///
///         Holders earn per token held (MasterChef accumulator), paid in the
///         pair asset, or as ETH through the launchpad router. The creator's
///         and platform's shares are pushed to their fixed recipients by
///         anyone.
///
///         Basket rewards: the creator may pick up to MAX_BASKET tokenized
///         assets at launch. The list is fixed forever. Holders can then take
///         their rewards as equal shares of those assets, bought at claim
///         time by the router with the holder's own minimum per asset, so no
///         one else can set the price they get. Claiming in the pair asset or
///         as ETH always stays available.
///
///         Launch protection: in the launch block only the creator may receive
///         coins from the pool; for PROTECT_SECONDS after launch every wallet is
///         capped at MAX_BUY_BPS bought and MAX_HOLD_BPS held. The window is
///         measured in seconds, not blocks, so it keeps its length when Base's
///         block time changes.
contract AnypairToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant ACC_PRECISION = 1e30;
    uint16 internal constant BPS = 10_000;

    /// @notice Wallet credited as the coin's creator; receives the creator share.
    address public immutable creator;
    /// @notice The coin's pair asset. Fees and rewards are paid in this.
    address public immutable pairAsset;
    /// @notice The V4 PoolManager: coins arriving from it are buys.
    address public immutable poolManager;
    /// @notice The launchpad factory: where the platform recipient is read.
    address public immutable factory;
    /// @notice The pool hook that takes the fee.
    address public immutable hook;
    /// @notice The launchpad router, for claims paid as ETH.
    address public immutable converter;
    /// @notice Fee split, bps of every fee: creator / holders; the rest is platform.
    uint16 public immutable creatorBps;
    uint16 public immutable holderBps;
    /// @notice Launch block and time (the coin is created in the launch transaction).
    uint256 public immutable launchBlock;
    uint256 public immutable launchTime;

    // Launch protection.
    uint256 public constant PROTECT_SECONDS = 6;
    uint16 public constant MAX_HOLD_BPS = 300; // 3% of supply
    uint16 public constant MAX_BUY_BPS = 300;
    mapping(address => uint256) private _boughtInWindow;

    // Holder rewards.
    uint256 private accRewardPerShare;
    /// @notice Supply that earns rewards (excludes the pool and system contracts).
    uint256 public eligibleSupply;
    mapping(address => uint256) private rewardDebt;
    /// @notice Settled but unclaimed holder rewards, in the pair asset.
    mapping(address => uint256) public claimable;
    /// @notice Addresses that never earn (pool, factory, hook, router, this). Fixed at deploy.
    mapping(address => bool) public excluded;

    /// @notice Pair asset held here that is already owed to someone. Anything
    ///         above it is new and is credited by the next {sync}.
    uint256 public reserved;
    /// @notice Lifetime pair asset credited to holders / creator / platform.
    uint256 public totalHolderRewards;
    uint256 public totalCreatorFees;
    uint256 public totalPlatformFees;
    /// @notice Credited and not yet paid out, in the pair asset.
    uint256 public creatorFees;
    uint256 public platformFees;

    string private _metadataURI;

    /// @notice Most assets a basket may hold.
    uint256 public constant MAX_BASKET = 4;
    /// @dev Basket assets, fixed in the constructor; empty when the coin has none.
    address[] private _basket;

    event FeesAccrued(uint256 holderAmount, uint256 creatorAmount, uint256 platformAmount);
    /// @dev payout: 0 pair asset, 1 ETH, 2 basket.
    event RewardsClaimed(address indexed holder, uint256 amount, uint8 payout);
    event CreatorFeesPaid(address indexed creator, uint256 amount);
    event PlatformFeesPaid(address indexed recipient, uint256 amount);
    event Funded(address indexed from, uint256 amount);

    error LaunchGuard();
    error BuyCap();
    error HoldCap();
    error NoConverter();
    error NoHolders();
    error InvalidParams();
    error NoBasket();

    struct Init {
        string name;
        string symbol;
        string metadataURI;
        uint256 supply;
        address creator;
        address factory;
        address pairAsset;
        address poolManager;
        address hook;
        address converter;
        uint16 creatorBps;
        uint16 holderBps;
        address[] basket;
    }

    constructor(Init memory p) ERC20(p.name, p.symbol) {
        if (uint256(p.creatorBps) + p.holderBps > BPS || p.pairAsset == address(0) || p.factory == address(0) || p.hook == address(0)) revert InvalidParams();
        creator = p.creator;
        pairAsset = p.pairAsset;
        poolManager = p.poolManager;
        factory = p.factory;
        hook = p.hook;
        converter = p.converter;
        creatorBps = p.creatorBps;
        holderBps = p.holderBps;
        launchBlock = block.number;
        launchTime = block.timestamp;
        _metadataURI = p.metadataURI;
        if (p.basket.length > MAX_BASKET) revert InvalidParams();
        for (uint256 i; i < p.basket.length; i++) {
            if (p.basket[i] == address(0)) revert InvalidParams();
            _basket.push(p.basket[i]);
        }

        excluded[address(0)] = true;
        excluded[address(this)] = true;
        excluded[p.factory] = true;
        excluded[p.poolManager] = true;
        excluded[p.hook] = true;
        if (p.converter != address(0)) excluded[p.converter] = true;

        _mint(p.factory, p.supply);
    }

    /// @notice On-chain metadata (JSON), fixed at launch.
    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice The asset rewards are paid in.
    function rewardToken() external view returns (address) {
        return pairAsset;
    }

    /// @notice The assets holders may take their rewards in, equal shares; empty for none.
    function basketAssets() external view returns (address[] memory) {
        return _basket;
    }

    // ------------------------------------------------------------------
    // Fee accrual (permissionless, balance based)
    // ------------------------------------------------------------------

    /// @notice Credit every pair asset that arrived since the last sync:
    ///         creator / holders / platform by the fixed split. Anyone; the
    ///         pool hook calls it after each fee.
    function sync() external nonReentrant returns (uint256 amount) {
        return _sync();
    }

    /// @notice Add rewards for holders only: `amount` of the pair asset is
    ///         pulled from the caller and credited to every eligible holder.
    ///         The platform distributor uses this to pay the main coin's
    ///         holders; anyone may reward a coin's holders the same way.
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) return;
        uint256 supply = eligibleSupply;
        if (supply == 0) revert NoHolders();
        _sync();
        IERC20(pairAsset).safeTransferFrom(msg.sender, address(this), amount);
        accRewardPerShare += (amount * ACC_PRECISION) / supply;
        totalHolderRewards += amount;
        reserved += amount;
        emit Funded(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Views + claims
    // ------------------------------------------------------------------

    /// @notice Pending holder rewards for `holder`, in the pair asset (as of the last sync).
    function pendingRewards(address holder) public view returns (uint256) {
        if (excluded[holder]) return claimable[holder];
        uint256 accrued = (balanceOf(holder) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[holder];
        return claimable[holder] + (accrued > debt ? accrued - debt : 0);
    }

    /// @notice Pair asset waiting to be credited by the next {sync}.
    function unsynced() external view returns (uint256) {
        uint256 bal = IERC20(pairAsset).balanceOf(address(this));
        return bal > reserved ? bal - reserved : 0;
    }

    /// @notice Claim your holder rewards in the pair asset.
    function claimRewards() external nonReentrant returns (uint256 amount) {
        return _claimTo(msg.sender, 0, 0, "");
    }

    /// @notice Claim your holder rewards as native ETH, swapped by the router
    ///         along `route` (empty when the pair is WETH).
    function claimRewardsAsEth(uint256 minEthOut, bytes calldata route) external nonReentrant returns (uint256 amount) {
        return _claimTo(msg.sender, 1, minEthOut, route);
    }

    /// @notice Claim your holder rewards as the coin's basket, equal
    ///         shares. `pairRoute` turns the pair into ETH (empty for WETH);
    ///         `routes[i]` buys `basketAssets()[i]` with at least `minOuts[i]`.
    function claimRewardsAsBasket(bytes calldata pairRoute, bytes[] calldata routes, uint256[] calldata minOuts)
        external
        nonReentrant
        returns (uint256 amount)
    {
        if (_basket.length == 0) revert NoBasket();
        amount = _take(msg.sender);
        if (amount == 0) return 0;
        IERC20(pairAsset).forceApprove(converter, amount);
        IPairConverter(converter).pairToBasket(pairAsset, amount, msg.sender, pairRoute, _basket, routes, minOuts);
        emit RewardsClaimed(msg.sender, amount, 2);
    }

    /// @notice Push a holder's rewards to them, in the pair asset. Anyone.
    function claimFor(address holder) external nonReentrant returns (uint256 amount) {
        return _claimTo(holder, 0, 0, "");
    }

    /// @notice Push the creator's accrued share to the creator, in the pair asset. Anyone.
    function payCreator() external nonReentrant returns (uint256 amount) {
        _pull();
        amount = creatorFees;
        if (amount == 0) return 0;
        creatorFees = 0;
        reserved -= amount;
        IERC20(pairAsset).safeTransfer(creator, amount);
        emit CreatorFeesPaid(creator, amount);
    }

    /// @notice Push the platform's accrued share to the factory's fee recipient. Anyone.
    function payPlatform() external nonReentrant returns (uint256 amount) {
        _pull();
        amount = platformFees;
        if (amount == 0) return 0;
        platformFees = 0;
        reserved -= amount;
        address to = IFeeRecipientSource(factory).feeRecipient();
        IERC20(pairAsset).safeTransfer(to, amount);
        emit PlatformFeesPaid(to, amount);
    }

    /// @notice Burn coins you hold.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _sync() private returns (uint256 amount) {
        uint256 bal = IERC20(pairAsset).balanceOf(address(this));
        uint256 res = reserved;
        if (bal <= res) return 0;
        amount = bal - res;
        reserved = bal;

        uint256 holderFee = (amount * holderBps) / BPS;
        uint256 creatorFee = (amount * creatorBps) / BPS;
        uint256 platformFee = amount - holderFee - creatorFee;
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

    /// @dev Pull in fees the hook still holds as V4 claims, then credit everything.
    function _pull() private {
        IAnypairHook(hook).flush(address(this));
        _sync();
    }

    /// @dev Settle `holder`, zero their claim and release it from `reserved`.
    function _take(address holder) private returns (uint256 amount) {
        _pull();
        _settle(holder);
        amount = claimable[holder];
        if (amount == 0) return 0;
        claimable[holder] = 0;
        reserved -= amount;
    }

    function _claimTo(address holder, uint8 payout, uint256 minEthOut, bytes memory route) private returns (uint256 amount) {
        amount = _take(holder);
        if (amount == 0) return 0;
        if (payout == 0) {
            IERC20(pairAsset).safeTransfer(holder, amount);
        } else {
            address c = converter;
            if (c == address(0)) revert NoConverter();
            IERC20(pairAsset).forceApprove(c, amount);
            IPairConverter(c).pairToEth(pairAsset, amount, holder, minEthOut, route);
        }
        emit RewardsClaimed(holder, amount, payout);
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

    function _update(address from, address to, uint256 value) internal override {
        // Launch protection: throttle buys (coins leaving the PoolManager, or the
        // router passing them on) during the launch window. Sells and system
        // transfers are unaffected.
        if ((from == poolManager || (from == converter && from != address(0))) && !excluded[to] && value > 0) {
            if (block.number == launchBlock) {
                if (to != creator) revert LaunchGuard();
            } else if (block.timestamp < launchTime + PROTECT_SECONDS) {
                uint256 supply = totalSupply();
                uint256 bought = _boughtInWindow[to] + value;
                if (bought > (supply * MAX_BUY_BPS) / BPS) revert BuyCap();
                if (balanceOf(to) + value > (supply * MAX_HOLD_BPS) / BPS) revert HoldCap();
                _boughtInWindow[to] = bought;
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
