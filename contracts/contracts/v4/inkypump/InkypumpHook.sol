// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

interface IInkypumpCoin {
    function sync() external returns (uint256);
}

interface IInkypumpLedger {
    function record(address wallet, address token, address pair, bool isBuy, uint256 coinAmount, uint256 pairAmount, uint256 fee) external;
}

/// @title InkypumpHook
/// @notice Fee engine for Inkypump' Uniswap V4 pools. Every swap pays a FIXED
///         fee of the PAIR side (WETH or a tokenized stock), whichever way the
///         trade goes. The fee is set once per pool at registration and no
///         function exists to change it.
///
///           - pair is the specified currency (exact-input buy, exact-output
///             sell): the fee is returned from beforeSwap as a specified delta
///             and taken in afterSwap;
///           - pair is the unspecified currency (exact-input sell, exact-output
///             buy): the fee is returned from afterSwap as an unspecified delta.
///
///         The fee goes straight to the coin contract, and the hook calls the
///         coin's permissionless sync() so creator / holders / platform are
///         credited on the spot.
///
///         Delivery: afterSwap runs before the trader's input is paid in, so the
///         PoolManager may not physically hold the pair yet (a stock with no
///         other V4 pool). Then the fee is kept as an ERC-6909 claim owned by
///         this hook and delivered on the next swap, or by {flush}, which
///         anyone may call and the coin calls before every payout.
///
///         Anti-snipe: for SNIPE_SECONDS after launch the fee starts at
///         SNIPE_START_BPS and decays linearly to the pool's fixed fee.
///         The factory's own first buy pays the base fee.
///
///         Leaderboard: after every swap the hook reports the trade to the
///         ledger, attributed to the wallet that signed the transaction, or
///         to the wallet a router named in 20-byte hook data. Reporting can
///         never fail a swap.
///
///         Two setters exist: wiring the factory and the ledger, once each,
///         at deployment.
contract InkypumpHook is BaseHook, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    uint16 internal constant BPS = 10_000;
    uint16 public constant SNIPE_START_BPS = 9_900;
    uint256 public constant SNIPE_SECONDS = 20;

    /// @notice The deployer wires the factory once; nothing else is settable.
    address public immutable deployer;
    address public factory;
    address public ledger;

    struct PoolConfig {
        address token;
        address pair;
        uint16 taxBps;
        bool pairIsCurrency0;
        uint64 launchTime;
        bool registered;
    }

    mapping(PoolId => PoolConfig) internal _config;
    /// @notice Pair asset of each coin registered here.
    mapping(address => address) public pairOf;
    /// @notice Fees taken for a coin but still held here as V4 claims.
    mapping(address => uint256) public owed;

    event PoolRegistered(address indexed token, address indexed pair, PoolId indexed id, uint16 taxBps);
    event FeeTaken(address indexed token, uint256 fee);
    event FactorySet(address indexed factory);
    event LedgerSet(address indexed ledger);
    event FeeHeld(address indexed token, uint256 amount);
    event FeeDelivered(address indexed token, uint256 amount);

    error NotDeployer();
    error NotFactory();
    error AlreadySet();
    error ZeroAddress();
    error BadTax();

    constructor(IPoolManager pm) BaseHook(pm) {
        deployer = tx.origin;
    }

    /// @notice One-time wiring of the factory (the only address that registers pools).
    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /// @notice One-time wiring of the ledger that records every swap.
    function setLedger(address ledger_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (ledger != address(0)) revert AlreadySet();
        if (ledger_ == address(0)) revert ZeroAddress();
        ledger = ledger_;
        emit LedgerSet(ledger_);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    /// @notice Register a freshly launched pool with its fixed fee. Factory only, once per pool.
    function registerPool(PoolKey calldata key, address token, address pair, uint16 taxBps) external {
        if (msg.sender != factory) revert NotFactory();
        if (taxBps == 0 || taxBps >= SNIPE_START_BPS) revert BadTax();
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (c.registered) revert AlreadySet();
        c.token = token;
        c.pair = pair;
        c.taxBps = taxBps;
        c.pairIsCurrency0 = Currency.unwrap(key.currency0) == pair;
        c.launchTime = uint64(block.timestamp);
        c.registered = true;
        pairOf[token] = pair;
        emit PoolRegistered(token, pair, id, taxBps);
    }

    /// @notice Deliver fees still held here as claims to `token`. Anyone.
    function flush(address token) external returns (uint256 amount) {
        amount = owed[token];
        if (amount == 0) return 0;
        poolManager.unlock(abi.encode(token, amount));
    }

    /// @dev {flush} only: burn the held claims and move the pair to the coin.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address token, uint256 amount) = abi.decode(data, (address, uint256));
        Currency cur = Currency.wrap(pairOf[token]);
        owed[token] = 0;
        poolManager.burn(address(this), cur.toId(), amount);
        poolManager.take(cur, token, amount);
        emit FeeDelivered(token, amount);
        return "";
    }

    function config(PoolId id) external view returns (PoolConfig memory) {
        return _config[id];
    }

    /// @notice Total fee bps a swap by `sender` pays right now (the fixed fee
    ///         plus the decaying anti-snipe surcharge), and the fixed fee alone.
    function feeBpsNow(PoolId id, address sender) public view returns (uint16 total, uint16 base) {
        PoolConfig storage c = _config[id];
        base = c.taxBps;
        total = base;
        if (sender == factory) return (total, base);
        uint256 elapsed = block.timestamp - c.launchTime;
        if (elapsed >= SNIPE_SECONDS) return (total, base);
        uint256 span = uint256(SNIPE_START_BPS) - base;
        total = uint16(base + span - (span * elapsed) / SNIPE_SECONDS);
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolConfig storage c = _config[key.toId()];
        if (!c.registered || !_specifiedIsPair(c, params)) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        (uint16 total,) = feeBpsNow(key.toId(), sender);
        uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint256 fee = (amount * total) / BPS;
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (!c.registered) return (BaseHook.afterSwap.selector, 0);
        (uint16 total,) = feeBpsNow(id, sender);
        Currency pairCurrency = c.pairIsCurrency0 ? key.currency0 : key.currency1;

        uint256 fee;
        int128 ret = 0;
        if (_specifiedIsPair(c, params)) {
            uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            fee = (amount * total) / BPS;
        } else {
            int128 unspecified = c.pairIsCurrency0 ? delta.amount0() : delta.amount1();
            uint256 amount = unspecified < 0 ? uint256(uint128(-unspecified)) : uint256(uint128(unspecified));
            fee = (amount * total) / BPS;
            ret = int128(int256(fee));
        }
        _report(c, key, delta, fee, hookData);
        if (fee == 0) return (BaseHook.afterSwap.selector, ret);

        if (_deliver(pairCurrency, c.token, fee)) {
            // Credit it now. A failed sync (the coin busy in a claim that routed
            // through this pool) loses nothing: the balance is credited next sync.
            try IInkypumpCoin(c.token).sync() {} catch {}
        }
        emit FeeTaken(c.token, fee);
        return (BaseHook.afterSwap.selector, ret);
    }

    /// @dev Tell the ledger about this swap. The pair side is the pool's own
    ///      delta: a buy paid that plus the fee, a sell received that minus it.
    function _report(PoolConfig storage c, PoolKey calldata, BalanceDelta delta, uint256 fee, bytes calldata hookData) internal {
        address l = ledger;
        if (l == address(0)) return;
        int128 pairDelta = c.pairIsCurrency0 ? delta.amount0() : delta.amount1();
        int128 coinDelta = c.pairIsCurrency0 ? delta.amount1() : delta.amount0();
        bool isBuy = pairDelta < 0;
        uint256 pairAmt = pairDelta < 0 ? uint256(uint128(-pairDelta)) : uint256(uint128(pairDelta));
        uint256 coinAmt = coinDelta < 0 ? uint256(uint128(-coinDelta)) : uint256(uint128(coinDelta));
        uint256 paid = isBuy ? pairAmt + fee : (pairAmt > fee ? pairAmt - fee : 0);
        address wallet = hookData.length == 20 ? address(bytes20(hookData)) : tx.origin;
        try IInkypumpLedger(l).record(wallet, c.token, c.pair, isBuy, coinAmt, paid, fee) {} catch {}
    }

    /// @dev Move `fee` (plus anything held from earlier swaps) to the coin when
    ///      the PoolManager physically holds enough of the pair; otherwise keep
    ///      it as a claim until it does. Returns whether anything was delivered.
    function _deliver(Currency cur, address token, uint256 fee) internal returns (bool delivered) {
        uint256 held = owed[token];
        uint256 due = held + fee;
        if (IERC20Minimal(Currency.unwrap(cur)).balanceOf(address(poolManager)) >= due) {
            if (held != 0) {
                owed[token] = 0;
                poolManager.burn(address(this), cur.toId(), held);
                emit FeeDelivered(token, held);
            }
            poolManager.take(cur, token, due);
            return true;
        }
        poolManager.mint(address(this), cur.toId(), fee);
        owed[token] = due;
        emit FeeHeld(token, fee);
        return false;
    }

    /// @dev Exact input: specified = input currency. Exact output: specified = output.
    function _specifiedIsPair(PoolConfig storage c, SwapParams calldata params) internal view returns (bool) {
        bool exactInput = params.amountSpecified < 0;
        bool specifiedIsCurrency0 = exactInput ? params.zeroForOne : !params.zeroForOne;
        return specifiedIsCurrency0 == c.pairIsCurrency0;
    }
}
