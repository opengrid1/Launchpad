// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {BasketOwnable} from "./BasketOwnable.sol";

/// @title BasketRevenueSplitter
/// @notice Receives the protocol's revenue (its share of trade fees and the
///         launch fees) and splits whatever it holds between a fixed list of
///         recipients by share. The Basket split is 25% to the NFT pot, 7.5%
///         to trader airdrops and 67.5% to the treasury. Anyone can trigger a
///         split; funds only ever go to the listed recipients.
contract BasketRevenueSplitter is BasketOwnable {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 public constant MAX_RECIPIENTS = 8;

    struct Recipient {
        address to;
        uint16 shareBps;
    }

    Recipient[] internal _recipients;

    error InvalidRecipients();

    event RecipientsUpdated(uint256 count);
    event Distributed(address indexed token, uint256 amount);

    constructor(address owner_, Recipient[] memory recipients_) BasketOwnable(owner_) {
        _setRecipients(recipients_);
    }

    function recipients() external view returns (Recipient[] memory) {
        return _recipients;
    }

    function setRecipients(Recipient[] calldata recipients_) external onlyOwner {
        _setRecipients(recipients_);
    }

    function _setRecipients(Recipient[] memory list) private {
        if (list.length == 0 || list.length > MAX_RECIPIENTS) revert InvalidRecipients();
        uint256 sum;
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i].to == address(0) || list[i].shareBps == 0) revert InvalidRecipients();
            sum += list[i].shareBps;
        }
        if (sum != BPS) revert InvalidRecipients();
        delete _recipients;
        for (uint256 i = 0; i < list.length; i++) {
            _recipients.push(list[i]);
        }
        emit RecipientsUpdated(list.length);
    }

    /// @notice Split this contract's whole balance of `token`. The last
    ///         recipient takes the rounding remainder.
    function distribute(IERC20 token) external returns (uint256 amount) {
        amount = token.balanceOf(address(this));
        if (amount == 0) return 0;
        uint256 n = _recipients.length;
        uint256 paid;
        for (uint256 i = 0; i < n; i++) {
            Recipient memory r = _recipients[i];
            uint256 share = i + 1 == n ? amount - paid : (amount * r.shareBps) / BPS;
            paid += share;
            if (share > 0) token.safeTransfer(r.to, share);
        }
        emit Distributed(address(token), amount);
    }
}
