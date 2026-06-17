// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RewardToken} from "../src/RewardToken.sol";

/// Minimal mock ERC20 for the reward-token stream.
contract MockERC20 {
    string public name = "Reward";
    string public symbol = "RWD";
    uint8 public constant decimals = 18;
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
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= v;
        balanceOf[f] -= v;
        balanceOf[to] += v;
        return true;
    }
}

contract RewardTokenTest is Test {
    RewardToken token;
    MockERC20 rwd;

    address deployer = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address pool = address(0xC0017A001);
    address treasury = address(0x7);

    uint256 constant SUPPLY = 10_000 ether;

    function setUp() public {
        rwd = new MockERC20();
        // Entire 10k supply minted to the deployer, who seeds holders below.
        token = new RewardToken("Grid", "GRID", SUPPLY, deployer, address(rwd));
        rwd.mint(deployer, 1_000_000 ether);
        rwd.approve(address(token), type(uint256).max);
        vm.deal(deployer, 1_000 ether);
    }

    function _topUpToken(uint256 amt) internal {
        token.depositRewardToken(amt);
    }

    function _topUpHype(uint256 amt) internal {
        token.depositHype{value: amt}();
    }

    /// Equal holders split a top-up equally; both streams accrue.
    function test_equalSplit_bothStreams() public {
        token.transfer(alice, 5_000 ether);
        token.transfer(bob, 5_000 ether);

        _topUpToken(100 ether);
        _topUpHype(10 ether);

        assertApproxEqAbs(token.withdrawableRewardToken(alice), 50 ether, 100);
        assertApproxEqAbs(token.withdrawableRewardToken(bob), 50 ether, 100);
        assertApproxEqAbs(token.withdrawableHype(alice), 5 ether, 100);
        assertApproxEqAbs(token.withdrawableHype(bob), 5 ether, 100);

        uint256 rwdBefore = rwd.balanceOf(alice);
        uint256 hypeBefore = alice.balance;
        vm.prank(alice);
        token.claim();
        assertApproxEqAbs(rwd.balanceOf(alice) - rwdBefore, 50 ether, 100);
        assertApproxEqAbs(alice.balance - hypeBefore, 5 ether, 100);
        assertEq(token.withdrawableRewardToken(alice), 0);
        assertEq(token.withdrawableHype(alice), 0);
    }

    /// A buyer who arrives AFTER a top-up cannot claim it (no retroactive rewards).
    function test_noRetroactive() public {
        token.transfer(alice, 5_000 ether);
        // deployer still holds the other 5_000.
        _topUpToken(100 ether); // split between deployer(5k) and alice(5k)

        assertApproxEqAbs(token.withdrawableRewardToken(alice), 50 ether, 100);

        // Bob buys from the deployer AFTER the top-up.
        token.transfer(bob, 5_000 ether);
        assertEq(token.withdrawableRewardToken(bob), 0, "bob must not claim past rewards");

        // Next top-up: alice(5k) + bob(5k) split it; deployer now holds 0.
        _topUpToken(100 ether);
        assertApproxEqAbs(token.withdrawableRewardToken(bob), 50 ether, 100);
        assertApproxEqAbs(token.withdrawableRewardToken(alice), 100 ether, 100);
    }

    /// Earned rewards survive selling all your tokens.
    function test_earnedSurvivesSale() public {
        token.transfer(alice, 5_000 ether);
        token.transfer(bob, 5_000 ether);
        _topUpToken(100 ether);

        // Alice sells everything to bob.
        vm.prank(alice);
        token.transfer(bob, 5_000 ether);

        assertEq(token.balanceOf(alice), 0);
        assertApproxEqAbs(token.withdrawableRewardToken(alice), 50 ether, 100, "earned stays after sale");

        vm.prank(alice);
        token.claim();
        assertApproxEqAbs(rwd.balanceOf(alice), 50 ether, 100);
    }

    /// Excluded accounts neither earn nor dilute.
    function test_exclusion() public {
        token.transfer(pool, 5_000 ether);
        token.transfer(alice, 5_000 ether);
        token.excludeFromRewards(pool); // eligibleSupply now 5_000 (alice only)

        assertEq(token.eligibleSupply(), 5_000 ether);

        _topUpToken(100 ether);
        assertEq(token.withdrawableRewardToken(pool), 0, "pool earns nothing");
        assertApproxEqAbs(token.withdrawableRewardToken(alice), 100 ether, 100, "alice gets it all");
    }

    /// Re-including an account starts it earning from the next top-up only.
    function test_includeNoRetroactive() public {
        token.transfer(treasury, 4_000 ether);
        token.transfer(alice, 6_000 ether);
        token.excludeFromRewards(treasury);

        _topUpToken(100 ether); // all to alice
        assertApproxEqAbs(token.withdrawableRewardToken(alice), 100 ether, 100);

        token.includeInRewards(treasury); // eligibleSupply back to 10_000
        assertEq(token.eligibleSupply(), 10_000 ether);
        assertEq(token.withdrawableRewardToken(treasury), 0, "no retroactive on include");

        _topUpToken(100 ether); // alice 6k, treasury 4k
        assertApproxEqAbs(token.withdrawableRewardToken(treasury), 40 ether, 100);
        assertApproxEqAbs(token.withdrawableRewardToken(alice), 160 ether, 100);
    }

    /// Excluding an account auto-claims its pending rewards so nothing is stranded.
    function test_excludeAutoClaims() public {
        token.transfer(alice, 5_000 ether);
        token.transfer(bob, 5_000 ether);
        _topUpToken(100 ether); // alice & bob each owed 50

        token.excludeFromRewards(bob); // should pay bob his 50 first
        assertApproxEqAbs(rwd.balanceOf(bob), 50 ether, 100, "bob auto-claimed on exclude");
        assertEq(token.withdrawableRewardToken(bob), 0);
    }

    function test_depositRevertsWithNoEligibleHolders() public {
        // Move all supply into an excluded account.
        token.excludeFromRewards(deployer);
        assertEq(token.eligibleSupply(), 0);
        vm.expectRevert(bytes("no eligible holders"));
        token.depositRewardToken(1 ether);
    }

    function test_claimRevertsWhenNothing() public {
        token.transfer(alice, 1_000 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("nothing to claim"));
        token.claim();
    }

    function test_onlyOwnerExclude() public {
        vm.prank(alice);
        vm.expectRevert(bytes("not owner"));
        token.excludeFromRewards(pool);
    }
}
