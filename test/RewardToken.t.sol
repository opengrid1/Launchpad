// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RewardToken} from "../src/RewardToken.sol";

interface IERC20Like {
    function transfer(address to, uint256 v) external returns (bool);
}

/// WETH9-style mock for WHYPE.
contract MockWHYPE {
    mapping(address => uint256) public balanceOf;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function withdraw(uint256 a) external {
        balanceOf[msg.sender] -= a;
        (bool ok,) = msg.sender.call{value: a}("");
        require(ok, "withdraw fail");
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    receive() external payable {
        balanceOf[msg.sender] += msg.value;
    }
}

/// Minimal UniswapV2-pair mock: pays out the requested token on swap.
contract MockPair {
    address public token0;
    address public token1;
    uint112 private r0;
    uint112 private r1;

    constructor(address t0, address t1) {
        token0 = t0;
        token1 = t1;
    }

    function setReserves(uint112 a, uint112 b) external {
        r0 = a;
        r1 = b;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (r0, r1, 0);
    }

    function swap(uint256 a0, uint256 a1, address to, bytes calldata) external {
        if (a0 > 0) IERC20Like(token0).transfer(to, a0);
        if (a1 > 0) IERC20Like(token1).transfer(to, a1);
    }
}

contract RewardTokenTest is Test {
    RewardToken token;
    MockWHYPE whype;
    MockPair pair;

    address deployer = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant SUPPLY = 10_000 ether;

    function setUp() public {
        whype = new MockWHYPE();
        vm.deal(address(whype), 1_000 ether); // back WHYPE with native for withdraw
        token = new RewardToken("HyperYield", "HYLD", SUPPLY, deployer, address(whype));
        pair = new MockPair(address(token), address(whype)); // token = token0
        whype.mint(address(pair), 500 ether); // pair holds WHYPE to pay out
        pair.setReserves(uint112(2_000 ether), uint112(100 ether)); // 2000 HYLD : 100 WHYPE
        token.setSwapThreshold(1);
    }

    function _setupMarket() internal {
        token.transfer(alice, 5_000 ether); // untaxed (deployer exempt)
        token.transfer(address(pair), 2_000 ether); // liquidity tokens held by the pair
        token.excludeFromRewards(deployer); // remaining 3_000 out of denominator
        token.setPair(address(pair)); // marks AMM + token ordering
        token.excludeFromRewards(address(pair)); // pool neither earns nor dilutes
        // eligible = alice 5_000
    }

    function test_defaults() public view {
        assertEq(token.buyTaxBps(), 500);
        assertEq(token.sellTaxBps(), 500);
        assertEq(token.hypeShareBps(), 5_000);
        assertEq(token.WHYPE(), address(whype));
    }

    function test_noTaxWalletToWallet() public {
        token.transfer(alice, 1_000 ether);
        vm.prank(alice);
        token.transfer(bob, 400 ether);
        assertEq(token.balanceOf(bob), 400 ether);
    }

    function test_buyTax() public {
        _setupMarket();
        vm.prank(address(pair));
        token.transfer(bob, 1_000 ether); // buy: pair -> bob
        assertEq(token.balanceOf(bob), 950 ether);
        assertEq(token.pendingTax(), 50 ether);
    }

    /// A sell triggers swap-back: tax splits into a TOKEN reward + a HYPE reward,
    /// both claimable by a passive holder.
    function test_sellSwapsToBothRewards() public {
        _setupMarket();

        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether); // sell #1: tax 50 -> pending
        assertEq(token.pendingTax(), 50 ether);

        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether); // sell #2: triggers swap-back of 50

        // 25 -> TOKEN reward, 25 -> swapped to HYPE. alice is the only eligible holder.
        assertApproxEqAbs(token.withdrawableToken(alice), 25 ether, 1e9);
        uint256 owedHype = token.withdrawableHype(alice);
        assertGt(owedHype, 0, "HYPE reward distributed");

        // Claim pays both.
        uint256 tBefore = token.balanceOf(alice);
        uint256 hBefore = alice.balance;
        vm.prank(alice);
        token.claim();
        assertApproxEqAbs(token.balanceOf(alice) - tBefore, 25 ether, 1e9);
        assertEq(alice.balance - hBefore, owedHype);
    }

    function test_earnedSurvivesSale() public {
        _setupMarket();
        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether);
        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether);

        uint256 owed = token.withdrawableToken(alice);
        assertGt(owed, 0);

        uint256 remaining = token.balanceOf(alice);
        vm.prank(alice);
        token.transfer(bob, remaining); // wallet move, untaxed
        assertEq(token.balanceOf(alice), 0);
        assertApproxEqAbs(token.withdrawableToken(alice), owed, 1e9, "earned stays after sale");
    }

    function test_excludedDoesNotEarn() public {
        _setupMarket();
        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether);
        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether);
        assertEq(token.withdrawableToken(address(pair)), 0);
        assertEq(token.withdrawableHype(address(pair)), 0);
    }

    /// If the swap fails (pair can't pay WHYPE), trades still succeed; the HYPE
    /// portion returns to pending and the TOKEN reward is still booked.
    function test_swapFailureDoesNotBrickTrades() public {
        _setupMarket();
        // drain the pair's WHYPE so the swap reverts (compute balance first so
        // the vm.prank applies to the transfer, not the balanceOf call)
        uint256 pairWhype = whype.balanceOf(address(pair));
        vm.prank(address(pair));
        whype.transfer(address(0xdead), pairWhype);

        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether);
        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether); // swap-back attempted; must NOT revert

        assertApproxEqAbs(token.withdrawableToken(alice), 25 ether, 1e9);
        assertEq(token.withdrawableHype(alice), 0);
        assertGt(token.pendingTax(), 0);
    }

    function test_setTaxesCapAndOwner() public {
        token.setTaxes(300, 200);
        assertEq(token.buyTaxBps(), 300);
        assertEq(token.sellTaxBps(), 200);
        vm.expectRevert(bytes("tax > 5%"));
        token.setTaxes(600, 100);
        vm.prank(alice);
        vm.expectRevert(bytes("not owner"));
        token.setTaxes(0, 0);
    }

    function test_setRewardSplit() public {
        token.setRewardSplit(7_000);
        assertEq(token.hypeShareBps(), 7_000);
        vm.expectRevert(bytes("bad split"));
        token.setRewardSplit(10_001);
    }

    function test_claimRevertsWhenNothing() public {
        token.transfer(alice, 1_000 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("nothing to claim"));
        token.claim();
    }
}
