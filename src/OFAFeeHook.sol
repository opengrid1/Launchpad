// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

interface IOFADistributor {
    function distributeRewards() external payable;
    function eligibleSupply() external view returns (uint256);
}

/// @title OFAFeeHook
/// @notice Uniswap v4 hook for an ETH/OFA pool. Charges a fee — always in ETH — on every
///         swap and forwards it to the $OFA reward distributor, so holders earn on every
///         buy and sell with no transfer tax on the token.
///
///         ETH is currency0 (address(0) is the lowest address), so:
///           • BUY  (ETH -> OFA, exact-in): fee taken from the ETH input in beforeSwap.
///           • SELL (OFA -> ETH, exact-in): fee taken from the ETH output in afterSwap.
///         Exact-output swaps are not fee-charged (kept simple; they still work).
///
/// @dev    DRAFT — NOT AUDITED, NOT TESTED ON-CHAIN. The BeforeSwapDelta / afterSwap delta
///         sign conventions and native-ETH take/forward MUST be validated on a v4 testnet
///         (Sepolia) before mainnet. A bug affects every swap. Deploy via v4-template +
///         HookMiner; the address must encode BEFORE_SWAP | BEFORE_SWAP_RETURNS_DELTA |
///         AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA.
contract OFAFeeHook is BaseHook {
    uint256 public immutable feeBps;
    IOFADistributor public immutable distributor;
    address public owner;

    uint256 public constant MAX_FEE_BPS = 1_000; // 10% ceiling

    event SwapFee(bool isBuy, uint256 ethFee, bool forwarded);

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
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev BUY (ETH in): take the ETH fee from the input before the swap.
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bool exactIn = params.amountSpecified < 0;
        bool ethIsInput = params.zeroForOne; // ETH = currency0
        if (exactIn && ethIsInput && key.currency0.isAddressZero()) {
            uint256 inputEth = uint256(-params.amountSpecified);
            uint256 fee = (inputEth * feeBps) / 10_000;
            if (fee > 0) {
                poolManager.take(key.currency0, address(this), fee); // pull ETH fee
                _forward(fee, true);
                // charge the swapper: hook consumed `fee` of the specified (ETH) input
                return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
            }
        }
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
    }

    /// @dev SELL (ETH out): take the ETH fee from the output after the swap.
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        bool exactIn = params.amountSpecified < 0;
        bool ethIsOutput = !params.zeroForOne; // OFA -> ETH
        if (exactIn && ethIsOutput && key.currency0.isAddressZero()) {
            int128 ethOut = delta.amount0(); // positive: ETH owed to swapper
            if (ethOut > 0) {
                uint256 fee = (uint256(uint128(ethOut)) * feeBps) / 10_000;
                if (fee > 0) {
                    poolManager.take(key.currency0, address(this), fee);
                    _forward(fee, false);
                    // ETH is the unspecified currency on a sell exact-in
                    return (BaseHook.afterSwap.selector, int128(int256(fee)));
                }
            }
        }
        return (BaseHook.afterSwap.selector, int128(0));
    }

    function _forward(uint256 ethFee, bool isBuy) internal {
        bool forwarded;
        if (distributor.eligibleSupply() > 0) {
            distributor.distributeRewards{value: ethFee}();
            forwarded = true;
        }
        // else: held in the hook; flushEth() forwards later once holders exist
        emit SwapFee(isBuy, ethFee, forwarded);
    }

    /// @notice Forward any ETH stuck in the hook (e.g. fees taken while eligibleSupply was 0).
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
