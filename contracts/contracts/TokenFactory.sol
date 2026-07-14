// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LaunchToken} from "./LaunchToken.sol";

/// @title TokenFactory
/// @notice Deploys LaunchToken instances bound to the calling launchpad. The
///         full supply is minted to the caller, which pairs it with liquidity
///         in the same transaction. Kept separate so the launchpad stays
///         under the contract size limit.
contract TokenFactory {
    event TokenDeployed(address indexed token, address indexed launchpad, address indexed creator);

    function deployToken(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        uint256 totalSupply,
        address creator,
        uint256 maxTxAmount,
        uint256 maxWalletAmount,
        uint256 buyCooldown
    ) external returns (address token) {
        token = address(
            new LaunchToken(
                msg.sender,
                name,
                symbol,
                metadataURI,
                totalSupply,
                creator,
                maxTxAmount,
                maxWalletAmount,
                buyCooldown
            )
        );
        emit TokenDeployed(token, msg.sender, creator);
    }
}
