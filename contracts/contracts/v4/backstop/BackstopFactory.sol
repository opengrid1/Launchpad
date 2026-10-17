// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {BackstopToken} from "./BackstopToken.sol";
import {BackstopTokenDeployer} from "./BackstopTokenDeployer.sol";
import {BackstopStrategy} from "./BackstopStrategy.sol";
import {BackstopStrategyDeployer} from "./BackstopStrategyDeployer.sol";
import {BackstopHook} from "./BackstopHook.sol";
import {BackstopOracle} from "./BackstopOracle.sol";

interface IBackstopPairRouter {
    function ethToPair(address pair, bytes calldata route, address to, uint256 minOut) external payable returns (uint256 pairOut);
}

/// @title BackstopFactory
/// @notice One-transaction launcher for Backstop strategy coins on Ethereum /
///         Uniswap V4. A coin is backed by WETH or any token the oracle can
///         price. The whole 1B supply seeds a single-sided, factory-held V4
///         position at the start cap; the coin's strategy contract, pool rules
///         and tax split are fixed in the same transaction and nothing changes
///         them afterwards.
///
///         The creator picks: the tax (1% to 10% in 0.5% steps, 1% of every
///         trade to the platform), how the rest splits between themselves,
///         holders, the vault, the buyback fund, auto-LP and auto-burn,
///         take-profit, redeem, holder payout and basket, vesting of their own
///         share, and the pool protections (dynamic tax, anti-snipe, anti-MEV,
///         max per trade). An optional first buy is paid in ETH.
///
///         Ownership (setup rights) is renounced after deploy; the immutable
///         `admin` keeps: pause, listing visibility, metadata edits (stored
///         here; the coin stays immutable), token blocking, the fee recipient,
///         the start cap and auto-LP threshold for future use, and collecting
///         from a coin's launch position. The admin cannot mint, change any
///         coin's tax or split, touch a vault or buyback fund, freeze transfers
///         or move anyone's coins.
contract BackstopFactory is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant TOTAL_SUPPLY_WHOLE = 1_000_000_000;
    int24 public constant TICK_SPACING = 60;
    uint24 public constant LP_FEE = 0;
    uint16 public constant PLATFORM_BPS = 100;
    uint16 public constant MIN_TAX_BPS = 100;
    uint16 public constant MAX_TAX_BPS = 1_000;
    uint16 public constant TAX_STEP_BPS = 50;
    uint16 public constant SPLIT_STEP_BPS = 5;
    uint32 public constant MAX_VEST = 365 days;
    uint16 public constant MAX_SNIPE_SECS = 600;
    uint16 public constant MIN_MAX_TX_BPS = 10;
    uint16 public constant MAX_MAX_TX_BPS = 250;

    IPoolManager public immutable poolManager;
    BackstopHook public immutable hook;
    address public immutable weth;
    address public immutable admin;
    BackstopTokenDeployer public immutable tokenDeployer;
    BackstopStrategyDeployer public immutable strategyDeployer;
    BackstopOracle public immutable oracle;

    address public converter;
    address public feeRecipient;
    bool public launchesPaused;
    /// @notice Market cap new coins start at, USD 8 dp. Existing coins are unaffected.
    uint256 public startCapUsd8 = 5_000e8;
    /// @notice Auto-LP adds liquidity once its share is worth this, USD 18 dp.
    uint256 public lpThresholdUsd = 250e18;

    mapping(address => bool) public blocked;

    struct Listing {
        address creator;
        address pair;
        address strategy;
        uint16 taxBps;
        uint64 createdAt;
        bytes32 poolId;
    }
    mapping(address token => Listing) public listings;
    mapping(address token => bool) public hidden;
    mapping(address token => string) public metadataOverride;
    address[] public allTokens;
    address public owner;

    struct Position {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }
    mapping(address token => Position) public positions;

    /// @dev Shares of every trade, bps; together with the platform's 1% they add up to the tax.
    struct Split {
        uint16 creator;
        uint16 holders;
        uint16 vault;
        uint16 buyback;
        uint16 lp;
        uint16 burn;
    }

    struct Options {
        uint16 tpBps; // 0, 2500, 5000 or 10000
        bool redeemable;
        uint32 vestSecs;
        uint8 payout; // 0 backing token, 1 ETH, 2 basket
    }

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        address pair; // zero for WETH
        uint256 minPairOut;
        BackstopHook.Rules rules;
        Split split;
        Options options;
        address[] basket;
        BackstopOracle.SourceParams[] sources;
    }

    event Launched(address indexed token, address indexed creator, address indexed pair, address strategy, bytes32 poolId, uint16 taxBps, uint256 pairUsdPrice);
    event DevBought(address indexed token, address indexed creator, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event HiddenSet(address indexed token, bool hidden);
    event CoinMetadataSet(address indexed token, string uri);
    event LaunchesPausedSet(bool paused);
    event FeeRecipientSet(address indexed recipient);
    event ConverterSet(address indexed converter);
    event OwnershipRenounced();
    event TokenBlocked(address indexed token, bool blocked);
    event StartCapSet(uint256 usd8);
    event LpThresholdSet(uint256 usd18);
    event Collected(address indexed token, uint128 liquidity, uint256 tokenAmount, uint256 pairAmount, address indexed to);

    error LaunchesPaused();
    error InvalidParams();
    error NotAdmin();
    error ZeroAddress();
    error Blocked();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAdminOrOwner() {
        if (msg.sender != admin && msg.sender != owner) revert NotAdmin();
        _;
    }

    constructor(
        address owner_,
        address admin_,
        IPoolManager poolManager_,
        BackstopHook hook_,
        BackstopTokenDeployer tokenDeployer_,
        BackstopStrategyDeployer strategyDeployer_,
        address weth_,
        BackstopOracle oracle_,
        address feeRecipient_
    ) {
        if (admin_ == address(0) || weth_ == address(0) || address(oracle_) == address(0)) revert ZeroAddress();
        owner = owner_;
        admin = admin_;
        poolManager = poolManager_;
        hook = hook_;
        tokenDeployer = tokenDeployer_;
        strategyDeployer = strategyDeployer_;
        weth = weth_;
        oracle = oracle_;
        feeRecipient = feeRecipient_ == address(0) ? admin_ : feeRecipient_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function pause() external onlyAdmin {
        launchesPaused = true;
        emit LaunchesPausedSet(true);
    }

    function resume() external onlyAdmin {
        launchesPaused = false;
        emit LaunchesPausedSet(false);
    }

    /// @notice Hide a coin from listings; it keeps trading.
    function setHidden(address token, bool hidden_) external onlyAdmin {
        if (listings[token].createdAt == 0) revert InvalidParams();
        hidden[token] = hidden_;
        emit HiddenSet(token, hidden_);
    }

    /// @notice Edit a coin's displayed metadata; empty restores the coin's own.
    function setCoinMetadata(address token, string calldata uri) external onlyAdmin {
        if (listings[token].createdAt == 0) revert InvalidParams();
        metadataOverride[token] = uri;
        emit CoinMetadataSet(token, uri);
    }

    function metadataOf(address token) external view returns (string memory) {
        string memory o = metadataOverride[token];
        return bytes(o).length > 0 ? o : BackstopToken(token).metadataURI();
    }

    function setFeeRecipient(address recipient) external onlyAdmin {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice One-time: the router (ETH <-> backing token routing).
    function setConverter(address converter_) external onlyAdminOrOwner {
        if (converter != address(0) || converter_ == address(0)) revert InvalidParams();
        converter = converter_;
        emit ConverterSet(converter_);
    }

    /// @notice Block or unblock a token as a backing token or basket asset. Coins already launched keep trading.
    function setTokenBlocked(address token, bool blocked_) external onlyAdmin {
        if (token == address(0) || token == weth) revert InvalidParams();
        blocked[token] = blocked_;
        emit TokenBlocked(token, blocked_);
    }

    /// @notice Start cap for coins launched from now on, USD 8 dp ($1,000 to $100,000).
    function setStartCap(uint256 usd8) external onlyAdmin {
        if (usd8 < 1_000e8 || usd8 > 100_000e8) revert InvalidParams();
        startCapUsd8 = usd8;
        emit StartCapSet(usd8);
    }

    /// @notice Value at which auto-LP adds liquidity, USD 18 dp ($50 to $10,000).
    function setLpThreshold(uint256 usd18) external onlyAdmin {
        if (usd18 < 50e18 || usd18 > 10_000e18) revert InvalidParams();
        lpThresholdUsd = usd18;
        emit LpThresholdSet(usd18);
    }

    /// @notice Give up the deployer's setup rights; the admin keeps its own.
    function renounceOwnership() external {
        if (msg.sender != owner) revert NotAdmin();
        owner = address(0);
        emit OwnershipRenounced();
    }

    /// @notice Pull `liquidityBps` of a coin's launch position out of the pool
    ///         to `recipient`. Liquidity added later by auto-LP is never touched.
    function collect(address token, uint16 liquidityBps, address recipient)
        external
        onlyAdmin
        nonReentrant
        returns (uint256 tokenAmount, uint256 pairAmount)
    {
        if (liquidityBps == 0 || liquidityBps > 10_000 || recipient == address(0)) revert InvalidParams();
        Position storage pos = positions[token];
        uint128 held = pos.liquidity;
        uint128 removed = uint128((uint256(held) * liquidityBps) / 10_000);
        if (removed == 0) revert InvalidParams();
        pos.liquidity = held - removed;
        (PoolKey memory key, bool tokenIsCurrency0) = _key(token, listings[token].pair);
        bytes memory res = poolManager.unlock(abi.encode(uint8(2), abi.encode(key, pos.tickLower, pos.tickUpper, removed, recipient, tokenIsCurrency0)));
        (tokenAmount, pairAmount) = abi.decode(res, (uint256, uint256));
        emit Collected(token, removed, tokenAmount, pairAmount, recipient);
    }

    /// @notice Push the platform share waiting in each coin's strategy to the fee recipient. Anyone.
    function pushPlatformFees(address[] calldata tokens) external {
        for (uint256 i; i < tokens.length; i++) {
            address s = listings[tokens[i]].strategy;
            if (s == address(0)) revert InvalidParams();
            BackstopStrategy(s).payPlatform();
        }
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /// @notice Launch a strategy coin. Any ETH sent is the creator's first buy:
    ///         the router turns it into the backing token along `route` (empty
    ///         for WETH), it is swapped in the fresh pool and the coins go to
    ///         the creator.
    function launch(LaunchParams calldata p, bytes32 salt, bytes calldata route) external payable nonReentrant returns (address token, bytes32 poolId) {
        PoolKey memory key;
        bool tokenIsCurrency0;
        address pair;
        (token, poolId, key, tokenIsCurrency0, pair) = _launch(p, salt);
        if (msg.value > 0) {
            if (converter == address(0)) revert InvalidParams();
            uint256 pairIn = IBackstopPairRouter(converter).ethToPair{value: msg.value}(pair, route, address(this), p.minPairOut);
            bytes memory res = poolManager.unlock(abi.encode(uint8(1), abi.encode(key, tokenIsCurrency0, pairIn, msg.sender)));
            emit DevBought(token, msg.sender, msg.value, pairIn, abi.decode(res, (uint256)));
        }
    }

    function _check(LaunchParams calldata p) internal view {
        if (launchesPaused) revert LaunchesPaused();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0 || converter == address(0)) revert InvalidParams();
        BackstopHook.Rules calldata r = p.rules;
        if (r.taxBps < MIN_TAX_BPS || r.taxBps > MAX_TAX_BPS || r.taxBps % TAX_STEP_BPS != 0) revert InvalidParams();
        if (r.dynMaxBps != 0 && (r.dynMaxBps <= r.taxBps || r.dynMaxBps > MAX_TAX_BPS || r.dynMaxBps % TAX_STEP_BPS != 0)) revert InvalidParams();
        if (r.snipeBps != 0 && (r.snipeSecs == 0 || r.snipeSecs > MAX_SNIPE_SECS)) revert InvalidParams();
        if (r.maxTxBps != 0 && (r.maxTxBps < MIN_MAX_TX_BPS || r.maxTxBps > MAX_MAX_TX_BPS)) revert InvalidParams();
        Split calldata s = p.split;
        uint256 sum = uint256(s.creator) + s.holders + s.vault + s.buyback + s.lp + s.burn;
        if (sum + PLATFORM_BPS != r.taxBps) revert InvalidParams();
        if (s.creator % SPLIT_STEP_BPS != 0 || s.holders % SPLIT_STEP_BPS != 0 || s.vault % SPLIT_STEP_BPS != 0
            || s.buyback % SPLIT_STEP_BPS != 0 || s.lp % SPLIT_STEP_BPS != 0 || s.burn % SPLIT_STEP_BPS != 0) revert InvalidParams();
        Options calldata o = p.options;
        if (o.tpBps != 0 && o.tpBps != 2_500 && o.tpBps != 5_000 && o.tpBps != 10_000) revert InvalidParams();
        if ((o.tpBps != 0 || o.redeemable) && s.vault == 0) revert InvalidParams();
        if (o.vestSecs > MAX_VEST || o.payout > 2) revert InvalidParams();
        if (p.basket.length > 4 || (p.basket.length != 0 && s.holders == 0) || (o.payout == 2 && p.basket.length == 0)) revert InvalidParams();
    }

    function _launch(LaunchParams calldata p, bytes32 salt)
        internal
        returns (address token, bytes32 poolId, PoolKey memory key, bool tokenIsCurrency0, address pair)
    {
        _check(p);
        pair = p.pair == address(0) ? weth : p.pair;
        for (uint256 i; i < p.sources.length; i++) oracle.register(p.sources[i]);
        uint256 pairUsd18 = _priced(pair);
        for (uint256 i; i < p.basket.length; i++) {
            if (p.basket[i] == address(0)) revert InvalidParams();
            if (p.basket[i] != weth) _priced(p.basket[i]);
            for (uint256 j; j < i; j++) if (p.basket[j] == p.basket[i]) revert InvalidParams();
        }

        token = tokenDeployer.deploy(
            salt,
            BackstopToken.Init({
                name: p.name,
                symbol: p.symbol,
                metadataURI: p.metadataURI,
                supply: TOTAL_SUPPLY,
                creator: msg.sender,
                factory: address(this),
                pairAsset: pair,
                poolManager: address(poolManager),
                hook: address(hook),
                converter: converter,
                payout: p.options.payout,
                basket: p.basket
            })
        );
        address strategy = _deployStrategy(salt, p, token, pair);
        BackstopToken(token).setStrategy(strategy);

        (key, tokenIsCurrency0) = _key(token, pair);
        (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = _initialPosition(tokenIsCurrency0, _priceQ(pairUsd18));
        poolManager.initialize(key, sqrtPriceX96);
        uint128 liquidity = tokenIsCurrency0
            ? LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY);
        positions[token] = Position({tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity});
        poolManager.unlock(abi.encode(uint8(0), abi.encode(key, tickLower, tickUpper, liquidity, address(0), tokenIsCurrency0)));

        poolId = PoolId.unwrap(key.toId());
        hook.registerPool(key, token, pair, strategy, p.rules);
        listings[token] = Listing({creator: msg.sender, pair: pair, strategy: strategy, taxBps: p.rules.taxBps, createdAt: uint64(block.timestamp), poolId: poolId});
        allTokens.push(token);
        emit Launched(token, msg.sender, pair, strategy, poolId, p.rules.taxBps, pairUsd18);
    }

    function _deployStrategy(bytes32 salt, LaunchParams calldata p, address token, address pair) internal returns (address) {
        return strategyDeployer.deploy(
            salt,
            BackstopStrategy.Init({
                factory: address(this),
                hook: address(hook),
                poolManager: address(poolManager),
                oracle: address(oracle),
                token: token,
                pair: pair,
                creator: msg.sender,
                taxBps: p.rules.taxBps,
                creatorBps: p.split.creator,
                holderBps: p.split.holders,
                vaultBps: p.split.vault,
                buybackBps: p.split.buyback,
                lpBps: p.split.lp,
                burnBps: p.split.burn,
                tpBps: p.options.tpBps,
                redeemable: p.options.redeemable,
                vestSecs: p.options.vestSecs
            })
        );
    }

    function _priced(address token) internal returns (uint256 px) {
        if (blocked[token]) revert Blocked();
        px = oracle.launchPrice(token);
    }

    // ---------------------------------------------------------------------
    // PoolManager callbacks: seed liquidity (0), dev buy (1), admin collect (2)
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotAdmin();
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        return action == 1 ? _devBuy(payload) : _modify(action, payload);
    }

    function _modify(uint8 action, bytes memory payload) private returns (bytes memory) {
        (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity, address to, bool tokenIsCurrency0) =
            abi.decode(payload, (PoolKey, int24, int24, uint128, address, bool));
        int256 ld = int256(uint256(liquidity));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: action == 0 ? ld : -ld, salt: bytes32(0)}), ""
        );
        if (action == 0) {
            if ((tokenIsCurrency0 ? delta.amount1() : delta.amount0()) < 0) revert InvalidParams();
            _pay(key.currency0, delta.amount0());
            _pay(key.currency1, delta.amount1());
            return "";
        }
        // coins come through the factory (the coin only leaves the PoolManager to its own contracts outside a swap)
        uint256 a0 = _takePositive(key.currency0, delta.amount0(), tokenIsCurrency0 ? address(this) : to);
        uint256 a1 = _takePositive(key.currency1, delta.amount1(), tokenIsCurrency0 ? to : address(this));
        uint256 coins = tokenIsCurrency0 ? a0 : a1;
        if (coins != 0) IERC20(Currency.unwrap(tokenIsCurrency0 ? key.currency0 : key.currency1)).safeTransfer(to, coins);
        return abi.encode(coins, tokenIsCurrency0 ? a1 : a0);
    }

    function _devBuy(bytes memory payload) private returns (bytes memory) {
        (PoolKey memory key, bool tokenIsCurrency0, uint256 pairIn, address to) = abi.decode(payload, (PoolKey, bool, uint256, address));
        bool zeroForOne = !tokenIsCurrency0;
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(pairIn), sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}),
            ""
        );
        _pay(key.currency0, d.amount0());
        _pay(key.currency1, d.amount1());
        uint256 coinOut = _takePositive(tokenIsCurrency0 ? key.currency0 : key.currency1, tokenIsCurrency0 ? d.amount0() : d.amount1(), to);
        return abi.encode(coinOut);
    }

    function _key(address token, address pair) internal view returns (PoolKey memory key, bool tokenIsCurrency0) {
        tokenIsCurrency0 = token < pair;
        key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : pair),
            currency1: Currency.wrap(tokenIsCurrency0 ? pair : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    function _takePositive(Currency currency, int128 amount, address to) internal returns (uint256 value) {
        if (amount <= 0) return 0;
        value = uint256(uint128(amount));
        poolManager.take(currency, to, value);
    }

    function _pay(Currency currency, int128 amount) internal {
        if (amount >= 0) return;
        uint256 due = uint256(uint128(-amount));
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), due);
        poolManager.settle();
    }

    // ---------------------------------------------------------------------
    // Pricing
    // ---------------------------------------------------------------------

    function pairUsdPrice(address pair) external view returns (uint256) {
        return oracle.price(pair);
    }

    function _priceQ(uint256 pairUsd18) internal view returns (uint256 priceQ) {
        // pair base units per coin base unit, scaled 1e36: (start cap / 1e9 coins) / pair price.
        priceQ = Math.mulDiv(startCapUsd8 * 1e10, 1e36, TOTAL_SUPPLY_WHOLE * pairUsd18);
        if (priceQ == 0) revert InvalidParams();
    }

    function _initialPosition(bool tokenIsCurrency0, uint256 priceQ) internal pure returns (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) {
        uint160 target = tokenIsCurrency0
            ? uint160(Math.sqrt(Math.mulDiv(priceQ, 1 << 128, 1e36)) << 32)
            : uint160(Math.sqrt(Math.mulDiv(1e36, 1 << 128, priceQ)) << 32);
        int24 tick = TickMath.getTickAtSqrtPrice(target);
        int24 aligned = (tick / TICK_SPACING) * TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) aligned -= TICK_SPACING;
        int24 minTick = (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING;
        int24 maxTick = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        if (tokenIsCurrency0) {
            sqrtPriceX96 = TickMath.getSqrtPriceAtTick(aligned);
            tickLower = aligned + TICK_SPACING;
            tickUpper = maxTick;
        } else {
            sqrtPriceX96 = TickMath.getSqrtPriceAtTick(aligned + TICK_SPACING);
            tickLower = minTick;
            tickUpper = aligned + TICK_SPACING;
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function strategyOf(address token) external view returns (address) {
        return listings[token].strategy;
    }

    function poolKeyOf(address token) external view returns (PoolKey memory key) {
        (key,) = _key(token, listings[token].pair);
    }

    receive() external payable {}
}
