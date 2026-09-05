// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
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

import {StockPadToken} from "./StockPadToken.sol";
import {StockPadHook} from "./StockPadHook.sol";

/// @dev The launchpad router: turns ETH into a pair asset along a caller-
///      supplied route (Uniswap V3 path and/or a V4 pool) and back.
interface IPairRouter {
    function ethToPair(address pair, bytes calldata route, address to, uint256 minOut) external payable returns (uint256 pairOut);
}

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/// @title StockPadFactory
/// @notice One-transaction launcher on Ethereum mainnet / Uniswap V4. A coin
///         pairs against WETH or any approved tokenized stock; the whole 1B
///         supply seeds a single-sided, factory-held V4 position at a $3,000
///         start cap, priced from the pair's Chainlink feed when one is set
///         and from the admin's USD price otherwise. Trading starts in the
///         same block; the StockPadHook takes the fee on every swap.
///
///         The creator's optional first buy is paid in plain ETH whatever the
///         pair: the router turns it into the stock along the supplied route
///         and the factory swaps that into the fresh V4 pool.
///
///         Liquidity never leaves this contract: there is no withdraw path.
///         Ownership is renounced after deploy; the immutable `admin` keeps
///         pause / pair curation / fee recipient.
contract StockPadFactory is Ownable, ReentrancyGuard, IUnlockCallback {
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
    StockPadHook public immutable hook;
    address public immutable weth;
    address public immutable admin;

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
    address[] public allTokens;
    mapping(address creator => address[]) internal _tokensByCreator;

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
    }

    event Launched(address indexed token, address indexed creator, address indexed pair, uint16 taxBps, bytes32 poolId, uint256 pairUsdPrice8);
    event DevBought(address indexed token, address indexed creator, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event QuoteAssetSet(address indexed pair, bool approved, uint64 usdPrice8, address feed);
    event LaunchesPausedSet(bool paused);
    event FeeRecipientSet(address indexed recipient);
    event ConverterSet(address indexed converter);
    event Recovered(address indexed asset, uint256 amount, address indexed to);

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
        if (msg.sender != admin && msg.sender != owner()) revert NotAdmin();
        _;
    }

    constructor(
        address owner_,
        address admin_,
        IPoolManager poolManager_,
        StockPadHook hook_,
        address weth_,
        uint64 ethUsd8_,
        uint16 taxBps_,
        uint16 creatorBps_,
        uint16 holderBps_
    ) Ownable(owner_) {
        if (admin_ == address(0) || weth_ == address(0)) revert ZeroAddress();
        if (ethUsd8_ == 0 || taxBps_ == 0 || taxBps_ > 1_000 || uint256(creatorBps_) + holderBps_ > 10_000) revert InvalidParams();
        TAX_BPS = taxBps_;
        admin = admin_;
        feeRecipient = admin_;
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
    ///         per whole token (8 dp); `feed` an optional Chainlink USD feed.
    ///         Pair assets must have 18 decimals (all Ondo stocks and WETH do).
    function setQuoteAsset(address pair, bool approved, uint64 usdPrice8, address feed) external onlyAdminOrOwner {
        if (pair == address(0)) revert ZeroAddress();
        if (approved && usdPrice8 == 0 && feed == address(0)) revert InvalidParams();
        if (pair != weth && approved && IERC20Metadata(pair).decimals() != 18) revert InvalidParams();
        if (pair == weth && !approved) revert InvalidParams();
        if (!quoteAssets[pair].approved && quoteAssets[pair].usdPrice8 == 0 && quoteAssets[pair].feed == address(0)) quoteList.push(pair);
        quoteAssets[pair] = QuoteAsset({approved: approved, usdPrice8: usdPrice8, feed: feed});
        emit QuoteAssetSet(pair, approved, usdPrice8, feed);
    }

    /// @notice Send a stray token balance to the fee recipient. Coins' launch
    ///         liquidity lives in the PoolManager, never here.
    function recoverERC20(address asset, uint256 amount) external onlyAdmin {
        IERC20(asset).safeTransfer(feeRecipient, amount);
        emit Recovered(asset, amount, feeRecipient);
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
            uint256 pairIn = IPairRouter(converter).ethToPair{value: msg.value}(pair, route, address(this), 0);
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

        StockPadToken t = new StockPadToken{salt: salt}(
            p.name, p.symbol, p.metadataURI, TOTAL_SUPPLY, msg.sender, address(this), pair, address(poolManager), CREATOR_BPS, HOLDER_BPS
        );
        token = address(t);

        tokenIsCurrency0 = token < pair;
        key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : pair),
            currency1: Currency.wrap(tokenIsCurrency0 ? pair : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        address[] memory ex = new address[](1);
        ex[0] = address(poolManager);
        t.initHook(address(hook), converter, ex);

        uint256 priceQ = _priceQ(pairUsd8);
        (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = _initialPosition(tokenIsCurrency0, priceQ);
        poolManager.initialize(key, sqrtPriceX96);

        uint128 liquidity = tokenIsCurrency0
            ? LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY);
        positions[token] = Position({tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity});
        poolManager.unlock(abi.encode(uint8(0), abi.encode(key, tickLower, tickUpper, liquidity, tokenIsCurrency0)));

        poolId = PoolId.unwrap(key.toId());
        hook.registerPool(key, token, pair, TAX_BPS);

        listings[token] = Listing({creator: msg.sender, pair: pair, taxBps: TAX_BPS, createdAt: uint64(block.timestamp), poolId: poolId});
        allTokens.push(token);
        _tokensByCreator[msg.sender].push(token);

        emit Launched(token, msg.sender, pair, TAX_BPS, poolId, pairUsd8);
    }

    // ---------------------------------------------------------------------
    // PoolManager callbacks: seed liquidity (0), dev buy (1)
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));

        if (action == 0) {
            (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity, bool tokenIsCurrency0) =
                abi.decode(payload, (PoolKey, int24, int24, uint128, bool));
            (BalanceDelta delta,) = poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)}),
                ""
            );
            int128 pairOwed = tokenIsCurrency0 ? delta.amount1() : delta.amount0();
            require(pairOwed >= 0, "pair owed");
            _pay(key.currency0, delta.amount0());
            _pay(key.currency1, delta.amount1());
            return "";
        }

        // Dev buy: spend the pair the factory holds, coins go to the creator.
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
                if (answer > 0 && updatedAt + FEED_MAX_AGE >= block.timestamp) {
                    uint8 dec = IAggregatorV3(q.feed).decimals();
                    return dec == 8 ? uint256(answer) : dec > 8 ? uint256(answer) / (10 ** (dec - 8)) : uint256(answer) * (10 ** (8 - dec));
                }
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
    // Views
    // ---------------------------------------------------------------------

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function quoteCount() external view returns (uint256) {
        return quoteList.length;
    }

    function tokensByCreator(address creator) external view returns (address[] memory) {
        return _tokensByCreator[creator];
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
