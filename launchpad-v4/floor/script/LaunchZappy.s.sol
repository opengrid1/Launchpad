// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {ZappyFactory} from "../src/ZappyFactory.sol";
import {IZappyFactory} from "../src/interfaces/IZappyFactory.sol";
import {StartTick} from "./StartTick.sol";

/// Launches $ZAPPY, the factory's first launch: owner-only (the deployer, until the Owner accepts), ETH pair, no fee, no
/// signed start. Its start tick is the $10k-mcap tick for ETH_USD (the middle of the start band Deploy.s.sol set).
///   DEPLOYMENT  name of the deployment file to read and update (default: ethereum)
///   ETH_USD     the ETH price in whole dollars, as at deploy
///   ZAPPY_URI   the token's metadata URI (its logo)
/// Writes the token address into deployments/<name>.json as "zappy".
contract LaunchZappy is Script {
    function run() external returns (address token) {
        string memory name = vm.envOr("DEPLOYMENT", string("ethereum"));
        string memory path = string.concat("deployments/", name, ".json");
        string memory json = vm.readFile(path);
        ZappyFactory factory = ZappyFactory(vm.parseJsonAddress(json, ".factory"));
        require(factory.zappy() == address(0), "ZAPPY already launched");
        uint256 ethUsd = vm.envUint("ETH_USD");
        require(ethUsd >= 1000, "ETH_USD: whole dollars");
        int24 tick = StartTick.forEthUsd(ethUsd);
        IZappyFactory.LaunchParams memory lp = IZappyFactory.LaunchParams({
            name: "Zappy",
            ticker: "ZAPPY",
            metadataURI: vm.envString("ZAPPY_URI"),
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
        console2.log("ZAPPY token", token);
        console2.log("start tick", tick);
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            vm.writeJson(vm.toString(token), path, ".zappy");
            console2.log("wrote zappy into", path);
        }
    }
}
