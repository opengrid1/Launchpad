// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LaunchpadRewardToken} from "./LaunchpadRewardToken.sol";
import {ProtocolConfig} from "../libraries/ProtocolConfig.sol";

/// @title RewardTokenDeployer
/// @notice Deploys holder-reward token instances on behalf of the launchpad
///         factory, keeping the token bytecode out of the factory. The factory
///         is bound once; thereafter only it can deploy, and the full supply is
///         always minted to the factory for pool seeding.
contract RewardTokenDeployer {
    error NotFactory();
    error FactoryAlreadySet();
    error NotDeployer();
    error ZeroAddress();

    event FactorySet(address indexed factory);
    event TokenDeployed(address indexed token, address indexed creator);

    /// @notice The launchpad factory allowed to deploy tokens.
    address public factory;
    address private immutable _deployer;

    constructor() {
        _deployer = msg.sender;
    }

    /// @notice One-time wiring by the original deployer.
    function setFactory(address factory_) external {
        if (msg.sender != _deployer) revert NotDeployer();
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /// @notice Deploy a fixed-supply reward token, minting the full supply to
    ///         the factory (`msg.sender`) for pool seeding. `rewardToken` is
    ///         the coin's pair asset, in which holder rewards are paid.
    function deploy(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address rewardToken
    ) external returns (address token) {
        if (msg.sender != factory) revert NotFactory();
        token = address(
            new LaunchpadRewardToken(
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
