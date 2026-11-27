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
import {KinetiqPumpFactory} from "../src/KinetiqPumpFactory.sol";
import {KinetiqPumpPayout} from "../src/KinetiqPumpPayout.sol";
import {KinetiqPumpSwapper} from "../src/KinetiqPumpSwapper.sol";
import {KinetiqPumpRouter} from "../src/KinetiqPumpRouter.sol";
import {LootbagToken} from "../src/LootbagToken.sol";
import {KinetiqPumpBags} from "../src/KinetiqPumpBags.sol";
import {KinetiqPumpAirdrop} from "../src/KinetiqPumpAirdrop.sol";

interface IERC20T {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

interface IWrapped {
    function deposit() external payable;
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

/// @dev The whole KinetiqPump stack on a fork of Elysium, against Elysium's own Uniswap v4 PoolManager, WHYPE, KNTQ and
///      the WHYPE/KNTQ pool the routes use. Amounts are at the prices the deployment is planned at: HYPE near $65,
///      KNTQ near $0.21 (about 305 KNTQ to the HYPE), every coin opening near a $5K market cap.
///        forge test --match-contract ElysiumForkTest        (ELYSIUM_RPC overrides the public RPC)
contract ElysiumForkTest is Test {
    IPoolManager constant PM = IPoolManager(0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1);
    address constant KNTQ = 0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0;
    address constant WHYPE = 0xbA876237B0F021A6c6D852d6c26E107997cC5E81;
    // the WHYPE/KNTQ pool on Elysium's Uniswap v4 that holds most of KNTQ's liquidity (dynamic fee, its own hook)
    address constant KNTQ_POOL_HOOK = 0xd47020285b80Bb3f4a4BcbDf4f4D2891ba24BDe3;
    // a token the tests never list (EQNVDA, a stock token on Elysium)
    address constant UNLISTED = 0x5CeFf5C7316067b81B537a9aE011d6882f0A558A;

    // the planned deployment values
    uint256 constant LAUNCH_FEE = 0.025 ether; // HYPE
    uint256 constant COPY_FEE = 1.25 ether; // HYPE
    int24 constant KNTQ_TICK = -106_600; // 1B coins worth about 23,480 KNTQ: about $5K
    int24 constant WHYPE_TICK = -163_800; // 1B coins worth about 77 HYPE: about $5K
    uint256 constant MIN_DEV_KNTQ = 40 ether;
    uint256 constant MIN_DEV_WHYPE = 0.13 ether;
    uint256 constant MINT_K = 400 ether; // a Bag mint, in KNTQ
    // the Base tests' amounts, carried over at the same dollar size: 1 VVV there is 130 KNTQ here, 1 ETH is 26 HYPE
    uint256 constant KX = 130;
    uint256 constant HX = 26;

    address owner = makeAddr("kpump.test.owner");
    address treasury = makeAddr("kpump.test.treasury");
    address bagPot = makeAddr("kpump.test.bagPot");
    address airdropPot = makeAddr("kpump.test.airdropPot");
    address keeper = makeAddr("kpump.test.keeper");
    address creator = makeAddr("kpump.test.creator");
    address sniper = makeAddr("kpump.test.sniper");
    address alice = makeAddr("kpump.test.alice");
    address bob = makeAddr("kpump.test.bob");

    LootbagHook hook;
    KinetiqPumpFactory factory;
    KinetiqPumpPayout payout;
    KinetiqPumpSwapper swapper;
    TestRouter router;
    KinetiqPumpRouter ethRouter;

    function _kntqPool() internal pure returns (KinetiqPumpSwapper.Hop[] memory one) {
        one = new KinetiqPumpSwapper.Hop[](1);
        one[0].kind = 1;
        one[0].key = PoolKey(Currency.wrap(WHYPE), Currency.wrap(KNTQ), 0x800000, 50, IHooks(KNTQ_POOL_HOOK));
    }

    /// @dev KNTQ for a test wallet, out of what the PoolManager holds for the pools
    function _giveK(address to, uint256 amt) internal {
        vm.prank(address(PM));
        IERC20T(KNTQ).transfer(to, amt);
    }

    /// @dev WHYPE for a test wallet, wrapped from HYPE
    function _giveW(address to, uint256 amt) internal {
        vm.deal(address(this), amt);
        IWrapped(WHYPE).deposit{value: amt}();
        IERC20T(WHYPE).transfer(to, amt);
    }

    function setUp() public {
        vm.createSelectFork(vm.envOr("ELYSIUM_RPC", string("https://rpc.elysium.kinetiq.xyz")));
        // the hook must sit at an address whose low bits are its permissions
        address hookAddr = address((uint160(uint256(keccak256("kpump.hook"))) & ~uint160(0x3FFF)) | 0x2ACC);
        deployCodeTo("LootbagHook.sol:LootbagHook", abi.encode(PM, owner), hookAddr);
        hook = LootbagHook(hookAddr);
        payout = new KinetiqPumpPayout(owner);
        swapper = new KinetiqPumpSwapper(PM, owner, WHYPE);
        factory = new KinetiqPumpFactory(
            PM, IHooks(hookAddr), address(payout), owner, treasury, address(swapper), WHYPE, LAUNCH_FEE, COPY_FEE
        );
        ethRouter = new KinetiqPumpRouter(PM, address(factory), address(swapper), WHYPE);
        router = new TestRouter(PM);

        vm.startPrank(owner);
        hook.init(address(factory), address(payout), bagPot, airdropPot, treasury);
        payout.init(address(factory), address(hook), address(swapper), WHYPE);
        payout.setKeeper(keeper, true);
        factory.setQuote(KNTQ, true, KNTQ_TICK, MIN_DEV_KNTQ);
        factory.setQuote(WHYPE, true, WHYPE_TICK, MIN_DEV_WHYPE);
        factory.setReward(KNTQ, true);
        factory.setReward(WHYPE, true);
        // KNTQ <-> WHYPE both ways through the one pool; WHYPE is the hub
        swapper.queueRoute(KNTQ, WHYPE, _kntqPool());
        swapper.queueRoute(WHYPE, KNTQ, _kntqPool());
        assertTrue(factory.paused(), "the factory starts paused");
        factory.setPaused(false);
        vm.stopPrank();

        for (uint256 i; i < 4; i++) {
            address w = [creator, sniper, alice, bob][i];
            _giveK(w, 1_000 ether * KX);
            vm.deal(w, 1 ether * HX);
        }
    }

    function _launch(string memory sym, uint256 devBuy) internal returns (address coin, PoolKey memory key) {
        address[] memory rewards = new address[](2);
        rewards[0] = KNTQ;
        rewards[1] = WHYPE;
        vm.startPrank(creator);
        IERC20T(KNTQ).approve(address(factory), devBuy);
        coin = factory.launch{value: factory.launchFee(sym)}(
            KinetiqPumpFactory.LaunchParams({name: "Loot", symbol: sym, quote: KNTQ, rewards: rewards, devBuy: devBuy, minCoinsOut: 0})
        );
        vm.stopPrank();
        key = factory.poolKey(coin);
    }

    function _buy(address who, PoolKey memory key, address coin, uint256 vvvIn) internal returns (uint256 got) {
        vm.prank(who);
        IERC20T(KNTQ).transfer(address(router), vvvIn);
        uint256 b = IERC20T(coin).balanceOf(who);
        router.swap(key, Currency.unwrap(key.currency0) == KNTQ, -int256(vvvIn));
        // the router forwards to msg.sender of swap (this test), so hand the coins on
        got = IERC20T(coin).balanceOf(address(this));
        IERC20T(coin).transfer(who, got);
        got = IERC20T(coin).balanceOf(who) - b;
    }

    function _sell(address who, PoolKey memory key, address coin, uint256 coinsIn) internal returns (uint256 got) {
        vm.prank(who);
        IERC20T(coin).transfer(address(router), coinsIn);
        uint256 b = IERC20T(KNTQ).balanceOf(address(this));
        router.swap(key, Currency.unwrap(key.currency0) == coin, -int256(coinsIn));
        got = IERC20T(KNTQ).balanceOf(address(this)) - b;
        IERC20T(KNTQ).transfer(who, got);
    }

    function test_launchOpensThePoolAndMakesTheDevBuy() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        LootbagToken t = LootbagToken(coin);
        uint256 dev = t.balanceOf(creator);
        assertGt(dev, 0);
        assertLe(dev, factory.MAX_DEV_BUY());
        assertTrue(t.excluded(creator));
        assertEq(t.balanceOf(address(factory)), 0, "factory keeps nothing");
        emit log_named_uint("treasury wei", treasury.balance);
        assertEq(treasury.balance, LAUNCH_FEE);
        // opening market cap: the dev buy of 390 KNTQ (about $83) moves price a little; supply at about $5K
        emit log_named_uint("dev buy coins", dev / 1e18);
        // nobody but the factory takes liquidity out
        int24 lo = Currency.unwrap(key.currency0) == coin ? KNTQ_TICK : TickMath.minUsableTick(200);
        int24 hi = Currency.unwrap(key.currency0) == coin ? TickMath.maxUsableTick(200) : -KNTQ_TICK;
        vm.expectRevert();
        router.removeLiquidity(key, lo, hi, 1);
        vm.prank(address(factory));
        vm.expectRevert();
        router.removeLiquidity(key, lo, hi, 1);
    }

    function test_feeIsTwoPercentInKntqBothWays() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        vm.roll(block.number + 1);
        uint256 owed0 = hook.owed(KNTQ) + hook.owedHolders(KNTQ);
        _buy(alice, key, coin, 100 ether * KX);
        uint256 fee = hook.owed(KNTQ) + hook.owedHolders(KNTQ) - owed0;
        assertEq(fee, 2 ether * KX, "2% of an exact-in buy");
        uint256 coins = LootbagToken(coin).balanceOf(alice);
        uint256 owed1 = hook.owed(KNTQ) + hook.owedHolders(KNTQ);
        uint256 out = _sell(alice, key, coin, coins / 2);
        uint256 sellFee = hook.owed(KNTQ) + hook.owedHolders(KNTQ) - owed1;
        assertApproxEqRel(sellFee, (out + sellFee) * 2 / 100, 1e12, "2% of an exact-in sell");
    }

    function test_holdersEarnSnipersAndCreatorDont() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        _buy(sniper, key, coin, 5 ether * KX); // same block as the launch
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 50 ether * KX);
        _buy(bob, key, coin, 50 ether * KX);
        _buy(alice, key, coin, 20 ether * KX);
        LootbagToken t = LootbagToken(coin);
        assertTrue(t.excluded(sniper));
        assertEq(t.earned(sniper), 0);
        assertEq(t.earned(creator), 0);
        assertGt(t.earned(alice), 0);
        assertGt(t.earned(bob), 0);
        // what the holders are owed is exactly what the payout contract holds for them (dust aside)
        assertApproxEqAbs(t.earned(alice) + t.earned(bob) + t.pendingReward(), payout.held(coin), 10);
    }

    function test_payoutRoundsPayKntqThenWhype() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 100 ether * KX);
        _buy(bob, key, coin, 100 ether * KX);
        _buy(alice, key, coin, 100 ether * KX);
        address[] memory hs = new address[](2);
        hs[0] = alice;
        hs[1] = bob;
        LootbagToken t = LootbagToken(coin);

        // round 0 pays KNTQ, straight from what is held
        assertEq(payout.currentReward(coin), KNTQ);
        uint256 ea = t.earned(alice);
        uint256 a0 = IERC20T(KNTQ).balanceOf(alice);
        vm.prank(keeper);
        payout.pay(coin, hs, 0);
        assertApproxEqAbs(IERC20T(KNTQ).balanceOf(alice) - a0, ea, 1);
        assertEq(t.earned(alice), 0);

        // round 1 pays WHYPE, bought with the KNTQ in Elysium's WHYPE/KNTQ pool
        _buy(bob, key, coin, 200 ether * KX);
        vm.warp(block.timestamp + 5 minutes);
        assertEq(payout.currentReward(coin), WHYPE);
        uint256 aHype = alice.balance;
        uint256 bHype = bob.balance;
        vm.prank(keeper);
        uint256 out = payout.pay(coin, hs, 1);
        assertGt(out, 0);
        // a WHYPE round arrives as HYPE itself: nothing to claim and nothing to unwrap
        assertEq(alice.balance - aHype + bob.balance - bHype, out, "the whole round reached the two wallets as HYPE");
        assertGt(alice.balance, aHype);
        assertGt(bob.balance, bHype);
        assertEq(IERC20T(WHYPE).balanceOf(alice), 0);
        assertEq(IERC20T(WHYPE).balanceOf(address(payout)), 0);
        assertEq(address(payout).balance, 0);
        emit log_named_decimal_uint("HYPE paid", out, 18);
    }

    function test_onlyKeepersRunRoundsButHoldersCanAlwaysClaim() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 100 ether * KX);
        _buy(bob, key, coin, 100 ether * KX);
        address[] memory hs = new address[](1);
        hs[0] = alice;
        vm.expectRevert(KinetiqPumpPayout.NotKeeper.selector);
        payout.pay(coin, hs, 0);
        uint256 e = LootbagToken(coin).earned(alice);
        uint256 b = IERC20T(KNTQ).balanceOf(alice);
        vm.prank(alice);
        payout.claim(coin);
        assertApproxEqAbs(IERC20T(KNTQ).balanceOf(alice) - b, e, 1);
    }

    function test_lootbagShareSplits25To10To65() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 100 ether * KX);
        uint256 owed = hook.owed(KNTQ);
        hook.split(KNTQ);
        assertEq(IERC20T(KNTQ).balanceOf(bagPot), owed * 25 / 100);
        assertEq(IERC20T(KNTQ).balanceOf(airdropPot), owed * 10 / 100);
        assertEq(IERC20T(KNTQ).balanceOf(treasury), owed - owed * 25 / 100 - owed * 10 / 100);
        assertEq(hook.owed(KNTQ), 0);
    }

    function test_copiedTickerPaysTheCopyFee() public {
        assertEq(factory.LAUNCH_FEE(), LAUNCH_FEE);
        assertEq(factory.COPY_FEE(), COPY_FEE);
        _launch("LOOT", 3 ether * KX);
        assertEq(factory.launchFee("loot"), LAUNCH_FEE + COPY_FEE);
        (address coin2,) = _launch("Loot", 3 ether * KX);
        assertEq(factory.copyFeeHeld(coin2), COPY_FEE);
        vm.prank(owner);
        factory.settleCopyFee(coin2, true);
        assertEq(creator.balance, 1 ether * HX - LAUNCH_FEE - (LAUNCH_FEE + COPY_FEE) + COPY_FEE);
    }

    function test_devBuyCappedAtTwoPercent() public {
        address[] memory rewards = new address[](1);
        rewards[0] = KNTQ;
        vm.startPrank(creator);
        IERC20T(KNTQ).approve(address(factory), 500 ether * KX);
        vm.expectRevert();
        factory.launch{value: LAUNCH_FEE}(
            KinetiqPumpFactory.LaunchParams({name: "Big", symbol: "BIG", quote: KNTQ, rewards: rewards, devBuy: 500 ether * KX, minCoinsOut: 0})
        );
        vm.stopPrank();
    }

    /// @dev the whole loop: $LOOT launches against KNTQ, trading fills the Bag pot and the airdrop pot in KNTQ,
    ///      Bags mint with real $LOOT and KNTQ, and the hourly drop pays every Bag's vault
    function test_endToEndLootBagsAndAirdrop() public {
        address[] memory d = new address[](2);
        d[0] = KNTQ;
        d[1] = WHYPE;
        KinetiqPumpBags bags = new KinetiqPumpBags(KNTQ, address(swapper), owner, treasury, d, MINT_K);
        KinetiqPumpAirdrop air = new KinetiqPumpAirdrop(KNTQ, address(swapper), owner);
        vm.prank(owner);
        hook.setWallets(address(bags), address(air), treasury);

        (address loot, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        vm.prank(owner);
        bags.setLoot(loot);
        vm.roll(block.number + 1);
        // two traders buy enough $LOOT to mint
        _buy(alice, key, loot, 400 ether * KX);
        _buy(bob, key, loot, 400 ether * KX);
        hook.split(KNTQ);
        uint256 potBefore = bags.pot();
        assertGt(potBefore, 0, "the Bag pot gets 25% of KinetiqPump's fees");
        assertGt(air.pot(), 0, "the airdrop pot gets 10%");

        for (uint256 i; i < 2; i++) {
            address w = [alice, bob][i];
            vm.startPrank(w);
            IERC20T(loot).approve(address(bags), type(uint256).max);
            IERC20T(KNTQ).approve(address(bags), type(uint256).max);
            bags.mint();
            vm.stopPrank();
        }
        assertEq(bags.minted(), 2);
        assertEq(LootbagToken(loot).balanceOf(bags.DEAD()) >= 200_000e18, true, "mints burn $LOOT");
        assertEq(bags.vault(1, KNTQ), MINT_K * 9 / 10, "bag 1 got bob's mint");

        // the next KNTQ day's hourly drop
        vm.warp((block.timestamp / 2 days + 1) * 2 days + 1);
        assertEq(bags.today(), KNTQ);
        uint256 p = bags.pot();
        bags.drop(0);
        assertEq(bags.vault(2, KNTQ), (p * 5 / 100) / 2);
        address[] memory t = new address[](1);
        t[0] = KNTQ;
        uint256 b = IERC20T(KNTQ).balanceOf(alice);
        vm.prank(alice);
        bags.withdraw(1, t);
        assertEq(IERC20T(KNTQ).balanceOf(alice) - b, MINT_K * 9 / 10 + (p * 5 / 100) / 2);
    }


    // ================================================================== more cases

    function _launchQ(address quote, string memory sym, uint256 devBuy, address[] memory rewards)
        internal
        returns (address coin, PoolKey memory key)
    {
        vm.startPrank(creator);
        IERC20T(quote).approve(address(factory), devBuy);
        coin = factory.launch{value: factory.launchFee(sym)}(
            KinetiqPumpFactory.LaunchParams({name: "Coin", symbol: sym, quote: quote, rewards: rewards, devBuy: devBuy, minCoinsOut: 0})
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
        return hook.owed(KNTQ) + hook.owedHolders(KNTQ);
    }

    function test_exactOutBuyAndSellAlsoPayTwoPercent() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        vm.roll(block.number + 1);
        // exact-out buy: ask for 1M coins, the fee is 2% of the KNTQ paid on top
        uint256 f0 = _fees();
        (uint256 paid,) = _swapRaw(alice, key, KNTQ, coin, int256(1_000_000e18), 50 ether * KX);
        uint256 fee = _fees() - f0;
        assertApproxEqRel(fee, (paid - fee) * 2 / 100, 1e14, "exact-out buy");
        assertEq(LootbagToken(coin).balanceOf(alice), 1_000_000e18);
        // exact-out sell: ask for 0.05 KNTQ, the seller gets exactly that and the fee is 2% of the gross
        f0 = _fees();
        uint256 v0 = IERC20T(KNTQ).balanceOf(alice);
        _swapRaw(alice, key, coin, KNTQ, int256(0.05 ether * KX), 1_000_000e18);
        assertEq(IERC20T(KNTQ).balanceOf(alice) - v0, 0.05 ether * KX);
        assertApproxEqRel(_fees() - f0, uint256(0.05 ether * KX) * 200 / 9800, 1e12, "exact-out sell");
    }

    function test_bothTokenOrdersWork() public {
        bool seen0;
        bool seen1;
        for (uint256 i; i < 12 && !(seen0 && seen1); i++) {
            string memory sym = string(abi.encodePacked("C", vm.toString(i)));
            (address coin, PoolKey memory key) = _launch(sym, 1 ether * KX);
            bool coinIs0 = Currency.unwrap(key.currency0) == coin;
            if (coinIs0) seen0 = true;
            else seen1 = true;
            vm.roll(block.number + 1);
            uint256 got = _buy(alice, key, coin, 10 ether * KX);
            assertGt(got, 0);
            uint256 back = _sell(alice, key, coin, got);
            // a round trip loses the two 2% fees and a hair of price impact, nothing more
            assertApproxEqRel(back, 10 ether * KX * 96 / 100, 0.01e18);
        }
        assertTrue(seen0 && seen1, "both orders launched");
    }

    function test_bothQuotesOpenNearFiveThousandDollars() public {
        _giveW(creator, 10 ether);
        _giveW(alice, 10 ether);
        address[] memory r = new address[](1);

        // KNTQ pair: the supply is worth about 23,477 KNTQ at the opening tick; 400 KNTQ less the 2% fee buys
        // 392 / (23,477 + 392) of it
        r[0] = KNTQ;
        (address ck,) = _launchQ(KNTQ, "KCOIN", 400 ether, r);
        assertApproxEqRel(LootbagToken(ck).balanceOf(creator), uint256(1e27) * 392 / 23_869, 0.02e18, "KNTQ pair opens near $5K");

        // WHYPE pair: the supply is worth about 77 HYPE; 1 HYPE less the fee buys 0.98 / (77.02 + 0.98) of it
        r[0] = WHYPE;
        (address cw, PoolKey memory kw) = _launchQ(WHYPE, "WCOIN", 1 ether, r);
        assertApproxEqRel(LootbagToken(cw).balanceOf(creator), uint256(1e27) * 98 / 7_800, 0.02e18, "WHYPE pair opens near $5K");

        vm.roll(block.number + 2);
        uint256 w0 = hook.owed(WHYPE) + hook.owedHolders(WHYPE); // the dev buy paid its 2% too
        uint256 h0 = hook.owedHolders(WHYPE);
        _swapRaw(alice, kw, WHYPE, cw, -int256(2 ether), 2 ether);
        assertEq(hook.owed(WHYPE) + hook.owedHolders(WHYPE) - w0, 0.04 ether, "2% of 2 WHYPE");
        assertEq(hook.owedHolders(WHYPE) - h0, 0.01 ether, "0.5% of the trade to holders, in WHYPE");
    }

    function test_strangersCannotUseTheHookOrTouchLiquidity() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
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
        hook.register(key.toId(), coin, KNTQ);
        // the payout books only what the hook sends
        vm.expectRevert(KinetiqPumpPayout.NotHook.selector);
        payout.credit(coin, 1 ether * KX);
        // a token's rewards move only through the payout contract
        vm.expectRevert(LootbagToken.NotPayout.selector);
        LootbagToken(coin).take(alice);
    }

    function test_factoryRejectsBadLaunches() public {
        address[] memory r = new address[](1);
        r[0] = KNTQ;
        vm.startPrank(creator);
        IERC20T(KNTQ).approve(address(factory), 100 ether * KX);
        KinetiqPumpFactory.LaunchParams memory p =
            KinetiqPumpFactory.LaunchParams({name: "Good", symbol: "GOOD", quote: KNTQ, rewards: r, devBuy: 1 ether * KX, minCoinsOut: 0});
        p.symbol = "A";
        vm.expectRevert(KinetiqPumpFactory.BadSymbol.selector);
        factory.launch{value: LAUNCH_FEE}(p);
        p.symbol = "BAD-1";
        vm.expectRevert(KinetiqPumpFactory.BadSymbol.selector);
        factory.launch{value: LAUNCH_FEE}(p);
        p.symbol = "GOOD";
        p.name = "";
        vm.expectRevert(KinetiqPumpFactory.BadName.selector);
        factory.launch{value: LAUNCH_FEE}(p);
        p.name = "Good";
        p.quote = UNLISTED; // not listed
        vm.expectRevert(KinetiqPumpFactory.BadQuote.selector);
        factory.launch{value: LAUNCH_FEE}(p);
        p.quote = KNTQ;
        address[] memory bad = new address[](1);
        bad[0] = UNLISTED; // not a listed reward
        p.rewards = bad;
        vm.expectRevert(KinetiqPumpFactory.BadRewards.selector);
        factory.launch{value: LAUNCH_FEE}(p);
        p.rewards = new address[](0);
        vm.expectRevert(KinetiqPumpFactory.BadRewards.selector);
        factory.launch{value: LAUNCH_FEE}(p);
        p.rewards = r;
        p.devBuy = 0.01 ether * KX; // under the minimum
        vm.expectRevert(KinetiqPumpFactory.DevBuyTooSmall.selector);
        factory.launch{value: LAUNCH_FEE}(p);
        p.devBuy = 1 ether * KX;
        vm.expectRevert(KinetiqPumpFactory.BadFee.selector);
        factory.launch{value: 0}(p);
        p.minCoinsOut = 900_000_000e18;
        vm.expectRevert();
        factory.launch{value: LAUNCH_FEE}(p);
        vm.stopPrank();
        vm.prank(owner);
        factory.setPaused(true);
        p.minCoinsOut = 0;
        vm.prank(creator);
        vm.expectRevert(KinetiqPumpFactory.Paused.selector);
        factory.launch{value: LAUNCH_FEE}(p);
        // only the owner sets things
        vm.expectRevert(KinetiqPumpFactory.NotOwner.selector);
        factory.setPaused(false);
        vm.expectRevert(LootbagHook.NotOwner.selector);
        hook.setWallets(alice, alice, alice);
    }

    function test_payoutInBatchesAndNothingIsLost() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        vm.roll(block.number + 1);
        address[] memory ws = new address[](6);
        for (uint256 i; i < 6; i++) {
            ws[i] = makeAddr(string(abi.encodePacked("kpump.test.h", vm.toString(i))));
            _giveK(ws[i], 100 ether * KX);
            _buy(ws[i], key, coin, 20 ether * KX + i * 5 ether * KX);
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
        hook.flush(KNTQ);
        assertGe(IERC20T(KNTQ).balanceOf(address(payout)), payout.held(coin));
    }

    function test_swapperRouteChangesWait48Hours() public {
        // a swap that returns less than asked reverts; one that returns enough goes through
        _giveK(address(this), 10 ether * KX);
        IERC20T(KNTQ).approve(address(swapper), 10 ether * KX);
        vm.expectRevert();
        swapper.swap(KNTQ, WHYPE, 10 ether * KX, 1_000 ether, address(this));
        assertGt(swapper.swap(KNTQ, WHYPE, 5 ether * KX, 1, address(this)), 0);

        KinetiqPumpSwapper.Hop[] memory hops = _kntqPool();
        hops[0].key.tickSpacing = 60; // another pool's key
        vm.prank(owner);
        swapper.queueRoute(KNTQ, WHYPE, hops);
        assertEq(swapper.route(KNTQ, WHYPE)[0].key.tickSpacing, 50, "the old route stays for now");
        vm.expectRevert(KinetiqPumpSwapper.TooEarly.selector);
        swapper.applyRoute(KNTQ, WHYPE);
        vm.warp(block.timestamp + 48 hours);
        swapper.applyRoute(KNTQ, WHYPE);
        assertEq(swapper.route(KNTQ, WHYPE)[0].key.tickSpacing, 60);
        // only the owner queues routes
        vm.expectRevert(KinetiqPumpSwapper.NotOwner.selector);
        swapper.queueRoute(KNTQ, WHYPE, hops);
        // a pool that isn't mid-swap can't call back for tokens
        vm.prank(KNTQ_POOL_HOOK);
        vm.expectRevert(KinetiqPumpSwapper.BadCallback.selector);
        swapper.uniswapV3SwapCallback(1, 1, abi.encode(KNTQ));
    }

    function test_pairsWithoutARouteGoThroughTheHub() public {
        // a coin paired with WHYPE. KNTQ has no route of its own into it, so KNTQ -> the coin is put together from
        // KNTQ -> WHYPE (the hub) and WHYPE -> the coin (the coin's own KinetiqPump pool)
        _giveW(creator, 2 ether);
        address[] memory r = new address[](1);
        r[0] = WHYPE;
        (address coin, PoolKey memory kc) = _launchQ(WHYPE, "HUBBED", 1 ether, r);
        vm.roll(block.number + 1);
        KinetiqPumpSwapper s2 = new KinetiqPumpSwapper(PM, owner, WHYPE);
        _giveK(address(this), 20 ether * KX);
        IERC20T(KNTQ).approve(address(s2), 20 ether * KX);
        vm.expectRevert(KinetiqPumpSwapper.NoRoute.selector);
        s2.swap(KNTQ, coin, 10 ether * KX, 0, address(this));

        vm.prank(owner);
        s2.queueRoute(KNTQ, WHYPE, _kntqPool());
        // half a way through is still no route
        vm.expectRevert(KinetiqPumpSwapper.NoRoute.selector);
        s2.swap(KNTQ, coin, 10 ether * KX, 0, address(this));
        assertEq(s2.hopsFor(KNTQ, coin).length, 0);

        KinetiqPumpSwapper.Hop[] memory own = new KinetiqPumpSwapper.Hop[](1);
        own[0].kind = 1;
        own[0].key = kc;
        vm.prank(owner);
        s2.queueRoute(WHYPE, coin, own);
        KinetiqPumpSwapper.Hop[] memory hops = s2.hopsFor(KNTQ, coin);
        assertEq(hops.length, 2);
        assertEq(address(hops[0].key.hooks), KNTQ_POOL_HOOK);
        assertEq(address(hops[1].key.hooks), address(hook));
        assertEq(s2.route(KNTQ, coin).length, 0, "no route of its own");

        uint256 viaHub = s2.swap(KNTQ, coin, 10 ether * KX, 1, address(this));
        assertGt(viaHub, 0);
        assertEq(IERC20T(coin).balanceOf(address(this)), viaHub);

        // a pair's own route wins over the hub, and into or out of the hub never doubles back
        assertEq(s2.hopsFor(KNTQ, WHYPE).length, 1);
        assertEq(s2.hopsFor(WHYPE, KNTQ).length, 0);
    }

    function test_gas() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        vm.roll(block.number + 1);
        vm.prank(alice);
        IERC20T(KNTQ).transfer(address(router), 10 ether * KX);
        uint256 g = gasleft();
        router.swap(key, Currency.unwrap(key.currency0) == KNTQ, -int256(10 ether * KX));
        emit log_named_uint("gas: a buy through the hook", g - gasleft());
    }

    function test_ownerCollectsAPoolAndHoldersKeepTheirRewards() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 100 ether * KX);
        _buy(bob, key, coin, 100 ether * KX);
        uint256 earnedA = LootbagToken(coin).earned(alice);
        assertGt(earnedA, 0);
        vm.expectRevert(KinetiqPumpFactory.NotOwner.selector);
        factory.collect(coin, 10_000, alice);
        address to = makeAddr("kpump.test.collectTo");
        vm.prank(owner);
        (uint256 coins, uint256 quote) = factory.collect(coin, 10_000, to);
        // the pool held the unsold coins and the KNTQ buyers paid in (fees went to the hook)
        assertEq(IERC20T(coin).balanceOf(to), coins);
        assertEq(IERC20T(KNTQ).balanceOf(to), quote);
        assertApproxEqRel(quote, (3 ether * KX + 200 ether * KX) * 98 / 100, 0.001e18);
        (,, uint128 liq) = factory.positions(coin);
        assertEq(liq, 0);
        vm.prank(owner);
        vm.expectRevert(KinetiqPumpFactory.NothingToCollect.selector);
        factory.collect(coin, 10_000, to);
        // holder rewards were never in the pool: still claimable
        uint256 b = IERC20T(KNTQ).balanceOf(alice);
        vm.prank(alice);
        payout.claim(coin);
        assertApproxEqAbs(IERC20T(KNTQ).balanceOf(alice) - b, earnedA, 1);
    }

    function test_ownerCollectsAShareAndThePoolKeepsTrading() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 100 ether * KX);
        address to = makeAddr("kpump.test.collectShare");
        (,, uint128 liq0) = factory.positions(coin);

        // a share must be between 1 and 10,000 and needs a recipient
        vm.startPrank(owner);
        vm.expectRevert(KinetiqPumpFactory.BadBps.selector);
        factory.collect(coin, 0, to);
        vm.expectRevert(KinetiqPumpFactory.BadBps.selector);
        factory.collect(coin, 10_001, to);
        vm.expectRevert(KinetiqPumpFactory.ZeroAddress.selector);
        factory.collect(coin, 5_000, address(0));

        // half: half of the KNTQ buyers paid in and half of the unsold coins
        (uint256 coins, uint256 quote) = factory.collect(coin, 5_000, to);
        vm.stopPrank();
        assertEq(IERC20T(coin).balanceOf(to), coins);
        assertGt(coins, 0);
        assertApproxEqRel(quote, ((3 ether * KX + 100 ether * KX) * 98 / 100) / 2, 0.001e18);
        (,, uint128 liq1) = factory.positions(coin);
        assertEq(liq1, liq0 - liq0 / 2);

        // the pool still trades on what is left, and holders still earn
        uint256 before = LootbagToken(coin).earned(alice);
        _buy(bob, key, coin, 50 ether * KX);
        assertGt(LootbagToken(coin).earned(alice), before);

        // the rest
        vm.prank(owner);
        factory.collect(coin, 10_000, to);
        (,, uint128 liq2) = factory.positions(coin);
        assertEq(liq2, 0);
    }

    // ------------------------------------------------------------------ HYPE router

    function test_routerBuysAndSellsWithEthAndNeverHoldsCoins() public {
        (address coin,) = _launch("LOOT", 3 ether * KX);
        LootbagToken t = LootbagToken(coin);
        vm.roll(block.number + 1);

        // alice buys with HYPE: HYPE -> WHYPE -> KNTQ -> the coin
        uint256 aliceEth = alice.balance;
        vm.prank(alice);
        uint256 got = ethRouter.buy{value: 0.05 ether * HX}(coin, 1, alice);
        assertEq(t.balanceOf(alice), got);
        assertGt(got, 0);
        assertEq(alice.balance, aliceEth - 0.05 ether * HX);
        // and bob, so that there is a holder to earn from alice's sale
        vm.prank(bob);
        ethRouter.buy{value: 0.05 ether * HX}(coin, 1, bob);

        // a buy that would return less than asked reverts and costs nothing
        vm.prank(alice);
        vm.expectRevert();
        ethRouter.buy{value: 0.05 ether * HX}(coin, type(uint256).max, alice);

        // alice sells half for HYPE: the coins go straight from her into the pool
        uint256 bobEarned = t.earned(bob);
        vm.startPrank(alice);
        t.approve(address(ethRouter), got / 2);
        uint256 before = alice.balance;
        uint256 ethOut = ethRouter.sell(coin, got / 2, 1, alice);
        vm.stopPrank();
        assertEq(alice.balance - before, ethOut);
        assertGt(ethOut, 0);
        assertLt(ethOut, 0.025 ether * HX, "two 2% fees and two swaps: less than half of what went in");
        assertEq(t.balanceOf(alice), got - got / 2);
        assertGt(t.earned(bob), bobEarned, "the sale paid the holders");

        // the router ends with nothing and earned nothing: it never held a coin
        assertEq(t.balanceOf(address(ethRouter)), 0);
        assertEq(t.earned(address(ethRouter)), 0);
        assertEq(IERC20T(KNTQ).balanceOf(address(ethRouter)), 0);
        assertEq(IERC20T(WHYPE).balanceOf(address(ethRouter)), 0);
        assertEq(address(ethRouter).balance, 0);

        // selling without an approval, or for more than it can return, reverts
        vm.startPrank(bob);
        vm.expectRevert();
        ethRouter.sell(coin, 1 ether * HX, 0, bob);
        t.approve(address(ethRouter), type(uint256).max);
        vm.expectRevert();
        ethRouter.sell(coin, 1_000 ether * HX, 100 ether * HX, bob);
        vm.stopPrank();

        vm.expectRevert(KinetiqPumpRouter.UnknownCoin.selector);
        ethRouter.buy{value: 0.01 ether * HX}(address(0xBEEF), 0, alice);
        vm.expectRevert(KinetiqPumpRouter.ZeroAmount.selector);
        ethRouter.buy(coin, 0, alice);
        // plain HYPE sent to the router is refused
        (bool sent,) = address(ethRouter).call{value: 1}("");
        assertFalse(sent);
    }

    function test_routerTradesAWethPairedCoinWithoutASwap() public {
        address[] memory rewards = new address[](1);
        rewards[0] = WHYPE;
        vm.prank(creator);
        address coin = factory.launchWithEth{value: LAUNCH_FEE + 0.01 ether * HX}(
            KinetiqPumpFactory.LaunchParams({name: "Weth Coin", symbol: "WCOIN", quote: WHYPE, rewards: rewards, devBuy: 0, minCoinsOut: 1}),
            KinetiqPumpFactory.Meta("", "", "", "", ""),
            0
        );
        vm.roll(block.number + 1);
        vm.prank(alice);
        uint256 got = ethRouter.buy{value: 0.02 ether * HX}(coin, 1, alice);
        vm.startPrank(alice);
        LootbagToken(coin).approve(address(ethRouter), got);
        uint256 ethOut = ethRouter.sell(coin, got, 1, alice);
        vm.stopPrank();
        // 2% in and 2% out, and the pool's own price move: a little under 96% comes back
        assertApproxEqRel(ethOut, 0.02 ether * HX * 96 / 100, 0.01e18);
        assertEq(IERC20T(WHYPE).balanceOf(address(ethRouter)), 0);
    }

    function test_routerRefusesAPoolWithNoLiquidityLeft() public {
        (address coin,) = _launch("LOOT", 3 ether * KX);
        vm.roll(block.number + 1);
        vm.prank(owner);
        factory.collect(coin, 10_000, owner);
        vm.prank(alice);
        vm.expectRevert(KinetiqPumpRouter.PoolTooThin.selector);
        ethRouter.buy{value: 0.01 ether * HX}(coin, 0, alice);
    }

    // ------------------------------------------------------------------ launching with HYPE

    event MetaSet(address indexed coin, string image, string description, string x, string telegram, string website);

    function _ethParams(string memory sym) internal pure returns (KinetiqPumpFactory.LaunchParams memory p) {
        address[] memory rewards = new address[](2);
        rewards[0] = WHYPE;
        rewards[1] = KNTQ;
        p = KinetiqPumpFactory.LaunchParams({name: "Eth Launch", symbol: sym, quote: KNTQ, rewards: rewards, devBuy: 0, minCoinsOut: 1});
    }

    function test_launchWithEthInOneTransaction() public {
        address newbie = makeAddr("kpump.test.newbie"); // holds HYPE and nothing else, has approved nothing
        vm.deal(newbie, 1 ether * HX);
        KinetiqPumpFactory.Meta memory m = KinetiqPumpFactory.Meta("data:image/webp;base64,AAAA", "A coin launched with HYPE only.", "https://x.com/eth", "", "https://eth.example");
        uint256 treasuryBefore = treasury.balance;

        vm.prank(newbie);
        vm.recordLogs();
        address coin = factory.launchWithEth{value: LAUNCH_FEE + 0.02 ether * HX}(_ethParams("HYPEL"), m, 1);
        LootbagToken t = LootbagToken(coin);

        assertEq(newbie.balance, 1 ether * HX - LAUNCH_FEE - 0.02 ether * HX, "exactly the fee and the dev buy left the wallet");
        assertEq(treasury.balance - treasuryBefore, LAUNCH_FEE);
        uint256 dev = t.balanceOf(newbie);
        assertGt(dev, 0);
        assertLe(dev, factory.MAX_DEV_BUY());
        assertEq(factory.creatorOf(coin), newbie);
        assertTrue(t.excluded(newbie), "the creator never earns from their own coin");
        assertTrue(factory.metaSet(coin));
        // nothing is left behind in the factory
        assertEq(IERC20T(WHYPE).balanceOf(address(factory)), 0);
        assertEq(IERC20T(KNTQ).balanceOf(address(factory)), 0);
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
        vm.expectRevert(KinetiqPumpFactory.NotCreator.selector);
        factory.setMeta(coin, m);
        vm.prank(newbie);
        vm.expectRevert(KinetiqPumpFactory.MetaAlreadySet.selector);
        factory.setMeta(coin, m);

        // the coin trades like any other
        vm.roll(block.number + 1);
        vm.prank(alice);
        assertGt(ethRouter.buy{value: 0.01 ether * HX}(coin, 1, alice), 0);
    }

    function test_launchWithEthRejectsBadLaunches() public {
        address newbie = makeAddr("kpump.test.newbie2");
        vm.deal(newbie, 10 ether * HX);
        KinetiqPumpFactory.Meta memory none = KinetiqPumpFactory.Meta("", "", "", "", "");
        vm.startPrank(newbie);
        // only the fee: nothing left for the dev buy
        vm.expectRevert(KinetiqPumpFactory.NoEthForDevBuy.selector);
        factory.launchWithEth{value: LAUNCH_FEE}(_ethParams("NOPE"), none, 0);
        // a dev buy under the minimum (0.1 KNTQ in this test's setup)
        vm.expectRevert(KinetiqPumpFactory.DevBuyTooSmall.selector);
        factory.launchWithEth{value: LAUNCH_FEE + 0.00001 ether * HX}(_ethParams("NOPE"), none, 0);
        // a dev buy that would take more than 2% of the supply
        vm.expectRevert();
        factory.launchWithEth{value: LAUNCH_FEE + 1 ether * HX}(_ethParams("NOPE"), none, 0);
        // the swap into the quote returning less than asked
        vm.expectRevert();
        factory.launchWithEth{value: LAUNCH_FEE + 0.02 ether * HX}(_ethParams("NOPE"), none, 1_000_000 ether * HX);
        // a picture too large to publish
        bytes memory big = new bytes(24_001);
        vm.expectRevert(KinetiqPumpFactory.MetaTooLong.selector);
        factory.launchWithEth{value: LAUNCH_FEE + 0.02 ether * HX}(_ethParams("NOPE"), KinetiqPumpFactory.Meta(string(big), "", "", "", ""), 0);
        vm.stopPrank();
        assertEq(newbie.balance, 10 ether * HX, "every failed launch cost nothing");

        // launched with nothing to publish, the creator can still publish once later
        vm.prank(newbie);
        address coin = factory.launchWithEth{value: LAUNCH_FEE + 0.02 ether * HX}(_ethParams("LATER"), none, 0);
        assertFalse(factory.metaSet(coin));
        vm.prank(newbie);
        factory.setMeta(coin, KinetiqPumpFactory.Meta("", "Added afterwards.", "", "", ""));
        assertTrue(factory.metaSet(coin));

        // a paused factory launches nothing either way
        vm.prank(owner);
        factory.setPaused(true);
        vm.prank(newbie);
        vm.expectRevert(KinetiqPumpFactory.Paused.selector);
        factory.launchWithEth{value: LAUNCH_FEE + 0.02 ether * HX}(_ethParams("PAUSED"), none, 0);
    }

    // ------------------------------------------------------------------ the launch block

    /// @dev The coin is Lootbag's own, unchanged: the launch block is `block.number`. On Elysium that is the parent
    ///      chain's (HyperEVM's) block number, which stands still for some seconds, so a wallet that buys before it
    ///      moves is excluded even when a few Elysium blocks and seconds have gone by.
    function test_launchBlockIsBlockNumber() public {
        (address coin, PoolKey memory key) = _launch("LOOT", 3 ether * KX);
        LootbagToken t = LootbagToken(coin);
        assertEq(t.launchBlock(), block.number);
        vm.warp(block.timestamp + 5); // time passes, `block.number` has not moved
        _buy(sniper, key, coin, 5 ether * KX);
        assertTrue(t.excluded(sniper));
        vm.roll(block.number + 1);
        _buy(alice, key, coin, 50 ether * KX);
        assertFalse(t.excluded(alice), "a buyer after the launch block earns");
        _buy(bob, key, coin, 50 ether * KX);
        assertGt(t.earned(alice), 0);
        assertEq(t.earned(sniper), 0);
    }

    // ------------------------------------------------------------------ HYPE straight to the wallet

    /// @dev a WHYPE-paired coin: rounds and claims both pay HYPE itself
    function test_whypeRewardsArriveAsHype() public {
        _giveW(creator, 2 ether);
        _giveW(alice, 20 ether);
        _giveW(bob, 20 ether);
        address[] memory r = new address[](1);
        r[0] = WHYPE;
        (address coin, PoolKey memory kw) = _launchQ(WHYPE, "PAYHYPE", 1 ether, r);
        vm.roll(block.number + 1);
        _swapRaw(alice, kw, WHYPE, coin, -int256(5 ether), 5 ether);
        _swapRaw(bob, kw, WHYPE, coin, -int256(5 ether), 5 ether);
        LootbagToken t = LootbagToken(coin);

        // alice is paid by a keeper's round: HYPE lands in her wallet without her doing anything
        uint256 ea = t.earned(alice);
        assertGt(ea, 0);
        address[] memory hs = new address[](1);
        hs[0] = alice;
        uint256 a0 = alice.balance;
        uint256 w0 = IERC20T(WHYPE).balanceOf(alice);
        vm.prank(keeper);
        payout.pay(coin, hs, 0);
        assertApproxEqAbs(alice.balance - a0, ea, 1);
        assertEq(IERC20T(WHYPE).balanceOf(alice), w0, "no WHYPE to unwrap");

        // bob claims his own part instead: HYPE too
        _swapRaw(alice, kw, WHYPE, coin, -int256(5 ether), 5 ether);
        uint256 eb = t.earned(bob);
        assertGt(eb, 0);
        uint256 b0 = bob.balance;
        vm.prank(bob);
        payout.claim(coin);
        assertApproxEqAbs(bob.balance - b0, eb, 1);
        assertEq(address(payout).balance, 0, "the payout contract keeps no HYPE");
    }

    /// @dev a holder that is a contract with no way to receive HYPE is paid in WHYPE, and the round carries on
    function test_aWalletThatCannotTakeHypeGetsWhype() public {
        _giveW(creator, 2 ether);
        _giveW(alice, 20 ether);
        _giveW(bob, 20 ether);
        address[] memory r = new address[](1);
        r[0] = WHYPE;
        (address coin, PoolKey memory kw) = _launchQ(WHYPE, "NOHYPE", 1 ether, r);
        vm.roll(block.number + 1);
        (, uint256 got) = _swapRaw(alice, kw, WHYPE, coin, -int256(5 ether), 5 ether);
        // an airdrop pot stands in for such a holder: it has no receive function
        address stone = address(new KinetiqPumpAirdrop(KNTQ, address(swapper), owner));
        vm.prank(alice);
        IERC20T(coin).transfer(stone, got / 2);
        _swapRaw(bob, kw, WHYPE, coin, -int256(5 ether), 5 ether);
        LootbagToken t = LootbagToken(coin);
        uint256 es = t.earned(stone);
        uint256 ea = t.earned(alice);
        assertGt(es, 0);

        address[] memory hs = new address[](2);
        hs[0] = stone;
        hs[1] = alice;
        uint256 a0 = alice.balance;
        vm.prank(keeper);
        payout.pay(coin, hs, 0);
        assertApproxEqAbs(IERC20T(WHYPE).balanceOf(stone), es, 1, "paid in WHYPE instead");
        assertEq(stone.balance, 0);
        assertApproxEqAbs(alice.balance - a0, ea, 1, "the next holder still got HYPE");
        assertEq(address(payout).balance, 0);

        // HYPE sent to the payout contract by anyone but WHYPE is refused
        vm.deal(address(this), 1 ether);
        (bool sent,) = address(payout).call{value: 1}("");
        assertFalse(sent);
    }
}
