// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {HypexLimitOrders} from "../src/HypexLimitOrders.sol";
import {HypexToken} from "../src/HypexToken.sol";
import {Owned} from "../src/base/Owned.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IHypexFactory} from "../src/interfaces/IHypexFactory.sol";
import {IHypexLimitOrders} from "../src/interfaces/IHypexLimitOrders.sol";
import {IHypexRevenue} from "../src/interfaces/IHypexRevenue.sol";
import {MockEthUsdFeed} from "../script/MockEthUsdFeed.sol";
import {StartTick} from "../script/StartTick.sol";
import {MockQuote} from "./QuoteDecimals.t.sol";
import {RevenueBase} from "./Revenue.t.sol";

/// What every limit-order test needs: $HYPEX, an ETH pair (KUMO) and a $HYPEX pair (NEKO), all past their snipe windows
/// (RevenueBase._markets), a fresh ETH/USD feed at $2,600 (ETH whitelisted with it), a keeper, and helpers to place,
/// route, fill and read orders. With _usdSetup: a 6-decimal $1 quote (USDG on Robinhood Chain) whitelisted as a stable
/// pay token, an ETH/USD reference pool (no hook, as ETH/USDG) and a HYPEX pair on it (USDY). The all-in checks here are
/// computed exactly (no rounding), independently of the contract's.
abstract contract LimitOrdersBase is RevenueBase {
    uint256 constant ETH_USD = 2600e18; // the feed's price as fills see it (USD per ETH, 1e18-scaled)
    uint256 constant USD_PER_ETH = 2600; // the reference pool's price
    uint24 constant USD_POOL_FEE = 500;
    int24 constant USD_POOL_SPACING = 10;
    IHypexLimitOrders.Kind constant BUY = IHypexLimitOrders.Kind.BUY;
    IHypexLimitOrders.Kind constant SELL = IHypexLimitOrders.Kind.SELL;
    address keeper;

    MockQuote usd;
    PoolKey usdKey; // ETH/USD reference pool: ETH currency0, USD currency1
    address usdy; // a HYPEX pair on the USD quote
    PoolKey usdyKey;

    function setUp() public virtual override {
        super.setUp();
        _markets();
        keeper = makeAddr("keeper");
        limitOrders.setKeeper(keeper, true);
        _fresh();
    }

    /// PoolModifyLiquidityTest refunds the ETH a position didn't use
    receive() external payable {}

    /// The feed answers again now (tests move the clock past its max age)
    function _fresh() internal {
        feed.setAnswer(ETH_USD_8);
    }

    function _expiry() internal view returns (uint256) {
        return vm.getBlockTimestamp() + 1 days;
    }

    // ---------------------------------------------------------------- the USD quote

    /// The 6-decimal $1 quote, whitelisted as a stable pay token; the ETH/USD pool at USD_PER_ETH, 100 ETH deep; USDY
    /// launched on it, bought into and past its snipe window
    function _usdSetup() internal {
        usd = new MockQuote(6, 0);
        int24 mid = StartTick.forQuote(1e8, 6);
        factory.setQuoteBand(address(usd), mid - BAND_HALF, mid + BAND_HALF);
        factory.setQuoteAllowed(address(usd), true);
        usdKey = PoolKey(
            Currency.wrap(ETH), Currency.wrap(address(usd)), USD_POOL_FEE, USD_POOL_SPACING, IHooks(address(0))
        );
        _initUsdPool(usdKey, USD_PER_ETH, 100 ether);
        bytes32 s = _saltAfter(alice, address(usd), "Usdy", "USDY");
        vm.prank(alice);
        (usdy,) = factory.launch{value: FEE}(
            _signedBy(startSignerKey, alice, address(usd), "Usdy", "USDY", s, 0, mid, vm.getBlockTimestamp() + 1 hours)
        );
        usdyKey = hook.keyFor(address(usd), usdy);
        address bob = _usdUser("usdBuyer", 100_000);
        _swap(bob, usdyKey, true, -int256(uint256(5_000e6)), 0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 61);
        _fresh();
        limitOrders.setPayToken(address(usd), IAggregatorV3(address(0)), 0, true, true);
    }

    /// A full-range ETH/USD pool (with `key`'s hook) at `usdPerEth`, `eth` deep
    function _initUsdPool(PoolKey memory key, uint256 usdPerEth, uint256 eth) internal {
        pm.initialize(key, uint160(_sqrt((usdPerEth * 1e6 << 192) / 1e18)));
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(pm);
        usd.approve(address(lp), type(uint256).max);
        int24 maxTick = TickMath.MAX_TICK / USD_POOL_SPACING * USD_POOL_SPACING;
        lp.modifyLiquidity{value: eth + 1 ether}(
            key,
            // forge-lint: disable-next-line(unsafe-typecast)
            IPoolManager.ModifyLiquidityParams(-maxTick, maxTick, int256(_sqrt(eth * (eth * usdPerEth / 1e12))), 0),
            ""
        );
    }

    /// A wallet with ETH, $HYPEX and `amount` whole USD, approved for the router and HypexLimitOrders
    function _usdUser(string memory name, uint256 amount) internal returns (address u) {
        u = _trader(name);
        usd.transfer(u, amount * 1e6);
        vm.startPrank(u);
        usd.approve(address(router), type(uint256).max);
        usd.approve(address(limitOrders), type(uint256).max);
        vm.stopPrank();
        if (usdy != address(0)) _approve(u, usdy);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x >> 1) + 1;
        while (y < z) (z, y) = (y, (x / y + y) >> 1);
    }

    // ---------------------------------------------------------------- routes

    function _quoteOf(address token) internal view returns (address) {
        if (token == neko) return hypex;
        if (token != address(0) && token == usdy) return address(usd);
        return ETH; // $HYPEX and KUMO
    }

    function _hop(PoolKey memory key, bool zeroForOne) internal pure returns (IHypexLimitOrders.Hop memory) {
        return IHypexLimitOrders.Hop({key: key, zeroForOne: zeroForOne});
    }

    /// The shortest route a BUY of `token` paid in `pay` takes through the known pools: to ETH (the USD pool), on to
    /// the token's quote (the $HYPEX pool or the USD pool), then the token's pool
    function _buyRoute(address pay, address token) internal view returns (IHypexLimitOrders.Hop[] memory r) {
        address q = _quoteOf(token);
        IHypexLimitOrders.Hop[4] memory hops;
        uint256 n;
        address cur = pay;
        if (cur != q && cur != ETH) {
            hops[n++] = _hop(usdKey, false); // USD -> ETH
            cur = ETH;
        }
        if (cur != q) {
            hops[n++] = q == hypex ? _hop(hypexKey, true) : _hop(usdKey, true); // ETH -> $HYPEX or USD
        }
        hops[n++] = _hop(hook.keyFor(q, token), true);
        r = new IHypexLimitOrders.Hop[](n);
        for (uint256 i; i < n; i++) {
            r[i] = hops[i];
        }
    }

    /// A SELL's route: the BUY's, reversed
    function _sellRoute(address pay, address token) internal view returns (IHypexLimitOrders.Hop[] memory r) {
        IHypexLimitOrders.Hop[] memory b = _buyRoute(pay, token);
        r = new IHypexLimitOrders.Hop[](b.length);
        for (uint256 i; i < b.length; i++) {
            r[i] = _hop(b[b.length - 1 - i].key, !b[b.length - 1 - i].zeroForOne);
        }
    }

    function _routeOf(uint256 id) internal view returns (IHypexLimitOrders.Hop[] memory) {
        IHypexLimitOrders.Order memory o = _order(id);
        return o.kind == BUY ? _buyRoute(o.payToken, o.token) : _sellRoute(o.payToken, o.token);
    }

    // ---------------------------------------------------------------- placing and filling

    /// A BUY paid in ETH
    function _placeBuy(address owner, address token, uint256 amount, uint256 limit, uint256 maxFee)
        internal
        returns (uint256 id)
    {
        vm.prank(owner);
        id = limitOrders.place{value: amount}(BUY, token, ETH, amount, limit, _expiry(), maxFee);
    }

    /// A BUY paid in an ERC-20 (approved already)
    function _placeBuyIn(address pay, address owner, address token, uint256 amount, uint256 limit, uint256 maxFee)
        internal
        returns (uint256 id)
    {
        if (pay == ETH) return _placeBuy(owner, token, amount, limit, maxFee);
        vm.prank(owner);
        id = limitOrders.place(BUY, token, pay, amount, limit, _expiry(), maxFee);
    }

    /// A SELL paid in ETH
    function _placeSell(address owner, address token, uint256 amount, uint256 limit, uint256 maxFee)
        internal
        returns (uint256 id)
    {
        return _placeSellFor(ETH, owner, token, amount, limit, maxFee);
    }

    function _placeSellFor(address pay, address owner, address token, uint256 amount, uint256 limit, uint256 maxFee)
        internal
        returns (uint256 id)
    {
        vm.startPrank(owner);
        HypexToken(token).approve(address(limitOrders), amount);
        id = limitOrders.place(SELL, token, pay, amount, limit, _expiry(), maxFee);
        vm.stopPrank();
    }

    /// The keeper fills along the order's route (it is also tx.origin, as a keeper's own transaction)
    function _fill(uint256 id, uint256 amountIn, uint256 fee) internal returns (uint256) {
        return _fillVia(id, amountIn, fee, _routeOf(id));
    }

    function _fillVia(uint256 id, uint256 amountIn, uint256 fee, IHypexLimitOrders.Hop[] memory route)
        internal
        returns (uint256)
    {
        vm.prank(keeper, keeper);
        return limitOrders.fill(id, amountIn, fee, route);
    }

    function _expectFillRevert(uint256 id, uint256 amountIn, uint256 fee, bytes4 err) internal {
        _expectFillRevertVia(id, amountIn, fee, _routeOf(id), err);
    }

    /// The same, for an error with arguments (vm.expectRevert(bytes4) matches the selector alone only when the error
    /// has none)
    function _expectFillRevert(uint256 id, uint256 amountIn, uint256 fee, bytes memory err) internal {
        IHypexLimitOrders.Hop[] memory route = _routeOf(id);
        vm.prank(keeper, keeper);
        vm.expectRevert(err);
        limitOrders.fill(id, amountIn, fee, route);
    }

    function _expectFillRevertVia(
        uint256 id,
        uint256 amountIn,
        uint256 fee,
        IHypexLimitOrders.Hop[] memory route,
        bytes4 err
    ) internal {
        vm.prank(keeper, keeper);
        vm.expectRevert(err);
        limitOrders.fill(id, amountIn, fee, route);
    }

    /// The keeper's fill as a low-level call (for probes and fuzzing)
    function _tryFill(uint256 id, uint256 amountIn, uint256 fee) internal returns (bool ok, bytes memory ret) {
        IHypexLimitOrders.Hop[] memory route = _routeOf(id);
        vm.prank(keeper, keeper);
        (ok, ret) = address(limitOrders).call(abi.encodeCall(limitOrders.fill, (id, amountIn, fee, route)));
    }

    function _order(uint256 id) internal view returns (IHypexLimitOrders.Order memory) {
        return limitOrders.getOrder(id);
    }

    /// A wallet with ETH, $HYPEX, KUMO and NEKO
    function _holder(string memory name) internal returns (address h) {
        h = _trader(name);
        _swap(h, kumoKey, true, -2 ether, 2 ether);
        _swap(h, nekoKey, true, -int256(HypexToken(hypex).balanceOf(h) / 2), 0);
    }

    // ---------------------------------------------------------------- exact checks

    function _payPrice(address pay) internal view returns (uint256) {
        return pay == ETH ? ETH_USD : 1e18;
    }

    function _unit(address pay) internal view returns (uint256) {
        return pay == ETH ? 1e18 : 10 ** usd.decimals();
    }

    /// Exact all-in checks: a BUY paid at most `limit` a token, a SELL got at least `limit` a token (USD, 1e18-scaled)
    function _buyOkIn(address pay, uint256 payIn, uint256 tokensOut, uint256 limit) internal view returns (bool) {
        return payIn * _payPrice(pay) * 1e18 <= tokensOut * limit * _unit(pay);
    }

    function _sellOkIn(address pay, uint256 tokensIn, uint256 payOut, uint256 limit) internal view returns (bool) {
        return payOut * _payPrice(pay) * 1e18 >= tokensIn * limit * _unit(pay);
    }

    function _buyOk(uint256 ethIn, uint256 tokensOut, uint256 limit) internal pure returns (bool) {
        return ethIn * ETH_USD <= tokensOut * limit;
    }

    function _sellOk(uint256 tokensIn, uint256 ethOut, uint256 limit) internal pure returns (bool) {
        return ethOut * ETH_USD >= tokensIn * limit;
    }

    function _balance(address token, address who) internal view returns (uint256) {
        return token == ETH ? who.balance : HypexToken(token).balanceOf(who);
    }

    struct Filled {
        uint256 id;
        address filler;
        uint256 amountIn;
        uint256 amountOut;
        uint256 fee;
        uint256 payUsdE18;
        uint256 remaining;
    }

    /// The last OrderFilled in the recorded logs
    function _lastFilled() internal returns (Filled memory f) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i; i < logs.length; i++) {
            Vm.Log memory l = logs[i];
            if (l.emitter == address(limitOrders) && l.topics[0] == IHypexLimitOrders.OrderFilled.selector) {
                f.id = uint256(l.topics[1]);
                f.filler = address(uint160(uint256(l.topics[2])));
                (f.amountIn, f.amountOut, f.fee, f.payUsdE18, f.remaining) =
                    abi.decode(l.data, (uint256, uint256, uint256, uint256, uint256));
                seen = true;
            }
        }
        require(seen, "no OrderFilled");
    }
}

contract LimitOrdersTest is LimitOrdersBase {
    // ---------------------------------------------------------------- deploy, owner, pay tokens, keepers

    function test_deployRules() public {
        vm.expectRevert(IHypexLimitOrders.ZeroAddress.selector);
        new HypexLimitOrders(IPoolManager(address(0)), factory, address(this), IAggregatorV3(address(0)), 0);
        vm.expectRevert(IHypexLimitOrders.ZeroAddress.selector);
        new HypexLimitOrders(pm, IHypexFactory(address(0)), address(this), IAggregatorV3(address(0)), 0);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new HypexLimitOrders(pm, factory, address(0), IAggregatorV3(address(0)), 0);
        // a sequencer feed takes a grace period, and no sequencer feed none
        vm.expectRevert(IHypexLimitOrders.BadGracePeriod.selector);
        new HypexLimitOrders(pm, factory, address(this), feed, 0);
        vm.expectRevert(IHypexLimitOrders.BadGracePeriod.selector);
        new HypexLimitOrders(pm, factory, address(this), IAggregatorV3(address(0)), 1 hours);
        assertEq(limitOrders.owner(), address(this));
        assertEq(address(limitOrders.sequencerUptimeFeed()), address(0));
        assertEq(limitOrders.sequencerGracePeriod(), 0);
        assertEq(hook.limitOrders(), address(limitOrders), "the hook names it");
        (IHypexLimitOrders.Pricing memory p, bool allowed) = limitOrders.payTokens(ETH);
        assertTrue(allowed);
        assertEq(address(p.feed), address(feed));
        assertEq(p.maxPriceAge, FEED_MAX_AGE);
        assertEq(p.feedDecimals, 8);
        assertEq(p.decimals, 18);
        assertFalse(p.isStable);
        assertEq(limitOrders.ethUsd(), ETH_USD);
        assertEq(limitOrders.priceOf(ETH), ETH_USD);
        assertTrue(limitOrders.keepers(keeper));
    }

    /// Two-step ownership (the Owner Safe), renounce disabled; only the owner sets pay tokens and keepers
    function test_ownerOnly() public {
        address safe = makeAddr("safe");
        address stranger = makeAddr("stranger");
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        limitOrders.setPayToken(ETH, feed, 1 hours, false, false);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        limitOrders.setKeeper(stranger, true);
        vm.stopPrank();
        vm.expectRevert(Owned.RenounceDisabled.selector);
        limitOrders.renounceOwnership();
        limitOrders.transferOwnership(safe);
        assertEq(limitOrders.owner(), address(this), "pending until accepted");
        assertEq(limitOrders.pendingOwner(), safe);
        vm.prank(safe);
        limitOrders.acceptOwnership();
        assertEq(limitOrders.owner(), safe);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        limitOrders.setKeeper(keeper, false);
        vm.prank(safe);
        limitOrders.setKeeper(keeper, false);
        assertFalse(limitOrders.keepers(keeper));
    }

    function test_setPayTokenRules() public {
        MockQuote six = new MockQuote(6, 0);
        MockQuote nineteen = new MockQuote(19, 0);
        MockEthUsdFeed feed19 = new MockEthUsdFeed(19, 1e19);
        // a stable pay token has no feed and no age; native ETH is never stable
        vm.expectRevert(IHypexLimitOrders.BadPayToken.selector);
        limitOrders.setPayToken(address(six), feed, 0, true, true);
        vm.expectRevert(IHypexLimitOrders.BadPayToken.selector);
        limitOrders.setPayToken(address(six), IAggregatorV3(address(0)), 1 hours, true, true);
        vm.expectRevert(IHypexLimitOrders.BadPayToken.selector);
        limitOrders.setPayToken(ETH, IAggregatorV3(address(0)), 0, true, true);
        // a feed-priced one needs a feed of at most 18 decimals and a positive age
        vm.expectRevert(IHypexLimitOrders.BadFeed.selector);
        limitOrders.setPayToken(address(six), IAggregatorV3(address(0)), 1 hours, false, true);
        vm.expectRevert(IHypexLimitOrders.BadMaxAge.selector);
        limitOrders.setPayToken(address(six), feed, 0, false, true);
        vm.expectRevert(IHypexLimitOrders.BadFeed.selector);
        limitOrders.setPayToken(address(six), feed19, 1 hours, false, true);
        vm.expectRevert(abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, 40, uint256(1) << 40));
        limitOrders.setPayToken(address(six), feed, uint256(1) << 40, false, true);
        // the token's decimals: at most 18, and it must have decimals()
        vm.expectRevert(IHypexLimitOrders.BadPayToken.selector);
        limitOrders.setPayToken(address(nineteen), IAggregatorV3(address(0)), 0, true, true);
        vm.expectRevert();
        limitOrders.setPayToken(makeAddr("eoa"), IAggregatorV3(address(0)), 0, true, true);
        // stored with the decimals it read, and logged
        vm.expectEmit(address(limitOrders));
        emit IHypexLimitOrders.PayTokenSet(address(six), address(0), 0, true, true, 6);
        limitOrders.setPayToken(address(six), IAggregatorV3(address(0)), 0, true, true);
        (IHypexLimitOrders.Pricing memory p, bool allowed) = limitOrders.payTokens(address(six));
        assertTrue(allowed);
        assertTrue(p.isStable);
        assertEq(p.decimals, 6);
        assertEq(address(p.feed), address(0));
        assertEq(limitOrders.priceOf(address(six)), 1e18, "a stable pay token is $1");
        // the same token on a feed instead, then off the whitelist (its config kept)
        MockEthUsdFeed six8 = new MockEthUsdFeed(8, 0.999e8);
        limitOrders.setPayToken(address(six), six8, 2 hours, false, false);
        (p, allowed) = limitOrders.payTokens(address(six));
        assertFalse(allowed);
        assertEq(address(p.feed), address(six8));
        assertEq(p.maxPriceAge, 2 hours);
        assertEq(p.feedDecimals, 8);
        assertEq(limitOrders.priceOf(address(six)), 0.999e18);
        // never configured
        vm.expectRevert(IHypexLimitOrders.NotPayToken.selector);
        limitOrders.priceOf(makeAddr("unknown"));
    }

    function test_keepers() public {
        address o = _user("owner");
        uint256 id = _placeBuy(o, kumo, 1 ether, 1e18, 0.001 ether);
        IHypexLimitOrders.Hop[] memory route = _routeOf(id);
        // anyone else: refused
        vm.prank(o, o);
        vm.expectRevert(IHypexLimitOrders.NotKeeper.selector);
        limitOrders.fill(id, 0.1 ether, 0, route);
        vm.expectRevert(IHypexLimitOrders.ZeroAddress.selector);
        limitOrders.setKeeper(address(0), true);
        // several keepers
        address second = makeAddr("second");
        vm.expectEmit(address(limitOrders));
        emit IHypexLimitOrders.KeeperSet(second, true);
        limitOrders.setKeeper(second, true);
        _fill(id, 0.1 ether, 0);
        vm.prank(second, second);
        limitOrders.fill(id, 0.1 ether, 0.001 ether, route);
        assertEq(second.balance, 0.001 ether, "its fee");
        // removed
        limitOrders.setKeeper(keeper, false);
        _expectFillRevert(id, 0.1 ether, 0, IHypexLimitOrders.NotKeeper.selector);
        assertEq(_order(id).remaining, 0.8 ether);
    }

    /// Accepted (README §15): receive() takes ETH from the PoolManager, so any PoolManager payout naming this contract (a
    /// creator who setCreator()s it, a HypexRevenue balance, the team) lands here, and nothing can move it: no order
    /// backs it. The escrow invariant is balance >= open escrow, not ==. Only who names it as a payee loses it.
    function test_payoutNamingThisContractIsStuck() public {
        address bob = _user("bob");
        vm.prank(alice);
        hook.setCreator(kumoKey, address(limitOrders));
        _swap(bob, kumoKey, true, -10 ether, 10 ether); // KUMO's creator (now this contract) earns 0.6%
        (,, uint256 creatorOwed,,) = _pool(kumoKey);
        assertGt(creatorOwed, 0, "the creator is owed, never paid in the swap");
        uint256 b0 = address(limitOrders).balance;
        hook.claimCreator(kumoKey, _creatorOf(kumoKey));
        assertEq(address(limitOrders).balance - b0, creatorOwed, "ETH here that no order escrows");
        assertEq(limitOrders.orderCount(), 0, "no order backs it: no function can move it");
    }

    // ---------------------------------------------------------------- placing

    function test_placeBuyEscrowsEthAndEmits() public {
        address o = _user("owner");
        uint256 expiry = _expiry();
        vm.expectEmit(address(limitOrders));
        emit IHypexLimitOrders.OrderPlaced(1, o, kumo, BUY, ETH, 18, 1 ether, 1e14, expiry, 0.001 ether);
        uint256 id = _placeBuy(o, kumo, 1 ether, 1e14, 0.001 ether);
        assertEq(id, 1);
        assertEq(limitOrders.orderCount(), 1);
        IHypexLimitOrders.Order memory ord = _order(id);
        assertEq(ord.owner, o);
        assertEq(uint256(ord.kind), uint256(BUY));
        assertEq(ord.token, kumo);
        assertEq(ord.payToken, ETH);
        assertEq(ord.remaining, 1 ether);
        assertEq(ord.limitPriceUsdE18, 1e14);
        assertEq(ord.expiry, expiry);
        assertEq(ord.maxFeePerFill, 0.001 ether);
        assertEq(address(ord.pricing.feed), address(feed), "the price config is the order's");
        assertEq(ord.pricing.maxPriceAge, FEED_MAX_AGE);
        assertEq(ord.pricing.decimals, 18);
        assertEq(address(limitOrders).balance, 1 ether);
        // any HYPEX token: $HYPEX pairs and $HYPEX itself alike
        _placeBuy(o, neko, 1 ether, 1e14, 0);
        _placeBuy(o, hypex, 1 ether, 1e14, 0);
        assertEq(limitOrders.orderCount(), 3);
    }

    function test_placeBuyEscrowsAnErc20PayToken() public {
        _usdSetup();
        address o = _usdUser("owner", 10_000);
        uint256 b0 = usd.balanceOf(o);
        uint256 expiry = _expiry();
        vm.expectEmit(address(limitOrders));
        emit IHypexLimitOrders.OrderPlaced(1, o, kumo, BUY, address(usd), 6, 1_000e6, 1e14, expiry, 1e6);
        uint256 id = _placeBuyIn(address(usd), o, kumo, 1_000e6, 1e14, 1e6);
        assertEq(b0 - usd.balanceOf(o), 1_000e6);
        assertEq(usd.balanceOf(address(limitOrders)), 1_000e6);
        IHypexLimitOrders.Order memory ord = _order(id);
        assertEq(ord.payToken, address(usd));
        assertTrue(ord.pricing.isStable);
        assertEq(ord.pricing.decimals, 6);
        // ETH sent with an ERC-20 order is refused
        vm.prank(o);
        vm.expectRevert(IHypexLimitOrders.BadValue.selector);
        limitOrders.place{value: 1}(BUY, kumo, address(usd), 1_000e6, 1e14, expiry, 0);
    }

    /// A pay token that takes a fee on transfer escrows less than the order says: refused
    function test_feeOnTransferPayTokenRefused() public {
        MockQuote fot = new MockQuote(6, 100);
        limitOrders.setPayToken(address(fot), IAggregatorV3(address(0)), 0, true, true);
        address o = _user("owner");
        fot.transfer(o, 1_000e6);
        vm.startPrank(o);
        fot.approve(address(limitOrders), type(uint256).max);
        vm.expectRevert(IHypexLimitOrders.TransferShortfall.selector);
        limitOrders.place(BUY, kumo, address(fot), 100e6, 1e14, _expiry(), 0);
        vm.stopPrank();
    }

    function test_placeSellEscrowsTokens() public {
        address o = _holder("owner");
        uint256 amount = HypexToken(neko).balanceOf(o) / 2;
        uint256 b0 = HypexToken(neko).balanceOf(o);
        uint256 id = _placeSell(o, neko, amount, 1e14, 0);
        assertEq(HypexToken(neko).balanceOf(address(limitOrders)), amount);
        assertEq(b0 - HypexToken(neko).balanceOf(o), amount);
        assertEq(_order(id).remaining, amount);
        assertEq(uint256(_order(id).kind), uint256(SELL));
    }

    function test_placeRules() public {
        address o = _holder("owner");
        uint256 e = _expiry();
        vm.startPrank(o);
        HypexToken(kumo).approve(address(limitOrders), type(uint256).max);
        vm.expectRevert(IHypexLimitOrders.BadAmount.selector);
        limitOrders.place(BUY, kumo, ETH, 0, 1, e, 0);
        vm.expectRevert(IHypexLimitOrders.BadPrice.selector);
        limitOrders.place{value: 1}(BUY, kumo, ETH, 1, 0, e, 0);
        vm.expectRevert(IHypexLimitOrders.BadExpiry.selector);
        limitOrders.place{value: 1}(BUY, kumo, ETH, 1, 1, vm.getBlockTimestamp(), 0);
        vm.expectRevert(IHypexLimitOrders.BadValue.selector);
        limitOrders.place{value: 1}(BUY, kumo, ETH, 2, 1, e, 0);
        vm.expectRevert(IHypexLimitOrders.BadValue.selector);
        limitOrders.place{value: 1}(SELL, kumo, ETH, 1, 1, e, 0);
        // the token can't be nothing or the pay token itself
        vm.expectRevert(IHypexLimitOrders.BadToken.selector);
        limitOrders.place{value: 1}(BUY, address(0), ETH, 1, 1, e, 0);
        // a pay token never whitelisted
        vm.expectRevert(IHypexLimitOrders.NotPayToken.selector);
        limitOrders.place(BUY, kumo, hypex, 1, 1, e, 0);
        // fields that don't fit the packed order
        vm.expectRevert(
            abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, 128, uint256(1) << 128)
        );
        limitOrders.place(SELL, kumo, ETH, uint256(1) << 128, 1, e, 0);
        vm.expectRevert(
            abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, 128, uint256(1) << 128)
        );
        limitOrders.place{value: 1}(BUY, kumo, ETH, 1, uint256(1) << 128, e, 0);
        vm.expectRevert(abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, 96, uint256(1) << 96));
        limitOrders.place{value: 1}(BUY, kumo, ETH, 1, 1, e, uint256(1) << 96);
        vm.expectRevert(abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, 40, uint256(1) << 40));
        limitOrders.place{value: 1}(BUY, kumo, ETH, 1, 1, uint256(1) << 40, 0);
        vm.stopPrank();
        // $HYPEX as a pay token can't buy $HYPEX
        limitOrders.setPayToken(hypex, IAggregatorV3(address(0)), 0, true, true);
        vm.prank(o);
        vm.expectRevert(IHypexLimitOrders.BadToken.selector);
        limitOrders.place(BUY, hypex, hypex, 1, 1, e, 0);
        assertEq(limitOrders.orderCount(), 0);
    }

    /// A HypexLimitOrders the factory's hook doesn't name can't place (its fills would credit the keeper's referrer)
    function test_notWired() public {
        HypexLimitOrders other = new HypexLimitOrders(pm, factory, address(this), IAggregatorV3(address(0)), 0);
        other.setPayToken(ETH, feed, 1 hours, false, true);
        address o = _user("owner");
        vm.prank(o);
        vm.expectRevert(IHypexLimitOrders.NotWired.selector);
        other.place{value: 1 ether}(BUY, kumo, ETH, 1 ether, 1, _expiry(), 0);
    }

    function test_onlyThePoolManagerSendsEthOrCallsBack() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(limitOrders).call{value: 1}("");
        assertFalse(ok, "plain ETH refused");
        vm.expectRevert(IHypexLimitOrders.NotPoolManager.selector);
        limitOrders.unlockCallback("");
    }

    // ---------------------------------------------------------------- filling: ETH pay

    /// A BUY on an ETH pair, filled in two parts with fees: the owner gets the tokens, the keeper the fee, the escrow
    /// shrinks by exactly what each fill used, the order closes when empty
    function test_buyEthPairPartialFills() public {
        _buyPartialFills(ETH, kumo, 1 ether, 0.001 ether);
    }

    /// The same on a $HYPEX pair: ETH -> $HYPEX -> NEKO in one unlock, no $HYPEX left anywhere here
    function test_buyHypexPairPartialFills() public {
        _buyPartialFills(ETH, neko, 1 ether, 0.001 ether);
    }

    function test_sellEthPairPartialFills() public {
        _sellPartialFills(ETH, kumo, 0.001 ether);
    }

    /// NEKO -> $HYPEX -> ETH in one unlock
    function test_sellHypexPairPartialFills() public {
        _sellPartialFills(ETH, neko, 0.001 ether);
    }

    // ---------------------------------------------------------------- filling: USD pay (a 6-decimal stable)

    /// USD on its own pair: one hop
    function test_usdBuyUsdPair() public {
        _usdSetup();
        _buyPartialFills(address(usd), usdy, 1_000e6, 1e6);
    }

    /// USD on an ETH pair: USD -> ETH (the reference pool) -> KUMO
    function test_usdBuyEthPair() public {
        _usdSetup();
        assertEq(_buyRoute(address(usd), kumo).length, 2);
        _buyPartialFills(address(usd), kumo, 1_000e6, 1e6);
    }

    /// USD on a $HYPEX pair: USD -> ETH -> $HYPEX -> NEKO
    function test_usdBuyHypexPair() public {
        _usdSetup();
        assertEq(_buyRoute(address(usd), neko).length, 3);
        _buyPartialFills(address(usd), neko, 1_000e6, 1e6);
    }

    /// ETH on the USD pair: ETH -> USD -> USDY
    function test_ethBuyUsdPair() public {
        _usdSetup();
        assertEq(_buyRoute(ETH, usdy).length, 2);
        _buyPartialFills(ETH, usdy, 1 ether, 0.001 ether);
    }

    /// A SELL paid in USD: KUMO -> ETH -> USD, the proceeds and the fee in USD
    function test_sellPaidInUsd() public {
        _usdSetup();
        _sellPartialFills(address(usd), kumo, 1e6);
    }

    /// NEKO -> $HYPEX -> ETH -> USD, and USDY -> USD
    function test_sellPaidInUsdHypexPairAndUsdPair() public {
        _usdSetup();
        _sellPartialFills(address(usd), neko, 1e6);
        address h = _usdUser("usdyHolder", 10_000);
        _swap(h, usdyKey, true, -int256(uint256(1_000e6)), 0);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 amount = HypexToken(usdy).balanceOf(h) / 2;
        uint256 id = _placeSellFor(address(usd), h, usdy, amount, 1, 1e6);
        uint256 u0 = usd.balanceOf(h);
        uint256 out = _fill(id, amount, 1e6);
        assertEq(usd.balanceOf(h) - u0, out);
        assertGt(out, 0);
    }

    function _buyPartialFills(address pay, address token, uint256 amount, uint256 fee) internal {
        address o = pay == ETH ? _user("owner") : _usdUser("owner", 10_000);
        uint256 limit = 1e18; // $1 a token, far above the price
        uint256 id = _placeBuyIn(pay, o, token, amount, limit, fee);
        uint256 k0 = _balance(pay, keeper);
        uint256 t0 = HypexToken(token).balanceOf(o);
        uint256 part = amount * 2 / 5;
        vm.recordLogs();
        uint256 out = _fill(id, part, fee);
        Filled memory f = _lastFilled();
        assertEq(f.id, id);
        assertEq(f.filler, keeper);
        assertEq(f.amountIn, part);
        assertEq(f.amountOut, out);
        assertEq(f.fee, fee);
        assertEq(f.payUsdE18, _payPrice(pay));
        assertEq(f.remaining, amount - part);
        assertGt(out, 0);
        assertEq(HypexToken(token).balanceOf(o) - t0, out, "the tokens went to the owner");
        assertEq(_balance(pay, keeper) - k0, fee, "the fee went to the keeper, in the pay token");
        assertTrue(_buyOkIn(pay, part, out, limit));
        assertEq(_order(id).remaining, amount - part);
        assertEq(_balance(pay, address(limitOrders)), amount - part, "escrow == open orders");
        _assertNothingLeft(token, pay);
        uint256 out2 = _fill(id, amount - part, 0);
        assertEq(HypexToken(token).balanceOf(o) - t0, out + out2);
        assertEq(_order(id).remaining, 0);
        assertEq(_balance(pay, address(limitOrders)), 0);
        _expectFillRevert(id, 1, 0, IHypexLimitOrders.OrderClosed.selector);
    }

    function _sellPartialFills(address pay, address token, uint256 fee) internal {
        address o = _holder("seller");
        uint256 amount = HypexToken(token).balanceOf(o) / 2;
        uint256 limit = 1; // 1e-18 USD a token: any price
        uint256 id = _placeSellFor(pay, o, token, amount, limit, fee);
        uint256 e0 = _balance(pay, o);
        uint256 k0 = _balance(pay, keeper);
        uint256 part = amount / 3;
        vm.recordLogs();
        uint256 out = _fill(id, part, fee);
        Filled memory f = _lastFilled();
        assertEq(f.amountIn, part);
        assertEq(f.amountOut, out);
        assertEq(f.fee, fee);
        assertEq(f.payUsdE18, _payPrice(pay));
        assertEq(f.remaining, amount - part);
        assertGt(out, 0);
        assertEq(_balance(pay, o) - e0, out, "the proceeds (after the fee) went to the owner");
        assertEq(_balance(pay, keeper) - k0, fee);
        assertTrue(_sellOkIn(pay, part, out, limit));
        assertEq(HypexToken(token).balanceOf(address(limitOrders)), amount - part, "escrow == open orders");
        assertEq(_balance(pay, address(limitOrders)), 0, "no proceeds left behind");
        _assertNothingLeft(token, pay);
        _fill(id, amount - part, 0);
        assertEq(_order(id).remaining, 0);
        assertEq(HypexToken(token).balanceOf(address(limitOrders)), 0);
        _expectFillRevert(id, 1, 0, IHypexLimitOrders.OrderClosed.selector);
    }

    /// No intermediate currency of a route stays here
    function _assertNothingLeft(address token, address pay) internal view {
        if (hypex != token && hypex != pay) assertEq(HypexToken(hypex).balanceOf(address(limitOrders)), 0, "no $HYPEX");
        if (pay != ETH) assertEq(address(limitOrders).balance, 0, "no ETH");
        if (address(usd) != address(0) && address(usd) != pay) {
            assertEq(usd.balanceOf(address(limitOrders)), 0, "no USD");
        }
    }

    function test_fillRules() public {
        address o = _holder("owner");
        uint256 buy = _placeBuy(o, kumo, 1 ether, 1e18, 0.01 ether);
        uint256 sell = _placeSell(o, kumo, 1_000e18, 1, 1 ether);
        IHypexLimitOrders.Hop[] memory route = _routeOf(buy);
        _expectFillRevertVia(99, 1, 0, route, IHypexLimitOrders.UnknownOrder.selector);
        _expectFillRevert(buy, 0, 0, IHypexLimitOrders.BadAmount.selector);
        _expectFillRevert(buy, 1 ether + 1, 0, IHypexLimitOrders.BadAmount.selector);
        _expectFillRevert(buy, 0.5 ether, 0.01 ether + 1, IHypexLimitOrders.FeeTooHigh.selector);
        // a BUY's fee comes out of the fill: something must be left to swap
        _expectFillRevert(buy, 0.01 ether, 0.01 ether, IHypexLimitOrders.FeeTooHigh.selector);
        // a SELL's fee can't exceed the proceeds (1,000 KUMO is far less than 1 ETH)
        _expectFillRevert(sell, 1_000e18, 1 ether, IHypexLimitOrders.FeeTooHigh.selector);
        vm.warp(vm.getBlockTimestamp() + 1 days + 1);
        _fresh();
        _expectFillRevert(buy, 0.5 ether, 0, IHypexLimitOrders.OrderExpired.selector);
    }

    /// Expiry is inclusive: fills at the expiry second, not after
    function test_expiryIsInclusive() public {
        address o = _user("owner");
        uint256 id = _placeBuy(o, kumo, 1 ether, 1e18, 0);
        vm.warp(_order(id).expiry);
        _fresh();
        _fill(id, 0.5 ether, 0);
        vm.warp(vm.getBlockTimestamp() + 1);
        _fresh();
        _expectFillRevert(id, 0.5 ether, 0, IHypexLimitOrders.OrderExpired.selector);
    }

    // ---------------------------------------------------------------- routes

    /// A route must connect the pay token to the token (or back) and pass through the token's own HYPEX pool, the
    /// token in no other hop: empty, too long, disconnected, wrong ends, a look-alike pool for the token, the token
    /// mid-route all revert BadRoute before any swap
    function test_badRoutesRejected() public {
        _usdSetup();
        address o = _usdUser("owner", 10_000);
        uint256 buy = _placeBuy(o, kumo, 1 ether, 1e18, 0);
        uint256 usdBuy = _placeBuyIn(address(usd), o, neko, 1_000e6, 1e18, 0);
        _swap(o, kumoKey, true, -1 ether, 1 ether);
        uint256 sell = _placeSell(o, kumo, HypexToken(kumo).balanceOf(o) / 2, 1, 0);
        bytes4 bad = IHypexLimitOrders.BadRoute.selector;

        IHypexLimitOrders.Hop[] memory r = new IHypexLimitOrders.Hop[](0);
        _expectFillRevertVia(buy, 0.1 ether, 0, r, bad);
        // five hops (MAX_HOPS is 4), ETH -> USD -> ETH -> USD -> ETH -> KUMO
        r = new IHypexLimitOrders.Hop[](5);
        r[0] = _hop(usdKey, true);
        r[1] = _hop(usdKey, false);
        r[2] = _hop(usdKey, true);
        r[3] = _hop(usdKey, false);
        r[4] = _hop(kumoKey, true);
        _expectFillRevertVia(buy, 0.1 ether, 0, r, bad);
        // four hops is allowed: a detour through the USD pool and back still fills (the limit is what binds)
        r = new IHypexLimitOrders.Hop[](3);
        r[0] = _hop(usdKey, true);
        r[1] = _hop(usdKey, false);
        r[2] = _hop(kumoKey, true);
        assertGt(_fillVia(buy, 0.1 ether, 0, r), 0);
        // the first hop doesn't take the pay token (USD for an ETH order), or the direction is backwards
        r = new IHypexLimitOrders.Hop[](1);
        r[0] = _hop(kumoKey, false);
        _expectFillRevertVia(buy, 0.1 ether, 0, r, bad);
        r = new IHypexLimitOrders.Hop[](2);
        r[0] = _hop(usdKey, false);
        r[1] = _hop(kumoKey, true);
        _expectFillRevertVia(buy, 0.1 ether, 0, r, bad);
        // disconnected: USD -> ETH, then $HYPEX -> NEKO
        r = new IHypexLimitOrders.Hop[](2);
        r[0] = _hop(usdKey, false);
        r[1] = _hop(nekoKey, true);
        _expectFillRevertVia(usdBuy, 100e6, 0, r, bad);
        // ends elsewhere: ETH -> $HYPEX for a KUMO order
        r = new IHypexLimitOrders.Hop[](1);
        r[0] = _hop(hypexKey, true);
        _expectFillRevertVia(buy, 0.1 ether, 0, r, bad);
        // a look-alike ETH/KUMO pool (no hook): not the token's HYPEX pool
        PoolKey memory fake = PoolKey(Currency.wrap(ETH), Currency.wrap(kumo), 3000, 60, IHooks(address(0)));
        r = new IHypexLimitOrders.Hop[](1);
        r[0] = _hop(fake, true);
        _expectFillRevertVia(buy, 0.1 ether, 0, r, bad);
        // the hook's key for KUMO with another quote than its own passes the route check, but no such pool exists: the
        // PoolManager refuses the swap
        r = new IHypexLimitOrders.Hop[](2);
        r[0] = _hop(usdKey, true);
        r[1] = _hop(hook.keyFor(address(usd), kumo), true);
        vm.prank(keeper, keeper);
        vm.expectRevert();
        limitOrders.fill(buy, 0.1 ether, 0, r);
        // the token mid-route: ETH -> KUMO -> ETH -> KUMO
        r = new IHypexLimitOrders.Hop[](3);
        r[0] = _hop(kumoKey, true);
        r[1] = _hop(kumoKey, false);
        r[2] = _hop(kumoKey, true);
        _expectFillRevertVia(buy, 0.1 ether, 0, r, bad);
        // a SELL's token hop is first: KUMO -> ETH -> USD -> ETH from the USD side fails
        r = new IHypexLimitOrders.Hop[](1);
        r[0] = _hop(kumoKey, true);
        _expectFillRevertVia(sell, 1e18, 0, r, bad);
        r = new IHypexLimitOrders.Hop[](2);
        r[0] = _hop(usdKey, true);
        r[1] = _hop(kumoKey, false);
        _expectFillRevertVia(sell, 1e18, 0, r, bad);
        assertEq(_order(buy).remaining, 0.9 ether, "only the good route filled");
    }

    /// The limit protects the owner whatever the keeper's route: a thin ETH/USD pool at four times the price (the
    /// keeper's own, say) gives a USD BUY far fewer tokens and reverts LimitNotMet, the honest route fills; a keeper
    /// that pumps the token's pool before filling can only land the fill at or under the limit
    function test_limitHoldsAgainstAManipulativeRoute() public {
        _usdSetup();
        address o = _usdUser("owner", 10_000);
        uint256 amountIn = 500e6;
        // the honest route's all-in price, plus 1%
        uint256 probe = _placeBuyIn(address(usd), o, kumo, amountIn, type(uint128).max, 0);
        uint256 snap = vm.snapshotState();
        uint256 honest = _fill(probe, amountIn, 0);
        vm.revertToState(snap);
        uint256 limit = amountIn * 1e18 * 1e18 / 1e6 / honest * 101 / 100;
        uint256 id = _placeBuyIn(address(usd), o, kumo, amountIn, limit, 0);
        // the keeper's pool: ETH/USD at $10,400 (USD buys a quarter of the ETH), 1 ETH deep, at another fee tier
        PoolKey memory rigged =
            PoolKey(Currency.wrap(ETH), Currency.wrap(address(usd)), 3000, USD_POOL_SPACING, IHooks(address(0)));
        _initUsdPool(rigged, 10_400, 1 ether);
        IHypexLimitOrders.Hop[] memory r = new IHypexLimitOrders.Hop[](2);
        r[0] = _hop(rigged, false);
        r[1] = _hop(kumoKey, true);
        _expectFillRevertVia(id, amountIn, 0, r, IHypexLimitOrders.LimitNotMet.selector);
        // a keeper pumping KUMO first: the fill only goes through within the limit
        address k = _user("pumper");
        _swap(k, kumoKey, true, -20 ether, 20 ether);
        _expectFillRevert(id, amountIn, 0, IHypexLimitOrders.LimitNotMet.selector);
        vm.revertToState(snap);
        id = _placeBuyIn(address(usd), o, kumo, amountIn, limit, 0);
        uint256 t0 = HypexToken(kumo).balanceOf(o);
        _fill(id, amountIn, 0);
        assertTrue(_buyOkIn(address(usd), amountIn, HypexToken(kumo).balanceOf(o) - t0, limit));
    }

    // ---------------------------------------------------------------- the all-in guarantee

    /// A BUY right at its price: a limit just under the all-in price reverts, a limit just over it fills. The fee is
    /// part of the price: the same fill with a fee costs more a token and needs a higher limit.
    function test_buyLimitIsAllIn() public {
        address o = _user("owner");
        uint256 amountIn = 1 ether;
        uint256 fee = 0.01 ether;
        uint256 probe = _placeBuy(o, kumo, amountIn, type(uint128).max, fee);
        uint256 snap = vm.snapshotState();
        uint256 outNoFee = _fill(probe, amountIn, 0);
        vm.revertToState(snap);
        uint256 outFee = _fill(probe, amountIn, fee);
        vm.revertToState(snap);
        // the all-in price a token, USD 1e18-scaled, rounded up / down
        uint256 pNoFee = (amountIn * ETH_USD + outNoFee - 1) / outNoFee;
        uint256 pFee = (amountIn * ETH_USD + outFee - 1) / outFee;
        assertGt(pFee, pNoFee, "the fee raises the all-in price");
        uint256 id = _placeBuy(o, kumo, amountIn, pNoFee, fee);
        uint256 s2 = vm.snapshotState();
        _expectFillRevert(id, amountIn, fee, IHypexLimitOrders.LimitNotMet.selector);
        assertEq(_fill(id, amountIn, 0), outNoFee, "fills without the fee");
        vm.revertToState(s2);
        id = _placeBuy(o, kumo, amountIn, pNoFee - pNoFee / 1e6, fee);
        _expectFillRevert(id, amountIn, 0, IHypexLimitOrders.LimitNotMet.selector);
        id = _placeBuy(o, kumo, amountIn, pFee, fee);
        assertEq(_fill(id, amountIn, fee), outFee, "fills with the fee at its all-in price");
    }

    function test_sellLimitIsAllIn() public {
        address o = _holder("owner");
        uint256 amountIn = HypexToken(neko).balanceOf(o) / 4;
        uint256 probe = _placeSell(o, neko, amountIn, 1, 1 ether);
        uint256 snap = vm.snapshotState();
        uint256 proceeds = _fill(probe, amountIn, 0);
        vm.revertToState(snap);
        uint256 fee = proceeds / 100;
        // the all-in price a token, rounded down: what the owner gets for each token
        uint256 pNoFee = proceeds * ETH_USD / amountIn;
        uint256 pFee = (proceeds - fee) * ETH_USD / amountIn;
        uint256 id = _placeSell(o, neko, amountIn, pNoFee, 1 ether);
        uint256 s2 = vm.snapshotState();
        _expectFillRevert(id, amountIn, fee, IHypexLimitOrders.LimitNotMet.selector);
        assertEq(_fill(id, amountIn, 0), proceeds);
        vm.revertToState(s2);
        id = _placeSell(o, neko, amountIn, pNoFee + pNoFee / 1e6, 1 ether);
        _expectFillRevert(id, amountIn, 0, IHypexLimitOrders.LimitNotMet.selector);
        id = _placeSell(o, neko, amountIn, pFee, 1 ether);
        assertEq(_fill(id, amountIn, fee), proceeds - fee);
    }

    /// The same edge with a 6-decimal pay token: a USD BUY at exactly its all-in price fills, a hair under reverts
    function test_usdLimitIsAllInAtSixDecimals() public {
        _usdSetup();
        address o = _usdUser("owner", 10_000);
        uint256 amountIn = 250e6;
        uint256 fee = 2e6;
        uint256 probe = _placeBuyIn(address(usd), o, neko, amountIn, type(uint128).max, fee);
        uint256 snap = vm.snapshotState();
        uint256 out = _fill(probe, amountIn, fee);
        vm.revertToState(snap);
        // USD per token, 1e18-scaled, rounded up: amountIn (6 decimals) x $1 / tokens
        uint256 p = (amountIn * 1e12 * 1e18 + out - 1) / out;
        uint256 id = _placeBuyIn(address(usd), o, neko, amountIn, p - p / 1e6, fee);
        _expectFillRevert(id, amountIn, fee, IHypexLimitOrders.LimitNotMet.selector);
        id = _placeBuyIn(address(usd), o, neko, amountIn, p, fee);
        assertEq(_fill(id, amountIn, fee), out);
    }

    /// Fuzz: kind, pay token, pair, fill size, fee and a limit from half to twice the fill's all-in price. The fill
    /// with a given limit moves exactly what a probe of the same fill moved; it succeeds only if the owner got its
    /// limit, exactly computed (rounding is the keeper's loss: a fill within a hair of the limit may revert), and every
    /// fill whose amounts miss the limit reverts LimitNotMet.
    /// forge-config: default.fuzz.runs = 256
    function testFuzz_allInGuarantee(uint256 seed, uint256 sizeBps, uint256 feeBps, uint256 limitBps) public {
        _usdSetup();
        address o = _holder("owner");
        usd.transfer(o, 10_000e6);
        vm.prank(o);
        usd.approve(address(limitOrders), type(uint256).max);
        bool buy = seed % 2 == 0;
        address token = [hypex, kumo, neko, usdy][(seed >> 1) % 4];
        address pay = (seed >> 3) % 2 == 0 ? ETH : address(usd);
        if (!buy && token == usdy) token = kumo; // the owner holds no USDY
        sizeBps = bound(sizeBps, 1, 10_000);
        limitBps = bound(limitBps, 5_000, 20_000);
        uint256 amount = buy ? (pay == ETH ? 2 ether : 5_000e6) : HypexToken(token).balanceOf(o) / 2;
        uint256 amountIn = amount * sizeBps / 10_000;
        vm.assume(amountIn > 0);
        // the probe: the same fill on an order with no effective limit (a fill too small to get anything still reverts)
        uint256 s0 = vm.snapshotState();
        uint256 id = buy
            ? _placeBuyIn(pay, o, token, amount, type(uint128).max, type(uint96).max)
            : _placeSellFor(pay, o, token, amount, 1, type(uint96).max);
        uint256 fee = buy ? amountIn * bound(feeBps, 0, 2_000) / 10_000 : 0; // up to 20% of the fill
        (bool ok, bytes memory ret) = _tryFill(id, amountIn, fee);
        vm.revertToState(s0);
        vm.assume(ok);
        uint256 out = abi.decode(ret, (uint256));
        if (!buy) {
            fee = out * bound(feeBps, 0, 2_000) / 10_000; // a SELL's fee comes out of the proceeds, after the swap
            out -= fee;
        }
        vm.assume(out > 0);
        // the fill's all-in price (USD per token, 1e18), then the fuzzed limit around it
        uint256 price = buy
            ? amountIn * _payPrice(pay) / _unit(pay) * 1e18 / out
            : out * _payPrice(pay) / _unit(pay) * 1e18 / amountIn;
        uint256 limit = price * limitBps / 10_000;
        vm.assume(limit > 0 && limit < type(uint128).max);
        id = buy ? _placeBuyIn(pay, o, token, amount, limit, fee) : _placeSellFor(pay, o, token, amount, limit, fee);
        uint256 before = buy ? HypexToken(token).balanceOf(o) : _balance(pay, o);
        bool exact = buy ? _buyOkIn(pay, amountIn, out, limit) : _sellOkIn(pay, amountIn, out, limit);
        IHypexLimitOrders.Hop[] memory route = _routeOf(id);
        vm.prank(keeper, keeper);
        try limitOrders.fill(id, amountIn, fee, route) returns (uint256 got) {
            assertTrue(exact, "a fill never misses the limit");
            assertEq(got, out, "same amounts as the probe");
            uint256 received = buy ? HypexToken(token).balanceOf(o) - before : _balance(pay, o) - before;
            assertEq(received, got, "what the owner actually received");
        } catch (bytes memory err) {
            assertEq(bytes4(err), IHypexLimitOrders.LimitNotMet.selector, "only the limit stops it");
            // conservative rounding costs at most a hair: anything 0.01% inside the limit fills
            if (buy) assertFalse(_buyOkIn(pay, amountIn * 10_001 / 10_000, out, limit), "reverted well inside");
            else assertFalse(_sellOkIn(pay, amountIn, out * 9_999 / 10_000, limit), "reverted well inside");
        }
    }

    /// Splitting a BUY into many small fills, each taking the most fee it can: every fill still gives the owner its
    /// limit, so the whole order does too. A fill whose fee would push it over the limit reverts; the max fee per fill
    /// caps what each one may take, and the limit caps the sum.
    function test_feeSplittingCannotBeatTheLimit() public {
        address o = _user("owner");
        // $HYPEX's pool (deep after the setup's buys): 20 fills walk its price well under the headroom
        uint256 amount = 0.1 ether;
        uint256 part = 0.005 ether;
        // the price of a fee-free fill of `part`, plus 2% headroom for the keeper
        uint256 probe = _placeBuy(o, hypex, amount, type(uint128).max, 0);
        uint256 snap = vm.snapshotState();
        uint256 out = _fill(probe, part, 0);
        vm.revertToState(snap);
        uint256 limit = part * ETH_USD / out * 102 / 100;
        uint256 id = _placeBuy(o, hypex, amount, limit, part / 2);
        // a fee of 20% of the fill is far past the headroom
        _expectFillRevert(id, part, part / 5, IHypexLimitOrders.LimitNotMet.selector);
        uint256 t0 = HypexToken(hypex).balanceOf(o);
        uint256 k0 = keeper.balance;
        uint256 fills;
        while (_order(id).remaining >= part) {
            // the most fee this fill can take (binary search, as a greedy keeper would)
            uint256 lo;
            uint256 hi = part / 2;
            while (lo < hi) {
                uint256 mid = (lo + hi + 1) / 2;
                uint256 s = vm.snapshotState();
                (bool ok,) = _tryFill(id, part, mid);
                vm.revertToState(s);
                if (ok) lo = mid;
                else hi = mid - 1;
            }
            uint256 tb = HypexToken(hypex).balanceOf(o);
            _fill(id, part, lo);
            assertTrue(_buyOk(part, HypexToken(hypex).balanceOf(o) - tb, limit), "every fill gives the owner its limit");
            fills++;
        }
        assertEq(fills, amount / part);
        uint256 fees = keeper.balance - k0;
        uint256 tokens = HypexToken(hypex).balanceOf(o) - t0;
        emit log_named_uint("fills", fills);
        emit log_named_uint("fees taken (wei)", fees);
        assertGt(fees, 0, "the keeper earned the headroom");
        assertTrue(_buyOk(amount, tokens, limit), "the whole order gave the owner its limit");
        assertLt(fees, amount * 3 / 100, "fees stay within the headroom the limit left (2% + the price walk)");
    }

    // ---------------------------------------------------------------- price configs

    /// An order keeps the price config it was placed with: the owner moving ETH to a broken feed, a USD token from $1 to
    /// a feed at $0.50, or un-whitelisting it, changes nothing for open orders; new orders take the new config or are
    /// refused
    function test_priceSnapshotSurvivesOwnerChanges() public {
        _usdSetup();
        address o = _usdUser("owner", 10_000);
        uint256 ethOrder = _placeBuy(o, kumo, 1 ether, 1e18, 0);
        uint256 usdOrder = _placeBuyIn(address(usd), o, kumo, 1_000e6, 1e18, 0);
        // the owner's changes
        MockEthUsdFeed broken = new MockEthUsdFeed(8, 0);
        limitOrders.setPayToken(ETH, broken, 1 hours, false, true);
        MockEthUsdFeed half = new MockEthUsdFeed(8, 0.5e8);
        limitOrders.setPayToken(address(usd), half, 1 hours, false, true);
        assertEq(limitOrders.priceOf(address(usd)), 0.5e18);
        vm.expectRevert(IHypexLimitOrders.FeedPriceInvalid.selector);
        limitOrders.ethUsd();
        // the open orders: their own configs (the $2,600 feed, $1)
        vm.recordLogs();
        _fill(ethOrder, 0.5 ether, 0);
        assertEq(_lastFilled().payUsdE18, ETH_USD);
        vm.recordLogs();
        _fill(usdOrder, 500e6, 0);
        assertEq(_lastFilled().payUsdE18, 1e18, "still $1");
        // new orders: the new configs
        uint256 newEth = _placeBuy(o, kumo, 1 ether, 1e18, 0);
        assertEq(address(_order(newEth).pricing.feed), address(broken));
        _expectFillRevert(newEth, 0.5 ether, 0, IHypexLimitOrders.FeedPriceInvalid.selector);
        uint256 newUsd = _placeBuyIn(address(usd), o, kumo, 1_000e6, 1e18, 0);
        vm.recordLogs();
        _fill(newUsd, 500e6, 0);
        assertEq(_lastFilled().payUsdE18, 0.5e18);
        // un-whitelisted: no new orders, the open ones still fill and cancel
        limitOrders.setPayToken(address(usd), half, 1 hours, false, false);
        vm.prank(o);
        vm.expectRevert(IHypexLimitOrders.NotPayToken.selector);
        limitOrders.place(BUY, kumo, address(usd), 1e6, 1e18, _expiry(), 0);
        _fill(usdOrder, 500e6, 0);
        assertEq(_order(usdOrder).remaining, 0);
        uint256 u0 = usd.balanceOf(o);
        vm.prank(o);
        limitOrders.cancel(newUsd, o);
        assertEq(usd.balanceOf(o) - u0, 500e6);
    }

    function test_feedStaleOrBadReverts() public {
        address o = _user("owner");
        uint256 id = _placeBuy(o, kumo, 1 ether, 1e18, 0);
        uint256 t = vm.getBlockTimestamp();
        assertEq(limitOrders.ethUsd(), ETH_USD);
        // exactly maxPriceAge old: still good; a second more: stale
        vm.warp(t + FEED_MAX_AGE);
        assertEq(limitOrders.ethUsd(), ETH_USD);
        vm.warp(t + FEED_MAX_AGE + 1);
        vm.expectRevert(IHypexLimitOrders.FeedPriceStale.selector);
        limitOrders.ethUsd();
        _expectFillRevert(id, 0.5 ether, 0, IHypexLimitOrders.FeedPriceStale.selector);
        _fresh();
        t = vm.getBlockTimestamp();
        // zero and negative answers
        feed.setAnswer(0);
        _expectFillRevert(id, 0.5 ether, 0, IHypexLimitOrders.FeedPriceInvalid.selector);
        feed.setAnswer(-1);
        _expectFillRevert(id, 0.5 ether, 0, IHypexLimitOrders.FeedPriceInvalid.selector);
        // an update from the future, never updated
        feed.setRound(5, ETH_USD_8, t + 1, 5);
        _expectFillRevert(id, 0.5 ether, 0, IHypexLimitOrders.FeedPriceStale.selector);
        feed.setRound(5, ETH_USD_8, 0, 5);
        _expectFillRevert(id, 0.5 ether, 0, IHypexLimitOrders.FeedPriceStale.selector);
        // answeredInRound isn't read (Chainlink deprecated it): a feed reporting 0 or an older round still fills
        feed.setRound(5, ETH_USD_8, t, 0);
        _fill(id, 0.25 ether, 0);
        feed.setRound(5, ETH_USD_8, t, 4);
        _fill(id, 0.25 ether, 0);
        // a broken feed never locks escrow: cancel doesn't read it
        feed.setAnswer(-1);
        vm.prank(o);
        limitOrders.cancel(id, o);
        assertEq(address(limitOrders).balance, 0);
    }

    /// Each pay token has its own max age: a feed-priced USD token with a 10-minute age goes stale while ETH's hour holds
    function test_maxPriceAgeIsPerToken() public {
        _usdSetup();
        MockEthUsdFeed usdFeed = new MockEthUsdFeed(8, 1e8);
        limitOrders.setPayToken(address(usd), usdFeed, 10 minutes, false, true);
        address o = _usdUser("owner", 10_000);
        uint256 id = _placeBuyIn(address(usd), o, kumo, 1_000e6, 1e18, 0);
        vm.warp(vm.getBlockTimestamp() + 10 minutes + 1);
        _fresh(); // ETH's feed only
        assertEq(limitOrders.ethUsd(), ETH_USD);
        _expectFillRevert(id, 100e6, 0, IHypexLimitOrders.FeedPriceStale.selector);
        usdFeed.setAnswer(1e8);
        _fill(id, 100e6, 0);
    }

    /// Any feed decimals up to 18 read as the same 1e18-scaled price
    function test_feedDecimalsNormalised() public {
        uint8[3] memory dec = [0, 8, 18];
        for (uint256 i; i < 3; i++) {
            MockEthUsdFeed f = new MockEthUsdFeed(dec[i], int256(2600 * 10 ** uint256(dec[i])));
            limitOrders.setPayToken(ETH, f, 1 hours, false, true);
            assertEq(limitOrders.ethUsd(), ETH_USD);
        }
    }

    /// With an L2 sequencer uptime feed: no feed price while it reports the sequencer down, until the grace period has
    /// passed since it came back up, or while it has no round yet; then the feed as without one. A stable pay token
    /// reads no feed at all.
    function test_sequencerUptimeFeed() public {
        MockEthUsdFeed seq = new MockEthUsdFeed(0, 0); // up, since now
        HypexLimitOrders lo = new HypexLimitOrders(pm, factory, address(this), seq, 1 hours);
        lo.setPayToken(ETH, feed, FEED_MAX_AGE, false, true);
        MockQuote six = new MockQuote(6, 0);
        lo.setPayToken(address(six), IAggregatorV3(address(0)), 0, true, true);
        assertEq(address(lo.sequencerUptimeFeed()), address(seq));
        assertEq(lo.sequencerGracePeriod(), 1 hours);
        uint256 t = vm.getBlockTimestamp();
        vm.expectRevert(IHypexLimitOrders.SequencerGracePeriod.selector);
        lo.ethUsd();
        assertEq(lo.priceOf(address(six)), 1e18, "stable: no feed read");
        // up for exactly the grace period: still waiting; a second more: the price
        vm.warp(t + 1 hours);
        vm.expectRevert(IHypexLimitOrders.SequencerGracePeriod.selector);
        lo.ethUsd();
        vm.warp(t + 1 hours + 1);
        _fresh();
        assertEq(lo.ethUsd(), ETH_USD);
        // down
        t = vm.getBlockTimestamp();
        seq.setRound(2, 1, t, 2);
        vm.expectRevert(IHypexLimitOrders.SequencerDown.selector);
        lo.ethUsd();
        assertEq(lo.priceOf(address(six)), 1e18);
        // back up: the grace period again, from when it came back
        vm.warp(t + 10 minutes);
        seq.setRound(3, 0, t + 10 minutes, 3);
        _fresh();
        vm.expectRevert(IHypexLimitOrders.SequencerGracePeriod.selector);
        lo.ethUsd();
        vm.warp(t + 10 minutes + 1 hours + 1);
        _fresh();
        assertEq(lo.ethUsd(), ETH_USD);
        // no round yet, and a start in the future
        seq.setRound(0, 0, 0, 0);
        vm.expectRevert(IHypexLimitOrders.SequencerGracePeriod.selector);
        lo.ethUsd();
        seq.setRound(4, 0, vm.getBlockTimestamp() + 1, 4);
        vm.expectRevert(IHypexLimitOrders.SequencerGracePeriod.selector);
        lo.ethUsd();
        // the feed's checks still apply once the sequencer is past its grace period
        seq.setRound(5, 0, 1, 5);
        feed.setAnswer(0);
        vm.expectRevert(IHypexLimitOrders.FeedPriceInvalid.selector);
        lo.ethUsd();
    }

    /// Escrow never depends on a feed: with the ETH/USD feed reverting outright, fills stop but the owner cancels and
    /// anyone refunds an expired order
    function test_cancelAndRefundNeverReadAFeed() public {
        address o = _user("owner");
        uint256 a = _placeBuy(o, kumo, 1 ether, 1e18, 0);
        uint256 b = _placeBuy(o, kumo, 1 ether, 1e18, 0);
        IHypexLimitOrders.Hop[] memory route = _routeOf(a);
        vm.mockCallRevert(address(feed), abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector), "feed down");
        vm.prank(keeper, keeper);
        vm.expectRevert(bytes("feed down"));
        limitOrders.fill(a, 0.5 ether, 0, route);
        uint256 e0 = o.balance;
        vm.prank(o);
        limitOrders.cancel(a, o);
        vm.warp(vm.getBlockTimestamp() + 1 days + 1);
        limitOrders.refund(b);
        assertEq(o.balance - e0, 2 ether);
        assertEq(address(limitOrders).balance, 0);
    }

    // ---------------------------------------------------------------- cancel and expiry

    function test_cancel() public {
        address o = _holder("owner");
        uint256 buy = _placeBuy(o, kumo, 1 ether, 1, 0);
        uint256 amount = HypexToken(neko).balanceOf(o) / 2;
        uint256 sell = _placeSell(o, neko, amount, type(uint128).max, 0);
        vm.prank(keeper);
        vm.expectRevert(IHypexLimitOrders.NotOwner.selector);
        limitOrders.cancel(buy, o);
        vm.prank(o);
        vm.expectRevert(IHypexLimitOrders.NotOwner.selector);
        limitOrders.cancel(99, o);
        uint256 e0 = o.balance;
        vm.expectEmit(address(limitOrders));
        emit IHypexLimitOrders.OrderCancelled(buy, o, 1 ether);
        vm.prank(o);
        limitOrders.cancel(buy, o);
        assertEq(o.balance - e0, 1 ether);
        uint256 n0 = HypexToken(neko).balanceOf(o);
        vm.prank(o);
        limitOrders.cancel(sell, o);
        assertEq(HypexToken(neko).balanceOf(o) - n0, amount);
        assertEq(address(limitOrders).balance, 0);
        assertEq(HypexToken(neko).balanceOf(address(limitOrders)), 0);
        vm.prank(o);
        vm.expectRevert(IHypexLimitOrders.OrderClosed.selector);
        limitOrders.cancel(buy, o);
        _expectFillRevert(sell, 1, 0, IHypexLimitOrders.OrderClosed.selector);
    }

    /// A USD BUY's escrow goes back in USD; an owner the pay token freezes cancels to another address
    function test_cancelUsdAndFrozenOwner() public {
        _usdSetup();
        address o = _usdUser("owner", 10_000);
        uint256 id = _placeBuyIn(address(usd), o, kumo, 1_000e6, 1e18, 0);
        _fill(id, 400e6, 0);
        usd.setFrozen(o, true);
        vm.prank(o);
        vm.expectRevert(bytes("frozen"));
        limitOrders.cancel(id, o);
        address rescue = makeAddr("rescue");
        vm.prank(o);
        limitOrders.cancel(id, rescue);
        assertEq(usd.balanceOf(rescue), 600e6);
        assertEq(usd.balanceOf(address(limitOrders)), 0);
    }

    /// After expiry no fill; anyone can send the rest of the escrow back to the owner (or the owner cancels), once
    function test_expiredRefund() public {
        address o = _user("owner");
        uint256 id = _placeBuy(o, kumo, 1 ether, 1e18, 0);
        _fill(id, 0.25 ether, 0);
        vm.expectRevert(IHypexLimitOrders.NotExpired.selector);
        limitOrders.refund(id);
        vm.expectRevert(IHypexLimitOrders.UnknownOrder.selector);
        limitOrders.refund(99);
        vm.warp(vm.getBlockTimestamp() + 1 days + 1);
        uint256 e0 = o.balance;
        vm.expectEmit(address(limitOrders));
        emit IHypexLimitOrders.OrderRefunded(id, o, 0.75 ether);
        vm.prank(makeAddr("anyone"));
        limitOrders.refund(id);
        assertEq(o.balance - e0, 0.75 ether, "paid to the owner");
        assertEq(address(limitOrders).balance, 0);
        vm.expectRevert(IHypexLimitOrders.OrderClosed.selector);
        limitOrders.refund(id);
        // the owner may also cancel an expired order
        uint256 id2 = _placeBuy(o, kumo, 1 ether, 1e18, 0);
        vm.warp(vm.getBlockTimestamp() + 1 days + 1);
        vm.prank(o);
        limitOrders.cancel(id2, o);
        assertEq(address(limitOrders).balance, 0);
    }

    // ---------------------------------------------------------------- snipe window

    /// A BUY at twice the price a fill gets after the snipe window: at second 0 (90% tax) the all-in price is far over
    /// it and the fill reverts; after 60 s it fills. A SELL likewise: at second 0 its proceeds are far under the limit.
    function test_snipeWindowTaxCountsAgainstTheLimit() public {
        address o = _holder("owner");
        vm.prank(alice);
        (address x,) =
            factory.launch{value: 1 ether}(_signedEth(alice, "X", "X", bytes32(uint256(77)), 10_000_000e18, HYPEX_TICK));
        vm.prank(alice);
        HypexToken(x).transfer(o, 1_000_000e18);
        // the post-snipe all-in prices of these two fills
        uint256 probeBuy = _placeBuy(o, x, 0.1 ether, type(uint128).max, 0);
        uint256 probeSell = _placeSell(o, x, 100_000e18, 1, 0);
        uint256 snap = vm.snapshotState();
        vm.warp(vm.getBlockTimestamp() + 61);
        _fresh();
        uint256 tokens = _fill(probeBuy, 0.1 ether, 0);
        vm.revertToState(snap);
        snap = vm.snapshotState();
        vm.warp(vm.getBlockTimestamp() + 61);
        _fresh();
        uint256 eth = _fill(probeSell, 100_000e18, 0);
        vm.revertToState(snap);
        uint256 buy = _placeBuy(o, x, 0.1 ether, 0.1 ether * ETH_USD / tokens * 2, 0);
        uint256 sell = _placeSell(o, x, 100_000e18, eth * ETH_USD / 100_000e18 / 2, 0);
        _expectFillRevert(buy, 0.1 ether, 0, IHypexLimitOrders.LimitNotMet.selector);
        _expectFillRevert(sell, 100_000e18, 0, IHypexLimitOrders.LimitNotMet.selector);
        vm.warp(vm.getBlockTimestamp() + 61);
        _fresh();
        assertGt(_fill(buy, 0.1 ether, 0), 0);
        assertGt(_fill(sell, 100_000e18, 0), 0);
    }

    // ---------------------------------------------------------------- referral attribution

    /// A fill credits the order's owner's referrer, never the keeper's (the keeper is tx.origin): every Split of the
    /// fill names the owner as the trader, and the share is owed to the owner's referrer. Both HYPEX-pool hops of a
    /// $HYPEX pair (the $HYPEX pool's ETH, NEKO's pool's $HYPEX); a USD route's reference pool hop gets no hookData and
    /// credits no one.
    function test_referralGoesToTheOwnersReferrer() public {
        _usdSetup();
        address r = makeAddr("ownerReferrer");
        address o = _referred("owner", r);
        usd.transfer(o, 10_000e6);
        vm.prank(o);
        usd.approve(address(limitOrders), type(uint256).max);
        address kr = makeAddr("keeperReferrer");
        assertEq(_bind(keeper, kr), 1);
        vm.deal(keeper, 10 ether);
        uint256 buy = _placeBuy(o, kumo, 1 ether, 1e18, 0);
        uint256 viaHypex = _placeBuy(o, neko, 1 ether, 1e18, 0);
        uint256 viaUsd = _placeBuyIn(address(usd), o, kumo, 1_000e6, 1e18, 0);
        uint256 r0 = revenue.owed(r, ETH);
        uint256 held = r.balance;
        vm.recordLogs();
        _fill(buy, 1 ether, 0);
        assertEq(_splits(o, r), 1);
        uint256 r1 = revenue.owed(r, ETH);
        assertGt(r1, r0, "the owner's referrer earned on the fill");
        uint256 rf = revenue.owed(r, hypex);
        _fill(viaHypex, 1 ether, 0);
        assertEq(_splits(o, r), 2, "both HYPEX-pool hops");
        assertGt(revenue.owed(r, ETH), r1);
        assertGt(revenue.owed(r, hypex), rf);
        uint256 r2 = revenue.owed(r, ETH);
        _fill(viaUsd, 1_000e6, 0);
        assertEq(_splits(o, r), 1, "the USD -> ETH hop is no HYPEX pool");
        assertGt(revenue.owed(r, ETH), r2);
        assertEq(r.balance, held, "owed, not paid in the fill");
        assertEq(_earned(kr, ETH) + _earned(kr, hypex), 0, "nothing to the keeper's referrer");
        // the same swap through a router credits tx.origin, as before
        vm.recordLogs();
        _swap(keeper, kumoKey, true, -1 ether, 1 ether);
        assertEq(_splits(keeper, kr), 1);
    }

    /// hookData naming someone else is read only from HypexLimitOrders: a router's swap carrying the owner's address (or
    /// garbage) credits tx.origin, the trader who sent it
    function test_spoofedHookDataIsIgnored() public {
        address r = makeAddr("victimReferrer");
        address victim = _referred("victim", r);
        address attacker = _trader("attacker");
        address ar = makeAddr("attackerReferrer");
        assertEq(_bind(attacker, ar), 1);
        uint256 r0 = _earned(r, ETH);
        bytes[2] memory spoofs = [abi.encode(victim), bytes(hex"01")];
        for (uint256 i; i < 2; i++) {
            vm.recordLogs();
            vm.prank(attacker, attacker);
            router.swap{value: 1 ether}(
                kumoKey,
                IPoolManager.SwapParams({
                    zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                spoofs[i]
            );
            assertEq(_splits(attacker, ar), 1, "credited to tx.origin");
        }
        assertEq(_earned(r, ETH), r0, "the victim's referrer got nothing");
    }

    /// HypexRevenue Splits in the recorded logs naming `trader` and `referrer` (and none naming anyone else)
    function _splits(address trader, address referrer) internal returns (uint256 n) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            Vm.Log memory l = logs[i];
            if (l.emitter != address(revenue) || l.topics[0] != IHypexRevenue.Split.selector) continue;
            assertEq(address(uint160(uint256(l.topics[2]))), trader, "Split trader");
            assertEq(address(uint160(uint256(l.topics[3]))), referrer, "Split referrer");
            n++;
        }
    }

    // ---------------------------------------------------------------- reentrancy

    /// A keeper's route through a pool whose hook reenters HypexLimitOrders (fill, cancel, refund, place) in its
    /// beforeSwap: every reentry reverts ReentrancyGuardReentrantCall, the hook gets no hookData (it isn't the HYPEX
    /// hook), and the fill completes once, within the limit
    function test_reentrantPoolHook() public {
        _usdSetup();
        address hookAddr = address(uint160(Hooks.BEFORE_SWAP_FLAG) | (uint160(0x5555) << 144));
        deployCodeTo("LimitOrders.t.sol:ReentrantPoolHook", abi.encode(limitOrders), hookAddr);
        ReentrantPoolHook evil = ReentrantPoolHook(hookAddr);
        PoolKey memory evilKey =
            PoolKey(Currency.wrap(ETH), Currency.wrap(address(usd)), USD_POOL_FEE, USD_POOL_SPACING, IHooks(hookAddr));
        _initUsdPool(evilKey, USD_PER_ETH, 100 ether);
        address o = _usdUser("owner", 10_000);
        uint256 id = _placeBuyIn(address(usd), o, kumo, 1_000e6, 1e18, 0);
        evil.target(id);
        IHypexLimitOrders.Hop[] memory r = new IHypexLimitOrders.Hop[](2);
        r[0] = _hop(evilKey, false);
        r[1] = _hop(kumoKey, true);
        uint256 out = _fillVia(id, 400e6, 0, r);
        assertGt(out, 0);
        assertEq(evil.reentries(), 4);
        assertEq(evil.blocked(), 4, "every reentry blocked");
        assertEq(evil.hookDataLength(), 0, "no hookData to another hook");
        assertEq(_order(id).remaining, 600e6, "filled once");
        assertEq(usd.balanceOf(address(limitOrders)), 600e6);
    }

    /// An owner whose receive() reenters (fill, cancel, refund, place) on every ETH it gets: a SELL's proceeds and a
    /// BUY's cancel refund. Every reentry reverts ReentrancyGuardReentrantCall; the outer call completes once.
    function test_reentrantOwner() public {
        ReentrantOwner ro = new ReentrantOwner(limitOrders);
        vm.deal(address(ro), 10 ether);
        address h = _holder("holder");
        vm.prank(h);
        HypexToken(kumo).transfer(address(ro), 10_000e18);
        uint256 sell = ro.placeSell(kumo, 10_000e18);
        _fill(sell, 5_000e18, 0);
        assertEq(ro.reentries(), 4);
        assertEq(ro.blocked(), 4, "every reentry blocked");
        assertEq(_order(sell).remaining, 5_000e18, "filled once");
        uint256 buy = ro.placeBuy(kumo, 1 ether);
        ro.cancel(buy);
        assertEq(ro.reentries(), 8);
        assertEq(ro.blocked(), 8);
        assertEq(address(limitOrders).balance, 0);
        assertEq(HypexToken(kumo).balanceOf(address(limitOrders)), 5_000e18);
    }

    /// A keeper contract whose receive() reenters fill for the fee again: blocked, the order filled once
    function test_reentrantFiller() public {
        address o = _user("owner");
        uint256 id = _placeBuy(o, kumo, 1 ether, 1e18, 0.001 ether);
        ReentrantFiller rf = new ReentrantFiller(limitOrders);
        limitOrders.setKeeper(address(rf), true);
        rf.fill(id, 0.1 ether, 0.001 ether, _routeOf(id));
        assertTrue(rf.reentered());
        assertEq(rf.reason(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(_order(id).remaining, 0.9 ether);
        assertEq(address(rf).balance, 0.001 ether, "one fee");
    }

    /// An owner that can't take ETH only blocks its own SELL's fills; it can still cancel and get its tokens back
    function test_ownerRejectingEthBlocksOnlyItself() public {
        RejectingOwner ro = new RejectingOwner(limitOrders);
        address h = _holder("holder");
        vm.prank(h);
        HypexToken(kumo).transfer(address(ro), 10_000e18);
        uint256 id = ro.placeSell(kumo, 10_000e18);
        _expectFillRevert(id, 10_000e18, 0, IHypexLimitOrders.EthTransferFailed.selector);
        ro.cancel(id);
        assertEq(HypexToken(kumo).balanceOf(address(ro)), 10_000e18);
    }

    /// An owner that can't take ETH can't get a BUY's escrow back to itself, but cancelling to another address can
    function test_ownerRejectingEthCancelsBuyToAnotherAddress() public {
        RejectingOwner ro = new RejectingOwner(limitOrders);
        vm.deal(address(ro), 1 ether);
        uint256 id = ro.placeBuy(kumo, 1 ether);
        vm.expectRevert(IHypexLimitOrders.EthTransferFailed.selector);
        ro.cancel(id);
        vm.expectRevert(IHypexLimitOrders.ZeroAddress.selector);
        ro.cancelTo(id, address(0));
        address rescue = makeAddr("rescue");
        ro.cancelTo(id, rescue);
        assertEq(rescue.balance, 1 ether);
        assertEq(address(limitOrders).balance, 0);
    }

    // ---------------------------------------------------------------- escrow accounting

    /// Fuzz: random places (both kinds, ETH or USD pay, four tokens, limits that fill or never do, random expiries),
    /// fills (random size and fee), cancels, clock steps and refunds of expired orders. After every step this contract
    /// holds exactly the open orders' escrow: its ETH and USD == the open BUYs' remaining in each, each token == the open
    /// SELLs' remaining in it. Fills only ever revert for the limit (or a SELL's fee over its proceeds).
    /// forge-config: default.fuzz.runs = 128
    function testFuzz_escrowEqualsOpenOrders(uint256 seed) public {
        _usdSetup();
        address[3] memory owners = [_holder("o0"), _holder("o1"), _holder("o2")];
        for (uint256 i; i < 3; i++) {
            usd.transfer(owners[i], 100_000e6);
            vm.prank(owners[i]);
            usd.approve(address(limitOrders), type(uint256).max);
        }
        address[4] memory tokens = [hypex, kumo, neko, usdy];
        for (uint256 step; step < 24; step++) {
            uint256 r = uint256(keccak256(abi.encode(seed, step)));
            uint256 action = r % 5;
            address o = owners[(r >> 8) % 3];
            address token = tokens[(r >> 16) % 4];
            bool fills = (r >> 24) % 3 != 0;
            address pay = (r >> 28) % 2 == 0 ? ETH : address(usd);
            uint256 expiry = vm.getBlockTimestamp() + 1 + (r >> 32) % 2 hours;
            uint256 maxFee = (r >> 64) % (pay == ETH ? 0.01 ether : 10e6);
            if (action == 0) {
                uint256 amount = 1 + (r >> 96) % (pay == ETH ? 2 ether : 2_000e6);
                vm.prank(o);
                limitOrders.place{value: pay == ETH ? amount : 0}(
                    BUY, token, pay, amount, fills ? 1e18 : 1, expiry, maxFee
                );
            } else if (action == 1 && HypexToken(token).balanceOf(o) >= 4) {
                uint256 amount = 1 + (r >> 96) % (HypexToken(token).balanceOf(o) / 4);
                vm.startPrank(o);
                HypexToken(token).approve(address(limitOrders), amount);
                limitOrders.place(SELL, token, pay, amount, fills ? 1 : type(uint128).max, expiry, maxFee);
                vm.stopPrank();
            } else if (action == 2 && limitOrders.orderCount() != 0) {
                _randomFill(1 + (r >> 8) % limitOrders.orderCount(), r >> 40);
            } else if (action == 3 && limitOrders.orderCount() != 0) {
                uint256 id = 1 + (r >> 8) % limitOrders.orderCount();
                IHypexLimitOrders.Order memory ord = _order(id);
                if (ord.remaining != 0) {
                    vm.prank(ord.owner);
                    limitOrders.cancel(id, ord.owner);
                }
            } else {
                vm.roll(vm.getBlockNumber() + 1);
                vm.warp(vm.getBlockTimestamp() + (r >> 8) % 1 hours);
                _fresh();
                for (uint256 id = 1; id <= limitOrders.orderCount(); id++) {
                    IHypexLimitOrders.Order memory ord = _order(id);
                    if (ord.remaining != 0 && vm.getBlockTimestamp() > ord.expiry) limitOrders.refund(id);
                }
            }
            _checkEscrow(tokens);
        }
    }

    function _randomFill(uint256 id, uint256 r) internal {
        IHypexLimitOrders.Order memory ord = _order(id);
        if (ord.remaining == 0 || vm.getBlockTimestamp() > ord.expiry) return;
        uint256 amountIn = 1 + r % ord.remaining;
        uint256 fee = ord.maxFeePerFill == 0 ? 0 : (r >> 128) % (uint256(ord.maxFeePerFill) + 1);
        if (ord.kind == BUY && fee >= amountIn) fee = amountIn - 1;
        (bool ok, bytes memory err) = _tryFill(id, amountIn, fee);
        if (!ok) {
            bytes4 e = bytes4(err);
            assertTrue(
                e == IHypexLimitOrders.LimitNotMet.selector
                    || (ord.kind == SELL && e == IHypexLimitOrders.FeeTooHigh.selector),
                "fills only revert for the limit or a SELL's fee over its proceeds"
            );
        }
    }

    function _checkEscrow(address[4] memory tokens) internal view {
        uint256 eth;
        uint256 usdHeld;
        uint256[4] memory held;
        for (uint256 id = 1; id <= limitOrders.orderCount(); id++) {
            IHypexLimitOrders.Order memory ord = _order(id);
            if (ord.kind == BUY) {
                if (ord.payToken == ETH) eth += ord.remaining;
                else usdHeld += ord.remaining;
            } else {
                for (uint256 i; i < 4; i++) {
                    if (ord.token == tokens[i]) held[i] += ord.remaining;
                }
            }
        }
        assertEq(address(limitOrders).balance, eth, "ETH == open ETH BUYs' escrow");
        assertEq(usd.balanceOf(address(limitOrders)), usdHeld, "USD == open USD BUYs' escrow");
        for (uint256 i; i < 4; i++) {
            assertEq(HypexToken(tokens[i]).balanceOf(address(limitOrders)), held[i], "tokens == open SELLs' escrow");
        }
    }

    // ---------------------------------------------------------------- gas

    /// Fill gas (run with --isolate for cold-transaction numbers): a BUY on an ETH pair (one hop), a SELL on a $HYPEX
    /// pair (two hops), a USD BUY on a $HYPEX pair (three hops), each with a fee
    function test_gas_fill() public {
        _usdSetup();
        address o = _holder("owner");
        usd.transfer(o, 10_000e6);
        vm.prank(o);
        usd.approve(address(limitOrders), type(uint256).max);
        uint256 buy = _placeBuy(o, kumo, 1 ether, 1e18, 0.001 ether);
        uint256 amount = HypexToken(neko).balanceOf(o) / 2;
        uint256 sell = _placeSell(o, neko, amount, 1, 0.001 ether);
        uint256 usdBuy = _placeBuyIn(address(usd), o, neko, 1_000e6, 1e18, 1e6);
        IHypexLimitOrders.Hop[] memory r1 = _routeOf(buy);
        IHypexLimitOrders.Hop[] memory r2 = _routeOf(sell);
        IHypexLimitOrders.Hop[] memory r3 = _routeOf(usdBuy);
        vm.prank(keeper, keeper);
        uint256 g = gasleft();
        limitOrders.fill(buy, 0.5 ether, 0.001 ether, r1);
        g -= gasleft();
        emit log_named_uint("fill gas, BUY, ETH pair (1 hop)", g);
        vm.prank(keeper, keeper);
        g = gasleft();
        limitOrders.fill(sell, amount / 2, 0.001 ether, r2);
        g -= gasleft();
        emit log_named_uint("fill gas, SELL, $HYPEX pair (2 hops)", g);
        vm.prank(keeper, keeper);
        g = gasleft();
        limitOrders.fill(usdBuy, 500e6, 1e6, r3);
        g -= gasleft();
        emit log_named_uint("fill gas, USD BUY, $HYPEX pair (3 hops)", g);
        vm.prank(o);
        g = gasleft();
        limitOrders.place{value: 1 ether}(BUY, neko, ETH, 1 ether, 1e18, _expiry(), 0);
        g -= gasleft();
        emit log_named_uint("place gas, BUY", g);
    }
}

/// A pool hook (beforeSwap only) that reenters HypexLimitOrders four ways on every swap, counting the reentries that were
/// blocked (ReentrancyGuardReentrantCall), and the length of the hookData it was given
contract ReentrantPoolHook {
    HypexLimitOrders immutable lo;
    uint256 public id;
    uint256 public reentries;
    uint256 public blocked;
    uint256 public hookDataLength;

    constructor(HypexLimitOrders _lo) {
        lo = _lo;
    }

    function target(uint256 _id) external {
        id = _id;
    }

    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata hookData)
        external
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        hookDataLength = hookData.length;
        IHypexLimitOrders.Hop[] memory none;
        bytes[4] memory calls = [
            abi.encodeCall(lo.fill, (id, 1, 0, none)),
            abi.encodeCall(lo.cancel, (id, address(this))),
            abi.encodeCall(lo.refund, (id)),
            abi.encodeCall(lo.place, (IHypexLimitOrders.Kind.BUY, address(1), address(0), 1, 1, block.timestamp + 1, 0))
        ];
        for (uint256 i; i < 4; i++) {
            reentries++;
            (bool ok, bytes memory err) = address(lo).call(calls[i]);
            if (!ok && bytes4(err) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector) blocked++;
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

/// An order owner whose receive() reenters HypexLimitOrders four ways on every ETH payment, counting the reentries
/// that were blocked (ReentrancyGuardReentrantCall)
contract ReentrantOwner {
    HypexLimitOrders immutable lo;
    uint256 public id;
    uint256 public reentries;
    uint256 public blocked;

    constructor(HypexLimitOrders _lo) {
        lo = _lo;
    }

    function placeSell(address token, uint256 amount) external returns (uint256) {
        HypexToken(token).approve(address(lo), amount);
        id = lo.place(IHypexLimitOrders.Kind.SELL, token, address(0), amount, 1, block.timestamp + 1 days, 0);
        return id;
    }

    function placeBuy(address token, uint256 amount) external returns (uint256) {
        id = lo.place{value: amount}(
            IHypexLimitOrders.Kind.BUY, token, address(0), amount, 1, block.timestamp + 1 days, 0
        );
        return id;
    }

    function cancel(uint256 orderId) external {
        lo.cancel(orderId, address(this));
    }

    receive() external payable {
        IHypexLimitOrders.Hop[] memory none;
        bytes[4] memory calls = [
            abi.encodeCall(lo.fill, (id, 1, 0, none)),
            abi.encodeCall(lo.cancel, (id, address(this))),
            abi.encodeCall(lo.refund, (id)),
            abi.encodeCall(lo.place, (IHypexLimitOrders.Kind.BUY, address(1), address(0), 1, 1, block.timestamp + 1, 0))
        ];
        for (uint256 i; i < 4; i++) {
            reentries++;
            (bool ok, bytes memory err) = address(lo).call(calls[i]);
            if (!ok && bytes4(err) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector) blocked++;
        }
    }
}

/// A keeper contract whose receive() tries to fill the same order again for another fee
contract ReentrantFiller {
    HypexLimitOrders immutable lo;
    uint256 id;
    uint256 amountIn;
    uint256 fee;
    IHypexLimitOrders.Hop[] route;
    bool public reentered;
    bytes4 public reason;

    constructor(HypexLimitOrders _lo) {
        lo = _lo;
    }

    function fill(uint256 _id, uint256 _amountIn, uint256 _fee, IHypexLimitOrders.Hop[] memory _route) external {
        (id, amountIn, fee) = (_id, _amountIn, _fee);
        for (uint256 i; i < _route.length; i++) {
            route.push(_route[i]);
        }
        lo.fill(_id, _amountIn, _fee, _route);
    }

    receive() external payable {
        if (reentered) return;
        reentered = true;
        try lo.fill(id, amountIn, fee, route) {}
        catch (bytes memory err) {
            reason = bytes4(err);
        }
    }
}

/// An order owner that rejects ETH
contract RejectingOwner {
    HypexLimitOrders immutable lo;

    constructor(HypexLimitOrders _lo) {
        lo = _lo;
    }

    function placeSell(address token, uint256 amount) external returns (uint256) {
        HypexToken(token).approve(address(lo), amount);
        return lo.place(IHypexLimitOrders.Kind.SELL, token, address(0), amount, 1, block.timestamp + 1 days, 0);
    }

    function placeBuy(address token, uint256 amount) external returns (uint256) {
        return
            lo.place{value: amount}(
                IHypexLimitOrders.Kind.BUY, token, address(0), amount, 1, block.timestamp + 1 days, 0
            );
    }

    function cancel(uint256 id) external {
        lo.cancel(id, address(this));
    }

    function cancelTo(uint256 id, address to) external {
        lo.cancel(id, to);
    }

    receive() external payable {
        revert("no ETH");
    }
}
