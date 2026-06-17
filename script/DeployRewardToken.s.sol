// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RewardToken} from "../src/RewardToken.sol";

/// Usage:
///   export PRIVATE_KEY=0x...
///   export REWARD_TOKEN=0x...          # ERC20 used as the token reward stream
///   export TOKEN_NAME="Grid"           # optional, default "Grid"
///   export TOKEN_SYMBOL="GRID"         # optional, default "GRID"
///   export SUPPLY=10000000000000000000000   # optional, default 10_000e18
///   export RECIPIENT=0x...             # optional, defaults to deployer
///   forge script script/DeployRewardToken.s.sol --rpc-url hyperevm --broadcast
///
/// After deploy, create the Hyperswap V3 pool, then exclude the pool (and the
/// treasury) via excludeFromRewards so they neither earn nor dilute holders.
contract DeployRewardToken is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address rewardToken = vm.envAddress("REWARD_TOKEN");
        string memory name_ = vm.envOr("TOKEN_NAME", string("Grid"));
        string memory symbol_ = vm.envOr("TOKEN_SYMBOL", string("GRID"));
        uint256 supply = vm.envOr("SUPPLY", uint256(10_000 ether));
        address recipient = vm.envOr("RECIPIENT", deployer);

        vm.startBroadcast(pk);
        RewardToken token = new RewardToken(name_, symbol_, supply, recipient, rewardToken);
        vm.stopBroadcast();

        console.log("RewardToken deployed at:", address(token));
        console.log("  name:        ", name_);
        console.log("  symbol:      ", symbol_);
        console.log("  supply:      ", supply);
        console.log("  recipient:   ", recipient);
        console.log("  rewardToken: ", rewardToken);
    }
}
