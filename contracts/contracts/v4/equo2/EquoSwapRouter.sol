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

interface IV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

interface IV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 r0, uint112 r1, uint32 last);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title EquoSwapRouter
/// @notice Buy and sell Equo coins on this chain in plain native coin (ETH, BNB, HYPE, MON...), whatever the coin's
///         pool pairs against. A coin paired with the wrapped native coin needs no route; one paired with a listed
///         asset (a tokenized stock) takes a caller-supplied route of up to four hops from the wrapped native coin to
///         that asset through outside pools:
///
///           route = abi.encode(Hop[])   Hop = (dex, pool, v4Key)
///
///         dex 1 Uniswap V2 (pair address), 2 Uniswap V3 (pool address), 3 Uniswap V4 (key). Buying walks the hops
///         forward, selling backwards. Holders of the pair asset can also trade with it directly.
///
///         A sell never pushes the price below where the pool opened: what the pool cannot take there comes back.
///         The router holds nothing between calls.
contract EquoSwapRouter is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;

    uint8 internal constant UNI_V2 = 1;
    uint8 internal constant UNI_V3 = 2;
    uint8 internal constant UNI_V4 = 3;
    uint256 internal constant MAX_HOPS = 4;
    uint8 internal constant CB_COIN = 0;
    uint8 internal constant CB_HOP = 1;

    struct Hop {
        uint8 dex;
        address pool;
        PoolKey key;
    }

    IPoolManager public immutable poolManager;
    EquoLaunchFactory public immutable factory;
    EquoFeeHook public immutable hook;
    address public immutable weth;
    address private _activePool;

    event Bought(address indexed coin, address indexed buyer, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event Sold(address indexed coin, address indexed seller, uint256 coinIn, uint256 pairOut, uint256 ethOut);

    error ZeroAmount();
    error NotListed();
    error Slippage();
    error BadRoute();

    constructor(IPoolManager poolManager_, EquoLaunchFactory factory_, address weth_) {
        poolManager = poolManager_;
        factory = factory_;
        hook = factory_.hook();
        weth = weth_;
    }

    receive() external payable {}

    // ---------------------------------------------------------------------
    // Native coin in / out
    // ---------------------------------------------------------------------

    /// @notice Buy `coin` with the native coin sent, along `route` (empty when the coin pairs the native coin).
    function buy(address coin, bytes calldata route, uint256 minCoinOut) external payable nonReentrant returns (uint256 coinOut) {
        return _buy(coin, route, minCoinOut, msg.sender);
    }

    function buyFor(address coin, bytes calldata route, uint256 minCoinOut, address recipient) external payable nonReentrant returns (uint256 coinOut) {
        return _buy(coin, route, minCoinOut, recipient == address(0) ? msg.sender : recipient);
    }

    /// @notice Sell `amountIn` of `coin` for the native coin, along `route` walked backwards. Coins the pool cannot
    ///         take above its opening price are returned.
    function sell(address coin, uint256 amountIn, bytes calldata route, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (amountIn == 0) revert ZeroAmount();
        (PoolKey memory key, address pair) = _keyOf(coin);
        uint256 pairOut = _sellCoin(coin, key, amountIn);
        ethOut = _toWeth(pair, pairOut, route);
        if (ethOut < minEthOut) revert Slippage();
        IWrapped(weth).withdraw(ethOut);
        (bool ok,) = msg.sender.call{value: ethOut}("");
        require(ok, "native xfer");
        emit Sold(coin, msg.sender, amountIn, pairOut, ethOut);
    }

    // ---------------------------------------------------------------------
    // Pair asset in / out
    // ---------------------------------------------------------------------

    function buyWithPair(address coin, uint256 pairIn, uint256 minCoinOut) external nonReentrant returns (uint256 coinOut) {
        if (pairIn == 0) revert ZeroAmount();
        (PoolKey memory key, address pair) = _keyOf(coin);
        IERC20(pair).safeTransferFrom(msg.sender, address(this), pairIn);
        (, coinOut) = _swap(key, false, pairIn, TickMath.MAX_SQRT_PRICE - 1);
        if (coinOut < minCoinOut) revert Slippage();
        IERC20(coin).safeTransfer(msg.sender, coinOut);
        emit Bought(coin, msg.sender, 0, pairIn, coinOut);
    }

    function sellForPair(address coin, uint256 amountIn, uint256 minPairOut) external nonReentrant returns (uint256 pairOut) {
        if (amountIn == 0) revert ZeroAmount();
        (PoolKey memory key, address pair) = _keyOf(coin);
        pairOut = _sellCoin(coin, key, amountIn);
        if (pairOut < minPairOut) revert Slippage();
        IERC20(pair).safeTransfer(msg.sender, pairOut);
        emit Sold(coin, msg.sender, amountIn, pairOut, 0);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _buy(address coin, bytes calldata route, uint256 minCoinOut, address to) internal returns (uint256 coinOut) {
        if (msg.value == 0) revert ZeroAmount();
        (PoolKey memory key, address pair) = _keyOf(coin);
        IWrapped(weth).deposit{value: msg.value}();
        uint256 pairIn = _fromWeth(pair, msg.value, route);
        (, coinOut) = _swap(key, false, pairIn, TickMath.MAX_SQRT_PRICE - 1);
        if (coinOut < minCoinOut) revert Slippage();
        IERC20(coin).safeTransfer(to, coinOut);
        emit Bought(coin, to, msg.value, pairIn, coinOut);
    }

    /// @dev Sell coins into their pool down to its opening price at most; returns the rest to the seller.
    function _sellCoin(address coin, PoolKey memory key, uint256 amountIn) internal returns (uint256 pairOut) {
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 used;
        (used, pairOut) = _swap(key, true, amountIn, hook.config(coin).floorSqrtPriceX96);
        if (used < amountIn) IERC20(coin).safeTransfer(msg.sender, amountIn - used);
    }

    function _keyOf(address coin) internal view returns (PoolKey memory key, address pair) {
        (, address p,, uint64 createdAt,,,,) = factory.listings(coin);
        if (createdAt == 0) revert NotListed();
        return (factory.poolKeyOf(coin), p);
    }

    function _hops(bytes calldata route) internal pure returns (Hop[] memory hops) {
        if (route.length == 0) revert BadRoute();
        hops = abi.decode(route, (Hop[]));
        if (hops.length == 0 || hops.length > MAX_HOPS) revert BadRoute();
    }

    function _fromWeth(address pair, uint256 amount, bytes calldata route) internal returns (uint256) {
        if (pair == weth) {
            if (route.length != 0) revert BadRoute();
            return amount;
        }
        Hop[] memory hops = _hops(route);
        address held = weth;
        for (uint256 i; i < hops.length; i++) (held, amount) = _hop(hops[i], held, amount);
        if (held != pair) revert BadRoute();
        return amount;
    }

    function _toWeth(address pair, uint256 amount, bytes calldata route) internal returns (uint256) {
        if (pair == weth) {
            if (route.length != 0) revert BadRoute();
            return amount;
        }
        if (amount == 0) return 0;
        Hop[] memory hops = _hops(route);
        address held = pair;
        for (uint256 i = hops.length; i > 0; i--) (held, amount) = _hop(hops[i - 1], held, amount);
        if (held != weth) revert BadRoute();
        return amount;
    }

    function _hop(Hop memory h, address tokenIn, uint256 amountIn) internal returns (address tokenOut, uint256 amountOut) {
        if (h.dex == UNI_V4) {
            address c0 = Currency.unwrap(h.key.currency0);
            address c1 = Currency.unwrap(h.key.currency1);
            if (address(h.key.hooks) == address(hook)) revert BadRoute(); // never an Equo pool as a hop
            bool zeroForOne;
            if (tokenIn == (c0 == address(0) ? weth : c0)) { zeroForOne = true; tokenOut = c1; }
            else if (tokenIn == c1) { tokenOut = c0 == address(0) ? weth : c0; }
            else revert BadRoute();
            bytes memory res = poolManager.unlock(abi.encode(CB_HOP, abi.encode(h.key, zeroForOne, amountIn)));
            amountOut = abi.decode(res, (uint256));
            return (tokenOut, amountOut);
        }
        address t0 = IV3Pool(h.pool).token0();
        address t1 = IV3Pool(h.pool).token1();
        bool zfo;
        if (tokenIn == t0) { zfo = true; tokenOut = t1; }
        else if (tokenIn == t1) { tokenOut = t0; }
        else revert BadRoute();
        uint256 before = IERC20(tokenOut).balanceOf(address(this));
        if (h.dex == UNI_V2) {
            IERC20(tokenIn).safeTransfer(h.pool, amountIn);
            (uint112 r0, uint112 r1,) = IV2Pair(h.pool).getReserves();
            (uint256 rin, uint256 rout) = zfo ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
            uint256 got = IERC20(tokenIn).balanceOf(h.pool) - rin;
            uint256 inFee = got * 997;
            uint256 out = (inFee * rout) / (rin * 1000 + inFee);
            IV2Pair(h.pool).swap(zfo ? 0 : out, zfo ? out : 0, address(this), "");
        } else if (h.dex == UNI_V3) {
            _activePool = h.pool;
            IV3Pool(h.pool).swap(address(this), zfo, int256(amountIn), zfo ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1, abi.encode(tokenIn));
            _activePool = address(0);
        } else {
            revert BadRoute();
        }
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - before;
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != _activePool || msg.sender == address(0)) revert BadRoute();
        address tokenIn = abi.decode(data, (address));
        IERC20(tokenIn).safeTransfer(msg.sender, amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta));
    }

    function _swap(PoolKey memory key, bool zeroForOne, uint256 amountIn, uint160 limit) internal returns (uint256 used, uint256 out) {
        bytes memory res = poolManager.unlock(abi.encode(CB_COIN, abi.encode(key, zeroForOne, amountIn, limit)));
        (used, out) = abi.decode(res, (uint256, uint256));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (uint8 kind, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (kind == CB_HOP) {
            (PoolKey memory hk, bool hzfo, uint256 hin) = abi.decode(payload, (PoolKey, bool, uint256));
            (, uint256 hout) = _settle(hk, hzfo, hin, hzfo ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);
            return abi.encode(hout);
        }
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, uint160 limit) = abi.decode(payload, (PoolKey, bool, uint256, uint160));
        (uint256 used, uint256 out) = _settle(key, zeroForOne, amountIn, limit);
        return abi.encode(used, out);
    }

    /// @dev Swap exact-in inside an unlock and settle both sides with ERC-20s (a native currency is paid and taken
    ///      as wrapped).
    function _settle(PoolKey memory key, bool zeroForOne, uint256 amountIn, uint160 limit) internal returns (uint256 used, uint256 out) {
        BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit}), "");
        int128 paid = zeroForOne ? d.amount0() : d.amount1();
        int128 got = zeroForOne ? d.amount1() : d.amount0();
        Currency cin = zeroForOne ? key.currency0 : key.currency1;
        Currency cout = zeroForOne ? key.currency1 : key.currency0;
        used = paid < 0 ? uint256(uint128(-paid)) : 0;
        out = got > 0 ? uint256(uint128(got)) : 0;
        if (used != 0) {
            if (Currency.unwrap(cin) == address(0)) {
                IWrapped(weth).withdraw(used);
                poolManager.settle{value: used}();
            } else {
                poolManager.sync(cin);
                IERC20(Currency.unwrap(cin)).safeTransfer(address(poolManager), used);
                poolManager.settle();
            }
        }
        if (out != 0) {
            poolManager.take(cout, address(this), out);
            if (Currency.unwrap(cout) == address(0)) IWrapped(weth).deposit{value: out}();
        }
    }
}
