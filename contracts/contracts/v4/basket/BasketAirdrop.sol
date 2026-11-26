// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BasketOwnable} from "./BasketOwnable.sol";
import {CumulativeMerkle} from "./CumulativeMerkle.sol";

/// @title BasketAirdrop
/// @notice The trader airdrop pot. A share of protocol revenue lands here in
///         one token (WETH). The keeper ranks traders off chain by volume and
///         posts a cumulative Merkle root; traders claim with a proof. A root
///         can never allot more than the pot holds.
contract BasketAirdrop is CumulativeMerkle, BasketOwnable {
    IERC20 private immutable _token;
    address public keeper;

    error NotKeeper();

    event KeeperUpdated(address keeper);

    constructor(address owner_, IERC20 token_, address keeper_) BasketOwnable(owner_) {
        if (address(token_) == address(0) || keeper_ == address(0)) revert ZeroAddress();
        _token = token_;
        keeper = keeper_;
    }

    function payoutToken() public view override returns (IERC20) {
        return _token;
    }

    function setKeeper(address keeper_) external onlyOwner {
        if (keeper_ == address(0)) revert ZeroAddress();
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
    }

    function postRoot(bytes32 root, uint256 newCommitted) external {
        if (msg.sender != keeper) revert NotKeeper();
        _postRoot(root, newCommitted);
    }
}
