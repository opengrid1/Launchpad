// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FeeDistributor
/// @notice Routes 100% of trading fees to the token creator, automatically.
///         Fees are pushed to the creator on every trade; if the push fails
///         (for example a contract wallet that rejects transfers), the amount
///         accrues and the creator can pull it at any time with withdraw().
contract FeeDistributor is AccessControl, ReentrancyGuard {
    error NotLaunchpad();
    error NothingToWithdraw();
    error TransferFailed();
    error ZeroAddress();

    event FeeAccrued(address indexed token, address indexed creator, uint256 amount, bool pushed);
    event CreatorWithdrawal(address indexed creator, uint256 amount);

    address public launchpad;

    /// @notice Claimable fallback balance per creator (failed pushes only).
    mapping(address => uint256) public creatorPending;
    /// @notice Lifetime fees earned per creator (pushed + pending).
    mapping(address => uint256) public creatorLifetimeEarned;
    /// @notice Lifetime fees attributed to each token.
    mapping(address => uint256) public tokenFees;

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice One-time wiring, done right after the launchpad is deployed.
    function setLaunchpad(address launchpad_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (launchpad_ == address(0)) revert ZeroAddress();
        launchpad = launchpad_;
    }

    /// @notice Called by the launchpad on every fee-bearing trade. The entire
    ///         fee belongs to the creator; a gas-capped push keeps a hostile
    ///         creator contract from ever blocking trading.
    function accrue(address token, address creator) external payable {
        if (msg.sender != launchpad) revert NotLaunchpad();

        creatorLifetimeEarned[creator] += msg.value;
        tokenFees[token] += msg.value;

        (bool pushed, ) = creator.call{value: msg.value, gas: 50_000}("");
        if (!pushed) {
            creatorPending[creator] += msg.value;
        }
        emit FeeAccrued(token, creator, msg.value, pushed);
    }

    /// @notice Pull any fees that could not be pushed automatically.
    function withdraw() external nonReentrant {
        uint256 amount = creatorPending[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        creatorPending[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit CreatorWithdrawal(msg.sender, amount);
    }
}
