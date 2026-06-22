// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {SpcxdToken} from "../src/spcx/SpcxdToken.sol";
import {SpcxdManager} from "../src/spcx/SpcxdManager.sol";
import {INonfungiblePositionManager, ISwapRouter, IWHYPE} from "../src/interfaces/IHyperswapV3.sol";

/// @notice Deploys HYPEX: SpcxdToken + SpcxdManager, seeds the LP single-sided. The 1:1 airdrop
///         to HYLD holders is done in a separate batch. Reads PRIVATE_KEY from env.
contract DeployHypex is Script {
    address constant NFPM = 0x6eDA206207c09e5428F281761DdC0D300851fBC8;
    address constant ROUTER = 0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D;
    address constant WHYPE = 0x5555555555555555555555555555555555555555;

    uint64 constant SPCXD_CORE = 610;
    uint256 constant SUPPLY = 10_000e18;
    uint256 constant LP_AMOUNT = 5_059_551_173_642_801_448_090; // ~5059.55 (10000 - airdrop)
    uint256 constant PRICE_WEI = 7_351_049_362_296_467; // ~$5k FDV at deploy-time HYPE/USD

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        SpcxdToken token = new SpcxdToken("HYPEX", "HYPEX", SUPPLY, SPCXD_CORE, deployer);
        SpcxdManager mgr = new SpcxdManager(
            token, INonfungiblePositionManager(NFPM), ISwapRouter(ROUTER), IWHYPE(WHYPE), deployer
        );

        token.setManager(address(mgr));
        token.setExcluded(address(mgr), true);
        token.transfer(address(mgr), LP_AMOUNT); // LP portion; deployer keeps the airdrop portion

        address pool = mgr.seed(PRICE_WEI);
        token.setExcluded(pool, true);

        vm.stopBroadcast();

        console.log("HYPEX token :", address(token));
        console.log("manager     :", address(mgr));
        console.log("pool        :", pool);
        console.log("deployer keeps (airdrop):", token.balanceOf(deployer));
    }
}
