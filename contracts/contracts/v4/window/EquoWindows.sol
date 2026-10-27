// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {EquoWindowHook} from "./EquoWindowHook.sol";

interface IWindowWHYPE {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IWindowCoin {
    function burn(uint256 amount) external;
}

/// @title EquoWindows
/// @notice Holds every Equo pool's liquidity on HyperEVM and runs windows: a buy you can undo.
///
///         LIQUIDITY. A coin's whole supply goes into its pool at launch, as one position from the opening price to
///         the top of the price range. This contract is the only one that can add liquidity, and it keeps the pool's
///         liquidity as a list of contiguous segments (one Uniswap position each) from the pool's floor to the top,
///         so it can take liquidity out of, or put it into, any range of steps (one tick spacing each, 0.1%).
///
///         WINDOW. A buyer pays HYPE for coins plus a premium that buys time: {DAY_RATE_BPS} of the spend per day,
///         {MIN_WINDOW} to {MAX_WINDOW}. Opening a window takes out of the pool the coins a swap of that HYPE would
///         buy, starting at the step above the price (the step holding the price is left alone, so a window gets a
///         little less than a swap would), without moving the price: the steps it emptied are a hole. The coins and
///         the HYPE stay here, outside the pool, so no swap can reach them.
///           - Undo (the buyer, before expiry): all the HYPE spent on coins comes back. The coins go back into the
///             pool: into the hole if the price has not reached it, else into the step just above the price.
///           - Keep (the buyer any time, anyone after expiry): the buyer gets exactly the window's coins, and the
///             HYPE goes into the pool where a plain buy would have left it. If the price has not reached the hole,
///             the coins go back into it and are bought back out with the HYPE (fee already paid), so no hole is
///             left above the price; what that leaves over becomes support just below the price. Otherwise the HYPE
///             refills the parts of the hole below the price, the rest goes just below the price. Pushing the price
///             up before a keep never moves this HYPE above the hole.
///           Either way the premium buys coins from the pool and they are burned. The coin's fee on the spend is
///           paid at opening and never comes back.
///
///         COLLECT. The factory's admin can remove a share of a coin's pool liquidity, segment by segment, in as many
///         calls as the list needs. It never touches what open windows hold here.
///
///         Every pool: coin = currency0, WHYPE = currency1. Rounding of a few wei always falls on the caller's side:
///         an opening pays its own from its premium.
contract EquoWindows is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    int24 public constant STEP = 10;
    uint256 internal constant BPS = 10_000;
    uint256 public constant MIN_WINDOW = 30 minutes;
    uint256 public constant MAX_WINDOW = 7 days;
    /// @notice The premium for one day of window, in bps of the HYPE spent on coins (pro rata).
    uint256 public constant DAY_RATE_BPS = 400;
    uint256 public constant MIN_SPEND = 0.01 ether;
    /// @notice Coins kept here at launch to pay the pool's rounding.
    uint256 public constant COIN_SLACK = 1e12;
    /// @notice A window takes liquidity from at most this many segments; a larger one is refused (open a smaller one).
    uint256 public constant MAX_PIECES = 16;
    /// @notice Kept from each premium at closing to pay the pool's rounding, so a close never runs short.
    uint256 public constant CLOSE_DUST = 1e9;

    uint8 internal constant OP_SEED = 0;
    uint8 internal constant OP_OPEN = 1;
    uint8 internal constant OP_UNDO = 2;
    uint8 internal constant OP_KEEP = 3;
    uint8 internal constant OP_COLLECT = 4;

    uint8 public constant OPEN = 1;
    uint8 public constant UNDONE = 2;
    uint8 public constant KEPT = 3;

    IPoolManager public immutable poolManager;
    EquoWindowHook public immutable hook;
    address public immutable whype;
    address public immutable deployer;
    address public factory;

    /// @dev One segment of a pool's liquidity: [its key, next) with `liq`, a single position held here.
    struct Seg {
        bool on;
        int24 next;
        int24 prev;
        uint128 liq;
    }

    struct Book {
        bool live;
        int24 head; // the floor: where the lowest segment starts
        int24 top; // where the highest segment ends
        uint32 segments;
    }

    struct Piece {
        int24 lo;
        int24 hi;
        uint128 liq;
    }

    struct Window {
        address owner;
        uint64 expiry;
        uint8 state;
        address token;
        int24 bottom; // the hole's lowest tick: the price has "passed" the hole once it is at or above this
        uint8 pieces;
        uint128 coins;
        uint128 spent;
        uint128 premium;
    }

    mapping(address token => Book) public books;
    mapping(address token => mapping(int24 lo => Seg)) public segs;
    mapping(uint256 id => Window) public windows;
    mapping(uint256 id => mapping(uint256 => Piece)) public pieces;
    uint256 public nextWindowId = 1;
    /// @notice What open windows hold here: coins per coin, and HYPE (as WHYPE) across all coins.
    mapping(address token => uint256) public heldCoins;
    uint256 public heldWhype;

    event FactorySet(address indexed factory);
    event Seeded(address indexed token, int24 lower, int24 upper, uint128 liquidity, uint256 launchBuyIn, uint256 launchBuyOut);
    event WindowOpened(uint256 indexed id, address indexed token, address indexed owner, uint256 spent, uint256 fee, uint256 premium, uint256 coins, uint64 expiry);
    event WindowUndone(uint256 indexed id, address indexed token, address indexed owner, uint256 refunded, uint256 coinsBurned);
    event WindowKept(uint256 indexed id, address indexed token, address indexed owner, uint256 coins, uint256 coinsBurned);
    event Collected(address indexed token, uint16 bps, int24 from, int24 next, uint256 coins, uint256 whype, address indexed to);
    event FloorLowered(address indexed token, int24 head);

    error NotFactory();
    error NotOwner();
    error AlreadySet();
    error InvalidParams();
    error NotOpen();
    error Expired();
    error NotExpired();
    error WindowTooShort();
    error TooSmall();
    error TooBig();
    error TooFragmented();
    error BadHint();
    error Slippage();
    error Insolvent();

    constructor(IPoolManager poolManager_, EquoWindowHook hook_, address whype_) {
        if (address(poolManager_) == address(0) || address(hook_) == address(0) || whype_ == address(0)) revert InvalidParams();
        poolManager = poolManager_;
        hook = hook_;
        whype = whype_;
        deployer = msg.sender;
    }

    receive() external payable {}

    function setFactory(address factory_) external {
        if (msg.sender != deployer || factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert InvalidParams();
        factory = factory_;
        emit FactorySet(factory_);
    }

    // ---------------------------------------------------------------------
    // Launch (factory)
    // ---------------------------------------------------------------------

    /// @notice Put a new coin's supply (already sent here) into its pool from `lower` to `upper`, and make the
    ///         creator's launch buy (the HYPE sent), fee-free, coins to the creator.
    function seed(address token, int24 lower, int24 upper, address creator) external payable nonReentrant returns (uint256 bought) {
        if (msg.sender != factory) revert NotFactory();
        Book storage b = books[token];
        if (b.live || lower >= upper) revert InvalidParams();
        uint256 supply = IERC20(token).balanceOf(address(this)) - heldCoins[token];
        uint128 liq = LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), supply - COIN_SLACK);
        books[token] = Book({live: true, head: lower, top: upper, segments: 1});
        segs[token][lower] = Seg({on: true, next: upper, prev: type(int24).min, liq: liq});
        if (msg.value > 0) IWindowWHYPE(whype).deposit{value: msg.value}();
        bought = abi.decode(poolManager.unlock(abi.encode(OP_SEED, abi.encode(token, lower, upper, liq, msg.value))), (uint256));
        if (bought > 0) IERC20(token).safeTransfer(creator, bought);
        emit Seeded(token, lower, upper, liq, msg.value, bought);
    }

    // ---------------------------------------------------------------------
    // Windows
    // ---------------------------------------------------------------------

    /// @notice Buy coins with a window. `msg.value` = spend + the coin's fee on it + `premium`; the window lasts
    ///         `premium` / (spend × {DAY_RATE_BPS}) days, at least {MIN_WINDOW}; premium past {MAX_WINDOW} is refunded.
    ///         `hint`: the start of any segment at or below the price (see {segmentAt}); the floor always works.
    function openWindow(address token, uint256 premium, uint256 minCoins, int24 hint) external payable nonReentrant returns (uint256 id) {
        Book storage b = books[token];
        if (!b.live || premium >= msg.value) revert InvalidParams();
        uint16 feeBps = hook.config(token).feeBps;
        uint256 spend = ((msg.value - premium) * BPS) / (BPS + feeBps);
        uint256 fee = msg.value - premium - spend;
        if (spend < MIN_SPEND) revert TooSmall();
        uint256 length = (premium * 1 days * BPS) / (spend * DAY_RATE_BPS);
        if (length < MIN_WINDOW) revert WindowTooShort();
        uint256 refund;
        if (length > MAX_WINDOW) {
            uint256 needed = (spend * DAY_RATE_BPS * MAX_WINDOW + 1 days * BPS - 1) / (1 days * BPS);
            refund = premium - needed;
            premium = needed;
            length = MAX_WINDOW;
        }
        IWindowWHYPE(whype).deposit{value: msg.value - refund}();

        id = nextWindowId++;
        (uint256 coins, uint256 dust, Piece[] memory ps) =
            abi.decode(poolManager.unlock(abi.encode(OP_OPEN, abi.encode(token, spend, fee, hint))), (uint256, uint256, Piece[]));
        if (dust > premium) revert Insolvent();
        premium -= dust;
        if (coins < minCoins || coins == 0) revert Slippage();
        for (uint256 i; i < ps.length; i++) pieces[id][i] = ps[i];
        uint64 expiry = uint64(block.timestamp + length);
        windows[id] = Window({
            owner: msg.sender,
            expiry: expiry,
            state: OPEN,
            token: token,
            bottom: ps[0].lo,
            pieces: uint8(ps.length),
            coins: uint128(coins),
            spent: uint128(spend),
            premium: uint128(premium)
        });
        heldCoins[token] += coins;
        heldWhype += spend + premium;
        _checkHeld(token);
        if (refund > 0) _sendHype(msg.sender, refund);
        emit WindowOpened(id, token, msg.sender, spend, fee, premium, coins, expiry);
    }

    /// @notice Undo your window before it ends: the HYPE spent on coins comes back to you.
    function undo(uint256 id, int24 hint) external nonReentrant {
        Window storage w = windows[id];
        if (w.state != OPEN) revert NotOpen();
        if (msg.sender != w.owner) revert NotOwner();
        if (block.timestamp >= w.expiry) revert Expired();
        w.state = UNDONE;
        (uint256 burned) = abi.decode(poolManager.unlock(abi.encode(OP_UNDO, abi.encode(id, hint))), (uint256));
        address token = w.token;
        heldCoins[token] -= w.coins;
        heldWhype -= uint256(w.spent) + w.premium;
        if (burned > 0) IWindowCoin(token).burn(burned);
        _checkHeld(token);
        _sendHype(w.owner, w.spent);
        emit WindowUndone(id, token, w.owner, w.spent, burned);
    }

    /// @notice Keep a window's coins: the buyer any time, anyone once it has ended. The coins go to the buyer.
    function keep(uint256 id, int24 hint) external nonReentrant {
        Window storage w = windows[id];
        if (w.state != OPEN) revert NotOpen();
        if (msg.sender != w.owner && block.timestamp < w.expiry) revert NotExpired();
        w.state = KEPT;
        (uint256 burned, uint256 coins) = abi.decode(poolManager.unlock(abi.encode(OP_KEEP, abi.encode(id, hint))), (uint256, uint256));
        address token = w.token;
        heldCoins[token] -= w.coins;
        heldWhype -= uint256(w.spent) + w.premium;
        if (burned > 0) IWindowCoin(token).burn(burned);
        IERC20(token).safeTransfer(w.owner, coins);
        _checkHeld(token);
        emit WindowKept(id, token, w.owner, coins, burned);
    }

    // ---------------------------------------------------------------------
    // Collect (factory, for its admin)
    // ---------------------------------------------------------------------

    /// @notice Remove `bps` of the liquidity of up to `maxSegments` segments, starting at segment `from` (the floor
    ///         when `from` is below it), and send the coins and HYPE (as WHYPE) to `to`. Returns where the next call
    ///         should start; the pool's top when the whole list is done.
    function collect(address token, uint16 bps, address to, int24 from, uint256 maxSegments)
        external
        nonReentrant
        returns (int24 next, uint256 coins, uint256 whypeOut)
    {
        if (msg.sender != factory) revert NotFactory();
        Book storage b = books[token];
        if (!b.live || bps == 0 || bps > BPS || to == address(0) || maxSegments == 0) revert InvalidParams();
        if (from < b.head) from = b.head;
        if (!segs[token][from].on) revert BadHint();
        (next, coins, whypeOut) = abi.decode(poolManager.unlock(abi.encode(OP_COLLECT, abi.encode(token, bps, to, from, maxSegments))), (int24, uint256, uint256));
        _checkHeld(token);
        emit Collected(token, bps, from, next, coins, whypeOut, to);
    }

    // ---------------------------------------------------------------------
    // PoolManager callback
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotFactory();
        (uint8 op, bytes memory p) = abi.decode(data, (uint8, bytes));
        if (op == OP_OPEN) return _open(p);
        if (op == OP_UNDO) return _undo(p);
        if (op == OP_KEEP) return _keep(p);
        if (op == OP_COLLECT) return _collect(p);
        if (op != OP_SEED) revert InvalidParams();
        (address token, int24 lower, int24 upper, uint128 liq, uint256 buyIn) = abi.decode(p, (address, int24, int24, uint128, uint256));
        PoolKey memory key = keyOf(token);
        _modify(key, lower, upper, int256(uint256(liq)));
        uint256 bought;
        if (buyIn > 0) bought = _buy(key, buyIn);
        _settle(key.currency0);
        _settle(key.currency1);
        return abi.encode(bought);
    }

    function _open(bytes memory p) internal returns (bytes memory) {
        (address token, uint256 spend, uint256 fee, int24 hint) = abi.decode(p, (address, uint256, uint256, int24));
        PoolKey memory key = keyOf(token);
        Piece[] memory ps = _plan(token, key, spend, hint);
        for (uint256 i; i < ps.length; i++) {
            _cut(token, key, ps[i].lo, ps[i].hi, hint);
            Seg storage s = segs[token][ps[i].lo];
            s.liq -= ps[i].liq;
            _modify(key, ps[i].lo, ps[i].hi, -int256(uint256(ps[i].liq)));
        }
        // the fee: WHYPE in, claims to the hook, which splits them
        if (fee > 0) {
            poolManager.sync(key.currency1);
            IERC20(whype).safeTransfer(address(poolManager), fee);
            poolManager.settle();
            poolManager.mint(address(hook), key.currency1.toId(), fee);
            hook.recordFee(token, fee, spend);
        }
        int256 coinDelta = _settle(key.currency0);
        int256 whypeDelta = _settle(key.currency1);
        uint256 dust = whypeDelta < 0 ? uint256(-whypeDelta) : 0;
        if (coinDelta <= 0) revert TooSmall();
        return abi.encode(uint256(coinDelta), dust, ps);
    }

    function _undo(bytes memory p) internal returns (bytes memory) {
        (uint256 id, int24 hint) = abi.decode(p, (uint256, int24));
        Window storage w = windows[id];
        address token = w.token;
        PoolKey memory key = keyOf(token);
        (, int24 tick,,) = poolManager.getSlot0(key.toId());
        // the parts of the hole still above the price get their coins back exactly (all of it if the price never
        // reached the hole); the coins of the parts the price has passed go into the step just above the price
        uint256 used = _refill(token, key, id, tick, true, hint);
        if (used < w.coins) {
            int24 lo = _floorStep(tick) + STEP;
            Book storage b = books[token];
            if (lo + STEP > b.top) lo = b.top - STEP;
            uint128 liq = LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(lo + STEP), w.coins - used);
            if (liq > 0) _addRange(token, key, lo, lo + STEP, liq, hint);
        }
        uint256 burned = _buy(key, w.premium > CLOSE_DUST ? w.premium - CLOSE_DUST : 0);
        _settle(key.currency0);
        _settle(key.currency1);
        return abi.encode(burned);
    }

    function _keep(bytes memory p) internal returns (bytes memory) {
        (uint256 id, int24 hint) = abi.decode(p, (uint256, int24));
        Window storage w = windows[id];
        address token = w.token;
        PoolKey memory key = keyOf(token);
        (, int24 tick,,) = poolManager.getSlot0(key.toId());
        uint256 used;
        if (tick < w.bottom) {
            // the price never reached the hole: refill it and buy the window's coins back out of the pool with the
            // HYPE (its fee was paid at opening), so the pool is as after a plain buy and no hole is left above the
            // price. Buying the same coins from no higher than the hole never costs more than the window did.
            _refill(token, key, id, tick, true, hint);
            used = _buyExact(key, w.coins);
        } else {
            // the price is in or past the hole: the HYPE goes where a plain buy would have left it, into the parts
            // of the hole now below the price; whatever is left goes into the step just below the price, which is no
            // higher than the hole, so nobody can move this HYPE up by pushing the price first
            used = _refill(token, key, id, tick, false, hint);
        }
        if (used < w.spent) {
            int24 hi = _floorStep(tick);
            (, int24 now_,,) = poolManager.getSlot0(key.toId());
            if (_floorStep(now_) < hi) hi = _floorStep(now_);
            uint128 liq = LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(hi - STEP), TickMath.getSqrtPriceAtTick(hi), w.spent - used);
            if (liq > 0) _addRange(token, key, hi - STEP, hi, liq, hint);
        }
        uint256 burned = _buy(key, w.premium > CLOSE_DUST ? w.premium - CLOSE_DUST : 0);
        _settle(key.currency0);
        _settle(key.currency1);
        return abi.encode(burned, uint256(w.coins));
    }

    function _collect(bytes memory p) internal returns (bytes memory) {
        (address token, uint16 bps, address to, int24 at, uint256 maxSegments) = abi.decode(p, (address, uint16, address, int24, uint256));
        PoolKey memory key = keyOf(token);
        int24 top = books[token].top;
        for (uint256 n; n < maxSegments && at != top; n++) {
            Seg storage s = segs[token][at];
            uint128 out = uint128((uint256(s.liq) * bps) / BPS);
            if (out > 0) {
                s.liq -= out;
                _modify(key, at, s.next, -int256(uint256(out)));
            }
            at = s.next;
        }
        int256 c0 = poolManager.currencyDelta(address(this), key.currency0);
        int256 c1 = poolManager.currencyDelta(address(this), key.currency1);
        uint256 coins = c0 > 0 ? uint256(c0) : 0;
        uint256 w = c1 > 0 ? uint256(c1) : 0;
        if (coins > 0) poolManager.take(key.currency0, to, coins);
        if (w > 0) poolManager.take(key.currency1, to, w);
        return abi.encode(at, coins, w);
    }

    // ---------------------------------------------------------------------
    // Planning a window
    // ---------------------------------------------------------------------

    /// @dev The pieces of liquidity a window of `spend` takes: from the step above the price up, through as many
    ///      segments as it needs, whole steps then part of the last one.
    function _plan(address token, PoolKey memory key, uint256 spend, int24 hint) internal view returns (Piece[] memory ps) {
        (, int24 tick,,) = poolManager.getSlot0(key.toId());
        int24 start = _floorStep(tick) + STEP;
        Book storage b = books[token];
        if (start >= b.top) revert TooBig();
        int24 lo = _find(token, hint, start);
        Piece[] memory tmp = new Piece[](MAX_PIECES);
        uint256 n;
        uint256 left = spend;
        while (left > 0) {
            if (lo == b.top) revert TooBig();
            Seg storage s = segs[token][lo];
            int24 from = lo < start ? start : lo;
            if (s.liq > 0 && from < s.next) {
                if (n == MAX_PIECES) revert TooFragmented();
                uint160 sa = TickMath.getSqrtPriceAtTick(from);
                uint256 whole = SqrtPriceMath.getAmount1Delta(sa, TickMath.getSqrtPriceAtTick(s.next), s.liq, true);
                if (whole <= left) {
                    tmp[n++] = Piece(from, s.next, s.liq);
                    left -= whole;
                } else {
                    // ends inside this segment: whole steps up to `end`, then part of the step at `end`
                    uint160 target = sa + uint160(FullMath.mulDiv(left, FixedPoint96.Q96, s.liq));
                    int24 end = _floorStep(TickMath.getTickAtSqrtPrice(target));
                    if (end < from) end = from;
                    if (end > from) {
                        tmp[n++] = Piece(from, end, s.liq);
                        uint256 cost = SqrtPriceMath.getAmount1Delta(sa, TickMath.getSqrtPriceAtTick(end), s.liq, true);
                        left = cost < left ? left - cost : 0;
                    }
                    uint128 part = LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(end), TickMath.getSqrtPriceAtTick(end + STEP), left);
                    if (part >= s.liq) part = s.liq - 1;
                    if (part > 0) {
                        if (n == MAX_PIECES) revert TooFragmented();
                        tmp[n++] = Piece(end, end + STEP, part);
                    }
                    left = 0;
                }
            }
            lo = s.next;
        }
        if (n == 0) revert TooSmall();
        ps = new Piece[](n);
        for (uint256 i; i < n; i++) ps[i] = tmp[i];
    }

    // ---------------------------------------------------------------------
    // The liquidity list
    // ---------------------------------------------------------------------

    /// @dev The segment holding tick `t`, walking up from `hint` (a segment at or below `t`; else the floor).
    function _find(address token, int24 hint, int24 t) internal view returns (int24 lo) {
        Book storage b = books[token];
        if (t < b.head || t >= b.top) revert BadHint();
        lo = hint;
        if (!segs[token][lo].on || lo > t) lo = b.head;
        while (segs[token][lo].next <= t) lo = segs[token][lo].next;
    }

    /// @dev Make `lo` and `hi` segment boundaries (splitting the segments that hold them), extending the list below
    ///      the floor first if `lo` is under it.
    function _cut(address token, PoolKey memory key, int24 lo, int24 hi, int24 hint) internal {
        Book storage b = books[token];
        if (lo < b.head) {
            segs[token][lo] = Seg({on: true, next: b.head, prev: type(int24).min, liq: 0});
            segs[token][b.head].prev = lo;
            b.head = lo;
            b.segments++;
            hook.setFloor(token, TickMath.getSqrtPriceAtTick(lo));
            emit FloorLowered(token, lo);
        }
        int24 s = _find(token, hint, lo);
        if (s != lo) _split(token, key, s, lo);
        if (hi < b.top) {
            int24 t = _find(token, lo, hi);
            if (t != hi) _split(token, key, t, hi);
        }
    }

    /// @dev Split segment `lo` at `at` (inside it) into two segments with the same liquidity.
    function _split(address token, PoolKey memory key, int24 lo, int24 at) internal {
        Seg storage s = segs[token][lo];
        int24 hi = s.next;
        uint128 liq = s.liq;
        if (liq > 0) {
            _modify(key, lo, hi, -int256(uint256(liq)));
            _modify(key, lo, at, int256(uint256(liq)));
            _modify(key, at, hi, int256(uint256(liq)));
        }
        segs[token][at] = Seg({on: true, next: hi, prev: lo, liq: liq});
        s.next = at;
        if (hi != books[token].top) segs[token][hi].prev = at;
        books[token].segments++;
    }

    /// @dev Put a window's pieces back: with coins those wholly above the price (`coinSide`), or with HYPE those wholly
    ///      below it. Returns the coins (or HYPE) that took. Merges only at the outer edges of what was refilled.
    function _refill(address token, PoolKey memory key, uint256 id, int24 tick, bool coinSide, int24 hint) internal returns (uint256 used) {
        Window storage w = windows[id];
        int24 first = type(int24).max;
        int24 last = type(int24).min;
        for (uint256 i; i < w.pieces; i++) {
            Piece memory pc = pieces[id][i];
            if (coinSide ? pc.lo <= tick : pc.hi > tick) continue;
            _fill(token, key, pc.lo, pc.hi, pc.liq, hint);
            uint160 a = TickMath.getSqrtPriceAtTick(pc.lo);
            uint160 b = TickMath.getSqrtPriceAtTick(pc.hi);
            used += coinSide ? SqrtPriceMath.getAmount0Delta(a, b, pc.liq, true) : SqrtPriceMath.getAmount1Delta(a, b, pc.liq, true);
            if (pc.lo < first) first = pc.lo;
            if (pc.hi > last) last = pc.hi;
        }
        if (first != type(int24).max) _mergeEdges(token, key, first, last);
    }

    /// @dev Add `liq` across [lo, hi), then merge the edges with their neighbours where the liquidity matches.
    function _addRange(address token, PoolKey memory key, int24 lo, int24 hi, uint128 liq, int24 hint) internal {
        _fill(token, key, lo, hi, liq, hint);
        _mergeEdges(token, key, lo, hi);
    }

    function _fill(address token, PoolKey memory key, int24 lo, int24 hi, uint128 liq, int24 hint) internal {
        _cut(token, key, lo, hi, hint);
        int24 at = lo;
        while (at < hi) {
            Seg storage s = segs[token][at];
            s.liq += liq;
            _modify(key, at, s.next, int256(uint256(liq)));
            at = s.next;
        }
    }

    /// @dev Merge, across [lo, hi) and its two edges, every pair of neighbouring segments with the same liquidity.
    function _mergeEdges(address token, PoolKey memory key, int24 lo, int24 hi) internal {
        int24 top = books[token].top;
        int24 at = segs[token][lo].prev;
        if (at == type(int24).min) at = lo;
        while (at < hi) {
            int24 nxt = segs[token][at].next;
            if (nxt == top) break;
            if (segs[token][nxt].liq == segs[token][at].liq) {
                _merge(token, key, at);
                continue;
            }
            at = nxt;
        }
    }

    /// @dev Merge segment `lo` with the next one if they hold the same liquidity.
    function _merge(address token, PoolKey memory key, int24 lo) internal {
        Book storage b = books[token];
        Seg storage s = segs[token][lo];
        int24 mid = s.next;
        if (mid == b.top) return;
        Seg storage t = segs[token][mid];
        if (t.liq != s.liq) return;
        int24 hi = t.next;
        uint128 liq = s.liq;
        if (liq > 0) {
            _modify(key, lo, mid, -int256(uint256(liq)));
            _modify(key, mid, hi, -int256(uint256(liq)));
            _modify(key, lo, hi, int256(uint256(liq)));
        }
        s.next = hi;
        if (hi != b.top) segs[token][hi].prev = lo;
        delete segs[token][mid];
        b.segments--;
    }

    // ---------------------------------------------------------------------
    // Pool operations
    // ---------------------------------------------------------------------

    function _modify(PoolKey memory key, int24 lo, int24 hi, int256 delta) internal {
        poolManager.modifyLiquidity(key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: delta, salt: bytes32(0)}), "");
    }

    /// @dev Buy coins with `amount` WHYPE held here, fee-free (the hook does not charge this contract).
    function _buy(PoolKey memory key, uint256 amount) internal returns (uint256 out) {
        if (amount == 0) return 0;
        BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: false, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}), "");
        out = d.amount0() > 0 ? uint256(uint128(d.amount0())) : 0;
    }

    /// @dev Buy exactly `coins` with WHYPE held here, fee-free; returns the WHYPE paid.
    function _buyExact(PoolKey memory key, uint256 coins) internal returns (uint256 paid) {
        BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: false, amountSpecified: int256(coins), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}), "");
        paid = d.amount1() < 0 ? uint256(uint128(-d.amount1())) : 0;
    }

    /// @dev Close this contract's net position in `currency` with the PoolManager, from or to this contract.
    function _settle(Currency currency) internal returns (int256 d) {
        d = poolManager.currencyDelta(address(this), currency);
        if (d > 0) {
            poolManager.take(currency, address(this), uint256(d));
        } else if (d < 0) {
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), uint256(-d));
            poolManager.settle();
        }
    }

    function _checkHeld(address token) internal view {
        if (IERC20(token).balanceOf(address(this)) < heldCoins[token] || IERC20(whype).balanceOf(address(this)) < heldWhype) revert Insolvent();
    }

    function _sendHype(address to, uint256 amount) internal {
        IWindowWHYPE(whype).withdraw(amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) {
            IWindowWHYPE(whype).deposit{value: amount}();
            IERC20(whype).safeTransfer(to, amount);
        }
    }

    function _floorStep(int24 tick) internal pure returns (int24) {
        int24 q = tick / STEP;
        if (tick < 0 && tick % STEP != 0) q--;
        return q * STEP;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function keyOf(address token) public view returns (PoolKey memory) {
        return PoolKey({currency0: Currency.wrap(token), currency1: Currency.wrap(whype), fee: 0, tickSpacing: STEP, hooks: IHooks(address(hook))});
    }

    /// @notice The pool's price now.
    function priceOf(address token) external view returns (uint160 sqrtPriceX96, int24 tick) {
        (sqrtPriceX96, tick,,) = poolManager.getSlot0(keyOf(token).toId());
    }

    /// @notice The segment holding tick `t`: a good hint for {openWindow}, {undo} and {keep}.
    function segmentAt(address token, int24 t) external view returns (int24) {
        return _find(token, books[token].head, t);
    }

    /// @notice Up to `max` segments from `from` (the floor if below it): starts, ends and liquidity.
    function segmentsOf(address token, int24 from, uint256 max) external view returns (int24[] memory lo, int24[] memory hi, uint128[] memory liq) {
        Book storage b = books[token];
        if (from < b.head) from = b.head;
        lo = new int24[](max);
        hi = new int24[](max);
        liq = new uint128[](max);
        uint256 n;
        for (int24 at = from; n < max && at != b.top && segs[token][at].on; n++) {
            Seg storage s = segs[token][at];
            (lo[n], hi[n], liq[n]) = (at, s.next, s.liq);
            at = s.next;
        }
        assembly ("memory-safe") {
            mstore(lo, n)
            mstore(hi, n)
            mstore(liq, n)
        }
    }

    /// @notice The coins a window of `spend` would hold if opened now.
    function previewWindow(address token, uint256 spend, int24 hint) external view returns (uint256 coins) {
        PoolKey memory key = keyOf(token);
        Piece[] memory ps = _plan(token, key, spend, hint);
        for (uint256 i; i < ps.length; i++) {
            coins += SqrtPriceMath.getAmount0Delta(TickMath.getSqrtPriceAtTick(ps[i].lo), TickMath.getSqrtPriceAtTick(ps[i].hi), ps[i].liq, false);
        }
    }

    /// @notice A window's length for a premium, and the premium a length costs.
    function windowLength(uint256 spend, uint256 premium) public pure returns (uint256) {
        return (premium * 1 days * BPS) / (spend * DAY_RATE_BPS);
    }

    function premiumFor(uint256 spend, uint256 length) external pure returns (uint256) {
        return (spend * DAY_RATE_BPS * length + 1 days * BPS - 1) / (1 days * BPS);
    }

    function piecesOf(uint256 id) external view returns (Piece[] memory ps) {
        ps = new Piece[](windows[id].pieces);
        for (uint256 i; i < ps.length; i++) ps[i] = pieces[id][i];
    }
}
