// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {BasketOwnable} from "./BasketOwnable.sol";

/// @title BasketFeeHook
/// @notice Fee engine for Basket launches on Base.
///
///         Every swap pays a trade fee that is ALWAYS charged in the pair
///         token (WETH or the stock the coin is paired with), never in the
///         coin, whichever way the swap is specified. Nothing downstream ever
///         has to sell the coin to realise a fee.
///
///         The fee has two levels, both fixed per pool at launch:
///           - before graduation: `preTaxBps`  (2% by default)
///           - after graduation:  `postTaxBps` (1.25% by default)
///         A pool graduates, once and for good, the first time a swap leaves
///         its price at or beyond `gradSqrtPriceX96`.
///
///         Each fee splits into the pool's beneficiary share (the coin's
///         holder-reward vault, or the creator's fee wallet) and the protocol
///         share (everything else). Fees accrue as ERC-6909 claims on the
///         PoolManager and are paid out by `sweep`, which anyone can call.
contract BasketFeeHook is IHooks, IUnlockCallback, BasketOwnable {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using SafeCast for uint256;

    uint256 private constant BPS = 10_000;
    /// @notice Hard ceiling on the trade fee. No admin setting can exceed it.
    uint16 public constant MAX_TAX_BPS = 200;
    uint256 private constant PAYOUT_GAS = 150_000;

    struct PoolTerms {
        bool set;
        bool coinIsCurrency0;
        bool graduated;
        uint16 preTaxBps;
        uint16 postTaxBps;
        /// @dev Beneficiary's cut, in bps of the trade (not of the fee).
        uint16 preBeneficiaryBps;
        uint16 postBeneficiaryBps;
        uint160 gradSqrtPriceX96;
        address beneficiary;
    }

    struct Accrued {
        uint128 beneficiary;
        uint128 protocol;
    }

    IPoolManager public immutable poolManager;
    /// @notice The launch factory: the only address that may create and
    ///         configure pools on this hook. Set once by the owner.
    address public factory;
    /// @notice Where the protocol share of every fee is sent on `sweep`.
    address public protocolFeeRecipient;

    mapping(PoolId => PoolTerms) public termsOf;
    mapping(PoolId => Accrued) public accruedOf;

    error NotPoolManager();
    error NotFactory();
    error NotBeneficiary();
    error AlreadySet();
    error AlreadyConfigured();
    error PoolNotConfigured();
    error InvalidTerms();
    error HookNotImplemented();

    event FactorySet(address factory);
    event ProtocolFeeRecipientUpdated(address recipient);
    event PoolConfigured(
        PoolId indexed id,
        address indexed beneficiary,
        uint16 preTaxBps,
        uint16 postTaxBps,
        uint16 preBeneficiaryBps,
        uint16 postBeneficiaryBps,
        uint160 gradSqrtPriceX96
    );
    event FeeTaken(PoolId indexed id, uint256 fee, uint256 toBeneficiary);
    event Graduated(PoolId indexed id, uint160 sqrtPriceX96);
    event FeesSwept(PoolId indexed id, address indexed beneficiary, uint256 beneficiaryAmount, uint256 protocolAmount);
    event BeneficiaryUpdated(PoolId indexed id, address indexed previous, address indexed current);
    event PayoutDeferred(address indexed to, Currency indexed currency, uint256 amount);

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(IPoolManager poolManager_, address owner_, address protocolFeeRecipient_) BasketOwnable(owner_) {
        if (protocolFeeRecipient_ == address(0)) revert ZeroAddress();
        poolManager = poolManager_;
        protocolFeeRecipient = protocolFeeRecipient_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Wire the launch factory. One time only.
    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function setProtocolFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        protocolFeeRecipient = recipient;
        emit ProtocolFeeRecipientUpdated(recipient);
    }

    // ---------------------------------------------------------------------
    // Pool setup (factory only)
    // ---------------------------------------------------------------------

    /// @notice Record a pool's fee terms. Called once by the factory at launch;
    ///         the terms can never be changed afterwards.
    function configurePool(
        PoolKey calldata key,
        bool coinIsCurrency0,
        uint16 preTaxBps,
        uint16 postTaxBps,
        uint16 preBeneficiaryBps,
        uint16 postBeneficiaryBps,
        uint160 gradSqrtPriceX96,
        address beneficiary
    ) external {
        if (msg.sender != factory) revert NotFactory();
        if (
            preTaxBps > MAX_TAX_BPS || postTaxBps > preTaxBps || preBeneficiaryBps > preTaxBps
                || postBeneficiaryBps > postTaxBps || beneficiary == address(0) || gradSqrtPriceX96 == 0
        ) revert InvalidTerms();

        PoolId id = key.toId();
        if (termsOf[id].set) revert AlreadyConfigured();
        termsOf[id] = PoolTerms({
            set: true,
            coinIsCurrency0: coinIsCurrency0,
            graduated: false,
            preTaxBps: preTaxBps,
            postTaxBps: postTaxBps,
            preBeneficiaryBps: preBeneficiaryBps,
            postBeneficiaryBps: postBeneficiaryBps,
            gradSqrtPriceX96: gradSqrtPriceX96,
            beneficiary: beneficiary
        });
        emit PoolConfigured(
            id, beneficiary, preTaxBps, postTaxBps, preBeneficiaryBps, postBeneficiaryBps, gradSqrtPriceX96
        );
    }

    /// @notice The current beneficiary hands its fee stream to another address.
    ///         A creator can move their fee wallet this way; a reward vault has
    ///         no such call, so a holders-mode coin stays in holders mode.
    function setBeneficiary(PoolKey calldata key, address newBeneficiary) external {
        if (newBeneficiary == address(0)) revert ZeroAddress();
        PoolId id = key.toId();
        PoolTerms storage t = termsOf[id];
        if (!t.set) revert PoolNotConfigured();
        if (msg.sender != t.beneficiary) revert NotBeneficiary();
        emit BeneficiaryUpdated(id, t.beneficiary, newBeneficiary);
        t.beneficiary = newBeneficiary;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function isGraduated(PoolId id) external view returns (bool) {
        return termsOf[id].graduated;
    }

    /// @notice The trade fee and beneficiary cut a swap pays right now, in bps.
    function feeNow(PoolId id) external view returns (uint16 taxBps, uint16 beneficiaryBps) {
        PoolTerms storage t = termsOf[id];
        return t.graduated ? (t.postTaxBps, t.postBeneficiaryBps) : (t.preTaxBps, t.preBeneficiaryBps);
    }

    // ---------------------------------------------------------------------
    // Fee engine
    // ---------------------------------------------------------------------

    /// @dev Charges the fee when the pair token is the SPECIFIED side of the
    ///      swap: an exact-input buy (pair in) or an exact-output sell (pair
    ///      out). Returning a positive specified delta makes the swapper pay
    ///      the fee on top of what the pool itself trades.
    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        PoolTerms storage t = termsOf[id];
        if (!t.set) revert PoolNotConfigured();

        bool isBuy = params.zeroForOne != t.coinIsCurrency0;
        bool exactIn = params.amountSpecified < 0;
        if (isBuy != exactIn) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        uint256 base = exactIn ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint256 fee = _charge(id, t, _pairCurrency(key, t.coinIsCurrency0), base);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(fee.toInt128(), 0), 0);
    }

    /// @dev Charges the fee when the pair token is the UNSPECIFIED side: an
    ///      exact-input sell (pair out) or an exact-output buy (pair in). Then
    ///      checks whether this swap graduated the pool.
    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        PoolTerms storage t = termsOf[id];
        if (!t.set) revert PoolNotConfigured();

        bool coinIsCurrency0 = t.coinIsCurrency0;
        bool isBuy = params.zeroForOne != coinIsCurrency0;
        bool exactIn = params.amountSpecified < 0;

        uint256 fee;
        if (isBuy != exactIn) {
            int128 pairDelta = coinIsCurrency0 ? delta.amount1() : delta.amount0();
            uint256 base = pairDelta < 0 ? uint256(uint128(-pairDelta)) : uint256(uint128(pairDelta));
            fee = _charge(id, t, _pairCurrency(key, coinIsCurrency0), base);
        }

        if (!t.graduated) {
            (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(id);
            // The coin's price rises as sqrtPrice rises when the coin is
            // currency0, and as it falls when the coin is currency1.
            bool reached = coinIsCurrency0 ? sqrtPriceX96 >= t.gradSqrtPriceX96 : sqrtPriceX96 <= t.gradSqrtPriceX96;
            if (reached) {
                t.graduated = true;
                emit Graduated(id, sqrtPriceX96);
            }
        }

        return (IHooks.afterSwap.selector, fee.toInt128());
    }

    function _pairCurrency(PoolKey calldata key, bool coinIsCurrency0) private pure returns (Currency) {
        return coinIsCurrency0 ? key.currency1 : key.currency0;
    }

    function _charge(PoolId id, PoolTerms storage t, Currency pair, uint256 base) private returns (uint256 fee) {
        bool graduated = t.graduated;
        fee = (base * (graduated ? t.postTaxBps : t.preTaxBps)) / BPS;
        if (fee == 0) return 0;
        uint256 toBeneficiary = (base * (graduated ? t.postBeneficiaryBps : t.preBeneficiaryBps)) / BPS;

        Accrued storage a = accruedOf[id];
        a.beneficiary += toBeneficiary.toUint128();
        a.protocol += (fee - toBeneficiary).toUint128();

        // Hold the fee as a PoolManager claim; `sweep` turns it into tokens.
        poolManager.mint(address(this), pair.toId(), fee);
        emit FeeTaken(id, fee, toBeneficiary);
    }

    // ---------------------------------------------------------------------
    // Payout
    // ---------------------------------------------------------------------

    /// @notice Pay a pool's accrued fees out to its beneficiary and to the
    ///         protocol fee recipient. Anyone can call; it only moves funds to
    ///         those two addresses.
    function sweep(PoolKey calldata key) external returns (uint256 beneficiaryAmount, uint256 protocolAmount) {
        PoolId id = key.toId();
        PoolTerms storage t = termsOf[id];
        if (!t.set) revert PoolNotConfigured();

        Accrued memory a = accruedOf[id];
        beneficiaryAmount = a.beneficiary;
        protocolAmount = a.protocol;
        if (beneficiaryAmount + protocolAmount == 0) return (0, 0);
        delete accruedOf[id];

        address beneficiary = t.beneficiary;
        poolManager.unlock(
            abi.encode(
                _pairCurrency(key, t.coinIsCurrency0), beneficiary, beneficiaryAmount, protocolFeeRecipient, protocolAmount
            )
        );
        emit FeesSwept(id, beneficiary, beneficiaryAmount, protocolAmount);
    }

    function unlockCallback(bytes calldata data) external override onlyPoolManager returns (bytes memory) {
        (Currency currency, address beneficiary, uint256 toBeneficiary, address protocol, uint256 toProtocol) =
            abi.decode(data, (Currency, address, uint256, address, uint256));
        poolManager.burn(address(this), currency.toId(), toBeneficiary + toProtocol);
        _payOut(currency, beneficiary, toBeneficiary);
        _payOut(currency, protocol, toProtocol);
        return "";
    }

    /// @dev Send tokens; if the recipient cannot take them, leave it a
    ///      PoolManager claim instead so one bad recipient cannot block the other.
    function _payOut(Currency currency, address to, uint256 amount) private {
        if (amount == 0) return;
        try poolManager.take{gas: PAYOUT_GAS}(currency, to, amount) {}
        catch {
            poolManager.mint(to, currency.toId(), amount);
            emit PayoutDeferred(to, currency, amount);
        }
    }

    // ---------------------------------------------------------------------
    // IHooks surface: beforeInitialize, beforeSwap and afterSwap are live.
    // The rest are never reached (the hook address flags gate the calls).
    // ---------------------------------------------------------------------

    function beforeInitialize(address sender, PoolKey calldata, uint160) external view onlyPoolManager returns (bytes4) {
        if (sender != factory) revert NotFactory();
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
