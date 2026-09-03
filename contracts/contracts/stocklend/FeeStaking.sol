// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FeeStaking
/// @notice Stake the project token, receive whatever fees are forwarded to this
///         contract, in kind. Four rules, nothing else:
///
///           1. `stake`            – lock tokens, start earning from the next forward.
///           2. `notifyReward`     – ANYONE, ANY time, ANY approved asset. The amount is
///                                   split pro-rata across everyone staked at that moment.
///           3. `claim`            – take what you have earned, in the asset it arrived in.
///           4. `requestUnstake` → wait `cooldown` → `unstake`.
///
///         What is deliberately NOT here:
///           - no admin withdraw of rewards. Once forwarded, rewards belong to stakers.
///           - no buyback, no burn, no swap. ETH arrives as ETH, USDG as USDG.
///           - no schedule. The creator forwards from their own wallet whenever they like.
///
///         Guards:
///           - a forward with zero stakers reverts, so fees can never get stuck here.
///           - reward assets are owner-approved, so the claim loop stays bounded.
///           - tokens in cooldown stop earning; the cooldown is what stops someone from
///             staking right before a forward and leaving right after.
contract FeeStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Native ETH is tracked under this key.
    address public constant ETH = address(0);
    uint256 private constant ACC = 1e18;
    uint256 public constant MAX_COOLDOWN = 30 days;

    IERC20 public immutable stakeToken;
    uint256 public cooldown = 7 days;

    uint256 public totalStaked; // active stake only (cooling-down tokens excluded)
    mapping(address => uint256) public staked; // active stake per account

    struct Pending {
        uint256 amount;
        uint64 readyAt;
    }
    mapping(address => Pending) public pendingUnstake;

    // reward asset => accumulated reward per staked token, scaled by ACC
    mapping(address => uint256) public accPerShare;
    // account => reward asset => (staked * accPerShare) already accounted for
    mapping(address => mapping(address => uint256)) private _debt;
    // account => reward asset => earned but not yet claimed
    mapping(address => mapping(address => uint256)) public owed;

    address[] public rewardAssets;
    mapping(address => bool) public isRewardAsset;

    event Staked(address indexed account, uint256 amount);
    event UnstakeRequested(address indexed account, uint256 amount, uint64 readyAt);
    event Unstaked(address indexed account, uint256 amount);
    event RewardNotified(address indexed from, address indexed asset, uint256 amount);
    event Claimed(address indexed account, address indexed asset, uint256 amount);
    event RewardAssetSet(address indexed asset, bool allowed);
    event CooldownSet(uint256 cooldown);

    error ZeroAmount();
    error NoStakers();
    error NotRewardAsset();
    error NothingPending();
    error StillCooling(uint64 readyAt);
    error EthTransferFailed();

    constructor(address owner_, IERC20 stakeToken_) Ownable(owner_) {
        stakeToken = stakeToken_;
    }

    // ───────────────────────────── admin ─────────────────────────────

    /// @notice Approve (or remove) an asset that may be forwarded as reward.
    ///         ETH is `address(0)`. Removing an asset only blocks new forwards;
    ///         already-earned balances stay claimable.
    function setRewardAsset(address asset, bool allowed) external onlyOwner {
        if (allowed && !isRewardAsset[asset]) rewardAssets.push(asset);
        isRewardAsset[asset] = allowed;
        emit RewardAssetSet(asset, allowed);
    }

    function setCooldown(uint256 cooldown_) external onlyOwner {
        require(cooldown_ <= MAX_COOLDOWN, "cooldown too long");
        cooldown = cooldown_;
        emit CooldownSet(cooldown_);
    }

    // ───────────────────────────── stake ─────────────────────────────

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _settle(msg.sender);
        uint256 before = stakeToken.balanceOf(address(this));
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = stakeToken.balanceOf(address(this)) - before;
        staked[msg.sender] += received;
        totalStaked += received;
        _resetDebt(msg.sender);
        emit Staked(msg.sender, received);
    }

    /// @notice Move `amount` out of the earning pool and start the cooldown.
    ///         Calling again adds to the pending amount and restarts the clock.
    function requestUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        require(staked[msg.sender] >= amount, "exceeds stake");
        _settle(msg.sender);
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        _resetDebt(msg.sender);
        Pending storage p = pendingUnstake[msg.sender];
        p.amount += amount;
        p.readyAt = uint64(block.timestamp + cooldown);
        emit UnstakeRequested(msg.sender, amount, p.readyAt);
    }

    function unstake() external nonReentrant {
        Pending memory p = pendingUnstake[msg.sender];
        if (p.amount == 0) revert NothingPending();
        if (block.timestamp < p.readyAt) revert StillCooling(p.readyAt);
        delete pendingUnstake[msg.sender];
        stakeToken.safeTransfer(msg.sender, p.amount);
        emit Unstaked(msg.sender, p.amount);
    }

    // ───────────────────────────── rewards in ─────────────────────────────

    /// @notice Forward an ERC-20 reward. Anyone can call. Splits across current stakers.
    function notifyReward(address asset, uint256 amount) external nonReentrant {
        if (asset == ETH) revert NotRewardAsset();
        if (!isRewardAsset[asset]) revert NotRewardAsset();
        if (amount == 0) revert ZeroAmount();
        if (totalStaked == 0) revert NoStakers();
        uint256 before = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(asset).balanceOf(address(this)) - before;
        _distribute(asset, received);
    }

    /// @notice Forward native ETH as reward. Anyone can call.
    function notifyRewardETH() external payable nonReentrant {
        if (!isRewardAsset[ETH]) revert NotRewardAsset();
        if (msg.value == 0) revert ZeroAmount();
        if (totalStaked == 0) revert NoStakers();
        _distribute(ETH, msg.value);
    }

    /// @dev Plain ETH transfers are refused so nothing can land here unaccounted.
    receive() external payable {
        revert("use notifyRewardETH");
    }

    function _distribute(address asset, uint256 amount) private {
        accPerShare[asset] += (amount * ACC) / totalStaked;
        emit RewardNotified(msg.sender, asset, amount);
    }

    // ───────────────────────────── rewards out ─────────────────────────────

    function claim(address asset) external nonReentrant {
        _settle(msg.sender);
        _resetDebt(msg.sender);
        _payout(msg.sender, asset);
    }

    function claimAll() external nonReentrant {
        _settle(msg.sender);
        _resetDebt(msg.sender);
        uint256 n = rewardAssets.length;
        for (uint256 i; i < n; ++i) _payout(msg.sender, rewardAssets[i]);
    }

    function _payout(address account, address asset) private {
        uint256 amount = owed[account][asset];
        if (amount == 0) return;
        owed[account][asset] = 0;
        if (asset == ETH) {
            (bool ok,) = account.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(asset).safeTransfer(account, amount);
        }
        emit Claimed(account, asset, amount);
    }

    // ───────────────────────────── accounting ─────────────────────────────

    /// @dev Bank everything earned so far into `owed`, across all reward assets.
    function _settle(address account) private {
        uint256 bal = staked[account];
        if (bal == 0) return;
        uint256 n = rewardAssets.length;
        for (uint256 i; i < n; ++i) {
            address asset = rewardAssets[i];
            uint256 accrued = (bal * accPerShare[asset]) / ACC;
            uint256 debt = _debt[account][asset];
            if (accrued > debt) owed[account][asset] += accrued - debt;
        }
    }

    /// @dev Re-anchor the account's debt to the current accumulator and stake.
    function _resetDebt(address account) private {
        uint256 bal = staked[account];
        uint256 n = rewardAssets.length;
        for (uint256 i; i < n; ++i) {
            address asset = rewardAssets[i];
            _debt[account][asset] = (bal * accPerShare[asset]) / ACC;
        }
    }

    // ───────────────────────────── views ─────────────────────────────

    /// @notice Claimable balance of `asset` for `account` right now.
    function claimable(address account, address asset) external view returns (uint256) {
        uint256 accrued = (staked[account] * accPerShare[asset]) / ACC;
        uint256 debt = _debt[account][asset];
        return owed[account][asset] + (accrued > debt ? accrued - debt : 0);
    }

    function rewardAssetCount() external view returns (uint256) {
        return rewardAssets.length;
    }
}
