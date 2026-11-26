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

import {StockPadFactory} from "./StockPadFactory.sol";

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @dev Uniswap V3 SwapRouter02 multi-hop surface (no deadline).
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @title StockPadRouter
/// @notice One-tap trading for stockpad coins in plain ETH, whatever the pair.
///         Tokenized stocks live in scattered pools (Uniswap V3 against USDC or
///         USDT, Uniswap V4 against USDC...), so the ETH <-> stock leg follows a
///         caller-supplied `route`:
///
///           route = abi.encode(bytes v3Path, PoolKey v4Key)
///
///         Buying: ETH -> WETH -[v3Path]-> X -[v4Key]-> pair -[coin's V4 pool]-> coin.
///         Either leg may be empty (empty path, zeroed key); for a WETH pair the
///         whole route is empty. Selling runs the same route backwards. The
///         frontend keeps the route per stock; the contracts stay generic.
///
///         The router also turns pair-asset fees into ETH for claimants (coins
///         call {pairToEth}) and performs the factory's ETH first buy
///         ({ethToPair}). It holds no funds between calls.
contract StockPadRouter is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    StockPadFactory public immutable factory;
    address public immutable weth;
    ISwapRouter02 public immutable v3Router;

    struct V4Swap {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
    }

    event Bought(address indexed coin, address indexed buyer, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event Sold(address indexed coin, address indexed seller, uint256 coinIn, uint256 pairOut, uint256 ethOut);

    error NotListed();
    error Slippage();
    error ZeroAmount();
    error BadRoute();

    constructor(IPoolManager pm, StockPadFactory factory_, address weth_, ISwapRouter02 v3Router_) {
        poolManager = pm;
        factory = factory_;
        weth = weth_;
        v3Router = v3Router_;
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
    // Pair in / pair out (for wallets that hold the stock)
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
        pairOut = _ethToPair(pair, msg.value, route);
        if (pairOut < minOut) revert Slippage();
        IERC20(pair).safeTransfer(to, pairOut);
    }

    /// @notice Pull `amount` of `pair` from the caller, turn it into ETH along
    ///         `route` (walked backwards) and send it to `to`.
    function pairToEth(address pair, uint256 amount, address to, uint256 minOut, bytes calldata route) external nonReentrant returns (uint256 ethOut) {
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

    function _decode(bytes calldata route) internal pure returns (bytes memory v3Path, PoolKey memory v4Key) {
        if (route.length == 0) return (v3Path, v4Key);
        (v3Path, v4Key) = abi.decode(route, (bytes, PoolKey));
    }

    /// @dev Forward: WETH -[v3Path]-> X -[v4Key]-> pair. Returns pair held here.
    function _ethToPair(address pair, uint256 ethAmount, bytes calldata route) internal returns (uint256 amount) {
        IWrappedNative(weth).deposit{value: ethAmount}();
        if (pair == weth) return ethAmount;
        (bytes memory v3Path, PoolKey memory v4Key) = _decode(route);
        address held = weth;
        amount = ethAmount;
        if (v3Path.length > 0) {
            if (_first(v3Path) != weth) revert BadRoute();
            IERC20(weth).forceApprove(address(v3Router), amount);
            amount = v3Router.exactInput(ISwapRouter02.ExactInputParams({path: v3Path, recipient: address(this), amountIn: amount, amountOutMinimum: 0}));
            held = _last(v3Path);
        }
        if (Currency.unwrap(v4Key.currency0) != address(0)) {
            address other = _otherSide(v4Key, held);
            if (other != pair) revert BadRoute();
            amount = _v4Swap(v4Key, held, amount);
            held = pair;
        }
        if (held != pair) revert BadRoute();
    }

    /// @dev Backward: pair -[v4Key]-> X -[reversed v3Path]-> WETH. Returns WETH held.
    function _pairToWeth(address pair, uint256 pairAmount, bytes calldata route) internal returns (uint256 amount) {
        if (pair == weth) return pairAmount;
        (bytes memory v3Path, PoolKey memory v4Key) = _decode(route);
        address held = pair;
        amount = pairAmount;
        if (Currency.unwrap(v4Key.currency0) != address(0)) {
            address other = _otherSide(v4Key, held);
            amount = _v4Swap(v4Key, held, amount);
            held = other;
        }
        if (v3Path.length > 0) {
            if (_last(v3Path) != held || _first(v3Path) != weth) revert BadRoute();
            bytes memory rev = _reverse(v3Path);
            IERC20(held).forceApprove(address(v3Router), amount);
            amount = v3Router.exactInput(ISwapRouter02.ExactInputParams({path: rev, recipient: address(this), amountIn: amount, amountOutMinimum: 0}));
            held = weth;
        }
        if (held != weth) revert BadRoute();
    }

    function _otherSide(PoolKey memory key, address held) internal pure returns (address) {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (held == c0) return c1;
        if (held == c1) return c0;
        revert BadRoute();
    }

    /// @dev First / last token of a V3 path (20-byte address, 3-byte fee, ...).
    function _first(bytes memory path) internal pure returns (address a) {
        assembly { a := shr(96, mload(add(path, 32))) }
    }

    function _last(bytes memory path) internal pure returns (address a) {
        uint256 off = path.length - 20;
        assembly { a := shr(96, mload(add(add(path, 32), off))) }
    }

    /// @dev Reverse a V3 path: tokenA fee tokenB fee tokenC -> tokenC fee tokenB fee tokenA.
    function _reverse(bytes memory path) internal pure returns (bytes memory out) {
        uint256 hops = (path.length - 20) / 23;
        out = new bytes(path.length);
        // copy tokens: token i at offset 23*i; fees at 23*i + 20
        for (uint256 i = 0; i <= hops; i++) {
            uint256 src = 23 * i;
            uint256 dst = 23 * (hops - i);
            for (uint256 b = 0; b < 20; b++) out[dst + b] = path[src + b];
        }
        for (uint256 i = 0; i < hops; i++) {
            uint256 src = 23 * i + 20;
            uint256 dst = 23 * (hops - 1 - i) + 20;
            for (uint256 b = 0; b < 3; b++) out[dst + b] = path[src + b];
        }
    }

    // ---------------------------------------------------------------------
    // V4 swap plumbing (any pool, via PoolManager.unlock)
    // ---------------------------------------------------------------------

    function _pairOf(address coin) internal view returns (address pair) {
        (, pair,,,) = factory.listings(coin);
        if (pair == address(0)) revert NotListed();
    }

    /// @dev Swap through the coin's own pool: `currencyIn` is the coin (sell) or its pair (buy).
    function _coinSwap(address coin, address currencyIn, uint256 amountIn) internal returns (uint256) {
        return _v4Swap(factory.poolKeyOf(coin), currencyIn, amountIn);
    }

    function _v4Swap(PoolKey memory key, address currencyIn, uint256 amountIn) internal returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        bool zeroForOne = currencyIn == Currency.unwrap(key.currency0);
        bytes memory res = poolManager.unlock(abi.encode(V4Swap(key, zeroForOne, amountIn)));
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
            ""
        );
        _resolve(a.key.currency0, delta.amount0());
        _resolve(a.key.currency1, delta.amount1());
        uint256 out = a.zeroForOne ? uint256(uint128(delta.amount1())) : uint256(uint128(delta.amount0()));
        return abi.encode(out);
    }

    function _resolve(Currency currency, int128 amount) internal {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), owed);
            poolManager.settle();
        } else if (amount > 0) {
            poolManager.take(currency, address(this), uint256(uint128(amount)));
        }
    }
}
