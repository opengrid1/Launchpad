// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ICtrlzOracle} from "./ICtrlzOracle.sol";

interface ICtrlzBurnable {
    function burn(uint256 amount) external;
}

interface ICtrlzFeeRecipient {
    function feeRecipient() external view returns (address);
}

interface IWrappedNativeMinimal {
    function withdraw(uint256) external;
}

/// @title CtrlzHook
/// @notice The Uniswap V4 hook every cntrl-z pool shares. It owns all of a
///         coin's liquidity (the launch position and everything added later)
///         and runs the undo windows.
///
///         Every pool: coin = currency0, pair = currency1 (the deployer places
///         the coin below its pair). Buying pushes the price up; coins sit in
///         ranges above the price, the pair in ranges below.
///
///         Tax: 1% of the pair side of every swap, 0.7% to the creator, 0.3% to
///         the platform, held here as PoolManager claims until claimed.
///         Launch protection: buys in the first minute pay 90% falling to 1%,
///         and one swap per wallet (tx.origin) per pool per block.
///
///         Windows: a buyer rents a window of 30 minutes to 7 days for 0.05
///         ETH per six hours (in the pair token, at the oracle's rate), at most
///         30% of the buy. The hook takes the slice of liquidity the buy would
///         have consumed out of the pool (so the price is where it would have
///         been for the next trader) and holds the coins and the buyer's pair
///         here. Cancel, before expiry: the coins go back into the pool and
///         the whole buy comes back. Keep, or expiry: the coins go to the
///         buyer and the pair goes into the pool as liquidity. The premium is
///         always spent buying the coin and burning it.
///
///         Nobody but the hook adds or removes liquidity. After every window
///         action the hook checks it still holds every coin and every unit of
///         pair owed to open windows.
contract CtrlzHook is BaseHook, IUnlockCallback, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint16 public constant TAX_BPS = 100;
    uint16 public constant CREATOR_BPS = 70;
    uint16 public constant PLATFORM_BPS = 30;
    uint16 public constant SNIPE_BPS = 9_000;
    uint32 public constant SNIPE_SECS = 60;
    int24 public constant TICK_SPACING = 10;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    /// @notice Coins the factory leaves here at launch to absorb rounding in the book.
    uint256 public constant COIN_SLACK = 1e12;
    /// @notice Pair units kept from every window buy to absorb rounding in the book.
    uint256 public constant PAIR_SLACK = 1_000;

    uint256 public constant REF_PREMIUM = 0.05 ether;
    uint256 public constant BASE_WINDOW = 6 hours;
    uint256 public constant MIN_WINDOW = 30 minutes;
    uint256 public constant MAX_WINDOW = 7 days;
    uint256 public constant MAX_PREMIUM_BPS = 3_000;
    uint256 public constant MAX_SEGMENTS = 64;
    uint256 public constant MAX_TAKES = 6;

    bytes32 internal constant FEE_SLOT = keccak256("cntrlz.hook.fee");
    bytes32 internal constant PLAT_SLOT = keccak256("cntrlz.hook.platform");

    address public immutable deployer;
    address public immutable weth;
    ICtrlzOracle public immutable oracle;
    address public factory;

    struct PoolConfig {
        address token;
        address pair;
        address creator;
        uint8 pairDecimals;
        uint64 launchTime;
        bool registered;
    }

    /// @dev One V4 position the hook owns. Segments are sorted by `lower` and never overlap.
    struct Segment {
        int24 lower;
        int24 upper;
        uint128 liquidity;
    }

    struct Window {
        address owner;
        uint40 expiry;
        bool open;
        int24 cutLower;
        int24 cutUpper;
        uint256 cost;
        uint256 coins;
        uint256 premium;
    }

    /// @dev A planned slice: from a segment with these bounds and liquidity, the coins in [from, to].
    struct Take {
        int24 lower;
        int24 upper;
        uint128 liquidity;
        int24 from;
        int24 to;
    }

    mapping(PoolId => PoolConfig) internal _config;
    mapping(PoolId => Segment[]) internal _book;
    mapping(PoolId => Window[]) internal _windows;
    mapping(address token => PoolId) internal _poolOf;
    /// @notice Coins held here for open windows of a coin.
    mapping(address token => uint256) public heldCoins;
    /// @notice Pair units (cost + premium) held here for open windows, per pair token.
    mapping(address pair => uint256) public heldPair;
    /// @notice Tax waiting as PoolManager claims, per coin.
    mapping(address token => uint256) public creatorOwed;
    mapping(address token => uint256) public platformOwed;
    mapping(bytes32 => uint256) internal _lastSwap;

    event PoolRegistered(address indexed token, address indexed pair, PoolId indexed id, address creator);
    event FeeTaken(address indexed token, uint256 fee, uint16 bps);
    event FactorySet(address indexed factory);
    event WindowOpened(address indexed token, uint256 indexed id, address indexed owner, uint256 cost, uint256 coins, uint256 premium, uint256 expiry, int24 cutLower, int24 cutUpper);
    event WindowClosed(address indexed token, uint256 indexed id, address indexed owner, bool kept, uint256 burned);
    event Collected(address indexed token, uint256 coins, uint256 pair, address indexed to);
    event CreatorPaid(address indexed token, address indexed to, uint256 amount);
    event PlatformPaid(address indexed token, address indexed to, uint256 amount);

    error NotDeployer();
    error NotFactory();
    error AlreadySet();
    error ZeroAddress();
    error OneSwapPerBlock();
    error NotThisPool();
    error LiquidityIsLocked();
    error OnlyFactoryOpensPools();
    error NotSupported();
    error BadWindow();
    error PremiumTooHigh();
    error NothingToBuy();
    error TooFewCoins();
    error NoWindow();
    error NotOwner();
    error WindowExpired();
    error WindowStillOpen();
    error Insolvent();
    error BookFull();
    error InvalidParams();

    constructor(IPoolManager pm, address weth_, ICtrlzOracle oracle_) BaseHook(pm) {
        if (weth_ == address(0) || address(oracle_) == address(0)) revert ZeroAddress();
        deployer = tx.origin;
        weth = weth_;
        oracle = oracle_;
    }

    receive() external payable {}

    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.beforeAddLiquidity = true;
        p.beforeRemoveLiquidity = true;
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeDonate = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    // ---------------------------------------------------------------------
    // Launch: factory only
    // ---------------------------------------------------------------------

    /// @notice Register a freshly initialized pool and seed it with the whole
    ///         supply (already transferred here) as one position above the
    ///         start price. Factory only, once per pool.
    function registerPool(PoolKey calldata key, address token, address pair, address creator, int24 tickLower, int24 tickUpper) external {
        if (msg.sender != factory) revert NotFactory();
        if (Currency.unwrap(key.currency0) != token || Currency.unwrap(key.currency1) != pair) revert InvalidParams();
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (c.registered) revert AlreadySet();
        c.token = token;
        c.pair = pair;
        c.creator = creator;
        c.pairDecimals = IERC20Metadata(pair).decimals();
        c.launchTime = uint64(block.timestamp);
        c.registered = true;
        _poolOf[token] = id;
        uint256 coins = IERC20(token).balanceOf(address(this)) - heldCoins[token] - COIN_SLACK;
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), coins);
        poolManager.unlock(abi.encode(uint8(0), abi.encode(id, tickLower, tickUpper, liquidity)));
        emit PoolRegistered(token, pair, id, creator);
    }

    // ---------------------------------------------------------------------
    // Windows
    // ---------------------------------------------------------------------

    /// @notice Buy `token` with `pairIn` of its pair token (pulled from the
    ///         caller) and rent an undo window of `secs`. The premium comes off
    ///         the top, then the 1% tax, then the buy takes whole ticks of the
    ///         pool's liquidity until the money runs out; what's left comes
    ///         back to the caller. The coins and the buy wait here until
    ///         {cancel} or {keep}.
    function buy(address token, uint256 pairIn, uint32 secs, address recipient, uint256 minCoins)
        external
        nonReentrant
        returns (uint256 id, uint256 coins, uint256 cost, uint256 premium, uint256 refund)
    {
        PoolId pid = _poolOf[token];
        PoolConfig storage c = _config[pid];
        if (!c.registered) revert NotThisPool();
        if (recipient == address(0)) revert ZeroAddress();
        if (secs < MIN_WINDOW || secs > MAX_WINDOW) revert BadWindow();
        premium = premiumFor(token, secs);
        if (pairIn <= premium + PAIR_SLACK) revert NothingToBuy();
        IERC20(c.pair).safeTransferFrom(msg.sender, address(this), pairIn);

        uint16 taxBps = _buyTaxBps(pid, msg.sender);
        uint256 budget = Math.mulDiv(pairIn - premium - PAIR_SLACK, BPS, BPS + taxBps);
        (coins, cost) = abi.decode(poolManager.unlock(abi.encode(uint8(1), abi.encode(pid, budget))), (uint256, uint256));
        if (coins == 0 || cost == 0) revert NothingToBuy();
        if (coins < minCoins) revert TooFewCoins();
        if (premium * BPS > cost * MAX_PREMIUM_BPS) revert PremiumTooHigh();
        uint256 fee = (cost * taxBps) / BPS;
        refund = pairIn - premium - PAIR_SLACK - cost - fee;

        Window[] storage ws = _windows[pid];
        id = ws.length;
        (int24 cutLower, int24 cutUpper) = (_tget2(0), _tget2(1));
        ws.push(Window({owner: recipient, expiry: uint40(block.timestamp + secs), open: true, cutLower: cutLower, cutUpper: cutUpper, cost: cost, coins: coins, premium: premium}));
        heldCoins[token] += coins;
        heldPair[c.pair] += cost + premium;
        _bookFee(pid, fee);
        if (refund != 0) IERC20(c.pair).safeTransfer(msg.sender, refund);
        _checkSolvent(c);
        emit WindowOpened(token, id, recipient, cost, coins, premium, block.timestamp + secs, cutLower, cutUpper);
    }

    /// @notice Take the buy back. Owner only, before the window closes. The
    ///         coins go back into the pool and the whole buy comes back (as
    ///         ETH for a WETH pair). The premium is burned.
    function cancel(address token, uint256 id) external nonReentrant {
        PoolId pid = _poolOf[token];
        PoolConfig storage c = _config[pid];
        Window storage w = _window(pid, id);
        if (msg.sender != w.owner) revert NotOwner();
        if (block.timestamp >= w.expiry) revert WindowExpired();
        w.open = false;
        uint256 burned = abi.decode(poolManager.unlock(abi.encode(uint8(2), abi.encode(pid, id, false))), (uint256));
        heldCoins[token] -= w.coins;
        heldPair[c.pair] -= w.cost + w.premium;
        _payPair(c.pair, w.owner, w.cost);
        _checkSolvent(c);
        emit WindowClosed(token, id, w.owner, false, burned);
    }

    /// @notice Keep the coins. Owner any time; anyone once the window has
    ///         closed. The coins go to the owner, the buy goes into the pool as
    ///         liquidity, the premium is burned.
    function keep(address token, uint256 id) external nonReentrant {
        PoolId pid = _poolOf[token];
        PoolConfig storage c = _config[pid];
        Window storage w = _window(pid, id);
        if (msg.sender != w.owner && block.timestamp < w.expiry) revert WindowStillOpen();
        w.open = false;
        uint256 burned = abi.decode(poolManager.unlock(abi.encode(uint8(2), abi.encode(pid, id, true))), (uint256));
        heldCoins[token] -= w.coins;
        heldPair[c.pair] -= w.cost + w.premium;
        IERC20(token).safeTransfer(w.owner, w.coins);
        _checkSolvent(c);
        emit WindowClosed(token, id, w.owner, true, burned);
    }

    /// @notice The premium for a window of `secs` on `token`, in its pair token:
    ///         0.05 ETH per six hours, converted at the oracle's prices.
    function premiumFor(address token, uint256 secs) public view returns (uint256) {
        PoolConfig storage c = _config[_poolOf[token]];
        uint256 eth = Math.mulDiv(REF_PREMIUM, secs, BASE_WINDOW);
        if (c.pair == weth) return eth;
        uint256 ethUsd = oracle.price(weth);
        uint256 pairUsd = oracle.price(c.pair);
        if (ethUsd == 0 || pairUsd == 0) revert InvalidParams();
        return Math.mulDiv(eth, ethUsd * (10 ** c.pairDecimals), pairUsd * 1e18);
    }

    // ---------------------------------------------------------------------
    // Fees and admin (through the factory)
    // ---------------------------------------------------------------------

    /// @notice Pay the creator's tax share to them. Anyone.
    function payCreator(address token) external nonReentrant returns (uint256 amount) {
        PoolId pid = _poolOf[token];
        PoolConfig storage c = _config[pid];
        amount = creatorOwed[token];
        if (amount == 0) return 0;
        creatorOwed[token] = 0;
        poolManager.unlock(abi.encode(uint8(3), abi.encode(c.pair, c.creator, amount)));
        emit CreatorPaid(token, c.creator, amount);
    }

    /// @notice Pay the platform's tax share on `tokens` to the factory's fee recipient. Anyone.
    function pushPlatform(address[] calldata tokens) external nonReentrant {
        address to = ICtrlzFeeRecipient(factory).feeRecipient();
        for (uint256 i; i < tokens.length; i++) {
            PoolConfig storage c = _config[_poolOf[tokens[i]]];
            if (!c.registered) revert NotThisPool();
            uint256 amount = platformOwed[tokens[i]];
            if (amount == 0) continue;
            platformOwed[tokens[i]] = 0;
            poolManager.unlock(abi.encode(uint8(3), abi.encode(c.pair, to, amount)));
            emit PlatformPaid(tokens[i], to, amount);
        }
    }

    /// @notice Pull `bps` of every position the hook holds for `token` out of
    ///         the pool to `recipient`. Factory (admin) only. Coins and pair
    ///         held for open windows are never touched.
    function collect(address token, uint16 bps, address recipient) external nonReentrant returns (uint256 coins, uint256 pair) {
        if (msg.sender != factory) revert NotFactory();
        if (bps == 0 || bps > BPS || recipient == address(0)) revert InvalidParams();
        PoolId pid = _poolOf[token];
        PoolConfig storage c = _config[pid];
        if (!c.registered) revert NotThisPool();
        (coins, pair) = abi.decode(poolManager.unlock(abi.encode(uint8(4), abi.encode(pid, bps))), (uint256, uint256));
        if (coins != 0) IERC20(token).safeTransfer(recipient, coins);
        if (pair != 0) IERC20(c.pair).safeTransfer(recipient, pair);
        _checkSolvent(c);
        emit Collected(token, coins, pair, recipient);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function config(PoolId id) external view returns (PoolConfig memory) {
        return _config[id];
    }

    function poolOf(address token) external view returns (PoolId) {
        return _poolOf[token];
    }

    function book(address token) external view returns (Segment[] memory) {
        return _book[_poolOf[token]];
    }

    function windowCount(address token) external view returns (uint256) {
        return _windows[_poolOf[token]].length;
    }

    function windowAt(address token, uint256 id) external view returns (Window memory) {
        return _windows[_poolOf[token]][id];
    }

    /// @notice What a window buy of `pairIn` for `secs` would get right now.
    function quote(address token, uint256 pairIn, uint32 secs, address sender)
        external
        view
        returns (uint256 coins, uint256 cost, uint256 premium, uint256 fee, uint256 refund, bool ok)
    {
        PoolId pid = _poolOf[token];
        if (secs < MIN_WINDOW || secs > MAX_WINDOW) return (0, 0, 0, 0, 0, false);
        premium = premiumFor(token, secs);
        if (pairIn <= premium + PAIR_SLACK) return (0, 0, premium, 0, 0, false);
        uint16 taxBps = _buyTaxBps(pid, sender);
        uint256 budget = Math.mulDiv(pairIn - premium - PAIR_SLACK, BPS, BPS + taxBps);
        (Take[] memory takes, uint256 n, uint256 c_, uint256 k) = _plan(pid, budget);
        takes;
        n;
        coins = k;
        cost = c_;
        fee = (cost * taxBps) / BPS;
        refund = cost == 0 ? 0 : pairIn - premium - PAIR_SLACK - cost - fee;
        ok = coins != 0 && premium * BPS <= cost * MAX_PREMIUM_BPS;
    }

    /// @notice Tax bps a buy by `sender` pays now: 1%, or the launch-minute rate.
    function _buyTaxBps(PoolId id, address sender) internal view returns (uint16) {
        PoolConfig storage c = _config[id];
        if (sender == address(this)) return 0;
        if (sender == factory) return TAX_BPS;
        uint256 elapsed = block.timestamp - c.launchTime;
        if (elapsed >= SNIPE_SECS) return TAX_BPS;
        return uint16(SNIPE_BPS - ((SNIPE_BPS - TAX_BPS) * elapsed) / SNIPE_SECS);
    }

    // ---------------------------------------------------------------------
    // PoolManager callback: seed (0), open (1), close (2), pay claims (3), collect (4), book a fee (5)
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (action == 0) {
            (PoolId id, int24 lower, int24 upper, uint128 liquidity) = abi.decode(payload, (PoolId, int24, int24, uint128));
            _add(id, lower, upper, liquidity);
            _settleAll(id);
            return "";
        }
        if (action == 1) {
            (PoolId id, uint256 budget) = abi.decode(payload, (PoolId, uint256));
            return _open(id, budget);
        }
        if (action == 2) {
            (PoolId id, uint256 wid, bool keepIt) = abi.decode(payload, (PoolId, uint256, bool));
            return abi.encode(_close(id, wid, keepIt));
        }
        if (action == 3) {
            (address pair, address to, uint256 amount) = abi.decode(payload, (address, address, uint256));
            Currency cur = Currency.wrap(pair);
            poolManager.burn(address(this), cur.toId(), amount);
            poolManager.take(cur, address(this), amount);
            _payPair(pair, to, amount);
            return "";
        }
        if (action == 4) {
            (PoolId cid, uint16 bps) = abi.decode(payload, (PoolId, uint16));
            return _collect(cid, bps);
        }
        // 5: deposit a window buy's tax and hold it as claims, like swap fees
        (address feePair, uint256 feeAmount) = abi.decode(payload, (address, uint256));
        Currency fc = Currency.wrap(feePair);
        poolManager.sync(fc);
        IERC20(feePair).safeTransfer(address(poolManager), feeAmount);
        poolManager.settle();
        poolManager.mint(address(this), fc.toId(), feeAmount);
        return "";
    }

    /// @dev Carve the slice a buy of `budget` would consume and hold the coins. Returns (coins, cost).
    function _open(PoolId id, uint256 budget) internal returns (bytes memory) {
        (Take[] memory takes, uint256 n, uint256 cost, uint256 coins) = _plan(id, budget);
        if (n == 0) return abi.encode(uint256(0), uint256(0));
        if (_book[id].length + n > MAX_SEGMENTS) revert BookFull();
        int24 cutLower = takes[0].from;
        int24 cutUpper = takes[n - 1].to;
        for (uint256 i; i < n; i++) {
            Take memory t = takes[i];
            _removeExact(id, t.lower, t.upper);
            if (t.from > t.lower) _add(id, t.lower, t.from, t.liquidity);
            if (t.upper > t.to) _add(id, t.to, t.upper, t.liquidity);
        }
        _settleAll(id);
        _tset2(0, cutLower);
        _tset2(1, cutUpper);
        return abi.encode(coins, cost);
    }

    /// @dev Walk the coin-side segments upward from the current price and plan
    ///      whole ticks of liquidity worth at most `budget` of the pair.
    function _plan(PoolId id, uint256 budget) internal view returns (Take[] memory takes, uint256 n, uint256 cost, uint256 coins) {
        takes = new Take[](MAX_TAKES);
        (uint160 sqrtP, int24 tick,,) = poolManager.getSlot0(id);
        // the first aligned tick at or above the price; strictly above unless the price sits exactly on it
        int24 start = _alignUp(tick);
        if (TickMath.getSqrtPriceAtTick(start) < sqrtP) start += TICK_SPACING;
        uint256 left = budget;
        Segment[] storage b = _book[id];
        for (uint256 i; i < b.length && n < MAX_TAKES && left != 0; i++) {
            Segment memory s = b[i];
            if (s.upper <= start) continue;
            int24 from = s.lower > start ? s.lower : start;
            uint160 sa = TickMath.getSqrtPriceAtTick(from);
            uint160 sb = TickMath.getSqrtPriceAtTick(s.upper);
            uint256 full = SqrtPriceMath.getAmount1Delta(sa, sb, s.liquidity, true);
            int24 to = s.upper;
            bool whole = true;
            if (full > left) {
                whole = false;
                uint160 next = SqrtPriceMath.getNextSqrtPriceFromInput(sa, s.liquidity, left, false);
                if (next > sb) next = sb;
                to = _alignDown(TickMath.getTickAtSqrtPrice(next));
                while (to > from && SqrtPriceMath.getAmount1Delta(sa, TickMath.getSqrtPriceAtTick(to), s.liquidity, true) > left) to -= TICK_SPACING;
                if (to <= from) break;
            }
            uint160 st = TickMath.getSqrtPriceAtTick(to);
            uint256 c_ = whole ? full : SqrtPriceMath.getAmount1Delta(sa, st, s.liquidity, true);
            uint256 k = SqrtPriceMath.getAmount0Delta(sa, st, s.liquidity, false);
            if (k == 0) break;
            takes[n++] = Take({lower: s.lower, upper: s.upper, liquidity: s.liquidity, from: from, to: to});
            left -= c_;
            cost += c_;
            coins += k;
            if (!whole) break;
            start = s.upper;
        }
    }

    /// @dev Close window `wid`: cancel (coins back into the pool) or keep (the pair into the pool).
    ///      Either way the premium buys coins from the pool, which are burned. Returns coins burned.
    function _close(PoolId id, uint256 wid, bool keepIt) internal returns (uint256 burned) {
        PoolConfig storage c = _config[id];
        Window storage w = _windows[id][wid];
        (uint160 sqrtP, int24 tick,,) = poolManager.getSlot0(id);
        if (keepIt) {
            _addPairBelow(id, tick, w.cost, w.cutUpper - w.cutLower);
        } else if (TickMath.getSqrtPriceAtTick(w.cutLower) >= sqrtP && _free(id, w.cutLower, w.cutUpper)) {
            _add(id, w.cutLower, w.cutUpper, LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(w.cutLower), TickMath.getSqrtPriceAtTick(w.cutUpper), w.coins));
        } else {
            _addCoinsAbove(id, tick, w.coins);
        }
        // the premium buys the coin from its own pool and the coins are burned
        if (w.premium != 0) {
            PoolKey memory key = _keyOf(c);
            BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: false, amountSpecified: -int256(w.premium), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}), "");
            burned = d.amount0() > 0 ? uint256(uint128(d.amount0())) : 0;
        }
        _settleAll(id);
        if (burned != 0) ICtrlzBurnable(c.token).burn(burned);
    }

    /// @dev Admin collect: `bps` of every segment's liquidity, to the hook. Returns (coins, pair) taken.
    function _collect(PoolId id, uint16 bps) internal returns (bytes memory) {
        Segment[] storage b = _book[id];
        PoolConfig storage c = _config[id];
        uint256 coinsBefore = IERC20(c.token).balanceOf(address(this));
        uint256 pairBefore = IERC20(c.pair).balanceOf(address(this));
        for (uint256 i; i < b.length; i++) {
            uint128 part = uint128((uint256(b[i].liquidity) * bps) / BPS);
            if (part == 0) continue;
            _modify(id, b[i].lower, b[i].upper, -int256(uint256(part)));
            b[i].liquidity -= part;
        }
        _settleAll(id);
        return abi.encode(IERC20(c.token).balanceOf(address(this)) - coinsBefore, IERC20(c.pair).balanceOf(address(this)) - pairBefore);
    }

    // ---------------------------------------------------------------------
    // The liquidity book
    // ---------------------------------------------------------------------

    /// @dev Add `liquidity` over [lower, upper]: onto the segment with exactly
    ///      those bounds, or as a new segment in order. Never overlaps.
    function _add(PoolId id, int24 lower, int24 upper, uint128 liquidity) internal {
        if (liquidity == 0 || lower >= upper) return;
        Segment[] storage b = _book[id];
        uint256 n = b.length;
        uint256 at = n;
        for (uint256 i; i < n; i++) {
            if (b[i].lower == lower && b[i].upper == upper) {
                b[i].liquidity += liquidity;
                _modify(id, lower, upper, int256(uint256(liquidity)));
                return;
            }
            if (b[i].lower > lower && at == n) at = i;
        }
        if (n + 1 > MAX_SEGMENTS) revert BookFull();
        b.push(Segment({lower: 0, upper: 0, liquidity: 0}));
        for (uint256 i = n; i > at; i--) b[i] = b[i - 1];
        b[at] = Segment({lower: lower, upper: upper, liquidity: liquidity});
        _modify(id, lower, upper, int256(uint256(liquidity)));
    }

    /// @dev Remove the whole segment with these bounds.
    function _removeExact(PoolId id, int24 lower, int24 upper) internal {
        Segment[] storage b = _book[id];
        uint256 n = b.length;
        for (uint256 i; i < n; i++) {
            if (b[i].lower == lower && b[i].upper == upper) {
                _modify(id, lower, upper, -int256(uint256(b[i].liquidity)));
                for (uint256 j = i; j + 1 < n; j++) b[j] = b[j + 1];
                b.pop();
                return;
            }
        }
        revert InvalidParams();
    }

    /// @dev True when no segment overlaps [lower, upper] (an exact match counts as free: it merges).
    function _free(PoolId id, int24 lower, int24 upper) internal view returns (bool) {
        Segment[] storage b = _book[id];
        for (uint256 i; i < b.length; i++) {
            if (b[i].lower == lower && b[i].upper == upper) return true;
            if (b[i].lower < upper && b[i].upper > lower) return false;
        }
        return true;
    }

    /// @dev Put `pair` into the pool as liquidity entirely below the price: onto the
    ///      topmost pair-only segment, or a new one just under everything that spans the price.
    function _addPairBelow(PoolId id, int24 tick, uint256 pair, int24 width) internal {
        Segment[] storage b = _book[id];
        int24 top = type(int24).min;
        uint256 at = type(uint256).max;
        int24 lowest = _alignDown(tick);
        for (uint256 i; i < b.length; i++) {
            if (b[i].upper <= tick) {
                if (b[i].upper > top) {
                    top = b[i].upper;
                    at = i;
                }
            } else if (b[i].lower <= tick && b[i].lower < lowest) {
                lowest = b[i].lower;
            }
        }
        if (at != type(uint256).max) {
            Segment memory s = b[at];
            uint128 l = LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(s.lower), TickMath.getSqrtPriceAtTick(s.upper), pair);
            _add(id, s.lower, s.upper, l);
            return;
        }
        if (width < TICK_SPACING) width = TICK_SPACING;
        int24 lower = lowest - width;
        int24 minTick = _alignUp(TickMath.MIN_TICK);
        if (lower < minTick) lower = minTick;
        if (lower >= lowest) revert InvalidParams();
        _add(id, lower, lowest, LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(lowest), pair));
    }

    /// @dev Put `coins` into the pool as liquidity entirely above the price: onto the
    ///      lowest coin-only segment, or by splitting the segment that spans the price.
    function _addCoinsAbove(PoolId id, int24 tick, uint256 coins) internal {
        Segment[] storage b = _book[id];
        uint256 at = type(uint256).max;
        uint256 span = type(uint256).max;
        for (uint256 i; i < b.length; i++) {
            if (b[i].lower > tick) {
                if (at == type(uint256).max || b[i].lower < b[at].lower) at = i;
            } else if (b[i].upper > tick) {
                span = i;
            }
        }
        if (at != type(uint256).max) {
            Segment memory s = b[at];
            _add(id, s.lower, s.upper, LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(s.lower), TickMath.getSqrtPriceAtTick(s.upper), coins));
            return;
        }
        if (span == type(uint256).max) revert InvalidParams();
        // split the spanning segment at the first aligned tick above the price; the upper piece gets the coins
        Segment memory sp = b[span];
        int24 u = _alignUp(tick + 1);
        if (u >= sp.upper) revert InvalidParams();
        _removeExact(id, sp.lower, sp.upper);
        _add(id, sp.lower, u, sp.liquidity);
        _add(id, u, sp.upper, sp.liquidity + LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(u), TickMath.getSqrtPriceAtTick(sp.upper), coins));
    }

    function _modify(PoolId id, int24 lower, int24 upper, int256 delta) internal {
        poolManager.modifyLiquidity(_keyOf(_config[id]), ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: delta, salt: bytes32(0)}), "");
    }

    /// @dev Pay what the hook owes the PoolManager and take what it is owed, both currencies.
    function _settleAll(PoolId id) internal {
        PoolConfig storage c = _config[id];
        _settleOne(Currency.wrap(c.token), c.token);
        _settleOne(Currency.wrap(c.pair), c.pair);
    }

    function _settleOne(Currency cur, address erc) internal {
        int256 d = poolManager.currencyDelta(address(this), cur);
        if (d < 0) {
            poolManager.sync(cur);
            IERC20(erc).safeTransfer(address(poolManager), uint256(-d));
            poolManager.settle();
        } else if (d > 0) {
            poolManager.take(cur, address(this), uint256(d));
        }
    }

    function _keyOf(PoolConfig storage c) internal view returns (PoolKey memory) {
        return PoolKey({currency0: Currency.wrap(c.token), currency1: Currency.wrap(c.pair), fee: 0, tickSpacing: TICK_SPACING, hooks: this});
    }

    function _window(PoolId id, uint256 wid) internal view returns (Window storage w) {
        Window[] storage ws = _windows[id];
        if (wid >= ws.length) revert NoWindow();
        w = ws[wid];
        if (!w.open) revert NoWindow();
    }

    /// @dev Deposit a window buy's tax into the PoolManager and hold it as claims, like swap fees.
    function _bookFee(PoolId id, uint256 fee) internal {
        if (fee == 0) return;
        PoolConfig storage c = _config[id];
        poolManager.unlock(abi.encode(uint8(5), abi.encode(c.pair, fee)));
        _credit(c.token, fee);
    }

    function _credit(address token, uint256 fee) internal {
        uint256 plat = (fee * PLATFORM_BPS) / TAX_BPS;
        platformOwed[token] += plat;
        creatorOwed[token] += fee - plat;
    }

    function _payPair(address pair, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (pair == weth) {
            IWrappedNativeMinimal(weth).withdraw(amount);
            (bool ok,) = to.call{value: amount}("");
            if (!ok) {
                // a contract that refuses ETH gets WETH instead
                IERC20(weth).safeTransfer(to, amount);
            }
        } else {
            IERC20(pair).safeTransfer(to, amount);
        }
    }

    function _checkSolvent(PoolConfig storage c) internal view {
        if (IERC20(c.token).balanceOf(address(this)) < heldCoins[c.token] || IERC20(c.pair).balanceOf(address(this)) < heldPair[c.pair]) revert Insolvent();
    }

    function _alignDown(int24 t) internal pure returns (int24) {
        int24 r = t % TICK_SPACING;
        if (r < 0) r += TICK_SPACING;
        return t - r;
    }

    function _alignUp(int24 t) internal pure returns (int24) {
        int24 d = _alignDown(t);
        return d == t ? t : d + TICK_SPACING;
    }

    // ---------------------------------------------------------------------
    // Pool hooks
    // ---------------------------------------------------------------------

    function _beforeInitialize(address sender, PoolKey calldata, uint160) internal view override returns (bytes4) {
        if (sender != factory) revert OnlyFactoryOpensPools();
        return BaseHook.beforeInitialize.selector;
    }

    function _beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata) internal view override returns (bytes4) {
        if (sender != address(this)) revert LiquidityIsLocked();
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _beforeRemoveLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata) internal view override returns (bytes4) {
        if (sender != address(this)) revert LiquidityIsLocked();
        return BaseHook.beforeRemoveLiquidity.selector;
    }

    function _beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) internal pure override returns (bytes4) {
        revert NotSupported();
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (!c.registered) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        if (sender != address(this) && sender != factory) {
            bytes32 k = keccak256(abi.encode(id, tx.origin));
            if (_lastSwap[k] == block.number) revert OneSwapPerBlock();
            _lastSwap[k] = block.number;
        }
        if (!_specifiedIsPair(params)) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint16 bps = _swapTaxBps(id, sender, !params.zeroForOne);
        uint256 fee = (amount * bps) / BPS;
        _tset(FEE_SLOT, fee);
        _tset(PLAT_SLOT, bps);
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (!c.registered) return (BaseHook.afterSwap.selector, 0);
        // official-pool allowance for the coin's PoolManager transfers in this transaction
        int128 coinDelta = delta.amount0();
        if (coinDelta < 0) _allow(c.token, true, uint256(uint128(-coinDelta)));
        else if (coinDelta > 0) _allow(c.token, false, uint256(uint128(coinDelta)));

        uint256 fee;
        uint16 bps;
        int128 ret = 0;
        if (_specifiedIsPair(params)) {
            fee = _tget(FEE_SLOT);
            bps = uint16(_tget(PLAT_SLOT));
            _tset(FEE_SLOT, 0);
            _tset(PLAT_SLOT, 0);
        } else {
            int128 unspecified = delta.amount1();
            uint256 amount = unspecified < 0 ? uint256(uint128(-unspecified)) : uint256(uint128(unspecified));
            bps = _swapTaxBps(id, sender, !params.zeroForOne);
            fee = (amount * bps) / BPS;
            ret = int128(int256(fee));
        }
        if (fee == 0) return (BaseHook.afterSwap.selector, ret);
        poolManager.mint(address(this), key.currency1.toId(), fee);
        _credit(c.token, fee);
        emit FeeTaken(c.token, fee, bps);
        return (BaseHook.afterSwap.selector, ret);
    }

    function _swapTaxBps(PoolId id, address sender, bool isBuy) internal view returns (uint16) {
        if (sender == address(this)) return 0;
        if (!isBuy) return TAX_BPS;
        return _buyTaxBps(id, sender);
    }

    /// @dev Pair is always currency1.
    function _specifiedIsPair(SwapParams calldata params) internal pure returns (bool) {
        bool exactInput = params.amountSpecified < 0;
        bool specifiedIsCurrency0 = exactInput ? params.zeroForOne : !params.zeroForOne;
        return !specifiedIsCurrency0;
    }

    /// @notice Called by a cntrl-z coin when it moves to (`intoPool`) or from the
    ///         PoolManager: spends the allowance its own pool's swaps granted in
    ///         this transaction, and reverts when there isn't one.
    function spend(bool intoPool, uint256 amount) external {
        if (!_config[_poolOf[msg.sender]].registered) revert NotThisPool();
        bytes32 slot = keccak256(abi.encode(intoPool, msg.sender, FEE_SLOT));
        uint256 a;
        assembly ("memory-safe") { a := tload(slot) }
        if (a < amount) revert NotThisPool();
        assembly ("memory-safe") { tstore(slot, sub(a, amount)) }
    }

    function _allow(address token, bool intoPool, uint256 amount) internal {
        bytes32 slot = keccak256(abi.encode(intoPool, token, FEE_SLOT));
        assembly ("memory-safe") { tstore(slot, add(tload(slot), amount)) }
    }

    function _tset(bytes32 s, uint256 v) internal {
        assembly ("memory-safe") { tstore(s, v) }
    }

    function _tget(bytes32 s) internal view returns (uint256 v) {
        assembly ("memory-safe") { v := tload(s) }
    }

    function _tset2(uint256 i, int24 v) internal {
        bytes32 s = keccak256(abi.encode("cntrlz.cut", i));
        assembly ("memory-safe") { tstore(s, v) }
    }

    function _tget2(uint256 i) internal view returns (int24 v) {
        bytes32 s = keccak256(abi.encode("cntrlz.cut", i));
        assembly ("memory-safe") { v := tload(s) }
    }
}
