// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {IUniswapV3FactoryCore, IUniswapV3PoolCore} from "../stable/IUniswapV3Core.sol";

/// @notice Throwaway diagnostic: runs createPool / initialize / mint as separate
///         steps against a live V3 factory and reports which one reverts and its
///         raw revert data. Not for production.
contract HyperProbe {
    IUniswapV3FactoryCore public immutable f;
    address public expectedPool;

    event Step(string what, bool ok, bytes data);

    constructor(IUniswapV3FactoryCore f_) { f = f_; }

    function run(address token, address quote, uint24 fee, uint160 sqrtPriceX96, int24 tl, int24 tu, uint128 liq)
        external
        returns (address pool)
    {
        (address t0, address t1) = token < quote ? (token, quote) : (quote, token);
        pool = f.getPool(t0, t1, fee);
        if (pool == address(0)) pool = f.createPool(t0, t1, fee);
        emit Step("createPool", true, abi.encodePacked(pool));

        (uint160 cur,,,,,,) = IUniswapV3PoolCore(pool).slot0();
        if (cur == 0) {
            try IUniswapV3PoolCore(pool).initialize(sqrtPriceX96) {
                emit Step("initialize", true, "");
            } catch (bytes memory d) {
                emit Step("initialize", false, d);
                return pool;
            }
        } else {
            emit Step("initialize", true, "already");
        }

        expectedPool = pool;
        uint256 g0 = gasleft();
        try IUniswapV3PoolCore(pool).mint(address(this), tl, tu, liq, "") returns (uint256 a0, uint256 a1) {
            emit Step("mint", true, abi.encode(a0, a1));
        } catch (bytes memory d) {
            emit Step("mint-gasburned", false, abi.encode(g0 - gasleft(), d));
        }

        // Control: small single-sided token1 position in a narrow band just
        // below current tick. Isolates whether the extreme MIN-tick lower bound
        // (or the large amount) is the problem.
        int24 ctlLower = tu - 200 * 10;
        try IUniswapV3PoolCore(pool).mint(address(this), ctlLower, tu, uint128(1e18), "") returns (uint256 a0, uint256 a1) {
            emit Step("ctl-mint", true, abi.encode(a0, a1));
        } catch (bytes memory d) {
            emit Step("ctl-mint", false, d);
        }
        expectedPool = address(0);
    }

    uint256 constant TOTAL_SUPPLY = 1_000_000_000e18;
    int24 constant MIN_TICK = -887272;
    int24 constant MAX_TICK = 887272;
    uint256 constant Q96 = 1 << 96;

    /// @notice Mirrors ArcLaunchpadFactory._initialPosition + _liquidityForSupply.
    function compute(bool tokenIsToken0, int24 tickSpacing, uint256 mcapUsd8, uint256 usdPrice8, uint8 dec)
        public
        pure
        returns (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint128 liquidity)
    {
        uint256 mcapQuote = Math.mulDiv(mcapUsd8, 10 ** dec, usdPrice8);
        uint256 priceX18 = Math.mulDiv(mcapQuote, 1e18, TOTAL_SUPPLY);
        uint160 target = tokenIsToken0
            ? uint160(Math.sqrt(Math.mulDiv(priceX18, 1 << 192, 1e18)))
            : uint160(Math.sqrt(Math.mulDiv(1e18, 1 << 192, priceX18)));
        int24 tick = TickMath.getTickAtSqrtRatio(target);
        int24 aligned = (tick / tickSpacing) * tickSpacing;
        if (tick < 0 && tick % tickSpacing != 0) aligned -= tickSpacing;
        if (tokenIsToken0) {
            sqrtPriceX96 = TickMath.getSqrtRatioAtTick(aligned);
            tickLower = aligned + tickSpacing;
            tickUpper = (MAX_TICK / tickSpacing) * tickSpacing;
        } else {
            sqrtPriceX96 = TickMath.getSqrtRatioAtTick(aligned + tickSpacing);
            tickLower = (MIN_TICK / tickSpacing) * tickSpacing;
            tickUpper = aligned + tickSpacing;
        }
        uint160 sqrtL = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtU = TickMath.getSqrtRatioAtTick(tickUpper);
        uint256 l = tokenIsToken0
            ? Math.mulDiv(TOTAL_SUPPLY, Math.mulDiv(sqrtL, sqrtU, Q96), sqrtU - sqrtL)
            : Math.mulDiv(TOTAL_SUPPLY, Q96, sqrtU - sqrtL);
        liquidity = uint128(l);
    }

    event CallbackHit(string which);

    function uniswapV3MintCallback(uint256 a0, uint256 a1, bytes calldata) external {
        emit CallbackHit("uniswapV3MintCallback");
        _pay(a0, a1);
    }

    function pancakeV3MintCallback(uint256 a0, uint256 a1, bytes calldata) external {
        emit CallbackHit("pancakeV3MintCallback");
        _pay(a0, a1);
    }

    bool public payInCallback = true;

    function setPay(bool v) external { payInCallback = v; }

    function _pay(uint256 a0, uint256 a1) internal {
        if (!payInCallback) return; // no-op: forces the pool's M0/M1 balance check to fire (proves callback was reached)
        if (a0 > 0) IERC20(IUniswapV3PoolCore(msg.sender).token0()).transfer(msg.sender, a0);
        if (a1 > 0) IERC20(IUniswapV3PoolCore(msg.sender).token1()).transfer(msg.sender, a1);
    }
}
