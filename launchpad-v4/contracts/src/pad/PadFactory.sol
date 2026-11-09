// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PadBuybackVault} from "./PadBuybackVault.sol";
import {FeePolicySnapshot, IPadFeeEscrow} from "./IPad.sol";
import {PadHook} from "./PadHook.sol";
import {PadLocker} from "./PadLocker.sol";
import {PadToken} from "./PadToken.sol";

/**
 * @title PadFactory
 * @notice One call, one launch. Clones the token, opens its Uniswap V4 pool
 * against native HYPE (LP fee 0, the Pad hook), places the whole supply
 * into three single-sided positions above the opening price (by default 20%
 * from 50 to 200 HYPE market cap, 30% from 200 to 1,000, 50% from 1,000 to
 * the top of the range), hands the three position NFTs to the locker, takes
 * the launch fee and, if asked, makes the creator's opening buy in the same
 * transaction. No bonding curve, no graduation.
 *
 * The owner surface follows the base launchpad's factory one for one where it applies:
 * launch configs, launch fee, launch switch and whitelist, pair approvals,
 * the creator tax ceiling, the snipe tax terms, the creator's buyback toggle,
 * the creator's self-service fee-recipient transfer and the owner's
 * three-day timelocked override of it, and an economics digest a creator can
 * pin so an owner retune can never land under an in-flight launch.
 */
contract PadFactory is Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    struct LaunchConfig {
        address pairToken; // address(0) = native HYPE, else an approved ERC-20 (a tokenized stock, USDC)
        uint256 supply;
        // Market caps in the pair currency's smallest unit bounding the three positions.
        uint256 startMcap;
        uint256 band1Mcap;
        uint256 band2Mcap;
        // Shares of the supply in the first two positions; the third takes the rest.
        uint16 band0Bps;
        uint16 band1Bps;
        int24 tickSpacing;
        bool enabled;
    }

    // Ticks derived from a config when it is set, so a launch only reads them.
    struct ConfigTicks {
        int24 start;
        int24 band1;
        int24 band2;
        int24 floor;
    }

    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        bytes32 expectedEconomics;
        bytes32 salt;
        uint256 openingBuy;
        uint256 minTokensOut;
    }

    struct LaunchedToken {
        address creator;
        address creatorFeeRecipient;
        uint32 launchConfigId;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint40 launchedAt;
        bool exists;
        address pairToken;
        int24 tickSpacing;
    }

    struct PendingCreatorFeeRecipient {
        address newRecipient;
        uint256 effectiveAt;
        uint256 expiresAt;
    }

    uint256 private constant BASIS_POINTS = 10_000;
    uint256 private constant MAX_CREATOR_TAX_CEILING_BPS = 1_000; // 10%
    uint256 private constant MAX_TOTAL_TRADE_FEE_BPS = 2_000; // 20%, as in the hook
    uint256 private constant MAX_SNIPE_TAX_START_BPS = 9_900; // 99%
    uint256 private constant MAX_SNIPE_TAX_SECONDS = 60;
    uint256 public constant MAX_OPENING_BUY_BPS = 500; // 5% of the supply
    uint256 public constant CREATOR_FEE_RECIPIENT_TIMELOCK = 3 days;
    uint256 public constant CREATOR_FEE_RECIPIENT_EXECUTION_WINDOW = 3 days;
    uint256 private constant MAX_NAME_BYTES = 64;
    uint256 private constant MAX_SYMBOL_BYTES = 20;
    uint256 private constant MAX_DESCRIPTION_BYTES = 1_024;
    uint256 private constant MAX_LOGO_BYTES = 512; // a URL (ipfs:// or https://), never inline image data

    error InvalidLaunchConfigId();
    error InvalidLaunchConfig();
    error LaunchConfigDisabled();
    error InvalidBasisPoints();
    error InvalidSnipeTaxWindow();
    error CreatorTaxTooHigh();
    error CombinedFeeTooHigh();
    error LaunchFeeNotPaid();
    error NotWhitelisted();
    error ZeroAddress();
    error OwnershipCannotBeRenounced();
    error InvalidTokenParams();
    error LogoRequired();
    error LinkInDescription();
    error TokenNotFound();
    error NotCreatorFeeRecipient();
    error NotBuybackController();
    error NoPendingChange();
    error TimelockNotElapsed(uint256 effectiveAt);
    error TimelockExpired(uint256 expiresAt);
    error LaunchDependenciesNotWired();
    error PairTokenValidationFailed();
    error LaunchEconomicsMismatch(bytes32 expected, bytes32 actual);
    error OpeningBuyTooLarge(uint256 tokensOut, uint256 cap);
    error OpeningBuySlippage(uint256 tokensOut, uint256 minimum);
    error NotPoolManager();
    error NoTokenAddressAbovePair();
    error InexactPairTransfer(uint256 expected, uint256 received);

    event TokenLaunched(
        address indexed token,
        address indexed creator,
        PoolId indexed poolId,
        uint256 launchConfigId,
        address pairToken,
        address creatorFeeRecipient,
        uint16 creatorTaxBps,
        bool buybackEnabled,
        uint256[3] positionIds
    );
    event TokenMetadata(
        address indexed token, string name, string symbol, string logo, string description, Socials socials
    );
    event OpeningBuy(address indexed token, address indexed buyer, uint256 hypeIn, uint256 tokensOut);
    event CreatorFeeRecipientUpdated(
        address indexed token, address indexed previousRecipient, address indexed newRecipient
    );
    event CreatorFeeRecipientChangeProposed(
        address indexed token,
        address indexed currentRecipient,
        address indexed proposedRecipient,
        uint256 effectiveAt,
        uint256 expiresAt
    );
    event CreatorFeeRecipientChangeCancelled(address indexed token, address indexed proposedRecipient);
    event LaunchConfigAdded(uint256 indexed id);
    event LaunchConfigUpdated(uint256 indexed id);
    event LaunchFeeUpdated(uint256 launchFee);
    event LaunchEnabledUpdated(bool enabled);
    event WhitelistedLauncherUpdated(address indexed launcher, bool enabled);
    event MaxCreatorTaxUpdated(uint256 bps);
    event SnipeTaxStartBpsUpdated(uint256 bps);
    event SnipeTaxSecondsUpdated(uint256 secondsWindow);
    event PairTokenApprovalUpdated(address indexed pairToken, bool approved);
    event BuybackEnabledUpdated(address indexed token, bool enabled, address indexed controller);

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    PadLocker public immutable locker;
    PadHook public immutable hook;
    IPadFeeEscrow public immutable feeEscrow;
    PadBuybackVault public immutable buybackVault;
    address public immutable tokenImplementation;

    uint256 public launchFee;
    bool public launchEnabled;
    uint256 public maxCreatorTaxBps;
    uint256 public snipeTaxStartBps;
    uint256 public snipeTaxSeconds;

    LaunchConfig[] private _launchConfigs;
    ConfigTicks[] private _configTicks;
    mapping(address => bool) public whitelistedLaunchers;
    // Kept for parity with the base launchpad owner surface. Launches in this version pair
    // with native HYPE only; an ERC-20 pair needs a later factory.
    mapping(address => bool) public approvedPairTokens;
    mapping(address token => LaunchedToken) private _launchedTokens;
    mapping(address token => PendingCreatorFeeRecipient) public pendingCreatorFeeRecipient;
    address[] public allTokens;

    // Set only while this contract's own opening buy is inside poolManager.unlock.
    bool private _inOpeningBuy;

    constructor(
        address initialOwner,
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        IAllowanceTransfer permit2_,
        PadLocker locker_,
        PadHook hook_,
        IPadFeeEscrow feeEscrow_,
        PadBuybackVault buybackVault_,
        address tokenImplementation_,
        uint256 launchFee_
    ) Ownable(initialOwner) {
        if (
            address(poolManager_) == address(0) || address(positionManager_) == address(0)
                || address(permit2_) == address(0) || address(locker_) == address(0) || address(hook_) == address(0)
                || address(feeEscrow_) == address(0) || address(buybackVault_) == address(0)
                || tokenImplementation_ == address(0)
        ) revert ZeroAddress();
        poolManager = poolManager_;
        positionManager = positionManager_;
        permit2 = permit2_;
        locker = locker_;
        hook = hook_;
        feeEscrow = feeEscrow_;
        buybackVault = buybackVault_;
        tokenImplementation = tokenImplementation_;
        launchFee = launchFee_;
        maxCreatorTaxBps = MAX_CREATOR_TAX_CEILING_BPS;
        snipeTaxStartBps = MAX_SNIPE_TAX_START_BPS;
        snipeTaxSeconds = 10;
    }

    // ---------------------------------------------------------------------
    // Owner-only configuration
    // ---------------------------------------------------------------------

    function addLaunchConfig(LaunchConfig calldata config) external onlyOwner returns (uint256 id) {
        ConfigTicks memory ticks = _validateLaunchConfig(config);
        id = _launchConfigs.length;
        _launchConfigs.push(config);
        _configTicks.push(ticks);
        emit LaunchConfigAdded(id);
    }

    function updateLaunchConfig(uint256 id, LaunchConfig calldata config) external onlyOwner {
        if (id >= _launchConfigs.length) revert InvalidLaunchConfigId();
        ConfigTicks memory ticks = _validateLaunchConfig(config);
        _launchConfigs[id] = config;
        _configTicks[id] = ticks;
        emit LaunchConfigUpdated(id);
    }

    function setLaunchFee(uint256 newLaunchFee) external onlyOwner {
        launchFee = newLaunchFee;
        emit LaunchFeeUpdated(newLaunchFee);
    }

    function setLaunchEnabled(bool enabled) external onlyOwner {
        launchEnabled = enabled;
        emit LaunchEnabledUpdated(enabled);
    }

    function setWhitelistedLauncher(address launcher, bool enabled) external onlyOwner {
        if (launcher == address(0)) revert ZeroAddress();
        whitelistedLaunchers[launcher] = enabled;
        emit WhitelistedLauncherUpdated(launcher, enabled);
    }

    function canLaunch(address launcher) public view returns (bool) {
        return launchEnabled || whitelistedLaunchers[launcher];
    }

    function setPairTokenApproved(address pairToken, bool approved) external onlyOwner {
        if (pairToken == address(0) || (approved && pairToken.code.length == 0)) revert PairTokenValidationFailed();
        approvedPairTokens[pairToken] = approved;
        emit PairTokenApprovalUpdated(pairToken, approved);
    }

    function setMaxCreatorTaxBps(uint256 bps) external onlyOwner {
        if (bps > MAX_CREATOR_TAX_CEILING_BPS) revert InvalidBasisPoints();
        maxCreatorTaxBps = bps;
        emit MaxCreatorTaxUpdated(bps);
    }

    function setSnipeTaxStartBps(uint256 bps) external onlyOwner {
        if (bps != 0 && (bps <= MAX_TOTAL_TRADE_FEE_BPS || bps > MAX_SNIPE_TAX_START_BPS)) {
            revert InvalidBasisPoints();
        }
        snipeTaxStartBps = bps;
        emit SnipeTaxStartBpsUpdated(bps);
    }

    function setSnipeTaxSeconds(uint256 secondsWindow) external onlyOwner {
        if (secondsWindow == 0 || secondsWindow > MAX_SNIPE_TAX_SECONDS) revert InvalidSnipeTaxWindow();
        snipeTaxSeconds = secondsWindow;
        emit SnipeTaxSecondsUpdated(secondsWindow);
    }

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    // ---------------------------------------------------------------------
    // Creator fee recipient and buyback toggle (the base launchpad semantics)
    // ---------------------------------------------------------------------

    /**
     * @notice The creator fee recipient hands the role to a new address.
     */
    function transferCreatorFeeRecipient(address token, address newRecipient) external {
        LaunchedToken storage rec = _launchedTokens[token];
        if (!rec.exists) revert TokenNotFound();
        if (msg.sender != rec.creatorFeeRecipient) revert NotCreatorFeeRecipient();
        _setCreatorFeeRecipient(token, rec, newRecipient);
    }

    /**
     * @notice Owner override, for recovering a compromised creator key:
     * proposes a new recipient that anyone can execute after three days and
     * within the following three days. The owner can cancel it meanwhile.
     */
    function setCreatorFeeRecipient(address token, address newRecipient) external onlyOwner {
        LaunchedToken storage rec = _launchedTokens[token];
        if (!rec.exists) revert TokenNotFound();
        if (newRecipient == address(0)) revert ZeroAddress();
        uint256 effectiveAt = block.timestamp + CREATOR_FEE_RECIPIENT_TIMELOCK;
        uint256 expiresAt = effectiveAt + CREATOR_FEE_RECIPIENT_EXECUTION_WINDOW;
        pendingCreatorFeeRecipient[token] =
            PendingCreatorFeeRecipient({newRecipient: newRecipient, effectiveAt: effectiveAt, expiresAt: expiresAt});
        emit CreatorFeeRecipientChangeProposed(token, rec.creatorFeeRecipient, newRecipient, effectiveAt, expiresAt);
    }

    function executeCreatorFeeRecipientChange(address token) external {
        PendingCreatorFeeRecipient memory pending = pendingCreatorFeeRecipient[token];
        if (pending.newRecipient == address(0)) revert NoPendingChange();
        if (block.timestamp < pending.effectiveAt) revert TimelockNotElapsed(pending.effectiveAt);
        if (block.timestamp > pending.expiresAt) revert TimelockExpired(pending.expiresAt);
        delete pendingCreatorFeeRecipient[token];
        _setCreatorFeeRecipient(token, _launchedTokens[token], pending.newRecipient);
    }

    function cancelCreatorFeeRecipientChange(address token) external onlyOwner {
        PendingCreatorFeeRecipient memory pending = pendingCreatorFeeRecipient[token];
        if (pending.newRecipient == address(0)) revert NoPendingChange();
        delete pendingCreatorFeeRecipient[token];
        emit CreatorFeeRecipientChangeCancelled(token, pending.newRecipient);
    }

    /**
     * @notice The creator may turn buyback on or off; the owner may only turn
     * it off. Applies to fees charged from then on.
     */
    function setBuybackEnabled(address token, bool enabled) external {
        LaunchedToken storage rec = _launchedTokens[token];
        if (!rec.exists) revert TokenNotFound();
        bool isCreator = msg.sender == rec.creatorFeeRecipient;
        if (!isCreator && msg.sender != owner()) revert NotBuybackController();
        if (enabled && !isCreator) revert NotBuybackController();
        rec.buybackEnabled = enabled;
        hook.setBuybackEnabled(_poolKeyOf(token, rec).toId(), enabled);
        emit BuybackEnabledUpdated(token, enabled, msg.sender);
    }

    function _setCreatorFeeRecipient(address token, LaunchedToken storage rec, address newRecipient) private {
        if (newRecipient == address(0)) revert ZeroAddress();
        address previousRecipient = rec.creatorFeeRecipient;
        rec.creatorFeeRecipient = newRecipient;
        hook.setCreatorFeeRecipient(_poolKeyOf(token, rec).toId(), newRecipient);
        buybackVault.updateCreatorRecipient(token, newRecipient);
        emit CreatorFeeRecipientUpdated(token, previousRecipient, newRecipient);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function launchConfigCount() external view returns (uint256) {
        return _launchConfigs.length;
    }

    function getLaunchConfig(uint256 id) external view returns (LaunchConfig memory config, ConfigTicks memory ticks) {
        if (id >= _launchConfigs.length) revert InvalidLaunchConfigId();
        return (_launchConfigs[id], _configTicks[id]);
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory) {
        return _launchedTokens[token];
    }

    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    function poolKeyOf(address token) external view returns (PoolKey memory) {
        LaunchedToken storage rec = _launchedTokens[token];
        if (!rec.exists) revert TokenNotFound();
        return _poolKeyOf(token, rec);
    }

    /**
     * @notice The address a launch by `creator` with `salt` gets. Front ends
     * mine the salt for a vanity suffix.
     */
    function predictTokenAddress(address creator, bytes32 salt, uint256 launchConfigId) external view returns (address token) {
        if (launchConfigId >= _launchConfigs.length) revert InvalidLaunchConfigId();
        (token,) = _tokenSalt(creator, salt, _launchConfigs[launchConfigId].pairToken);
    }

    /**
     * @dev The clone salt for a launch, varied until the token's address sorts
     * above the pair's, so the pair is always currency0 of the pool.
     */
    function _tokenSalt(address creator, bytes32 salt, address pair) private view returns (address token, bytes32 cloneSalt) {
        bytes32 bytecodeHash = keccak256(_cloneCode(tokenImplementation));
        for (uint256 i; i < 128; ++i) {
            cloneSalt = _cloneSalt(creator, i == 0 ? salt : keccak256(abi.encodePacked(salt, i)));
            token = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), cloneSalt, bytecodeHash)))));
            if (token > pair && token.code.length == 0) return (token, cloneSalt);
        }
        revert NoTokenAddressAbovePair();
    }

    /**
     * @notice Digest of every owner-settable term a launch on `launchConfigId`
     * would get right now. A creator passes it as `expectedEconomics` so a
     * retune landing first makes the launch revert instead of changing it.
     */
    function previewLaunchEconomics(uint256 launchConfigId) public view returns (bytes32) {
        if (launchConfigId >= _launchConfigs.length) revert InvalidLaunchConfigId();
        LaunchConfig memory config = _launchConfigs[launchConfigId];
        FeePolicySnapshot memory policy = hook.currentFeePolicy();
        return keccak256(
            abi.encode(
                config,
                policy.protocolFeeShareBps,
                policy.buybackBurnBps,
                policy.hookFeeBps,
                policy.maxInternalPriceImpactBps,
                hook.volThresholdBps(),
                hook.volWindow(),
                hook.volExtraBps(),
                hook.volDecay(),
                snipeTaxStartBps,
                snipeTaxSeconds,
                launchFee
            )
        );
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /**
     * @notice Launches a token. `msg.value` must be the launch fee plus the
     * opening buy, exactly.
     */
    function launch(TokenParams calldata params, uint256 launchConfigId)
        external
        payable
        nonReentrant
        returns (address token)
    {
        if (!canLaunch(msg.sender)) revert NotWhitelisted();
        if (launchConfigId >= _launchConfigs.length) revert InvalidLaunchConfigId();
        LaunchConfig memory config = _launchConfigs[launchConfigId];
        if (!config.enabled) revert LaunchConfigDisabled();
        if (config.pairToken != address(0) && !approvedPairTokens[config.pairToken]) revert PairTokenValidationFailed();
        if (msg.value != launchFee + (config.pairToken == address(0) ? params.openingBuy : 0)) revert LaunchFeeNotPaid();
        _requireLaunchDependenciesWired();
        _validateTokenParams(params);

        bytes32 economics = previewLaunchEconomics(launchConfigId);
        if (params.expectedEconomics != bytes32(0) && params.expectedEconomics != economics) {
            revert LaunchEconomicsMismatch(params.expectedEconomics, economics);
        }
        FeePolicySnapshot memory policy = hook.currentFeePolicy();
        if (uint256(params.creatorTaxBps) + policy.hookFeeBps > MAX_TOTAL_TRADE_FEE_BPS) revert CombinedFeeTooHigh();
        address feeRecipient = params.creatorFeeRecipient == address(0) ? msg.sender : params.creatorFeeRecipient;

        // 1. the token, with the whole supply minted here
        (, bytes32 cloneSalt) = _tokenSalt(msg.sender, params.salt, config.pairToken);
        token = _clone(tokenImplementation, cloneSalt);
        PadToken(token).initialize(params.name, params.symbol, config.supply, address(this));

        // 2. the pool, opening at the start market cap, registered with the hook
        ConfigTicks memory ticks = _configTicks[launchConfigId];
        PoolKey memory key = _poolKey(token, config.pairToken, config.tickSpacing);
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(ticks.start));
        hook.registerPool(
            key,
            token,
            feeRecipient,
            feeRecipient,
            params.creatorTaxBps,
            params.buybackEnabled,
            policy,
            uint16(snipeTaxStartBps),
            uint32(snipeTaxSeconds)
        );

        // 3. the three positions, minted straight to the locker
        uint256[3] memory ids = _mintPositions(token, key, config, ticks);
        locker.lockPositions(token, ids);
        // Rounding leaves a few wei of the supply here; they go to the locker with the positions.
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust != 0) IERC20(token).transfer(address(locker), dust);

        _launchedTokens[token] = LaunchedToken({
            creator: msg.sender,
            creatorFeeRecipient: feeRecipient,
            launchConfigId: uint32(launchConfigId),
            creatorTaxBps: params.creatorTaxBps,
            buybackEnabled: params.buybackEnabled,
            launchedAt: uint40(block.timestamp),
            exists: true,
            pairToken: config.pairToken,
            tickSpacing: config.tickSpacing
        });
        allTokens.push(token);

        // 4. the launch fee, to the protocol's escrow balance
        if (launchFee != 0) feeEscrow.credit{value: launchFee}(hook.protocolFeeRecipient());

        emit TokenLaunched(
            token, msg.sender, key.toId(), launchConfigId, config.pairToken, feeRecipient, params.creatorTaxBps, params.buybackEnabled, ids
        );
        emit TokenMetadata(token, params.name, params.symbol, params.logo, params.description, params.socials);

        // 5. the opening buy, exempt from the snipe tax, capped at 5% of the supply
        if (params.openingBuy != 0) {
            if (config.pairToken != address(0)) {
                uint256 before = IERC20(config.pairToken).balanceOf(address(this));
                IERC20(config.pairToken).safeTransferFrom(msg.sender, address(this), params.openingBuy);
                uint256 got = IERC20(config.pairToken).balanceOf(address(this)) - before;
                if (got != params.openingBuy) revert InexactPairTransfer(params.openingBuy, got);
            }
            _inOpeningBuy = true;
            bytes memory res = poolManager.unlock(abi.encode(key, params.openingBuy, msg.sender));
            _inOpeningBuy = false;
            uint256 tokensOut = abi.decode(res, (uint256));
            uint256 cap = (config.supply * MAX_OPENING_BUY_BPS) / BASIS_POINTS;
            if (tokensOut > cap) revert OpeningBuyTooLarge(tokensOut, cap);
            if (tokensOut < params.minTokensOut) revert OpeningBuySlippage(tokensOut, params.minTokensOut);
            emit OpeningBuy(token, msg.sender, params.openingBuy, tokensOut);
        }
    }

    /**
     * @dev The opening buy: an exact-input HYPE-for-token swap whose output
     * goes straight to the creator.
     */
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !_inOpeningBuy) revert NotPoolManager();
        (PoolKey memory key, uint256 pairIn, address buyer) = abi.decode(data, (PoolKey, uint256, address));
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -SafeCast.toInt256(pairIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );
        uint256 owed = uint256(uint128(-delta.amount0()));
        uint256 tokensOut = uint256(uint128(delta.amount1()));
        poolManager.sync(key.currency0);
        if (key.currency0.isAddressZero()) {
            poolManager.settle{value: owed}();
        } else {
            IERC20(Currency.unwrap(key.currency0)).safeTransfer(address(poolManager), owed);
            poolManager.settle();
        }
        poolManager.take(key.currency1, buyer, tokensOut);
        // An opening buy can only stop short of its input at the top of the range; return the rest.
        if (owed < pairIn) {
            if (key.currency0.isAddressZero()) {
                (bool ok,) = buyer.call{value: pairIn - owed}("");
                if (!ok) revert LaunchFeeNotPaid();
            } else {
                IERC20(Currency.unwrap(key.currency0)).safeTransfer(buyer, pairIn - owed);
            }
        }
        return abi.encode(tokensOut);
    }

    function _mintPositions(address token, PoolKey memory key, LaunchConfig memory config, ConfigTicks memory ticks)
        private
        returns (uint256[3] memory ids)
    {
        uint256 a0 = (config.supply * config.band0Bps) / BASIS_POINTS;
        uint256 a1 = (config.supply * config.band1Bps) / BASIS_POINTS;
        uint256 a2 = config.supply - a0 - a1;

        IERC20(token).approve(address(permit2), config.supply);
        permit2.approve(token, address(positionManager), uint160(config.supply), 0);

        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION), uint8(Actions.MINT_POSITION), uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE)
        );
        bytes[] memory params = new bytes[](4);
        params[0] = _mintParams(key, ticks.band1, ticks.start, a0);
        params[1] = _mintParams(key, ticks.band2, ticks.band1, a1);
        params[2] = _mintParams(key, ticks.floor, ticks.band2, a2);
        // amount 0 = the whole open debt, paid by this contract through Permit2
        params[3] = abi.encode(key.currency1, uint256(0), true);

        uint256 first = positionManager.nextTokenId();
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
        ids = [first, first + 1, first + 2];
    }

    function _mintParams(PoolKey memory key, int24 lower, int24 upper, uint256 amount1)
        private
        view
        returns (bytes memory)
    {
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount1(
            TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), amount1
        );
        return abi.encode(key, lower, upper, uint256(liquidity), uint128(0), uint128(amount1), address(locker), bytes(""));
    }

    function _poolKeyOf(address token, LaunchedToken storage rec) private view returns (PoolKey memory) {
        return _poolKey(token, rec.pairToken, rec.tickSpacing);
    }

    function _poolKey(address token, address pair, int24 tickSpacing) private view returns (PoolKey memory) {
        // The token is cloned above the pair's address (native HYPE is address(0)), so the pair is always currency0.
        return PoolKey({
            currency0: Currency.wrap(pair),
            currency1: Currency.wrap(token),
            fee: 0,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(hook))
        });
    }

    // ---------------------------------------------------------------------
    // Validation
    // ---------------------------------------------------------------------

    /**
     * @dev With HYPE as currency0 and the token as currency1, the pool price
     * is tokens per HYPE, supply / market cap: it falls as the market cap
     * rises. The three positions sit below the opening tick, so they hold
     * only the token until buys walk the price down into them.
     */
    function _validateLaunchConfig(LaunchConfig calldata c) private view returns (ConfigTicks memory t) {
        if (c.pairToken != address(0) && !approvedPairTokens[c.pairToken]) revert PairTokenValidationFailed();
        if (c.tickSpacing <= 0 || c.tickSpacing > 16_384) revert InvalidLaunchConfig();
        if (c.supply < 1e18 || c.supply > type(uint128).max) revert InvalidLaunchConfig();
        if (c.startMcap == 0 || c.band1Mcap <= c.startMcap || c.band2Mcap <= c.band1Mcap) revert InvalidLaunchConfig();
        if (c.band0Bps == 0 || c.band1Bps == 0 || uint256(c.band0Bps) + c.band1Bps >= BASIS_POINTS) {
            revert InvalidLaunchConfig();
        }
        t.start = _tickForMcap(c.supply, c.startMcap, c.tickSpacing);
        t.band1 = _tickForMcap(c.supply, c.band1Mcap, c.tickSpacing);
        t.band2 = _tickForMcap(c.supply, c.band2Mcap, c.tickSpacing);
        t.floor = TickMath.minUsableTick(c.tickSpacing);
        if (!(t.start > t.band1 && t.band1 > t.band2 && t.band2 > t.floor)) revert InvalidLaunchConfig();
        if (t.start > TickMath.maxUsableTick(c.tickSpacing)) revert InvalidLaunchConfig();
    }

    function _tickForMcap(uint256 supply, uint256 mcap, int24 spacing) private pure returns (int24) {
        // sqrt(supply / mcap) in Q96: sqrt(supply * 2^128 / mcap) is that root in Q64.
        uint256 sqrtX64 = Math.sqrt(FullMath.mulDiv(supply, 1 << 128, mcap));
        uint256 sqrtX96 = sqrtX64 << 32;
        if (sqrtX96 <= TickMath.MIN_SQRT_PRICE || sqrtX96 >= TickMath.MAX_SQRT_PRICE) revert InvalidLaunchConfig();
        int24 tick = TickMath.getTickAtSqrtPrice(uint160(sqrtX96));
        int24 rounded = (tick / spacing) * spacing;
        if (tick < 0 && rounded != tick) rounded -= spacing;
        return rounded;
    }

    function _validateTokenParams(TokenParams calldata p) private view {
        uint256 n = bytes(p.name).length;
        uint256 s = bytes(p.symbol).length;
        if (n == 0 || n > MAX_NAME_BYTES || s == 0 || s > MAX_SYMBOL_BYTES) revert InvalidTokenParams();
        if (bytes(p.description).length > MAX_DESCRIPTION_BYTES) revert InvalidTokenParams();
        uint256 l = bytes(p.logo).length;
        if (l == 0 || l > MAX_LOGO_BYTES) revert LogoRequired(); // every token launches with an image
        if (p.creatorTaxBps > maxCreatorTaxBps) revert CreatorTaxTooHigh();
        if (_hasLink(bytes(p.description))) revert LinkInDescription();
    }

    /// @dev "://" or "www." anywhere in the description, case-insensitive for "www".
    function _hasLink(bytes calldata d) private pure returns (bool) {
        uint256 len = d.length;
        if (len < 3) return false;
        for (uint256 i; i + 2 < len; ++i) {
            if (d[i] == ":" && d[i + 1] == "/" && d[i + 2] == "/") return true;
            if (i + 3 < len && d[i + 3] == ".") {
                bytes1 a = d[i] | 0x20;
                bytes1 b = d[i + 1] | 0x20;
                bytes1 c = d[i + 2] | 0x20;
                if (a == "w" && b == "w" && c == "w") return true;
            }
        }
        return false;
    }

    function _requireLaunchDependenciesWired() private view {
        if (
            hook.factory() != address(this) || address(hook.buybackVault()) != address(buybackVault)
                || locker.factory() != address(this) || buybackVault.factory() != address(this)
        ) revert LaunchDependenciesNotWired();
    }

    // ---------------------------------------------------------------------
    // EIP-1167 clones
    // ---------------------------------------------------------------------

    function _cloneSalt(address creator, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(creator, salt));
    }

    function _cloneCode(address implementation) private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }

    function _clone(address implementation, bytes32 salt) private returns (address instance) {
        bytes memory code = _cloneCode(implementation);
        assembly {
            instance := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (instance == address(0)) revert InvalidTokenParams();
    }
}
