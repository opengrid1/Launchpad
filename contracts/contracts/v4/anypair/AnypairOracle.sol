// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IV3PoolLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

interface IV3FactoryLike {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface ISlipstreamFactory {
    function getPool(address a, address b, int24 tickSpacing) external view returns (address);
}

interface IAeroPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function stable() external view returns (bool);
    function observationLength() external view returns (uint256);
    function observations(uint256 i) external view returns (uint256 timestamp, uint256 reserve0Cumulative, uint256 reserve1Cumulative);
    function currentCumulativePrices() external view returns (uint256 reserve0Cumulative, uint256 reserve1Cumulative, uint256 blockTimestamp);
}

interface IAeroFactory {
    function getPool(address a, address b, bool stable) external view returns (address);
}

interface IAggregatorV3Min {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/// @title AnypairOracle
/// @notice USD prices for the tokens Anypair coins pair with or pay rewards
///         in, read from the pools those tokens really trade in on Base:
///
///         - Uniswap V3, PancakeSwap V3 and Aerodrome Slipstream: 30-minute TWAP.
///         - Aerodrome volatile pools: time-weighted average reserves (30 min+).
///         - Uniswap V4 (no built-in history): a slow price that follows the
///           pool's tick by at most ~1% a minute, and a launch is refused
///           while the pool's spot is far from it.
///
///         Every source is priced against an anchor: ETH (WETH, or native ETH
///         in V4) from Chainlink, or a token the admin listed (USDC, ...).
///         Anyone can register the pool a token is priced from; it must be
///         the canonical pool of its DEX and hold at least `minDepthUsd` on
///         the anchor side, measured over time where the DEX allows. A token
///         that already has a source only moves to a time-weighted pool more
///         than twice as deep. The admin can list fixed or feed prices,
///         change or clear any token's source, and set the minimum depth.
contract AnypairOracle {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint8 public constant UNI_V3 = 1;
    uint8 public constant PANCAKE_V3 = 2;
    uint8 public constant SLIPSTREAM = 3;
    uint8 public constant AERO_V2 = 4;
    uint8 public constant UNI_V4 = 5;

    uint32 public constant TWAP_WINDOW = 1800;
    uint256 public constant FEED_MAX_AGE = 7 days;
    /// @notice V4 slow price: ticks it may move per minute, and per update (~1% / ~22%).
    int24 public constant V4_STEP_PER_MIN = 100;
    int24 public constant V4_MAX_STEP = 2000;
    /// @notice V4: a launch needs the pool's spot within this many ticks (~22%) of the slow price.
    int24 public constant V4_LAUNCH_BAND = 2000;
    uint8 public constant MAX_DECIMALS = 30;

    address public immutable admin;
    address public immutable weth;
    IPoolManager public immutable poolManager;
    address public immutable uniV3Factory;
    address public immutable pancakeV3Factory;
    address public immutable slipstreamFactory;
    address public immutable slipstreamFactory2;
    address public immutable aeroFactory;

    /// @notice Admin-priced tokens (and ETH under `weth`). `feed` wins when fresh.
    struct Listed {
        bool listed;
        uint64 usdPrice8;
        address feed;
    }
    mapping(address => Listed) public listed;

    struct Source {
        uint8 dex;
        address pool;
        address anchor; // WETH, address(0) for native ETH in V4, or a listed token
        int24 slowTick; // V4 only
        uint64 updatedAt; // V4 only
        bytes32 v4Id;
    }
    mapping(address token => Source) public sources;

    struct SourceParams {
        uint8 dex;
        address pool;
        PoolKey key;
    }

    /// @notice Least anchor-side depth, USD 18 dp, for a pool to price a token.
    uint256 public minDepthUsd = 2_500e18;

    event Listing(address indexed token, bool listed, uint64 usdPrice8, address feed);
    event SourceSet(address indexed token, uint8 dex, address pool, bytes32 v4Id, address anchor, uint256 depthUsd);
    event SourceCleared(address indexed token);
    event MinDepthSet(uint256 usd);

    error NotAdmin();
    error NoPrice();
    error BadSource();
    error TooShallow();
    error PriceMoving();
    error InvalidParams();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    struct Config {
        address admin;
        address weth;
        IPoolManager poolManager;
        address uniV3Factory;
        address pancakeV3Factory;
        address slipstreamFactory;
        address slipstreamFactory2;
        address aeroFactory;
        address ethUsdFeed;
        uint64 ethUsd8;
    }

    constructor(Config memory c) {
        if (c.admin == address(0) || c.weth == address(0) || address(c.poolManager) == address(0) || c.ethUsd8 == 0) revert InvalidParams();
        admin = c.admin;
        weth = c.weth;
        poolManager = c.poolManager;
        uniV3Factory = c.uniV3Factory;
        pancakeV3Factory = c.pancakeV3Factory;
        slipstreamFactory = c.slipstreamFactory;
        slipstreamFactory2 = c.slipstreamFactory2;
        aeroFactory = c.aeroFactory;
        if (c.ethUsdFeed != address(0) && IAggregatorV3Min(c.ethUsdFeed).decimals() != 8) revert InvalidParams();
        listed[c.weth] = Listed({listed: true, usdPrice8: c.ethUsd8, feed: c.ethUsdFeed});
        emit Listing(c.weth, true, c.ethUsd8, c.ethUsdFeed);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice List (or unlist) a token at a fixed USD price (8 dp, per whole
    ///         token) and/or an 8-decimal Chainlink USD feed. Listed tokens
    ///         can anchor other tokens' pools. ETH stays listed.
    function setListed(address token, bool on, uint64 usdPrice8, address feed) external onlyAdmin {
        if (token == address(0)) revert InvalidParams();
        if (on && usdPrice8 == 0 && feed == address(0)) revert InvalidParams();
        if (token == weth && !on) revert InvalidParams();
        if (token != weth && on && IERC20Metadata(token).decimals() > MAX_DECIMALS) revert InvalidParams();
        if (feed != address(0) && IAggregatorV3Min(feed).decimals() != 8) revert InvalidParams();
        listed[token] = Listed({listed: on, usdPrice8: usdPrice8, feed: feed});
        emit Listing(token, on, usdPrice8, feed);
    }

    function clearSource(address token) external onlyAdmin {
        delete sources[token];
        emit SourceCleared(token);
    }

    function setMinDepthUsd(uint256 usd18) external onlyAdmin {
        minDepthUsd = usd18;
        emit MinDepthSet(usd18);
    }

    // ---------------------------------------------------------------------
    // Sources
    // ---------------------------------------------------------------------

    /// @notice Price `token` from a pool: set when it has no source, replace
    ///         when the pool is time-weighted and over twice as deep (the
    ///         admin replaces at will). Returns the token and whether the
    ///         source changed.
    function register(SourceParams calldata s) external returns (address token, bool changed) {
        Source memory n;
        n.dex = s.dex;
        address t0;
        address t1;
        if (s.dex == UNI_V4) {
            t0 = Currency.unwrap(s.key.currency0);
            t1 = Currency.unwrap(s.key.currency1);
            n.v4Id = PoolId.unwrap(s.key.toId());
            (uint160 sp, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(n.v4Id));
            if (sp == 0) revert BadSource();
            n.slowTick = tick;
            n.updatedAt = uint64(block.timestamp);
        } else {
            n.pool = s.pool;
            t0 = IV3PoolLike(s.pool).token0();
            t1 = IV3PoolLike(s.pool).token1();
            if (!_canonical(s.dex, s.pool, t0, t1)) revert BadSource();
        }
        bool a0 = _isAnchor(t0);
        bool a1 = _isAnchor(t1);
        if (a0 == a1) revert BadSource();
        token = a0 ? t1 : t0;
        n.anchor = a0 ? t0 : t1;
        if (listed[token].listed) revert BadSource();

        uint256 depth = _depthUsd(token, n);
        if (depth < minDepthUsd) revert TooShallow();

        Source storage cur = sources[token];
        if (cur.dex != 0 && msg.sender != admin) {
            if (s.dex == UNI_V4) return (token, false);
            uint256 curDepth;
            try this.depthUsd(token) returns (uint256 d) { curDepth = d; } catch {}
            if (depth <= curDepth * 2) return (token, false);
        }
        sources[token] = n;
        emit SourceSet(token, n.dex, n.pool, n.v4Id, n.anchor, depth);
        return (token, true);
    }

    function _canonical(uint8 dex, address pool, address t0, address t1) internal view returns (bool) {
        if (dex == UNI_V3 || dex == PANCAKE_V3) {
            address f = dex == UNI_V3 ? uniV3Factory : pancakeV3Factory;
            return f != address(0) && IV3FactoryLike(f).getPool(t0, t1, IV3PoolLike(pool).fee()) == pool;
        }
        if (dex == SLIPSTREAM) {
            int24 ts = IV3PoolLike(pool).tickSpacing();
            return (slipstreamFactory != address(0) && ISlipstreamFactory(slipstreamFactory).getPool(t0, t1, ts) == pool)
                || (slipstreamFactory2 != address(0) && ISlipstreamFactory(slipstreamFactory2).getPool(t0, t1, ts) == pool);
        }
        if (dex == AERO_V2) {
            return aeroFactory != address(0) && !IAeroPool(pool).stable() && IAeroFactory(aeroFactory).getPool(t0, t1, false) == pool;
        }
        return false;
    }

    function _isAnchor(address t) internal view returns (bool) {
        return t == address(0) || listed[t].listed;
    }

    // ---------------------------------------------------------------------
    // Prices: USD, 18 dp, per 1e18 base units of the token
    // ---------------------------------------------------------------------

    function hasPrice(address token) external view returns (bool) {
        return token == weth || listed[token].listed || sources[token].dex != 0;
    }

    function price(address token) public view returns (uint256 px) {
        Listed memory l = listed[token];
        if (l.listed) return _listedPx(token, l);
        Source memory s = sources[token];
        if (s.dex == 0) revert NoPrice();
        uint256 anchorPer1e36 = _anchorPer1e36(token, s);
        px = Math.mulDiv(anchorPer1e36, _anchorPx(s.anchor), 1e36);
        if (px == 0) revert NoPrice();
    }

    /// @notice Bring a V4 source's slow price toward the pool, then price.
    ///         Anyone (the router calls it on every buy and sell).
    function poke(address token) public returns (uint256) {
        Source storage s = sources[token];
        if (s.dex == UNI_V4) _step(s);
        return price(token);
    }

    /// @notice What a launch uses: `poke`, plus for V4 sources a pool spot
    ///         within the band of the slow price and the minimum depth now.
    function launchPrice(address token) external returns (uint256 px) {
        px = poke(token);
        Source memory s = sources[token];
        if (s.dex == UNI_V4) {
            (, int24 spot,,) = poolManager.getSlot0(PoolId.wrap(s.v4Id));
            int24 d = spot > s.slowTick ? spot - s.slowTick : s.slowTick - spot;
            if (d > V4_LAUNCH_BAND) revert PriceMoving();
            if (_depthUsd(token, s) < minDepthUsd) revert TooShallow();
        }
    }

    /// @notice Anchor-side depth of a token's source, USD 18 dp.
    function depthUsd(address token) external view returns (uint256) {
        Source memory s = sources[token];
        if (s.dex == 0) revert NoPrice();
        return _depthUsd(token, s);
    }

    function _step(Source storage s) internal {
        uint256 mins = (block.timestamp - s.updatedAt) / 60;
        if (mins == 0) return;
        (, int24 spot,,) = poolManager.getSlot0(PoolId.wrap(s.v4Id));
        int256 maxStep = int256(mins) * V4_STEP_PER_MIN;
        if (maxStep > V4_MAX_STEP) maxStep = V4_MAX_STEP;
        int256 d = int256(spot) - int256(s.slowTick);
        if (d > maxStep) d = maxStep;
        if (d < -maxStep) d = -maxStep;
        s.slowTick = int24(int256(s.slowTick) + d);
        s.updatedAt = uint64(block.timestamp);
    }

    function _listedPx(address token, Listed memory l) internal view returns (uint256) {
        uint256 usd8;
        if (l.feed != address(0)) {
            try IAggregatorV3Min(l.feed).latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
                if (answer > 0 && updatedAt + FEED_MAX_AGE >= block.timestamp) usd8 = uint256(answer);
            } catch {}
        }
        if (usd8 == 0) usd8 = l.usdPrice8;
        if (usd8 == 0) revert NoPrice();
        uint8 dec = token == weth ? 18 : IERC20Metadata(token).decimals();
        return Math.mulDiv(usd8, 1e28, 10 ** dec);
    }

    function _anchorPx(address anchor) internal view returns (uint256) {
        address a = anchor == address(0) ? weth : anchor;
        Listed memory l = listed[a];
        if (!l.listed) revert NoPrice();
        return _listedPx(a, l);
    }

    /// @dev Anchor base units per 1e36 token base units.
    function _anchorPer1e36(address token, Source memory s) internal view returns (uint256) {
        if (s.dex == AERO_V2) {
            (uint256 r0, uint256 r1) = _aeroAvgReserves(s.pool);
            bool tokenIs0 = IAeroPool(s.pool).token0() == token;
            (uint256 rt, uint256 ra) = tokenIs0 ? (r0, r1) : (r1, r0);
            if (rt == 0) revert NoPrice();
            return Math.mulDiv(1e36, ra, rt);
        }
        int24 tick = s.dex == UNI_V4 ? s.slowTick : _twapTick(s.pool);
        return _quoteAtTick(tick, 1e36, token, s.anchor);
    }

    function _depthUsd(address token, Source memory s) internal view returns (uint256) {
        uint256 anchorAmt;
        if (s.dex == AERO_V2) {
            (uint256 r0, uint256 r1) = _aeroAvgReserves(s.pool);
            anchorAmt = IAeroPool(s.pool).token0() == token ? r1 : r0;
        } else {
            uint128 liq;
            uint160 sp;
            if (s.dex == UNI_V4) {
                (sp,,,) = poolManager.getSlot0(PoolId.wrap(s.v4Id));
                liq = poolManager.getLiquidity(PoolId.wrap(s.v4Id));
            } else {
                int24 tick;
                (tick, liq) = _twap(s.pool);
                sp = TickMath.getSqrtPriceAtTick(tick);
            }
            // virtual anchor reserve of the in-range liquidity
            anchorAmt = s.anchor < token ? Math.mulDiv(liq, 1 << 96, sp) : Math.mulDiv(liq, sp, 1 << 96);
        }
        return Math.mulDiv(anchorAmt, _anchorPx(s.anchor), 1e18);
    }

    function _twapTick(address pool) internal view returns (int24 tick) {
        (tick,) = _twap(pool);
    }

    /// @dev 30-minute mean tick and harmonic-mean liquidity (Uniswap's OracleLibrary.consult).
    function _twap(address pool) internal view returns (int24 tick, uint128 liq) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = TWAP_WINDOW;
        (int56[] memory cum, uint160[] memory spl) = IV3PoolLike(pool).observe(ago);
        int56 d = cum[1] - cum[0];
        tick = int24(d / int56(uint56(TWAP_WINDOW)));
        if (d < 0 && d % int56(uint56(TWAP_WINDOW)) != 0) tick--;
        uint160 dl = spl[1] - spl[0];
        liq = dl == 0 ? 0 : uint128((uint192(TWAP_WINDOW) * type(uint160).max) / (uint192(dl) << 32));
    }

    /// @dev Aerodrome volatile pool: reserves averaged from the second-to-last
    ///      observation (at least one 30-minute period old) to now.
    function _aeroAvgReserves(address pool) internal view returns (uint256 r0, uint256 r1) {
        uint256 n = IAeroPool(pool).observationLength();
        if (n < 2) revert NoPrice();
        (uint256 ts, uint256 c0, uint256 c1) = IAeroPool(pool).observations(n - 2);
        (uint256 n0, uint256 n1, uint256 now_) = IAeroPool(pool).currentCumulativePrices();
        uint256 dt = now_ - ts;
        if (dt == 0) revert NoPrice();
        r0 = (n0 - c0) / dt;
        r1 = (n1 - c1) / dt;
    }

    /// @dev Uniswap's OracleLibrary.getQuoteAtTick.
    function _quoteAtTick(int24 tick, uint128 baseAmount, address base, address quote) internal pure returns (uint256) {
        uint160 s = TickMath.getSqrtPriceAtTick(tick);
        if (s <= type(uint128).max) {
            uint256 r = uint256(s) * s;
            return base < quote ? Math.mulDiv(r, baseAmount, 1 << 192) : Math.mulDiv(1 << 192, baseAmount, r);
        }
        uint256 r128 = Math.mulDiv(s, s, 1 << 64);
        return base < quote ? Math.mulDiv(r128, baseAmount, 1 << 128) : Math.mulDiv(1 << 128, baseAmount, r128);
    }
}
