// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

interface IOFADistributor {
    function distributeRewards() external payable;
    function eligibleSupply() external view returns (uint256);
}

/// @title OFAFeeHook
/// @notice Uniswap v4 hook that charges a fee on EVERY swap (buy and sell) on the pool
///         and forwards the ETH portion to the $OFA reward distributor, so holders keep
///         earning on every trade — anywhere the pool is routed, no transfer tax needed.
///
/// @dev    DRAFT — NOT AUDITED, NOT TESTED ON-CHAIN. The afterSwap fee/delta accounting and
///         the native-ETH forwarding MUST be validated on a v4 testnet (Sepolia) before any
///         mainnet use. A bug here affects every swap. Deploy via the v4-template + HookMiner
///         (the address must encode the AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA flags).
contract OFAFeeHook is BaseHook {
    /// @notice Fee taken from each swap's unspecified-currency amount, in basis points.
    uint256 public immutable feeBps;
    /// @notice The $OFA token / reward distributor.
    IOFADistributor public immutable distributor;
    /// @notice Owner — can sweep non-ETH fees that accumulate (e.g. token-side fees).
    address public owner;

    uint256 public constant MAX_FEE_BPS = 1_000; // 10% ceiling

    event SwapFee(Currency indexed currency, uint256 amount, bool forwardedToRewards);

    constructor(IPoolManager _pm, IOFADistributor _distributor, uint256 _feeBps) BaseHook(_pm) {
        require(_feeBps <= MAX_FEE_BPS, "fee too high");
        distributor = _distributor;
        feeBps = _feeBps;
        owner = msg.sender;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
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

    /// @dev Canonical "take a fee on the unspecified currency" pattern. The fee is pulled from
    ///      the PoolManager to this hook; if that currency is native ETH it's forwarded to the
    ///      distributor immediately, otherwise it accumulates here for the owner to sweep/convert.
    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        // unspecified currency = the side the swapper did NOT specify an exact amount for
        (Currency feeCurrency, int128 swapAmount) = (params.amountSpecified < 0 == params.zeroForOne)
            ? (key.currency1, delta.amount1())
            : (key.currency0, delta.amount0());

        if (swapAmount < 0) swapAmount = -swapAmount; // magnitude
        uint256 feeAmount = (uint256(uint128(swapAmount)) * feeBps) / 10_000;
        if (feeAmount == 0) return (BaseHook.afterSwap.selector, 0);

        // pull the fee out of the PoolManager to this hook
        poolManager.take(feeCurrency, address(this), feeAmount);

        bool forwarded;
        if (feeCurrency.isAddressZero() && distributor.eligibleSupply() > 0) {
            distributor.distributeRewards{value: feeAmount}();
            forwarded = true;
        }
        emit SwapFee(feeCurrency, feeAmount, forwarded);

        // charge the fee to the swap (positive delta on the unspecified currency)
        return (BaseHook.afterSwap.selector, int128(int256(feeAmount)));
    }

    /// @notice Sweep accumulated non-ETH fees (token side) to the owner for conversion.
    function sweep(Currency currency, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        currency.transfer(owner, amount);
    }

    /// @notice Manually forward held ETH to rewards (e.g. if eligibleSupply was 0 at swap time).
    function flushEth() external {
        uint256 bal = address(this).balance;
        require(bal > 0 && distributor.eligibleSupply() > 0, "nothing to flush");
        distributor.distributeRewards{value: bal}();
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "not owner");
        owner = newOwner;
    }

    receive() external payable {}
}
