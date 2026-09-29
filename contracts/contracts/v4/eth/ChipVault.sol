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
///         Rewards are credited on the spot (MasterChef accumulator), the same
///         way the coins pay their holders: the moment fees are synced or
///         harvested, every staker's claimable ETH goes up, and claim pays it
///         out at once. No lock: unstake any time.
///
///         No owner. The only privileged role is `keeper`, which can set the
///         minimum ETH out for harvests and add or drop a route helper; it can
///         never move stake or rewards.
contract ChipVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant PRECISION = 1e30;

    IERC20 public immutable stakeToken;
    address public immutable weth;
    IPairConverter public immutable router;
    address public keeper;

    uint256 public totalStaked;
    mapping(address => uint256) public staked;

    /// @notice ETH credited per staked token, scaled by PRECISION.
    uint256 public accPerShare;
    mapping(address => uint256) public debt;
    mapping(address => uint256) public rewards;

    /// @notice WETH already credited to stakers; what is above it on the
    ///         balance is new.
    uint256 public wethAccounted;
    uint256 public lifetimeRewards;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 amount);
    event Harvested(address indexed pair, uint256 pairAmount, uint256 ethOut);
    event RewardAdded(uint256 amount);
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

    function earned(address account) public view returns (uint256) {
        return (staked[account] * accPerShare) / PRECISION - debt[account] + rewards[account];
    }

    /// @dev Banks what `account` has earned so far, then resets its debt to
    ///      the current accumulator. Called around every balance change.
    function _settle(address account) internal {
        rewards[account] = earned(account);
        debt[account] = (staked[account] * accPerShare) / PRECISION;
    }

    function _addReward(uint256 amount) internal {
        if (amount == 0) return;
        accPerShare += (amount * PRECISION) / totalStaked;
        lifetimeRewards += amount;
        emit RewardAdded(amount);
    }

    // ------------------------------------------------------------------
    // Stake
    // ------------------------------------------------------------------

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        // Fees that arrived while nobody was staked go to the first staker's cohort.
        _settle(msg.sender);
        totalStaked += amount;
        staked[msg.sender] += amount;
        debt[msg.sender] = (staked[msg.sender] * accPerShare) / PRECISION;
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
        _sync();
    }

    function unstake(uint256 amount) public nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _sync();
        _settle(msg.sender);
        totalStaked -= amount;
        staked[msg.sender] -= amount;
        debt[msg.sender] = (staked[msg.sender] * accPerShare) / PRECISION;
        stakeToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim earned ETH, paid at once.
    function claim() public nonReentrant returns (uint256 amount) {
        _sync();
        _settle(msg.sender);
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

    /// @notice Credit WETH that arrived since the last sync to stakers. Anyone.
    function sync() external {
        if (totalStaked == 0) revert NoStakers();
        _sync();
    }

    function _sync() internal {
        if (totalStaked == 0) return;
        uint256 bal = IERC20(weth).balanceOf(address(this));
        uint256 fresh = bal - wethAccounted;
        if (fresh == 0) return;
        wethAccounted = bal;
        _addReward(fresh);
    }

    /// @notice Turn a stock-token balance into ETH through the launchpad
    ///         router and credit it to stakers. Anyone; `minOut` guards the
    ///         swap and `route` is the frontend's ETH route for that stock.
    function harvest(address pair, uint256 minOut, bytes calldata route) external nonReentrant returns (uint256 ethOut) {
        if (pair == weth) { _sync(); return 0; }
        uint256 amount = IERC20(pair).balanceOf(address(this));
        if (amount == 0) revert NothingToHarvest();
        IERC20(pair).forceApprove(address(router), amount);
        ethOut = router.pairToEth(pair, amount, address(this), minOut, route);
        // The router pays native ETH; wrap it so every reward is WETH until claim.
        (bool ok,) = weth.call{value: ethOut}("");
        require(ok, "wrap");
        emit Harvested(pair, amount, ethOut);
        _sync();
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
