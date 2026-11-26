// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IZappyHook} from "../src/interfaces/IZappyHook.sol";
import {ZappyToken} from "../src/ZappyToken.sol";
import {ZappyBase} from "./Zappy.t.sol";

/// Zappy fork: the hook owner's collectFloor. Only the owner, 1..10,000 bps, pays the pair out of the band and the pot.
/// What is left of the band goes back in lower, where it still buys back every circulating token, so every holder can
/// still sell into the floor right after a collect, and the pool keeps trading and raising its floor afterwards.
contract AdminCollectTest is ZappyBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

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

    function _tickB(PoolKey memory key) internal view returns (int24 tickB) {
        (,,,,,,,,,,,,,,, tickB) = hook.pools(key.toId());
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

    /// Half the floor out: the band moves to a lower floor that still covers every holder, so a full exit stays inside
    /// it; later raises put the band back on tranche 0's top and move the floor up again.
    function test_collectHalfKeepsEveryHolderCovered() public {
        address bob = _buildFloor();
        (int24 tickF, uint256 pot,,, uint128 band) = _pool(zappyKey);
        assertGt(band, 0, "a floor band was built");
        assertEq(_tickB(zappyKey), tickF, "the band sits on tranche 0's top");
        (, uint160 worst0,) = hook.floorOf(zappyKey);
        address to = makeAddr("treasury");

        hook.collectFloor(zappyKey, 5_000, to);
        (int24 tickF1, uint256 pot1,,, uint128 band1) = _pool(zappyKey);
        assertGt(to.balance, 0, "half the floor paid out in ETH");
        assertEq(pot1, pot - pot * 5_000 / 10_000, "half the pot removed");
        assertEq(tickF1, tickF, "tranche 0's top does not move");
        int24 tickB1 = _tickB(zappyKey);
        assertGt(tickB1, tickF, "the band moved to a lower floor");
        assertGt(band1, 0, "a band was put back");
        (int24 floorTick, uint160 worst1,) = hook.floorOf(zappyKey);
        assertEq(floorTick, tickB1, "floorOf reports the band");
        assertGt(worst1, worst0, "the worst-case price is lower now");

        // every holder sells: the price never falls past the band's far edge
        _dumpAll(zappyKey, _one(bob));
        (, int24 tickAfter,,) = pm.getSlot0(zappyKey.toId());
        assertLe(tickAfter, tickB1 + 60, "the exit stayed inside the floor");

        // trading resumes and a raise puts the band back on tranche 0's top, above where the collect left it
        for (uint256 i; i < 6; i++) {
            vm.roll(vm.getBlockNumber() + 1);
            vm.warp(vm.getBlockTimestamp() + 20 minutes);
            _swap(bob, zappyKey, true, -1 ether, 1 ether);
        }
        vm.roll(vm.getBlockNumber() + 1);
        hook.poke(zappyKey);
        (int24 tickF2,,,, uint128 band2) = _pool(zappyKey);
        assertGt(band2, 0, "the floor keeps a band");
        assertEq(_tickB(zappyKey), tickF2, "the band is back on tranche 0's top");
        assertLt(tickF2, tickB1, "the floor is higher than right after the collect");
    }

    /// Everything out: no band is left. Trading goes on and the tax refills the pot; a band comes back only once the
    /// pot can carry every holder again.
    function test_collectAllLeavesNoBandUntilThePotCanCarryEveryone() public {
        address bob = _buildFloor();
        address to = makeAddr("treasury");
        hook.collectFloor(zappyKey, 10_000, to);
        (int24 tickF, uint256 pot,,, uint128 band) = _pool(zappyKey);
        assertEq(band, 0, "band emptied");
        assertEq(pot, 0, "pot emptied");
        assertGt(to.balance, 0, "paid out");
        assertEq(_tickB(zappyKey), tickF, "no band to move");

        for (uint256 i; i < 5; i++) {
            vm.roll(vm.getBlockNumber() + 1);
            vm.warp(vm.getBlockTimestamp() + 20 minutes);
            _swap(bob, zappyKey, true, -1 ether, 1 ether);
        }
        vm.roll(vm.getBlockNumber() + 1);
        hook.poke(zappyKey);
        (, uint256 pot3,,, uint128 band3) = _pool(zappyKey);
        assertGt(pot3, 0, "the tax refills the pot");
        assertEq(band3, 0, "a few trades' tax can't yet carry every holder: no band");
        // selling still works into tranche 0's quote over the price; a whole exit has no band to land on until one is
        // rebuilt (the swap reverts PartialFill instead of leaving a holder short)
        uint256 bal = ZappyToken(zappy).balanceOf(bob);
        _swap(bob, zappyKey, false, -int256(bal / 10), 0);
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
