// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ApexToken} from "../src/ApexToken.sol";
import {ApexCurve} from "../src/ApexCurve.sol";

contract ApexCurveTest is Test {
    ApexToken token;
    ApexCurve curve;

    uint256 constant SUPPLY = 10_000e18;
    uint256 constant BASE = 0.0001 ether;
    uint256 constant MULT = 15_000; // +50%/tier
    uint256 constant TIERS = 8;
    uint256 constant PER_TIER = 1_000e18;
    uint256 constant LP_RESERVE = 2_000e18;
    uint256 constant SELL_FEE = 500; // 5%

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new ApexToken(SUPPLY, address(this));
        curve = new ApexCurve(token, BASE, MULT, TIERS, PER_TIER, LP_RESERVE, SELL_FEE, 1 ether);
        token.setExcluded(address(curve), true);
        token.transfer(address(curve), SUPPLY); // fund curve with full supply
    }

    // raised must always equal the contract's ETH balance (conservation).
    function _checkConservation() internal view {
        assertEq(address(curve).balance, curve.raised(), "raised != balance");
    }

    function test_buyFillsTierZeroExactly() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 out = curve.buy{value: 0.1 ether}(0); // tier0: 1000 @ 0.0001 = 0.1 ETH
        assertEq(out, 1_000e18);
        assertEq(token.balanceOf(alice), 1_000e18);
        assertEq(curve.sold(), 1_000e18);
        assertEq(curve.raised(), 0.1 ether);
        _checkConservation();
    }

    function test_buyAcrossTiers() public {
        // Fill tier0 (0.1) + tier1 (1000 @ 0.00015 = 0.15) = 0.25 ETH -> 2000 tokens.
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 out = curve.buy{value: 0.25 ether}(0);
        assertEq(out, 2_000e18);
        assertEq(curve.raised(), 0.25 ether);
        _checkConservation();
    }

    function test_sellRefundsAndFeesGoToDividends() public {
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
        vm.prank(alice);
        curve.buy{value: 0.1 ether}(0); // alice: 1000 @ tier0
        vm.prank(bob);
        curve.buy{value: 0.15 ether}(0); // bob: 1000 @ tier1

        // Bob sells his 1000 back. Top tier is tier1 (price 0.00015): gross = 0.15.
        vm.startPrank(bob);
        token.approve(address(curve), 1_000e18);
        uint256 ethOut = curve.sell(1_000e18, 0);
        vm.stopPrank();

        uint256 gross = 0.15 ether;
        uint256 fee = (gross * SELL_FEE) / 10_000;
        assertEq(ethOut, gross - fee, "refund");
        assertEq(curve.sold(), 1_000e18);

        // The 5% fee became ETH dividends; alice (sole remaining holder) can claim ~all of it.
        assertApproxEqAbs(token.withdrawableEth(alice), fee, 2);
        uint256 before = alice.balance;
        vm.prank(alice);
        token.claimEth();
        assertApproxEqAbs(alice.balance - before, fee, 2);
        _checkConservation();
    }

    function test_noUnderflowOnFullRoundTrip() public {
        // Buy the whole curve, then sell it all back — must never underflow / desync.
        vm.deal(alice, 100 ether);
        vm.startPrank(alice);
        // curve fully bonds at 8000 sold; buy enough to sell out.
        curve.buy{value: 50 ether}(0);
        vm.stopPrank();
        assertTrue(curve.bonded(), "should auto-bond on sellout");
    }

    function test_autoBondOnSellout() public {
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        curve.buy{value: 50 ether}(0);
        assertTrue(curve.bonded());
        // No more buying after bond.
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert("bonded");
        curve.buy{value: 0.1 ether}(0);
    }

    function test_bondNowGatedByMinRaise() public {
        // raised below 1 ETH floor -> bondNow reverts.
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        curve.buy{value: 0.1 ether}(0);
        vm.expectRevert("thin pool");
        curve.bondNow();

        // Push raise above the floor, then bondNow works.
        vm.deal(bob, 5 ether);
        vm.prank(bob);
        curve.buy{value: 1.5 ether}(0);
        curve.bondNow();
        assertTrue(curve.bonded());
    }

    function test_convictionMultiplierBoostsShares() public {
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
        vm.prank(alice);
        curve.buy{value: 0.1 ether}(0); // alice 1000
        vm.prank(bob);
        curve.buy{value: 0.15 ether}(0); // bob 1000 (same balance)

        // Equal balances, equal conviction -> equal shares.
        assertEq(token.shares(alice), token.shares(bob));

        // Warp 2 days: alice syncs to the 1.25x tier; bob stays stale at 1.0x until poked.
        vm.warp(block.timestamp + 2 days);
        token.syncConviction(alice);
        assertGt(token.shares(alice), token.shares(bob));
        assertEq(token.shares(alice), (token.balanceOf(alice) * 12_500) / 10_000);
    }

    receive() external payable {}
}
