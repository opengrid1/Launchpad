// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EstonksFactory} from "./EstonksFactory.sol";

/// @title EstonksCreatorForwarder
/// @notice Launches an Estonks coin with this contract as its creator and
///         forwards everything a creator receives to a fixed wallet: the
///         creator's fee share (paid in the pair asset), any ETH, and the
///         first-buy coins. Lets an operator key launch a coin whose creator
///         share still goes to the team wallet forever.
contract EstonksCreatorForwarder {
    using SafeERC20 for IERC20;

    EstonksFactory public immutable factory;
    /// @notice Where everything goes.
    address public immutable to;
    /// @notice The only address that may launch through this forwarder.
    address public immutable operator;

    event Forwarded(address indexed token, uint256 amount);

    error NotOperator();
    error TransferFailed();

    constructor(EstonksFactory factory_, address to_) {
        factory = factory_;
        to = to_;
        operator = msg.sender;
    }

    receive() external payable {
        _sendEth(msg.value);
    }

    /// @notice Launch a coin with this contract as creator; first-buy coins go to `to`.
    function launch(EstonksFactory.LaunchParams calldata p, bytes32 salt, bytes calldata route) external payable returns (address token) {
        if (msg.sender != operator) revert NotOperator();
        (token,) = factory.launch{value: msg.value}(p, salt, route);
        sweep(token);
    }

    /// @notice Forward anything held here to `to` (address(0) = ETH). Anyone.
    function sweep(address token) public {
        if (token == address(0)) {
            _sendEth(address(this).balance);
            return;
        }
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).safeTransfer(to, bal);
            emit Forwarded(token, bal);
        }
    }

    function _sendEth(uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Forwarded(address(0), amount);
    }
}
