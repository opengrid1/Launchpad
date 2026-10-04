// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AnypairTreasury
/// @notice The factory's fee recipient. Every coin's platform share lands here
///         (as its pair asset) and anyone can sweep it: one eighth of the WETH
///         goes to the leaderboard pool, the rest and every other asset go to
///         the platform wallet. The split is fixed; the admin can only move
///         the platform wallet.
contract AnypairTreasury {
    using SafeERC20 for IERC20;

    uint16 internal constant BPS = 10_000;
    /// @notice Share of platform WETH sent to the leaderboard pool: 1/8, i.e.
    ///         0.1% of every trade when the platform share is 0.8%.
    uint16 public constant PAYOUT_BPS = 1250;

    address public immutable weth;
    address public immutable admin;
    address public immutable payout;
    address public recipient;

    event Swept(address indexed token, uint256 toPayout, uint256 toRecipient);
    event RecipientSet(address indexed recipient);

    error NotAdmin();
    error ZeroAddress();

    constructor(address weth_, address admin_, address payout_) {
        if (weth_ == address(0) || admin_ == address(0) || payout_ == address(0)) revert ZeroAddress();
        weth = weth_;
        admin = admin_;
        payout = payout_;
        recipient = admin_;
    }

    function setRecipient(address recipient_) external {
        if (msg.sender != admin) revert NotAdmin();
        if (recipient_ == address(0)) revert ZeroAddress();
        recipient = recipient_;
        emit RecipientSet(recipient_);
    }

    /// @notice Forward everything held of `token`. Anyone.
    function sweep(address token) external returns (uint256 toPayout, uint256 toRecipient) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) return (0, 0);
        if (token == weth) {
            toPayout = (bal * PAYOUT_BPS) / BPS;
            if (toPayout > 0) IERC20(token).safeTransfer(payout, toPayout);
        }
        toRecipient = bal - toPayout;
        if (toRecipient > 0) IERC20(token).safeTransfer(recipient, toRecipient);
        emit Swept(token, toPayout, toRecipient);
    }
}
