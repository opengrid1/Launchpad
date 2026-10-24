// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title LiqioPermanentLiquidity
/// @notice Puts liquidity into a Uniswap v4 pool and keeps it there for good. The position belongs to this
///         contract, which has no owner and no function that removes or collects liquidity, so whatever is
///         added through {add} can never leave the pool. Anyone can add to any pool; the caller supplies the
///         tokens (approve both first).
///
///         Written to return the liqio.fun (LIQIO) launch position to its pool after it was collected through
///         the v1 factory's admin function. Every v1 position restored this way sits here, beyond any admin.
contract LiqioPermanentLiquidity is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;

    event Added(PoolId indexed id, address indexed from, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 amount0, uint256 amount1);

    error NotPoolManager();
    error ZeroLiquidity();

    constructor(IPoolManager pm) {
        poolManager = pm;
    }

    /// @notice Add `liquidity` to `key` over [tickLower, tickUpper], paid by the caller. Permanent.
    function add(PoolKey calldata key, int24 tickLower, int24 tickUpper, uint128 liquidity)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        if (liquidity == 0) revert ZeroLiquidity();
        bytes memory r = poolManager.unlock(abi.encode(msg.sender, key, tickLower, tickUpper, liquidity));
        (amount0, amount1) = abi.decode(r, (uint256, uint256));
        emit Added(key.toId(), msg.sender, tickLower, tickUpper, liquidity, amount0, amount1);
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address from, PoolKey memory key, int24 lower, int24 upper, uint128 liquidity) =
            abi.decode(data, (address, PoolKey, int24, int24, uint128));
        (BalanceDelta d,) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)}), ""
        );
        uint256 a0 = d.amount0() < 0 ? uint256(uint128(-d.amount0())) : 0;
        uint256 a1 = d.amount1() < 0 ? uint256(uint128(-d.amount1())) : 0;
        _pay(key.currency0, from, a0);
        _pay(key.currency1, from, a1);
        return abi.encode(a0, a1);
    }

    function _pay(Currency currency, address from, uint256 due) internal {
        if (due == 0) return;
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransferFrom(from, address(poolManager), due);
        poolManager.settle();
    }
}
