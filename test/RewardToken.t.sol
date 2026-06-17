// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RewardToken} from "../src/RewardToken.sol";

interface IERC20Like {
    function transfer(address to, uint256 v) external returns (bool);
}

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
        require(to != token0 && to != token1, "INVALID_TO"); // mirror UniswapV2
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
        vm.deal(address(this), 1_000 ether); // for seeding the buffer
        token = new RewardToken("HyperYield", "HYLD", SUPPLY, deployer, address(whype));
        pair = new MockPair(address(token), address(whype)); // token = token0
        whype.mint(address(pair), 500 ether); // pair holds WHYPE to pay out on refill
        pair.setReserves(uint112(2_000 ether), uint112(100 ether)); // 2000 HYLD : 100 WHYPE
        token.setSwapThreshold(1);
    }

    function _setupMarket() internal {
        token.transfer(alice, 5_000 ether); // untaxed (deployer exempt)
        token.transfer(address(pair), 2_000 ether); // liquidity tokens in the pair
        token.excludeFromRewards(deployer); // remaining 3_000 out of denominator
        token.setPair(address(pair));
        token.excludeFromRewards(address(pair));
        token.seedHypeBuffer{value: 50 ether}(); // back instant HYPE rewards
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

    /// A BUY pays holders BOTH rewards instantly (HYPE from the buffer).
    function test_buyInstantBothRewards() public {
        _setupMarket();
        uint256 bufBefore = token.hypeBuffer();

        vm.prank(address(pair));
        token.transfer(bob, 1_000 ether); // buy: 5% tax = 50 (25 token / 25 hype-part)

        // alice (passive holder) earns both, instantly, on a BUY.
        assertGt(token.withdrawableToken(alice), 0, "instant token reward on buy");
        assertGt(token.withdrawableHype(alice), 0, "instant HYPE reward on buy");
        assertLt(token.hypeBuffer(), bufBefore, "buffer used for instant HYPE");
        assertGt(token.pendingSwapTokens(), 0, "hype-part queued for refill");
    }

    /// A SELL also pays both rewards instantly AND refills the buffer.
    function test_sellInstantBothRewards() public {
        _setupMarket();

        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether); // sell #1 (queues tax)
        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether); // sell #2 (refills buffer, distributes)

        assertGt(token.withdrawableToken(alice), 0, "token reward on sell");
        assertGt(token.withdrawableHype(alice), 0, "HYPE reward on sell");
    }

    /// Holder can claim both rewards.
    function test_claimBoth() public {
        _setupMarket();
        vm.prank(address(pair));
        token.transfer(bob, 1_000 ether); // buy -> alice earns both

        uint256 tBefore = token.balanceOf(alice);
        uint256 hBefore = alice.balance;
        uint256 owedT = token.withdrawableToken(alice);
        uint256 owedH = token.withdrawableHype(alice);
        assertGt(owedT, 0);
        assertGt(owedH, 0);

        vm.prank(alice);
        token.claim();
        assertEq(token.balanceOf(alice) - tBefore, owedT);
        assertEq(alice.balance - hBefore, owedH);
    }

    function test_earnedSurvivesSale() public {
        _setupMarket();
        vm.prank(address(pair));
        token.transfer(alice, 1_000 ether); // buy by alice -> she earns
        uint256 owed = token.withdrawableToken(alice);
        assertGt(owed, 0);

        uint256 remaining = token.balanceOf(alice);
        vm.prank(alice);
        token.transfer(bob, remaining); // wallet move, untaxed
        assertApproxEqAbs(token.withdrawableToken(alice), owed, 1e9, "earned stays after sale");
    }

    function test_excludedDoesNotEarn() public {
        _setupMarket();
        vm.prank(address(pair));
        token.transfer(bob, 1_000 ether);
        assertEq(token.withdrawableToken(address(pair)), 0);
        assertEq(token.withdrawableHype(address(pair)), 0);
    }

    /// Even if a buffer refill swap fails, trades still succeed.
    function test_refillFailureDoesNotBrickTrades() public {
        _setupMarket();
        uint256 pairWhype = whype.balanceOf(address(pair));
        vm.prank(address(pair));
        whype.transfer(address(0xdead), pairWhype); // drain pair WHYPE so swap reverts

        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether);
        vm.prank(alice);
        token.transfer(address(pair), 1_000 ether); // refill attempted; must NOT revert

        assertGt(token.withdrawableToken(alice), 0);
        assertGt(token.pendingSwapTokens(), 0, "tax queued for later refill");
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

    function test_claimRevertsWhenNothing() public {
        token.transfer(alice, 1_000 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("nothing to claim"));
        token.claim();
    }
}
