// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @dev Test-only stand-in for a third-party router (aggregator, bot): swaps a
///      V4 pool with EMPTY hook data, pulling the input from the caller and
///      sending the output straight to them. Lets fork tests check that the
///      ledger attributes such trades to tx.origin.
contract ForeignSwapper is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    function swap(PoolKey calldata key, address currencyIn, uint256 amountIn) external returns (uint256 out) {
        IERC20(currencyIn).safeTransferFrom(msg.sender, address(this), amountIn);
        bool zeroForOne = currencyIn == Currency.unwrap(key.currency0);
        out = abi.decode(pm.unlock(abi.encode(key, zeroForOne, amountIn, msg.sender)), (uint256));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(pm), "pm");
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, address to) = abi.decode(data, (PoolKey, bool, uint256, address));
        BalanceDelta d = pm.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}),
            ""
        );
        uint256 out = _settle(key.currency0, d.amount0(), to) + _settle(key.currency1, d.amount1(), to);
        return abi.encode(out);
    }

    function _settle(Currency c, int128 amount, address to) internal returns (uint256 out) {
        if (amount < 0) {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(pm), uint256(uint128(-amount)));
            pm.settle();
        } else if (amount > 0) {
            out = uint256(uint128(amount));
            pm.take(c, to, out);
        }
    }
}
