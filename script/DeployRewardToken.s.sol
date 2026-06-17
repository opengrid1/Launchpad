// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RewardToken} from "../src/RewardToken.sol";

/// Usage:
///   export PRIVATE_KEY=0x...
///   export ROUTER=0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A  # Hyperswap V2 Router
///   export TOKEN_NAME="Grid"           # optional, default "Grid"
///   export TOKEN_SYMBOL="GRID"         # optional, default "GRID"
///   export SUPPLY=10000000000000000000000   # optional, default 10_000e18
///   export RECIPIENT=0x...             # optional, defaults to deployer
///   forge script script/DeployRewardToken.s.sol --rpc-url hyperevm --broadcast
///
/// The token charges a 5%/5% buy/sell tax (fee-on-transfer) and pays it back to
/// holders as TWO rewards funded by volume: GRID (the token itself) + HYPE
/// (auto-swapped from the tax). Because it is fee-on-transfer it MUST trade on a
/// UniswapV2-style DEX (Hyperswap V2 / KittenSwap) — NOT V3. After deploy:
///   1. Add GRID/WHYPE liquidity to create the V2 pair (deployer is tax-exempt,
///      so seeding liquidity is untaxed).
///   2. token.setAMM(pair, true)            // tax trades through the pair
///   3. token.excludeFromRewards(pair)      // pair neither earns nor dilutes
///   4. token.excludeFromRewards(treasury)  // optional, same for the treasury
///   5. (optional) token.setRewardSplit(bps) / setSwapThreshold(amount)
contract DeployRewardToken is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address router = vm.envAddress("ROUTER");
        string memory name_ = vm.envOr("TOKEN_NAME", string("Grid"));
        string memory symbol_ = vm.envOr("TOKEN_SYMBOL", string("GRID"));
        uint256 supply = vm.envOr("SUPPLY", uint256(10_000 ether));
        address recipient = vm.envOr("RECIPIENT", deployer);

        vm.startBroadcast(pk);
        RewardToken token = new RewardToken(name_, symbol_, supply, recipient, router);
        vm.stopBroadcast();

        console.log("RewardToken deployed at:", address(token));
        console.log("  name:     ", name_);
        console.log("  symbol:   ", symbol_);
        console.log("  supply:   ", supply);
        console.log("  recipient:", recipient);
        console.log("  router:   ", router);
    }
}
