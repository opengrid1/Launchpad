// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OnairToken} from "./OnairToken.sol";

/// @notice Deploys OnairToken instances for the bound factory, keeping the
///         token bytecode out of the factory. The full supply is always minted
///         to the factory.
contract OnairTokenDeployer {
    error NotFactory();
    error FactoryAlreadySet();
    error NotDeployer();
    error ZeroAddress();

    event FactorySet(address indexed factory);
    event TokenDeployed(address indexed token, address indexed creator);

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    address public factory;
    address private immutable _deployer;

    constructor() {
        _deployer = msg.sender;
    }

    function setFactory(address factory_) external {
        if (msg.sender != _deployer) revert NotDeployer();
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function deploy(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address rewardToken
    ) external returns (address token) {
        if (msg.sender != factory) revert NotFactory();
        token = address(new OnairToken(name, symbol, metadataURI, TOTAL_SUPPLY, creator, msg.sender, rewardToken));
        emit TokenDeployed(token, creator);
    }
}
