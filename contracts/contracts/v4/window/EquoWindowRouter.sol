// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {EquoWindows} from "./EquoWindows.sol";

interface IRouterWHYPE {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title EquoWindowRouter
/// @notice Plain buys and sells of Equo coins on HyperEVM, in HYPE. (Window buys go to {EquoWindows}.) The pool's
///         fee is taken by the hook; the router takes nothing. A sell stops at the pool's floor and hands back the
///         coins the pool could not take.
contract EquoWindowRouter is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    EquoWindows public immutable windows;
    address public immutable whype;

    error Slippage();
    error Expired();
    error NotPoolManager();
    error InvalidParams();

    constructor(IPoolManager poolManager_, EquoWindows windows_, address whype_) {
        poolManager = poolManager_;
        windows = windows_;
        whype = whype_;
    }

    receive() external payable {
        if (msg.sender != whype) revert InvalidParams();
    }

    /// @notice Buy coins with the HYPE sent.
    function buy(address token, uint256 minOut, uint256 deadline) external payable nonReentrant returns (uint256 out) {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert InvalidParams();
        IRouterWHYPE(whype).deposit{value: msg.value}();
        out = abi.decode(poolManager.unlock(abi.encode(token, false, msg.value, msg.sender, msg.sender)), (uint256));
        if (out < minOut) revert Slippage();
    }

    /// @notice Sell `amountIn` coins (approved to this router) for HYPE.
    function sell(address token, uint256 amountIn, uint256 minOut, uint256 deadline) external nonReentrant returns (uint256 out) {
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0) revert InvalidParams();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountIn);
        out = abi.decode(poolManager.unlock(abi.encode(token, true, amountIn, address(this), msg.sender)), (uint256));
        if (out < minOut) revert Slippage();
        IRouterWHYPE(whype).withdraw(out);
        (bool ok,) = msg.sender.call{value: out}("");
        if (!ok) {
            IRouterWHYPE(whype).deposit{value: out}();
            IERC20(whype).safeTransfer(msg.sender, out);
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address token, bool sell_, uint256 amountIn, address to, address user) = abi.decode(data, (address, bool, uint256, address, address));
        PoolKey memory key = windows.keyOf(token);
        uint160 limit = TickMath.MAX_SQRT_PRICE - 1;
        if (sell_) {
            limit = windows.hook().floorOf(token);
            if (limit <= TickMath.MIN_SQRT_PRICE) limit = TickMath.MIN_SQRT_PRICE + 1;
        }
        BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: sell_, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit}), "");
        (Currency inC, Currency outC, int128 inD, int128 outD) = sell_
            ? (key.currency0, key.currency1, d.amount0(), d.amount1())
            : (key.currency1, key.currency0, d.amount1(), d.amount0());
        uint256 paid = uint256(uint128(-inD));
        poolManager.sync(inC);
        IERC20(Currency.unwrap(inC)).safeTransfer(address(poolManager), paid);
        poolManager.settle();
        uint256 out = outD > 0 ? uint256(uint128(outD)) : 0;
        if (out > 0) poolManager.take(outC, to, out);
        // a buy can stop short (top of range): return what it did not spend
        if (paid < amountIn) IERC20(Currency.unwrap(inC)).safeTransfer(user, amountIn - paid);
        return abi.encode(out);
    }
}
