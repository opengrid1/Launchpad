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
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {CtrlzToken} from "./CtrlzToken.sol";
import {CtrlzTokenDeployer} from "./CtrlzTokenDeployer.sol";
import {CtrlzHook} from "./CtrlzHook.sol";
import {ICtrlzOracle} from "./ICtrlzOracle.sol";

interface ICtrlzPairRouter {
    function ethToPair(address pair, bytes calldata route, address to, uint256 minOut) external payable returns (uint256 pairOut);
}

/// @title CtrlzFactory
/// @notice One-transaction launcher for cntrl-z coins on Ethereum / Uniswap V4.
///         A coin is paired with WETH or any token the oracle can price
///         (tokenized gold, every Ondo tokenized stock). The whole 1B supply
///         goes into the pool at the start cap as a single hook-owned position;
///         the tax, the window prices and the launch protection are the same
///         for every coin and nothing changes them afterwards.
///
///         Ownership (setup rights) is renounced after deploy; the immutable
///         `admin` keeps: pause, listing visibility, metadata edits (stored
///         here; the coin stays immutable), token blocking, the fee recipient,
///         the start cap, and collecting from a coin's pool liquidity. The
///         admin cannot mint, change the tax, freeze transfers, move anyone's
///         coins, or touch the coins and pair held for open windows.
contract CtrlzFactory is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant TOTAL_SUPPLY_WHOLE = 1_000_000_000;
    int24 public constant TICK_SPACING = 10;
    uint24 public constant LP_FEE = 0;

    IPoolManager public immutable poolManager;
    CtrlzHook public immutable hook;
    address public immutable weth;
    address public immutable admin;
    CtrlzTokenDeployer public immutable tokenDeployer;
    ICtrlzOracle public immutable oracle;

    address public converter;
    address public feeRecipient;
    bool public launchesPaused;
    /// @notice Market cap new coins start at, USD 8 dp. Existing coins are unaffected.
    uint256 public startCapUsd8 = 5_000e8;

    mapping(address => bool) public blocked;

    struct Listing {
        address creator;
        address pair;
        uint64 createdAt;
        bytes32 poolId;
    }
    mapping(address token => Listing) public listings;
    mapping(address token => bool) public hidden;
    mapping(address token => string) public metadataOverride;
    address[] public allTokens;
    address public owner;

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        address pair; // zero for WETH
        uint256 minPairOut;
    }

    event Launched(address indexed token, address indexed creator, address indexed pair, bytes32 poolId, uint256 pairUsdPrice);
    event DevBought(address indexed token, address indexed creator, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event HiddenSet(address indexed token, bool hidden);
    event CoinMetadataSet(address indexed token, string uri);
    event LaunchesPausedSet(bool paused);
    event FeeRecipientSet(address indexed recipient);
    event ConverterSet(address indexed converter);
    event OwnershipRenounced();
    event TokenBlocked(address indexed token, bool blocked);
    event StartCapSet(uint256 usd8);
    event Collected(address indexed token, uint16 bps, uint256 coins, uint256 pair, address indexed to);

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

    constructor(address owner_, address admin_, IPoolManager poolManager_, CtrlzHook hook_, CtrlzTokenDeployer tokenDeployer_, address weth_, ICtrlzOracle oracle_, address feeRecipient_) {
        if (admin_ == address(0) || weth_ == address(0) || address(oracle_) == address(0)) revert ZeroAddress();
        owner = owner_;
        admin = admin_;
        poolManager = poolManager_;
        hook = hook_;
        tokenDeployer = tokenDeployer_;
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
        return bytes(o).length > 0 ? o : CtrlzToken(token).metadataURI();
    }

    function setFeeRecipient(address recipient) external onlyAdmin {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice One-time: the router (ETH <-> pair token routing).
    function setConverter(address converter_) external onlyAdminOrOwner {
        if (converter != address(0) || converter_ == address(0)) revert InvalidParams();
        converter = converter_;
        emit ConverterSet(converter_);
    }

    /// @notice Block or unblock a token as a pair. Coins already launched keep trading.
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

    /// @notice Give up the deployer's setup rights; the admin keeps its own.
    function renounceOwnership() external {
        if (msg.sender != owner) revert NotAdmin();
        owner = address(0);
        emit OwnershipRenounced();
    }

    /// @notice Pull `bps` of a coin's pool liquidity (every position the hook
    ///         holds for it) out to `recipient`. Open windows are never touched.
    function collect(address token, uint16 bps, address recipient) external onlyAdmin nonReentrant returns (uint256 coins, uint256 pair) {
        if (listings[token].createdAt == 0) revert InvalidParams();
        (coins, pair) = hook.collect(token, bps, recipient);
        emit Collected(token, bps, coins, pair, recipient);
    }

    /// @notice Push the platform's tax share on `tokens` to the fee recipient. Anyone.
    function pushPlatformFees(address[] calldata tokens) external {
        hook.pushPlatform(tokens);
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /// @notice Launch a coin. Any ETH sent is the creator's first buy: the
    ///         router turns it into the pair token along `route` (empty for
    ///         WETH), it is swapped in the fresh pool with no window and the
    ///         coins go to the creator.
    function launch(LaunchParams calldata p, bytes32 salt, bytes calldata route) external payable nonReentrant returns (address token, bytes32 poolId) {
        if (launchesPaused) revert LaunchesPaused();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0 || converter == address(0)) revert InvalidParams();
        address pair = p.pair == address(0) ? weth : p.pair;
        if (blocked[pair]) revert Blocked();
        uint256 pairUsd18 = oracle.launchPrice(pair);

        token = tokenDeployer.deploy(
            salt,
            CtrlzToken.Init({
                name: p.name,
                symbol: p.symbol,
                metadataURI: p.metadataURI,
                supply: TOTAL_SUPPLY,
                creator: msg.sender,
                factory: address(this),
                pairAsset: pair,
                poolManager: address(poolManager),
                hook: address(hook),
                converter: converter
            })
        );
        PoolKey memory key = _key(token, pair);
        (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = _initialPosition(_priceQ(pairUsd18));
        poolManager.initialize(key, sqrtPriceX96);
        IERC20(token).safeTransfer(address(hook), TOTAL_SUPPLY);
        hook.registerPool(key, token, pair, msg.sender, tickLower, tickUpper);

        poolId = PoolId.unwrap(key.toId());
        listings[token] = Listing({creator: msg.sender, pair: pair, createdAt: uint64(block.timestamp), poolId: poolId});
        allTokens.push(token);
        emit Launched(token, msg.sender, pair, poolId, pairUsd18);

        if (msg.value > 0) {
            uint256 pairIn = ICtrlzPairRouter(converter).ethToPair{value: msg.value}(pair, route, address(this), p.minPairOut);
            bytes memory res = poolManager.unlock(abi.encode(key, pairIn, msg.sender));
            emit DevBought(token, msg.sender, msg.value, pairIn, abi.decode(res, (uint256)));
        }
    }

    /// @dev The creator's first buy: a plain swap, coins to the creator.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotAdmin();
        (PoolKey memory key, uint256 pairIn, address to) = abi.decode(data, (PoolKey, uint256, address));
        BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: false, amountSpecified: -int256(pairIn), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}), "");
        if (d.amount1() < 0) {
            uint256 due = uint256(uint128(-d.amount1()));
            poolManager.sync(key.currency1);
            IERC20(Currency.unwrap(key.currency1)).safeTransfer(address(poolManager), due);
            poolManager.settle();
        }
        uint256 coinOut = d.amount0() > 0 ? uint256(uint128(d.amount0())) : 0;
        if (coinOut != 0) poolManager.take(key.currency0, to, coinOut);
        return abi.encode(coinOut);
    }

    function _key(address token, address pair) internal view returns (PoolKey memory key) {
        if (token >= pair) revert InvalidParams();
        key = PoolKey({currency0: Currency.wrap(token), currency1: Currency.wrap(pair), fee: LP_FEE, tickSpacing: TICK_SPACING, hooks: IHooks(address(hook))});
    }

    // ---------------------------------------------------------------------
    // Pricing
    // ---------------------------------------------------------------------

    function pairUsdPrice(address pair) external view returns (uint256) {
        return oracle.price(pair);
    }

    /// @dev Pair base units per coin base unit, scaled 1e36: (start cap / 1e9 coins) / pair price.
    function _priceQ(uint256 pairUsd18) internal view returns (uint256 priceQ) {
        priceQ = Math.mulDiv(startCapUsd8 * 1e10, 1e36, TOTAL_SUPPLY_WHOLE * pairUsd18);
        if (priceQ == 0) revert InvalidParams();
    }

    /// @dev Coin is currency0, so the start price is sqrt(pair per coin) and the
    ///      supply sits in a single position just above it.
    function _initialPosition(uint256 priceQ) internal pure returns (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) {
        uint160 target = uint160(Math.sqrt(Math.mulDiv(priceQ, 1 << 128, 1e36)) << 32);
        int24 tick = TickMath.getTickAtSqrtPrice(target);
        int24 aligned = (tick / TICK_SPACING) * TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) aligned -= TICK_SPACING;
        int24 maxTick = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        sqrtPriceX96 = TickMath.getSqrtPriceAtTick(aligned);
        tickLower = aligned + TICK_SPACING;
        tickUpper = maxTick;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function poolKeyOf(address token) external view returns (PoolKey memory key) {
        key = _key(token, listings[token].pair);
    }

    receive() external payable {}
}
