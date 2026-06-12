// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {Launchpad} from "../src/Launchpad.sol";
import {INonfungiblePositionManager, ISwapRouter, IWHYPE} from "../src/interfaces/IHyperswapV3.sol";

/// Usage (HyperEVM mainnet, chain id 999 — HyperSwap V3 addresses are the defaults,
/// verified on-chain against rpc.hyperliquid.xyz):
///   export PRIVATE_KEY=0x...
///   export TREASURY=0x...        # platform fee recipient, defaults to the deployer
///   forge script script/Deploy.s.sol --rpc-url hyperevm --broadcast
///
/// For testnet (chain id 998) override POSITION_MANAGER / SWAP_ROUTER / WHYPE via env.
contract Deploy is Script {
    // HyperSwap V3 mainnet
    address constant HYPERSWAP_V3_POSITION_MANAGER = 0x6eDA206207c09e5428F281761DdC0D300851fBC8;
    address constant HYPERSWAP_V3_SWAP_ROUTER = 0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D;
    address constant WHYPE = 0x5555555555555555555555555555555555555555;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address positionManager = vm.envOr("POSITION_MANAGER", HYPERSWAP_V3_POSITION_MANAGER);
        address swapRouter = vm.envOr("SWAP_ROUTER", HYPERSWAP_V3_SWAP_ROUTER);
        address whype = vm.envOr("WHYPE", WHYPE);
        address treasury = vm.envOr("TREASURY", vm.addr(pk));

        vm.startBroadcast(pk);
        Launchpad pad = new Launchpad(
            INonfungiblePositionManager(positionManager),
            ISwapRouter(swapRouter),
            IWHYPE(whype),
            treasury
        );
        vm.stopBroadcast();

        console.log("Launchpad deployed at:", address(pad));
        console.log("  position manager:  ", positionManager);
        console.log("  swap router:       ", swapRouter);
        console.log("  WHYPE:             ", whype);
        console.log("  treasury:          ", treasury);
    }
}
