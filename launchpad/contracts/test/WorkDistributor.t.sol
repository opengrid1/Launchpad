// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {WorkPresale} from "../src/WorkPresale.sol";
import {WorkDistributor} from "../src/WorkDistributor.sol";
import {MockB20} from "../src/mocks/MockB20.sol";

contract WorkDistributorTest is Test {
    WorkPresale presale;
    WorkDistributor dist;
    MockB20 token;

    address proceeds = makeAddr("proceeds");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 constant PRICE = 40_000_000_000;

    function setUp() public {
        presale = new WorkPresale(proceeds, 5 ether, 10 ether, PRICE);

        _contribute(alice, 1 ether); // 25,000,000 WORK
        _contribute(bob, 0.5 ether); // 12,500,000 WORK
        _contribute(carol, 0.1 ether); // 2,500,000 WORK

        token = new MockB20();
        dist = new WorkDistributor(address(presale), address(token));
    }

    function _contribute(address who, uint256 amt) internal {
        vm.deal(who, amt);
        vm.prank(who);
        presale.contribute{value: amt}();
    }

    function test_totalOwed() public view {
        assertEq(dist.totalOwed(), 40_000_000e18);
    }

    function test_distribute_all() public {
        token.mint(address(dist), dist.totalOwed());
        presale.close();

        dist.distribute(100);

        assertEq(token.balanceOf(alice), 25_000_000e18);
        assertEq(token.balanceOf(bob), 12_500_000e18);
        assertEq(token.balanceOf(carol), 2_500_000e18);
        assertTrue(dist.finished());
        assertEq(token.balanceOf(address(dist)), 0);
    }

    function test_distribute_batched() public {
        token.mint(address(dist), dist.totalOwed());
        presale.close();

        dist.distribute(2);
        assertEq(token.balanceOf(alice), 25_000_000e18);
        assertEq(token.balanceOf(bob), 12_500_000e18);
        assertEq(token.balanceOf(carol), 0);
        assertFalse(dist.finished());

        dist.distribute(2);
        assertEq(token.balanceOf(carol), 2_500_000e18);
        assertTrue(dist.finished());
    }

    function test_requires_presale_closed() public {
        token.mint(address(dist), dist.totalOwed());
        vm.expectRevert(bytes("presale open"));
        dist.distribute(100);
    }

    function test_finished_blocks_further_distribute() public {
        token.mint(address(dist), dist.totalOwed());
        presale.close();
        dist.distribute(100);
        vm.expectRevert(bytes("finished"));
        dist.distribute(100);
    }

    function test_only_owner_distributes() public {
        token.mint(address(dist), dist.totalOwed());
        presale.close();
        vm.prank(alice);
        vm.expectRevert(bytes("not owner"));
        dist.distribute(100);
    }

    function test_sweep_leftover() public {
        token.mint(address(dist), dist.totalOwed() + 1_000e18);
        presale.close();
        dist.distribute(100);
        dist.sweep(proceeds);
        assertEq(token.balanceOf(proceeds), 1_000e18);
    }
}
