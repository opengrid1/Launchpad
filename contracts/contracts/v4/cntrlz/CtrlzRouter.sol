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

import {CtrlzFactory} from "./CtrlzFactory.sol";
import {CtrlzHook} from "./CtrlzHook.sol";

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @dev Uniswap V3 pool.
interface IV3SwapPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @dev Uniswap V2 pair.
interface IV2SwapPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 r0, uint112 r1, uint32 last);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title CtrlzRouter
/// @notice One-tap trading for cntrl-z coins in plain ETH, whatever the pair
///         token. The ETH <-> pair leg follows a caller-supplied route of up to
///         four hops through the pools the token trades in on Ethereum:
///
///           route = abi.encode(Hop[])   Hop = (dex, pool, v4Key)
///
///         dex 1 Uniswap V2 (by pair address), 2 Uniswap V3 (by pool address),
///         3 Uniswap V4 (by key). Buying walks WETH -> ... -> pair; selling
///         walks the same hops backwards. A WETH-paired coin needs no route.
///
///         {buyWithWindow} rents an undo window on the hook; cancel and keep
///         are called on the hook directly. It holds no funds between calls.
contract CtrlzRouter is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 internal constant UNI_V2 = 1;
    uint8 internal constant UNI_V3 = 2;
    uint8 internal constant UNI_V4 = 3;
    uint256 internal constant MAX_HOPS = 4;

    IPoolManager public immutable poolManager;
    CtrlzFactory public immutable factory;
    CtrlzHook public immutable hook;
    address public immutable weth;

    struct Hop {
        uint8 dex;
        address pool;
        PoolKey key;
    }

    struct V4Swap {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
    }

    address private _activePool;

    event Bought(address indexed coin, address indexed buyer, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event BoughtWithWindow(address indexed coin, address indexed buyer, uint256 indexed id, uint256 ethIn, uint256 pairIn, uint256 coins, uint256 cost, uint256 premium);
    event Sold(address indexed coin, address indexed seller, uint256 coinIn, uint256 pairOut, uint256 ethOut);

    error NotListed();
    error Slippage();
    error ZeroAmount();
    error BadRoute();
    error ZeroAddress();

    constructor(IPoolManager pm, CtrlzFactory factory_, address weth_) {
        if (address(pm) == address(0) || address(factory_) == address(0) || weth_ == address(0)) revert ZeroAddress();
        poolManager = pm;
        factory = factory_;
        hook = factory_.hook();
        weth = weth_;
    }

    receive() external payable {}

    // ---------------------------------------------------------------------
    // ETH in / ETH out
    // ---------------------------------------------------------------------

    /// @notice Buy `coin` with the ETH sent, along `route` (empty for a WETH pair). No window.
    function buy(address coin, bytes calldata route, uint256 minCoinOut) external payable nonReentrant returns (uint256 coinOut) {
        if (msg.value == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
        _poke(pair);
        uint256 pairIn = _ethToPair(pair, msg.value, route);
        coinOut = _coinSwap(coin, pair, pairIn);
        if (coinOut < minCoinOut) revert Slippage();
        IERC20(coin).safeTransfer(msg.sender, coinOut);
        emit Bought(coin, msg.sender, msg.value, pairIn, coinOut);
    }

    /// @notice Buy `coin` with the ETH sent and rent an undo window of `secs`.
    ///         The premium and the buy both come out of the ETH sent; what the
    ///         buy doesn't use comes back (as ETH for a WETH pair, otherwise
    ///         as the pair token).
    function buyWithWindow(address coin, bytes calldata route, uint32 secs, uint256 minCoins)
        external
        payable
        nonReentrant
        returns (uint256 id, uint256 coins, uint256 cost, uint256 premium)
    {
        if (msg.value == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
        _poke(pair);
        uint256 pairIn = _ethToPair(pair, msg.value, route);
        IERC20(pair).forceApprove(address(hook), pairIn);
        uint256 refund;
        (id, coins, cost, premium, refund) = hook.buy(coin, pairIn, secs, msg.sender, minCoins);
        if (refund != 0) _giveBack(pair, refund);
        emit BoughtWithWindow(coin, msg.sender, id, msg.value, pairIn, coins, cost, premium);
    }

    /// @notice Sell `amountIn` of `coin` for ETH along `route` (the buy route, walked backwards).
    function sell(address coin, uint256 amountIn, bytes calldata route, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (amountIn == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
        _poke(pair);
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 pairOut = _coinSwap(coin, coin, amountIn);
        ethOut = _pairToWeth(pair, pairOut, route);
        if (ethOut < minEthOut) revert Slippage();
        IWrappedNative(weth).withdraw(ethOut);
        (bool ok,) = msg.sender.call{value: ethOut}("");
        require(ok, "eth xfer");
        emit Sold(coin, msg.sender, amountIn, pairOut, ethOut);
    }

    // ---------------------------------------------------------------------
    // Pair in / pair out (for wallets that hold the pair)
    // ---------------------------------------------------------------------

    function buyWithPair(address coin, uint256 pairIn, uint256 minCoinOut) external nonReentrant returns (uint256 coinOut) {
        if (pairIn == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
        IERC20(pair).safeTransferFrom(msg.sender, address(this), pairIn);
        coinOut = _coinSwap(coin, pair, pairIn);
        if (coinOut < minCoinOut) revert Slippage();
        IERC20(coin).safeTransfer(msg.sender, coinOut);
        emit Bought(coin, msg.sender, 0, pairIn, coinOut);
    }

    function sellForPair(address coin, uint256 amountIn, uint256 minPairOut) external nonReentrant returns (uint256 pairOut) {
        if (amountIn == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amountIn);
        pairOut = _coinSwap(coin, coin, amountIn);
        if (pairOut < minPairOut) revert Slippage();
        IERC20(pair).safeTransfer(msg.sender, pairOut);
        emit Sold(coin, msg.sender, amountIn, pairOut, 0);
    }

    // ---------------------------------------------------------------------
    // Conversions for the factory (first buy) and wallets (refunds to ETH)
    // ---------------------------------------------------------------------

    /// @notice Turn the ETH sent into `pair` along `route`, delivered to `to`.
    function ethToPair(address pair, bytes calldata route, address to, uint256 minOut) external payable nonReentrant returns (uint256 pairOut) {
        if (msg.value == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        pairOut = _ethToPair(pair, msg.value, route);
        if (pairOut < minOut) revert Slippage();
        IERC20(pair).safeTransfer(to, pairOut);
    }

    /// @notice Pull `amount` of `pair` from the caller, turn it into ETH along
    ///         `route` (walked backwards) and send it to `to`.
    function pairToEth(address pair, uint256 amount, address to, uint256 minOut, bytes calldata route) external nonReentrant returns (uint256 ethOut) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) return 0;
        IERC20(pair).safeTransferFrom(msg.sender, address(this), amount);
        ethOut = _pairToWeth(pair, amount, route);
        if (ethOut < minOut) revert Slippage();
        IWrappedNative(weth).withdraw(ethOut);
        (bool ok,) = to.call{value: ethOut}("");
        require(ok, "eth xfer");
    }

    // ---------------------------------------------------------------------
    // Routing
    // ---------------------------------------------------------------------

    function _giveBack(address pair, uint256 amount) internal {
        if (pair == weth) {
            IWrappedNative(weth).withdraw(amount);
            (bool ok,) = msg.sender.call{value: amount}("");
            require(ok, "eth xfer");
        } else {
            IERC20(pair).safeTransfer(msg.sender, amount);
        }
    }

    function _hops(bytes calldata route) internal pure returns (Hop[] memory hops) {
        if (route.length == 0) revert BadRoute();
        hops = abi.decode(route, (Hop[]));
        if (hops.length == 0 || hops.length > MAX_HOPS) revert BadRoute();
    }

    function _ethToPair(address pair, uint256 ethAmount, bytes calldata route) internal returns (uint256) {
        IWrappedNative(weth).deposit{value: ethAmount}();
        return _wethToPair(pair, ethAmount, route);
    }

    function _wethToPair(address pair, uint256 wethAmount, bytes calldata route) internal returns (uint256 amount) {
        if (pair == weth || wethAmount == 0) return wethAmount;
        Hop[] memory hops = _hops(route);
        address held = weth;
        amount = wethAmount;
        for (uint256 i; i < hops.length; i++) (held, amount) = _hop(hops[i], held, amount);
        if (held != pair) revert BadRoute();
    }

    function _pairToWeth(address pair, uint256 pairAmount, bytes calldata route) internal returns (uint256 amount) {
        if (pair == weth || pairAmount == 0) return pairAmount;
        Hop[] memory hops = _hops(route);
        address held = pair;
        amount = pairAmount;
        for (uint256 i = hops.length; i > 0; i--) (held, amount) = _hop(hops[i - 1], held, amount);
        if (held != weth) revert BadRoute();
    }

    function _hop(Hop memory h, address tokenIn, uint256 amountIn) internal returns (address tokenOut, uint256 amountOut) {
        if (h.dex == UNI_V4) {
            address c0 = Currency.unwrap(h.key.currency0);
            address c1 = Currency.unwrap(h.key.currency1);
            address s0 = c0 == address(0) ? weth : c0;
            bool zeroForOne;
            if (tokenIn == s0) { zeroForOne = true; tokenOut = c1; }
            else if (tokenIn == c1) { tokenOut = s0; }
            else revert BadRoute();
            amountOut = _v4Swap(h.key, zeroForOne, amountIn);
            return (tokenOut, amountOut);
        }
        address t0 = IV3SwapPool(h.pool).token0();
        address t1 = IV3SwapPool(h.pool).token1();
        bool zfo;
        if (tokenIn == t0) { zfo = true; tokenOut = t1; }
        else if (tokenIn == t1) { tokenOut = t0; }
        else revert BadRoute();
        uint256 before = IERC20(tokenOut).balanceOf(address(this));
        if (h.dex == UNI_V2) {
            IERC20(tokenIn).safeTransfer(h.pool, amountIn);
            (uint112 r0, uint112 r1,) = IV2SwapPair(h.pool).getReserves();
            (uint256 rin, uint256 rout) = zfo ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
            uint256 got = IERC20(tokenIn).balanceOf(h.pool) - rin;
            uint256 inFee = got * 997;
            uint256 out = (inFee * rout) / (rin * 1000 + inFee);
            IV2SwapPair(h.pool).swap(zfo ? 0 : out, zfo ? out : 0, address(this), "");
        } else if (h.dex == UNI_V3) {
            _activePool = h.pool;
            IV3SwapPool(h.pool).swap(address(this), zfo, int256(amountIn), zfo ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1, abi.encode(tokenIn));
            _activePool = address(0);
        } else {
            revert BadRoute();
        }
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - before;
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != _activePool || msg.sender == address(0)) revert BadRoute();
        address tokenIn = abi.decode(data, (address));
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        IERC20(tokenIn).safeTransfer(msg.sender, owed);
    }

    // ---------------------------------------------------------------------
    // V4 swap plumbing
    // ---------------------------------------------------------------------

    function _poke(address pair) internal {
        if (pair == weth) return;
        try factory.oracle().poke(pair) {} catch {}
    }

    function _pairOf(address coin) internal view returns (address pair) {
        (, pair,,) = factory.listings(coin);
        if (pair == address(0)) revert NotListed();
    }

    /// @dev Swap through the coin's own pool: `currencyIn` is the coin (sell) or its pair (buy).
    function _coinSwap(address coin, address currencyIn, uint256 amountIn) internal returns (uint256) {
        PoolKey memory key = factory.poolKeyOf(coin);
        return _v4Swap(key, currencyIn == Currency.unwrap(key.currency0), amountIn);
    }

    function _v4Swap(PoolKey memory key, bool zeroForOne, uint256 amountIn) internal returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        bytes memory res = poolManager.unlock(abi.encode(V4Swap(key, zeroForOne, amountIn)));
        amountOut = abi.decode(res, (uint256));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        V4Swap memory a = abi.decode(data, (V4Swap));
        BalanceDelta delta = poolManager.swap(
            a.key,
            SwapParams({zeroForOne: a.zeroForOne, amountSpecified: -int256(a.amountIn), sqrtPriceLimitX96: a.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}),
            ""
        );
        _resolve(a.key.currency0, delta.amount0());
        _resolve(a.key.currency1, delta.amount1());
        int128 o = a.zeroForOne ? delta.amount1() : delta.amount0();
        return abi.encode(o > 0 ? uint256(uint128(o)) : 0);
    }

    function _resolve(Currency currency, int128 amount) internal {
        address c = Currency.unwrap(currency);
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            if (c == address(0)) {
                IWrappedNative(weth).withdraw(owed);
                poolManager.settle{value: owed}();
            } else {
                poolManager.sync(currency);
                IERC20(c).safeTransfer(address(poolManager), owed);
                poolManager.settle();
            }
        } else if (amount > 0) {
            uint256 got = uint256(uint128(amount));
            poolManager.take(currency, address(this), got);
            if (c == address(0)) IWrappedNative(weth).deposit{value: got}();
        }
    }
}
