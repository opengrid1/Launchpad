// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BackstopStrategy} from "./BackstopStrategy.sol";

/// @title BackstopStrategyDeployer
/// @notice Creates Backstop strategy contracts on the factory's behalf, so the factory
///         stays under the contract size limit. Only the factory may call {deploy};
///         the factory is wired once by whoever deployed this.
contract BackstopStrategyDeployer {
    address public immutable deployer;
    address public factory;

    event FactorySet(address indexed factory);

    error NotFactory();
    error AlreadySet();
    error ZeroAddress();

    constructor() {
        deployer = msg.sender;
    }

    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotFactory();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function deploy(bytes32 salt, BackstopStrategy.Init calldata p) external returns (address a) {
        if (msg.sender != factory || p.factory != factory) revert NotFactory();
        a = address(new BackstopStrategy{salt: salt}(p));
    }
}
