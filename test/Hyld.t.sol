// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {HyldToken} from "../src/hyld/HyldToken.sol";
import {HyldManager} from "../src/hyld/HyldManager.sol";
import {INonfungiblePositionManager, IWHYPE} from "../src/interfaces/IHyperswapV3.sol";
import {MockWHYPE, MockPool, MockPositionManager} from "./mocks/HyperswapV3Mocks.sol";

contract HyldTest is Test {
    HyldToken token;
    HyldManager manager;
    MockWHYPE whype;
    MockPositionManager pm;

    address pool;
    uint256 constant SUPPLY = 10_000e18;
    uint256 constant PRICE = 1e14; // 0.0001 WHYPE per HYLD

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address treasury = makeAddr("treasury");

    function setUp() public {
        whype = new MockWHYPE();
        pm = new MockPositionManager();

        token = new HyldToken(address(this)); // full supply to deployer (excluded), deployer = owner
        manager = new HyldManager(token, INonfungiblePositionManager(address(pm)), IWHYPE(address(whype)), address(this));

        token.setExcluded(address(manager), true);
        token.setExcluded(address(pm), true); // mock infra, never a real holder
        token.transfer(address(manager), SUPPLY);

        pool = manager.seed(PRICE);
        token.setExcluded(pool, true);
    }

    // Simulate buyers receiving HYLD out of the pool (a swap moves HYLD pool -> buyer).
    function _buy(address who, uint256 amount) internal {
        MockPool(pool).pay(address(token), who, amount);
    }

    // Stage `hypeFee` WHYPE + `hyldFee` HYLD as collectable fees on the position.
    function _stageFees(uint256 hypeFee, uint256 hyldFee) internal {
        if (hypeFee > 0) {
            vm.deal(address(this), hypeFee);
            whype.deposit{value: hypeFee}();
            whype.transfer(address(pm), hypeFee);
        }
        if (hyldFee > 0) {
            MockPool(pool).pay(address(token), address(pm), hyldFee);
        }
        bool t0 = manager.tokenIsToken0();
        (uint256 a0, uint256 a1) = t0 ? (hyldFee, hypeFee) : (hypeFee, hyldFee);
        pm.setCollectable(manager.positionId(), a0, a1);
    }

    function test_seedIsSingleSidedAndManagerHoldsPosition() public view {
        assertTrue(manager.seeded());
        assertEq(token.balanceOf(pool), SUPPLY, "all HYLD in pool");
        assertEq(token.balanceOf(address(manager)), 0, "manager emptied into LP");
        assertEq(pm.ownerOf(manager.positionId()), address(manager), "manager owns position");
        assertEq(token.totalShares(), 0, "no real holders yet");
    }

    function test_zeroTaxTransfer() public {
        _buy(alice, 1_000e18);
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        token.transfer(carol, 100e18);
        assertEq(token.balanceOf(alice), before - 100e18, "no tax on sender");
        assertEq(token.balanceOf(carol), 100e18, "carol got exactly 100");
    }

    function test_dualRewardsSplitProRata() public {
        _buy(alice, 1_000e18);
        _buy(bob, 3_000e18);
        assertEq(token.totalShares(), 4_000e18);

        _stageFees(1 ether, 100e18); // 1 HYPE + 100 HYLD of fees
        (uint256 hypeOut, uint256 hyldOut) = manager.collect();
        assertEq(hypeOut, 1 ether);
        assertEq(hyldOut, 100e18);

        // alice 1/4, bob 3/4 — in BOTH tokens.
        assertApproxEqAbs(token.withdrawableHype(alice), 0.25 ether, 2);
        assertApproxEqAbs(token.withdrawableHype(bob), 0.75 ether, 2);
        assertApproxEqAbs(token.withdrawableTokens(alice), 25e18, 2);
        assertApproxEqAbs(token.withdrawableTokens(bob), 75e18, 2);

        // pool earns nothing despite holding HYLD.
        assertEq(token.withdrawableHype(pool), 0);
        assertEq(token.withdrawableTokens(pool), 0);
    }

    function test_claimBothStreams() public {
        _buy(alice, 1_000e18);
        _stageFees(1 ether, 40e18);
        manager.collect();

        uint256 hypeBefore = alice.balance;
        uint256 hyldBefore = token.balanceOf(alice);
        vm.startPrank(alice);
        token.claimHype();
        token.claimTokens();
        vm.stopPrank();

        assertApproxEqAbs(alice.balance - hypeBefore, 1 ether, 2, "claimed HYPE");
        assertApproxEqAbs(token.balanceOf(alice) - hyldBefore, 40e18, 2, "claimed HYLD");
    }

    function test_feesFromBothBuyAndSellAccrueToHolders() public {
        // Buy-only round: fee lands as HYPE. Sell-only round: fee lands as HYLD.
        _buy(alice, 2_000e18);

        _stageFees(0.5 ether, 0); // a wave of buys -> HYPE fees only
        manager.collect();
        assertApproxEqAbs(token.withdrawableHype(alice), 0.5 ether, 2);
        assertEq(token.withdrawableTokens(alice), 0);

        _stageFees(0, 30e18); // a wave of sells -> HYLD fees only
        manager.collect();
        assertApproxEqAbs(token.withdrawableTokens(alice), 30e18, 2);
        // HYPE side preserved across the second distribution.
        assertApproxEqAbs(token.withdrawableHype(alice), 0.5 ether, 2);
    }

    function test_ownerWithdrawLiquidityReturnsPrincipalAndDisablesCollect() public {
        // Dedicated deployment: seed 9,000 so the deployer can retain 1,000 to fund a holder
        // without draining the pool below its recorded principal (a mock-accounting constraint).
        MockWHYPE w = new MockWHYPE();
        MockPositionManager p = new MockPositionManager();
        HyldToken t = new HyldToken(address(this));
        HyldManager m =
            new HyldManager(t, INonfungiblePositionManager(address(p)), IWHYPE(address(w)), address(this));
        t.setExcluded(address(m), true);
        t.setExcluded(address(p), true);
        t.transfer(address(m), 9_000e18); // seed 9,000
        address pl = m.seed(PRICE);
        t.setExcluded(pl, true);
        t.transfer(alice, 1_000e18); // retained 1,000 -> alice becomes a holder; pool untouched

        // Stage a pending HYPE fee (settled to holders before principal leaves).
        vm.deal(address(this), 0.3 ether);
        w.deposit{value: 0.3 ether}();
        w.transfer(address(p), 0.3 ether);
        bool t0 = m.tokenIsToken0();
        (uint256 a0, uint256 a1) = t0 ? (uint256(0), uint256(0.3 ether)) : (uint256(0.3 ether), uint256(0));
        p.setCollectable(m.positionId(), a0, a1);

        m.withdrawLiquidity(treasury);

        assertTrue(m.positionWithdrawn());
        assertApproxEqAbs(t.withdrawableHype(alice), 0.3 ether, 2, "fees settled to holder first");
        assertEq(t.balanceOf(treasury), 9_000e18, "principal HYLD returned to treasury");

        vm.expectRevert("withdrawn");
        m.collect();
    }

    // A holder who buys AFTER a distribution must NOT receive any of that earlier reward.
    function test_lateJoinerGetsNoPriorDividends() public {
        _buy(alice, 1_000e18);
        _stageFees(1 ether, 0);
        manager.collect();
        assertApproxEqAbs(token.withdrawableHype(alice), 1 ether, 2);

        _buy(bob, 1_000e18); // joins now
        assertEq(token.withdrawableHype(bob), 0, "bob earns nothing from the past");

        _stageFees(1 ether, 0);
        manager.collect(); // now split 50/50
        assertApproxEqAbs(token.withdrawableHype(alice), 1.5 ether, 2);
        assertApproxEqAbs(token.withdrawableHype(bob), 0.5 ether, 2);
    }

    // Moving tokens preserves already-accrued rewards and re-splits future ones by new balances.
    function test_balanceChangePreservesAccruedAndReweights() public {
        _buy(alice, 1_000e18);
        _buy(bob, 1_000e18);
        _stageFees(1 ether, 0);
        manager.collect(); // alice 0.5, bob 0.5
        assertApproxEqAbs(token.withdrawableHype(alice), 0.5 ether, 2);

        vm.prank(alice);
        token.transfer(carol, 1_000e18); // alice -> 0, carol -> 1000
        // accrued is preserved across the move
        assertApproxEqAbs(token.withdrawableHype(alice), 0.5 ether, 2, "alice keeps accrued");
        assertEq(token.withdrawableHype(carol), 0, "carol starts fresh");

        _stageFees(1 ether, 0);
        manager.collect(); // now split bob/carol 50/50
        assertApproxEqAbs(token.withdrawableHype(alice), 0.5 ether, 2, "alice unchanged");
        assertApproxEqAbs(token.withdrawableHype(bob), 1.0 ether, 2);
        assertApproxEqAbs(token.withdrawableHype(carol), 0.5 ether, 2);
    }

    // Every distributed wei is accounted to holders (no dust drain), and you can't claim twice.
    function test_conservationAndNoDoubleClaim() public {
        _buy(alice, 1_337e18);
        _buy(bob, 4_201e18);
        _buy(carol, 462e18);
        uint256 dist = 3.21 ether;
        _stageFees(dist, 0);
        manager.collect();

        uint256 sum =
            token.withdrawableHype(alice) + token.withdrawableHype(bob) + token.withdrawableHype(carol);
        assertApproxEqAbs(sum, dist, 3, "all rewards accounted, only rounding dust lost");

        uint256 b = alice.balance;
        vm.startPrank(alice);
        token.claimHype();
        assertEq(alice.balance - b, token.withdrawnHype(alice));
        vm.expectRevert("nothing");
        token.claimHype(); // second claim pays nothing
        vm.stopPrank();
    }

    function test_onlyOwnerCanWithdraw() public {
        vm.prank(alice);
        vm.expectRevert("not owner");
        manager.withdrawLiquidity(alice);
    }

    function test_seedIsOneShot() public {
        vm.expectRevert("seeded");
        manager.seed(PRICE);
    }

    receive() external payable {}
}
