// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IBackstopStrategyTax {
    /// @dev Tax arrived; `platformCut` of it is the platform's exact 1% of the trades.
    function onTax(uint256 platformCut) external;
}

/// @title BackstopHook
/// @notice The Uniswap V4 hook every Backstop pool shares. Per pool, fixed at
///         launch:
///
///         - Tax: a fixed share of the PAIR side of every swap (1% to 10%),
///           taken whichever way the trade goes and sent to the coin's
///           strategy contract, which splits it.
///         - Dynamic tax (optional): trades that would move the price about 5%
///           pay up to a higher cap, scaled by the trade's size against the
///           pool's in-range depth; never above 10%.
///         - Anti-snipe (optional): buys pay a heavy tax at open that falls in
///           a straight line to the normal tax over the window.
///         - Anti-MEV (optional): one swap per tx.origin per pool per block.
///         - Max per trade (optional): no swap may move more than a share of
///           the supply.
///
///         The hook also keeps a 30-minute time-weighted tick per pool, which
///         the coin's strategy reads to detect 20% dips.
///
///         The coin's own strategy contract (buybacks, burns, liquidity) and
///         the factory (the creator's first buy) are exempt from the
///         protections; the strategy pays no tax on its own swaps.
///
///         Official pool only. A swap in a Backstop pool grants the coin a
///         one-transaction allowance, exactly the coins that swap moves, to go
///         into or out of the PoolManager; the coin refuses any other transfer
///         to or from it. So the coin can't be deposited as liquidity into
///         someone else's V4 pool (the kind of look-alike pairs scanners pick
///         up), only traded through its own pool.
///
///         One setter exists: wiring the factory, once, at deployment.
contract BackstopHook is BaseHook, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    uint16 internal constant BPS = 10_000;
    /// @notice The platform's share of every trade, whatever the tax.
    uint16 public constant PLATFORM_BPS = 100;
    uint16 public constant MAX_TAX_BPS = 1_000;
    uint16 public constant MAX_SNIPE_BPS = 9_900;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    /// @dev Dynamic tax reaches its cap when a trade's pair amount equals this
    ///      share of the pool's virtual pair reserve (~ a 5% price move).
    uint256 internal constant DYN_FULL_BPS = 247;
    uint32 internal constant OBS_EVERY = 300;
    uint8 internal constant OBS_SLOTS = 8;
    /// @dev Transient slots for the fee and platform cut computed in beforeSwap, reused in afterSwap.
    bytes32 internal constant FEE_SLOT = keccak256("backstop.hook.fee");
    bytes32 internal constant PLAT_SLOT = keccak256("backstop.hook.platform");

    address public immutable deployer;
    address public factory;

    struct Rules {
        uint16 taxBps;
        uint16 dynMaxBps; // 0 = off
        uint16 snipeBps; // 0 = off
        uint16 snipeSecs;
        uint16 maxTxBps; // 0 = off
        bool mev;
    }

    struct PoolConfig {
        address token;
        address pair;
        address strategy;
        Rules rules;
        bool pairIsCurrency0;
        uint64 launchTime;
        bool registered;
    }

    /// @dev Running tick accumulator, and a ring of snapshots every OBS_EVERY seconds.
    struct Acc {
        int56 cum;
        int24 lastTick;
        uint32 lastTime;
        uint8 idx;
    }
    struct Obs {
        uint32 time;
        int56 cum;
    }

    mapping(PoolId => PoolConfig) internal _config;
    mapping(PoolId => Acc) internal _acc;
    mapping(PoolId => Obs[OBS_SLOTS]) internal _obs;
    /// @notice Strategy contract of each coin registered here.
    mapping(address token => address) public strategyOf;
    /// @notice Fees taken for a coin but still held here as V4 claims, and the platform's part of them.
    mapping(address token => uint256) public owed;
    mapping(address token => uint256) public owedPlatform;
    mapping(address token => PoolId) internal _poolOf;
    /// @dev Anti-MEV: last block a tx.origin swapped in a pool.
    mapping(bytes32 => uint256) internal _lastSwap;

    event PoolRegistered(address indexed token, address indexed pair, PoolId indexed id, address strategy, Rules rules);
    event FeeTaken(address indexed token, uint256 fee, uint16 bps);
    event FactorySet(address indexed factory);
    event FeeHeld(address indexed token, uint256 amount);
    event FeeDelivered(address indexed token, uint256 amount);

    error NotDeployer();
    error NotFactory();
    error AlreadySet();
    error ZeroAddress();
    error BadRules();
    error OneSwapPerBlock();
    error MaxTx();
    error NotThisPool();

    constructor(IPoolManager pm) BaseHook(pm) {
        deployer = tx.origin;
    }

    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    /// @notice Register a freshly launched pool with its fixed rules. Factory only, once per pool.
    function registerPool(PoolKey calldata key, address token, address pair, address strategy, Rules calldata r) external {
        if (msg.sender != factory) revert NotFactory();
        if (r.taxBps == 0 || r.taxBps > MAX_TAX_BPS) revert BadRules();
        if (r.dynMaxBps != 0 && (r.dynMaxBps <= r.taxBps || r.dynMaxBps > MAX_TAX_BPS)) revert BadRules();
        if (r.snipeBps != 0 && (r.snipeBps <= r.taxBps || r.snipeBps > MAX_SNIPE_BPS || r.snipeSecs == 0)) revert BadRules();
        if (r.maxTxBps > BPS) revert BadRules();
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (c.registered) revert AlreadySet();
        c.token = token;
        c.pair = pair;
        c.strategy = strategy;
        c.rules = r;
        c.pairIsCurrency0 = Currency.unwrap(key.currency0) == pair;
        c.launchTime = uint64(block.timestamp);
        c.registered = true;
        strategyOf[token] = strategy;
        _poolOf[token] = id;
        (, int24 tick,,) = poolManager.getSlot0(id);
        _acc[id] = Acc({cum: 0, lastTick: tick, lastTime: uint32(block.timestamp), idx: 0});
        _obs[id][0] = Obs({time: uint32(block.timestamp), cum: 0});
        emit PoolRegistered(token, pair, id, strategy, r);
    }

    /// @notice Deliver fees still held here as claims to the coin's strategy. Anyone.
    ///         When the strategy itself calls, it is told the platform cut in
    ///         the return value instead of through {onTax}.
    function flush(address token) external returns (uint256 amount, uint256 platformCut) {
        amount = owed[token];
        if (amount == 0) return (0, 0);
        platformCut = owedPlatform[token];
        owedPlatform[token] = 0;
        poolManager.unlock(abi.encode(token, amount));
        address s = strategyOf[token];
        if (msg.sender != s) {
            try IBackstopStrategyTax(s).onTax(platformCut) {} catch {}
            platformCut = 0;
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address token, uint256 amount) = abi.decode(data, (address, uint256));
        PoolConfig storage c = _config[_idOf(token)];
        Currency cur = Currency.wrap(c.pair);
        owed[token] = 0;
        poolManager.burn(address(this), cur.toId(), amount);
        poolManager.take(cur, c.strategy, amount);
        emit FeeDelivered(token, amount);
        return "";
    }

    function _idOf(address token) internal view returns (PoolId) {
        return _poolOf[token];
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

    /// @notice Time-weighted tick over at least `window` seconds (Uniswap's
    ///         raw tick, currency1 per currency0). `ok` is false until the pool
    ///         has a snapshot that old.
    function twapTick(PoolId id, uint32 window) external view returns (bool ok, int24 tick) {
        Acc memory a = _acc[id];
        if (a.lastTime == 0) return (false, 0);
        int56 cumNow = a.cum + int56(a.lastTick) * int56(uint56(block.timestamp - a.lastTime));
        Obs[OBS_SLOTS] storage ring = _obs[id];
        uint32 best;
        int56 bestCum;
        for (uint256 i; i < OBS_SLOTS; i++) {
            Obs memory o = ring[i];
            if (o.time != 0 && o.time + window <= block.timestamp && o.time > best) {
                best = o.time;
                bestCum = o.cum;
            }
        }
        if (best == 0) return (false, 0);
        int56 dt = int56(uint56(block.timestamp - best));
        int56 d = cumNow - bestCum;
        tick = int24(d / dt);
        if (d < 0 && d % dt != 0) tick--;
        ok = true;
    }

    /// @notice Tax bps a swap by `sender` of `pairAmount` (the pair side) would pay now.
    function taxBpsFor(PoolId id, address sender, bool isBuy, uint256 pairAmount) public view returns (uint16) {
        PoolConfig storage c = _config[id];
        if (sender == c.strategy) return 0;
        Rules memory r = c.rules;
        uint256 bps = r.taxBps;
        if (sender == factory) return r.taxBps;
        if (r.dynMaxBps != 0) {
            uint256 full = Math.mulDiv(_pairReserve(id, c.pairIsCurrency0), DYN_FULL_BPS, BPS);
            uint256 extra = full == 0 || pairAmount >= full ? uint256(r.dynMaxBps - r.taxBps) : Math.mulDiv(r.dynMaxBps - r.taxBps, pairAmount, full);
            bps += extra;
        }
        if (isBuy && r.snipeBps != 0) {
            uint256 elapsed = block.timestamp - c.launchTime;
            if (elapsed < r.snipeSecs) {
                uint256 span = uint256(r.snipeBps) - r.taxBps;
                uint256 s = r.snipeBps - (span * elapsed) / r.snipeSecs;
                if (s > bps) bps = s;
            }
        }
        return uint16(bps);
    }

    // ---------------------------------------------------------------------
    // Swap hooks
    // ---------------------------------------------------------------------

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (!c.registered) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        if (c.rules.mev && sender != c.strategy && sender != factory) {
            bytes32 k = keccak256(abi.encode(id, tx.origin));
            if (_lastSwap[k] == block.number) revert OneSwapPerBlock();
            _lastSwap[k] = block.number;
        }
        if (!_specifiedIsPair(c, params)) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint16 bps = taxBpsFor(id, sender, params.zeroForOne == c.pairIsCurrency0, amount);
        uint256 fee = (amount * bps) / BPS;
        _tset(FEE_SLOT, fee);
        _tset(PLAT_SLOT, fee == 0 ? 0 : (amount * PLATFORM_BPS) / BPS);
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
        _observe(id);
        bool exempt = sender == c.strategy || sender == factory;
        if (c.rules.maxTxBps != 0 && !exempt) {
            int128 coin = c.pairIsCurrency0 ? delta.amount1() : delta.amount0();
            uint256 moved = coin < 0 ? uint256(uint128(-coin)) : uint256(uint128(coin));
            if (moved > (SUPPLY * c.rules.maxTxBps) / BPS) revert MaxTx();
        }
        bool isBuy = params.zeroForOne == c.pairIsCurrency0;
        {
            // official-pool allowance for the coin's PoolManager transfers in this transaction
            int128 coinDelta = c.pairIsCurrency0 ? delta.amount1() : delta.amount0();
            if (coinDelta < 0) _allow(c.token, true, uint256(uint128(-coinDelta)));
            else if (coinDelta > 0) _allow(c.token, false, uint256(uint128(coinDelta)));
        }

        uint256 fee;
        uint256 plat;
        int128 ret = 0;
        uint16 bps;
        if (_specifiedIsPair(c, params)) {
            fee = _tget(FEE_SLOT);
            plat = _tget(PLAT_SLOT);
            _tset(FEE_SLOT, 0);
            _tset(PLAT_SLOT, 0);
        } else {
            int128 unspecified = c.pairIsCurrency0 ? delta.amount0() : delta.amount1();
            uint256 amount = unspecified < 0 ? uint256(uint128(-unspecified)) : uint256(uint128(unspecified));
            bps = taxBpsFor(id, sender, isBuy, amount);
            fee = (amount * bps) / BPS;
            plat = fee == 0 ? 0 : (amount * PLATFORM_BPS) / BPS;
            ret = int128(int256(fee));
        }
        if (fee == 0) return (BaseHook.afterSwap.selector, ret);
        if (plat > fee) plat = fee;

        Currency pairCurrency = c.pairIsCurrency0 ? key.currency0 : key.currency1;
        uint256 heldPlat = owedPlatform[c.token];
        if (_deliver(pairCurrency, c.token, c.strategy, fee)) {
            owedPlatform[c.token] = 0;
            try IBackstopStrategyTax(c.strategy).onTax(heldPlat + plat) {} catch {}
        } else {
            owedPlatform[c.token] = heldPlat + plat;
        }
        emit FeeTaken(c.token, fee, bps);
        return (BaseHook.afterSwap.selector, ret);
    }

    /// @dev Fold the tick that held since the last swap into the accumulator,
    ///      record the tick after this swap, and snapshot every OBS_EVERY seconds.
    function _observe(PoolId id) internal {
        Acc storage a = _acc[id];
        uint32 nowTs = uint32(block.timestamp);
        if (nowTs != a.lastTime) {
            a.cum += int56(a.lastTick) * int56(uint56(nowTs - a.lastTime));
            a.lastTime = nowTs;
        }
        (, int24 tick,,) = poolManager.getSlot0(id);
        a.lastTick = tick;
        Obs[OBS_SLOTS] storage ring = _obs[id];
        if (nowTs - ring[a.idx].time >= OBS_EVERY) {
            uint8 next = uint8((uint256(a.idx) + 1) % OBS_SLOTS);
            ring[next] = Obs({time: nowTs, cum: a.cum});
            a.idx = next;
        }
    }

    /// @dev Virtual pair-side reserve of the pool's in-range liquidity.
    function _pairReserve(PoolId id, bool pairIsCurrency0) internal view returns (uint256) {
        (uint160 sp,,,) = poolManager.getSlot0(id);
        uint128 liq = poolManager.getLiquidity(id);
        if (sp == 0 || liq == 0) return 0;
        return pairIsCurrency0 ? Math.mulDiv(liq, 1 << 96, sp) : Math.mulDiv(liq, sp, 1 << 96);
    }

    function _deliver(Currency cur, address token, address to, uint256 fee) internal returns (bool delivered) {
        uint256 held = owed[token];
        uint256 due = held + fee;
        if (IERC20Minimal(Currency.unwrap(cur)).balanceOf(address(poolManager)) >= due) {
            if (held != 0) {
                owed[token] = 0;
                poolManager.burn(address(this), cur.toId(), held);
                emit FeeDelivered(token, held);
            }
            poolManager.take(cur, to, due);
            return true;
        }
        poolManager.mint(address(this), cur.toId(), fee);
        owed[token] = due;
        emit FeeHeld(token, fee);
        return false;
    }

    function _specifiedIsPair(PoolConfig storage c, SwapParams calldata params) internal view returns (bool) {
        bool exactInput = params.amountSpecified < 0;
        bool specifiedIsCurrency0 = exactInput ? params.zeroForOne : !params.zeroForOne;
        return specifiedIsCurrency0 == c.pairIsCurrency0;
    }

    /// @notice Called by a Backstop coin when it moves to (`intoPool`) or
    ///         from the PoolManager: spends the allowance its own pool's swaps
    ///         granted in this transaction, and reverts when there isn't one.
    function spend(bool intoPool, uint256 amount) external {
        if (strategyOf[msg.sender] == address(0)) revert NotThisPool();
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
}
