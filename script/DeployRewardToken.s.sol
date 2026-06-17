// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RewardToken} from "../src/RewardToken.sol";

/// Deploys the dual-reward dividend token (holders earn an external reward token + HYPE).
///
/// Required env:
///   PRIVATE_KEY   0x...           deployer key (also pays gas)
///   REWARD_TOKEN  0x...           external ERC20 paid to holders (stream #1)
///   NAME          "My Token"
///   SYMBOL        "MTK"
///   SUPPLY        1000000000000000000000000   total supply in wei (e.g. 1,000,000 * 1e18)
///
/// Optional env (default to the deployer address):
///   RECIPIENT     0x...           receives the full supply at deploy (your treasury)
///   OWNER         0x...           can manage reward exclusions
///
/// Usage:
///   export PRIVATE_KEY=0x...
///   export REWARD_TOKEN=0x...
///   export NAME="My Token"
///   export SYMBOL="MTK"
///   export SUPPLY=1000000000000000000000000
///   forge script script/DeployRewardToken.s.sol --rpc-url hyperevm --broadcast
///
/// AFTER DEPLOY: once you create the Hyperswap pool, exclude the pair so it does not
/// dilute real holders:  token.setExcludedFromRewards(<pairAddress>, true)
contract DeployRewardToken is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        string memory name = vm.envString("NAME");
        string memory symbol = vm.envString("SYMBOL");
        uint256 supply = vm.envUint("SUPPLY");
        address rewardToken = vm.envAddress("REWARD_TOKEN");
        address recipient = vm.envOr("RECIPIENT", deployer);
        address owner = vm.envOr("OWNER", deployer);

        require(rewardToken != address(0), "set REWARD_TOKEN");
        require(supply > 0, "set SUPPLY");

        vm.startBroadcast(pk);
        RewardToken token = new RewardToken(name, symbol, supply, recipient, rewardToken, owner);
        vm.stopBroadcast();

        console.log("RewardToken deployed at:", address(token));
        console.log("  name:        ", name);
        console.log("  symbol:      ", symbol);
        console.log("  supply:      ", supply);
        console.log("  recipient:   ", recipient);
        console.log("  rewardToken: ", rewardToken);
        console.log("  owner:       ", owner);
        console.log("REMINDER: after creating the pool, call setExcludedFromRewards(pair, true)");
    }
}
