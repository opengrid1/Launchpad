// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {B20Constants} from "base-std/lib/B20Constants.sol";
import {WorkDistributor} from "../src/WorkDistributor.sol";

/// @notice Creates the native $WORK B20 token and wires up the distributor.
/// Run this AFTER B20 is live (Base Sepolia now, Base mainnet from 18:00 UTC).
///
/// Steps, all in one broadcast:
///   1. createB20(ASSET) for "Coinworks" / "WORK", 18 decimals, admin = deployer
///      initCalls (run in the factory bootstrap window, role gates bypassed):
///        - updateSupplyCap(TOTAL)            cap the supply at 1B
///        - grantRole(MINT_ROLE, admin)       let admin mint later (rewards)
///        - batchMint([admin], [TOTAL])       mint the full supply to admin
///   2. deploy WorkDistributor(presale, token)
///   3. transfer the presale allocation (25%) to the distributor
///
/// env:
///   ADMIN    deployer / treasury (holder of DEFAULT_ADMIN_ROLE and the supply)
///   PRESALE  address of the already-deployed WorkPresale
///   SALT     optional string; fixes the deterministic 0xB200... token address
contract CreateWork is Script {
    uint256 constant TOTAL = 1_000_000_000e18; // 1B WORK
    uint256 constant PRESALE_ALLOC = 250_000_000e18; // 25% to the distributor

    function run() external {
        address admin = vm.envAddress("ADMIN");
        address presale = vm.envAddress("PRESALE");
        bytes32 salt = keccak256(bytes(vm.envOr("SALT", string("coinworks-work-v1"))));

        bytes memory params = B20FactoryLib.encodeAssetCreateParams("Coinworks", "WORK", admin, 18);

        address[] memory recipients = new address[](1);
        recipients[0] = admin;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = TOTAL;

        bytes[] memory initCalls = new bytes[](3);
        initCalls[0] = B20FactoryLib.encodeUpdateSupplyCap(TOTAL);
        initCalls[1] = B20FactoryLib.encodeGrantRole(B20Constants.MINT_ROLE, admin);
        initCalls[2] = B20FactoryLib.encodeBatchMint(recipients, amounts);

        // sanity-check the address we will create
        address predicted = StdPrecompiles.B20_FACTORY.getB20Address(IB20Factory.B20Variant.ASSET, admin, salt);

        vm.startBroadcast();
        address token = StdPrecompiles.B20_FACTORY.createB20(IB20Factory.B20Variant.ASSET, salt, params, initCalls);
        WorkDistributor dist = new WorkDistributor(presale, token);
        IB20(token).transfer(address(dist), PRESALE_ALLOC);
        vm.stopBroadcast();

        console.log("WORK token (predicted):", predicted);
        console.log("WORK token (created):  ", token);
        console.log("WorkDistributor:       ", address(dist));
        console.log("admin balance:         ", IB20(token).balanceOf(admin));
        console.log("distributor balance:   ", IB20(token).balanceOf(address(dist)));
    }
}
