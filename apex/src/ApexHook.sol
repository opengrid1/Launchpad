// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";

interface IERC20Min {
    function transfer(address to, uint256 value) external returns (bool);
}

/// @title ApexHook — Uniswap v4 hook holding the bonded APEX/ETH pool (Phase 2).
/// @notice The curve calls `bond()` at graduation: this contract creates the v4 pool, adds the
///         reserved APEX + raised ETH as full-range liquidity, and holds the position. The owner
///         can later `withdrawLiquidity()` to pull the pool back out (native ETH + APEX).
/// @dev Phase 3 (king-of-the-hill swap tax) plugs into `beforeSwap`/`afterSwap`, which are
///      declared here as no-ops for now so the pool is created with the final hook permissions.
contract ApexHook is IHooks, IUnlockCallback {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    IPoolManager public immutable poolManager;
    address public immutable token; // APEX
    address public owner;

    uint24 public immutable fee; // LP fee (e.g. 10000 = 1%)
    int24 public immutable tickSpacing;

    PoolKey public poolKey;
    bool public initialized;
    uint128 public liquidity; // full-range liquidity this hook owns
    int24 public tickLower;
    int24 public tickUpper;

    event Bonded(uint256 ethIn, uint256 tokenIn, uint160 sqrtPriceX96, uint128 liquidity);
    event LiquidityWithdrawn(address indexed to, uint256 ethOut, uint256 tokenOut);

    error NotOwner();
    error NotManager();
    error AlreadyBonded();
    error NotBonded();
    error ExternalLiquidityBlocked();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPoolManager pm, address token_, address owner_, uint24 fee_, int24 tickSpacing_) {
        poolManager = pm;
        token = token_;
        owner = owner_;
        fee = fee_;
        tickSpacing = tickSpacing_;
    }

    // ------------------------------------------------------------------ hook permissions
    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true, // block external LPs — only this hook seeds liquidity
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true, // Phase 3: king-of-the-hill tax
            afterSwap: true, // Phase 3
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ------------------------------------------------------------------ bond (Phase 2)
    /// @notice Called by the curve at graduation with the raised ETH (msg.value) and after
    ///         transferring `tokenAmount` APEX to this hook. Creates the pool and seeds it.
    function bond(uint256 tokenAmount) external payable {
        if (initialized) revert AlreadyBonded();
        require(msg.value > 0 && tokenAmount > 0, "empty bond");

        // currency0 = native ETH (address 0) < currency1 = APEX, always.
        poolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(this))
        });

        // Price (token per ETH) implied by the bonded amounts: sqrtP = sqrt(amount1/amount0)*2^96.
        uint160 sqrtPriceX96 = uint160(_sqrt(FullMath.mulDiv(tokenAmount, 1 << 192, msg.value)));
        poolManager.initialize(poolKey, sqrtPriceX96);
        initialized = true;

        tickLower = _floor(TickMath.minUsableTick(tickSpacing));
        tickUpper = _floor(TickMath.maxUsableTick(tickSpacing));

        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            msg.value,
            tokenAmount
        );
        liquidity = liq;

        poolManager.unlock(abi.encode(Action.ADD, liq, msg.sender));
        emit Bonded(msg.value, tokenAmount, sqrtPriceX96, liq);
    }

    // ------------------------------------------------------------------ withdraw (owner)
    /// @notice Owner pulls 100% of the bonded liquidity; native ETH + APEX go to `to`.
    function withdrawLiquidity(address to) external onlyOwner {
        if (!initialized) revert NotBonded();
        uint128 liq = liquidity;
        require(liq > 0, "no liquidity");
        liquidity = 0;
        poolManager.unlock(abi.encode(Action.REMOVE, liq, to));
    }

    // ------------------------------------------------------------------ unlock callback
    enum Action {
        ADD,
        REMOVE
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotManager();
        (Action action, uint128 liq, address recipient) = abi.decode(data, (Action, uint128, address));

        if (action == Action.ADD) {
            (BalanceDelta delta,) = poolManager.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liq)), salt: 0}),
                ""
            );
            // Adding liquidity => we owe both currencies (negative deltas).
            _settle(poolKey.currency0, uint256(uint128(-delta.amount0())));
            _settle(poolKey.currency1, uint256(uint128(-delta.amount1())));
        } else {
            (BalanceDelta delta,) = poolManager.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: -int256(uint256(liq)), salt: 0}),
                ""
            );
            // Removing => the pool owes us; take both to `recipient`.
            uint256 eth = uint256(uint128(delta.amount0()));
            uint256 tok = uint256(uint128(delta.amount1()));
            if (eth > 0) poolManager.take(poolKey.currency0, recipient, eth);
            if (tok > 0) poolManager.take(poolKey.currency1, recipient, tok);
            emit LiquidityWithdrawn(recipient, eth, tok);
        }
        return "";
    }

    function _settle(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        if (currency.isAddressZero()) {
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(currency);
            IERC20Min(Currency.unwrap(currency)).transfer(address(poolManager), amount);
            poolManager.settle();
        }
    }

    // ------------------------------------------------------------------ IHooks (Phase 3 stubs)
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        returns (bytes4)
    {
        // Only this hook may add liquidity (it's the sole LP, during bond).
        if (sender != address(this)) revert ExternalLiquidityBlocked();
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        pure
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // Phase 3: take swap tax + king attribution here.
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        // Phase 3: route tax to jackpot/dividends/rollover; extend the king timer.
        return (IHooks.afterSwap.selector, 0);
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IHooks.afterDonate.selector;
    }

    // ------------------------------------------------------------------ utils
    function _floor(int24 tick) internal view returns (int24) {
        int24 m = tick % tickSpacing;
        if (m != 0 && tick < 0) return tick - m - tickSpacing;
        return tick - m;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x >> 1) + 1;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "zero");
        owner = next;
    }

    receive() external payable {}
}
