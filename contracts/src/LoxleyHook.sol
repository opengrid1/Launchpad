// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";

import {IRewardsDistributor} from "./interfaces/IRewardsDistributor.sol";
import {ILoxleyHook} from "./interfaces/ILoxleyHook.sol";

/// @title LoxleyHook
/// @notice The one place the 1% trade tax is taken. On every swap this hook
///         skims 1% of the ETH leg and forwards it to the RewardsDistributor,
///         which splits it 50/50 between holders and the creator.
///
///         The rate is a hardcoded constant — there is no owner and no setter,
///         so the 1% can never be raised and the pool can never be re-pointed at
///         a different distributor. Because the hook lives inside the pool, the
///         tax is charged on *every* swap and cannot be bypassed.
///
///         The hook must be deployed at a CREATE2 address whose low bits encode
///         AFTER_SWAP + AFTER_SWAP_RETURNS_DELTA (see getHookPermissions).
contract LoxleyHook is IHooks, ILoxleyHook {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    uint256 public constant FEE_BPS = 100; // 1%, fixed forever

    IPoolManager public immutable manager;
    IRewardsDistributor public immutable distributor;
    address public immutable factory;

    mapping(PoolId => address) public tokenOf; // pool → its coin

    error OnlyManager();
    error OnlyFactory();

    constructor(IPoolManager _manager, IRewardsDistributor _distributor, address _factory) {
        manager = _manager;
        distributor = _distributor;
        factory = _factory;
    }

    modifier onlyManager() {
        if (msg.sender != address(manager)) revert OnlyManager();
        _;
    }

    /// Factory registers each pool → token at launch so afterSwap knows where
    /// to route that coin's tax.
    function register(PoolId poolId, address token) external {
        if (msg.sender != factory) revert OnlyFactory();
        tokenOf[poolId] = token;
    }

    // ── the tax: take 1% of the ETH side of every swap ────────────────────────
    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        BalanceDelta delta,
        bytes calldata
    ) external onlyManager returns (bytes4, int128) {
        // currency0 is native ETH (the factory always orders it that way).
        // Whichever side ETH moved, take 1% of that ETH amount as the tax.
        int128 ethDelta = delta.amount0();
        uint256 ethAbs = ethDelta < 0 ? uint256(int256(-ethDelta)) : uint256(int256(ethDelta));
        uint256 fee = (ethAbs * FEE_BPS) / 10_000;
        if (fee == 0) return (IHooks.afterSwap.selector, 0);

        // pull the fee in ETH out of the pool to this hook, then forward it.
        manager.take(key.currency0, address(this), fee);
        address token = tokenOf[key.toId()];
        distributor.deposit{value: fee}(token);

        // returning `fee` as the hook's delta charges it to the swap, so LPs and
        // the pool accounting stay exact.
        return (IHooks.afterSwap.selector, int128(int256(fee)));
    }

    // ── permissions: only afterSwap (+ returns delta) are enabled ─────────────
    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ── unused hook callbacks (reverting keeps the surface tight) ─────────────
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert();
    }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert();
    }
    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external pure returns (bytes4) { revert(); }
    function afterAddLiquidity(
        address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata
    ) external pure returns (bytes4, BalanceDelta) { revert(); }
    function beforeRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external pure returns (bytes4) { revert(); }
    function afterRemoveLiquidity(
        address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata
    ) external pure returns (bytes4, BalanceDelta) { revert(); }
    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata)
        external pure returns (bytes4, BeforeSwapDelta, uint24) { revert(); }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure returns (bytes4) { revert(); }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure returns (bytes4) { revert(); }

    receive() external payable {}
}
