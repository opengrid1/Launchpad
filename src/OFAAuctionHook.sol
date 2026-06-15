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

/// @title OFAAuctionHook
/// @notice Order-flow-pricing hook for an ETH/OFA Uniswap v4 pool. Every swap pays a fee in
///         ETH that scales with trade size — small flow pays the base rate, large/arbitrage
///         ("toxic") flow pays more — and 100% of it is routed to $OFA holders.
///
///         feeBps = BASE_BPS + (MAX_BPS-BASE_BPS) * min(ethAmount, RAMP) / RAMP
///         e.g. BASE 2% → up to MAX 6% for swaps >= RAMP ETH.
///
///         This is the safe, always-on realisation of "recapture order-flow value for holders".
///         A bonded-filler order-flow AUCTION (fillers compete to fill swaps, surplus → holders)
///         is the audited roadmap upgrade; it requires a filler network and is intentionally
///         NOT included here because guaranteeing "never worse than the pool" needs in-swap
///         pool quoting and is unsafe to ship unaudited.
///
/// @dev    DRAFT — verified on a mainnet fork (buy/sell fees scale + reach holders), not audited.
contract OFAAuctionHook is BaseHook {
    IOFADistributor public immutable distributor;
    address public owner;

    uint256 public constant BASE_BPS = 200;   // 2%
    uint256 public constant MAX_BPS = 600;    // 6%
    uint256 public constant RAMP = 5 ether;   // fee maxes out at 5 ETH of swap size

    event SwapFee(bool isBuy, uint256 ethAmount, uint256 feeBps, uint256 ethFee, bool forwarded);

    constructor(IPoolManager _pm, IOFADistributor _distributor) BaseHook(_pm) {
        distributor = _distributor;
        owner = msg.sender;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false, afterInitialize: false,
            beforeAddLiquidity: false, afterAddLiquidity: false,
            beforeRemoveLiquidity: false, afterRemoveLiquidity: false,
            beforeSwap: true, afterSwap: true,
            beforeDonate: false, afterDonate: false,
            beforeSwapReturnDelta: true, afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice Size-scaled fee in basis points for a given ETH trade size.
    function feeBpsFor(uint256 ethAmount) public pure returns (uint256) {
        uint256 capped = ethAmount > RAMP ? RAMP : ethAmount;
        return BASE_BPS + ((MAX_BPS - BASE_BPS) * capped) / RAMP;
    }

    // BUY (ETH in): fee on the ETH input
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal override returns (bytes4, BeforeSwapDelta, uint24)
    {
        bool exactIn = params.amountSpecified < 0;
        if (exactIn && params.zeroForOne && key.currency0.isAddressZero()) {
            uint256 inputEth = uint256(-params.amountSpecified);
            uint256 fee = (inputEth * feeBpsFor(inputEth)) / 10_000;
            if (fee > 0) {
                poolManager.take(key.currency0, address(this), fee);
                _forward(fee, true, inputEth);
                return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
            }
        }
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
    }

    // SELL (ETH out): fee on the ETH output
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal override returns (bytes4, int128)
    {
        bool exactIn = params.amountSpecified < 0;
        if (exactIn && !params.zeroForOne && key.currency0.isAddressZero()) {
            int128 ethOut = delta.amount0();
            if (ethOut > 0) {
                uint256 out = uint256(uint128(ethOut));
                uint256 fee = (out * feeBpsFor(out)) / 10_000;
                if (fee > 0) {
                    poolManager.take(key.currency0, address(this), fee);
                    _forward(fee, false, out);
                    return (BaseHook.afterSwap.selector, int128(int256(fee)));
                }
            }
        }
        return (BaseHook.afterSwap.selector, int128(0));
    }

    function _forward(uint256 ethFee, bool isBuy, uint256 ethAmount) internal {
        bool fwd;
        if (distributor.eligibleSupply() > 0) { distributor.distributeRewards{value: ethFee}(); fwd = true; }
        emit SwapFee(isBuy, ethAmount, feeBpsFor(ethAmount), ethFee, fwd);
    }

    function flushEth() external {
        uint256 bal = address(this).balance;
        require(bal > 0 && distributor.eligibleSupply() > 0, "nothing to flush");
        distributor.distributeRewards{value: bal}();
    }

    function transferOwnership(address n) external { require(msg.sender == owner, "not owner"); owner = n; }
    receive() external payable {}
}
