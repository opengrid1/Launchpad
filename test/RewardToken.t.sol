// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RewardToken} from "../src/RewardToken.sol";

/// Minimal mintable ERC20 used as the external reward asset (stream #1).
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        return true;
    }

    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        allowance[f][msg.sender] -= v;
        balanceOf[f] -= v;
        balanceOf[to] += v;
        return true;
    }
}

contract RewardTokenTest is Test {
    RewardToken token;
    MockERC20 reward;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address pair = makeAddr("pair");

    uint256 constant SUPPLY = 1_000_000e18;
    /// Integer-division rounding dust inherent to the magnified-accumulator math (a few wei).
    uint256 constant DUST = 1e4;

    function setUp() public {
        reward = new MockERC20();
        // Full supply minted to treasury, which seeds reward distributions.
        token = new RewardToken("Reward", "RWD", SUPPLY, treasury, address(reward), owner);
        reward.mint(treasury, 1_000_000e18);
        vm.deal(treasury, 1000 ether);
    }

    function _fundTreasuryApproval() internal {
        vm.prank(treasury);
        reward.approve(address(token), type(uint256).max);
    }

    function _distToken(uint256 amt) internal {
        _fundTreasuryApproval();
        vm.prank(treasury);
        token.distributeTokenRewards(amt);
    }

    function _distHype(uint256 amt) internal {
        vm.prank(treasury);
        token.distributeHypeRewards{value: amt}();
    }

    // Treasury holds 100% initially, so a distribution all accrues to treasury.
    function test_holderEarnsBothStreams() public {
        // Give alice and bob each 25% by moving tokens off treasury.
        vm.startPrank(treasury);
        token.transfer(alice, 250_000e18);
        token.transfer(bob, 250_000e18);
        vm.stopPrank();
        // treasury 50%, alice 25%, bob 25%

        _distToken(100e18);
        _distHype(40 ether);

        assertApproxEqAbs(token.withdrawableTokenOf(alice), 25e18, DUST, "alice token 25%");
        assertApproxEqAbs(token.withdrawableTokenOf(bob), 25e18, DUST, "bob token 25%");
        assertApproxEqAbs(token.withdrawableHypeOf(alice), 10 ether, DUST, "alice hype 25%");
        assertApproxEqAbs(token.withdrawableHypeOf(bob), 10 ether, DUST, "bob hype 25%");

        uint256 hypeBefore = alice.balance;
        vm.prank(alice);
        (uint256 t, uint256 h) = token.claim();
        assertApproxEqAbs(t, 25e18, DUST);
        assertApproxEqAbs(h, 10 ether, DUST);
        assertApproxEqAbs(reward.balanceOf(alice), 25e18, DUST);
        assertApproxEqAbs(alice.balance - hypeBefore, 10 ether, DUST);

        // Double claim pays nothing more.
        vm.prank(alice);
        (uint256 t2, uint256 h2) = token.claim();
        assertEq(t2, 0);
        assertEq(h2, 0);
    }

    // A holder who buys in AFTER a distribution must not earn from it retroactively.
    function test_noRetroactiveRewards() public {
        _distToken(100e18); // 100% to treasury at this point
        assertApproxEqAbs(token.withdrawableTokenOf(treasury), 100e18, DUST);

        vm.prank(treasury);
        token.transfer(alice, 500_000e18); // alice joins after the distribution
        assertEq(token.withdrawableTokenOf(alice), 0, "no retro rewards");

        _distToken(100e18); // now treasury 50% / alice 50%
        assertApproxEqAbs(token.withdrawableTokenOf(alice), 50e18, DUST);
        assertApproxEqAbs(token.withdrawableTokenOf(treasury), 150e18, DUST);
    }

    // Excluded accounts (e.g. the DEX pair) must not earn or dilute real holders.
    function test_excludedAccountDoesNotEarn() public {
        vm.prank(treasury);
        token.transfer(pair, 500_000e18); // pair holds 50%

        vm.prank(owner);
        token.setExcludedFromRewards(pair, true);
        // eligibleSupply is now just treasury's 500k.

        _distToken(100e18);
        assertEq(token.withdrawableTokenOf(pair), 0, "pair earns nothing");
        assertApproxEqAbs(token.withdrawableTokenOf(treasury), 100e18, DUST, "treasury gets it all");
    }

    // HYPE sent before there are eligible holders is buffered, then distributed.
    function test_hypeBufferedWhenNoEligibleHolders() public {
        // Exclude the only holder so eligible supply is zero.
        vm.prank(owner);
        token.setExcludedFromRewards(treasury, true);
        assertEq(token.totalShares(), 0);

        _distHype(10 ether);
        assertEq(token.undistributedHype(), 10 ether, "buffered");

        // Re-include treasury and distribute again; buffer flushes too.
        vm.prank(owner);
        token.setExcludedFromRewards(treasury, false);
        _distHype(0);
        assertEq(token.undistributedHype(), 0);
        assertApproxEqAbs(token.withdrawableHypeOf(treasury), 10 ether, DUST);
    }

    function test_plainHypeTransferDistributes() public {
        vm.prank(treasury);
        (bool ok,) = address(token).call{value: 5 ether}("");
        assertTrue(ok);
        assertApproxEqAbs(token.withdrawableHypeOf(treasury), 5 ether, DUST);
    }

    function test_onlyOwnerCanExclude() public {
        vm.prank(alice);
        vm.expectRevert("not owner");
        token.setExcludedFromRewards(pair, true);
    }

    function test_distributeRevertsWithNoHolders() public {
        vm.prank(owner);
        token.setExcludedFromRewards(treasury, true);
        _fundTreasuryApproval();
        vm.prank(treasury);
        vm.expectRevert("no eligible holders");
        token.distributeTokenRewards(1e18);
    }

    // Rewards already accrued are preserved across a later transfer.
    function test_accrualSurvivesTransfer() public {
        vm.prank(treasury);
        token.transfer(alice, 500_000e18); // 50/50

        _distToken(100e18);
        assertApproxEqAbs(token.withdrawableTokenOf(alice), 50e18, DUST);

        // Alice sends all her tokens away; her unclaimed 50 must remain claimable.
        vm.prank(alice);
        token.transfer(bob, 500_000e18);
        assertApproxEqAbs(token.withdrawableTokenOf(alice), 50e18, DUST, "accrued survives");
        assertEq(token.withdrawableTokenOf(bob), 0, "bob no retro");
    }
}
