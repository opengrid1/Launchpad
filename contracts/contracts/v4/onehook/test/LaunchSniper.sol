// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OneFactory} from "../OneFactory.sol";

interface IOneRouterMin {
    function buy(address coin, bytes calldata route, uint256 minCoinOut) external payable returns (uint256);
}

/// @dev Test-only: launches a coin and tries to buy it through the router in
///      the same transaction, i.e. inside the launch block. The hook must
///      refuse the buy (LaunchBlockClosed), so the whole call reverts.
contract LaunchSniper {
    function snipe(OneFactory factory, IOneRouterMin router, OneFactory.LaunchParams calldata p, bytes32 salt) external payable {
        (address token,) = factory.launch(p, salt, "");
        router.buy{value: msg.value}(token, "", 0);
    }
}
