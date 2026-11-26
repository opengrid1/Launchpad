// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IERC20S {
    function transfer(address to, uint256 v) external returns (bool);
    function transferFrom(address f, address t, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

/// @dev Uniswap v3 pools and Aerodrome Slipstream pools share this interface and the same callback
interface IV3Pool {
    function token0() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @title LootbagSwapper
/// @notice Turns one token into another along a fixed route of pools, for the payout contract (a coin's quote into
///         the round's reward), the Bags (the pot's VVV into the day's token) and the airdrop pot (fees into VVV).
///         Routes are set by the owner and every change waits 48 hours, so a route can't be swapped for a bad one
///         without everyone seeing it first. Each swap must return at least the caller's minimum or it reverts.
/// @dev A hop is either a v3-style pool (Uniswap v3 or Aerodrome Slipstream, swapped directly with the pool's
///      callback) or a Uniswap v4 pool (a Lootbag coin's own pool, or any other v4 pool). It holds nothing between
///      calls: every swap pulls its input from the caller and sends the output to the recipient.
contract LootbagSwapper is IUnlockCallback {
    error NotOwner();
    error NoRoute();
    error TooEarly();
    error BadCallback();
    error TooLittle(uint256 out, uint256 minOut);

    event RouteQueued(address indexed tokenIn, address indexed tokenOut, uint256 eta);
    event RouteSet(address indexed tokenIn, address indexed tokenOut);
    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    uint256 public constant DELAY = 48 hours;
    uint8 public constant V3 = 0;
    uint8 public constant V4 = 1;

    struct Hop {
        uint8 kind;
        address pool; // v3-style pool (V3)
        PoolKey key; // v4 pool (V4)
    }

    IPoolManager public immutable poolManager;
    address public owner;
    address public pendingOwner;

    mapping(bytes32 => Hop[]) internal _routes;
    mapping(bytes32 => Hop[]) internal _queued;
    mapping(bytes32 => uint256) public eta;

    /// @dev transient slot: the v3-style pool allowed to call back during the current hop
    bytes32 private constant EXPECTED = keccak256("lootbag.swapper.expected");

    constructor(IPoolManager pm, address owner_) {
        poolManager = pm;
        owner = owner_;
    }

    function _id(address a, address b) internal pure returns (bytes32) {
        return keccak256(abi.encode(a, b));
    }

    function route(address tokenIn, address tokenOut) external view returns (Hop[] memory) {
        return _routes[_id(tokenIn, tokenOut)];
    }

    // ------------------------------------------------------------------ owner

    /// @notice Queues a route; it can be applied after 48 hours. The first route for a pair applies at once.
    function queueRoute(address tokenIn, address tokenOut, Hop[] calldata hops) external {
        if (msg.sender != owner) revert NotOwner();
        bytes32 id = _id(tokenIn, tokenOut);
        delete _queued[id];
        for (uint256 i; i < hops.length; i++) _queued[id].push(hops[i]);
        bool first = _routes[id].length == 0;
        eta[id] = first ? block.timestamp : block.timestamp + DELAY;
        emit RouteQueued(tokenIn, tokenOut, eta[id]);
        if (first) _apply(tokenIn, tokenOut, id);
    }

    function applyRoute(address tokenIn, address tokenOut) external {
        bytes32 id = _id(tokenIn, tokenOut);
        if (eta[id] == 0 || block.timestamp < eta[id]) revert TooEarly();
        _apply(tokenIn, tokenOut, id);
    }

    function _apply(address tokenIn, address tokenOut, bytes32 id) internal {
        delete _routes[id];
        Hop[] storage q = _queued[id];
        for (uint256 i; i < q.length; i++) _routes[id].push(q[i]);
        delete _queued[id];
        eta[id] = 0;
        emit RouteSet(tokenIn, tokenOut);
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotOwner();
        pendingOwner = to;
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ------------------------------------------------------------------ swap

    /// @notice Swaps `amountIn` of `tokenIn` (pulled from the caller) into `tokenOut`, sent to `recipient`
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 out)
    {
        Hop[] memory hops = _routes[_id(tokenIn, tokenOut)];
        if (hops.length == 0) revert NoRoute();
        _pay(tokenIn, msg.sender, address(this), amountIn);
        address t = tokenIn;
        uint256 amt = amountIn;
        for (uint256 i; i < hops.length; i++) (t, amt) = _hop(hops[i], t, amt);
        if (t != tokenOut) revert NoRoute();
        if (amt < minOut) revert TooLittle(amt, minOut);
        _pay(tokenOut, address(this), recipient, amt);
        emit Swapped(tokenIn, tokenOut, amountIn, amt);
        return amt;
    }

    function _hop(Hop memory h, address tIn, uint256 amt) internal returns (address tOut, uint256 out) {
        if (h.kind == V3) {
            IV3Pool p = IV3Pool(h.pool);
            bool zeroForOne = p.token0() == tIn;
            _setExpected(h.pool);
            (int256 a0, int256 a1) = p.swap(
                address(this),
                zeroForOne,
                int256(amt),
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
                abi.encode(tIn)
            );
            _setExpected(address(0));
            out = uint256(-(zeroForOne ? a1 : a0));
            tOut = zeroForOne ? _token1(h.pool) : p.token0();
        } else {
            bool zeroForOne = Currency.unwrap(h.key.currency0) == tIn;
            out = abi.decode(poolManager.unlock(abi.encode(h.key, zeroForOne, amt)), (uint256));
            tOut = Currency.unwrap(zeroForOne ? h.key.currency1 : h.key.currency0);
        }
    }

    function _setExpected(address a) internal {
        bytes32 slot = EXPECTED;
        assembly {
            tstore(slot, a)
        }
    }

    function _expected() internal view returns (address a) {
        bytes32 slot = EXPECTED;
        assembly {
            a := tload(slot)
        }
    }

    function _token1(address pool) internal view returns (address t) {
        (bool ok, bytes memory r) = pool.staticcall(abi.encodeWithSignature("token1()"));
        require(ok, "token1");
        t = abi.decode(r, (address));
    }

    /// @dev Uniswap v3 and Aerodrome Slipstream both call this
    function uniswapV3SwapCallback(int256 a0, int256 a1, bytes calldata data) external {
        address exp = _expected();
        if (exp == address(0) || msg.sender != exp) revert BadCallback();
        address tIn = abi.decode(data, (address));
        _pay(tIn, address(this), msg.sender, uint256(a0 > 0 ? a0 : a1));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert BadCallback();
        (PoolKey memory key, bool zeroForOne, uint256 amt) = abi.decode(data, (PoolKey, bool, uint256));
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amt),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        (Currency cin, Currency cout) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        int128 paid = zeroForOne ? d.amount0() : d.amount1();
        int128 got = zeroForOne ? d.amount1() : d.amount0();
        poolManager.sync(cin);
        _pay(Currency.unwrap(cin), address(this), address(poolManager), uint256(int256(-paid)));
        poolManager.settle();
        poolManager.take(cout, address(this), uint256(int256(got)));
        return abi.encode(uint256(int256(got)));
    }

    function _pay(address token, address from, address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok, bytes memory r) = from == address(this)
            ? token.call(abi.encodeCall(IERC20S.transfer, (to, amt)))
            : token.call(abi.encodeCall(IERC20S.transferFrom, (from, to, amt)));
        require(ok && (r.length == 0 || abi.decode(r, (bool))), "pay");
    }
}
