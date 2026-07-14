// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FeeDistributor
/// @notice Receives trading fees (native currency) from the Launchpad and
///         splits them 80% to the token creator and 20% to the platform.
///         Creators withdraw with a single pull-payment call; the platform
///         share is withdrawable to the treasury by an admin.
contract FeeDistributor is AccessControl, ReentrancyGuard {
    error NotLaunchpad();
    error NothingToWithdraw();
    error TransferFailed();
    error ZeroAddress();

    event FeeAccrued(
        address indexed token,
        address indexed creator,
        uint256 creatorAmount,
        uint256 platformAmount
    );
    event CreatorWithdrawal(address indexed creator, uint256 amount);
    event PlatformWithdrawal(address indexed to, uint256 amount);

    /// @notice Creator share of every fee, in basis points (80%).
    uint16 public constant CREATOR_SHARE_BPS = 8000;
    uint16 public constant BPS = 10_000;

    address public launchpad;

    /// @notice Claimable balance per creator.
    mapping(address => uint256) public creatorPending;
    /// @notice Lifetime fees earned per creator (claimed + pending).
    mapping(address => uint256) public creatorLifetimeEarned;
    /// @notice Lifetime creator fees attributed to each token.
    mapping(address => uint256) public tokenCreatorFees;
    /// @notice Lifetime platform fees attributed to each token.
    mapping(address => uint256) public tokenPlatformFees;

    /// @notice Claimable platform balance.
    uint256 public platformPending;
    /// @notice Lifetime platform revenue (claimed + pending).
    uint256 public platformLifetimeEarned;

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice One-time wiring, done right after the launchpad is deployed.
    function setLaunchpad(address launchpad_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (launchpad_ == address(0)) revert ZeroAddress();
        launchpad = launchpad_;
    }

    /// @notice Called by the launchpad on every fee-bearing trade.
    function accrue(address token, address creator) external payable {
        if (msg.sender != launchpad) revert NotLaunchpad();
        uint256 creatorAmount = (msg.value * CREATOR_SHARE_BPS) / BPS;
        uint256 platformAmount = msg.value - creatorAmount;

        creatorPending[creator] += creatorAmount;
        creatorLifetimeEarned[creator] += creatorAmount;
        tokenCreatorFees[token] += creatorAmount;
        tokenPlatformFees[token] += platformAmount;
        platformPending += platformAmount;
        platformLifetimeEarned += platformAmount;

        emit FeeAccrued(token, creator, creatorAmount, platformAmount);
    }

    /// @notice One-click creator earnings withdrawal.
    function withdrawCreator() external nonReentrant {
        uint256 amount = creatorPending[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        creatorPending[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit CreatorWithdrawal(msg.sender, amount);
    }

    /// @notice Withdraw the platform share, normally to the treasury.
    function withdrawPlatform(address to) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = platformPending;
        if (amount == 0) revert NothingToWithdraw();
        platformPending = 0;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PlatformWithdrawal(to, amount);
    }
}
