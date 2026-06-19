// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {HyldToken} from "../src/hyld/HyldToken.sol";
import {HyldManager} from "../src/hyld/HyldManager.sol";
import {INonfungiblePositionManager, IWHYPE} from "../src/interfaces/IHyperswapV3.sol";

/// @notice Deploys HyperYield (HYLD): fixed 10,000 supply, seeded single-sided into a
///         HYLD/WHYPE 1% pool at a 5,000 USD starting market cap. Reads PRIVATE_KEY and
///         HYPE_USD6 (HYPE/USD with 6 decimals, captured at deploy time) from env.
contract DeployHyld is Script {
    address constant PM = 0x6eDA206207c09e5428F281761DdC0D300851fBC8; // Hyperswap V3 NFPM
    address constant WHYPE = 0x5555555555555555555555555555555555555555;

    uint256 constant MCAP_USD6 = 5_000e6; // 5,000 USD starting FDV
    uint256 constant SUPPLY_WHOLE = 10_000; // 10,000 HYLD

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint256 hypeUsd6 = vm.envUint("HYPE_USD6");
        address deployer = vm.addr(pk);

        // price (WHYPE wei per 1e18 HYLD) implied by the 5k FDV at the live HYPE/USD.
        uint256 priceUsd6 = MCAP_USD6 / SUPPLY_WHOLE; // 500000 = $0.50 / HYLD
        uint256 priceWei = (priceUsd6 * 1e18) / hypeUsd6;
        require(priceWei > 0, "price zero");

        vm.startBroadcast(pk);

        HyldToken token = new HyldToken(deployer); // mints 10,000 to deployer (excluded)
        HyldManager manager =
            new HyldManager(token, INonfungiblePositionManager(PM), IWHYPE(WHYPE), deployer);

        token.setExcluded(address(manager), true);
        token.transfer(address(manager), 10_000e18); // fund the manager to seed the LP

        address pool = manager.seed(priceWei); // create pool + single-sided LP
        token.setExcluded(pool, true); // pool earns no dividends

        vm.stopBroadcast();

        console.log("HYLD token  :", address(token));
        console.log("HyldManager :", address(manager));
        console.log("HYLD/WHYPE  :", pool);
        console.log("priceWei    :", priceWei);
        console.log("deployer    :", deployer);
    }
}
