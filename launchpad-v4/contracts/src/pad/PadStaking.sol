// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PadStaking
 * @notice Stake the platform token, earn native HYPE. Rewards arrive from the splitter (or the owner) through
 * `notifyRewardAmount` and stream linearly over `duration`; a top-up folds what is left of the current stream into
 * a new one. The accounting is the classic reward-per-token model, so a stake of any size earns its exact share of
 * every second it is staked. Stakers can withdraw at any time; nothing here can take a staker's deposit. The owner
 * can pause new stakes, rotate the distributor and recover any asset other than the staking token.
 */
contract PadStaking is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error NotDistributor();
    error Paused();
    error PeriodNotFinished();
    error RewardTooHigh();
    error CannotRecoverStakingToken();
    error TransferFailed();
    error OwnershipCannotBeRenounced();

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward, uint256 periodFinish);
    event DistributorSet(address distributor);
    event DurationSet(uint256 duration);
    event PausedSet(bool paused);
    event Recovered(address asset, address to, uint256 amount);

    IERC20 public immutable stakingToken;
    address public distributor;
    uint256 public duration;
    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    bool public paused;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    constructor(address initialOwner, IERC20 stakingToken_, address distributor_, uint256 duration_) Ownable(initialOwner) {
        if (address(stakingToken_) == address(0)) revert ZeroAddress();
        if (duration_ == 0) revert ZeroAmount();
        stakingToken = stakingToken_;
        distributor = distributor_;
        duration = duration_;
    }

    receive() external payable {}

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ---- views ------------------------------------------------------------------------------------------------

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalSupply;
    }

    function earned(address account) public view returns (uint256) {
        return (balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18 + rewards[account];
    }

    /// @notice HYPE still to be streamed in the current period.
    function rewardForDuration() external view returns (uint256) {
        return rewardRate * duration;
    }

    // ---- stakers ----------------------------------------------------------------------------------------------

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (paused) revert Paused();
        if (amount == 0) revert ZeroAmount();
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward == 0) return;
        rewards[msg.sender] = 0;
        (bool sent,) = payable(msg.sender).call{value: reward}("");
        if (!sent) revert TransferFailed();
        emit RewardPaid(msg.sender, reward);
    }

    function exit() external {
        withdraw(balanceOf[msg.sender]);
        getReward();
    }

    // ---- rewards ----------------------------------------------------------------------------------------------

    /// @notice Starts or tops up the stream with `msg.value`. Distributor or owner.
    function notifyRewardAmount() external payable nonReentrant updateReward(address(0)) {
        if (msg.sender != distributor && msg.sender != owner()) revert NotDistributor();
        if (msg.value == 0) revert ZeroAmount();
        if (block.timestamp >= periodFinish) {
            rewardRate = msg.value / duration;
        } else {
            uint256 leftover = (periodFinish - block.timestamp) * rewardRate;
            rewardRate = (msg.value + leftover) / duration;
        }
        // the whole stream must be covered by what the contract holds beyond nothing else is owed from this balance
        if (rewardRate > address(this).balance / duration) revert RewardTooHigh();
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        emit RewardAdded(msg.value, periodFinish);
    }

    // ---- owner ------------------------------------------------------------------------------------------------

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    function setDistributor(address distributor_) external onlyOwner {
        distributor = distributor_;
        emit DistributorSet(distributor_);
    }

    /// @notice Changes the stream length for the next period; the running period is never cut short.
    function setDuration(uint256 duration_) external onlyOwner {
        if (duration_ == 0) revert ZeroAmount();
        if (block.timestamp < periodFinish) revert PeriodNotFinished();
        duration = duration_;
        emit DurationSet(duration_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice Sends `amount` of `asset` (address(0) = native HYPE, the reward asset) to `to`. The staking token
    ///         is never recoverable: deposits belong to the stakers.
    function recover(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (asset == address(stakingToken)) revert CannotRecoverStakingToken();
        if (asset == address(0)) {
            (bool sent,) = payable(to).call{value: amount}("");
            if (!sent) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
        emit Recovered(asset, to, amount);
    }
}
