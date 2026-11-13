// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Claims} from "../libraries/Claims.sol";
import {Curve, N_TRANCHES} from "../libraries/Curve.sol";
import {Ticks} from "../libraries/Ticks.sol";
import {FloorMath} from "../libraries/FloorMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {IHypexToken} from "../interfaces/IHypexToken.sol";
import {HookStorage} from "./HookStorage.sol";
import {IHypexHook} from "../interfaces/IHypexHook.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";

/// @title HookOps
/// @notice Hypex's owner and bridge operations on a pool, as an external library: HypexHook delegatecalls it from its
///         unlock callback (so it runs as the hook, on the hook's storage and the PoolManager's lock), which keeps the
///         hook under the EIP-170 size limit. Nothing here is callable on its own: the functions only act on the pool
///         storage the hook passes in.
library HookOps {
    using Claims for IPoolManager;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    int24 internal constant SPACING = Ticks.SPACING;
    int24 internal constant MIN_TICK = Ticks.MIN_TICK;
    uint256 internal constant SALT_TRANCHE0 = 16; // HookStorage: tranche i's position uses salt 16 + i
    bytes32 internal constant SALT_BAND = bytes32(uint256(3)); // HookStorage.SALT_BAND
    uint256 internal constant RESERVE = 1e6; // HookStorage.RESERVE

    /// @notice Places the launch curve's tranches (libraries/Curve.sol) with the token supply the hook holds, and keeps
    ///         what the positions didn't take as the dust reserve (claims). Upstream HypexHook._place, moved here.
    function place(HookStorage.Pool storage p, IPoolManager pm, PoolKey memory key) external {
        uint256 supply = IHypexToken(p.token).totalSupply();
        uint160 sMin = TickMath.getSqrtPriceAtTick(MIN_TICK);
        uint256 left = supply - RESERVE;
        int256 used;
        for (uint256 i; i < N_TRANCHES; i++) {
            (uint256 bps, int24 topOff) = Curve.tranche(i);
            uint256 amt = i + 1 == N_TRANCHES ? left : supply * bps / 10_000; // the last tranche takes the remainder
            left -= amt;
            int24 top = p.tickStart - topOff;
            uint128 l = FloorMath.liquidityForToken(sMin, TickMath.getSqrtPriceAtTick(top), amt);
            used += _modify(pm, key, MIN_TICK, top, int256(uint256(l)), bytes32(SALT_TRANCHE0 + i)).amount1();
            p.liqs[i] = l;
        }
        // pay the full supply in, keep what the positions didn't use as the dust reserve (claims)
        pm.sync(key.currency1);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        IHypexToken(p.token).transfer(address(pm), supply); // HypexToken (OpenZeppelin ERC20) reverts on failure
        pm.settle();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 leftover = supply - uint256(-used); // used sums adds' amount1, each <= 0
        pm.mint(address(this), key.currency1.toId(), leftover);
        p.reserve = leftover;
    }

    /// @notice Removes every live position of the pool (tranche 0 at [MIN_TICK, tickF], each unmerged tranche at
    ///         [MIN_TICK, its start], the band at [tickB, tickB + 60]) and takes what they release to `to`, then redeems
    ///         the hook's claims that back the pool's floor money (pot and unvested snipe tax) and dust reserve to `to`.
    ///         Creator fees owed stay. Returns the quote and tokens `to` got.
    function collectAll(HookStorage.Pool storage p, IPoolManager pm, PoolKey memory key, address to)
        external
        returns (uint256 quoteOut, uint256 tokenOut)
    {
        int256 q;
        int256 t;
        for (uint256 i; i < N_TRANCHES; i++) {
            if (i != 0 && i <= p.merged) continue; // merged into tranche 0
            uint128 l = p.liqs[i];
            if (l == 0) continue;
            int24 top = i == 0 ? p.tickF : p.tickStart - _topOff(i);
            BalanceDelta d = _modify(pm, key, MIN_TICK, top, -int256(uint256(l)), bytes32(SALT_TRANCHE0 + i));
            q += d.amount0();
            t += d.amount1();
            p.liqs[i] = 0;
        }
        if (p.liqBand != 0) {
            BalanceDelta d = _modify(pm, key, p.tickB, p.tickB + SPACING, -int256(uint256(p.liqBand)), SALT_BAND);
            q += d.amount0();
            t += d.amount1();
            p.liqBand = 0;
        }
        // removing liquidity only ever pays out: q, t >= 0
        // forge-lint: disable-next-line(unsafe-typecast)
        quoteOut = uint256(q);
        // forge-lint: disable-next-line(unsafe-typecast)
        tokenOut = uint256(t);
        if (quoteOut != 0) pm.take(key.currency0, to, quoteOut);
        if (tokenOut != 0) pm.take(key.currency1, to, tokenOut);
        uint256 held = p.pot + p.snipePot - p.snipeReleased;
        p.pot = 0;
        p.snipeReleased = p.snipePot;
        if (held != 0) pm.redeem(key.currency0, to, held);
        uint256 dust = p.reserve;
        p.reserve = 0;
        if (dust != 0) pm.redeem(key.currency1, to, dust);
        quoteOut += held;
        tokenOut += dust;
        emit IHypexHook.LiquidityCollected(key.toId(), quoteOut, tokenOut, to);
    }

    /// @notice `amount` coins left this chain (the bridge burned them; `circulating` is what is left in circulation):
    ///         lets go of their share of the floor, amount / (circulating + amount) of the pot and of the band's
    ///         liquidity, rounded down so the floor keeps what it carries the rest with, and pays its quote to `to`
    ///         (the bridge). Tokens the band held (a band the price is inside) join the dust reserve. Tranche 0's quote
    ///         over the price is the curve's, not the floor's, and stays. Returns the quote paid.
    /// @dev The floor's invariant (HookFloor: tranche 0's quote over the price, the unreached tranches and the band absorb
    ///      every circulating token) still holds: the circulating supply and the band shrink by the same share, tranche 0
    ///      and the tranches don't.
    function bridgeOut(
        HookStorage.Pool storage p,
        IPoolManager pm,
        PoolKey memory key,
        uint256 amount,
        uint256 circulating,
        address to
    ) external returns (uint256 out) {
        uint256 before = circulating + amount;
        uint256 potOut = p.pot * amount / before;
        p.pot -= potOut;
        uint256 bandOut;
        if (p.liqBand != 0) {
            // forge-lint: disable-next-line(unsafe-typecast)
            uint128 l = uint128(uint256(p.liqBand) * amount / before); // < liqBand
            if (l != 0) {
                BalanceDelta d = _modify(pm, key, p.tickB, p.tickB + SPACING, -int256(uint256(l)), SALT_BAND);
                p.liqBand -= l;
                // forge-lint: disable-next-line(unsafe-typecast)
                bandOut = uint256(int256(d.amount0()));
                // forge-lint: disable-next-line(unsafe-typecast)
                uint256 tok = uint256(int256(d.amount1()));
                if (tok != 0) {
                    pm.mint(address(this), key.currency1.toId(), tok);
                    p.reserve += tok;
                }
            }
        }
        if (potOut != 0) pm.redeem(key.currency0, to, potOut);
        if (bandOut != 0) pm.take(key.currency0, to, bandOut);
        out = potOut + bandOut;
        emit IHypexHook.FloorBridged(key.toId(), amount, out, false);
    }

    /// @notice Pays `amount` of native quote the hook holds into the pool's floor money (pot), as the hook's claims.
    function addFloor(HookStorage.Pool storage p, IPoolManager pm, PoolKey memory key, uint256 amount) external {
        pm.mint(address(this), key.currency0.toId(), amount);
        pm.settle{value: amount}();
        p.pot += amount;
        emit IHypexHook.FloorBridged(key.toId(), 0, amount, true);
    }

    function _topOff(uint256 i) private pure returns (int24 topOff) {
        (, topOff) = Curve.tranche(i);
    }

    function _modify(IPoolManager pm, PoolKey memory key, int24 lower, int24 upper, int256 liq, bytes32 salt)
        private
        returns (BalanceDelta delta)
    {
        (delta,) = pm.modifyLiquidity(
            key, IPoolManager.ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: liq, salt: salt}), ""
        );
    }
}
