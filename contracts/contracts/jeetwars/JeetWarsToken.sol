// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IJeetWarsRouter {
    /// @dev Swap the BNB sent into `stock` along a PancakeSwap V3 `path`
    ///      (WBNB first, `stock` last), at least `minOut`, to `to`.
    function bnbToStock(address stock, bytes calldata path, uint256 minOut, address to) external payable returns (uint256 out);
}

interface IJeetWarsArena {
    function feeRecipient() external view returns (address);
}

interface IJeetWarsHookFlush {
    function flush(address coin) external returns (uint256);
}

/// @title JeetWarsToken
/// @notice A Jeet Wars coin. Fixed supply of 1,000,000,000, no owner, no mint,
///         no tax, no pause, no blacklist and no setter of any kind.
///
///         Fees. Every swap in the coin's PancakeSwap Infinity pool pays 2% of
///         its BNB side. The pool hook sends that BNB here and calls {sync},
///         which splits it by fixed bps: creator / holders / platform.
///
///         Holders earn per token held, paid in BNB or, at claim time, in the
///         coin's army stock (a Binance bStock) bought by the router with the
///         holder's own minimum. The creator's and platform's shares are pushed
///         to their fixed recipients by anyone.
///
///         Launch protection: in the launch block only the creator may receive
///         coins from the pool; for the next PROTECT_BLOCKS every wallet is
///         capped at MAX_BUY_BPS bought and MAX_HOLD_BPS held.
contract JeetWarsToken is ERC20, ReentrancyGuard {
    uint256 private constant ACC_PRECISION = 1e24;
    uint16 internal constant BPS = 10_000;

    address public immutable creator;
    /// @notice The army stock holders may take their rewards in.
    address public immutable stock;
    address public immutable arena;
    address public immutable hook;
    address public immutable router;
    /// @notice The Infinity Vault: coins leaving it are buys.
    address public immutable vault;
    uint16 public immutable creatorBps;
    uint16 public immutable holderBps;
    uint256 public immutable launchBlock;
    uint256 public immutable launchTime;

    uint256 public constant PROTECT_BLOCKS = 3;
    uint16 public constant MAX_HOLD_BPS = 300; // 3% of supply
    uint16 public constant MAX_BUY_BPS = 300;
    mapping(address => uint256) private _boughtInWindow;

    uint256 private accRewardPerShare;
    /// @notice Supply that earns rewards (excludes the pool and system contracts).
    uint256 public eligibleSupply;
    mapping(address => uint256) private rewardDebt;
    /// @notice Settled but unclaimed holder rewards, in BNB.
    mapping(address => uint256) public claimable;
    /// @notice Addresses that never earn (Vault, Arena, hook, router, redeemer, this).
    mapping(address => bool) public excluded;

    /// @notice BNB held here that is already owed to someone. Anything above it
    ///         is new and is credited by the next {sync}.
    uint256 public reserved;
    uint256 public totalHolderRewards;
    uint256 public totalCreatorFees;
    uint256 public totalPlatformFees;
    uint256 public creatorFees;
    uint256 public platformFees;

    string private _metadataURI;

    event FeesAccrued(uint256 holderAmount, uint256 creatorAmount, uint256 platformAmount);
    /// @dev payout: 0 BNB, 1 army stock.
    event RewardsClaimed(address indexed holder, uint256 amount, uint8 payout);
    event CreatorFeesPaid(address indexed creator, uint256 amount);
    event PlatformFeesPaid(address indexed recipient, uint256 amount);

    error LaunchGuard();
    error BuyCap();
    error HoldCap();
    error InvalidParams();
    error TransferFailed();

    struct Init {
        string name;
        string symbol;
        string metadataURI;
        uint256 supply;
        address creator;
        address stock;
        address arena;
        address hook;
        address router;
        address vault;
        address redeemer;
        uint16 creatorBps;
        uint16 holderBps;
    }

    constructor(Init memory p) ERC20(p.name, p.symbol) {
        if (uint256(p.creatorBps) + p.holderBps > BPS || p.arena == address(0) || p.hook == address(0)) revert InvalidParams();
        creator = p.creator;
        stock = p.stock;
        arena = p.arena;
        hook = p.hook;
        router = p.router;
        vault = p.vault;
        creatorBps = p.creatorBps;
        holderBps = p.holderBps;
        launchBlock = block.number;
        launchTime = block.timestamp;
        _metadataURI = p.metadataURI;

        excluded[address(0)] = true;
        excluded[address(this)] = true;
        excluded[p.arena] = true;
        excluded[p.vault] = true;
        excluded[p.hook] = true;
        excluded[p.router] = true;
        excluded[p.redeemer] = true;

        _mint(p.arena, p.supply);
    }

    /// @notice Fees arrive here as native BNB.
    receive() external payable {}

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    // ------------------------------------------------------------------
    // Fee accrual (permissionless, balance based)
    // ------------------------------------------------------------------

    /// @notice Credit all BNB that arrived since the last sync, split creator /
    ///         holders / platform. Anyone; the pool hook calls it after each fee.
    function sync() external nonReentrant returns (uint256) {
        return _sync();
    }

    // ------------------------------------------------------------------
    // Views + claims
    // ------------------------------------------------------------------

    /// @notice Pending holder rewards for `holder`, in BNB (as of the last sync).
    function pendingRewards(address holder) public view returns (uint256) {
        if (excluded[holder]) return claimable[holder];
        uint256 accrued = (balanceOf(holder) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[holder];
        return claimable[holder] + (accrued > debt ? accrued - debt : 0);
    }

    /// @notice BNB waiting to be credited by the next {sync}.
    function unsynced() external view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > reserved ? bal - reserved : 0;
    }

    /// @notice Claim your holder rewards in BNB.
    function claimRewards() external nonReentrant returns (uint256 amount) {
        amount = _take(msg.sender);
        if (amount == 0) return 0;
        _send(msg.sender, amount);
        emit RewardsClaimed(msg.sender, amount, 0);
    }

    /// @notice Claim your holder rewards in the army stock, bought along a
    ///         PancakeSwap V3 `path` (WBNB first, the stock last), at least `minOut`.
    function claimRewardsAsStock(bytes calldata path, uint256 minOut) external nonReentrant returns (uint256 amount) {
        amount = _take(msg.sender);
        if (amount == 0) return 0;
        IJeetWarsRouter(router).bnbToStock{value: amount}(stock, path, minOut, msg.sender);
        emit RewardsClaimed(msg.sender, amount, 1);
    }

    /// @notice Push a holder's rewards to them in BNB. Anyone.
    function claimFor(address holder) external nonReentrant returns (uint256 amount) {
        amount = _take(holder);
        if (amount == 0) return 0;
        _send(holder, amount);
        emit RewardsClaimed(holder, amount, 0);
    }

    /// @notice Push the creator's share to the creator. Anyone.
    function payCreator() external nonReentrant returns (uint256 amount) {
        _pull();
        amount = creatorFees;
        if (amount == 0) return 0;
        creatorFees = 0;
        reserved -= amount;
        _send(creator, amount);
        emit CreatorFeesPaid(creator, amount);
    }

    /// @notice Push the platform's share to the Arena's fee recipient. Anyone.
    function payPlatform() external nonReentrant returns (uint256 amount) {
        _pull();
        amount = platformFees;
        if (amount == 0) return 0;
        platformFees = 0;
        reserved -= amount;
        address to = IJeetWarsArena(arena).feeRecipient();
        _send(to, amount);
        emit PlatformFeesPaid(to, amount);
    }

    /// @notice Burn coins you hold.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Burn coins of `account` within your allowance (the Redeemer uses this).
    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _sync() private returns (uint256 amount) {
        uint256 bal = address(this).balance;
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

    /// @dev Pull in fees the hook still holds as Vault claims, then credit everything.
    function _pull() private {
        IJeetWarsHookFlush(hook).flush(address(this));
        _sync();
    }

    function _take(address holder) private returns (uint256 amount) {
        _pull();
        _settle(holder);
        amount = claimable[holder];
        if (amount == 0) return 0;
        claimable[holder] = 0;
        reserved -= amount;
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
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
        // Launch protection: throttle buys (coins leaving the Vault) during the
        // launch window. Sells and system transfers are unaffected.
        if (from == vault && !excluded[to] && value > 0 && block.number < launchBlock + PROTECT_BLOCKS) {
            if (block.number == launchBlock) {
                if (to != creator) revert LaunchGuard();
            } else {
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
