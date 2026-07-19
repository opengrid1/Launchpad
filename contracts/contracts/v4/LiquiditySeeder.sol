// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title LiquiditySeeder
/// @notice Owner-operated utility for seeding and maintaining liquidity in
///         hookless V4 pools that a renounced contract routes through (e.g. a
///         reward pool the factory registered on a fee tier nobody LPs).
///         Holds its working capital; the owner sweeps it back out any time.
contract LiquiditySeeder is Ownable, IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;

    enum Op {
        Swap,
        ModifyLiquidity
    }

    struct Action {
        Op op;
        PoolKey key;
        bool zeroForOne; // Swap only
        uint256 amountIn; // Swap only (exact input; 1 wei "teleports" price in empty ranges)
        uint160 sqrtPriceLimitX96; // Swap only — explicit bound, unlike open-ended routers
        int24 tickLower; // ModifyLiquidity only
        int24 tickUpper; // ModifyLiquidity only
        int256 liquidityDelta; // ModifyLiquidity only
    }

    constructor(IPoolManager pm) Ownable(msg.sender) {
        poolManager = pm;
    }

    function swap(PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint160 sqrtPriceLimitX96)
        external
        onlyOwner
        returns (BalanceDelta delta)
    {
        bytes memory res = poolManager.unlock(
            abi.encode(
                Action(Op.Swap, key, zeroForOne, amountIn, sqrtPriceLimitX96, 0, 0, 0)
            )
        );
        delta = abi.decode(res, (BalanceDelta));
    }

    function modifyLiquidity(PoolKey calldata key, int24 tickLower, int24 tickUpper, int256 liquidityDelta)
        external
        onlyOwner
        returns (BalanceDelta delta)
    {
        bytes memory res = poolManager.unlock(
            abi.encode(
                Action(Op.ModifyLiquidity, key, false, 0, 0, tickLower, tickUpper, liquidityDelta)
            )
        );
        delta = abi.decode(res, (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        Action memory a = abi.decode(data, (Action));

        BalanceDelta delta;
        if (a.op == Op.Swap) {
            delta = poolManager.swap(
                a.key,
                SwapParams({
                    zeroForOne: a.zeroForOne,
                    amountSpecified: -int256(a.amountIn),
                    sqrtPriceLimitX96: a.sqrtPriceLimitX96
                }),
                ""
            );
        } else {
            (delta, ) = poolManager.modifyLiquidity(
                a.key,
                ModifyLiquidityParams({
                    tickLower: a.tickLower,
                    tickUpper: a.tickUpper,
                    liquidityDelta: a.liquidityDelta,
                    salt: 0
                }),
                ""
            );
        }

        _resolve(a.key.currency0, delta.amount0());
        _resolve(a.key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _resolve(Currency currency, int128 amount) internal {
        if (amount < 0) {
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), uint256(uint128(-amount)));
            poolManager.settle();
        } else if (amount > 0) {
            poolManager.take(currency, address(this), uint256(uint128(amount)));
        }
    }

    /// @notice Return working capital to the owner.
    function sweep(address token) external onlyOwner {
        IERC20(token).safeTransfer(owner(), IERC20(token).balanceOf(address(this)));
    }
}
