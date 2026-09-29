// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWrappedNative {
    function withdraw(uint256) external;
}

/// @dev The launchpad router turns a pair asset into native ETH along a route.
interface IPairConverter {
    function pairToEth(address pair, uint256 amount, address to, uint256 minOut, bytes calldata route) external returns (uint256 ethOut);
}

/// @title ChipVault
/// @notice Stake the platform's main coin, earn the platform's share of every
///         trade fee on the launchpad, paid in ETH.
///
///         The factory's `feeRecipient` points here, so each coin's platform
///         share lands in this contract as its pair asset: WETH from ETH-pair
///         coins, a tokenized stock from stock-pair coins. Anyone may call
///         {harvest} to turn a stock balance into ETH through the launchpad
///         router, and {sync} to pick up WETH that arrived directly. Both
///         feed the same reward stream.
///
///         Rewards drip over REWARD_PERIOD (Synthetix style) so a wallet
///         cannot stake in front of a harvest and leave with it. There is no
///         lock: unstake any time; rewards earned so far stay claimable.
///
///         No owner. The only privileged role is `keeper`, which can set the
///         minimum ETH out for harvests and add or drop a route helper; it can
///         never move stake or rewards.
contract ChipVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant REWARD_PERIOD = 7 days;
    uint256 private constant PRECISION = 1e18;

    IERC20 public immutable stakeToken;
    address public immutable weth;
    IPairConverter public immutable router;
    address public keeper;

    uint256 public totalStaked;
    mapping(address => uint256) public staked;

    uint256 public rewardRate;          // wei per second
    uint256 public periodFinish;
    uint256 public lastUpdate;
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    /// @notice WETH already handed to the reward stream; what is above it on
    ///         the balance is new.
    uint256 public wethAccounted;
    uint256 public lifetimeRewards;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 amount);
    event Harvested(address indexed pair, uint256 pairAmount, uint256 ethOut);
    event RewardAdded(uint256 amount, uint256 newRate, uint256 periodFinish);
    event KeeperSet(address keeper);

    error ZeroAmount();
    error NotKeeper();
    error NothingToHarvest();
    error NoStakers();

    constructor(IERC20 stakeToken_, address weth_, IPairConverter router_, address keeper_) {
        stakeToken = stakeToken_;
        weth = weth_;
        router = router_;
        keeper = keeper_;
    }

    receive() external payable {}

    // ------------------------------------------------------------------
    // Rewards math
    // ------------------------------------------------------------------

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((lastTimeRewardApplicable() - lastUpdate) * rewardRate * PRECISION) / totalStaked;
    }

    function earned(address account) public view returns (uint256) {
        return (staked[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / PRECISION + rewards[account];
    }

    function _update(address account) internal {
        rewardPerTokenStored = rewardPerToken();
        lastUpdate = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
    }

    function _addReward(uint256 amount) internal {
        if (amount == 0) return;
        _update(address(0));
        if (block.timestamp >= periodFinish) {
            rewardRate = amount / REWARD_PERIOD;
        } else {
            uint256 leftover = (periodFinish - block.timestamp) * rewardRate;
            rewardRate = (amount + leftover) / REWARD_PERIOD;
        }
        lastUpdate = block.timestamp;
        periodFinish = block.timestamp + REWARD_PERIOD;
        lifetimeRewards += amount;
        emit RewardAdded(amount, rewardRate, periodFinish);
    }

    // ------------------------------------------------------------------
    // Stake
    // ------------------------------------------------------------------

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _update(msg.sender);
        totalStaked += amount;
        staked[msg.sender] += amount;
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) public nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _update(msg.sender);
        totalStaked -= amount;
        staked[msg.sender] -= amount;
        stakeToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim earned ETH.
    function claim() public nonReentrant returns (uint256 amount) {
        _update(msg.sender);
        amount = rewards[msg.sender];
        if (amount == 0) return 0;
        rewards[msg.sender] = 0;
        wethAccounted -= amount;
        IWrappedNative(weth).withdraw(amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "eth send");
        emit Claimed(msg.sender, amount);
    }

    function exit() external {
        unstake(staked[msg.sender]);
        claim();
    }

    // ------------------------------------------------------------------
    // Feeding the stream
    // ------------------------------------------------------------------

    /// @notice Hand WETH that arrived since the last sync to the stream. Anyone.
    function sync() public {
        uint256 bal = IERC20(weth).balanceOf(address(this));
        uint256 fresh = bal - wethAccounted;
        if (fresh == 0) return;
        if (totalStaked == 0) revert NoStakers();
        wethAccounted = bal;
        _addReward(fresh);
    }

    /// @notice Turn a stock-token balance into ETH through the launchpad
    ///         router and feed it to the stream. Anyone; `minOut` guards the
    ///         swap and `route` is the frontend's ETH route for that stock.
    function harvest(address pair, uint256 minOut, bytes calldata route) external nonReentrant returns (uint256 ethOut) {
        if (pair == weth) { sync(); return 0; }
        uint256 amount = IERC20(pair).balanceOf(address(this));
        if (amount == 0) revert NothingToHarvest();
        IERC20(pair).forceApprove(address(router), amount);
        ethOut = router.pairToEth(pair, amount, address(this), minOut, route);
        // The router pays native ETH; wrap it so every reward is WETH until claim.
        (bool ok,) = weth.call{value: ethOut}("");
        require(ok, "wrap");
        emit Harvested(pair, amount, ethOut);
        sync();
    }

    function setKeeper(address keeper_) external {
        if (msg.sender != keeper) revert NotKeeper();
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @notice What the vault holds that has not reached stakers yet.
    function pending(address pair) external view returns (uint256) {
        if (pair == weth) return IERC20(weth).balanceOf(address(this)) - wethAccounted;
        return IERC20(pair).balanceOf(address(this));
    }
}
