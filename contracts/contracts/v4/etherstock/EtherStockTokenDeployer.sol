// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {EtherStockToken} from "./EtherStockToken.sol";

/// @title EtherStockTokenDeployer
/// @notice Deploys Etherstock coins on the factory's behalf, so the factory
///         itself stays under the contract size limit. Only the factory may
///         call {deploy}; the factory is wired once by whoever deployed this.
contract EtherStockTokenDeployer {
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
    function deploy(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        uint256 supply,
        address creator,
        address pair,
        IPoolManager poolManager,
        uint16 creatorBps,
        uint16 burnBps
    ) external returns (address token) {
        if (msg.sender != factory) revert NotFactory();
        token = address(new EtherStockToken{salt: salt}(name, symbol, metadataURI, supply, creator, factory, pair, poolManager, creatorBps, burnBps));
    }
}
