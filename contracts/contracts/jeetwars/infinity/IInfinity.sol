// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The slice of PancakeSwap Infinity (Vault + CL pool manager) that Jeet
///         Wars uses, written against the deployed ABI on BNB Chain. Currencies
///         are plain addresses (address(0) = native BNB); BalanceDelta and
///         BeforeSwapDelta are packed int256 values as in Infinity.

struct PoolKey {
    address currency0;
    address currency1;
    address hooks;
    address poolManager;
    uint24 fee;
    bytes32 parameters;
}

struct ModifyLiquidityParams {
    int24 tickLower;
    int24 tickUpper;
    int256 liquidityDelta;
    bytes32 salt;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IInfinityVault {
    function lock(bytes calldata data) external returns (bytes memory);
    function take(address currency, address to, uint256 amount) external;
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function mint(address to, address currency, uint256 amount) external;
    function burn(address from, address currency, uint256 amount) external;
    function balanceOf(address owner, uint256 id) external view returns (uint256);
}

interface ILockCallback {
    function lockAcquired(bytes calldata data) external returns (bytes memory);
}

interface ICLPoolManager {
    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);
    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata hookData)
        external
        returns (int256 delta, int256 feeDelta);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 delta);
    function getSlot0(bytes32 id) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
    function getLiquidity(bytes32 id, address owner, int24 tickLower, int24 tickUpper, bytes32 salt)
        external
        view
        returns (uint128 liquidity);
}

library InfinityLib {
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    // Hook registration bitmap offsets (Infinity ICLHooks).
    uint16 internal constant BEFORE_ADD_LIQUIDITY = 1 << 2;
    uint16 internal constant BEFORE_SWAP = 1 << 6;
    uint16 internal constant AFTER_SWAP = 1 << 7;
    uint16 internal constant BEFORE_SWAP_RETURNS_DELTA = 1 << 10;
    uint16 internal constant AFTER_SWAP_RETURNS_DELTA = 1 << 11;

    function toId(PoolKey memory key) internal pure returns (bytes32 id) {
        assembly ("memory-safe") {
            id := keccak256(key, 0xc0)
        }
    }

    /// @dev CL parameters: [0,16) hook bitmap, [16,40) tick spacing.
    function parameters(uint16 bitmap, int24 tickSpacing) internal pure returns (bytes32) {
        return bytes32(uint256(bitmap) | (uint256(uint24(tickSpacing)) << 16));
    }

    function amount0(int256 delta) internal pure returns (int128) {
        return int128(delta >> 128);
    }

    function amount1(int256 delta) internal pure returns (int128) {
        return int128(delta);
    }

    /// @dev BeforeSwapDelta: specified in the upper 128 bits, unspecified in the lower.
    function beforeSwapDelta(int128 specified, int128 unspecified) internal pure returns (int256 d) {
        assembly ("memory-safe") {
            d := or(shl(128, specified), and(sub(shl(128, 1), 1), unspecified))
        }
    }
}
