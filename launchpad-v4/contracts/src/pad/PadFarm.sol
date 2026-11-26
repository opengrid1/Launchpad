// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PadFarm
 * @notice Liquidity mining for the AMM: stake a pool's LP shares, earn the native coin. The splitter (or the owner)
 * tops the farm up through `notifyRewardAmount`; the stream runs over `duration` and is shared between the farm's
 * pools by their allocation points, and inside a pool per staked share per second. Stakers can withdraw at any
 * time; `emergencyWithdraw` returns a stake without touching the reward math. The owner adds pools, sets their
 * points, rotates the distributor and recovers any asset other than a staked LP token.
 */
contract PadFarm is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error NotDistributor();
    error PoolExists();
    error BadPool();
    error TransferFailed();
    error CannotRecoverStakedToken();
    error PeriodNotFinished();
    error OwnershipCannotBeRenounced();

    event PoolAdded(uint256 indexed pid, address lpToken, uint256 allocPoint);
    event PoolSet(uint256 indexed pid, uint256 allocPoint);
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Harvest(address indexed user, uint256 indexed pid, uint256 reward);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event RewardAdded(uint256 reward, uint256 periodFinish);
    event DistributorSet(address distributor);
    event DurationSet(uint256 duration);
    event Recovered(address asset, address to, uint256 amount);

    struct Pool {
        IERC20 lpToken;
        uint256 allocPoint;
        uint256 lastRewardTime;
        uint256 accRewardPerShare; // scaled by 1e18
        uint256 totalStaked;
    }

    struct User {
        uint256 amount;
        uint256 rewardDebt;
    }

    Pool[] public pools;
    mapping(uint256 => mapping(address => User)) public users;
    mapping(address => bool) public isStaked; // LP tokens that have a pool
    uint256 public totalAllocPoint;
    address public distributor;
    uint256 public duration;
    uint256 public periodFinish;
    uint256 public rewardRate; // native per second across all pools

    constructor(address initialOwner, address distributor_, uint256 duration_) Ownable(initialOwner) {
        if (duration_ == 0) revert ZeroAmount();
        distributor = distributor_;
        duration = duration_;
    }

    receive() external payable {}

    function poolLength() external view returns (uint256) {
        return pools.length;
    }

    // ---- views ------------------------------------------------------------------------------------------------------

    function _applicable(uint256 t) private view returns (uint256) {
        return t < periodFinish ? t : periodFinish;
    }

    /// @notice Rewards accrued to a pool since its last update, at the current rate and allocation.
    function _pending(Pool storage p) private view returns (uint256) {
        if (totalAllocPoint == 0 || p.totalStaked == 0) return 0;
        uint256 from = p.lastRewardTime;
        uint256 to = _applicable(block.timestamp);
        if (to <= from) return 0;
        return ((to - from) * rewardRate * p.allocPoint) / totalAllocPoint;
    }

    function pendingReward(uint256 pid, address account) external view returns (uint256) {
        Pool storage p = pools[pid];
        User storage u = users[pid][account];
        uint256 acc = p.accRewardPerShare;
        if (p.totalStaked != 0) acc += (_pending(p) * 1e18) / p.totalStaked;
        return (u.amount * acc) / 1e18 - u.rewardDebt;
    }

    /// @notice Native per second a pool earns right now.
    function poolRewardRate(uint256 pid) external view returns (uint256) {
        if (totalAllocPoint == 0 || block.timestamp >= periodFinish) return 0;
        return (rewardRate * pools[pid].allocPoint) / totalAllocPoint;
    }

    // ---- staking ----------------------------------------------------------------------------------------------------

    function updatePool(uint256 pid) public {
        Pool storage p = pools[pid];
        uint256 reward = _pending(p);
        if (reward != 0) p.accRewardPerShare += (reward * 1e18) / p.totalStaked;
        p.lastRewardTime = _applicable(block.timestamp) > p.lastRewardTime ? _applicable(block.timestamp) : p.lastRewardTime;
        if (block.timestamp > periodFinish) p.lastRewardTime = block.timestamp;
    }

    function massUpdatePools() public {
        for (uint256 i; i < pools.length; i++) updatePool(i);
    }

    function deposit(uint256 pid, uint256 amount) external nonReentrant {
        Pool storage p = pools[pid];
        User storage u = users[pid][msg.sender];
        updatePool(pid);
        _harvest(pid, p, u);
        if (amount != 0) {
            uint256 before = p.lpToken.balanceOf(address(this));
            p.lpToken.safeTransferFrom(msg.sender, address(this), amount);
            amount = p.lpToken.balanceOf(address(this)) - before;
            u.amount += amount;
            p.totalStaked += amount;
        }
        u.rewardDebt = (u.amount * p.accRewardPerShare) / 1e18;
        emit Deposit(msg.sender, pid, amount);
    }

    function withdraw(uint256 pid, uint256 amount) external nonReentrant {
        Pool storage p = pools[pid];
        User storage u = users[pid][msg.sender];
        if (amount > u.amount) revert ZeroAmount();
        updatePool(pid);
        _harvest(pid, p, u);
        if (amount != 0) {
            u.amount -= amount;
            p.totalStaked -= amount;
            p.lpToken.safeTransfer(msg.sender, amount);
        }
        u.rewardDebt = (u.amount * p.accRewardPerShare) / 1e18;
        emit Withdraw(msg.sender, pid, amount);
    }

    /// @notice Pays what the caller has earned in `pid`.
    function harvest(uint256 pid) external nonReentrant {
        Pool storage p = pools[pid];
        User storage u = users[pid][msg.sender];
        updatePool(pid);
        _harvest(pid, p, u);
        u.rewardDebt = (u.amount * p.accRewardPerShare) / 1e18;
    }

    function _harvest(uint256 pid, Pool storage p, User storage u) private {
        uint256 owed = (u.amount * p.accRewardPerShare) / 1e18 - u.rewardDebt;
        if (owed == 0) return;
        uint256 bal = address(this).balance;
        if (owed > bal) owed = bal; // rounding dust at the very end of a stream
        (bool ok,) = payable(msg.sender).call{value: owed}("");
        if (!ok) revert TransferFailed();
        emit Harvest(msg.sender, pid, owed);
    }

    /// @notice Takes a stake back without its rewards. For when the reward payout itself fails.
    function emergencyWithdraw(uint256 pid) external nonReentrant {
        Pool storage p = pools[pid];
        User storage u = users[pid][msg.sender];
        uint256 amount = u.amount;
        if (amount == 0) revert ZeroAmount();
        u.amount = 0;
        u.rewardDebt = 0;
        p.totalStaked -= amount;
        p.lpToken.safeTransfer(msg.sender, amount);
        emit EmergencyWithdraw(msg.sender, pid, amount);
    }

    // ---- rewards ----------------------------------------------------------------------------------------------------

    /// @notice Starts or tops up the stream with `msg.value`. Distributor or owner.
    function notifyRewardAmount() external payable nonReentrant {
        if (msg.sender != distributor && msg.sender != owner()) revert NotDistributor();
        if (msg.value == 0) revert ZeroAmount();
        massUpdatePools();
        if (block.timestamp >= periodFinish) {
            rewardRate = msg.value / duration;
        } else {
            uint256 leftover = (periodFinish - block.timestamp) * rewardRate;
            rewardRate = (msg.value + leftover) / duration;
        }
        periodFinish = block.timestamp + duration;
        for (uint256 i; i < pools.length; i++) pools[i].lastRewardTime = block.timestamp;
        emit RewardAdded(msg.value, periodFinish);
    }

    // ---- owner ------------------------------------------------------------------------------------------------------

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    function addPool(IERC20 lpToken, uint256 allocPoint) external onlyOwner {
        if (address(lpToken) == address(0)) revert ZeroAddress();
        if (isStaked[address(lpToken)]) revert PoolExists();
        massUpdatePools();
        isStaked[address(lpToken)] = true;
        totalAllocPoint += allocPoint;
        pools.push(Pool({lpToken: lpToken, allocPoint: allocPoint, lastRewardTime: block.timestamp, accRewardPerShare: 0, totalStaked: 0}));
        emit PoolAdded(pools.length - 1, address(lpToken), allocPoint);
    }

    function setPool(uint256 pid, uint256 allocPoint) external onlyOwner {
        if (pid >= pools.length) revert BadPool();
        massUpdatePools();
        totalAllocPoint = totalAllocPoint - pools[pid].allocPoint + allocPoint;
        pools[pid].allocPoint = allocPoint;
        emit PoolSet(pid, allocPoint);
    }

    function setDistributor(address distributor_) external onlyOwner {
        distributor = distributor_;
        emit DistributorSet(distributor_);
    }

    function setDuration(uint256 duration_) external onlyOwner {
        if (duration_ == 0) revert ZeroAmount();
        if (block.timestamp < periodFinish) revert PeriodNotFinished();
        duration = duration_;
        emit DurationSet(duration_);
    }

    /// @notice Sends `amount` of `asset` (address zero = the native reward coin) to `to`. Staked LP tokens never.
    function recover(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (isStaked[asset]) revert CannotRecoverStakedToken();
        if (asset == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
        emit Recovered(asset, to, amount);
    }
}
