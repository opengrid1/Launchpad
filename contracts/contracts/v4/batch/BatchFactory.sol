// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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

import {BatchToken} from "./BatchToken.sol";
import {BatchTokenDeployer} from "./BatchTokenDeployer.sol";
import {BatchHook} from "./BatchHook.sol";

/// @dev The launchpad router: turns ETH into a pair asset along a caller-
///      supplied route (Uniswap V3 path and/or a V4 pool) and back.
interface IPairRouter {
    function ethToPair(address pair, bytes calldata route, address to, uint256 minOut) external payable returns (uint256 pairOut);
}

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/// @title BatchFactory
/// @notice One-transaction launcher on Ink / Uniswap V4. A coin
///         pairs against WETH or any approved tokenized stock; the whole 1B
///         supply seeds a single-sided, factory-held V4 position at a $3,000
///         start cap, priced from the pair's Chainlink feed when one is set
///         and from the admin's USD price otherwise. Trading starts in the
///         same block; the BatchHook takes a FIXED fee on every swap. No
///         function changes a coin's fee after launch.
///
///         The creator's optional first buy is paid in plain ETH whatever the
///         pair: the router turns it into the stock along the supplied route
///         and the factory swaps that into the fresh V4 pool.
///
///         Ownership is renounced after deploy; the immutable `admin` keeps
///         pause, listing visibility, metadata edits (stored here, the coin
///         itself stays immutable), pair curation, the fee recipient, and
///         liquidity collection. The admin cannot mint, change fees, freeze
///         transfers or touch any holder's balance.
contract BatchFactory is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant TOTAL_SUPPLY_WHOLE = 1_000_000_000;
    uint256 public constant INITIAL_MARKET_CAP_USD_8 = 3_000 * 1e8;
    int24 public constant TICK_SPACING = 60;
    uint24 public constant LP_FEE = 0;
    /// @notice Trade fee on every swap, bps of the pair side (set at deploy).
    uint16 public immutable TAX_BPS;
    /// @notice Fee split of every trade fee, bps: creator / holders / platform.
    uint16 public immutable CREATOR_BPS;
    uint16 public immutable HOLDER_BPS;
    /// @notice A Chainlink answer older than this falls back to the admin price.
    uint256 public constant FEED_MAX_AGE = 7 days;

    IPoolManager public immutable poolManager;
    BatchHook public immutable hook;
    address public immutable weth;
    address public immutable admin;
    /// @notice Creates the coins, so this contract stays under the size limit.
    BatchTokenDeployer public immutable tokenDeployer;

    /// @notice The launchpad router: ETH <-> pair routing for first buys and
    ///         for claimants who want ETH; set once.
    address public converter;
    /// @notice Where each coin's platform share is paid on claim.
    address public feeRecipient;
    bool public launchesPaused;

    /// @notice An approved pair asset. `feed` (Chainlink, USD) wins over
    ///         `usdPrice8` when set and fresh.
    struct QuoteAsset {
        bool approved;
        uint64 usdPrice8;
        address feed;
    }
    mapping(address => QuoteAsset) public quoteAssets;
    address[] public quoteList;

    struct Listing {
        address creator;
        address pair;
        uint16 taxBps;
        uint64 createdAt;
        bytes32 poolId;
    }
    mapping(address token => Listing) public listings;
    /// @notice Coins the admin hid from listings; they still trade.
    mapping(address token => bool) public hidden;
    /// @notice Admin-edited metadata for a coin; empty means the coin's own metadataURI().
    mapping(address token => string) public metadataOverride;
    address[] public allTokens;
    /// @notice Deployer, for setup only; zero once renounced.
    address public owner;

    struct Position {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }
    mapping(address token => Position) public positions;

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        /// @dev The pair: WETH (or zero for WETH) or an approved stock.
        address pair;
        /// @dev First buy only: minimum pair asset the ETH must buy along the route (sandwich guard).
        uint256 minPairOut;
        /// @dev Optional reward basket: up to 4 approved stocks (not WETH), no
        ///      repeats. Holders may claim their rewards as equal shares of it.
        ///      Fixed in the coin forever.
        address[] basket;
    }

    event Launched(address indexed token, address indexed creator, address indexed pair, uint16 taxBps, bytes32 poolId, uint256 pairUsdPrice8);
    event HiddenSet(address indexed token, bool hidden);
    event CoinMetadataSet(address indexed token, string uri);
    event DevBought(address indexed token, address indexed creator, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event QuoteAssetSet(address indexed pair, bool approved, uint64 usdPrice8, address feed);
    event LaunchesPausedSet(bool paused);
    event FeeRecipientSet(address indexed recipient);
    event ConverterSet(address indexed converter);
    event OwnershipRenounced();
    event Collected(address indexed token, uint128 liquidity, uint256 tokenAmount, uint256 pairAmount, address indexed to);

    error LaunchesPaused();
    error InvalidParams();
    error NotAdmin();
    error QuoteNotApproved();
    error NoPrice();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @dev Setup calls: the deployer (owner, until renounced) or the admin.
    modifier onlyAdminOrOwner() {
        if (msg.sender != admin && msg.sender != owner) revert NotAdmin();
        _;
    }

    constructor(
        address owner_,
        address admin_,
        IPoolManager poolManager_,
        BatchHook hook_,
        BatchTokenDeployer tokenDeployer_,
        address weth_,
        uint64 ethUsd8_,
        uint16 taxBps_,
        uint16 creatorBps_,
        uint16 holderBps_,
        address feeRecipient_
    ) {
        tokenDeployer = tokenDeployer_;
        owner = owner_;
        if (admin_ == address(0) || weth_ == address(0)) revert ZeroAddress();
        if (ethUsd8_ == 0 || taxBps_ == 0 || taxBps_ > 1_000 || uint256(creatorBps_) + holderBps_ > 10_000) revert InvalidParams();
        TAX_BPS = taxBps_;
        admin = admin_;
        feeRecipient = feeRecipient_ == address(0) ? admin_ : feeRecipient_;
        poolManager = poolManager_;
        hook = hook_;
        weth = weth_;
        CREATOR_BPS = creatorBps_;
        HOLDER_BPS = holderBps_;
        quoteAssets[weth_] = QuoteAsset({approved: true, usdPrice8: ethUsd8_, feed: address(0)});
        quoteList.push(weth_);
        emit QuoteAssetSet(weth_, true, ethUsd8_, address(0));
    }

    // ---------------------------------------------------------------------
    // Admin (survives renounce)
    // ---------------------------------------------------------------------

    function pause() external onlyAdmin {
        launchesPaused = true;
        emit LaunchesPausedSet(true);
    }

    function resume() external onlyAdmin {
        launchesPaused = false;
        emit LaunchesPausedSet(false);
    }

    /// @notice Hide a coin from the listings (sites and bots read this); it
    ///         keeps trading, so holders can always sell.
    function setHidden(address token, bool hidden_) external onlyAdmin {
        if (listings[token].createdAt == 0) revert InvalidParams();
        hidden[token] = hidden_;
        emit HiddenSet(token, hidden_);
    }

    /// @notice Edit one coin's displayed metadata (image, description, links).
    ///         Stored here; the coin contract's own metadata never changes.
    ///         An empty string restores the coin's original metadata.
    function setCoinMetadata(address token, string calldata uri) external onlyAdmin {
        if (listings[token].createdAt == 0) revert InvalidParams();
        metadataOverride[token] = uri;
        emit CoinMetadataSet(token, uri);
    }

    /// @notice The metadata sites should show: the admin's edit if any, else the coin's own.
    function metadataOf(address token) external view returns (string memory) {
        string memory o = metadataOverride[token];
        return bytes(o).length > 0 ? o : BatchToken(token).metadataURI();
    }

    function setFeeRecipient(address recipient) external onlyAdmin {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice One-time: the launchpad router (ETH <-> pair routing).
    function setConverter(address converter_) external onlyAdminOrOwner {
        if (converter != address(0) || converter_ == address(0)) revert InvalidParams();
        converter = converter_;
        emit ConverterSet(converter_);
    }

    /// @notice Approve, re-price, or retire a pair asset. `usdPrice8` is USD
    ///         per whole token (8 dp); `feed` an optional 8-decimal Chainlink USD feed.
    ///         Pair assets must have 18 decimals (wrapped xStocks and WETH do).
    function setQuoteAsset(address pair, bool approved, uint64 usdPrice8, address feed) external onlyAdminOrOwner {
        if (pair == address(0)) revert ZeroAddress();
        if (approved && usdPrice8 == 0 && feed == address(0)) revert InvalidParams();
        if (pair != weth && approved && IERC20Metadata(pair).decimals() != 18) revert InvalidParams();
        if (feed != address(0) && IAggregatorV3(feed).decimals() != 8) revert InvalidParams();
        if (pair == weth && !approved) revert InvalidParams();
        if (!quoteAssets[pair].approved && quoteAssets[pair].usdPrice8 == 0 && quoteAssets[pair].feed == address(0)) quoteList.push(pair);
        quoteAssets[pair] = QuoteAsset({approved: approved, usdPrice8: usdPrice8, feed: feed});
        emit QuoteAssetSet(pair, approved, usdPrice8, feed);
    }

    /// @notice Give up the deployer's setup rights; the admin keeps its own.
    function renounceOwnership() external {
        if (msg.sender != owner) revert NotAdmin();
        owner = address(0);
        emit OwnershipRenounced();
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /// @notice Launch a coin against `p.pair`, seeded single-sided. Any ETH sent
    ///         is the creator's first buy: the router turns it into the pair
    ///         along `route` (empty for WETH), it is swapped in the fresh pool,
    ///         and the coins go to the creator.
    function launch(LaunchParams calldata p, bytes32 salt, bytes calldata route) external payable nonReentrant returns (address token, bytes32 poolId) {
        PoolKey memory key;
        bool tokenIsCurrency0;
        address pair;
        (token, poolId, key, tokenIsCurrency0, pair) = _launch(p, salt);
        if (msg.value > 0) {
            if (converter == address(0)) revert InvalidParams();
            uint256 pairIn = IPairRouter(converter).ethToPair{value: msg.value}(pair, route, address(this), p.minPairOut);
            bytes memory res = poolManager.unlock(abi.encode(uint8(1), abi.encode(key, tokenIsCurrency0, pairIn, msg.sender)));
            emit DevBought(token, msg.sender, msg.value, pairIn, abi.decode(res, (uint256)));
        }
    }

    function _launch(LaunchParams calldata p, bytes32 salt)
        internal
        returns (address token, bytes32 poolId, PoolKey memory key, bool tokenIsCurrency0, address pair)
    {
        if (launchesPaused) revert LaunchesPaused();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidParams();
        pair = p.pair == address(0) ? weth : p.pair;
        QuoteAsset memory q = quoteAssets[pair];
        if (!q.approved) revert QuoteNotApproved();
        uint256 pairUsd8 = pairUsdPrice(pair);
        _checkBasket(p.basket);

        if (converter == address(0)) revert InvalidParams();
        token = tokenDeployer.deploy(
            salt,
            BatchToken.Init({
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
                creatorBps: CREATOR_BPS,
                holderBps: HOLDER_BPS,
                basket: p.basket
            })
        );

        (key, tokenIsCurrency0) = _key(token, pair);

        uint256 priceQ = _priceQ(pairUsd8);
        (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = _initialPosition(tokenIsCurrency0, priceQ);
        poolManager.initialize(key, sqrtPriceX96);

        uint128 liquidity = tokenIsCurrency0
            ? LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY);
        positions[token] = Position({tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity});
        poolManager.unlock(abi.encode(uint8(0), abi.encode(key, tickLower, tickUpper, liquidity, address(0), tokenIsCurrency0)));

        poolId = PoolId.unwrap(key.toId());
        hook.registerPool(key, token, pair, TAX_BPS);

        listings[token] = Listing({creator: msg.sender, pair: pair, taxBps: TAX_BPS, createdAt: uint64(block.timestamp), poolId: poolId});
        allTokens.push(token);

        emit Launched(token, msg.sender, pair, TAX_BPS, poolId, pairUsd8);
    }

    function _checkBasket(address[] calldata basket) internal view {
        uint256 n = basket.length;
        if (n > 4) revert InvalidParams();
        for (uint256 i; i < n; i++) {
            address s = basket[i];
            if (s == weth || !quoteAssets[s].approved) revert QuoteNotApproved();
            for (uint256 j; j < i; j++) if (basket[j] == s) revert InvalidParams();
        }
    }

    // ---------------------------------------------------------------------
    // PoolManager callbacks: seed liquidity (0), dev buy (1), admin collect (2)
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotAdmin();
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        return action == 1 ? _devBuy(payload) : _modify(action, payload);
    }

    /// @dev 0: seed the launch position; 2: admin pulls part of it out.
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
        uint256 a0 = _takePositive(key.currency0, delta.amount0(), to);
        uint256 a1 = _takePositive(key.currency1, delta.amount1(), to);
        return abi.encode(tokenIsCurrency0 ? a0 : a1, tokenIsCurrency0 ? a1 : a0);
    }

    /// @dev 1: the creator's first buy. Spend the pair the factory holds; coins go to the creator.
    function _devBuy(bytes memory payload) private returns (bytes memory) {
        (PoolKey memory key, bool tokenIsCurrency0, uint256 pairIn, address to) = abi.decode(payload, (PoolKey, bool, uint256, address));
        bool zeroForOne = !tokenIsCurrency0;
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(pairIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
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
        uint256 owed = uint256(uint128(-amount));
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), owed);
        poolManager.settle();
    }

    // ---------------------------------------------------------------------
    // Pricing (pairs are 18 decimals)
    // ---------------------------------------------------------------------

    /// @notice USD per whole pair token, 8 dp: the Chainlink feed when set and
    ///         fresh, else the admin price.
    function pairUsdPrice(address pair) public view returns (uint256) {
        QuoteAsset memory q = quoteAssets[pair];
        if (q.feed != address(0)) {
            try IAggregatorV3(q.feed).latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
                if (answer > 0 && updatedAt + FEED_MAX_AGE >= block.timestamp) return uint256(answer);
            } catch {}
        }
        if (q.usdPrice8 == 0) revert NoPrice();
        return q.usdPrice8;
    }

    function _priceQ(uint256 pairUsd8) internal pure returns (uint256 priceQ) {
        // pair-wei per whole coin: $3,000 / 1e9 coins / pairUsd, scaled 1e18.
        priceQ = Math.mulDiv(INITIAL_MARKET_CAP_USD_8, 1e18, TOTAL_SUPPLY_WHOLE * pairUsd8);
        if (priceQ == 0) revert InvalidParams();
    }

    function _initialPosition(bool tokenIsCurrency0, uint256 priceQ)
        internal
        pure
        returns (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper)
    {
        uint160 target = tokenIsCurrency0
            ? uint160(Math.sqrt(Math.mulDiv(priceQ, 1 << 192, 1e18)))
            : uint160(Math.sqrt(Math.mulDiv(1e18, 1 << 192, priceQ)));

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
    // Liquidity (admin)
    // ---------------------------------------------------------------------

    /// @notice Admin-only: pull `liquidityBps` of a coin's launch position
    ///         (coins and pair) out of the pool to `recipient`. Not reversible.
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

    // ---------------------------------------------------------------------
    // Platform fees
    // ---------------------------------------------------------------------

    /// @notice Push the platform share waiting in each coin to `feeRecipient`
    ///         in one transaction. Anyone may call; the destination is fixed.
    function pushPlatformFees(address[] calldata tokens) external {
        for (uint256 i = 0; i < tokens.length; i++) {
            if (listings[tokens[i]].createdAt == 0) revert InvalidParams();
            BatchToken(tokens[i]).payPlatform();
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function quoteCount() external view returns (uint256) {
        return quoteList.length;
    }

    /// @notice The pool key of a launched coin (for routers and indexers).
    function poolKeyOf(address token) external view returns (PoolKey memory key) {
        address pair = listings[token].pair;
        bool tokenIsCurrency0 = token < pair;
        key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : pair),
            currency1: Currency.wrap(tokenIsCurrency0 ? pair : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    receive() external payable {}
}
