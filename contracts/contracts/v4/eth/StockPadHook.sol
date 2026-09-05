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

interface IStockPadCoin {
    function accrue(uint256 fee, uint256 extra) external;
}

/// @title StockPadHook
/// @notice Fee engine for the mainnet stockpad's Uniswap V4 pools. Every swap
///         pays `taxBps` of the PAIR side (ETH or a tokenized stock), whichever
///         way the trade goes:
///
///           - pair is the specified currency (exact-input buy, exact-output
///             sell): the fee is returned from beforeSwap as a specified delta
///             and taken here in afterSwap;
///           - pair is the unspecified currency (exact-input sell, exact-output
///             buy): the fee is returned from afterSwap as an unspecified delta.
///
///         The fee goes straight to the coin contract, which credits creator /
///         holders / platform on the spot. No harvest.
///
///         Delivery: afterSwap runs before the trader's input has been paid
///         in, so the PoolManager may not physically hold the pair yet (a
///         stock with no other V4 pool). When it does not, the fee is kept as
///         an ERC-6909 claim owned by this hook and delivered to the coin on
///         the next swap, or by {flush} (the coin calls it before paying out).
///         The coin's own accounting is credited immediately either way.
///
///         Anti-snipe: for SNIPE_SECONDS after launch the fee starts at
///         SNIPE_START_BPS and decays linearly to `taxBps`; the surcharge is
///         platform-only. The factory's own dev buy pays the base fee.
///
///         Ownership is renounced at deploy; the immutable `admin` keeps the
///         one setter (wiring the factory).
contract StockPadHook is BaseHook, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    uint16 internal constant BPS = 10_000;
    uint16 public constant SNIPE_START_BPS = 9_900;
    uint256 public constant SNIPE_SECONDS = 20;

    address public immutable admin;
    /// @notice The deployer may wire the factory once, so the admin wallet
    ///         never has to sign during deployment.
    address public immutable deployer;
    address public factory;

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
    /// @notice Fees credited to a coin but still held here as V4 claims,
    ///         waiting for the PoolManager to hold the pair. Delivered by the
    ///         next swap or by {flush}.
    mapping(address => uint256) public owed;

    event PoolRegistered(address indexed token, address indexed pair, PoolId indexed id, uint16 taxBps);
    event FeeTaken(address indexed token, uint256 fee, uint256 extra);
    event FactorySet(address indexed factory);
    event FeeHeld(address indexed token, uint256 amount);
    event FeeDelivered(address indexed token, uint256 amount);

    error NotAdmin();
    error NotFactory();
    error AlreadySet();
    error ZeroAddress();

    constructor(IPoolManager pm, address admin_) BaseHook(pm) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        deployer = tx.origin;
    }

    /// @notice One-time wiring of the factory (the only address that registers pools).
    function setFactory(address factory_) external {
        if (msg.sender != admin && msg.sender != deployer) revert NotAdmin();
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

    function registerPool(PoolKey calldata key, address token, address pair, uint16 taxBps) external {
        if (msg.sender != factory) revert NotFactory();
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

    /// @notice Deliver fees still held here as claims to `token`. Anyone may
    ///         call; the coin does before every payout.
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

    /// @notice Total fee bps a swap by `sender` pays right now (base plus the
    ///         decaying anti-snipe surcharge), and the base alone.
    function feeBpsNow(PoolId id, address sender) public view returns (uint16 total, uint16 base) {
        PoolConfig storage c = _config[id];
        base = c.taxBps;
        total = base;
        if (sender == factory) return (total, base);
        uint256 elapsed = block.timestamp - c.launchTime;
        if (elapsed >= SNIPE_SECONDS) return (total, base);
        // Linear decay from SNIPE_START_BPS at t=0 to base at t=SNIPE_SECONDS.
        uint256 span = uint256(SNIPE_START_BPS) - base;
        total = uint16(base + span - (span * elapsed) / SNIPE_SECONDS);
    }

    // ---------------------------------------------------------------------
    // Specified side is the pair: return the fee from beforeSwap.
    // ---------------------------------------------------------------------

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolConfig storage c = _config[key.toId()];
        if (!c.registered || c.taxBps == 0) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        if (!_specifiedIsPair(c, params)) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        (uint16 total,) = feeBpsNow(key.toId(), sender);
        uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint256 fee = (amount * total) / BPS;
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    // ---------------------------------------------------------------------
    // afterSwap: take the fee to the coin and credit it.
    // ---------------------------------------------------------------------

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (!c.registered || c.taxBps == 0) return (BaseHook.afterSwap.selector, 0);
        (uint16 total, uint16 base) = feeBpsNow(id, sender);
        Currency pairCurrency = c.pairIsCurrency0 ? key.currency0 : key.currency1;

        uint256 fee;
        int128 ret;
        if (_specifiedIsPair(c, params)) {
            // Already returned from beforeSwap as a specified delta; realise it.
            uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            fee = (amount * total) / BPS;
        } else {
            int128 unspecified = c.pairIsCurrency0 ? delta.amount0() : delta.amount1();
            uint256 amount = unspecified < 0 ? uint256(uint128(-unspecified)) : uint256(uint128(unspecified));
            fee = (amount * total) / BPS;
            ret = int128(int256(fee));
        }
        if (fee == 0) return (BaseHook.afterSwap.selector, ret);

        uint256 baseFee = (fee * base) / total;
        _deliver(pairCurrency, c.token, fee);
        IStockPadCoin(c.token).accrue(baseFee, fee - baseFee);
        emit FeeTaken(c.token, baseFee, fee - baseFee);
        return (BaseHook.afterSwap.selector, ret);
    }

    /// @dev Move `fee` (plus anything held from earlier swaps) to the coin when
    ///      the PoolManager physically holds enough of the pair; otherwise keep
    ///      it as a claim on this hook until it does.
    function _deliver(Currency cur, address token, uint256 fee) internal {
        uint256 held = owed[token];
        uint256 due = held + fee;
        if (IERC20Minimal(Currency.unwrap(cur)).balanceOf(address(poolManager)) >= due) {
            if (held != 0) {
                owed[token] = 0;
                poolManager.burn(address(this), cur.toId(), held);
                emit FeeDelivered(token, held);
            }
            poolManager.take(cur, token, due);
        } else {
            poolManager.mint(address(this), cur.toId(), fee);
            owed[token] = due;
            emit FeeHeld(token, fee);
        }
    }

    /// @dev Exact input: specified = input currency. Exact output: specified = output.
    function _specifiedIsPair(PoolConfig storage c, SwapParams calldata params) internal view returns (bool) {
        bool exactInput = params.amountSpecified < 0;
        bool specifiedIsCurrency0 = exactInput ? params.zeroForOne : !params.zeroForOne;
        return specifiedIsCurrency0 == c.pairIsCurrency0;
    }
}
