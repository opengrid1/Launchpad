// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

import {IStockOracle} from "./interfaces/IStockOracle.sol";

interface IUniswapV3PoolMinimal {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory);
}

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @title V3TwapOracle
/// @notice USD price per RAW unit of a tokenized stock, read as a time-weighted
///         average from its Uniswap V3 stock/USDG pool. No keeper, no signer.
///
///         The pool trades RAW units, so the TWAP already prices the ERC-8056
///         multiplier: arbitrageurs keep `raw price = share price × uiMultiplier`.
///         That is exactly the IStockOracle contract.
///
///         Guards:
///           - TWAP window (default 30 min): a manipulator must hold the pool off
///             price for the whole window against arbitrage.
///           - spot deviation: if the current tick is more than `maxSpotDevBps`
///             away from the TWAP, the read reverts. Borrows and liquidations
///             pause while the pool is being pushed instead of using a bad price.
///           - the pool must have enough observation history for the window or
///             `observe` reverts ("OLD"), which again fails closed.
contract V3TwapOracle is IStockOracle, Ownable {
    struct Feed {
        address pool;
        bool stockIsToken0;
        uint32 window; // seconds
        uint256 scale; // 10^(18 + stockDecimals - quoteDecimals)
    }

    address public immutable quote; // USDG
    mapping(address => Feed) public feeds;
    uint256 public maxSpotDevBps = 500; // 5%

    event FeedSet(address indexed stock, address indexed pool, uint32 window);
    event MaxSpotDevSet(uint256 bps);

    error NoFeed();
    error BadPool();
    error SpotDeviation();

    constructor(address owner_, address quote_) Ownable(owner_) {
        quote = quote_;
    }

    /// @notice Point `stock` at a V3 pool of stock/quote. Reads token order and
    ///         decimals from chain so it cannot be mis-wired.
    function setFeed(address stock, address pool, uint32 window) external onlyOwner {
        require(window >= 60 && window <= 1 days, "bad window");
        address t0 = IUniswapV3PoolMinimal(pool).token0();
        address t1 = IUniswapV3PoolMinimal(pool).token1();
        bool stockIs0;
        if (t0 == stock && t1 == quote) stockIs0 = true;
        else if (t1 == stock && t0 == quote) stockIs0 = false;
        else revert BadPool();
        uint8 sd = IERC20Decimals(stock).decimals();
        uint8 qd = IERC20Decimals(quote).decimals();
        feeds[stock] = Feed({pool: pool, stockIsToken0: stockIs0, window: window, scale: 10 ** (18 + sd - qd)});
        emit FeedSet(stock, pool, window);
    }

    function setMaxSpotDev(uint256 bps) external onlyOwner {
        require(bps > 0 && bps <= 5_000, "bad bps");
        maxSpotDevBps = bps;
        emit MaxSpotDevSet(bps);
    }

    /// @inheritdoc IStockOracle
    function getPrice(address stock) external view override returns (uint256) {
        Feed memory f = feeds[stock];
        if (f.pool == address(0)) revert NoFeed();

        int24 twapTick = _twapTick(f.pool, f.window);
        (, int24 spotTick,,,,,) = IUniswapV3PoolMinimal(f.pool).slot0();

        uint256 twap = _priceFromTick(twapTick, f);
        uint256 spot = _priceFromTick(spotTick, f);
        uint256 diff = spot > twap ? spot - twap : twap - spot;
        if (diff * 10_000 > twap * maxSpotDevBps) revert SpotDeviation();
        return twap;
    }

    /// @notice TWAP and spot side by side, without the deviation guard (for UIs).
    function peek(address stock) external view returns (uint256 twap, uint256 spot) {
        Feed memory f = feeds[stock];
        if (f.pool == address(0)) revert NoFeed();
        (, int24 spotTick,,,,,) = IUniswapV3PoolMinimal(f.pool).slot0();
        twap = _priceFromTick(_twapTick(f.pool, f.window), f);
        spot = _priceFromTick(spotTick, f);
    }

    function _twapTick(address pool, uint32 window) private view returns (int24 tick) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        ago[1] = 0;
        (int56[] memory cum,) = IUniswapV3PoolMinimal(pool).observe(ago);
        int56 delta = cum[1] - cum[0];
        tick = int24(delta / int56(uint56(window)));
        // round toward negative infinity, as Uniswap's OracleLibrary does
        if (delta < 0 && (delta % int56(uint56(window)) != 0)) tick--;
    }

    /// @dev USD (1e18) per 1e18 raw stock units, from a pool tick.
    function _priceFromTick(int24 tick, Feed memory f) private pure returns (uint256) {
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(tick);
        // token1 per token0, Q96
        uint256 ratioX96 = FullMath.mulDiv(sqrtP, sqrtP, 1 << 96);
        if (f.stockIsToken0) {
            // quote per stock = ratio
            return FullMath.mulDiv(ratioX96, f.scale, 1 << 96);
        } else {
            // quote per stock = 1 / ratio
            return FullMath.mulDiv(f.scale, 1 << 96, ratioX96);
        }
    }
}
