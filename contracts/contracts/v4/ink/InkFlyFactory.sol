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
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {StockFeeHookV3 as FeeHook} from "../base/StockFeeHookV3.sol";
import {InkToken} from "./InkToken.sol";

interface IWETHLike {
    function deposit() external payable;
}

/// @title InkFlyFactory
/// @notice Ink-chain memecoin launcher. Same shape as the Base launchpad, minus
///         holder rewards. Every coin is a plain, immutable InkToken (fixed 1B
///         supply, no admin), pairs against WETH, seeds its full supply
///         single-sided into a Uniswap V4 pool at an ETH-denominated start cap,
///         and carries a flat 1% trade fee routed entirely to the creator's
///         fee recipient. No vault, no keeper, no platform cut.
contract InkFlyFactory is Ownable, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant TOTAL_SUPPLY_WHOLE = 1_000_000_000;
    int24 public constant TICK_SPACING = 60;
    uint24 public constant LP_FEE = 0;
    /// @notice Flat trade fee for every launch: 1%, paid entirely to the creator.
    uint16 public constant FIXED_TAX_BPS = 100;

    /// @notice Starting market cap in WETH wei (ETH-denominated), set at deploy.
    uint256 public immutable START_MCAP_WEI;

    IPoolManager public immutable poolManager;
    FeeHook public immutable hook;
    address public immutable weth;

    /// @notice Where each coin's 1% trade fee is pushed. Only this wallet claims it.
    mapping(address token => address) public feeRecipientOf;
    /// @notice Launch metadata (logo, description, links) per coin.
    mapping(address token => string) public metadataURIOf;

    bool public launchesPaused;

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
        /// @dev Must be WETH on Ink. Kept in the interface so the trade router
        ///      (shared with Base) can read each coin's pair from `listings`.
        address pair;
        /// @dev Creator's fee destination for the 1% trade fee. Defaults to
        ///      msg.sender (the launcher) when zero.
        address feeRecipient;
    }

    event Launched(address indexed token, address indexed creator, address indexed pair, uint16 taxBps, bytes32 poolId);
    event DevBuy(address indexed token, address indexed creator, uint256 ethIn, uint256 tokensOut);
    event Collected(address indexed token, uint128 liquidityRemoved, uint256 tokenAmount, uint256 pairAmount, address indexed recipient);
    event LaunchesPausedSet(bool paused);

    error LaunchesPaused();
    error InvalidParams();
    error BadPair();
    error NotProtocolAdmin();

    address public immutable protocolAdmin;

    modifier onlyProtocolAdmin() {
        if (msg.sender != protocolAdmin) revert NotProtocolAdmin();
        _;
    }

    constructor(
        address owner_,
        address protocolAdmin_,
        IPoolManager poolManager_,
        FeeHook hook_,
        address weth_,
        uint256 startMcapWei_
    ) Ownable(owner_) {
        require(protocolAdmin_ != address(0), "admin=0");
        require(weth_ != address(0), "weth=0");
        require(startMcapWei_ > 0, "mcap=0");
        protocolAdmin = protocolAdmin_;
        poolManager = poolManager_;
        hook = hook_;
        weth = weth_;
        START_MCAP_WEI = startMcapWei_;
    }

    // ------------------------------------------------------------------ Admin

    function pause() external onlyProtocolAdmin {
        launchesPaused = true;
        emit LaunchesPausedSet(true);
    }

    function resume() external onlyProtocolAdmin {
        launchesPaused = false;
        emit LaunchesPausedSet(false);
    }

    // ----------------------------------------------------------------- Launch

    function launch(LaunchParams calldata p)
        external
        payable
        nonReentrant
        returns (address token, bytes32 poolId)
    {
        if (launchesPaused) revert LaunchesPaused();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidParams();
        // Ink v1: coins pair against WETH only (ETH-denominated start pricing).
        if (p.pair != weth) revert BadPair();

        // Mint the coin: full supply to the factory, no admin, no further mint.
        token = address(new InkToken(p.name, p.symbol, TOTAL_SUPPLY, address(this)));
        metadataURIOf[token] = p.metadataURI;

        bool tokenIsCurrency0 = token < p.pair;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : p.pair),
            currency1: Currency.wrap(tokenIsCurrency0 ? p.pair : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        // priceQ = pair-per-token * 1e18. WETH is 18-dec, so pair-per-token =
        // START_MCAP_WEI / (supply_whole * 1e18); times 1e18 => /supply_whole.
        uint256 priceQ = START_MCAP_WEI / TOTAL_SUPPLY_WHOLE;
        if (priceQ == 0) revert InvalidParams();

        (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = _initialPosition(tokenIsCurrency0, priceQ);
        poolManager.initialize(key, sqrtPriceX96);

        uint128 liquidity = tokenIsCurrency0
            ? LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY);
        positions[token] = Position({tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity});
        poolManager.unlock(abi.encode(uint8(0), abi.encode(key, tickLower, tickUpper, liquidity, tokenIsCurrency0)));

        poolId = PoolId.unwrap(key.toId());

        // 1% trade fee, paid entirely to the creator's fee recipient.
        address feeTo = p.feeRecipient == address(0) ? msg.sender : p.feeRecipient;
        feeRecipientOf[token] = feeTo;
        FeeHook.Payee[] memory payees = new FeeHook.Payee[](1);
        payees[0] = FeeHook.Payee({to: feeTo, shareBps: 10_000});
        hook.configurePool(key, FIXED_TAX_BPS, 0, 0, tokenIsCurrency0, payees);

        listings[token] = Listing({creator: msg.sender, pair: p.pair, taxBps: FIXED_TAX_BPS, createdAt: uint64(block.timestamp), poolId: poolId});
        allTokens.push(token);
        _tokensByCreator[msg.sender].push(token);

        emit Launched(token, msg.sender, p.pair, FIXED_TAX_BPS, poolId);

        // Optional dev buy, atomic with the launch.
        if (msg.value > 0) {
            IWETHLike(weth).deposit{value: msg.value}();
            bytes memory r = poolManager.unlock(abi.encode(uint8(2), abi.encode(key, msg.value, tokenIsCurrency0)));
            uint256 out = abi.decode(r, (uint256));
            IERC20(token).safeTransfer(msg.sender, out);
            emit DevBuy(token, msg.sender, msg.value, out);
        }
    }

    // ------------------------------------------- Liquidity seeding + collect

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));

        if (action == 0) {
            (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity,) =
                abi.decode(payload, (PoolKey, int24, int24, uint128, bool));

            (BalanceDelta delta, ) = poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)}),
                ""
            );
            _settleNeg(key.currency0, delta.amount0());
            _settleNeg(key.currency1, delta.amount1());
            return "";
        }

        if (action == 2) {
            (PoolKey memory k, uint256 amountIn, bool tokenIs0) = abi.decode(payload, (PoolKey, uint256, bool));
            bool zeroForOne = !tokenIs0;
            BalanceDelta d = poolManager.swap(
                k,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: -int256(amountIn),
                    sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            );
            _settleNeg(k.currency0, d.amount0());
            _settleNeg(k.currency1, d.amount1());
            uint256 out = _takePositive(
                tokenIs0 ? k.currency0 : k.currency1,
                tokenIs0 ? d.amount0() : d.amount1(),
                address(this)
            );
            return abi.encode(out);
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
        (uint256 tokenAmount, uint256 pairAmount) = tokenIsCurrency0 ? (amt0, amt1) : (amt1, amt0);
        return abi.encode(tokenAmount, pairAmount);
    }

    function _settleNeg(Currency currency, int128 amount) internal {
        if (amount >= 0) return;
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), uint256(uint128(-amount)));
        poolManager.settle();
    }

    function _takePositive(Currency currency, int128 amount, address to) internal returns (uint256 value) {
        if (amount <= 0) return 0;
        value = uint256(uint128(amount));
        poolManager.take(currency, to, value);
    }

    /// @notice Remove `liquidityBps` of a coin's factory-held liquidity to
    ///         `recipient`. Callable ONLY by the immutable protocolAdmin.
    function collect(address token, uint16 liquidityBps, address recipient)
        external
        onlyProtocolAdmin
        nonReentrant
        returns (uint256 tokenAmount, uint256 pairAmount)
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
        PoolKey memory key = poolKeyOf(token);

        bytes memory res = poolManager.unlock(abi.encode(uint8(1), abi.encode(key, pos.tickLower, pos.tickUpper, removed, recipient, tokenIsCurrency0)));
        (tokenAmount, pairAmount) = abi.decode(res, (uint256, uint256));
        emit Collected(token, removed, tokenAmount, pairAmount, recipient);
    }

    // --------------------------------------------------------------- Pricing

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

    // ----------------------------------------------------------------- Views

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function tokensByCreator(address creator) external view returns (address[] memory) {
        return _tokensByCreator[creator];
    }

    function poolKeyOf(address token) public view returns (PoolKey memory key) {
        address pair = listings[token].pair;
        if (pair == address(0)) revert InvalidParams();
        bool tokenIsCurrency0 = token < pair;
        key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : pair),
            currency1: Currency.wrap(tokenIsCurrency0 ? pair : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    /// @notice Authoritative spot read: live sqrtPriceX96, which side the coin
    ///         sits on, and the pair decimals (always 18 — WETH).
    function poolSpot(address token)
        external
        view
        returns (uint160 sqrtPriceX96, bool tokenIsCurrency0, uint8 pairDecimals)
    {
        address pair = listings[token].pair;
        if (pair == address(0)) revert InvalidParams();
        tokenIsCurrency0 = token < pair;
        pairDecimals = 18;
        PoolKey memory key = poolKeyOf(token);
        (sqrtPriceX96, , , ) = poolManager.getSlot0(key.toId());
    }
}
