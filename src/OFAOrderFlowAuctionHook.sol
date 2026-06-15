// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

interface IOFADistributor {
    function distributeRewards() external payable;
    function eligibleSupply() external view returns (uint256);
}
interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title OFAOrderFlowAuctionHook
/// @notice The original OFA mechanism: an order-flow AUCTION on a Uniswap v4 ETH/OFA pool.
///         Bonded fillers deposit OFA inventory and post a surplus bid. When someone BUYS
///         (ETH→OFA), if a filler can fill at the pool's spot price (which is >= what the pool
///         would actually give after slippage — so the trader is never worse off), the hook
///         routes the swap to that filler, hands the trader their OFA, and sends the filler's
///         surplus bid to $OFA holders. If no filler qualifies, it falls back to the pool and
///         charges a baseline fee to holders. Sells charge the baseline fee (sell-side auction
///         is the symmetric future step).
///
/// @dev    DRAFT — being validated on a local mainnet fork. NOT audited. The v4 custom-fill
///         (BeforeSwapDelta + take/settle) and spot-price math must pass fork tests, and this
///         must be audited before mainnet — it routes funds on every swap.
contract OFAOrderFlowAuctionHook is BaseHook {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IOFADistributor public immutable distributor;
    IERC20 public immutable ofa;            // currency1 of the pool
    uint256 public constant BASE_BPS = 200; // 2% fallback fee → holders
    uint256 private constant Q96 = 0x1000000000000000000000000;

    struct Filler { uint256 ofaInventory; uint256 ethCredit; uint16 surplusBps; bool active; }
    mapping(address => Filler) public fillers;
    address[] public fillerList;
    address public owner;

    event FillerRegistered(address indexed filler, uint256 ofaInventory, uint16 surplusBps);
    event AuctionFill(address indexed filler, uint256 ethIn, uint256 ofaOut, uint256 surplusToHolders);
    event BaselineFee(bool isBuy, uint256 ethFee);

    constructor(IPoolManager _pm, IOFADistributor _distributor, address _ofa) BaseHook(_pm) {
        distributor = _distributor;
        ofa = IERC20(_ofa);
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

    // ---------------- filler registry ----------------
    function registerFiller(uint256 ofaAmount, uint16 surplusBps) external {
        require(surplusBps <= 5000, "bps");
        require(ofa.transferFrom(msg.sender, address(this), ofaAmount), "deposit");
        Filler storage f = fillers[msg.sender];
        if (!f.active) { f.active = true; fillerList.push(msg.sender); }
        f.ofaInventory += ofaAmount;
        f.surplusBps = surplusBps;
        emit FillerRegistered(msg.sender, f.ofaInventory, surplusBps);
    }
    function withdrawFiller(uint256 ofaAmount, uint256 ethAmount) external {
        Filler storage f = fillers[msg.sender];
        if (ofaAmount > 0) { f.ofaInventory -= ofaAmount; require(ofa.transfer(msg.sender, ofaAmount), "w"); }
        if (ethAmount > 0) { f.ethCredit -= ethAmount; (bool ok,) = msg.sender.call{value: ethAmount}(""); require(ok, "w2"); }
    }

    function _pickFiller(uint256 ofaOut) internal view returns (address) {
        uint256 n = fillerList.length;
        for (uint256 i = 0; i < n; i++) {
            address a = fillerList[i];
            Filler storage f = fillers[a];
            if (f.active && f.ofaInventory >= ofaOut) return a;
        }
        return address(0);
    }

    // ---------------- swap hooks ----------------
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal override returns (bytes4, BeforeSwapDelta, uint24)
    {
        bool exactIn = params.amountSpecified < 0;
        // BUY: ETH(currency0) -> OFA(currency1)
        if (exactIn && params.zeroForOne && key.currency0.isAddressZero()) {
            uint256 ethIn = uint256(-params.amountSpecified);
            // spot-price output (OFA per ETH). pool's actual output <= this, so trader never worse.
            (uint160 sp,,,) = poolManager.getSlot0(key.toId());
            uint256 ofaOut = FullMath.mulDiv(FullMath.mulDiv(ethIn, sp, Q96), sp, Q96);
            address fAddr = ofaOut > 0 ? _pickFiller(ofaOut) : address(0);
            if (fAddr != address(0)) {
                Filler storage f = fillers[fAddr];
                uint256 surplus = (ethIn * f.surplusBps) / 10_000;
                // take the ETH input, hand OFA to the trader (custom fill, pool untouched)
                poolManager.take(key.currency0, address(this), ethIn);
                poolManager.sync(key.currency1);
                require(ofa.transfer(address(poolManager), ofaOut), "ofa");
                poolManager.settle();
                f.ofaInventory -= ofaOut;
                f.ethCredit += ethIn - surplus;
                if (surplus > 0 && distributor.eligibleSupply() > 0) distributor.distributeRewards{value: surplus}();
                emit AuctionFill(fAddr, ethIn, ofaOut, surplus);
                return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(ethIn)), -int128(int256(ofaOut))), 0);
            }
            // no filler → baseline fee, fall through to pool
            uint256 fee = (ethIn * BASE_BPS) / 10_000;
            if (fee > 0) {
                poolManager.take(key.currency0, address(this), fee);
                if (distributor.eligibleSupply() > 0) distributor.distributeRewards{value: fee}();
                emit BaselineFee(true, fee);
                return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
            }
        }
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
    }

    // SELL: baseline fee on the ETH output
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal override returns (bytes4, int128)
    {
        if (params.amountSpecified < 0 && !params.zeroForOne && key.currency0.isAddressZero()) {
            int128 ethOut = delta.amount0();
            if (ethOut > 0) {
                uint256 fee = (uint256(uint128(ethOut)) * BASE_BPS) / 10_000;
                if (fee > 0) {
                    poolManager.take(key.currency0, address(this), fee);
                    if (distributor.eligibleSupply() > 0) distributor.distributeRewards{value: fee}();
                    emit BaselineFee(false, fee);
                    return (BaseHook.afterSwap.selector, int128(int256(fee)));
                }
            }
        }
        return (BaseHook.afterSwap.selector, int128(0));
    }

    function flushEth() external {
        uint256 bal = address(this).balance;
        require(bal > 0 && distributor.eligibleSupply() > 0, "nothing");
        distributor.distributeRewards{value: bal}();
    }
    function transferOwnership(address n) external { require(msg.sender == owner, "not owner"); owner = n; }
    receive() external payable {}
}
