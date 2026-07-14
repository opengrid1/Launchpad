// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LaunchToken} from "./LaunchToken.sol";
import {ProtocolConfig} from "./libraries/ProtocolConfig.sol";

/// @title TokenFactory
/// @notice Deploys LaunchToken instances under fixed protocol rules. Nothing
///         about supply or limits is caller-configurable: every token gets
///         the protocol supply, 2% max transaction, 2% max wallet and no
///         cooldown, straight from ProtocolConfig.
///
///         Two entry points:
///         - deployToken: public; the creator is always msg.sender, so the
///           attribution cannot be spoofed.
///         - deployTokenFor: launchpad-only; the launchpad forwards its own
///           msg.sender as the creator so platform launches attribute the
///           real user, not the launchpad contract.
contract TokenFactory {
    error NotLaunchpad();
    error LaunchpadAlreadySet();
    error NotDeployer();
    error ZeroAddress();

    event TokenDeployed(
        address indexed token,
        address indexed launchpad,
        address indexed creator,
        uint256 initialMarketCapUsd
    );

    /// @notice The launchpad bound to tokens from deployTokenFor. Set once.
    address public launchpad;
    address private immutable _deployer;

    constructor() {
        _deployer = msg.sender;
    }

    /// @notice One-time wiring, called by the deployer right after the
    ///         launchpad is deployed.
    function setLaunchpad(address launchpad_) external {
        if (msg.sender != _deployer) revert NotDeployer();
        if (launchpad != address(0)) revert LaunchpadAlreadySet();
        if (launchpad_ == address(0)) revert ZeroAddress();
        launchpad = launchpad_;
    }

    /// @notice Deploy a token as yourself. The full supply is minted to the
    ///         caller; the caller is the creator. Fixed protocol tokenomics.
    function deployToken(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) external returns (address token) {
        return _deploy(msg.sender, msg.sender, name, symbol, metadataURI);
    }

    /// @notice Launchpad-only variant: mints the supply to the launchpad for
    ///         pooling while attributing the real user as creator.
    function deployTokenFor(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) external returns (address token) {
        if (msg.sender != launchpad) revert NotLaunchpad();
        return _deploy(msg.sender, creator, name, symbol, metadataURI);
    }

    function _deploy(
        address supplyRecipient,
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI
    ) internal returns (address token) {
        token = address(
            new LaunchToken(
                supplyRecipient,
                name,
                symbol,
                metadataURI,
                ProtocolConfig.TOTAL_SUPPLY,
                creator,
                ProtocolConfig.maxTxAmount(),
                ProtocolConfig.maxWalletAmount()
            )
        );
        emit TokenDeployed(token, supplyRecipient, creator, ProtocolConfig.INITIAL_MCAP_USD);
    }
}
