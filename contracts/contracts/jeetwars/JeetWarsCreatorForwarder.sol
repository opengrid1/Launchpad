// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {JeetWarsArena} from "./JeetWarsArena.sol";

/// @title JeetWarsCreatorForwarder
/// @notice Launches a coin with this contract as its creator and forwards
///         everything a creator receives to a fixed wallet: the creator's 0.7%
///         fee share (BNB), any refund, and the first-buy coins. Lets an
///         operator key launch a coin whose creator share still goes to the
///         team wallet forever.
contract JeetWarsCreatorForwarder {
    using SafeERC20 for IERC20;

    JeetWarsArena public immutable arena;
    /// @notice Where everything goes.
    address public immutable to;
    /// @notice The only address that may launch through this forwarder.
    address public immutable operator;

    event Forwarded(address indexed token, uint256 amount);

    error NotOperator();
    error TransferFailed();

    constructor(JeetWarsArena arena_, address to_) {
        arena = arena_;
        to = to_;
        operator = msg.sender;
    }

    /// @notice Creator fees and refunds arrive here and go straight on.
    receive() external payable {
        _sendBnb(msg.value);
    }

    /// @notice Launch a coin with this contract as creator; first-buy coins go to `to`.
    function launch(JeetWarsArena.LaunchParams calldata p) external payable returns (address coin) {
        if (msg.sender != operator) revert NotOperator();
        coin = arena.launch{value: msg.value}(p);
        sweep(coin);
    }

    /// @notice Forward anything held here to `to` (address(0) = BNB). Anyone.
    function sweep(address token) public {
        if (token == address(0)) {
            _sendBnb(address(this).balance);
            return;
        }
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).safeTransfer(to, bal);
            emit Forwarded(token, bal);
        }
    }

    function _sendBnb(uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Forwarded(address(0), amount);
    }
}
