// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BasketRewardVault} from "./BasketRewardVault.sol";
import {ISlipstreamRouter} from "./ISlipstreamRouter.sol";

/// @notice Holds the BasketRewardVault creation code so the factory stays
///         under the contract-size limit. The vault trusts whoever calls
///         `deploy` as its factory, and only vaults the real factory records
///         in `launchInfo` ever receive fees.
contract BasketVaultDeployer {
    function deploy(address coin, address pair, address rewardToken, ISlipstreamRouter swapRouter)
        external
        returns (address vault)
    {
        vault = address(new BasketRewardVault(msg.sender, coin, pair, rewardToken, swapRouter));
    }
}
