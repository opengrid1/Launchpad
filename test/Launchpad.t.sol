// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Launchpad} from "../src/Launchpad.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {
    IWHYPE,
    INonfungiblePositionManager,
    ISwapRouter
} from "../src/interfaces/IHyperswapV3.sol";
import {FullMath} from "../src/libraries/FullMath.sol";
import {TickMath} from "../src/libraries/TickMath.sol";
import {MockWHYPE, MockPool, MockPositionManager, MockSwapRouter} from "./mocks/HyperswapV3Mocks.sol";

contract LaunchpadTest is Test {
    // Etch WHYPE at the top of the address space so freshly created tokens sort
    // below it (token == token0). A separate test etches it low for the
    // token == token1 ordering.
    address constant WHYPE_HIGH = address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF);
    address constant WHYPE_LOW = address(0x0000000000000000000000000000000000000100);

    uint256 constant SUPPLY = 1_000_000_000e18;
    uint256 constant Q96 = 0x1000000000000000000000000;

    // HyperCore oracle mock: HYPE at $60.569 (raw perp price, 4 decimals).
    address constant ORACLE = 0x0000000000000000000000000000000000000807;
    uint64 constant ORACLE_RAW = 605_690;
    uint256 constant HYPE_USD6 = uint256(ORACLE_RAW) * 100;
    uint256 constant MC_USD6 = 4_000e6;

    MockPositionManager pm;
    MockSwapRouter router;
    address whype;
    Launchpad pad;

    address creator = makeAddr("creator");
    address treasury = makeAddr("treasury");
    address rando = makeAddr("rando");

    function setUp() public {
        _deployStack(WHYPE_HIGH);
    }

    function _deployStack(address whypeAddr) internal {
        MockWHYPE impl = new MockWHYPE();
        vm.etch(whypeAddr, address(impl).code);
        whype = whypeAddr;

        pm = new MockPositionManager();
        router = new MockSwapRouter(pm);
        pad = new Launchpad(
            INonfungiblePositionManager(address(pm)),
            ISwapRouter(address(router)),
            IWHYPE(whype),
            treasury
        );
        vm.mockCall(ORACLE, abi.encode(uint32(159)), abi.encode(ORACLE_RAW));
    }

    function _launch() internal returns (address token) {
        vm.prank(creator);
        token = pad.createToken("Test Token", "TEST", "ipfs://QmMeta", SUPPLY, address(0), address(0), 0, 0);
    }

    /// @dev HYPE wei per 1e18 tokens implied by a $4k cap at the mocked oracle price.
    function _expectedPrice() internal pure returns (uint256) {
        uint256 mcHypeWei = FullMath.mulDiv(MC_USD6, 1e18, HYPE_USD6);
        return FullMath.mulDiv(mcHypeWei, 1e18, SUPPLY);
    }

    function _launchInfo(address token)
        internal
        view
        returns (address creator_, address pool_, uint256 positionId_, bool tokenIsToken0_, bool withdrawn_)
    {
        (creator_,, tokenIsToken0_, withdrawn_,,, pool_, positionId_) = pad.launches(token);
    }

    // ------------------------------------------------------------------ create

    function test_createToken_metadataAndSupply() public {
        address token = _launch();
        LaunchToken t = LaunchToken(token);

        assertEq(t.name(), "Test Token");
        assertEq(t.symbol(), "TEST");
        assertEq(t.tokenURI(), "ipfs://QmMeta");
        assertEq(t.totalSupply(), SUPPLY);
        // Entire supply sits in the pool; creator and launchpad hold nothing.
        assertEq(t.balanceOf(creator), 0);
        assertEq(t.balanceOf(address(pad)), 0);
        assertEq(t.balanceOf(pm.lastPool()), SUPPLY);

        (address c, address pool, uint256 id, bool is0, bool withdrawn) = _launchInfo(token);
        assertEq(c, creator);
        assertEq(pool, pm.lastPool());
        assertEq(id, 1);
        assertTrue(is0); // WHYPE etched high -> token sorts first
        assertFalse(withdrawn);
    }

    function test_createToken_initialPriceMatches() public {
        address token = _launch();
        (, address pool,,,) = _launchInfo(token);
        (uint160 sqrtPriceX96,,,,,,) = MockPool(pool).slot0();

        // Round-trip: (sqrtP/2^96)^2 * 1e18 should give back the HYPE price per token.
        uint256 priceBack =
            FullMath.mulDiv(FullMath.mulDiv(1e18, sqrtPriceX96, Q96), sqrtPriceX96, Q96);
        assertApproxEqRel(priceBack, _expectedPrice(), 1e12); // within 0.0001%
        assertEq(MockPool(pool).cardinalityNext(), pad.OBSERVATION_CARDINALITY());

        // The launch lists at exactly the configured $4k market cap.
        assertApproxEqRel(pad.getMarketCapUsd(token), MC_USD6, 1e12);
    }

    function test_createToken_singleSidedAboveCurrentPrice() public {
        address token = _launch();
        (,,, int24 tickLower, int24 tickUpper, uint256 amount0, uint256 amount1,) = pm.minted(1);

        // token0-only position: tokens deposited, no HYPE, range above spot.
        assertEq(amount0, SUPPLY);
        assertEq(amount1, 0);
        assertEq(tickUpper, int24(887200));
        assertEq(tickLower % 200, 0);
        // Range starts exactly one spacing above the floored spot tick.
        (, address pool,,,) = _launchInfo(token);
        (uint160 sqrtPriceX96,,,,,,) = MockPool(pool).slot0();
        int24 spotTick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        int24 compressed = spotTick / 200;
        if (spotTick < 0 && spotTick % 200 != 0) compressed--;
        assertEq(tickLower, compressed * 200 + 200);
        assertGt(tickLower, spotTick);
    }

    function test_createToken_token1Ordering() public {
        _deployStack(WHYPE_LOW);
        address token = _launch();

        (,, uint256 id, bool is0,) = _launchInfo(token);
        assertFalse(is0);

        (,,, int24 tickLower, int24 tickUpper, uint256 amount0, uint256 amount1,) = pm.minted(id);
        // token1-only position: range below spot.
        assertEq(amount0, 0);
        assertEq(amount1, SUPPLY);
        assertEq(tickLower, int24(-887200));

        (, address pool,,,) = _launchInfo(token);
        (uint160 sqrtPriceX96,,,,,,) = MockPool(pool).slot0();
        int24 spotTick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        int24 compressed = spotTick / 200;
        if (spotTick < 0 && spotTick % 200 != 0) compressed--;
        assertEq(tickUpper, compressed * 200);
        assertLe(tickUpper, spotTick);

        // Inverted ratio: token1 per token0 is tokens-per-HYPE here.
        uint256 tokensPerHype =
            FullMath.mulDiv(FullMath.mulDiv(1e18, sqrtPriceX96, Q96), sqrtPriceX96, Q96);
        assertApproxEqRel(tokensPerHype, FullMath.mulDiv(1e18, 1e18, _expectedPrice()), 1e12);
    }

    function test_createToken_publicData() public {
        vm.warp(1_750_000_000);
        address token = _launch();

        assertEq(pad.allTokensLength(), 1);
        assertEq(pad.allTokens(0), token);
        address[] memory mine = pad.tokensByCreator(creator);
        assertEq(mine.length, 1);
        assertEq(mine[0], token);
        assertEq(pad.tokensByCreator(rando).length, 0);

        (, uint64 createdAt,,,,,,) = pad.launches(token);
        assertEq(createdAt, 1_750_000_000);

        // Spot price view matches the launch price; market cap = price * supply.
        assertApproxEqRel(pad.getPrice(token), _expectedPrice(), 1e12);
        assertApproxEqRel(
            pad.getMarketCap(token), FullMath.mulDiv(_expectedPrice(), SUPPLY, 1e18), 1e12
        );

        vm.expectRevert("unknown token");
        pad.getPrice(address(0xBEEF));

        // Second launch appends.
        vm.prank(creator);
        pad.createToken("Two", "TWO", "u2", SUPPLY, address(0), address(0), 0, 0);
        assertEq(pad.allTokensLength(), 2);
        assertEq(pad.tokensByCreator(creator).length, 2);
    }

    function test_collectFees_lifetimeCounters() public {
        address token = _launch();
        _accrueFees(token, 1000e18, 10 ether);
        pad.collectFees(token);
        assertEq(pad.lifetimeFeesHype(token), 10 ether);
        assertEq(pad.lifetimeFeesToken(token), 1000e18);

        _accrueFees(token, 0, 5 ether);
        pad.collectFees(token);
        assertEq(pad.lifetimeFeesHype(token), 15 ether);
        assertEq(pad.lifetimeFeesToken(token), 1000e18);
        // Lifetime counters are cumulative and unaffected by claims.
        vm.prank(creator);
        pad.claimCreatorFees(token);
        assertEq(pad.lifetimeFeesHype(token), 15 ether);
    }

    function test_createToken_devBuy() public {
        router.setRate(1000e18); // mock: 1000 tokens out per HYPE in

        vm.deal(creator, 5 ether);
        vm.prank(creator);
        address token = pad.createToken{value: 2 ether}(
            "Test Token", "TEST", "ipfs://QmMeta", SUPPLY, address(0), address(0), 0, 1900e18
        );

        assertEq(LaunchToken(token).balanceOf(creator), 2000e18);
        // The dev buy's HYPE went into the pool, wrapped.
        assertEq(MockWHYPE(payable(whype)).balanceOf(pm.lastPool()), 2 ether);
    }

    function test_createToken_devBuySlippageReverts() public {
        router.setRate(1000e18);
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        vm.expectRevert("Too little received");
        pad.createToken{value: 1 ether}("T", "T", "u", SUPPLY, address(0), address(0), 0, 1001e18);
    }

    function test_relayedLaunch_creditsRealCreator() public {
        address relayer = makeAddr("relayer");
        pad.setRelayer(relayer, true);

        vm.prank(relayer);
        address token = pad.createToken("T", "T", "u", SUPPLY, creator, address(0), 0, 0);

        (address c,,,,) = _launchInfo(token);
        assertEq(c, creator);
        assertEq(pad.tokensByCreator(creator).length, 1);
        assertEq(pad.tokensByCreator(relayer).length, 0);
    }

    function test_relayedLaunch_devBuyPulledFromCreatorWhype() public {
        address relayer = makeAddr("relayer");
        pad.setRelayer(relayer, true);
        router.setRate(1000e18);

        // Creator pre-funds + approves WHYPE (the non-custodial relayer flow).
        vm.deal(creator, 3 ether);
        vm.startPrank(creator);
        MockWHYPE(payable(whype)).deposit{value: 3 ether}();
        MockWHYPE(payable(whype)).approve(address(pad), 3 ether);
        vm.stopPrank();

        vm.prank(relayer);
        address token = pad.createToken("T", "T", "u", SUPPLY, creator, address(0), 3 ether, 2900e18);

        // Dev-buy tokens went to the creator, not the relayer.
        assertEq(LaunchToken(token).balanceOf(creator), 3000e18);
        assertEq(LaunchToken(token).balanceOf(relayer), 0);
        assertEq(MockWHYPE(payable(whype)).balanceOf(creator), 0);
    }

    function test_relayedLaunch_unapprovedRelayerReverts() public {
        vm.prank(rando);
        vm.expectRevert("not relayer");
        pad.createToken("T", "T", "u", SUPPLY, creator, address(0), 0, 0);

        vm.prank(rando);
        vm.expectRevert("not owner");
        pad.setRelayer(rando, true);
    }

    function test_createToken_zeroSupplyReverts() public {
        vm.expectRevert("zero supply");
        pad.createToken("T", "T", "u", 0, address(0), address(0), 0, 0);
    }

    // ------------------------------------------------------------------ oracle / market cap

    function test_hypeUsdPrice_fromOracle() public view {
        assertEq(pad.hypeUsdPrice(), HYPE_USD6); // $60.569 with 6 decimals
    }

    function test_createToken_revertsWhenOracleUnavailable() public {
        vm.clearMockedCalls();
        vm.expectRevert("oracle unavailable");
        pad.createToken("T", "T", "u", SUPPLY, address(0), address(0), 0, 0);
    }

    function test_manualHypeUsdOverride() public {
        vm.clearMockedCalls(); // oracle down...
        pad.setManualHypeUsd(50e6); // ...owner pins HYPE at $50

        address token = _launch();
        // $4000 / $50 = 80 HYPE market cap.
        assertApproxEqRel(pad.getMarketCap(token), 80e18, 1e12);
        assertApproxEqRel(pad.getMarketCapUsd(token), MC_USD6, 1e12);

        vm.prank(rando);
        vm.expectRevert("not owner");
        pad.setManualHypeUsd(1);
    }

    function test_setStartingMarketCap() public {
        vm.prank(rando);
        vm.expectRevert("not owner");
        pad.setStartingMarketCap(8_000e6);

        pad.setStartingMarketCap(8_000e6);
        address token = _launch();
        assertApproxEqRel(pad.getMarketCapUsd(token), 8_000e6, 1e12);
    }

    // ------------------------------------------------------------------ fees

    /// @dev Accrue `tokenFees` + `hypeFees` as collectable on the launch's position and
    ///      fund the mock position manager so collect() can pay them out.
    function _accrueFees(address token, uint256 tokenFees, uint256 hypeFees) internal {
        (, address pool, uint256 id, bool is0,) = _launchInfo(token);
        if (tokenFees > 0) MockPool(pool).pay(token, address(pm), tokenFees);
        if (hypeFees > 0) {
            vm.deal(address(this), hypeFees);
            MockWHYPE(payable(whype)).deposit{value: hypeFees}();
            MockWHYPE(payable(whype)).transfer(address(pm), hypeFees);
        }
        if (is0) pm.setCollectable(id, tokenFees, hypeFees);
        else pm.setCollectable(id, hypeFees, tokenFees);
    }

    function test_collectFees_inKindWhenTwapUnavailable() public {
        address token = _launch();
        _accrueFees(token, 1000e18, 10 ether);

        vm.prank(rando); // permissionless
        (uint256 hypeAmt, uint256 tokenAmt) = pad.collectFees(token);
        assertEq(hypeAmt, 10 ether);
        assertEq(tokenAmt, 1000e18);

        assertEq(pad.creatorFeesHype(token), 7 ether);
        assertEq(pad.platformFeesHype(), 3 ether);
        assertEq(pad.creatorFeesToken(token), 700e18);
        assertEq(pad.platformFeesToken(token), 300e18);
    }

    function test_collectFees_swapsTokenFeesUsingTwap() public {
        address token = _launch();
        (, address pool,,,) = _launchInfo(token);
        _accrueFees(token, 1000e18, 10 ether);

        // TWAP at tick 0 = 1 WHYPE per token; mock router fills at exactly 1:1,
        // which clears the 5% TWAP slippage bound.
        MockPool(pool).setTwap(0);
        // Pool must hold WHYPE to pay the swap out.
        vm.deal(address(this), 1000e18);
        MockWHYPE(payable(whype)).deposit{value: 1000e18}();
        MockWHYPE(payable(whype)).transfer(pool, 1000e18);

        (uint256 hypeAmt, uint256 tokenAmt) = pad.collectFees(token);
        assertEq(hypeAmt, 10 ether + 1000e18);
        assertEq(tokenAmt, 0);

        assertEq(pad.creatorFeesHype(token), (hypeAmt * 7000) / 10000);
        assertEq(pad.creatorFeesToken(token), 0);
        assertEq(pad.platformFeesHype(), hypeAmt - (hypeAmt * 7000) / 10000);
    }

    function test_collectFees_fallsBackWhenSwapUnderTwapBound() public {
        address token = _launch();
        (, address pool,,,) = _launchInfo(token);
        _accrueFees(token, 1000e18, 0);

        MockPool(pool).setTwap(0); // TWAP says 1:1...
        router.setRate(0.5e18); // ...but the pool is being dumped 50% below it

        pad.collectFees(token);
        // Swap was rejected by the bound; fees credited in-kind instead.
        assertEq(pad.creatorFeesToken(token), 700e18);
        assertEq(pad.creatorFeesHype(token), 0);
    }

    function test_collectFees_unknownTokenReverts() public {
        vm.expectRevert("unknown token");
        pad.collectFees(address(0xBEEF));
    }

    // ------------------------------------------------------------------ claims

    function test_claimCreatorFees() public {
        address token = _launch();
        _accrueFees(token, 1000e18, 10 ether);
        pad.collectFees(token);

        vm.prank(creator);
        pad.claimCreatorFees(token);

        assertEq(creator.balance, 7 ether); // paid as native HYPE
        assertEq(LaunchToken(token).balanceOf(creator), 700e18);
        assertEq(pad.creatorFeesHype(token), 0);
        assertEq(pad.creatorFeesToken(token), 0);

        vm.prank(creator);
        vm.expectRevert("nothing to claim");
        pad.claimCreatorFees(token);
    }

    function test_claimCreatorFees_onlyCreator() public {
        address token = _launch();
        _accrueFees(token, 0, 1 ether);
        pad.collectFees(token);

        vm.prank(rando);
        vm.expectRevert("not creator");
        pad.claimCreatorFees(token);
    }

    function test_claimPlatformFees() public {
        address token = _launch();
        _accrueFees(token, 1000e18, 10 ether);
        pad.collectFees(token);

        vm.prank(rando);
        vm.expectRevert("not treasury");
        pad.claimPlatformFees();

        vm.prank(treasury);
        pad.claimPlatformFees();
        assertEq(treasury.balance, 3 ether);
        assertEq(pad.platformFeesHype(), 0);

        vm.prank(treasury);
        pad.claimPlatformTokenFees(token);
        assertEq(LaunchToken(token).balanceOf(treasury), 300e18);
    }

    function test_transferCreator() public {
        address token = _launch();
        address newCreator = makeAddr("newCreator");

        vm.prank(rando);
        vm.expectRevert("not creator");
        pad.transferCreator(token, rando);

        vm.prank(creator);
        pad.transferCreator(token, newCreator);
        (address c,,,,) = _launchInfo(token);
        assertEq(c, newCreator);
    }

    function test_setFeeRecipient_routesPayout() public {
        address token = _launch();
        address payout = makeAddr("payout");

        vm.prank(creator);
        pad.setFeeRecipient(token, payout);

        _accrueFees(token, 1000e18, 10 ether);
        pad.collectFees(token);

        // Creator (controller) triggers the claim; funds land at the chosen payout wallet.
        vm.prank(creator);
        pad.claimCreatorFees(token);

        assertEq(payout.balance, 7 ether);
        assertEq(LaunchToken(token).balanceOf(payout), 700e18);
        assertEq(creator.balance, 0);
        assertEq(LaunchToken(token).balanceOf(creator), 0);
    }

    function test_setFeeRecipient_onceOnly() public {
        address token = _launch();

        vm.prank(creator);
        pad.setFeeRecipient(token, makeAddr("first"));

        vm.prank(creator);
        vm.expectRevert("recipient locked");
        pad.setFeeRecipient(token, makeAddr("second"));
    }

    function test_setFeeRecipient_onlyCreator() public {
        address token = _launch();

        vm.prank(rando);
        vm.expectRevert("not creator");
        pad.setFeeRecipient(token, rando);

        vm.prank(creator);
        vm.expectRevert("zero address");
        pad.setFeeRecipient(token, address(0));
    }

    // ------------------------------------------------------------------ admin

    function test_withdrawPosition() public {
        address token = _launch();
        _accrueFees(token, 0, 10 ether);
        address vault = makeAddr("vault");

        vm.prank(rando);
        vm.expectRevert("not owner");
        pad.withdrawPosition(token, vault);

        pad.withdrawPosition(token, vault);

        (,,,, bool withdrawn) = _launchInfo(token);
        assertTrue(withdrawn);
        // Principal liquidity (the pooled token supply) was paid out to the vault; the pool
        // held no HYPE, so no native HYPE was sent.
        assertEq(LaunchToken(token).balanceOf(vault), SUPPLY);
        assertEq(vault.balance, 0);
        // Outstanding fees were settled 70/30 before the principal left.
        assertEq(pad.creatorFeesHype(token), 7 ether);
        assertEq(pad.platformFeesHype(), 3 ether);

        vm.expectRevert("position withdrawn");
        pad.collectFees(token);
        vm.expectRevert("position withdrawn");
        pad.withdrawPosition(token, vault);
    }

    function test_setTreasuryAndOwnership() public {
        vm.prank(rando);
        vm.expectRevert("not owner");
        pad.setTreasury(rando);

        pad.setTreasury(rando);
        assertEq(pad.treasury(), rando);

        pad.transferOwnership(rando);
        assertEq(pad.owner(), rando);
        vm.expectRevert("not owner");
        pad.setTreasury(treasury);
    }

    function test_rejectsDirectHype() public {
        vm.deal(rando, 1 ether);
        vm.prank(rando);
        (bool ok,) = address(pad).call{value: 1 ether}("");
        assertFalse(ok);
    }
}
