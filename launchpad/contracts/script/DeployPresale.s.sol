// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {WorkPresale} from "../src/WorkPresale.sol";

/// @notice Deploys the WorkPresale. Can run now on Base mainnet; it does not
/// depend on B20 being live.
///
/// env:
///   PROCEEDS  project wallet that receives ETH (defaults to the Coinworks wallet)
contract DeployPresale is Script {
    function run() external {
        address proceeds = vm.envOr("PROCEEDS", address(0x14C8905F188a8012A5A10122BF257D0BA5D418a6));
        uint256 softCap = 5 ether;
        uint256 hardCap = 10 ether;
        uint256 priceWeiPerToken = 40_000_000_000; // 0.00000004 ETH per WORK

        vm.startBroadcast();
        WorkPresale presale = new WorkPresale(proceeds, softCap, hardCap, priceWeiPerToken);
        vm.stopBroadcast();

        console.log("WorkPresale deployed:", address(presale));
        console.log("  proceeds:", proceeds);
        console.log("  soft/hard cap (wei):", softCap, hardCap);
        console.log("  price wei/token:", priceWeiPerToken);
    }
}
