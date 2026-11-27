// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {KinetiqPumpToken} from "../src/KinetiqPumpToken.sol";

/// EIP-1167 minimal proxy, as the factory will deploy them
library Clones {
    function clone(address impl) internal returns (address inst) {
        assembly {
            mstore(0x00, or(shr(0xe8, shl(0x60, impl)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            mstore(0x20, or(shl(0x78, impl), 0x5af43d82803e903d91602b57fd5bf3))
            inst := create(0, 0x09, 0x37)
        }
        require(inst != address(0), "clone");
    }
}

/// The token on its own: this test is the factory (it deploys the implementation) and plays the payout contract.
contract KinetiqPumpTokenTest is Test {
    KinetiqPumpToken impl;
    KinetiqPumpToken t;
    address payout = makeAddr("payout");
    address creator = makeAddr("creator");
    address pm = makeAddr("poolManager");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    uint256 constant SUPPLY = 1_000_000_000e18;

    function setUp() public {
        impl = new KinetiqPumpToken();
        t = KinetiqPumpToken(Clones.clone(address(impl)));
        t.initialize("Loot", "LOOT", SUPPLY, payout, creator);
        t.exclude(pm);
        t.transfer(pm, SUPPLY); // the factory puts the supply in the pool (the launch transaction)
        vm.roll(block.number + 1); // trading starts in the next block
    }

    function _buy(address who, uint256 amount) internal {
        vm.prank(pm);
        t.transfer(who, amount);
    }

    function _reward(uint256 amount) internal {
        vm.prank(payout);
        t.addReward(amount);
    }

    function test_onlyHoldersOutsideThePoolEarn() public {
        _buy(alice, 300e18);
        _buy(bob, 100e18);
        assertEq(t.eligibleSupply(), 400e18);
        _reward(4 ether);
        assertEq(t.earned(alice), 3 ether);
        assertEq(t.earned(bob), 1 ether);
        assertEq(t.earned(pm), 0);
        assertEq(t.earned(creator), 0);
    }

    function test_rewardsFollowBalancesThroughTransfers() public {
        _buy(alice, 100e18);
        _reward(1 ether); // alice alone
        vm.prank(alice);
        t.transfer(bob, 50e18);
        _reward(1 ether); // half each
        assertEq(t.earned(alice), 1.5 ether);
        assertEq(t.earned(bob), 0.5 ether);
        // selling everything keeps what was earned, earns nothing after
        vm.prank(alice);
        t.transfer(pm, 50e18);
        _reward(1 ether);
        assertEq(t.earned(alice), 1.5 ether);
        assertEq(t.earned(bob), 1.5 ether);
    }

    function test_launchBlockBuyersNeverEarn() public {
        KinetiqPumpToken t2 = KinetiqPumpToken(Clones.clone(address(impl)));
        t2.initialize("Snipe", "SNP", SUPPLY, payout, creator);
        t2.transfer(pm, SUPPLY);
        vm.prank(pm);
        t2.transfer(alice, 1000e18); // a sniper in the launch block
        vm.roll(block.number + 1);
        vm.prank(pm);
        t2.transfer(bob, 1000e18);
        assertTrue(t2.excluded(alice));
        assertFalse(t2.excluded(bob));
        vm.prank(payout);
        t2.addReward(1 ether);
        assertEq(t2.earned(alice), 0);
        assertEq(t2.earned(bob), 1 ether);
        // the sniper keeps and trades their coins, they just never earn
        vm.prank(alice);
        t2.transfer(carol, 500e18);
        vm.prank(payout);
        t2.addReward(1 ether);
        assertEq(t2.earned(carol), uint256(1 ether) / 3);
        assertEq(t2.earned(alice), 0);
    }

    function test_creatorNeverEarns() public {
        _buy(creator, 100e18);
        _buy(alice, 100e18);
        _reward(1 ether);
        assertEq(t.earned(creator), 0);
        assertEq(t.earned(alice), 1 ether);
    }

    function test_rewardWaitsWhenNobodyHolds() public {
        _reward(1 ether);
        assertEq(t.pendingReward(), 1 ether);
        _buy(alice, 10e18);
        _reward(1 ether);
        assertEq(t.earned(alice), 2 ether);
    }

    function test_takeZeroesAndOnlyPayout() public {
        _buy(alice, 10e18);
        _reward(1 ether);
        vm.expectRevert(KinetiqPumpToken.NotPayout.selector);
        t.take(alice);
        vm.prank(payout);
        assertEq(t.take(alice), 1 ether);
        assertEq(t.earned(alice), 0);
        vm.expectRevert(KinetiqPumpToken.NotPayout.selector);
        t.addReward(1);
    }

    function test_cannotReinitializeOrInitImplementation() public {
        vm.expectRevert(KinetiqPumpToken.AlreadyInitialized.selector);
        t.initialize("x", "x", 1, payout, creator);
        vm.expectRevert(KinetiqPumpToken.AlreadyInitialized.selector);
        impl.initialize("x", "x", 1, payout, creator);
    }

    /// whatever the trades, the rewards owed never exceed what was added (rounding only ever leaves dust behind)
    function testFuzz_owedNeverExceedsAdded(uint96[6] memory amts, uint8 seed) public {
        address[3] memory w = [alice, bob, carol];
        uint256 added;
        for (uint256 i; i < amts.length; i++) {
            uint256 a = uint256(amts[i]) % 1e26 + 1; // six buys always fit in the pool's 1B
            address to = w[(seed + i) % 3];
            if (i % 2 == 0) _buy(to, a);
            else {
                address from = w[(seed + i + 1) % 3];
                uint256 b = t.balanceOf(from);
                vm.prank(from);
                t.transfer(to, b / 2);
            }
            uint256 r = (uint256(amts[i]) % 10 ether) + 1;
            _reward(r);
            added += r;
        }
        uint256 owed = t.earned(alice) + t.earned(bob) + t.earned(carol) + t.pendingReward();
        assertLe(owed, added);
        assertApproxEqAbs(owed, added, 10); // dust only
    }
}
