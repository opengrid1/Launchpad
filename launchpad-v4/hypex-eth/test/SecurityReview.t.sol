// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {HypexToken} from "../src/HypexToken.sol";
import {IHypexFactory} from "../src/interfaces/IHypexFactory.sol";
import {IHypexHook} from "../src/interfaces/IHypexHook.sol";
import {HypexBase} from "./Hypex.t.sol";

/// Additional adversarial coverage from the October 2026 source review. No mocked pool accounting.
contract SecurityReviewTest is HypexBase {
    using PoolIdLibrary for PoolKey;

    function test_startBandRejectsTicksAboveHookRange() public {
        vm.expectRevert(IHypexFactory.BadTick.selector);
        factory.setStartBand(887220, 887280);
    }

    function test_quoteBandRejectsTicksAboveHookRange() public {
        vm.expectRevert(IHypexFactory.BadTick.selector);
        factory.setQuoteBand(makeAddr("quote"), 887220, 887280);
    }

    function test_startBandMustContainAnAlignedTick() public {
        vm.expectRevert(IHypexFactory.BadTick.selector);
        factory.setStartBand(193801, 193859);
        // Negative division must also round toward minus infinity.
        vm.expectRevert(IHypexFactory.BadTick.selector);
        factory.setQuoteBand(makeAddr("quote"), -59, -1);
    }

    function test_validNarrowAndBoundaryBands() public {
        factory.setStartBand(193799, 193801);
        factory.setStartBand(-54780, -54779);
        factory.setStartBand(887159, 887160);
        factory.setQuoteBand(makeAddr("quote"), -61, -59);
    }

    function test_callbacksAndHookClaimsRejectForgedCallers() public {
        _launchHypex();
        address attacker = _user("callback attacker");
        _swap(attacker, hypexKey, true, -1 ether, 1 ether);
        bytes4 notManager = bytes4(keccak256("NotPoolManager()"));
        vm.startPrank(attacker);
        vm.expectRevert(notManager);
        factory.unlockCallback("");
        vm.expectRevert(notManager);
        hook.unlockCallback("");
        vm.expectRevert(notManager);
        revenue.unlockCallback("");
        vm.expectRevert(notManager);
        limitOrders.unlockCallback("");
        vm.expectRevert(IHypexHook.NotSelf.selector);
        hook.raiseFromHook(hypexKey);
        vm.expectRevert(IHypexHook.NotFactory.selector);
        hook.endLaunch();
        vm.expectRevert();
        pm.transferFrom(address(hook), attacker, 0, 1);
        vm.expectRevert();
        pm.transferFrom(address(revenue), attacker, 0, 1);
        vm.stopPrank();
        _assertEthClaims();
    }

    function test_productionRuntimeCodeFitsEip170() public view {
        assertLe(address(factory).code.length, 24576);
        assertLe(address(hook).code.length, 24576);
        assertLe(address(revenue).code.length, 24576);
        assertLe(address(limitOrders).code.length, 24576);
    }

    /// Holders burning their own tokens, direct token donations and Uniswap's optional protocol fees must not
    /// strand other holders. Protocol tokens stay circulating until their recipient exits or burns them.
    function testFuzz_holderBurnsDonationsAndProtocolFees(uint256 seed) public {
        _launchHypex();
        address alice = _user("burner");
        address bob = _user("survivor");
        address collector = _user("protocol collector");
        pm.setProtocolFeeController(address(this));
        uint24 fee = uint24(seed % 1001); // v4 maximum: 1000 pips per direction
        pm.setProtocolFee(hypexKey, fee | (fee << 12));
        vm.recordLogs();
        _swap(alice, hypexKey, true, -2 ether, 2 ether);
        _swap(bob, hypexKey, true, -1 ether, 1 ether);
        uint256 bag = HypexToken(hypex).balanceOf(alice);
        uint256 burned = bag * ((seed >> 16) % 10001) / 10000;
        vm.prank(alice);
        HypexToken(hypex).burn(burned);
        uint256 donated = (bag - burned) / 7;
        vm.prank(alice);
        HypexToken(hypex).transfer(address(hook), donated);
        int24 lastFloor;
        (lastFloor,,) = hook.floorOf(hypexKey);
        for (uint256 i; i < 12; i++) {
            vm.roll(vm.getBlockNumber() + 1);
            vm.warp(vm.getBlockTimestamp() + 61);
            hook.poke(hypexKey);
            (int24 next,,) = hook.floorOf(hypexKey);
            assertLe(next, lastFloor, "floor may only rise");
            lastFloor = next;
        }
        uint256 left = HypexToken(hypex).balanceOf(alice);
        if (left != 0) _swap(alice, hypexKey, false, -int256(left), 0);
        _swap(bob, hypexKey, false, -int256(HypexToken(hypex).balanceOf(bob)), 0);
        pm.collectProtocolFees(collector, Currency.wrap(hypex), 0);
        // Turn the fee off to close out the collector without leaving a new residual protocol balance.
        pm.setProtocolFee(hypexKey, 0);
        uint256 collected = HypexToken(hypex).balanceOf(collector);
        if (collected != 0) _swap(collector, hypexKey, false, -int256(collected), 0);
        assertLe(_tick(hypexKey), lastFloor + 60, "all sellable tokens exit within floor");
        assertEq(HypexToken(hypex).balanceOf(address(hook)), donated, "donations cannot be stolen");
        _assertEthClaims();
        _assertNoFailures();
    }

    /// Holding output as v4 claims (and later paying with claims) must not hide circulating supply from the floor.
    function test_claimBalancesRemainBackedAndCanExit() public {
        _launchHypex();
        address alice = _user("claims trader");
        vm.warp(vm.getBlockTimestamp() + 61);
        vm.prank(alice, alice);
        BalanceDelta buy = router.swap{value: 1 ether}(
            hypexKey,
            IPoolManager.SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(true, false),
            ""
        );
        uint256 tokens = uint256(int256(buy.amount1()));
        assertEq(HypexToken(hypex).balanceOf(alice), 0);
        assertEq(pm.balanceOf(alice, uint160(hypex)), tokens);
        vm.roll(vm.getBlockNumber() + 1);
        hook.poke(hypexKey);
        (int24 floor,, uint256 circulating) = hook.floorOf(hypexKey);
        assertGe(circulating, tokens, "claim holders are circulating");
        vm.prank(alice);
        pm.setOperator(address(router), true);
        vm.prank(alice, alice);
        router.swap(
            hypexKey,
            IPoolManager.SwapParams(false, -int256(tokens), TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings(false, true),
            ""
        );
        assertEq(pm.balanceOf(alice, uint160(hypex)), 0);
        assertLe(_tick(hypexKey), floor + 60);
        _assertEthClaims();
    }

    function _assertEthClaims() internal view {
        (,,,,,,,, uint128 snipe, uint128 released,,, uint256 pot, uint256 creator,,) = hook.pools(hypexKey.toId());
        Currency eth = Currency.wrap(address(0));
        assertEq(
            pm.balanceOf(address(hook), 0),
            pot + snipe - released + creator + hook.teamOwed(eth),
            "hook ETH claims cover exactly its obligations"
        );
        assertEq(pm.balanceOf(address(revenue), 0), revenue.owed(team, address(0)));
    }

    function _assertNoFailures() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(hook) || logs[i].topics.length == 0) continue;
            assertTrue(logs[i].topics[0] != IHypexHook.RaiseFailed.selector, "raise must not silently fail");
            assertTrue(logs[i].topics[0] != IHypexHook.CreditFailed.selector, "credit must not silently fail");
        }
    }
}
