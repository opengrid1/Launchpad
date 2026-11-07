// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IZappyHook} from "../src/interfaces/IZappyHook.sol";
import {ZappyBase} from "./Zappy.t.sol";

/// Zappy fork: the hook owner's collectFloor. Only the owner, 1..10,000 bps, pays the pair out of the band and the pot,
/// and the pool keeps trading and raising its floor afterwards.
contract AdminCollectTest is ZappyBase {
    function _buildFloor() internal returns (address bob) {
        _launchZappy();
        bob = _user("bob");
        _approve(bob, zappy);
        _swap(bob, zappyKey, true, -5 ether, 5 ether);
        for (uint256 i; i < 10; i++) {
            vm.roll(vm.getBlockNumber() + 1);
            vm.warp(vm.getBlockTimestamp() + 20 minutes);
            _swap(bob, zappyKey, true, -0.5 ether, 0.5 ether);
        }
        vm.roll(vm.getBlockNumber() + 1);
        hook.poke(zappyKey);
    }

    function test_onlyOwnerCollects() public {
        _buildFloor();
        address eve = makeAddr("eve");
        vm.prank(eve);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, eve));
        hook.collectFloor(zappyKey, 10_000, eve);
    }

    function test_badArgs() public {
        _buildFloor();
        vm.expectRevert(IZappyHook.BadBps.selector);
        hook.collectFloor(zappyKey, 0, address(this));
        vm.expectRevert(IZappyHook.BadBps.selector);
        hook.collectFloor(zappyKey, 10_001, address(this));
        vm.expectRevert(IZappyHook.ZeroAddress.selector);
        hook.collectFloor(zappyKey, 5_000, address(0));
        PoolKey memory unknown = hook.keyFor(address(0), address(0xBEEF));
        vm.expectRevert(IZappyHook.UnknownPool.selector);
        hook.collectFloor(unknown, 5_000, address(this));
    }

    function test_collectHalfThenAllAndTradingGoesOn() public {
        address bob = _buildFloor();
        (int24 tickF, uint256 pot,,, uint128 band) = _pool(zappyKey);
        assertGt(band, 0, "a floor band was built");
        address to = makeAddr("treasury");

        hook.collectFloor(zappyKey, 5_000, to);
        (, uint256 pot1,,, uint128 band1) = _pool(zappyKey);
        uint256 got1 = to.balance;
        assertGt(got1, 0, "half the floor paid out in ETH");
        assertEq(band1, band - uint128(uint256(band) * 5_000 / 10_000), "half the band removed");
        assertEq(pot1, pot - pot * 5_000 / 10_000, "half the pot removed");

        hook.collectFloor(zappyKey, 10_000, to);
        (int24 tickF2, uint256 pot2,,, uint128 band2) = _pool(zappyKey);
        assertEq(band2, 0, "band emptied");
        assertEq(pot2, 0, "pot emptied");
        assertEq(tickF2, tickF, "collect does not move the floor tick");
        assertGt(to.balance, got1, "the rest paid out");

        // the pool still trades both ways and the tax rebuilds a floor
        for (uint256 i; i < 5; i++) {
            vm.roll(vm.getBlockNumber() + 1);
            vm.warp(vm.getBlockTimestamp() + 20 minutes);
            _swap(bob, zappyKey, true, -1 ether, 1 ether);
        }
        vm.roll(vm.getBlockNumber() + 1);
        hook.poke(zappyKey);
        (,,,, uint128 band3) = _pool(zappyKey);
        assertGt(band3, 0, "the floor rebuilds from new tax");
        _dumpAll(zappyKey, _one(bob));
    }

    function test_ownershipIsTwoStep() public {
        address admin = makeAddr("admin");
        hook.transferOwnership(admin);
        assertEq(hook.owner(), address(this), "still the old owner until accepted");
        vm.prank(admin);
        hook.acceptOwnership();
        assertEq(hook.owner(), admin, "new owner");
    }
}
