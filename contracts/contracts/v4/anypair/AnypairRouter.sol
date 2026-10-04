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

import {AnypairFactory} from "./AnypairFactory.sol";

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @dev Uniswap V3, PancakeSwap V3 and Aerodrome Slipstream pools share this swap.
interface IV3SwapPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @dev Aerodrome (Velodrome V2) pool.
interface IAeroSwapPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title AnypairRouter
/// @notice One-tap trading for Anypair coins in plain ETH, whatever the pair.
///         The ETH <-> pair leg follows a caller-supplied route of up to four
///         hops through the pools the pair really trades in on Base:
///
///           route = abi.encode(Hop[])   Hop = (dex, pool, v4Key)
///
///         dex 1 Uniswap V3, 2 PancakeSwap V3, 3 Aerodrome Slipstream (by
///         pool address), 4 Aerodrome volatile/stable pool (by address),
///         5 Uniswap V4 (by key; native-ETH pools work, the router wraps and
///         unwraps). Buying walks WETH -> ... -> pair; selling walks the same
///         hops backwards. A WETH pair needs no route. The frontend picks the
///         route; the contracts stay generic.
///
///         The router also turns pair-asset fees into ETH for claimants (coins
///         call {pairToEth}), buys reward baskets ({pairToBasket}) and performs
///         the factory's ETH first buy ({ethToPair}). It holds no funds
///         between calls.
contract AnypairRouter is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 internal constant UNI_V3 = 1;
    uint8 internal constant PANCAKE_V3 = 2;
    uint8 internal constant SLIPSTREAM = 3;
    uint8 internal constant AERO_V2 = 4;
    uint8 internal constant UNI_V4 = 5;
    uint256 internal constant MAX_HOPS = 4;

    IPoolManager public immutable poolManager;
    AnypairFactory public immutable factory;
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
        /// @dev The wallet the hook should credit (the trader), zero for routing legs.
        address user;
    }

    /// @dev The V3-style pool this call is swapping in; only it may call back.
    address private _activePool;

    event Bought(address indexed coin, address indexed buyer, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event Sold(address indexed coin, address indexed seller, uint256 coinIn, uint256 pairOut, uint256 ethOut);
    event BasketBought(address indexed from, address indexed to, address pair, uint256 pairIn, address[] assets, uint256[] outs);

    error NotListed();
    error Slippage();
    error ZeroAmount();
    error BadRoute();
    error ZeroAddress();

    constructor(IPoolManager pm, AnypairFactory factory_, address weth_) {
        if (address(pm) == address(0) || address(factory_) == address(0) || weth_ == address(0)) revert ZeroAddress();
        poolManager = pm;
        factory = factory_;
        weth = weth_;
    }

    receive() external payable {}

    // ---------------------------------------------------------------------
    // ETH in / ETH out
    // ---------------------------------------------------------------------

    /// @notice Buy `coin` with the ETH sent, along `route` (empty for a WETH pair).
    function buy(address coin, bytes calldata route, uint256 minCoinOut) external payable nonReentrant returns (uint256 coinOut) {
        if (msg.value == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
        uint256 pairIn = _ethToPair(pair, msg.value, route);
        coinOut = _coinSwap(coin, pair, pairIn);
        if (coinOut < minCoinOut) revert Slippage();
        IERC20(coin).safeTransfer(msg.sender, coinOut);
        emit Bought(coin, msg.sender, msg.value, pairIn, coinOut);
    }

    /// @notice Sell `amountIn` of `coin` for ETH along `route` (the buy route;
    ///         the router walks it backwards).
    function sell(address coin, uint256 amountIn, bytes calldata route, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (amountIn == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
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
    // Conversions for the factory (first buy) and coins (claim as ETH)
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

    /// @notice Pull `amount` of `pair` from the caller and turn it into equal
    ///         shares of `assets`, sent to `to`. Shares already in the pair are
    ///         passed on as is; the rest is sold for WETH along `pairRoute`
    ///         (walked backwards) and bought along `routes[i]`. Each asset must
    ///         come out at `minOuts[i]` or more.
    function pairToBasket(
        address pair,
        uint256 amount,
        address to,
        bytes calldata pairRoute,
        address[] calldata assets,
        bytes[] calldata routes,
        uint256[] calldata minOuts
    ) external nonReentrant returns (uint256[] memory outs) {
        if (to == address(0)) revert ZeroAddress();
        uint256 n = assets.length;
        if (n == 0 || routes.length != n || minOuts.length != n) revert BadRoute();
        outs = new uint256[](n);
        if (amount == 0) return outs;
        IERC20(pair).safeTransferFrom(msg.sender, address(this), amount);

        uint256 same = 0;
        for (uint256 i; i < n; i++) if (assets[i] == pair) same++;
        uint256 swaps = n - same;
        uint256 direct = (amount * same) / n;
        uint256 wethAmt = swaps == 0 ? 0 : _pairToWeth(pair, amount - direct, pairRoute);
        uint256 directLeft = direct;
        uint256 wethLeft = wethAmt;
        uint256 sameSeen = 0;
        uint256 swapSeen = 0;
        for (uint256 i; i < n; i++) {
            uint256 out;
            if (assets[i] == pair) {
                out = ++sameSeen == same ? directLeft : direct / same;
                directLeft -= out;
            } else {
                uint256 part = ++swapSeen == swaps ? wethLeft : wethAmt / swaps;
                wethLeft -= part;
                out = _wethToPair(assets[i], part, routes[i]);
            }
            if (out < minOuts[i]) revert Slippage();
            if (out > 0) IERC20(assets[i]).safeTransfer(to, out);
            outs[i] = out;
        }
        emit BasketBought(msg.sender, to, pair, amount, assets, outs);
    }

    // ---------------------------------------------------------------------
    // Routing
    // ---------------------------------------------------------------------

    function _hops(bytes calldata route) internal pure returns (Hop[] memory hops) {
        if (route.length == 0) revert BadRoute();
        hops = abi.decode(route, (Hop[]));
        if (hops.length == 0 || hops.length > MAX_HOPS) revert BadRoute();
    }

    /// @dev Wrap `ethAmount` and route it into `pair`. Returns pair held here.
    function _ethToPair(address pair, uint256 ethAmount, bytes calldata route) internal returns (uint256) {
        IWrappedNative(weth).deposit{value: ethAmount}();
        return _wethToPair(pair, ethAmount, route);
    }

    /// @dev Forward: WETH -> hop[0] -> ... -> pair. Returns pair held here.
    function _wethToPair(address pair, uint256 wethAmount, bytes calldata route) internal returns (uint256 amount) {
        if (pair == weth || wethAmount == 0) return wethAmount;
        Hop[] memory hops = _hops(route);
        address held = weth;
        amount = wethAmount;
        for (uint256 i; i < hops.length; i++) (held, amount) = _hop(hops[i], held, amount);
        if (held != pair) revert BadRoute();
    }

    /// @dev Backward: pair -> hop[n-1] -> ... -> WETH. Returns WETH held.
    function _pairToWeth(address pair, uint256 pairAmount, bytes calldata route) internal returns (uint256 amount) {
        if (pair == weth || pairAmount == 0) return pairAmount;
        Hop[] memory hops = _hops(route);
        address held = pair;
        amount = pairAmount;
        for (uint256 i = hops.length; i > 0; i--) (held, amount) = _hop(hops[i - 1], held, amount);
        if (held != weth) revert BadRoute();
    }

    /// @dev Swap `amountIn` of `tokenIn` through one pool; returns the token and amount out.
    function _hop(Hop memory h, address tokenIn, uint256 amountIn) internal returns (address tokenOut, uint256 amountOut) {
        if (h.dex == UNI_V4) {
            // native ETH (currency 0) trades as WETH on this side of the router
            address c0 = Currency.unwrap(h.key.currency0);
            address c1 = Currency.unwrap(h.key.currency1);
            address s0 = c0 == address(0) ? weth : c0;
            bool zeroForOne;
            if (tokenIn == s0) { zeroForOne = true; tokenOut = c1; }
            else if (tokenIn == c1) { tokenOut = s0; }
            else revert BadRoute();
            amountOut = _v4SwapFor(h.key, zeroForOne, amountIn, address(0));
            return (tokenOut, amountOut);
        }
        address t0 = IV3SwapPool(h.pool).token0();
        address t1 = IV3SwapPool(h.pool).token1();
        bool zfo;
        if (tokenIn == t0) { zfo = true; tokenOut = t1; }
        else if (tokenIn == t1) { tokenOut = t0; }
        else revert BadRoute();
        uint256 before = IERC20(tokenOut).balanceOf(address(this));
        if (h.dex == AERO_V2) {
            uint256 out = IAeroSwapPool(h.pool).getAmountOut(amountIn, tokenIn);
            IERC20(tokenIn).safeTransfer(h.pool, amountIn);
            IAeroSwapPool(h.pool).swap(zfo ? 0 : out, zfo ? out : 0, address(this), "");
        } else if (h.dex == UNI_V3 || h.dex == PANCAKE_V3 || h.dex == SLIPSTREAM) {
            _activePool = h.pool;
            IV3SwapPool(h.pool).swap(
                address(this), zfo, int256(amountIn), zfo ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1, abi.encode(tokenIn)
            );
            _activePool = address(0);
        } else {
            revert BadRoute();
        }
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - before;
    }

    /// @dev V3-style swap callback (Uniswap V3 and Slipstream name it this way).
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _v3Pay(amount0Delta, amount1Delta, data);
    }

    function pancakeV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _v3Pay(amount0Delta, amount1Delta, data);
    }

    function _v3Pay(int256 a0, int256 a1, bytes calldata data) internal {
        if (msg.sender != _activePool || msg.sender == address(0)) revert BadRoute();
        address tokenIn = abi.decode(data, (address));
        uint256 owed = a0 > 0 ? uint256(a0) : uint256(a1);
        IERC20(tokenIn).safeTransfer(msg.sender, owed);
    }

    // ---------------------------------------------------------------------
    // V4 swap plumbing (any pool, via PoolManager.unlock)
    // ---------------------------------------------------------------------

    function _pairOf(address coin) internal view returns (address pair) {
        (, pair,,,) = factory.listings(coin);
        if (pair == address(0)) revert NotListed();
    }

    /// @dev Swap through the coin's own pool: `currencyIn` is the coin (sell) or its pair (buy).
    ///      The caller is named in hook data so the ledger credits them even
    ///      when they trade from a contract wallet.
    function _coinSwap(address coin, address currencyIn, uint256 amountIn) internal returns (uint256) {
        PoolKey memory key = factory.poolKeyOf(coin);
        return _v4SwapFor(key, currencyIn == Currency.unwrap(key.currency0), amountIn, msg.sender);
    }

    function _v4SwapFor(PoolKey memory key, bool zeroForOne, uint256 amountIn, address user) internal returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        bytes memory res = poolManager.unlock(abi.encode(V4Swap(key, zeroForOne, amountIn, user)));
        amountOut = abi.decode(res, (uint256));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        V4Swap memory a = abi.decode(data, (V4Swap));
        BalanceDelta delta = poolManager.swap(
            a.key,
            SwapParams({
                zeroForOne: a.zeroForOne,
                amountSpecified: -int256(a.amountIn),
                sqrtPriceLimitX96: a.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            a.user == address(0) ? bytes("") : abi.encodePacked(a.user)
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
