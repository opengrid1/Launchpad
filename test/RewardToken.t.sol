// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RewardToken} from "../src/RewardToken.sol";

interface IERC20Like {
    function transferFrom(address f, address t, uint256 v) external returns (bool);
}

/// Mock UniswapV2 router: pulls the token in and pays out native HYPE at a
/// fixed rate (out = in * rateNum / rateDen).
contract MockV2Router {
    address public weth;
    uint256 public rateNum = 1;
    uint256 public rateDen = 10;

    constructor(address weth_) {
        weth = weth_;
    }

    function WETH() external view returns (address) {
        return weth;
    }

    receive() external payable {}

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256,
        address[] calldata path,
        address to,
        uint256
    ) external {
        IERC20Like(path[0]).transferFrom(msg.sender, address(this), amountIn);
        uint256 out = (amountIn * rateNum) / rateDen;
        (bool ok,) = to.call{value: out}("");
        require(ok, "eth send fail");
    }
}

contract RewardTokenTest is Test {
    RewardToken token;
    MockV2Router router;

    address deployer = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address pair = address(0xDEAD01);
    address treasury = address(0x7);

    uint256 constant SUPPLY = 10_000 ether;

    function setUp() public {
        router = new MockV2Router(address(0x5555555555555555555555555555555555555555));
        vm.deal(address(router), 10_000 ether); // router can pay out HYPE
        token = new RewardToken("Grid", "GRID", SUPPLY, deployer, address(router));
        token.setSwapThreshold(1); // swap-back on essentially any sell
    }

    /// Wires up alice as the sole eligible holder and `pair` as the AMM.
    function _setupMarket() internal {
        token.transfer(alice, 5_000 ether); // untaxed (deployer exempt)
        token.transfer(pair, 3_000 ether); // seed liquidity, untaxed
        token.excludeFromRewards(deployer); // drop deployer's remaining 2_000
        token.excludeFromRewards(pair); // pair neither earns nor dilutes
        token.excludeFromRewards(address(router)); // router holdings don't dilute
        token.setAMM(pair, true);
    }

    function test_defaults() public view {
        assertEq(token.buyTaxBps(), 500);
        assertEq(token.sellTaxBps(), 500);
        assertEq(token.hypeShareBps(), 5_000);
        assertEq(token.WHYPE(), address(0x5555555555555555555555555555555555555555));
    }

    /// Wallet-to-wallet transfers are untaxed (transfer tax = 0%).
    function test_noTaxWalletToWallet() public {
        token.transfer(alice, 1_000 ether);
        vm.prank(alice);
        token.transfer(bob, 400 ether);
        assertEq(token.balanceOf(bob), 400 ether);
    }

    /// A buy from the AMM is taxed 5%.
    function test_buyTax() public {
        _setupMarket();
        // Buy: pair -> bob, 1_000 in. 5% = 50 tax, bob receives 950.
        vm.prank(pair);
        token.transfer(bob, 1_000 ether);
        assertEq(token.balanceOf(bob), 950 ether);
        assertEq(token.pendingTax(), 50 ether);
    }

    /// A sell into the AMM is taxed 5% and, once tax has accumulated, swap-back
    /// splits it into a GRID reward and a HYPE reward (50/50 by default).
    function test_sellTaxSplitsIntoGridAndHype() public {
        _setupMarket();

        // First sell accumulates tax (swap-back sees pendingTax == 0, no-op).
        vm.prank(alice);
        token.transfer(pair, 1_000 ether); // tax 50 -> pendingTax 50
        assertEq(token.pendingTax(), 50 ether);

        // Second sell triggers swap-back of the 50 collected: 25 -> GRID reward,
        // 25 -> swapped to HYPE (rate 1/10 => 2.5 HYPE).
        vm.prank(alice);
        token.transfer(pair, 1_000 ether);

        // alice is the only eligible holder, so she gets ~all of both rewards.
        assertApproxEqAbs(token.withdrawableGrid(alice), 25 ether, 1e6);
        assertApproxEqAbs(token.withdrawableHype(alice), 2.5 ether, 1e6);

        // Claim pays both.
        uint256 gridBefore = token.balanceOf(alice);
        uint256 hypeBefore = alice.balance;
        vm.prank(alice);
        token.claim();
        assertApproxEqAbs(token.balanceOf(alice) - gridBefore, 25 ether, 1e6);
        assertApproxEqAbs(alice.balance - hypeBefore, 2.5 ether, 1e6);
    }

    /// Earned rewards survive selling all your tokens.
    function test_earnedSurvivesSale() public {
        _setupMarket();
        // Generate two sells worth of tax so a distribution lands for alice.
        vm.prank(alice);
        token.transfer(pair, 1_000 ether);
        vm.prank(alice);
        token.transfer(pair, 1_000 ether);

        uint256 owedGrid = token.withdrawableGrid(alice);
        assertGt(owedGrid, 0);

        // Alice dumps her entire remaining balance.
        uint256 remaining = token.balanceOf(alice);
        vm.prank(alice);
        token.transfer(bob, remaining); // wallet transfer, untaxed

        assertEq(token.balanceOf(alice), 0);
        assertApproxEqAbs(token.withdrawableGrid(alice), owedGrid, 1e6, "earned stays after sale");
    }

    /// Excluded accounts (pair) neither earn nor dilute.
    function test_excludedDoesNotEarn() public {
        _setupMarket();
        vm.prank(alice);
        token.transfer(pair, 1_000 ether);
        vm.prank(alice);
        token.transfer(pair, 1_000 ether);
        assertEq(token.withdrawableGrid(pair), 0);
        assertEq(token.withdrawableHype(pair), 0);
    }

    /// Tax never makes a trade revert even if the swap fails (no HYPE in router).
    function test_swapFailureDoesNotBrickTrades() public {
        _setupMarket();
        vm.deal(address(router), 0); // router can't pay HYPE -> swap reverts internally

        vm.prank(alice);
        token.transfer(pair, 1_000 ether);
        vm.prank(alice);
        token.transfer(pair, 1_000 ether); // triggers swap-back; must NOT revert

        // GRID reward still booked; HYPE portion returned to pending for retry.
        assertApproxEqAbs(token.withdrawableGrid(alice), 25 ether, 1e6);
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
        token.setRewardSplit(7_000); // 70% HYPE / 30% GRID
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
