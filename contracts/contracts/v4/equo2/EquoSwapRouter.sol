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

import {EquoLaunchFactory} from "./EquoLaunchFactory.sol";
import {EquoFeeHook} from "./EquoFeeHook.sol";

interface IWrapped {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title EquoSwapRouter
/// @notice Buy and sell Equo coins on this chain in plain native coin (ETH, BNB, HYPE, MON...). A sell never pushes
///         the price below where the pool opened: what the pool cannot take there comes back to the seller.
contract EquoSwapRouter is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    EquoLaunchFactory public immutable factory;
    EquoFeeHook public immutable hook;
    address public immutable weth;

    event Bought(address indexed coin, address indexed buyer, uint256 ethIn, uint256 coinOut);
    event Sold(address indexed coin, address indexed seller, uint256 coinIn, uint256 ethOut);

    error ZeroAmount();
    error NotListed();
    error Slippage();
    error RouteNotSupported();

    constructor(IPoolManager poolManager_, EquoLaunchFactory factory_, address weth_) {
        poolManager = poolManager_;
        factory = factory_;
        hook = factory_.hook();
        weth = weth_;
    }

    receive() external payable {}

    /// @notice Buy `coin` with the native coin sent. `route` must be empty (every Equo pool pairs the native coin).
    function buy(address coin, bytes calldata route, uint256 minCoinOut) external payable nonReentrant returns (uint256 coinOut) {
        return _buy(coin, route, minCoinOut, msg.sender);
    }

    function buyFor(address coin, bytes calldata route, uint256 minCoinOut, address recipient) external payable nonReentrant returns (uint256 coinOut) {
        return _buy(coin, route, minCoinOut, recipient == address(0) ? msg.sender : recipient);
    }

    /// @notice Sell `amountIn` of `coin` for the native coin. Coins the pool cannot take above its opening price are
    ///         returned.
    function sell(address coin, uint256 amountIn, bytes calldata route, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (route.length != 0) revert RouteNotSupported();
        if (amountIn == 0) revert ZeroAmount();
        PoolKey memory key = _keyOf(coin);
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amountIn);
        (uint256 used, uint256 out) = _swap(key, true, amountIn, hook.config(coin).floorSqrtPriceX96);
        if (out < minEthOut) revert Slippage();
        if (used < amountIn) IERC20(coin).safeTransfer(msg.sender, amountIn - used);
        IWrapped(weth).withdraw(out);
        (bool ok,) = msg.sender.call{value: out}("");
        require(ok, "native xfer");
        emit Sold(coin, msg.sender, used, out);
        return out;
    }

    function _buy(address coin, bytes calldata route, uint256 minCoinOut, address to) internal returns (uint256 coinOut) {
        if (route.length != 0) revert RouteNotSupported();
        if (msg.value == 0) revert ZeroAmount();
        PoolKey memory key = _keyOf(coin);
        IWrapped(weth).deposit{value: msg.value}();
        (, coinOut) = _swap(key, false, msg.value, TickMath.MAX_SQRT_PRICE - 1);
        if (coinOut < minCoinOut) revert Slippage();
        IERC20(coin).safeTransfer(to, coinOut);
        emit Bought(coin, to, msg.value, coinOut);
    }

    function _keyOf(address coin) internal view returns (PoolKey memory) {
        (, , uint64 createdAt,,,,) = factory.listings(coin);
        if (createdAt == 0) revert NotListed();
        return factory.poolKeyOf(coin);
    }

    function _swap(PoolKey memory key, bool zeroForOne, uint256 amountIn, uint160 limit) internal returns (uint256 used, uint256 out) {
        bytes memory res = poolManager.unlock(abi.encode(key, zeroForOne, amountIn, limit));
        (used, out) = abi.decode(res, (uint256, uint256));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, uint160 limit) = abi.decode(data, (PoolKey, bool, uint256, uint160));
        BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit}), "");
        int128 a0 = d.amount0();
        int128 a1 = d.amount1();
        int128 paid = zeroForOne ? a0 : a1;
        int128 got = zeroForOne ? a1 : a0;
        Currency cin = zeroForOne ? key.currency0 : key.currency1;
        Currency cout = zeroForOne ? key.currency1 : key.currency0;
        uint256 used = paid < 0 ? uint256(uint128(-paid)) : 0;
        uint256 out = got > 0 ? uint256(uint128(got)) : 0;
        if (used != 0) {
            poolManager.sync(cin);
            IERC20(Currency.unwrap(cin)).safeTransfer(address(poolManager), used);
            poolManager.settle();
        }
        if (out != 0) poolManager.take(cout, address(this), out);
        return abi.encode(used, out);
    }
}
