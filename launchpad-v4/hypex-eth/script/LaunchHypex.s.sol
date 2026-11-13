// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {HypexFactory} from "../src/HypexFactory.sol";
import {IHypexFactory} from "../src/interfaces/IHypexFactory.sol";
import {StartTick} from "./StartTick.sol";

/// Launches $HYPEX, the factory's first launch: owner-only (the deployer, until the Owner accepts), ETH pair, no fee, no
/// signed start. Its start tick is the $10k-mcap tick for ETH_USD (the middle of the start band Deploy.s.sol set).
///   DEPLOYMENT  name of the deployment file to read and update (default: ethereum)
///   ETH_USD     the ETH price in whole dollars, as at deploy
///   HYPEX_URI   the token's metadata URI (its logo)
/// Writes the token address into deployments/<name>.json as "hypex".
contract LaunchHypex is Script {
    function run() external returns (address token) {
        string memory name = vm.envOr("DEPLOYMENT", string("ethereum"));
        string memory path = string.concat("deployments/", name, ".json");
        string memory json = vm.readFile(path);
        HypexFactory factory = HypexFactory(vm.parseJsonAddress(json, ".factory"));
        require(factory.hypex() == address(0), "HYPEX already launched");
        uint256 ethUsd = vm.envUint("ETH_USD");
        // the native coin in whole dollars: ETH, or HYPE on Hypex's chains (HyperEVM 999, Elysium 99901)
        require(block.chainid == 999 || block.chainid == 99901 ? ethUsd >= 1 : ethUsd >= 1000, "ETH_USD: whole dollars");
        int24 tick = StartTick.forEthUsd(ethUsd);
        IHypexFactory.LaunchParams memory lp = IHypexFactory.LaunchParams({
            name: "Hypex",
            ticker: "HYPEX",
            metadataURI: vm.envString("HYPEX_URI"),
            salt: bytes32(0),
            quote: address(0),
            devBuyTokens: 0,
            devBuyMaxCost: 0,
            tickStart: tick,
            deadline: 0,
            signature: "",
            vestMonths: 0
        });
        vm.startBroadcast();
        (token,) = factory.launch(lp);
        vm.stopBroadcast();
        console2.log("HYPEX token", token);
        console2.log("start tick", tick);
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            vm.writeJson(vm.toString(token), path, ".hypex");
            console2.log("wrote hypex into", path);
        }
    }
}
