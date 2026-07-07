// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";

interface IRewardsDistributorV2 {
    function depositETH(address token) external payable;
    function depositERC20(address token, uint256 amount) external;
}

interface IERC20Approve {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title LoxleyHookV2
/// @notice Takes the fixed 1% trade tax on every swap and pushes it to the
///         RewardsDistributor immediately — so there is never a separate
///         "collect" step and holder rewards are claimable in one transaction.
///
///         v2 generalises the tax leg: the tax is 1% of the *quote* side, which
///         is currency0 of the pool (the factory always orders the quote —
///         native ETH or a stock — as currency0 and the coin as currency1).
///         For an ETH-quoted pool the tax is forwarded as msg.value; for a
///         stock-quoted pool it is transferred as ERC-20 then registered.
///
///         The 1% rate is a hardcoded constant with no setter and no owner, so
///         it can never be raised and the pool can never be re-pointed at a
///         different distributor. Deployed at a CREATE2 address whose low bits
///         encode AFTER_SWAP + AFTER_SWAP_RETURNS_DELTA.
contract LoxleyHookV2 is IHooks {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    uint256 public constant FEE_BPS = 100; // 1%, fixed forever

    IPoolManager public immutable manager;
    IRewardsDistributorV2 public immutable distributor;
    address public immutable factory;

    struct Pool {
        address token; // the coin
        address quote; // the quote: address(0) = native ETH, else a stock ERC20
        bool quoteIsZero; // true if the quote sorted to currency0, false if currency1
    }

    mapping(PoolId => Pool) public poolOf;

    error OnlyManager();
    error OnlyFactory();

    constructor(IPoolManager _manager, IRewardsDistributorV2 _distributor, address _factory) {
        manager = _manager;
        distributor = _distributor;
        factory = _factory;
    }

    modifier onlyManager() {
        if (msg.sender != address(manager)) revert OnlyManager();
        _;
    }

    /// Factory registers each pool → (token, quote, ordering) at launch.
    function register(PoolId poolId, address token, address quote, bool quoteIsZero) external {
        if (msg.sender != factory) revert OnlyFactory();
        poolOf[poolId] = Pool({token: token, quote: quote, quoteIsZero: quoteIsZero});
    }

    // ── the tax: take 1% of the *quote* side of every swap ────────────────────
    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        BalanceDelta delta,
        bytes calldata
    ) external onlyManager returns (bytes4, int128) {
        Pool memory p = poolOf[key.toId()];

        // take 1% of whichever side is the quote (ETH or the stock).
        int128 q = p.quoteIsZero ? delta.amount0() : delta.amount1();
        uint256 abs = q < 0 ? uint256(int256(-q)) : uint256(int256(q));
        uint256 fee = (abs * FEE_BPS) / 10_000;
        if (fee == 0) return (IHooks.afterSwap.selector, 0);

        Currency quoteCur = p.quoteIsZero ? key.currency0 : key.currency1;

        // pull the fee out of the pool to this hook, then forward it.
        manager.take(quoteCur, address(this), fee);
        if (p.quote == address(0)) {
            distributor.depositETH{value: fee}(p.token);
        } else {
            IERC20Approve(p.quote).transfer(address(distributor), fee);
            distributor.depositERC20(p.token, fee);
        }

        // charge the fee to the swap so pool accounting stays exact. The hook's
        // delta must be returned on the quote side; afterSwapReturnDelta applies
        // it to the unspecified currency, which for a quote-in/out swap is the
        // quote leg.
        return (IHooks.afterSwap.selector, int128(int256(fee)));
    }

    // ── permissions: afterSwap (+ returns delta) only ─────────────────────────
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

    // ── unused hook callbacks ─────────────────────────────────────────────────
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) { revert(); }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) { revert(); }
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
