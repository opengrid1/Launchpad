// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {WorkPresale} from "../src/WorkPresale.sol";

contract WorkPresaleTest is Test {
    WorkPresale presale;
    address proceeds = makeAddr("proceeds");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant PRICE = 40_000_000_000; // 0.00000004 ETH per WORK

    function setUp() public {
        presale = new WorkPresale(proceeds, 5 ether, 10 ether, PRICE);
    }

    function test_contribute_records_and_forwards() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        presale.contribute{value: 1 ether}();

        assertEq(presale.contributed(alice), 1 ether);
        assertEq(presale.totalRaised(), 1 ether);
        assertEq(presale.contributorsCount(), 1);
        // ETH forwarded straight to the project wallet, nothing held here
        assertEq(proceeds.balance, 1 ether);
        assertEq(address(presale).balance, 0);
        // 1 ETH / 0.00000004 = 25,000,000 WORK
        assertEq(presale.tokensOwed(alice), 25_000_000e18);
    }

    function test_dedupes_contributors() public {
        vm.deal(alice, 2 ether);
        vm.startPrank(alice);
        presale.contribute{value: 1 ether}();
        presale.contribute{value: 1 ether}();
        vm.stopPrank();

        assertEq(presale.contributorsCount(), 1);
        assertEq(presale.contributed(alice), 2 ether);
        assertEq(presale.tokensOwed(alice), 50_000_000e18);
    }

    function test_receive_routes_to_contribute() public {
        vm.deal(bob, 0.5 ether);
        vm.prank(bob);
        (bool ok,) = address(presale).call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(presale.contributed(bob), 0.5 ether);
        assertEq(proceeds.balance, 0.5 ether);
    }

    function test_hard_cap_enforced() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        presale.contribute{value: 10 ether}();
        assertEq(presale.totalRaised(), 10 ether);

        vm.deal(bob, 1);
        vm.prank(bob);
        vm.expectRevert(bytes("hard cap"));
        presale.contribute{value: 1}();
    }

    function test_soft_cap_flag() public {
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        presale.contribute{value: 5 ether}();
        assertTrue(presale.softCapReached());
    }

    function test_zero_reverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("zero"));
        presale.contribute{value: 0}();
    }

    function test_close_blocks_contribute() public {
        presale.close();
        assertTrue(presale.closed());
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("closed"));
        presale.contribute{value: 1 ether}();
    }

    function test_only_owner_can_close() public {
        vm.prank(alice);
        vm.expectRevert(bytes("not owner"));
        presale.close();
    }
}
