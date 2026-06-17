// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RewardToken} from "../src/RewardToken.sol";

/// Usage:
///   export PRIVATE_KEY=0x...
///   export WHYPE=0x5555555555555555555555555555555555555555  # Wrapped HYPE
///   export TOKEN_NAME="HyperYield"     # optional, default "HyperYield"
///   export TOKEN_SYMBOL="HYLD"         # optional, default "HYLD"
///   export SUPPLY=10000000000000000000000   # optional, default 10_000e18
///   export RECIPIENT=0x...             # optional, defaults to deployer
///   forge script script/DeployRewardToken.s.sol --rpc-url hyperevm --broadcast
///
/// The token charges a 5%/5% buy/sell tax (fee-on-transfer) and pays it back to
/// holders as TWO rewards funded by volume: HYLD (the token itself) + HYPE
/// (swapped directly against its own pair — no router needed). Because it is
/// fee-on-transfer it MUST trade on a UniswapV2-style DEX (Hyperswap V2 /
/// KittenSwap) — NOT V3. After deploy:
///   1. Add HYLD/WHYPE liquidity to create the V2 pair (deployer is tax-exempt,
///      so seeding liquidity is untaxed).
///   2. token.setPair(pair)                 // AMM + swap target + token ordering
///   3. token.excludeFromRewards(pair)      // pair neither earns nor dilutes
///   4. (optional) token.excludeFromRewards(treasury)
///   5. (optional) token.setRewardSplit(bps) / setSwapThreshold(amount)
contract DeployRewardToken is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address whype = vm.envOr("WHYPE", 0x5555555555555555555555555555555555555555);
        string memory name_ = vm.envOr("TOKEN_NAME", string("HyperYield"));
        string memory symbol_ = vm.envOr("TOKEN_SYMBOL", string("HYLD"));
        uint256 supply = vm.envOr("SUPPLY", uint256(10_000 ether));
        address recipient = vm.envOr("RECIPIENT", deployer);

        vm.startBroadcast(pk);
        RewardToken token = new RewardToken(name_, symbol_, supply, recipient, whype);
        vm.stopBroadcast();

        console.log("RewardToken deployed at:", address(token));
        console.log("  name:     ", name_);
        console.log("  symbol:   ", symbol_);
        console.log("  supply:   ", supply);
        console.log("  recipient:", recipient);
        console.log("  WHYPE:    ", whype);
    }
}
