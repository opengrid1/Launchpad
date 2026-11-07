// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ZappyToken} from "../src/ZappyToken.sol";
import {IZappyHook} from "../src/interfaces/IZappyHook.sol";
import {ZappyBase, ZappyTest} from "./Zappy.t.sol";

/// Stands in for Arbitrum's ArbSys precompile, etched at 0x64. It follows block.number (every vm.roll is a new L2
/// block) until a test pins its own number: then block.number (Ethereum's, on Robinhood Chain) moves without it and
/// it moves alone (the chain's own blocks).
contract MockArbSys {
    uint256 public pinned; // 0: follow block.number

    function pin(uint256 n) external {
        pinned = n;
    }

    function arbBlockNumber() external view returns (uint256) {
        return pinned == 0 ? block.number : pinned;
    }
}

address constant ARB_SYS = address(0x64);

/// Etches MockArbSys at 0x64 and deploys the hook counting blocks with it (Robinhood Chain's deploy).
abstract contract ArbitrumBase is ZappyBase {
    function setUp() public virtual override {
        vm.etch(ARB_SYS, address(new MockArbSys()).code);
        super.setUp();
    }

    function _isArbitrum() internal pure override returns (bool) {
        return true;
    }

    /// The chain's own block number from now on (block.number no longer moves it)
    function _l2Block(uint256 n) internal {
        MockArbSys(ARB_SYS).pin(n);
    }
}

/// Every ZappyTest again with the hook reading its block numbers from ArbSys (which follows block.number here): the
/// Arbitrum path behaves exactly like the plain one when both count the same blocks.
contract ZappyArbitrumTest is ZappyTest {
    function setUp() public override {
        vm.etch(ARB_SYS, address(new MockArbSys()).code);
        super.setUp();
    }

    function _isArbitrum() internal pure override returns (bool) {
        return true;
    }
}

/// Robinhood Chain: block.number is Ethereum's (~12 s) while the chain's own blocks come ~every 100 ms. An Arbitrum
/// hook keys every once-per-block rule on ArbSys.arbBlockNumber(): one raise per pool per L2 block against that L2
/// block's starting tick, whatever block.number does.
contract ArbitrumBlocksTest is ArbitrumBase {
    using PoolIdLibrary for PoolKey;

    function test_isArbitrumFixedAtDeploy() public view {
        assertTrue(hook.isArbitrum());
    }

    /// Many L2 blocks under one block.number: each one's first swap takes that L2 block's starting tick and raises.
    /// Ethereum's block.number moving on inside one L2 block starts nothing new.
    function test_raisesAndReferencesFollowArbBlockNumber() public {
        vm.recordLogs();
        _launchZappy();
        address bob = _user("bob");
        address carol = _user("carol");
        address eve = _user("eve");
        _approve(bob, zappy);
        _approve(carol, zappy);
        _approve(eve, zappy);
        _l2Block(1_000);
        _swap(bob, zappyKey, true, -5 ether, 5 ether); // snipe at 0 s: the pot vests over 10 minutes
        uint256 l1 = vm.getBlockNumber(); // block.number never moves below unless said

        _l2Block(1_001);
        vm.warp(vm.getBlockTimestamp() + 2 minutes);
        int24 start = _tick(zappyKey);
        _swap(eve, zappyKey, true, -10 ether, 10 ether); // pump on L2 block 1001's first swap
        (,,,,, int24 ref, uint64 refBlock, uint64 lastRaise,,,,,,,) = hook.pools(zappyKey.toId());
        assertEq(refBlock, 1_001, "the reference is keyed on the L2 block");
        assertEq(lastRaise, 1_001, "L2 block 1001's first swap raised");
        assertEq(ref, start, "reference = the tick at the L2 block's start, not the pumped one");
        assertEq(hook.startOfBlockTick(zappyKey.toId()), start);
        (int24 f0,,,,) = _pool(zappyKey);

        // Ethereum's block.number moves on inside the same L2 block: no new reference, no new raise
        vm.roll(l1 + 5);
        vm.warp(vm.getBlockTimestamp() + 1);
        _swap(carol, zappyKey, true, -1 ether, 1 ether);
        (,,,,, int24 ref1, uint64 refBlock1, uint64 lastRaise1,,,,,,,) = hook.pools(zappyKey.toId());
        (int24 f1,,,,) = _pool(zappyKey);
        assertEq(refBlock1, 1_001);
        assertEq(lastRaise1, 1_001);
        assertEq(ref1, start, "block.number moving starts no new reference");
        assertEq(f1, f0, "nor a raise");
        assertEq(hook.startOfBlockTick(zappyKey.toId()), start);

        // the next L2 blocks under the same block.number: each first swap takes its own reference and raises
        for (uint256 b = 1_002; b < 1_005; b++) {
            _l2Block(b);
            vm.warp(vm.getBlockTimestamp() + 1);
            int24 next = _tick(zappyKey);
            assertEq(hook.startOfBlockTick(zappyKey.toId()), next, "a new L2 block starts at the current tick");
            _swap(carol, zappyKey, true, -1 ether, 1 ether);
            (,,,,, int24 refN, uint64 refBlockN, uint64 lastRaiseN,,,,,,,) = hook.pools(zappyKey.toId());
            assertEq(refBlockN, b);
            assertEq(refN, next);
            assertEq(lastRaiseN, b, "one raise per L2 block");
        }
        assertEq(vm.getBlockNumber(), l1 + 5, "all under one block.number");
        uint256 raises;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == IZappyHook.FloorRaised.selector) raises++;
            assertTrue(logs[i].topics[0] != IZappyHook.RaiseFailed.selector, "a raise failed silently");
        }
        assertEq(raises, 4, "L2 blocks 1001 to 1004 each raised once");
        _dumpAll(zappyKey, _one(bob));
        _dumpAll(zappyKey, _one(carol));
    }

    /// A buyback is a raise: at most one per pool per L2 block, however many swaps and pokes land in it and however
    /// block.number moves; the next L2 block may buy back again.
    function test_oneBuybackPerArbBlock() public {
        vm.recordLogs();
        _launchZappy();
        address bob = _user("bob");
        address carol = _user("carol");
        _approve(bob, zappy);
        _approve(carol, zappy);
        _l2Block(10);
        _swap(bob, zappyKey, true, -2 ether, 2 ether);
        _l2Block(11);
        vm.warp(vm.getBlockTimestamp() + 61);
        _swap(carol, zappyKey, true, -1 ether, 1 ether);
        _l2Block(12);
        vm.warp(vm.getBlockTimestamp() + 4 minutes);
        _swap(bob, zappyKey, false, -int256(ZappyToken(zappy).balanceOf(bob)), 0); // rug while the snipe tax vests
        _l2Block(13);
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        Vm.Log[] memory drop = vm.getRecordedLogs();
        drop;
        uint256 supply0 = ZappyToken(zappy).totalSupply();
        hook.poke(zappyKey); // buys back
        uint256 supply1 = ZappyToken(zappy).totalSupply();
        assertLt(supply1, supply0, "bought back and burned");
        int24 t1 = _tick(zappyKey);
        for (uint256 i; i < 24; i++) {
            vm.roll(vm.getBlockNumber() + 1); // Ethereum's blocks pass; L2 block 13 doesn't
            if (i % 2 == 0) hook.poke(zappyKey);
            else _swap(carol, zappyKey, true, -0.01 ether, 0.01 ether);
        }
        assertEq(ZappyToken(zappy).totalSupply(), supply1, "no second buyback in the L2 block");
        assertLe(_tick(zappyKey), t1, "only buys moved the price");
        uint256 buybacks;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == IZappyHook.BoughtBack.selector) buybacks++;
            assertTrue(logs[i].topics[0] != IZappyHook.RaiseFailed.selector, "a raise failed silently");
        }
        assertEq(buybacks, 1);
        (,,,,,,, uint64 lastRaise,,,,,,,) = hook.pools(zappyKey.toId());
        assertEq(lastRaise, 13);
        _dumpAll(zappyKey, _one(carol));
    }

    /// The factory's $ZAPPY-pair start band measures against the $ZAPPY pool's start-of-block tick, so it follows the L2
    /// block too: a pump inside an L2 block doesn't move it, block.number moving doesn't either, the next L2 block does
    function test_startBandFollowsArbBlockNumber() public {
        _launchZappy();
        vm.warp(vm.getBlockTimestamp() + 61);
        address bob = _user("bob");
        _l2Block(500);
        (int24 low0, int24 high0) = factory.startTickRange(zappy);
        _swap(bob, zappyKey, true, -20 ether, 20 ether); // moves $ZAPPY's tick
        (int24 low1, int24 high1) = factory.startTickRange(zappy);
        assertEq(low1, low0, "a pump inside the L2 block doesn't move the band");
        assertEq(high1, high0);
        vm.roll(vm.getBlockNumber() + 3);
        (low1, high1) = factory.startTickRange(zappy);
        assertEq(low1, low0, "nor does block.number");
        _l2Block(501);
        (int24 low2,) = factory.startTickRange(zappy);
        int24 moved = _tick(zappyKey) - hook.startOfBlockTick(zappyKey.toId());
        assertEq(moved, 0, "the next L2 block starts at the current tick");
        assertTrue(low2 != low0, "the next L2 block measures against the pumped price");
    }

    /// An Arbitrum hook never falls back to block.number: without ArbSys (no code at 0x64) every swap and the
    /// start-of-block view revert
    function test_withoutArbSysItReverts() public {
        _launchZappy();
        vm.warp(vm.getBlockTimestamp() + 61);
        address bob = _user("bob");
        vm.etch(ARB_SYS, "");
        (bool ok,) = address(this).call(abi.encodeCall(this.swapExt, (bob, zappyKey)));
        assertFalse(ok, "a swap reverts");
        vm.expectRevert();
        hook.startOfBlockTick(zappyKey.toId());
    }

    function swapExt(address who, PoolKey memory key) external {
        _swap(who, key, true, -1 ether, 1 ether);
    }

}

/// A hook deployed for any other chain counts block.number and never reads 0x64, whatever is there
contract PlainBlocksTest is ZappyBase {
    using PoolIdLibrary for PoolKey;

    function test_plainHookIgnoresArbSys() public {
        vm.etch(ARB_SYS, address(new MockArbSys()).code);
        MockArbSys(ARB_SYS).pin(77_777);
        assertFalse(hook.isArbitrum());
        _launchZappy();
        vm.warp(vm.getBlockTimestamp() + 61);
        vm.roll(vm.getBlockNumber() + 1);
        address bob = _user("bob");
        _swap(bob, zappyKey, true, -1 ether, 1 ether);
        (,,,,,, uint64 refBlock,,,,,,,,) = hook.pools(zappyKey.toId());
        assertEq(refBlock, vm.getBlockNumber());
        vm.etch(ARB_SYS, ""); // nothing there: still fine
        vm.roll(vm.getBlockNumber() + 1);
        _swap(bob, zappyKey, true, -1 ether, 1 ether);
        (,,,,,, refBlock,,,,,,,,) = hook.pools(zappyKey.toId());
        assertEq(refBlock, vm.getBlockNumber());
    }
}
