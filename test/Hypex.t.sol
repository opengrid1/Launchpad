// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Hypex} from "../src/Hypex.sol";

contract MockSPCX {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        balanceOf[f] -= a;
        balanceOf[t] += a;
        return true;
    }
}

contract HypexTest is Test {
    Hypex hypex;
    MockSPCX spcx;

    address deployer = address(this);
    address pool = address(0xC0FFEE);
    address buyback = address(0xB0B);
    address alice = address(0xA11CE);
    address bob = address(0xB0B0);

    uint256 constant SUPPLY = 10_000 ether;

    function setUp() public {
        spcx = new MockSPCX();
        hypex = new Hypex(SUPPLY, address(spcx), deployer);
        // distribute supply: alice + bob hold, pool holds the rest (excluded)
        hypex.transfer(alice, 2_000 ether);
        hypex.transfer(bob, 1_000 ether);
        hypex.transfer(pool, 7_000 ether);
        hypex.excludeFromRewards(pool, true); // V3 pool out of denominator
        hypex.excludeFromRewards(deployer, true); // deployer holds nothing now, but be safe
        // eligible = alice 2000 + bob 1000 = 3000
        // buyback gets SPCX to distribute
        spcx.mint(buyback, 1_000_000 ether);
        vm.prank(buyback);
        spcx.approve(address(hypex), type(uint256).max);
    }

    function _distribute(uint256 amt) internal {
        vm.prank(buyback);
        hypex.distribute(amt);
    }

    function test_eligibleSupplyExcludesPool() public view {
        assertEq(hypex.eligibleSupply(), 3_000 ether);
    }

    function test_distributeProRata() public {
        _distribute(300 ether); // over eligible 3000 -> 0.1 SPCX per HYPEX
        assertApproxEqAbs(hypex.withdrawableSpcx(alice), 200 ether, 1e6); // 2000 * .1
        assertApproxEqAbs(hypex.withdrawableSpcx(bob), 100 ether, 1e6); // 1000 * .1
        assertEq(hypex.withdrawableSpcx(pool), 0); // excluded
    }

    function test_claim() public {
        _distribute(300 ether);
        uint256 owed = hypex.withdrawableSpcx(alice);
        assertGt(owed, 0);
        vm.prank(alice);
        hypex.claim();
        assertEq(spcx.balanceOf(alice), owed);
        assertEq(hypex.withdrawableSpcx(alice), 0);
    }

    function test_poolEarnsNothing() public {
        _distribute(500 ether);
        assertEq(hypex.withdrawableSpcx(pool), 0);
        vm.prank(pool);
        vm.expectRevert(bytes("nothing to claim"));
        hypex.claim();
    }

    function test_earnedSurvivesTransfer() public {
        _distribute(300 ether);
        uint256 owed = hypex.withdrawableSpcx(alice);
        assertGt(owed, 0);
        // alice sends all HYPEX to bob; her accrued SPCX must remain
        uint256 bal = hypex.balanceOf(alice);
        vm.prank(alice);
        hypex.transfer(bob, bal);
        assertApproxEqAbs(hypex.withdrawableSpcx(alice), owed, 1e6);
    }

    function test_newHolderDoesNotGetPastRewards() public {
        _distribute(300 ether); // alice/bob accrue
        // bob transfers to a fresh holder; fresh holder shouldn't claim past distro
        vm.prank(bob);
        hypex.transfer(address(0xFEED), 500 ether);
        assertEq(hypex.withdrawableSpcx(address(0xFEED)), 0);
    }

    function test_secondDistributionSplitsByCurrentBalances() public {
        _distribute(300 ether); // alice 200, bob 100
        // bob doubles his stake by buying from alice
        vm.prank(alice);
        hypex.transfer(bob, 1_000 ether); // alice 1000, bob 2000
        _distribute(300 ether); // now per-share over 3000 again: alice +100, bob +200
        assertApproxEqAbs(hypex.withdrawableSpcx(alice), 300 ether, 1e7); // 200 + 100
        assertApproxEqAbs(hypex.withdrawableSpcx(bob), 300 ether, 1e7); // 100 + 200
    }

    function test_excludeAfterHoldingStopsAccrual() public {
        _distribute(300 ether);
        uint256 before = hypex.withdrawableSpcx(alice);
        hypex.excludeFromRewards(alice, true); // now excluded
        _distribute(300 ether); // alice should not gain from this one
        assertApproxEqAbs(hypex.withdrawableSpcx(alice), 0, 0); // excluded -> view returns 0
        // re-include and she resumes (but keeps nothing from the excluded window)
        hypex.excludeFromRewards(alice, false);
        assertApproxEqAbs(hypex.withdrawableSpcx(alice), before, 1e7);
    }

    function test_onlyOwnerExcludeAndRenounce() public {
        vm.prank(alice);
        vm.expectRevert(bytes("not owner"));
        hypex.excludeFromRewards(bob, true);
        hypex.renounceOwnership();
        assertEq(hypex.owner(), address(0));
        vm.expectRevert(bytes("not owner"));
        hypex.excludeFromRewards(bob, true);
    }
}
