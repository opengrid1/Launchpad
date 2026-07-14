// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Treasury
/// @notice Holds protocol assets: withdrawn liquidity, collected LP fees and
///         platform revenue. Withdrawals are restricted to treasury managers.
contract Treasury is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NothingToWithdraw();
    error TransferFailed();
    error ZeroAddress();

    event NativeReceived(address indexed from, uint256 amount);
    event NativeWithdrawn(address indexed to, uint256 amount);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);

    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TREASURER_ROLE, admin);
    }

    receive() external payable {
        emit NativeReceived(msg.sender, msg.value);
    }

    function withdrawNative(address to, uint256 amount) external nonReentrant onlyRole(TREASURER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > address(this).balance) revert NothingToWithdraw();
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit NativeWithdrawn(to, amount);
    }

    function withdrawToken(address token, address to, uint256 amount) external nonReentrant onlyRole(TREASURER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert NothingToWithdraw();
        IERC20(token).safeTransfer(to, amount);
        emit TokenWithdrawn(token, to, amount);
    }
}
