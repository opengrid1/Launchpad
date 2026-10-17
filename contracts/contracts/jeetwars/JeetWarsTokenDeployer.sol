// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {JeetWarsToken} from "./JeetWarsToken.sol";

/// @title JeetWarsTokenDeployer
/// @notice Holds the coin creation code so the Arena stays under the contract
///         size limit. Only the Arena may deploy; it is wired once.
contract JeetWarsTokenDeployer {
    address public immutable deployer;
    address public arena;

    error NotDeployer();
    error NotArena();
    error AlreadySet();

    constructor() {
        deployer = msg.sender;
    }

    function setArena(address arena_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (arena != address(0)) revert AlreadySet();
        arena = arena_;
    }

    function deploy(JeetWarsToken.Init calldata p) external returns (address) {
        if (msg.sender != arena) revert NotArena();
        return address(new JeetWarsToken(p));
    }
}
