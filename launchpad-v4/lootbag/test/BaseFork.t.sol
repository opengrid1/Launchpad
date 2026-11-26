// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {LootbagHook} from "../src/LootbagHook.sol";
import {LootbagFactory} from "../src/LootbagFactory.sol";
import {LootbagPayout} from "../src/LootbagPayout.sol";
import {LootbagSwapper} from "../src/LootbagSwapper.sol";
import {LootbagToken} from "../src/LootbagToken.sol";

interface IERC20T {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// @dev a plain v4 router for the tests: swaps (exact in or out) and liquidity changes, settling what it owes
contract TestRouter is IUnlockCallback {
    IPoolManager immutable pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    function swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified) external returns (BalanceDelta d) {
        d = abi.decode(pm.unlock(abi.encode(uint8(0), msg.sender, key, zeroForOne, amountSpecified)), (BalanceDelta));
    }

    function removeLiquidity(PoolKey memory key, int24 lo, int24 hi, int256 liq) external {
        pm.unlock(abi.encode(uint8(1), msg.sender, key, lo < hi, int256(0), lo, hi, liq));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        uint8 kind = abi.decode(data, (uint8));
        if (kind == 1) {
            (,, PoolKey memory k,,, int24 lo, int24 hi, int256 liq) =
                abi.decode(data, (uint8, address, PoolKey, bool, int256, int24, int24, int256));
            pm.modifyLiquidity(k, ModifyLiquidityParams(lo, hi, -liq, bytes32(0)), "");
            return "";
        }
        (, address who, PoolKey memory key, bool z, int256 amt) = abi.decode(data, (uint8, address, PoolKey, bool, int256));
        BalanceDelta d = pm.swap(
            key, SwapParams(z, amt, z ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1), ""
        );
        _square(key.currency0, d.amount0(), who);
        _square(key.currency1, d.amount1(), who);
        return abi.encode(d);
    }

    function _square(Currency c, int128 a, address who) internal {
        if (a < 0) {
            pm.sync(c);
            // the swapper's tokens were sent to the router beforehand
            IERC20T(Currency.unwrap(c)).transfer(address(pm), uint256(int256(-a)));
            pm.settle();
        } else if (a > 0) {
            pm.take(c, who, uint256(int256(a)));
        }
    }
}

contract BaseForkTest is Test {
    IPoolManager constant PM = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    address constant VVV = 0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant VVV_USDC_UNI = 0x67A11022B7B6ed66f81233F6C8Ed6e48F7826530; // Uniswap v3 0.3%
    address constant WETH_USDC_AERO = 0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59; // Aerodrome Slipstream
    // Coinbase's stock tokens (B20) run natively in Base's client, not as EVM code, so a fork can't execute them; the
    // stock leg of a route is the same v3-style hop, tested here with WETH through Uniswap v3 and Aerodrome.

    address owner = makeAddr("lootbag.test.owner");
    address treasury = makeAddr("lootbag.test.treasury");
    address bagPot = makeAddr("lootbag.test.bagPot");
    address airdropPot = makeAddr("lootbag.test.airdropPot");
    address keeper = makeAddr("lootbag.test.keeper");
    address creator = makeAddr("lootbag.test.creator");
    address sniper = makeAddr("lootbag.test.sniper");
    address alice = makeAddr("lootbag.test.alice");
    address bob = makeAddr("lootbag.test.bob");

    LootbagHook hook;
    LootbagFactory factory;
    LootbagPayout payout;
    LootbagSwapper swapper;
    TestRouter router;

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC", string("https://mainnet.base.org")));
        // the hook must sit at an address whose low bits are its permissions
        address hookAddr = address(uint160(0x2ACC) | (uint160(uint256(keccak256("lootbag.hook"))) << 16 >> 2));
        hookAddr = address((uint160(hookAddr) & ~uint160(0x3FFF)) | 0x2ACC);
        deployCodeTo("LootbagHook.sol:LootbagHook", abi.encode(PM, owner), hookAddr);
        hook = LootbagHook(hookAddr);
        payout = new LootbagPayout(owner);
        swapper = new LootbagSwapper(PM, owner);
        factory = new LootbagFactory(PM, IHooks(hookAddr), address(payout), owner, treasury);
        router = new TestRouter(PM);

        vm.startPrank(owner);
        hook.init(address(factory), address(payout), bagPot, airdropPot, treasury);
        payout.init(address(factory), address(hook), address(swapper));
        payout.setKeeper(keeper, true);
        factory.setQuote(VVV, true, -156_000, 0.1 ether); // about $5K at VVV near $30
        factory.setReward(WETH, true);
        LootbagSwapper.Hop[] memory hops = new LootbagSwapper.Hop[](2);
        hops[0].kind = 0;
        hops[0].pool = VVV_USDC_UNI;
        hops[1].kind = 0;
        hops[1].pool = WETH_USDC_AERO;
        swapper.queueRoute(VVV, WETH, hops);
        vm.stopPrank();

        for (uint256 i; i < 4; i++) {
            address w = [creator, sniper, alice, bob][i];
            deal(VVV, w, 1_000 ether);
            vm.deal(w, 1 ether);
        }
    }

    function _launch(string memory sym, uint256 devBuy) internal returns (address coin, PoolKey memory key) {
        address[] memory rewards = new address[](2);
        rewards[0] = VVV;
        rewards[1] = WETH;
        vm.startPrank(creator);
        IERC20T(VVV).approve(address(factory), devBuy);
        coin = factory.launch{value: factory.launchFee(sym)}(
            LootbagFactory.LaunchParams({name: "Loot", symbol: sym, quote: VVV, rewards: rewards, devBuy: devBuy, minCoinsOut: 0})
        );
        vm.stopPrank();
        key = factory.poolKey(coin);
    }

    function _buy(address who, PoolKey memory key, address coin, uint256 vvvIn) internal returns (uint256 got) {
        vm.prank(who);
        IERC20T(VVV).transfer(address(router), vvvIn);
        uint256 b = IERC20T(coin).balanceOf(who);
        router.swap(key, Currency.unwrap(key.currency0) == VVV, -int256(vvvIn));
        // the router forwards to msg.sender of swap (this test), so hand the coins on
        got = IERC20T(coin).balanceOf(address(this));
        IERC20T(coin).transfer(who, got);
        got = IERC20T(coin).balanceOf(who) - b;
    }

    function _sell(address who, PoolKey memory key, address coin, uint256 coinsIn) internal returns (uint256 got) {
        vm.prank(who);
        IERC20T(coin).transfer(address(router), coinsIn);
        uint256 b = IERC20T(VVV).balanceOf(address(this));
        router.swap(key, Currency.unwrap(key.currency0) == coin, -int256(coinsIn));
        got = IERC20T(VVV).balanceOf(address(this)) - b;
        IERC20T(VVV).transfer(who, got);
    }

    function test_launchOpensALockedPoolAndMakesTheDevBuy() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        LootbagToken t = LootbagToken(coin);
        uint256 dev = t.balanceOf(creator);
        assertGt(dev, 0);
        assertLe(dev, factory.MAX_DEV_BUY());
        assertTrue(t.excluded(creator));
        assertEq(t.balanceOf(address(factory)), 0, "factory keeps nothing");
        emit log_named_uint("treasury wei", treasury.balance);
        assertEq(treasury.balance, 0.001 ether);
        // opening market cap: the dev buy of 3 VVV (~$90 at ~$30) moves price a little; supply at about $5K
        emit log_named_uint("dev buy coins", dev / 1e18);
        // nobody can take the liquidity out, not even the factory
        int24 lo = Currency.unwrap(key.currency0) == coin ? int24(-156_000) : TickMath.minUsableTick(200);
        int24 hi = Currency.unwrap(key.currency0) == coin ? TickMath.maxUsableTick(200) : int24(156_000);
        vm.expectRevert();
        router.removeLiquidity(key, lo, hi, 1);
        vm.prank(address(factory));
        vm.expectRevert();
        router.removeLiquidity(key, lo, hi, 1);
    }

    function test_feeIsTwoPercentInVVVBothWays() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        vm.roll(block.number + 1);
        uint256 owed0 = hook.owed(VVV) + hook.owedHolders(VVV);
        _buy(alice, key, coin, 100 ether);
        uint256 fee = hook.owed(VVV) + hook.owedHolders(VVV) - owed0;
        assertEq(fee, 2 ether, "2% of an exact-in buy");
        uint256 coins = LootbagToken(coin).balanceOf(alice);
        uint256 owed1 = hook.owed(VVV) + hook.owedHolders(VVV);
        uint256 out = _sell(alice, key, coin, coins / 2);
        uint256 sellFee = hook.owed(VVV) + hook.owedHolders(VVV) - owed1;
        assertApproxEqRel(sellFee, (out + sellFee) * 2 / 100, 1e12, "2% of an exact-in sell");
    }

    function test_holdersEarnSnipersAndCreatorDont() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        _buy(sniper, key, coin, 5 ether); // same block as the launch
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 50 ether);
        _buy(bob, key, coin, 50 ether);
        _buy(alice, key, coin, 20 ether);
        LootbagToken t = LootbagToken(coin);
        assertTrue(t.excluded(sniper));
        assertEq(t.earned(sniper), 0);
        assertEq(t.earned(creator), 0);
        assertGt(t.earned(alice), 0);
        assertGt(t.earned(bob), 0);
        // what the holders are owed is exactly what the payout contract holds for them (dust aside)
        assertApproxEqAbs(t.earned(alice) + t.earned(bob) + t.pendingReward(), payout.held(coin), 10);
    }

    function test_payoutRoundsPayVVVThenWETH() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 100 ether);
        _buy(bob, key, coin, 100 ether);
        _buy(alice, key, coin, 100 ether);
        address[] memory hs = new address[](2);
        hs[0] = alice;
        hs[1] = bob;
        LootbagToken t = LootbagToken(coin);

        // round 0 pays VVV, straight from what is held
        assertEq(payout.currentReward(coin), VVV);
        uint256 ea = t.earned(alice);
        uint256 a0 = IERC20T(VVV).balanceOf(alice);
        vm.prank(keeper);
        payout.pay(coin, hs, 0);
        assertApproxEqAbs(IERC20T(VVV).balanceOf(alice) - a0, ea, 1);
        assertEq(t.earned(alice), 0);

        // round 1 pays WETH, bought with the VVV through Uniswap v3 (VVV>USDC) and Aerodrome (USDC>WETH)
        _buy(bob, key, coin, 200 ether);
        vm.warp(block.timestamp + 5 minutes);
        assertEq(payout.currentReward(coin), WETH);
        vm.prank(keeper);
        uint256 out = payout.pay(coin, hs, 1);
        assertGt(out, 0);
        assertGt(IERC20T(WETH).balanceOf(alice), 0);
        assertGt(IERC20T(WETH).balanceOf(bob), 0);
        emit log_named_uint("WETHc paid (8 decimals)", out);
    }

    function test_onlyKeepersRunRoundsButHoldersCanAlwaysClaim() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 100 ether);
        _buy(bob, key, coin, 100 ether);
        address[] memory hs = new address[](1);
        hs[0] = alice;
        vm.expectRevert(LootbagPayout.NotKeeper.selector);
        payout.pay(coin, hs, 0);
        uint256 e = LootbagToken(coin).earned(alice);
        uint256 b = IERC20T(VVV).balanceOf(alice);
        vm.prank(alice);
        payout.claim(coin);
        assertApproxEqAbs(IERC20T(VVV).balanceOf(alice) - b, e, 1);
    }

    function test_lootbagShareSplits25To10To65() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 100 ether);
        uint256 owed = hook.owed(VVV);
        hook.split(VVV);
        assertEq(IERC20T(VVV).balanceOf(bagPot), owed * 25 / 100);
        assertEq(IERC20T(VVV).balanceOf(airdropPot), owed * 10 / 100);
        assertEq(IERC20T(VVV).balanceOf(treasury), owed - owed * 25 / 100 - owed * 10 / 100);
        assertEq(hook.owed(VVV), 0);
    }

    function test_copiedTickerPaysTheCopyFee() public {
        _launch("LOOT", 3 ether);
        assertEq(factory.launchFee("loot"), 0.051 ether);
        (address coin2,) = _launch("Loot", 3 ether);
        assertEq(factory.copyFeeHeld(coin2), 0.05 ether);
        vm.prank(owner);
        factory.settleCopyFee(coin2, true);
        assertEq(creator.balance, 1 ether - 0.001 ether - 0.051 ether + 0.05 ether);
    }

    function test_devBuyCappedAtTwoPercent() public {
        address[] memory rewards = new address[](1);
        rewards[0] = VVV;
        vm.startPrank(creator);
        IERC20T(VVV).approve(address(factory), 500 ether);
        vm.expectRevert();
        factory.launch{value: 0.001 ether}(
            LootbagFactory.LaunchParams({name: "Big", symbol: "BIG", quote: VVV, rewards: rewards, devBuy: 500 ether, minCoinsOut: 0})
        );
        vm.stopPrank();
    }
}
