// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title BasketOwnable
/// @notice The admin model shared by every Basket contract, matching the
///         BuzzPad contracts on Ethereum: one owner, two-step handover
///         (`transferOwnership` then `acceptOwnership`), and ownership can
///         never be renounced, so the admin controls cannot be orphaned by a
///         mistaken call.
abstract contract BasketOwnable is Ownable2Step {
    error OwnershipCannotBeRenounced();
    error ZeroAddress();

    constructor(address owner_) Ownable(owner_) {}

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }
}
