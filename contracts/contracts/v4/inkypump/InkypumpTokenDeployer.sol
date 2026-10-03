// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {InkypumpToken} from "./InkypumpToken.sol";

/// @title InkypumpTokenDeployer
/// @notice Creates Inkypump coins on the factory's behalf, so the factory stays
///         under the contract size limit. Only the factory may call {deploy};
///         the factory is wired once by whoever deployed this.
contract InkypumpTokenDeployer {
    address public immutable deployer;
    address public factory;

    event FactorySet(address indexed factory);

    error NotFactory();
    error AlreadySet();
    error ZeroAddress();

    constructor() {
        deployer = msg.sender;
    }

    /// @notice One-time wiring of the factory.
    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotFactory();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /// @notice Create a coin with CREATE2. The whole supply is minted to the factory.
    function deploy(bytes32 salt, InkypumpToken.Init calldata p) external returns (address token) {
        if (msg.sender != factory || p.factory != factory) revert NotFactory();
        token = address(new InkypumpToken{salt: salt}(p));
    }
}
