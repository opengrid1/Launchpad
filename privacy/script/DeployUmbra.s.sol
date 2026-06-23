// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {UmbraToken} from "../src/UmbraToken.sol";
import {TokenPresale, IERC20} from "../src/TokenPresale.sol";

/// Deploys UMBRA + the presale and funds the presale with the offered tokens.
///   env (all optional, sensible defaults):
///     PRIVATE_KEY     deployer (defaults to anvil account 0)
///     PRICE           wei per UMBRA            (default 0.0001 ether)
///     FOR_SALE        UMBRA offered            (default 10,000,000e18)
///     SOFT_CAP        wei                      (default 1 ether)
///     HARD_CAP        wei                      (default 100 ether)
///     START_DELAY     seconds until start      (default 1)
///     DURATION        sale length in seconds   (default 1 day)
contract DeployUmbra is Script {
    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);

        uint256 price = vm.envOr("PRICE", uint256(0.0001 ether));
        uint256 forSale = vm.envOr("FOR_SALE", uint256(10_000_000 ether));
        uint256 soft = vm.envOr("SOFT_CAP", uint256(1 ether));
        uint256 hard = vm.envOr("HARD_CAP", uint256(100 ether));
        uint256 startDelay = vm.envOr("START_DELAY", uint256(1));
        uint256 duration = vm.envOr("DURATION", uint256(1 days));

        uint256 cap = 100_000_000 ether;
        uint256 initial = 40_000_000 ether; // presale + liquidity + treasury

        vm.startBroadcast(pk);

        UmbraToken token = new UmbraToken(cap, deployer, initial, deployer);

        uint256 start = block.timestamp + startDelay;
        TokenPresale presale = new TokenPresale(
            IERC20(address(token)), deployer, price, forSale, soft, hard, start, start + duration, 0
        );

        token.transfer(address(presale), forSale);

        vm.stopBroadcast();

        console2.log("UmbraToken :", address(token));
        console2.log("Presale    :", address(presale));
        console2.log("start      :", start);
        console2.log("end        :", start + duration);
    }
}
