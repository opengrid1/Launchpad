// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IUniV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 r0, uint112 r1, uint32 blockTimestampLast);
    function price0CumulativeLast() external view returns (uint256);
    function price1CumulativeLast() external view returns (uint256);
}

interface IUniV2Factory {
    function getPair(address a, address b) external view returns (address);
}

interface IUniV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

interface IUniV3Factory {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface IAggregatorV3Min {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/// @title BackstopOracle
/// @notice USD prices for the tokens Backstop coins are backed by, read from
///         the Uniswap pools those tokens trade in on Ethereum:
///
///         - Uniswap V2: average price between a stored snapshot of the pair's
///           price accumulator (30 minutes to 4 hours old) and now. Without
///           one, the spot price is used and the price counts as unsettled
///           (take-profit waits for a settled price).
///         - Uniswap V3: 30-minute TWAP.
///         - Uniswap V4 (no built-in history): a slow price that follows the
///           pool's tick by at most ~1% a minute; a launch is refused while the
///           pool's spot is far from it.
///
///         Every source is priced against an anchor: ETH (WETH, or native ETH
///         in V4) from Chainlink, or a token the admin listed (USDC, ...).
///         Anyone can register the pool a token is priced from; it must be the
///         canonical pool of its DEX and hold at least `minDepthUsd` on the
///         anchor side. A token that already has a source only moves to a pool
///         more than twice as deep. The admin can list fixed or feed prices,
///         change or clear any token's source, and set the minimum depth.
contract BackstopOracle {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint8 public constant UNI_V2 = 1;
    uint8 public constant UNI_V3 = 2;
    uint8 public constant UNI_V4 = 3;

    uint32 public constant TWAP_WINDOW = 1800;
    /// @notice V2: a snapshot older than this is too stale to average from.
    uint32 public constant MAX_SNAPSHOT_AGE = 4 hours;
    uint256 public constant FEED_MAX_AGE = 7 days;
    int24 public constant V4_STEP_PER_MIN = 100;
    int24 public constant V4_MAX_STEP = 2000;
    int24 public constant V4_LAUNCH_BAND = 2000;
    uint8 public constant MAX_DECIMALS = 30;

    address public immutable admin;
    address public immutable weth;
    IPoolManager public immutable poolManager;
    address public immutable uniV2Factory;
    address public immutable uniV3Factory;

    struct Listed {
        bool listed;
        uint64 usdPrice8;
        address feed;
    }
    mapping(address => Listed) public listed;

    struct Source {
        uint8 dex;
        address pool; // V2 pair or V3 pool
        address anchor; // WETH, address(0) for native ETH in V4, or a listed token
        int24 slowTick; // V4
        uint64 updatedAt; // V4
        bytes32 v4Id;
        // V2: two accumulator snapshots (token priced in anchor, UQ112x112 * seconds)
        uint256 cumA;
        uint32 timeA;
        uint256 cumB;
        uint32 timeB;
    }
    mapping(address token => Source) public sources;

    struct SourceParams {
        uint8 dex;
        address pool;
        PoolKey key;
    }

    /// @notice Least anchor-side depth, USD 18 dp, for a pool to price a token.
    uint256 public minDepthUsd = 10_000e18;

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
        address uniV2Factory;
        address uniV3Factory;
        address ethUsdFeed;
        uint64 ethUsd8;
        address usdc;
        address usdcUsdFeed;
    }

    constructor(Config memory c) {
        if (c.admin == address(0) || c.weth == address(0) || address(c.poolManager) == address(0) || c.ethUsd8 == 0) revert InvalidParams();
        admin = c.admin;
        weth = c.weth;
        poolManager = c.poolManager;
        uniV2Factory = c.uniV2Factory;
        uniV3Factory = c.uniV3Factory;
        if (c.ethUsdFeed != address(0) && IAggregatorV3Min(c.ethUsdFeed).decimals() != 8) revert InvalidParams();
        listed[c.weth] = Listed({listed: true, usdPrice8: c.ethUsd8, feed: c.ethUsdFeed});
        emit Listing(c.weth, true, c.ethUsd8, c.ethUsdFeed);
        if (c.usdc != address(0)) {
            if (c.usdcUsdFeed == address(0) || IAggregatorV3Min(c.usdcUsdFeed).decimals() != 8) revert InvalidParams();
            listed[c.usdc] = Listed({listed: true, usdPrice8: 1e8, feed: c.usdcUsdFeed});
            emit Listing(c.usdc, true, 1e8, c.usdcUsdFeed);
        }
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice List (or unlist) a token at a fixed USD price (8 dp, per whole
    ///         token) and/or an 8-decimal Chainlink USD feed. Listed tokens can
    ///         anchor other tokens' pools. ETH stays listed.
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
    ///         when the pool is over twice as deep (the admin replaces at will).
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
        } else if (s.dex == UNI_V2 || s.dex == UNI_V3) {
            n.pool = s.pool;
            t0 = IUniV2Pair(s.pool).token0();
            t1 = IUniV2Pair(s.pool).token1();
            if (!_canonical(s.dex, s.pool, t0, t1)) revert BadSource();
        } else {
            revert BadSource();
        }
        bool a0 = _isAnchor(t0);
        bool a1 = _isAnchor(t1);
        if (a0 == a1) revert BadSource();
        token = a0 ? t1 : t0;
        n.anchor = a0 ? t0 : t1;
        if (listed[token].listed) revert BadSource();
        if (s.dex == UNI_V2) {
            n.cumB = _v2Cumulative(s.pool, token);
            n.timeB = uint32(block.timestamp);
        }

        uint256 depth = _depthUsd(token, n);
        if (depth < minDepthUsd) revert TooShallow();

        Source storage cur = sources[token];
        if (cur.dex != 0 && msg.sender != admin) {
            uint256 curDepth;
            try this.depthUsd(token) returns (uint256 d) { curDepth = d; } catch {}
            if (depth <= curDepth * 2) return (token, false);
        }
        sources[token] = n;
        emit SourceSet(token, n.dex, n.pool, n.v4Id, n.anchor, depth);
        return (token, true);
    }

    function _canonical(uint8 dex, address pool, address t0, address t1) internal view returns (bool) {
        if (dex == UNI_V2) return uniV2Factory != address(0) && IUniV2Factory(uniV2Factory).getPair(t0, t1) == pool;
        return uniV3Factory != address(0) && IUniV3Factory(uniV3Factory).getPool(t0, t1, IUniV3Pool(pool).fee()) == pool;
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
        px = Math.mulDiv(_anchorPer1e36(token, s), _anchorPx(s.anchor), 1e36);
        if (px == 0) revert NoPrice();
    }

    /// @notice True when `token`'s price is time-weighted right now (V2 with a
    ///         snapshot at least 30 minutes old, V3, V4, or listed).
    function settled(address token) external view returns (bool) {
        if (listed[token].listed) return true;
        Source memory s = sources[token];
        if (s.dex == 0) return false;
        if (s.dex != UNI_V2) return true;
        return _v2Snapshot(s) != 0;
    }

    /// @notice Move a V4 source's slow price toward the pool and roll a V2
    ///         source's snapshots, then price. Anyone (the router calls it).
    function poke(address token) public returns (uint256) {
        Source storage s = sources[token];
        if (s.dex == UNI_V4) _step(s);
        else if (s.dex == UNI_V2 && block.timestamp - s.timeB >= TWAP_WINDOW) {
            s.cumA = s.cumB;
            s.timeA = s.timeB;
            s.cumB = _v2Cumulative(s.pool, token);
            s.timeB = uint32(block.timestamp);
        }
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
        }
        if (s.dex != 0 && _depthUsd(token, s) < minDepthUsd) revert TooShallow();
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
        if (s.dex == UNI_V2) {
            uint32 t = _v2Snapshot(s);
            if (t == 0) {
                (uint256 rt, uint256 ra) = _v2Reserves(s.pool, token);
                if (rt == 0) revert NoPrice();
                return Math.mulDiv(1e36, ra, rt);
            }
            uint256 snap = t == s.timeB ? s.cumB : s.cumA;
            uint256 avg;
            unchecked { avg = (_v2Cumulative(s.pool, token) - snap) / (block.timestamp - t); } // UQ112x112, wraps by design
            return Math.mulDiv(avg, 1e36, 1 << 112);
        }
        int24 tick = s.dex == UNI_V4 ? s.slowTick : _twapTick(s.pool);
        return _quoteAtTick(tick, 1e36, token, s.anchor);
    }

    /// @dev The newest V2 snapshot between TWAP_WINDOW and MAX_SNAPSHOT_AGE old, as its timestamp (0: none).
    function _v2Snapshot(Source memory s) internal view returns (uint32) {
        if (s.timeB != 0 && block.timestamp - s.timeB >= TWAP_WINDOW) return block.timestamp - s.timeB <= MAX_SNAPSHOT_AGE ? s.timeB : 0;
        if (s.timeA != 0 && block.timestamp - s.timeA >= TWAP_WINDOW && block.timestamp - s.timeA <= MAX_SNAPSHOT_AGE) return s.timeA;
        return 0;
    }

    /// @dev Uniswap's UniswapV2OracleLibrary.currentCumulativePrices, for `token` priced in the other side.
    function _v2Cumulative(address pair, address token) internal view returns (uint256 cum) {
        bool is0 = IUniV2Pair(pair).token0() == token;
        cum = is0 ? IUniV2Pair(pair).price0CumulativeLast() : IUniV2Pair(pair).price1CumulativeLast();
        (uint112 r0, uint112 r1, uint32 last) = IUniV2Pair(pair).getReserves();
        uint32 nowTs = uint32(block.timestamp);
        if (last != nowTs && r0 != 0 && r1 != 0) {
            unchecked {
                uint32 dt = nowTs - last;
                cum += is0 ? ((uint256(r1) << 112) / r0) * dt : ((uint256(r0) << 112) / r1) * dt;
            }
        }
    }

    function _v2Reserves(address pair, address token) internal view returns (uint256 rt, uint256 ra) {
        (uint112 r0, uint112 r1,) = IUniV2Pair(pair).getReserves();
        (rt, ra) = IUniV2Pair(pair).token0() == token ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    function _depthUsd(address token, Source memory s) internal view returns (uint256) {
        uint256 anchorAmt;
        if (s.dex == UNI_V2) {
            (, anchorAmt) = _v2Reserves(s.pool, token);
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
        (int56[] memory cum, uint160[] memory spl) = IUniV3Pool(pool).observe(ago);
        int56 d = cum[1] - cum[0];
        tick = int24(d / int56(uint56(TWAP_WINDOW)));
        if (d < 0 && d % int56(uint56(TWAP_WINDOW)) != 0) tick--;
        uint160 dl = spl[1] - spl[0];
        liq = dl == 0 ? 0 : uint128((uint192(TWAP_WINDOW) * type(uint160).max) / (uint192(dl) << 32));
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
