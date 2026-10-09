// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWETHMin {
    function withdraw(uint256) external;
}

/// @title InkyStaking
/// @notice Stake $INKY, earn the AMM's protocol fees in WETH. Rewards are
///         distributed by a per-share accumulator the moment they arrive
///         (`notifyReward`), so what you earn is exactly your share of the
///         stake at each distribution. No lockup, no admin, no owner.
contract InkyStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant ACC = 1e24;

    IERC20 public immutable inky;
    IERC20 public immutable weth;

    uint256 public totalStaked;
    uint256 public accRewardPerShare; // scaled by ACC
    uint256 public totalDistributed;
    uint256 public undistributed; // rewards that arrived while nobody was staked

    mapping(address => uint256) public staked;
    mapping(address => uint256) private rewardDebt;
    mapping(address => uint256) public owed; // rewards checkpointed but not yet claimed
    mapping(address => uint256) public lifetimeEarned;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 amount, bool asEth);
    event RewardAdded(address indexed from, uint256 amount);

    error ZeroAmount();
    error InsufficientStake();
    error EthTransferFailed();

    constructor(address _inky, address _weth) {
        inky = IERC20(_inky);
        weth = IERC20(_weth);
    }

    receive() external payable {
        assert(msg.sender == address(weth));
    }

    /// @notice Rewards claimable by `user` right now.
    function pending(address user) public view returns (uint256) {
        return owed[user] + (staked[user] * accRewardPerShare / ACC - rewardDebt[user]);
    }

    function _checkpoint(address user) private {
        uint256 s = staked[user];
        if (s > 0) owed[user] += s * accRewardPerShare / ACC - rewardDebt[user];
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _checkpoint(msg.sender);
        inky.safeTransferFrom(msg.sender, address(this), amount);
        staked[msg.sender] += amount;
        totalStaked += amount;
        rewardDebt[msg.sender] = staked[msg.sender] * accRewardPerShare / ACC;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (staked[msg.sender] < amount) revert InsufficientStake();
        _checkpoint(msg.sender);
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        rewardDebt[msg.sender] = staked[msg.sender] * accRewardPerShare / ACC;
        inky.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim rewards in WETH.
    function claim() external nonReentrant returns (uint256 amount) {
        amount = _claim();
        if (amount > 0) weth.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount, false);
    }

    /// @notice Claim rewards as native ETH.
    function claimAsEth() external nonReentrant returns (uint256 amount) {
        amount = _claim();
        if (amount > 0) {
            IWETHMin(address(weth)).withdraw(amount);
            (bool ok,) = msg.sender.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        }
        emit Claimed(msg.sender, amount, true);
    }

    function _claim() private returns (uint256 amount) {
        _checkpoint(msg.sender);
        rewardDebt[msg.sender] = staked[msg.sender] * accRewardPerShare / ACC;
        amount = owed[msg.sender];
        owed[msg.sender] = 0;
        lifetimeEarned[msg.sender] += amount;
    }

    /// @notice Pull `amount` WETH from the caller and split it across current stakers. Anyone may fund it.
    function notifyReward(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        weth.safeTransferFrom(msg.sender, address(this), amount);
        _distribute(amount);
        emit RewardAdded(msg.sender, amount);
    }

    function _distribute(uint256 amount) private {
        if (totalStaked == 0) {
            undistributed += amount; // held until the first staker arrives
            return;
        }
        amount += undistributed;
        undistributed = 0;
        accRewardPerShare += amount * ACC / totalStaked;
        totalDistributed += amount;
    }
}
