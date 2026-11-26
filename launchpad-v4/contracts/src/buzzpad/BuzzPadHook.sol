// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BaseHook} from "@uniswap/v4-hooks-public/src/base/BaseHook.sol";

/**
 * @title BuzzPadHook
 * @notice Singleton Uniswap V4 hook for every BuzzPad v2 pool. Each pool pairs a
 * launched coin with a pair currency (native ETH or an approved ERC-20 such as
 * AZTEC or WXMR). The factory always makes the pair currency0 and the coin
 * currency1, so a buy is zeroForOne.
 *
 * Every fee is taken in the pair currency, never in the coin, so there is
 * nothing to convert and no sweep: an exact-input buy pays its fee out of the
 * pair amount going in (beforeSwap), and a sell or an exact-output buy pays it
 * out of the pair amount coming out or going in (afterSwap). A sell for an
 * exact pair amount out is the one shape that would need the fee in the coin,
 * so it is refused.
 *
 * Fees accrue per pool, already split: the protocol's share of the base fee,
 * and the creator's share plus the whole creator tax. `payout` sends both to
 * their recipients and anyone may call it; a recipient that refuses the
 * transfer keeps its balance pending without blocking the other.
 *
 * Launch rules frozen per pool at registration, as in LiquidFi: a snipe tax on
 * buys during the first seconds after launch (starting at `snipeStartBps`,
 * halving fourteen times across the window), and a volatility surcharge of
 * `volExtraBps` that decays over `volDecay` seconds after the price moves
 * more than `volThresholdBps` from its reference within `volWindow` seconds.
 * The surcharge applies to swaps after the one that moved the price, so a swap
 * is always priced from the state it starts in. The whole take is capped at
 * 99% of the leg it comes from.
 */
contract BuzzPadHook is BaseHook, Ownable2Step, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;

    struct Launch {
        bool registered;
        address coin;
        address pair; // address(0) is native ETH
        address creator; // receives the creator share and the creator tax
        uint16 creatorTaxBps;
        uint16 protocolFeeShareBps;
        uint16 hookFeeBps;
    }

    struct PoolTerms {
        uint40 launchedAt;
        uint16 snipeStartBps;
        uint32 snipeSeconds;
        uint16 volThresholdBps;
        uint32 volWindow;
        uint16 volExtraBps;
        uint32 volDecay;
    }

    struct VolState {
        uint160 lastSqrtPriceX96;
        uint40 spikeAt;
        uint160 refSqrtPriceX96;
        uint40 refAt;
    }

    uint256 private constant BASIS_POINTS = 10_000;
    uint256 private constant MAX_PROTOCOL_FEE_SHARE_BPS = 5_000;
    uint256 private constant MAX_HOOK_FEE_BPS = 1_000;
    uint256 private constant MAX_TOTAL_TRADE_FEE_BPS = 2_000;
    uint256 private constant MAX_SWAP_TAKE_BPS = 9_900;
    uint256 private constant SNIPE_HALVINGS = 14;
    uint256 private constant MAX_VOL_WINDOW = 1 hours;
    uint256 private constant MAX_VOL_DECAY = 1 hours;
    uint256 private constant ETH_PAYOUT_GAS = 60_000;

    error NotFactory();
    error AlreadySet();
    error OwnershipCannotBeRenounced();
    error ZeroAddress();
    error InvalidBps();
    error AlreadyRegistered();
    error UnknownPool();
    error InvalidPoolKey();
    error ExactOutputSellUnsupported();
    error InexactTransfer(address token, uint256 expected, uint256 received);

    event FactorySet(address factory);
    event PoolRegistered(PoolId indexed poolId, address coin, address pair, address creator);
    event CreatorFeeRecipientUpdated(PoolId indexed poolId, address indexed previousRecipient, address indexed newRecipient);
    // Same signature as LiquidFi's, so one indexer reads both: `currency` is always the pair.
    event HookFeeCollected(PoolId indexed poolId, address currency, uint256 feeAmount, uint256 taxAmount);
    event FeesPaid(PoolId indexed poolId, address indexed creator, uint256 creatorAmount, address indexed protocol, uint256 protocolAmount);
    event FeePayoutDeferred(PoolId indexed poolId, address indexed recipient, uint256 amount);
    event ProtocolFeeShareUpdated(uint256 bps);
    event HookFeeBpsUpdated(uint256 bps);
    event ProtocolFeeRecipientUpdated(address recipient);
    event VolatilityTermsUpdated(uint256 thresholdBps, uint256 windowSeconds, uint256 extraBps, uint256 decaySeconds);
    event SurchargeApplied(PoolId indexed poolId, uint256 volatilityBps, uint256 snipeBps);
    event VolatilitySpike(PoolId indexed poolId, uint160 referenceSqrtPriceX96, uint160 sqrtPriceX96);

    address public factory;
    address public protocolFeeRecipient;
    uint256 public protocolFeeShareBps;
    uint256 public hookFeeBps;
    uint256 public volThresholdBps;
    uint256 public volWindow;
    uint256 public volExtraBps;
    uint256 public volDecay;

    mapping(PoolId => Launch) public launches;
    mapping(PoolId => PoolTerms) public poolTerms;
    mapping(PoolId => VolState) public volState;
    // What `payout` owes, in the pool's pair currency.
    mapping(PoolId => uint256) public pendingCreator;
    mapping(PoolId => uint256) public pendingProtocol;

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    constructor(IPoolManager poolManager_, address protocolFeeRecipient_, address initialOwner_)
        BaseHook(poolManager_)
        Ownable(initialOwner_)
    {
        if (address(poolManager_) == address(0) || protocolFeeRecipient_ == address(0)) revert ZeroAddress();
        protocolFeeRecipient = protocolFeeRecipient_;
        protocolFeeShareBps = 3_000;
        hookFeeBps = 100;
        volThresholdBps = 1_000;
        volWindow = 60;
        volExtraBps = 200;
        volDecay = 120;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
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

    // ---------------------------------------------------------------------
    // Owner settings (each pool snapshots them at registration)
    // ---------------------------------------------------------------------

    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    function setProtocolFeeShareBps(uint256 bps) external onlyOwner {
        if (bps > MAX_PROTOCOL_FEE_SHARE_BPS) revert InvalidBps();
        protocolFeeShareBps = bps;
        emit ProtocolFeeShareUpdated(bps);
    }

    function setHookFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_HOOK_FEE_BPS) revert InvalidBps();
        hookFeeBps = bps;
        emit HookFeeBpsUpdated(bps);
    }

    /// @notice Where every pool's protocol share is paid, live (not snapshotted).
    function setProtocolFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        protocolFeeRecipient = recipient;
        emit ProtocolFeeRecipientUpdated(recipient);
    }

    function setVolatilityTerms(uint256 thresholdBps, uint256 windowSeconds, uint256 extraBps, uint256 decaySeconds)
        external
        onlyOwner
    {
        if (thresholdBps >= BASIS_POINTS || extraBps > MAX_HOOK_FEE_BPS) revert InvalidBps();
        if (windowSeconds == 0 || windowSeconds > MAX_VOL_WINDOW || decaySeconds == 0 || decaySeconds > MAX_VOL_DECAY) {
            revert InvalidBps();
        }
        volThresholdBps = thresholdBps;
        volWindow = windowSeconds;
        volExtraBps = extraBps;
        volDecay = decaySeconds;
        emit VolatilityTermsUpdated(thresholdBps, windowSeconds, extraBps, decaySeconds);
    }

    // ---------------------------------------------------------------------
    // Registration (factory only)
    // ---------------------------------------------------------------------

    function registerPool(
        PoolKey calldata key,
        address coin,
        address creator,
        uint16 creatorTaxBps,
        uint16 snipeStartBps,
        uint32 snipeSeconds
    ) external onlyFactory {
        PoolId poolId = key.toId();
        if (launches[poolId].registered) revert AlreadyRegistered();
        if (creator == address(0)) revert ZeroAddress();
        // The pair is always currency0 and the coin currency1.
        if (address(key.hooks) != address(this) || Currency.unwrap(key.currency1) != coin) revert InvalidPoolKey();
        uint256 fee = hookFeeBps;
        if (uint256(creatorTaxBps) + fee > MAX_TOTAL_TRADE_FEE_BPS) revert InvalidBps();

        launches[poolId] = Launch({
            registered: true,
            coin: coin,
            pair: Currency.unwrap(key.currency0),
            creator: creator,
            creatorTaxBps: creatorTaxBps,
            protocolFeeShareBps: uint16(protocolFeeShareBps),
            hookFeeBps: uint16(fee)
        });
        uint256 extra = volExtraBps;
        if (fee + extra > MAX_HOOK_FEE_BPS) extra = MAX_HOOK_FEE_BPS - fee;
        poolTerms[poolId] = PoolTerms({
            launchedAt: uint40(block.timestamp),
            snipeStartBps: snipeStartBps,
            snipeSeconds: snipeSeconds,
            volThresholdBps: uint16(volThresholdBps),
            volWindow: uint32(volWindow),
            volExtraBps: uint16(extra),
            volDecay: uint32(volDecay)
        });
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, poolId);
        volState[poolId].lastSqrtPriceX96 = sqrtPriceX96;
        emit PoolRegistered(poolId, coin, Currency.unwrap(key.currency0), creator);
    }

    function setCreatorFeeRecipient(PoolId poolId, address newRecipient) external onlyFactory {
        Launch storage l = launches[poolId];
        if (!l.registered) revert UnknownPool();
        if (newRecipient == address(0)) revert ZeroAddress();
        emit CreatorFeeRecipientUpdated(poolId, l.creator, newRecipient);
        l.creator = newRecipient;
    }

    // ---------------------------------------------------------------------
    // Swap hooks
    // ---------------------------------------------------------------------

    function _beforeInitialize(address sender, PoolKey calldata, uint160) internal view override returns (bytes4) {
        if (sender != factory) revert NotFactory();
        return IHooks.beforeInitialize.selector;
    }

    /**
     * @dev Exact-input buys: the fee comes off the pair amount before it is
     * swapped. Sells for an exact pair amount out are refused.
     */
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId poolId = key.toId();
        Launch memory l = launches[poolId];
        if (!l.registered || !_pairSpecified(params)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        if (params.amountSpecified > 0) revert ExactOutputSellUnsupported();

        uint256 total = _charge(poolId, l, key.currency0, sender, params.zeroForOne, uint256(-params.amountSpecified));
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(uint128(total)), 0), 0);
    }

    /**
     * @dev Sells and exact-output buys: the fee comes off the pair amount the
     * swap produced or consumed. Every swap then moves the volatility state.
     */
    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId poolId = key.toId();
        Launch memory l = launches[poolId];
        if (!l.registered) return (IHooks.afterSwap.selector, 0);

        uint256 total;
        if (!_pairSpecified(params)) {
            int128 pairLeg = delta.amount0();
            uint256 amount = uint256(uint128(pairLeg < 0 ? -pairLeg : pairLeg));
            if (amount != 0) total = _charge(poolId, l, key.currency0, sender, params.zeroForOne, amount);
        }
        _moveVolState(poolId);
        return (IHooks.afterSwap.selector, int128(uint128(total)));
    }

    function _pairSpecified(SwapParams calldata params) private pure returns (bool) {
        return (params.amountSpecified < 0) == params.zeroForOne;
    }

    /**
     * @dev Works out this swap's fee and creator tax on `amount` of the pair,
     * takes both from the pool manager, and books them for payout.
     */
    function _charge(PoolId poolId, Launch memory l, Currency pair, address sender, bool isBuy, uint256 amount)
        private
        returns (uint256 total)
    {
        (uint256 volBps, uint256 snipeBps) = _surcharges(poolId, sender, isBuy);
        uint256 feeBps = l.hookFeeBps + volBps;
        uint256 taxBps = l.creatorTaxBps;
        if (feeBps + taxBps + snipeBps > MAX_SWAP_TAKE_BPS) snipeBps = MAX_SWAP_TAKE_BPS - feeBps - taxBps;
        feeBps += snipeBps;
        if (volBps != 0 || snipeBps != 0) emit SurchargeApplied(poolId, volBps, snipeBps);

        uint256 feeAmount = (amount * feeBps) / BASIS_POINTS;
        uint256 taxAmount = (amount * taxBps) / BASIS_POINTS;
        total = feeAmount + taxAmount;
        if (total == 0) return 0;

        _takeExact(pair, total);
        uint256 protocolAmount = (feeAmount * l.protocolFeeShareBps) / BASIS_POINTS;
        pendingProtocol[poolId] += protocolAmount;
        pendingCreator[poolId] += total - protocolAmount;
        emit HookFeeCollected(poolId, Currency.unwrap(pair), feeAmount, taxAmount);
    }

    function _takeExact(Currency currency, uint256 amount) private {
        if (currency.isAddressZero()) {
            poolManager.take(currency, address(this), amount);
            return;
        }
        address token = Currency.unwrap(currency);
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        poolManager.take(currency, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert InexactTransfer(token, amount, received);
    }

    // ---------------------------------------------------------------------
    // Snipe tax and volatility surcharge
    // ---------------------------------------------------------------------

    /// @dev Priced from the state the swap starts in; `_moveVolState` updates it afterwards.
    function _surcharges(PoolId poolId, address sender, bool isBuy) private view returns (uint256 volBps, uint256 snipeBps) {
        PoolTerms memory t = poolTerms[poolId];
        uint256 elapsed = block.timestamp - t.launchedAt;
        if (elapsed < t.snipeSeconds) {
            // The factory's opening buy, made in the launch transaction, is exempt.
            if (isBuy && sender != factory) snipeBps = _snipeBps(t, elapsed);
            return (0, snipeBps);
        }
        volBps = _decayed(t, volState[poolId].spikeAt);
    }

    function _moveVolState(PoolId poolId) private {
        PoolTerms memory t = poolTerms[poolId];
        VolState storage v = volState[poolId];
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, poolId);
        if (block.timestamp - t.launchedAt >= t.snipeSeconds && t.volExtraBps != 0 && t.volThresholdBps != 0) {
            if (v.refAt == 0 || block.timestamp >= uint256(v.refAt) + t.volWindow) {
                v.refSqrtPriceX96 = v.lastSqrtPriceX96;
                v.refAt = uint40(block.timestamp);
            }
            if (_movedPast(v.refSqrtPriceX96, sqrtPriceX96, t.volThresholdBps)) {
                v.spikeAt = uint40(block.timestamp);
                emit VolatilitySpike(poolId, v.refSqrtPriceX96, sqrtPriceX96);
            }
        }
        v.lastSqrtPriceX96 = sqrtPriceX96;
    }

    function _snipeBps(PoolTerms memory t, uint256 elapsed) private pure returns (uint256) {
        if (t.snipeStartBps == 0 || elapsed >= t.snipeSeconds) return 0;
        return uint256(t.snipeStartBps) >> ((elapsed * SNIPE_HALVINGS) / t.snipeSeconds);
    }

    function _decayed(PoolTerms memory t, uint40 spikeAt) private view returns (uint256) {
        if (spikeAt == 0) return 0;
        uint256 since = block.timestamp - spikeAt;
        if (since >= t.volDecay) return 0;
        return (uint256(t.volExtraBps) * (t.volDecay - since)) / t.volDecay;
    }

    function _movedPast(uint160 ref, uint160 cur, uint256 thresholdBps) private pure returns (bool) {
        if (ref == 0) return false;
        uint256 r = FullMath.mulDiv(cur, 1e18, ref);
        if (r >= 2 ** 127) return true;
        uint256 ratio = (r * r) / 1e18;
        return ratio * BASIS_POINTS >= 1e18 * (BASIS_POINTS + thresholdBps)
            || ratio * BASIS_POINTS <= 1e18 * (BASIS_POINTS - thresholdBps);
    }

    /**
     * @notice What a swap on this pool pays right now, in basis points of its
     * pair leg: base fee, volatility surcharge, the snipe tax a buy would pay,
     * and the creator tax.
     */
    function feeNow(PoolId poolId)
        external
        view
        returns (uint256 baseBps, uint256 volatilityBps, uint256 snipeBuyBps, uint256 creatorTaxBps)
    {
        Launch memory l = launches[poolId];
        if (!l.registered) revert UnknownPool();
        PoolTerms memory t = poolTerms[poolId];
        uint256 elapsed = block.timestamp - t.launchedAt;
        baseBps = l.hookFeeBps;
        creatorTaxBps = l.creatorTaxBps;
        if (elapsed < t.snipeSeconds) snipeBuyBps = _snipeBps(t, elapsed);
        else volatilityBps = _decayed(t, volState[poolId].spikeAt);
    }

    // ---------------------------------------------------------------------
    // Payout (anyone may call)
    // ---------------------------------------------------------------------

    /**
     * @notice Sends a pool's pending fees to its creator and to the protocol,
     * in the pool's pair currency. A recipient that refuses the transfer keeps
     * its balance pending; the other leg still goes through.
     */
    function payout(PoolId poolId) public nonReentrant returns (uint256 creatorPaid, uint256 protocolPaid) {
        Launch memory l = launches[poolId];
        if (!l.registered) revert UnknownPool();
        address protocol = protocolFeeRecipient;

        uint256 c = pendingCreator[poolId];
        if (c != 0) {
            pendingCreator[poolId] = 0;
            if (_send(l.pair, l.creator, c)) {
                creatorPaid = c;
            } else {
                pendingCreator[poolId] = c;
                emit FeePayoutDeferred(poolId, l.creator, c);
            }
        }
        uint256 p = pendingProtocol[poolId];
        if (p != 0) {
            pendingProtocol[poolId] = 0;
            if (_send(l.pair, protocol, p)) {
                protocolPaid = p;
            } else {
                pendingProtocol[poolId] = p;
                emit FeePayoutDeferred(poolId, protocol, p);
            }
        }
        if (creatorPaid != 0 || protocolPaid != 0) emit FeesPaid(poolId, l.creator, creatorPaid, protocol, protocolPaid);
    }

    function payoutMany(PoolId[] calldata poolIds) external {
        for (uint256 i; i < poolIds.length; ++i) {
            if (pendingCreator[poolIds[i]] != 0 || pendingProtocol[poolIds[i]] != 0) payout(poolIds[i]);
        }
    }

    function _send(address token, address to, uint256 amount) private returns (bool ok) {
        if (token == address(0)) {
            (ok,) = to.call{value: amount, gas: ETH_PAYOUT_GAS}("");
            return ok;
        }
        uint256 before = IERC20(token).balanceOf(address(this));
        bytes memory data;
        (ok, data) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        ok = ok && (data.length == 0 || abi.decode(data, (bool))) && before - IERC20(token).balanceOf(address(this)) == amount;
    }

    /// @notice Accepts native ETH taken from the pool manager.
    receive() external payable {}
}
