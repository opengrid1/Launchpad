// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SquidRewardToken} from "./SquidRewardToken.sol";
import {ProtocolConfig} from "../libraries/ProtocolConfig.sol";

/// @title SquidTokenDeployer
/// @notice Deploys auto-reward squid tokens on behalf of the launchpad
///         factory. Signature-compatible with RewardTokenDeployer so the
///         factory can bind either deployer unchanged.
contract SquidTokenDeployer {
    error NotFactory();
    error FactoryAlreadySet();
    error NotDeployer();
    error ZeroAddress();

    event FactorySet(address indexed factory);
    event TokenDeployed(address indexed token, address indexed creator);

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
        token = address(
            new SquidRewardToken(
                name,
                symbol,
                metadataURI,
                ProtocolConfig.TOTAL_SUPPLY,
                creator,
                msg.sender,
                rewardToken
            )
        );
        emit TokenDeployed(token, creator);
    }
}
