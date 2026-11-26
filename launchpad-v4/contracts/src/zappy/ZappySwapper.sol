// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IUniswapV3Factory {
    function getPool(address, address, uint24) external view returns (address);
}

interface IUniswapV3Pool {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/**
 * @title ZappySwapper
 * @notice Turns ETH into a pair token (a Robinhood stock) and back for the
 * margin contract, along a route the owner sets per pair: Uniswap v3 pools
 * from WETH (e.g. WETH -> USDG -> stock), or Uniswap v4 pools from native ETH.
 * It holds no funds between calls: ethToPair sends the pair to the caller,
 * pairToEth pulls the pair from the caller and sends ETH to the recipient.
 * Each route also carries the pool depth, in the pair, a coin's pool needs
 * before it can be levered (about 5 ETH's worth when set).
 */
contract ZappySwapper is Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;

    struct Route {
        uint8 kind; // 1 = v3 pools from WETH, 2 = v4 pools from ETH
        address[] tokens; // v3: WETH, ..., pair
        address[] pools; // v3: the pool between tokens[i] and tokens[i + 1]
        PoolKey[] keys; // v4: the pools from ETH outward
        uint256 minDepth; // in the pair
    }

    uint160 private constant V3_MIN = 4295128740;
    uint160 private constant V3_MAX = 1461446703485210103287273052203988822378723970341;

    error NoRoute();
    error BadRoute();
    error Slippage(uint256 got, uint256 minimum);
    error NotPool();
    error TransferFailed();
    error OwnershipCannotBeRenounced();

    event RouteSet(address indexed pair, uint8 kind, uint256 hops, uint256 minDepth);

    IPoolManager public immutable poolManager;
    IWETH9 public immutable weth;
    IUniswapV3Factory public immutable v3Factory;
    mapping(address pair => Route) private _routes;

    // the v3 pool a swap in progress may call back, and what it owes
    address private _pool;
    address private _payToken;

    constructor(address initialOwner, IPoolManager poolManager_, IWETH9 weth_, IUniswapV3Factory v3Factory_) Ownable(initialOwner) {
        poolManager = poolManager_;
        weth = weth_;
        v3Factory = v3Factory_;
    }

    receive() external payable {
        if (msg.sender != address(weth) && msg.sender != address(poolManager)) revert TransferFailed();
    }

    // ------------------------------------------------------------------ owner

    /// @notice A v3 route: `tokens` from WETH to the pair, `fees` the pool tiers between them.
    function setV3Route(address pair, address[] calldata tokens, uint24[] calldata fees, uint256 minDepth) external onlyOwner {
        uint256 n = fees.length;
        if (n == 0 || tokens.length != n + 1 || tokens[0] != address(weth) || tokens[n] != pair || minDepth == 0) revert BadRoute();
        Route storage r = _routes[pair];
        delete r.tokens;
        delete r.pools;
        delete r.keys;
        r.kind = 1;
        r.minDepth = minDepth;
        for (uint256 i; i <= n; ++i) r.tokens.push(tokens[i]);
        for (uint256 i; i < n; ++i) {
            address p = v3Factory.getPool(tokens[i], tokens[i + 1], fees[i]);
            if (p == address(0)) revert BadRoute();
            r.pools.push(p);
        }
        emit RouteSet(pair, 1, n, minDepth);
    }

    /// @notice A v4 route: the pools from native ETH outward to the pair.
    function setV4Route(address pair, PoolKey[] calldata keys, uint256 minDepth) external onlyOwner {
        uint256 n = keys.length;
        if (n == 0 || minDepth == 0) revert BadRoute();
        Currency c = Currency.wrap(address(0));
        for (uint256 i; i < n; ++i) {
            if (keys[i].currency0 == c) c = keys[i].currency1;
            else if (keys[i].currency1 == c) c = keys[i].currency0;
            else revert BadRoute();
        }
        if (Currency.unwrap(c) != pair) revert BadRoute();
        Route storage r = _routes[pair];
        delete r.tokens;
        delete r.pools;
        delete r.keys;
        r.kind = 2;
        r.minDepth = minDepth;
        for (uint256 i; i < n; ++i) r.keys.push(keys[i]);
        emit RouteSet(pair, 2, n, minDepth);
    }

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    // ------------------------------------------------------------------ views

    function hasRoute(address pair) external view returns (bool) {
        return _routes[pair].kind != 0;
    }

    function minDepth(address pair) external view returns (uint256) {
        return _routes[pair].minDepth;
    }

    function routeOf(address pair) external view returns (Route memory) {
        return _routes[pair];
    }

    // ------------------------------------------------------------------ swaps

    /// @notice Swaps `msg.value` ETH into `pair` and sends it to the caller.
    function ethToPair(address pair, uint256 minOut) external payable nonReentrant returns (uint256 out) {
        Route storage r = _routes[pair];
        if (r.kind == 1) {
            weth.deposit{value: msg.value}();
            out = msg.value;
            for (uint256 i; i + 1 < r.tokens.length; ++i) out = _v3(r.pools[i], r.tokens[i], r.tokens[i + 1], out);
        } else if (r.kind == 2) {
            out = abi.decode(poolManager.unlock(abi.encode(pair, true, msg.value, msg.sender)), (uint256));
        } else {
            revert NoRoute();
        }
        if (out < minOut) revert Slippage(out, minOut);
        if (r.kind == 1) IERC20(pair).safeTransfer(msg.sender, out);
    }

    /// @notice Pulls `amountIn` of `pair` from the caller, swaps it to ETH and sends that to `to`.
    function pairToEth(address pair, uint256 amountIn, uint256 minOut, address to) external nonReentrant returns (uint256 out) {
        Route storage r = _routes[pair];
        IERC20(pair).safeTransferFrom(msg.sender, address(this), amountIn);
        if (r.kind == 1) {
            out = amountIn;
            for (uint256 i = r.tokens.length - 1; i > 0; --i) out = _v3(r.pools[i - 1], r.tokens[i], r.tokens[i - 1], out);
            weth.withdraw(out);
        } else if (r.kind == 2) {
            out = abi.decode(poolManager.unlock(abi.encode(pair, false, amountIn, address(this))), (uint256));
        } else {
            revert NoRoute();
        }
        if (out < minOut) revert Slippage(out, minOut);
        (bool ok,) = to.call{value: out}("");
        if (!ok) revert TransferFailed();
    }

    // --------------------------------------------------------------- internal

    function _v3(address pool, address tokenIn, address tokenOut, uint256 amountIn) private returns (uint256) {
        bool zeroForOne = tokenIn < tokenOut;
        _pool = pool;
        _payToken = tokenIn;
        (int256 a0, int256 a1) = IUniswapV3Pool(pool).swap(address(this), zeroForOne, SafeCast.toInt256(amountIn), zeroForOne ? V3_MIN : V3_MAX, "");
        _pool = address(0);
        return uint256(-(zeroForOne ? a1 : a0));
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != _pool || _pool == address(0)) revert NotPool();
        uint256 owed = uint256(amount0Delta > 0 ? amount0Delta : amount1Delta);
        IERC20(_payToken).safeTransfer(msg.sender, owed);
    }

    /// @dev A v4 route, every hop exact-input inside one unlock: only the first input is settled and the last output taken.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPool();
        (address pair, bool fromEth, uint256 amountIn, address recipient) = abi.decode(data, (address, bool, uint256, address));
        PoolKey[] storage keys = _routes[pair].keys;
        uint256 n = keys.length;
        Currency c = fromEth ? Currency.wrap(address(0)) : Currency.wrap(pair);
        Currency first = c;
        uint256 amt = amountIn;
        uint256 paid;
        for (uint256 k; k < n; ++k) {
            PoolKey memory key = keys[fromEth ? k : n - 1 - k];
            bool zeroForOne = key.currency0 == c;
            BalanceDelta d = poolManager.swap(
                key,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: -SafeCast.toInt256(amt),
                    sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            );
            if (k == 0) paid = uint256(uint128(-(zeroForOne ? d.amount0() : d.amount1())));
            amt = uint256(uint128(zeroForOne ? d.amount1() : d.amount0()));
            c = zeroForOne ? key.currency1 : key.currency0;
        }
        // pay the first input; a route too thin to take all of it is refused rather than half filled
        if (paid != amountIn) revert BadRoute();
        if (first.isAddressZero()) {
            poolManager.settle{value: amountIn}();
        } else {
            poolManager.sync(first);
            IERC20(Currency.unwrap(first)).safeTransfer(address(poolManager), amountIn);
            poolManager.settle();
        }
        poolManager.take(c, recipient, amt);
        return abi.encode(amt);
    }
}
