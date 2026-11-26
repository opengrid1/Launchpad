// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
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
import {LootbagRouter} from "../src/LootbagRouter.sol";
import {LootbagToken} from "../src/LootbagToken.sol";
import {LootbagBags} from "../src/LootbagBags.sol";
import {LootbagAirdrop} from "../src/LootbagAirdrop.sol";

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
    LootbagRouter ethRouter;

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC", string("https://mainnet.base.org")));
        // the hook must sit at an address whose low bits are its permissions
        address hookAddr = address(uint160(0x2ACC) | (uint160(uint256(keccak256("lootbag.hook"))) << 16 >> 2));
        hookAddr = address((uint160(hookAddr) & ~uint160(0x3FFF)) | 0x2ACC);
        deployCodeTo("LootbagHook.sol:LootbagHook", abi.encode(PM, owner), hookAddr);
        hook = LootbagHook(hookAddr);
        payout = new LootbagPayout(owner);
        swapper = new LootbagSwapper(PM, owner, USDC);
        factory = new LootbagFactory(PM, IHooks(hookAddr), address(payout), owner, treasury, address(swapper), WETH);
        ethRouter = new LootbagRouter(PM, address(factory), address(swapper), WETH);
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
        // ETH in: WETH -> USDC and USDC -> VVV, joined through the hub for WETH -> VVV
        LootbagSwapper.Hop[] memory one = new LootbagSwapper.Hop[](1);
        one[0].kind = 0;
        one[0].pool = WETH_USDC_AERO;
        swapper.queueRoute(WETH, USDC, one);
        one[0].pool = VVV_USDC_UNI;
        swapper.queueRoute(USDC, VVV, one);
        assertTrue(factory.paused(), "the factory starts paused");
        factory.setPaused(false);
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

    function test_launchOpensThePoolAndMakesTheDevBuy() public {
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
        // nobody but the factory takes liquidity out
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

    /// @dev the whole loop: $LOOT launches against VVV, trading fills the Bag pot and the airdrop pot in VVV,
    ///      Bags mint with real $LOOT and VVV, and the hourly drop pays every Bag's vault
    function test_endToEndLootBagsAndAirdrop() public {
        address[] memory d = new address[](2);
        d[0] = VVV;
        d[1] = WETH;
        LootbagBags bags = new LootbagBags(VVV, address(swapper), owner, treasury, d);
        LootbagAirdrop air = new LootbagAirdrop(VVV, address(swapper), owner);
        vm.prank(owner);
        hook.setWallets(address(bags), address(air), treasury);

        (address loot, PoolKey memory key) = _launch("LOOT", 3 ether);
        vm.prank(owner);
        bags.setLoot(loot);
        vm.roll(block.number + 1);
        // two traders buy enough $LOOT to mint
        _buy(alice, key, loot, 400 ether);
        _buy(bob, key, loot, 400 ether);
        hook.split(VVV);
        uint256 potBefore = bags.pot();
        assertGt(potBefore, 0, "the Bag pot gets 25% of Lootbag's fees");
        assertGt(air.pot(), 0, "the airdrop pot gets 10%");

        for (uint256 i; i < 2; i++) {
            address w = [alice, bob][i];
            vm.startPrank(w);
            IERC20T(loot).approve(address(bags), type(uint256).max);
            IERC20T(VVV).approve(address(bags), type(uint256).max);
            bags.mint();
            vm.stopPrank();
        }
        assertEq(bags.minted(), 2);
        assertEq(LootbagToken(loot).balanceOf(bags.DEAD()) >= 200_000e18, true, "mints burn $LOOT");
        assertEq(bags.vault(1, VVV), 2.7 ether, "bag 1 got bob's mint");

        // the next VVV day's hourly drop
        vm.warp((block.timestamp / 2 days + 1) * 2 days + 1);
        assertEq(bags.today(), VVV);
        uint256 p = bags.pot();
        bags.drop(0);
        assertEq(bags.vault(2, VVV), (p * 5 / 100) / 2);
        address[] memory t = new address[](1);
        t[0] = VVV;
        uint256 b = IERC20T(VVV).balanceOf(alice);
        vm.prank(alice);
        bags.withdraw(1, t);
        assertEq(IERC20T(VVV).balanceOf(alice) - b, 2.7 ether + (p * 5 / 100) / 2);
    }


    // ================================================================== more cases

    function _launchQ(address quote, string memory sym, uint256 devBuy, address[] memory rewards)
        internal
        returns (address coin, PoolKey memory key)
    {
        vm.startPrank(creator);
        IERC20T(quote).approve(address(factory), devBuy);
        coin = factory.launch{value: factory.launchFee(sym)}(
            LootbagFactory.LaunchParams({name: "Coin", symbol: sym, quote: quote, rewards: rewards, devBuy: devBuy, minCoinsOut: 0})
        );
        vm.stopPrank();
        key = factory.poolKey(coin);
    }

    function _swapRaw(address who, PoolKey memory key, address tokenIn, address tokenOut, int256 amountSpecified, uint256 fund)
        internal
        returns (uint256 paidIn, uint256 gotOut)
    {
        vm.prank(who);
        IERC20T(tokenIn).transfer(address(router), fund);
        uint256 o0 = IERC20T(tokenOut).balanceOf(address(this));
        uint256 r0 = IERC20T(tokenIn).balanceOf(address(router));
        router.swap(key, Currency.unwrap(key.currency0) == tokenIn, amountSpecified);
        gotOut = IERC20T(tokenOut).balanceOf(address(this)) - o0;
        paidIn = r0 - IERC20T(tokenIn).balanceOf(address(router));
        IERC20T(tokenOut).transfer(who, gotOut);
    }

    function _fees() internal view returns (uint256) {
        return hook.owed(VVV) + hook.owedHolders(VVV);
    }

    function test_exactOutBuyAndSellAlsoPayTwoPercent() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        vm.roll(block.number + 1);
        // exact-out buy: ask for 1M coins, the fee is 2% of the VVV paid on top
        uint256 f0 = _fees();
        (uint256 paid,) = _swapRaw(alice, key, VVV, coin, int256(1_000_000e18), 50 ether);
        uint256 fee = _fees() - f0;
        assertApproxEqRel(fee, (paid - fee) * 2 / 100, 1e14, "exact-out buy");
        assertEq(LootbagToken(coin).balanceOf(alice), 1_000_000e18);
        // exact-out sell: ask for 0.05 VVV, the seller gets exactly that and the fee is 2% of the gross
        f0 = _fees();
        uint256 v0 = IERC20T(VVV).balanceOf(alice);
        _swapRaw(alice, key, coin, VVV, int256(0.05 ether), 1_000_000e18);
        assertEq(IERC20T(VVV).balanceOf(alice) - v0, 0.05 ether);
        assertApproxEqRel(_fees() - f0, uint256(0.05 ether) * 200 / 9800, 1e12, "exact-out sell");
    }

    function test_bothTokenOrdersWork() public {
        bool seen0;
        bool seen1;
        for (uint256 i; i < 12 && !(seen0 && seen1); i++) {
            string memory sym = string(abi.encodePacked("C", vm.toString(i)));
            (address coin, PoolKey memory key) = _launch(sym, 1 ether);
            bool coinIs0 = Currency.unwrap(key.currency0) == coin;
            if (coinIs0) seen0 = true;
            else seen1 = true;
            vm.roll(block.number + 1);
            uint256 got = _buy(alice, key, coin, 10 ether);
            assertGt(got, 0);
            uint256 back = _sell(alice, key, coin, got);
            // a round trip loses the two 2% fees and a hair of price impact, nothing more
            assertApproxEqRel(back, 10 ether * 96 / 100, 0.01e18);
        }
        assertTrue(seen0 && seen1, "both orders launched");
    }

    function test_usdcAndWethPairs() public {
        vm.startPrank(owner);
        factory.setQuote(USDC, true, -398_400, 1e6); // about $5K
        factory.setQuote(WETH, true, -149_600, 0.0005 ether); // about $5K at ETH near $1,700
        vm.stopPrank();
        deal(USDC, creator, 1_000e6);
        deal(WETH, creator, 1 ether);
        deal(USDC, alice, 1_000e6);
        deal(WETH, alice, 1 ether);
        address[] memory r = new address[](1);

        r[0] = USDC;
        (address cu, PoolKey memory ku) = _launchQ(USDC, "USDCOIN", 20e6, r);
        uint256 devU = LootbagToken(cu).balanceOf(creator);
        emit log_named_uint("USDC pair: $20 dev buy gets coins (M)", devU / 1e24);
        // $20 less the 2% fee is 0.392% of a $5K market cap
        assertApproxEqRel(devU, 1e27 * 392 / 100_000, 0.05e18, "opening near $5K");
        vm.roll(block.number + 1);
        uint256 h0 = hook.owedHolders(USDC);
        _swapRaw(alice, ku, USDC, cu, -int256(100e6), 100e6);
        assertEq(hook.owedHolders(USDC) - h0, 0.5e6, "0.5% of $100 to holders, in USDC");

        r[0] = WETH;
        (address cw, PoolKey memory kw) = _launchQ(WETH, "WETHCOIN", 0.01 ether, r);
        assertGt(LootbagToken(cw).balanceOf(creator), 0);
        vm.roll(block.number + 2);
        uint256 w0 = hook.owed(WETH) + hook.owedHolders(WETH); // the dev buy paid its 2% too
        _swapRaw(alice, kw, WETH, cw, -int256(0.1 ether), 0.1 ether);
        assertEq(hook.owed(WETH) + hook.owedHolders(WETH) - w0, 0.002 ether);
    }

    function test_strangersCannotUseTheHookOrTouchLiquidity() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        // a pool with our hook that the factory didn't make can't be created
        PoolKey memory k2 = key;
        k2.tickSpacing = 60;
        vm.expectRevert();
        PM.initialize(k2, TickMath.getSqrtPriceAtTick(0));
        // nobody else adds liquidity (it would dodge nothing, but the pools are the factory's alone)
        vm.prank(alice);
        vm.expectRevert();
        router.removeLiquidity(key, -887200, 887200, -1);
        // the hook's entry points answer the PoolManager only
        vm.expectRevert(LootbagHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, SwapParams(true, -1, 0), "");
        vm.expectRevert(LootbagHook.NotFactory.selector);
        hook.register(key.toId(), coin, VVV);
        // the payout books only what the hook sends
        vm.expectRevert(LootbagPayout.NotHook.selector);
        payout.credit(coin, 1 ether);
        // a token's rewards move only through the payout contract
        vm.expectRevert(LootbagToken.NotPayout.selector);
        LootbagToken(coin).take(alice);
    }

    function test_factoryRejectsBadLaunches() public {
        address[] memory r = new address[](1);
        r[0] = VVV;
        vm.startPrank(creator);
        IERC20T(VVV).approve(address(factory), 100 ether);
        LootbagFactory.LaunchParams memory p =
            LootbagFactory.LaunchParams({name: "Good", symbol: "GOOD", quote: VVV, rewards: r, devBuy: 1 ether, minCoinsOut: 0});
        p.symbol = "A";
        vm.expectRevert(LootbagFactory.BadSymbol.selector);
        factory.launch{value: 0.001 ether}(p);
        p.symbol = "BAD-1";
        vm.expectRevert(LootbagFactory.BadSymbol.selector);
        factory.launch{value: 0.001 ether}(p);
        p.symbol = "GOOD";
        p.name = "";
        vm.expectRevert(LootbagFactory.BadName.selector);
        factory.launch{value: 0.001 ether}(p);
        p.name = "Good";
        p.quote = USDC; // not listed in this test
        vm.expectRevert(LootbagFactory.BadQuote.selector);
        factory.launch{value: 0.001 ether}(p);
        p.quote = VVV;
        address[] memory bad = new address[](1);
        bad[0] = USDC; // not a listed reward
        p.rewards = bad;
        vm.expectRevert(LootbagFactory.BadRewards.selector);
        factory.launch{value: 0.001 ether}(p);
        p.rewards = new address[](0);
        vm.expectRevert(LootbagFactory.BadRewards.selector);
        factory.launch{value: 0.001 ether}(p);
        p.rewards = r;
        p.devBuy = 0.01 ether; // under the minimum
        vm.expectRevert(LootbagFactory.DevBuyTooSmall.selector);
        factory.launch{value: 0.001 ether}(p);
        p.devBuy = 1 ether;
        vm.expectRevert(LootbagFactory.BadFee.selector);
        factory.launch{value: 0}(p);
        p.minCoinsOut = 900_000_000e18;
        vm.expectRevert();
        factory.launch{value: 0.001 ether}(p);
        vm.stopPrank();
        vm.prank(owner);
        factory.setPaused(true);
        p.minCoinsOut = 0;
        vm.prank(creator);
        vm.expectRevert(LootbagFactory.Paused.selector);
        factory.launch{value: 0.001 ether}(p);
        // only the owner sets things
        vm.expectRevert(LootbagFactory.NotOwner.selector);
        factory.setPaused(false);
        vm.expectRevert(LootbagHook.NotOwner.selector);
        hook.setWallets(alice, alice, alice);
    }

    function test_payoutInBatchesAndNothingIsLost() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        vm.roll(block.number + 1);
        address[] memory ws = new address[](6);
        for (uint256 i; i < 6; i++) {
            ws[i] = makeAddr(string(abi.encodePacked("lootbag.test.h", vm.toString(i))));
            deal(VVV, ws[i], 100 ether);
            _buy(ws[i], key, coin, 20 ether + i * 5 ether);
        }
        uint256 held0 = payout.held(coin);
        address[] memory b1 = new address[](3);
        address[] memory b2 = new address[](3);
        for (uint256 i; i < 3; i++) {
            b1[i] = ws[i];
            b2[i] = ws[i + 3];
        }
        uint256 sumEarned;
        for (uint256 i; i < 6; i++) sumEarned += LootbagToken(coin).earned(ws[i]);
        vm.startPrank(keeper);
        uint256 o1 = payout.pay(coin, b1, 0);
        uint256 o2 = payout.pay(coin, b2, 0);
        vm.stopPrank();
        assertEq(o1 + o2, sumEarned, "every holder's part paid, in two batches of one round");
        assertEq(payout.held(coin), held0 - sumEarned);
        // the payout contract really holds what it still owes (after a flush)
        hook.flush(VVV);
        assertGe(IERC20T(VVV).balanceOf(address(payout)), payout.held(coin));
    }

    function test_swapperRouteChangesWait48Hours() public {
        LootbagSwapper.Hop[] memory hops = new LootbagSwapper.Hop[](1);
        hops[0].kind = 0;
        hops[0].pool = 0x1D2bdB7117a5A7D7fE4c1d95681a92e4Df13bB69; // VVV/WETH Uniswap v3 1%
        vm.prank(owner);
        swapper.queueRoute(VVV, WETH, hops);
        assertEq(swapper.route(VVV, WETH)[0].pool, VVV_USDC_UNI, "the old route stays for now");
        vm.expectRevert(LootbagSwapper.TooEarly.selector);
        swapper.applyRoute(VVV, WETH);
        vm.warp(block.timestamp + 48 hours);
        swapper.applyRoute(VVV, WETH);
        assertEq(swapper.route(VVV, WETH)[0].pool, hops[0].pool);
        // a pool that isn't mid-swap can't call back for tokens
        vm.prank(VVV_USDC_UNI);
        vm.expectRevert(LootbagSwapper.BadCallback.selector);
        swapper.uniswapV3SwapCallback(1, 1, abi.encode(VVV));
        // a swap that returns less than asked reverts
        deal(VVV, address(this), 10 ether);
        IERC20T(VVV).approve(address(swapper), 10 ether);
        vm.expectRevert();
        swapper.swap(VVV, WETH, 10 ether, 1_000 ether, address(this));
    }

    function test_pairsWithoutARouteGoThroughTheHub() public {
        // a fresh swapper with only VVV -> USDC and USDC -> WETH set: VVV -> WETH is put together from the two
        LootbagSwapper s2 = new LootbagSwapper(PM, owner, USDC);
        LootbagSwapper.Hop[] memory one = new LootbagSwapper.Hop[](1);
        one[0].kind = 0;
        deal(VVV, address(this), 20 ether);
        IERC20T(VVV).approve(address(s2), 20 ether);
        vm.expectRevert(LootbagSwapper.NoRoute.selector);
        s2.swap(VVV, WETH, 10 ether, 0, address(this));

        vm.startPrank(owner);
        one[0].pool = VVV_USDC_UNI;
        s2.queueRoute(VVV, USDC, one);
        vm.stopPrank();
        // half a way through is still no route
        vm.expectRevert(LootbagSwapper.NoRoute.selector);
        s2.swap(VVV, WETH, 10 ether, 0, address(this));
        assertEq(s2.hopsFor(VVV, WETH).length, 0);

        vm.startPrank(owner);
        one[0].pool = WETH_USDC_AERO;
        s2.queueRoute(USDC, WETH, one);
        vm.stopPrank();
        LootbagSwapper.Hop[] memory hops = s2.hopsFor(VVV, WETH);
        assertEq(hops.length, 2);
        assertEq(hops[0].pool, VVV_USDC_UNI);
        assertEq(hops[1].pool, WETH_USDC_AERO);
        assertEq(s2.route(VVV, WETH).length, 0, "no route of its own");

        uint256 viaHub = s2.swap(VVV, WETH, 10 ether, 1, address(this));
        assertGt(viaHub, 0);
        assertEq(IERC20T(WETH).balanceOf(address(this)), viaHub);
        // the swapper used by the rest of the tests has the same two pools as one VVV -> WETH route: same result
        deal(VVV, address(this), 10 ether);
        IERC20T(VVV).approve(address(swapper), 10 ether);
        assertApproxEqRel(swapper.swap(VVV, WETH, 10 ether, 1, address(this)), viaHub, 0.01e18);

        // a pair's own route wins over the hub, and into or out of the hub never doubles back
        assertEq(s2.hopsFor(VVV, USDC).length, 1);
        assertEq(s2.hopsFor(USDC, VVV).length, 0);
    }

    function test_gas() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        vm.roll(block.number + 1);
        vm.prank(alice);
        IERC20T(VVV).transfer(address(router), 10 ether);
        uint256 g = gasleft();
        router.swap(key, Currency.unwrap(key.currency0) == VVV, -int256(10 ether));
        emit log_named_uint("gas: a buy through the hook", g - gasleft());
    }

    function test_ownerCollectsAPoolAndHoldersKeepTheirRewards() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 100 ether);
        _buy(bob, key, coin, 100 ether);
        uint256 earnedA = LootbagToken(coin).earned(alice);
        assertGt(earnedA, 0);
        vm.expectRevert(LootbagFactory.NotOwner.selector);
        factory.collect(coin, 10_000, alice);
        address to = makeAddr("lootbag.test.collectTo");
        vm.prank(owner);
        (uint256 coins, uint256 quote) = factory.collect(coin, 10_000, to);
        // the pool held the unsold coins and the VVV buyers paid in (fees went to the hook)
        assertEq(IERC20T(coin).balanceOf(to), coins);
        assertEq(IERC20T(VVV).balanceOf(to), quote);
        assertApproxEqRel(quote, (3 ether + 200 ether) * 98 / 100, 0.001e18);
        (,, uint128 liq) = factory.positions(coin);
        assertEq(liq, 0);
        vm.prank(owner);
        vm.expectRevert(LootbagFactory.NothingToCollect.selector);
        factory.collect(coin, 10_000, to);
        // holder rewards were never in the pool: still claimable
        uint256 b = IERC20T(VVV).balanceOf(alice);
        vm.prank(alice);
        payout.claim(coin);
        assertApproxEqAbs(IERC20T(VVV).balanceOf(alice) - b, earnedA, 1);
    }

    function test_ownerCollectsAShareAndThePoolKeepsTrading() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether);
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 100 ether);
        address to = makeAddr("lootbag.test.collectShare");
        (,, uint128 liq0) = factory.positions(coin);

        // a share must be between 1 and 10,000 and needs a recipient
        vm.startPrank(owner);
        vm.expectRevert(LootbagFactory.BadBps.selector);
        factory.collect(coin, 0, to);
        vm.expectRevert(LootbagFactory.BadBps.selector);
        factory.collect(coin, 10_001, to);
        vm.expectRevert(LootbagFactory.ZeroAddress.selector);
        factory.collect(coin, 5_000, address(0));

        // half: half of the VVV buyers paid in and half of the unsold coins
        (uint256 coins, uint256 quote) = factory.collect(coin, 5_000, to);
        vm.stopPrank();
        assertEq(IERC20T(coin).balanceOf(to), coins);
        assertGt(coins, 0);
        assertApproxEqRel(quote, ((3 ether + 100 ether) * 98 / 100) / 2, 0.001e18);
        (,, uint128 liq1) = factory.positions(coin);
        assertEq(liq1, liq0 - liq0 / 2);

        // the pool still trades on what is left, and holders still earn
        uint256 before = LootbagToken(coin).earned(alice);
        _buy(bob, key, coin, 50 ether);
        assertGt(LootbagToken(coin).earned(alice), before);

        // the rest
        vm.prank(owner);
        factory.collect(coin, 10_000, to);
        (,, uint128 liq2) = factory.positions(coin);
        assertEq(liq2, 0);
    }

    // ------------------------------------------------------------------ ETH router

    function test_routerBuysAndSellsWithEthAndNeverHoldsCoins() public {
        (address coin,) = _launch("LOOT", 3 ether);
        LootbagToken t = LootbagToken(coin);
        vm.roll(block.number + 1);

        // alice buys with ETH: ETH -> WETH -> USDC -> VVV -> the coin
        uint256 aliceEth = alice.balance;
        vm.prank(alice);
        uint256 got = ethRouter.buy{value: 0.05 ether}(coin, 1, alice);
        assertEq(t.balanceOf(alice), got);
        assertGt(got, 0);
        assertEq(alice.balance, aliceEth - 0.05 ether);
        // and bob, so that there is a holder to earn from alice's sale
        vm.prank(bob);
        ethRouter.buy{value: 0.05 ether}(coin, 1, bob);

        // a buy that would return less than asked reverts and costs nothing
        vm.prank(alice);
        vm.expectRevert();
        ethRouter.buy{value: 0.05 ether}(coin, type(uint256).max, alice);

        // alice sells half for ETH: the coins go straight from her into the pool
        uint256 bobEarned = t.earned(bob);
        vm.startPrank(alice);
        t.approve(address(ethRouter), got / 2);
        uint256 before = alice.balance;
        uint256 ethOut = ethRouter.sell(coin, got / 2, 1, alice);
        vm.stopPrank();
        assertEq(alice.balance - before, ethOut);
        assertGt(ethOut, 0);
        assertLt(ethOut, 0.025 ether, "two 2% fees and two swaps: less than half of what went in");
        assertEq(t.balanceOf(alice), got - got / 2);
        assertGt(t.earned(bob), bobEarned, "the sale paid the holders");

        // the router ends with nothing and earned nothing: it never held a coin
        assertEq(t.balanceOf(address(ethRouter)), 0);
        assertEq(t.earned(address(ethRouter)), 0);
        assertEq(IERC20T(VVV).balanceOf(address(ethRouter)), 0);
        assertEq(IERC20T(WETH).balanceOf(address(ethRouter)), 0);
        assertEq(address(ethRouter).balance, 0);

        // selling without an approval, or for more than it can return, reverts
        vm.startPrank(bob);
        vm.expectRevert();
        ethRouter.sell(coin, 1 ether, 0, bob);
        t.approve(address(ethRouter), type(uint256).max);
        vm.expectRevert();
        ethRouter.sell(coin, 1_000 ether, 100 ether, bob);
        vm.stopPrank();

        vm.expectRevert(LootbagRouter.UnknownCoin.selector);
        ethRouter.buy{value: 0.01 ether}(address(0xBEEF), 0, alice);
        vm.expectRevert(LootbagRouter.ZeroAmount.selector);
        ethRouter.buy(coin, 0, alice);
        // plain ETH sent to the router is refused
        (bool sent,) = address(ethRouter).call{value: 1}("");
        assertFalse(sent);
    }

    function test_routerTradesAWethPairedCoinWithoutASwap() public {
        vm.startPrank(owner);
        factory.setQuote(WETH, true, -149_600, 0.0005 ether);
        vm.stopPrank();
        address[] memory rewards = new address[](1);
        rewards[0] = WETH;
        vm.prank(creator);
        address coin = factory.launchWithEth{value: 0.001 ether + 0.01 ether}(
            LootbagFactory.LaunchParams({name: "Weth Coin", symbol: "WCOIN", quote: WETH, rewards: rewards, devBuy: 0, minCoinsOut: 1}),
            LootbagFactory.Meta("", "", "", "", ""),
            0
        );
        vm.roll(block.number + 1);
        vm.prank(alice);
        uint256 got = ethRouter.buy{value: 0.02 ether}(coin, 1, alice);
        vm.startPrank(alice);
        LootbagToken(coin).approve(address(ethRouter), got);
        uint256 ethOut = ethRouter.sell(coin, got, 1, alice);
        vm.stopPrank();
        // 2% in and 2% out, and the pool's own price move: a little under 96% comes back
        assertApproxEqRel(ethOut, 0.02 ether * 96 / 100, 0.01e18);
        assertEq(IERC20T(WETH).balanceOf(address(ethRouter)), 0);
    }

    function test_routerRefusesAPoolWithNoLiquidityLeft() public {
        (address coin,) = _launch("LOOT", 3 ether);
        vm.roll(block.number + 1);
        vm.prank(owner);
        factory.collect(coin, 10_000, owner);
        vm.prank(alice);
        vm.expectRevert(LootbagRouter.PoolTooThin.selector);
        ethRouter.buy{value: 0.01 ether}(coin, 0, alice);
    }

    // ------------------------------------------------------------------ launching with ETH

    event MetaSet(address indexed coin, string image, string description, string x, string telegram, string website);

    function _ethParams(string memory sym) internal pure returns (LootbagFactory.LaunchParams memory p) {
        address[] memory rewards = new address[](2);
        rewards[0] = WETH;
        rewards[1] = VVV;
        p = LootbagFactory.LaunchParams({name: "Eth Launch", symbol: sym, quote: VVV, rewards: rewards, devBuy: 0, minCoinsOut: 1});
    }

    function test_launchWithEthInOneTransaction() public {
        address newbie = makeAddr("lootbag.test.newbie"); // holds ETH and nothing else, has approved nothing
        vm.deal(newbie, 1 ether);
        LootbagFactory.Meta memory m = LootbagFactory.Meta("data:image/webp;base64,AAAA", "A coin launched with ETH only.", "https://x.com/eth", "", "https://eth.example");
        uint256 treasuryBefore = treasury.balance;

        vm.prank(newbie);
        vm.recordLogs();
        address coin = factory.launchWithEth{value: 0.001 ether + 0.02 ether}(_ethParams("ETHL"), m, 1);
        LootbagToken t = LootbagToken(coin);

        assertEq(newbie.balance, 1 ether - 0.021 ether, "exactly the fee and the dev buy left the wallet");
        assertEq(treasury.balance - treasuryBefore, 0.001 ether);
        uint256 dev = t.balanceOf(newbie);
        assertGt(dev, 0);
        assertLe(dev, factory.MAX_DEV_BUY());
        assertEq(factory.creatorOf(coin), newbie);
        assertTrue(t.excluded(newbie), "the creator never earns from their own coin");
        assertTrue(factory.metaSet(coin));
        // nothing is left behind in the factory
        assertEq(IERC20T(WETH).balanceOf(address(factory)), 0);
        assertEq(IERC20T(VVV).balanceOf(address(factory)), 0);
        assertEq(t.balanceOf(address(factory)), 0);
        assertEq(address(factory).balance, 0);

        // the picture, description and links were published in the launch
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == MetaSet.selector) {
                (string memory image, string memory desc, string memory x,, string memory web) =
                    abi.decode(logs[i].data, (string, string, string, string, string));
                assertEq(address(uint160(uint256(logs[i].topics[1]))), coin);
                assertEq(image, m.image);
                assertEq(desc, m.description);
                assertEq(x, m.x);
                assertEq(web, m.website);
                found = true;
            }
        }
        assertTrue(found, "MetaSet was emitted");

        // they are published once: not by anyone else, and not again
        vm.expectRevert(LootbagFactory.NotCreator.selector);
        factory.setMeta(coin, m);
        vm.prank(newbie);
        vm.expectRevert(LootbagFactory.MetaAlreadySet.selector);
        factory.setMeta(coin, m);

        // the coin trades like any other
        vm.roll(block.number + 1);
        vm.prank(alice);
        assertGt(ethRouter.buy{value: 0.01 ether}(coin, 1, alice), 0);
    }

    function test_launchWithEthRejectsBadLaunches() public {
        address newbie = makeAddr("lootbag.test.newbie2");
        vm.deal(newbie, 10 ether);
        LootbagFactory.Meta memory none = LootbagFactory.Meta("", "", "", "", "");
        vm.startPrank(newbie);
        // only the fee: nothing left for the dev buy
        vm.expectRevert(LootbagFactory.NoEthForDevBuy.selector);
        factory.launchWithEth{value: 0.001 ether}(_ethParams("NOPE"), none, 0);
        // a dev buy under the minimum (0.1 VVV in this test's setup)
        vm.expectRevert(LootbagFactory.DevBuyTooSmall.selector);
        factory.launchWithEth{value: 0.001 ether + 0.00001 ether}(_ethParams("NOPE"), none, 0);
        // a dev buy that would take more than 2% of the supply
        vm.expectRevert();
        factory.launchWithEth{value: 0.001 ether + 1 ether}(_ethParams("NOPE"), none, 0);
        // the swap into the quote returning less than asked
        vm.expectRevert();
        factory.launchWithEth{value: 0.001 ether + 0.02 ether}(_ethParams("NOPE"), none, 1_000_000 ether);
        // a picture too large to publish
        bytes memory big = new bytes(24_001);
        vm.expectRevert(LootbagFactory.MetaTooLong.selector);
        factory.launchWithEth{value: 0.001 ether + 0.02 ether}(_ethParams("NOPE"), LootbagFactory.Meta(string(big), "", "", "", ""), 0);
        vm.stopPrank();
        assertEq(newbie.balance, 10 ether, "every failed launch cost nothing");

        // launched with nothing to publish, the creator can still publish once later
        vm.prank(newbie);
        address coin = factory.launchWithEth{value: 0.001 ether + 0.02 ether}(_ethParams("LATER"), none, 0);
        assertFalse(factory.metaSet(coin));
        vm.prank(newbie);
        factory.setMeta(coin, LootbagFactory.Meta("", "Added afterwards.", "", "", ""));
        assertTrue(factory.metaSet(coin));

        // a paused factory launches nothing either way
        vm.prank(owner);
        factory.setPaused(true);
        vm.prank(newbie);
        vm.expectRevert(LootbagFactory.Paused.selector);
        factory.launchWithEth{value: 0.001 ether + 0.02 ether}(_ethParams("PAUSED"), none, 0);
    }
}
