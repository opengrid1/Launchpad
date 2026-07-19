// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
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
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {QuiverTokenM} from "./QuiverTokenM.sol";
import {QuiverHookS, IQuiverTokenM} from "./QuiverHookS.sol";

/// @title QuiverFactoryS
/// @notice One-transaction launcher for STOCK-PAIRED markets: mints a
///         fixed-supply token, opens a token/stock Uniswap V4 pool bound to
///         QuiverHookS, and seeds the entire supply single-sided at a fixed
///         USD starting market cap — priced live from the paired stock's
///         on-chain USDG pool, so no stale price constants exist anywhere.
///
///         Every listed stock's USDG pricing pool is verified to have
///         IN-RANGE liquidity at listing time (the guard the v1 factory
///         lacked). Creators pick 1 pair stock and a reward basket of up to 5
///         listed stocks for holders.
contract QuiverFactoryS is Ownable, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant INITIAL_MARKET_CAP_USD_8 = 3_000 * 1e8; // $3,000
    int24 public constant TICK_SPACING = 60;
    uint24 public constant LP_FEE = 0; // the hook tax is the only fee
    uint16 public constant MAX_TAX_BPS = 1000;

    IPoolManager public immutable poolManager;
    QuiverHookS public immutable hook;
    address public immutable usdg;

    bool public launchesPaused;

    struct Listing {
        address creator;
        address pairStock;
        uint16 taxBps;
        uint64 createdAt;
        bytes32 poolId;
    }

    /// @notice Listed stocks mapped to their LIQUID USDG pricing pool.
    mapping(address stock => PoolKey) internal _stockPool;
    mapping(address stock => bool) public stockListed;

    mapping(address token => Listing) public listings;
    /// @notice Reward basket per launched token (1..5 stocks).
    mapping(address token => address[]) internal _rewardStocks;
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
        address pairStock; // the stock the pool trades against (must be listed)
        uint16 taxBps;
        address[] rewardStocks; // 1..5 listed stocks for the holder basket
    }

    event Launched(
        address indexed token,
        address indexed creator,
        address indexed pairStock,
        uint16 taxBps,
        bytes32 poolId
    );
    event StockListed(address indexed stock);
    event StockDelisted(address indexed stock);
    event PositionUnwound(
        address indexed token,
        uint128 liquidityRemoved,
        uint256 tokenAmount,
        uint256 stockAmount,
        address indexed recipient
    );
    event LaunchesPausedSet(bool paused);

    error LaunchesPaused();
    error InvalidParams();
    error StockNotListed();
    error DeadPricePool();
    error BadVanity();
    error NotProtocolAdmin();

    /// @notice Permanent protocol administrator — the only privilege that
    ///         survives renounceOwnership(); gates unwindPosition only.
    address public immutable protocolAdmin;

    modifier onlyProtocolAdmin() {
        if (msg.sender != protocolAdmin) revert NotProtocolAdmin();
        _;
    }

    constructor(
        address owner_,
        address protocolAdmin_,
        IPoolManager poolManager_,
        QuiverHookS hook_,
        address usdg_
    ) Ownable(owner_) {
        require(usdg_ != address(0), "usdg=0");
        require(protocolAdmin_ != address(0), "admin=0");
        protocolAdmin = protocolAdmin_;
        poolManager = poolManager_;
        hook = hook_;
        usdg = usdg_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice List a stock with its liquid USDG pool. Reverts unless that pool
    ///         has a live price AND in-range liquidity right now.
    function listStock(address stock, PoolKey calldata usdgStockPool) external onlyOwner {
        require(stock != address(0), "stock=0");
        bool stockInKey = Currency.unwrap(usdgStockPool.currency0) == stock
            || Currency.unwrap(usdgStockPool.currency1) == stock;
        bool usdgInKey = Currency.unwrap(usdgStockPool.currency0) == usdg
            || Currency.unwrap(usdgStockPool.currency1) == usdg;
        if (!stockInKey || !usdgInKey) revert InvalidParams();
        PoolId pid = usdgStockPool.toId();
        (uint160 sqrtP, , , ) = poolManager.getSlot0(pid);
        if (sqrtP == 0 || poolManager.getLiquidity(pid) == 0) revert DeadPricePool();
        _stockPool[stock] = usdgStockPool;
        stockListed[stock] = true;
        emit StockListed(stock);
    }

    function delistStock(address stock) external onlyOwner {
        stockListed[stock] = false;
        emit StockDelisted(stock);
    }

    function stockPool(address stock) external view returns (PoolKey memory) {
        return _stockPool[stock];
    }

    function setLaunchesPaused(bool paused) external onlyOwner {
        launchesPaused = paused;
        emit LaunchesPausedSet(paused);
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /// @param salt CREATE2 salt mined off-chain so the token address ends 0x4663.
    function launch(LaunchParams calldata p, bytes32 salt)
        external
        nonReentrant
        returns (address token, bytes32 poolId)
    {
        if (launchesPaused) revert LaunchesPaused();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidParams();
        if (p.taxBps > MAX_TAX_BPS) revert InvalidParams();
        if (!stockListed[p.pairStock]) revert StockNotListed();
        uint256 n = p.rewardStocks.length;
        if (n == 0 || n > 5) revert InvalidParams();
        for (uint256 i; i < n; ++i) {
            if (!stockListed[p.rewardStocks[i]]) revert StockNotListed();
        }

        // 1. Mint via CREATE2 for the 4663 vanity; factory holds the supply.
        QuiverTokenM qt = new QuiverTokenM{salt: salt}(
            p.name,
            p.symbol,
            p.metadataURI,
            TOTAL_SUPPLY,
            msg.sender,
            address(this),
            p.taxBps,
            p.rewardStocks
        );
        token = address(qt);
        if (uint160(token) & 0xffff != 0x4663) revert BadVanity();

        // 2. Pair with the chosen stock.
        bool tokenIsCurrency0 = token < p.pairStock;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : p.pairStock),
            currency1: Currency.wrap(tokenIsCurrency0 ? p.pairStock : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        // 3. Exclude pool endpoints from dividends, wire the hook.
        {
            address[] memory ex = new address[](2);
            ex[0] = address(poolManager);
            ex[1] = address(this);
            qt.initHook(address(hook), ex);
        }

        // 4. Price at the USD start cap using the pair stock's LIVE on-chain
        //    USD price, and seed the full supply single-sided.
        (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) =
            _initialPosition(tokenIsCurrency0, p.pairStock);
        poolManager.initialize(key, sqrtPriceX96);

        uint128 liquidity = tokenIsCurrency0
            ? LiquidityAmounts.getLiquidityForAmount0(
                TickMath.getSqrtPriceAtTick(tickLower),
                TickMath.getSqrtPriceAtTick(tickUpper),
                TOTAL_SUPPLY
            )
            : LiquidityAmounts.getLiquidityForAmount1(
                TickMath.getSqrtPriceAtTick(tickLower),
                TickMath.getSqrtPriceAtTick(tickUpper),
                TOTAL_SUPPLY
            );
        positions[token] = Position({tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity});
        poolManager.unlock(abi.encode(uint8(0), abi.encode(key, tickLower, tickUpper, liquidity, tokenIsCurrency0)));

        // 5. Register with the hook: pair route + reward basket routes.
        {
            QuiverHookS.RewardRoute[] memory routes = new QuiverHookS.RewardRoute[](n);
            for (uint256 i; i < n; ++i) {
                routes[i] = QuiverHookS.RewardRoute({
                    stock: p.rewardStocks[i],
                    usdgKey: _stockPool[p.rewardStocks[i]]
                });
            }
            hook.registerPool(
                key, token, p.pairStock, msg.sender, p.taxBps, tokenIsCurrency0, _stockPool[p.pairStock], routes
            );
        }

        poolId = PoolId.unwrap(key.toId());
        listings[token] = Listing({
            creator: msg.sender,
            pairStock: p.pairStock,
            taxBps: p.taxBps,
            createdAt: uint64(block.timestamp),
            poolId: poolId
        });
        _rewardStocks[token] = p.rewardStocks;
        allTokens.push(token);
        _tokensByCreator[msg.sender].push(token);

        emit Launched(token, msg.sender, p.pairStock, p.taxBps, poolId);
    }

    // ---------------------------------------------------------------------
    // Liquidity seeding / unwind callback
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));

        if (action == 0) {
            (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity, bool tokenIsCurrency0) =
                abi.decode(payload, (PoolKey, int24, int24, uint128, bool));

            (BalanceDelta delta, ) = poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: int256(uint256(liquidity)),
                    salt: bytes32(0)
                }),
                ""
            );

            int128 tokenOwed = tokenIsCurrency0 ? delta.amount0() : delta.amount1();
            int128 stockOwed = tokenIsCurrency0 ? delta.amount1() : delta.amount0();
            require(stockOwed >= 0, "stock owed");
            if (tokenOwed < 0) {
                Currency tokenCurrency = tokenIsCurrency0 ? key.currency0 : key.currency1;
                uint256 amt = uint256(uint128(-tokenOwed));
                poolManager.sync(tokenCurrency);
                IERC20(Currency.unwrap(tokenCurrency)).safeTransfer(address(poolManager), amt);
                poolManager.settle();
            }
            return "";
        }

        (
            PoolKey memory key2,
            int24 lo,
            int24 hi,
            uint128 removed,
            address recipient,
            bool tokenIsC0
        ) = abi.decode(payload, (PoolKey, int24, int24, uint128, address, bool));

        (BalanceDelta d2, ) = poolManager.modifyLiquidity(
            key2,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: -int256(uint256(removed)), salt: bytes32(0)}),
            ""
        );

        uint256 amt0 = _takePositive(key2.currency0, d2.amount0(), recipient);
        uint256 amt1 = _takePositive(key2.currency1, d2.amount1(), recipient);
        (uint256 tokenAmount, uint256 stockAmount) = tokenIsC0 ? (amt0, amt1) : (amt1, amt0);
        return abi.encode(tokenAmount, stockAmount);
    }

    function _takePositive(Currency currency, int128 amount, address to) internal returns (uint256 value) {
        if (amount <= 0) return 0;
        value = uint256(uint128(amount));
        poolManager.take(currency, to, value);
    }

    /// @notice Remove part of a token's factory-held liquidity (protocolAdmin
    ///         only; disclosed recovery lever, survives renounce).
    function unwindPosition(address token, uint16 liquidityBps, address recipient)
        external
        onlyProtocolAdmin
        nonReentrant
        returns (uint256 tokenAmount, uint256 stockAmount)
    {
        if (liquidityBps == 0 || liquidityBps > 10_000) revert InvalidParams();
        if (recipient == address(0)) revert InvalidParams();
        Position storage pos = positions[token];
        uint128 held = pos.liquidity;
        if (held == 0) revert InvalidParams();

        uint128 removed = uint128((uint256(held) * liquidityBps) / 10_000);
        if (removed == 0) revert InvalidParams();
        pos.liquidity = held - removed;

        address pairStock = listings[token].pairStock;
        bool tokenIsCurrency0 = token < pairStock;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : pairStock),
            currency1: Currency.wrap(tokenIsCurrency0 ? pairStock : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        bytes memory res = poolManager.unlock(
            abi.encode(uint8(1), abi.encode(key, pos.tickLower, pos.tickUpper, removed, recipient, tokenIsCurrency0))
        );
        (tokenAmount, stockAmount) = abi.decode(res, (uint256, uint256));
        emit PositionUnwound(token, removed, tokenAmount, stockAmount, recipient);
    }

    // ---------------------------------------------------------------------
    // Pricing
    // ---------------------------------------------------------------------

    /// @notice Live USD price (8 decimals) of a listed stock, read from its
    ///         USDG pool. Public so the frontend/keeper can reuse it.
    function stockUsd8(address stock) public view returns (uint256 price8) {
        PoolKey memory k = _stockPool[stock];
        (uint160 sqrtP, , , ) = poolManager.getSlot0(k.toId());
        if (sqrtP == 0) revert DeadPricePool();
        // ratio = (sqrtP/2^96)^2 = raw currency1 per raw currency0.
        uint256 r1 = Math.mulDiv(uint256(sqrtP), uint256(sqrtP), 1 << 96);
        bool stockIs0 = Currency.unwrap(k.currency0) == stock;
        if (stockIs0) {
            // USDG (6dp) per stock (18dp): usd8 = ratio * 1e12 * 1e8 = ratio * 1e20.
            price8 = Math.mulDiv(r1, 1e20, 1 << 96);
        } else {
            // ratio is stock-raw per USDG-raw; usd8 = 1e20 / ratio.
            uint256 denom = Math.mulDiv(r1, 1e20, 1 << 96); // ratio * 1e20
            if (denom == 0) revert DeadPricePool();
            price8 = Math.mulDiv(1e20, 1e20, denom);
        }
        if (price8 == 0) revert DeadPricePool();
    }

    /// @dev Initial pool price (in pair-stock units) hitting the USD start cap,
    ///      plus the token-only seeding range adjacent to spot.
    function _initialPosition(bool tokenIsCurrency0, address pairStock)
        internal
        view
        returns (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper)
    {
        uint256 usd8 = stockUsd8(pairStock);
        // Market cap in pair-stock raw units (18dp), then per-token price (18dp).
        uint256 mcapStock = Math.mulDiv(INITIAL_MARKET_CAP_USD_8, 1e18, usd8);
        uint256 priceStock = Math.mulDiv(mcapStock, 1e18, TOTAL_SUPPLY);
        if (priceStock == 0) revert InvalidParams();

        uint160 target = tokenIsCurrency0
            ? uint160(Math.sqrt(Math.mulDiv(priceStock, 1 << 192, 1e18)))
            : uint160(Math.sqrt(Math.mulDiv(1e18, 1 << 192, priceStock)));

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

    function tokensByCreator(address creator) external view returns (address[] memory) {
        return _tokensByCreator[creator];
    }

    function rewardStocksOf(address token) external view returns (address[] memory) {
        return _rewardStocks[token];
    }
}
