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
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {QuiverStockToken} from "../QuiverStockToken.sol";
import {StockRhHook} from "./StockRhHook.sol";

/// @title RhRewardFactory
/// @notice One-transaction launcher for the Robinhood-chain ETH-reward model.
///         Every coin pairs against WETH and rewards holders in native ETH:
///         80% of trade fees to holders, 20% to the creator (in the hook). The
///         whole supply seeds single-sided at a ~$3,000 start cap.
///
///         Admin mirrors the V3 launchpad: pause/resume and a `collect`
///         LP-recovery lever, gated to an immutable admin that survives
///         `renounceOwnership()` (owner() reads as 0x0 post-deploy).
contract StockRhFactory is Ownable, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant TOTAL_SUPPLY_WHOLE = 1_000_000_000;
    uint256 public constant INITIAL_MARKET_CAP_USD_8 = 3_000 * 1e8;
    int24 public constant TICK_SPACING = 60;
    uint24 public constant LP_FEE = 0;
    uint16 public constant MAX_TAX_BPS = 1000;

    IPoolManager public immutable poolManager;
    StockRhHook public immutable hook;
    /// @notice The WETH every coin pairs against (holders earn native ETH).
    address public immutable weth;
    address public immutable admin;

    /// @notice Where each coin's 10% platform fee share is paid on claim. The
    ///         coins read this via IFeeRecipientSource; defaults to the admin.
    address public feeRecipient;

    bool public launchesPaused;

    // Field order matches the frontend's factory ABI: (creator, pair, taxBps,
    // createdAt, poolId). `pair` is the coin's reward/pair asset (stock/WETH).
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

    // Field order matches the frontend's factory ABI. A dev buy is a separate
    // entry point (launchWithDevBuy) so this tuple stays identical to the client.
    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        address pair;             // the coin's pair asset: a tokenized stock or WETH
        uint16 taxBps;
        uint256 pairUsdPrice8;    // pair USD price, 8dp, sizes the $3k start cap
    }

    event Launched(address indexed token, address indexed creator, address indexed pair, uint16 taxBps, bytes32 poolId);
    event DevBought(address indexed token, address indexed creator, uint256 pairIn, uint256 coinOut);
    event Collected(address indexed token, uint128 liquidityRemoved, uint256 tokenAmount, uint256 wethAmount, address indexed recipient);
    event LaunchesPausedSet(bool paused);
    event FeeRecipientSet(address indexed recipient);

    error LaunchesPaused();
    error InvalidParams();
    error BadVanity();
    error NotAdmin();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address owner_, address admin_, IPoolManager poolManager_, StockRhHook hook_, address weth_)
        Ownable(owner_)
    {
        require(admin_ != address(0) && weth_ != address(0), "zero");
        admin = admin_;
        feeRecipient = admin_;
        poolManager = poolManager_;
        hook = hook_;
        weth = weth_;
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

    /// @notice Re-point where coins pay their 10% platform fee share.
    function setFeeRecipient(address recipient) external onlyAdmin {
        require(recipient != address(0), "zero");
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /// @notice Launch a coin paired against `p.pair`, seeded single-sided.
    function launch(LaunchParams calldata p, bytes32 salt) external nonReentrant returns (address token, bytes32 poolId) {
        (token, poolId, , ) = _launch(p, salt);
    }

    /// @notice Launch plus an atomic creator dev buy of `devBuyPairAmount` of the
    ///         pair asset (approve this factory first). The anti-snipe window
    ///         allows it because the coin goes to the creator at launch block.
    function launchWithDevBuy(LaunchParams calldata p, bytes32 salt, uint256 devBuyPairAmount)
        external
        nonReentrant
        returns (address token, bytes32 poolId)
    {
        PoolKey memory key;
        bool tokenIsCurrency0;
        (token, poolId, key, tokenIsCurrency0) = _launch(p, salt);
        if (devBuyPairAmount > 0) {
            IERC20(p.pair).safeTransferFrom(msg.sender, address(this), devBuyPairAmount);
            bytes memory res = poolManager.unlock(
                abi.encode(uint8(2), abi.encode(key, tokenIsCurrency0, devBuyPairAmount, msg.sender))
            );
            emit DevBought(token, msg.sender, devBuyPairAmount, abi.decode(res, (uint256)));
        }
    }

    function _launch(LaunchParams calldata p, bytes32 salt)
        internal
        returns (address token, bytes32 poolId, PoolKey memory key, bool tokenIsCurrency0)
    {
        if (launchesPaused) revert LaunchesPaused();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidParams();
        if (p.taxBps > MAX_TAX_BPS) revert InvalidParams();
        if (p.pairUsdPrice8 == 0 || p.pair == address(0)) revert InvalidParams();

        address pair = p.pair;
        // Reward token = the pair asset (tokenized stock or WETH): holders earn
        // the pair. The token knows the PoolManager for anti-snipe buy detection.
        QuiverStockToken qt = new QuiverStockToken{salt: salt}(
            p.name, p.symbol, p.metadataURI, TOTAL_SUPPLY, msg.sender, address(this), p.taxBps, pair, address(poolManager)
        );
        token = address(qt);

        tokenIsCurrency0 = token < pair;
        key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : pair),
            currency1: Currency.wrap(tokenIsCurrency0 ? pair : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        address[] memory ex = new address[](2);
        ex[0] = address(poolManager);
        ex[1] = address(this);
        qt.initHook(address(hook), ex);

        // RH stocks and WETH are all 18-decimals, so the WETH pricing math sizes
        // stock-paired pools identically — just use the pair's USD price.
        uint256 priceQ = _priceQ(p.pairUsdPrice8);
        (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = _initialPosition(tokenIsCurrency0, priceQ);
        poolManager.initialize(key, sqrtPriceX96);

        uint128 liquidity = tokenIsCurrency0
            ? LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY);
        positions[token] = Position({tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity});
        poolManager.unlock(abi.encode(uint8(0), abi.encode(key, tickLower, tickUpper, liquidity, tokenIsCurrency0)));

        poolId = PoolId.unwrap(key.toId());
        hook.registerPool(key, token, msg.sender, p.taxBps, tokenIsCurrency0);

        listings[token] = Listing({creator: msg.sender, pair: pair, taxBps: p.taxBps, createdAt: uint64(block.timestamp), poolId: poolId});
        allTokens.push(token);
        _tokensByCreator[msg.sender].push(token);

        emit Launched(token, msg.sender, pair, p.taxBps, poolId);
    }

    // ---------------------------------------------------------------------
    // Liquidity seeding + collect (via PoolManager unlock)
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));

        if (action == 0) {
            (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity, bool tokenIsCurrency0) =
                abi.decode(payload, (PoolKey, int24, int24, uint128, bool));

            (BalanceDelta delta, ) = poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)}),
                ""
            );

            int128 tokenOwed = tokenIsCurrency0 ? delta.amount0() : delta.amount1();
            int128 wethOwed = tokenIsCurrency0 ? delta.amount1() : delta.amount0();
            require(wethOwed >= 0, "weth owed");
            if (tokenOwed < 0) {
                Currency tokenCurrency = tokenIsCurrency0 ? key.currency0 : key.currency1;
                uint256 amt = uint256(uint128(-tokenOwed));
                poolManager.sync(tokenCurrency);
                IERC20(Currency.unwrap(tokenCurrency)).safeTransfer(address(poolManager), amt);
                poolManager.settle();
            }
            return "";
        }

        if (action == 2) {
            // Dev buy: swap the creator's pair asset (held by the factory) into
            // the coin and send the coin straight to the creator.
            (PoolKey memory key, bool tokenIsCurrency0, uint256 pairIn, address to) =
                abi.decode(payload, (PoolKey, bool, uint256, address));

            // Buying the coin means spending the pair: if the coin is currency0,
            // the pair is currency1, so the swap is oneForZero (zeroForOne=false).
            bool zeroForOne = !tokenIsCurrency0;
            BalanceDelta delta = poolManager.swap(
                key,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: -int256(pairIn),
                    sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            );

            // Pay the pair we owe from the factory's balance; take the coin out
            // to the creator.
            _pay(key.currency0, delta.amount0());
            _pay(key.currency1, delta.amount1());
            uint256 coinOut = _takePositive(tokenIsCurrency0 ? key.currency0 : key.currency1,
                tokenIsCurrency0 ? delta.amount0() : delta.amount1(), to);
            return abi.encode(coinOut);
        }

        (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 removed, address recipient, bool tokenIsCurrency0) =
            abi.decode(payload, (PoolKey, int24, int24, uint128, address, bool));

        (BalanceDelta delta, ) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: -int256(uint256(removed)), salt: bytes32(0)}),
            ""
        );

        uint256 amt0 = _takePositive(key.currency0, delta.amount0(), recipient);
        uint256 amt1 = _takePositive(key.currency1, delta.amount1(), recipient);
        (uint256 tokenAmount, uint256 wethAmount) = tokenIsCurrency0 ? (amt0, amt1) : (amt1, amt0);
        return abi.encode(tokenAmount, wethAmount);
    }

    function _takePositive(Currency currency, int128 amount, address to) internal returns (uint256 value) {
        if (amount <= 0) return 0;
        value = uint256(uint128(amount));
        poolManager.take(currency, to, value);
    }

    /// @dev Settle a currency the factory owes to the PoolManager from its own
    ///      balance (positive/zero deltas are no-ops).
    function _pay(Currency currency, int128 amount) internal {
        if (amount >= 0) return;
        uint256 owed = uint256(uint128(-amount));
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), owed);
        poolManager.settle();
    }

    /// @notice Remove `liquidityBps` of a token's factory-held liquidity and send
    ///         the returned coin + WETH to `recipient`. Only the immutable admin;
    ///         survives ownership renounce. Disclosed liquidity-recovery lever.
    function collect(address token, uint16 liquidityBps, address recipient)
        external
        onlyAdmin
        nonReentrant
        returns (uint256 tokenAmount, uint256 wethAmount)
    {
        if (liquidityBps == 0 || liquidityBps > 10_000) revert InvalidParams();
        if (recipient == address(0)) revert InvalidParams();
        Position storage pos = positions[token];
        uint128 held = pos.liquidity;
        if (held == 0) revert InvalidParams();

        uint128 removed = uint128((uint256(held) * liquidityBps) / 10_000);
        if (removed == 0) revert InvalidParams();
        pos.liquidity = held - removed;

        address pair = listings[token].pair;
        bool tokenIsCurrency0 = token < pair;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : pair),
            currency1: Currency.wrap(tokenIsCurrency0 ? pair : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        bytes memory res = poolManager.unlock(abi.encode(uint8(1), abi.encode(key, pos.tickLower, pos.tickUpper, removed, recipient, tokenIsCurrency0)));
        (tokenAmount, wethAmount) = abi.decode(res, (uint256, uint256));
        emit Collected(token, removed, tokenAmount, wethAmount, recipient);
    }

    // ---------------------------------------------------------------------
    // Pricing (WETH is 18 decimals)
    // ---------------------------------------------------------------------

    function _priceQ(uint256 ethUsdPrice8) internal pure returns (uint256 priceQ) {
        // WETH per token (1e18 fixed): $3,000 / 1e9 tokens / ethUsd, scaled.
        priceQ = Math.mulDiv(INITIAL_MARKET_CAP_USD_8, 1e18, TOTAL_SUPPLY_WHOLE * ethUsdPrice8);
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

    function tokensByCreator(address creator) external view returns (address[] memory) {
        return _tokensByCreator[creator];
    }
}
