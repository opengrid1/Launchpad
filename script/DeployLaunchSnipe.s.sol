// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {LaunchSnipe} from "../src/LaunchSnipe.sol";

/// @notice Deploys LaunchSnipe with Robinhood L2 (chainId 4663) DEX addresses.
///   forge script script/DeployLaunchSnipe.s.sol --rpc-url robinhood --broadcast
contract DeployLaunchSnipe is Script {
    // Verified on-chain (see bot/README.md).
    address constant FACTORY = 0x1f7D7550b1B028F7571E69A784071f0205fD2eFa;
    address constant NPM = 0x73991a25c818bF1F1128DEaab1492d45638De0d3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    function run() external returns (LaunchSnipe sniper) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        sniper = new LaunchSnipe(FACTORY, NPM, ROUTER, WETH);
        vm.stopBroadcast();
        console2.log("LaunchSnipe deployed:", address(sniper));
    }
}
