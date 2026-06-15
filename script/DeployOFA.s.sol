// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {OFAToken} from "../src/OFAToken.sol";
import {OFABondingCurve} from "../src/OFABondingCurve.sol";

/// Deploys $OFA + its bonding curve, wired so the reward system works during the curve.
///
/// Usage:
///   export PRIVATE_KEY=0x...
///   # optional overrides (defaults shown):
///   export TOTAL_SUPPLY=100000000      # 100M tokens
///   export TOKENS_FOR_SALE=25000000    # 25M onto the curve
///   export VIRTUAL_ETH=1               # virtual ETH (start price = VIRTUAL_ETH / TOKENS_FOR_SALE)
///   export REWARD_FEE_BPS=200          # 2% of each buy -> holder rewards
///   forge script script/DeployOFA.s.sol --rpc-url <mainnet> --broadcast
///
/// IMPORTANT — exclusion ordering (handled below, do not reorder):
///   1. deploy token (full supply to deployer)
///   2. deploy curve
///   3. exclude deployer + curve from rewards   (so their balances don't absorb yield)
///   4. transfer the sale allocation to the curve
/// After this, only buyers (who receive tokens from the curve) accrue rewards.
contract DeployOFA is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        uint256 supply = vm.envOr("TOTAL_SUPPLY", uint256(100_000_000)) * 1e18;
        uint256 forSale = vm.envOr("TOKENS_FOR_SALE", uint256(25_000_000)) * 1e18;
        uint256 virtualEth = vm.envOr("VIRTUAL_ETH", uint256(1)) * 1e18;
        uint256 rewardFeeBps = vm.envOr("REWARD_FEE_BPS", uint256(200));

        require(forSale <= supply, "sale > supply");

        vm.startBroadcast(pk);

        // 1. token: full supply minted to deployer
        OFAToken token = new OFAToken("Order Flow Auction", "OFA", supply, deployer, deployer);

        // 2. curve
        OFABondingCurve curve =
            new OFABondingCurve(address(token), forSale, virtualEth, rewardFeeBps, deployer);

        // 3. exclude deployer (treasury) and the curve from rewards
        token.setExcludedFromRewards(deployer, true);
        token.setExcludedFromRewards(address(curve), true);

        // 4. fund the curve with the sale allocation
        token.transfer(address(curve), forSale);

        vm.stopBroadcast();

        console.log("OFAToken:       ", address(token));
        console.log("OFABondingCurve:", address(curve));
        console.log("start price (wei/token):", curve.priceWeiPerToken());
        console.log("reward fee bps: ", rewardFeeBps);
    }
}
