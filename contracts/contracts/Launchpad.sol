// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {LaunchToken} from "./LaunchToken.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {TokenFactory} from "./TokenFactory.sol";
import {FeeDistributor} from "./FeeDistributor.sol";
import {
    IUniswapV3Factory,
    IUniswapV3Pool,
    INonfungiblePositionManager,
    ISwapRouter,
    IWETH9
} from "./interfaces/IUniswapV3.sol";

interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

/// @title Launchpad
/// @notice Direct Uniswap V3 token launchpad for Robinhood Chain.
///
///         Launch flow: deploy a real ERC-20, create and initialize a real
///         Uniswap V3 pool, mint a full-range liquidity position held by this
///         contract, and enable trading immediately. Anti-whale limits
///         (max transaction, max wallet, optional buy cooldown) apply until
///         the token's market cap reaches the graduation threshold
///         (40,000 USD), at which point they lift automatically on-chain.
///
///         Trading routed through buy/sell takes a flat 1% fee in the native
///         currency, delivered entirely to the token creator by the
///         FeeDistributor. Supply, fee tier and anti-whale limits are fixed
///         protocol rules, identical for every launch.
///
///         Liquidity is protocol-managed: the position NFT is owned by this
///         contract and liquidity managers can add, remove, withdraw and
///         collect fees, with all withdrawn assets sent to the Treasury.
contract Launchpad is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------
    error LaunchesArePaused();
    error UnknownToken();
    error InvalidParams();
    error InsufficientLiquidity();
    error FeeTierNotSupported();
    error ZeroAmount();
    error TransferFailed();
    error PriceUnavailable();
    error ZeroAddress();
    error Expired();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event TokenLaunched(
        address indexed token,
        address indexed creator,
        address pool,
        uint256 positionTokenId,
        string name,
        string symbol,
        string metadataURI,
        uint256 totalSupply,
        uint24 feeTier,
        uint256 maxTxAmount,
        uint256 maxWalletAmount,
        uint256 buyCooldown,
        uint256 initialLiquidityWei
    );

    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 nativeAmount,
        uint256 tokenAmount,
        uint256 feeAmount,
        uint160 sqrtPriceX96After
    );

    event LPWithdrawn(address indexed token, uint256 tokenAmount, uint256 wethAmount);
    event LiquidityAdded(address indexed token, uint256 tokenAmount, uint256 wethAmount, uint128 liquidity);
    event LiquidityRemoved(address indexed token, uint128 liquidity, uint256 tokenAmount, uint256 wethAmount);
    event LiquidityFeesCollected(address indexed token, uint256 tokenAmount, uint256 wethAmount);

    event LaunchesPausedSet(bool paused);
    event TokenFeaturedSet(address indexed token, bool featured);
    event EthUsdPriceSet(uint256 price8);
    event PriceFeedSet(address feed);

    // ---------------------------------------------------------------------
    // Types and storage
    // ---------------------------------------------------------------------
    struct CreateParams {
        string name;
        string symbol;
        // JSON metadata: description, logo, website, twitter, telegram, extra links.
        string metadataURI;
    }

    struct TokenInfo {
        address creator;
        address pool;
        uint256 positionTokenId;
        uint24 feeTier;
        uint64 createdAt;
        bool featured;
        bool tokenIsToken0;
    }

    bytes32 public constant LIQUIDITY_MANAGER_ROLE = keccak256("LIQUIDITY_MANAGER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint16 public constant BPS = 10_000;
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    // Fixed protocol rules. These are not configurable by users or admins.
    /// @notice Every token launches with this exact supply (18 decimals).
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    /// @notice Uniswap V3 fee tier every pool is created with (0.3%).
    uint24 public constant FEE_TIER = 3000;
    /// @notice Flat 1% trading fee, paid entirely to the token creator.
    uint16 public constant TRADE_FEE_BPS = 100;
    /// @notice Max transaction while limits are active: 1% of supply.
    uint16 public constant MAX_TX_BPS = 100;
    /// @notice Max wallet while limits are active: 2% of supply.
    uint16 public constant MAX_WALLET_BPS = 200;
    /// @notice Market cap (USD, 8 decimals) every token starts trading at.
    uint256 public constant INITIAL_MCAP_USD = 4_000e8;

    TokenFactory public immutable tokenFactory;
    IUniswapV3Factory public immutable uniswapFactory;
    INonfungiblePositionManager public immutable positionManager;
    ISwapRouter public immutable swapRouter;
    IWETH9 public immutable weth;
    FeeDistributor public immutable feeDistributor;
    address payable public immutable treasury;

    /// @notice Market cap (USD, 8 decimals) at which anti-whale limits lift.
    uint256 public immutable graduationCapUsd;

    bool public launchesPaused;

    /// @notice Fallback native/USD price with 8 decimals, used when no feed is set.
    uint256 public ethUsdPrice8;
    /// @notice Optional Chainlink-compatible native/USD feed.
    IAggregatorV3 public priceFeed;

    mapping(address => TokenInfo) public tokenInfo;
    address[] public allTokens;
    mapping(address => address[]) public tokensByCreator;

    // Lifetime protocol stats, tracked on-chain for the admin dashboard.
    uint256 public totalLaunches;
    uint256 public totalTradeVolumeWei;
    uint256 public totalFeesWei;

    constructor(
        address admin,
        TokenFactory tokenFactory_,
        IUniswapV3Factory uniswapFactory_,
        INonfungiblePositionManager positionManager_,
        ISwapRouter swapRouter_,
        IWETH9 weth_,
        FeeDistributor feeDistributor_,
        address payable treasury_,
        uint256 graduationCapUsd_,
        uint256 ethUsdPrice8_
    ) {
        if (
            admin == address(0) ||
            address(tokenFactory_) == address(0) ||
            address(uniswapFactory_) == address(0) ||
            address(positionManager_) == address(0) ||
            address(swapRouter_) == address(0) ||
            address(weth_) == address(0) ||
            address(feeDistributor_) == address(0) ||
            treasury_ == address(0)
        ) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(LIQUIDITY_MANAGER_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        tokenFactory = tokenFactory_;
        uniswapFactory = uniswapFactory_;
        positionManager = positionManager_;
        swapRouter = swapRouter_;
        weth = weth_;
        feeDistributor = feeDistributor_;
        treasury = treasury_;
        graduationCapUsd = graduationCapUsd_ == 0 ? 40_000e8 : graduationCapUsd_;
        ethUsdPrice8 = ethUsdPrice8_;
    }

    receive() external payable {}

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /// @notice Deploys the ERC-20, creates the Uniswap V3 pool and seeds it
    ///         single-sided with the full token supply in a range just above
    ///         the starting price. Launching requires no upfront liquidity:
    ///         buyers' native currency fills the pool as the price moves into
    ///         the range. An optional msg.value executes a first buy for the
    ///         creator in the same transaction.
    function createToken(CreateParams calldata p)
        external
        payable
        nonReentrant
        returns (address token, address pool, uint256 positionTokenId)
    {
        if (launchesPaused) revert LaunchesArePaused();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidParams();

        int24 tickSpacing = uniswapFactory.feeAmountTickSpacing(FEE_TIER);
        if (tickSpacing == 0) revert FeeTierNotSupported();

        token = tokenFactory.deployToken(
            p.name,
            p.symbol,
            p.metadataURI,
            TOTAL_SUPPLY,
            msg.sender,
            (TOTAL_SUPPLY * MAX_TX_BPS) / BPS,
            (TOTAL_SUPPLY * MAX_WALLET_BPS) / BPS,
            0
        );
        LaunchToken launchToken = LaunchToken(token);

        bool tokenIsToken0 = token < address(weth);
        (address token0, address token1) = tokenIsToken0
            ? (token, address(weth))
            : (address(weth), token);

        // Starting price implies INITIAL_MCAP_USD for the full supply, then
        // snaps to a tick spacing boundary so the whole supply fits in a
        // token-only range adjacent to the current tick.
        (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = _initialPosition(
            tokenIsToken0,
            tickSpacing
        );
        pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, FEE_TIER, sqrtPriceX96);

        launchToken.setPool(pool);
        launchToken.setExempt(address(positionManager), true);
        launchToken.setExempt(address(swapRouter), true);
        launchToken.setExempt(treasury, true);

        IERC20(token).forceApprove(address(positionManager), TOTAL_SUPPLY);

        (positionTokenId, , , ) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: FEE_TIER,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: tokenIsToken0 ? TOTAL_SUPPLY : 0,
                amount1Desired: tokenIsToken0 ? 0 : TOTAL_SUPPLY,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );

        // Single-sided mints leave at most rounding dust; sweep it to treasury.
        uint256 tokenDust = IERC20(token).balanceOf(address(this));
        if (tokenDust > 0) IERC20(token).safeTransfer(treasury, tokenDust);

        tokenInfo[token] = TokenInfo({
            creator: msg.sender,
            pool: pool,
            positionTokenId: positionTokenId,
            feeTier: FEE_TIER,
            createdAt: uint64(block.timestamp),
            featured: false,
            tokenIsToken0: tokenIsToken0
        });
        allTokens.push(token);
        tokensByCreator[msg.sender].push(token);
        totalLaunches += 1;

        emit TokenLaunched(
            token,
            msg.sender,
            pool,
            positionTokenId,
            p.name,
            p.symbol,
            p.metadataURI,
            TOTAL_SUPPLY,
            FEE_TIER,
            (TOTAL_SUPPLY * MAX_TX_BPS) / BPS,
            (TOTAL_SUPPLY * MAX_WALLET_BPS) / BPS,
            0,
            msg.value
        );

        // Optional first buy for the creator, in the same transaction.
        if (msg.value > 0) {
            _buy(token, tokenInfo[token], msg.value, 0, block.timestamp);
        }
    }

    /// @dev Computes the initial pool price (snapped to a tick boundary) and
    ///      the token-only range directly adjacent to it.
    function _initialPosition(bool tokenIsToken0, int24 tickSpacing)
        internal
        view
        returns (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper)
    {
        // Native value of the full supply at the starting market cap.
        uint256 mcapWeth = Math.mulDiv(INITIAL_MCAP_USD, 1e18, nativeUsdPrice());
        // priceWei: wei of native per whole token (1e18 base units).
        uint256 priceWei = Math.mulDiv(mcapWeth, 1e18, TOTAL_SUPPLY);
        if (priceWei == 0) revert InvalidParams();

        uint160 target;
        if (tokenIsToken0) {
            // ratio token1/token0 = priceWei / 1e18
            target = uint160(Math.sqrt(Math.mulDiv(priceWei, 1 << 192, 1e18)));
        } else {
            // ratio token1/token0 = 1e18 / priceWei
            target = uint160(Math.sqrt(Math.mulDiv(1e18, 1 << 192, priceWei)));
        }

        int24 tick = TickMath.getTickAtSqrtRatio(target);
        // Floor-align to the spacing (solidity division truncates toward zero).
        int24 aligned = (tick / tickSpacing) * tickSpacing;
        if (tick < 0 && tick % tickSpacing != 0) aligned -= tickSpacing;

        if (tokenIsToken0) {
            // All token0: the range sits entirely above the current tick.
            sqrtPriceX96 = TickMath.getSqrtRatioAtTick(aligned);
            tickLower = aligned + tickSpacing;
            tickUpper = _maxUsableTick(tickSpacing);
        } else {
            // All token1: the range sits at or below the current tick.
            sqrtPriceX96 = TickMath.getSqrtRatioAtTick(aligned + tickSpacing);
            tickLower = _minUsableTick(tickSpacing);
            tickUpper = aligned + tickSpacing;
        }
    }

    // ---------------------------------------------------------------------
    // Trading
    // ---------------------------------------------------------------------

    /// @notice Buy `token` with native currency. The flat 1% fee is taken
    ///         from msg.value and goes entirely to the token creator.
    function buy(address token, uint256 minTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        TokenInfo memory info = tokenInfo[token];
        if (info.pool == address(0)) revert UnknownToken();
        if (msg.value == 0) revert ZeroAmount();
        tokensOut = _buy(token, info, msg.value, minTokensOut, deadline);
    }

    function _buy(address token, TokenInfo memory info, uint256 value, uint256 minTokensOut, uint256 deadline)
        internal
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert Expired();
        uint256 fee = (value * TRADE_FEE_BPS) / BPS;
        feeDistributor.accrue{value: fee}(token, info.creator);

        uint256 amountIn = value - fee;
        tokensOut = swapRouter.exactInputSingle{value: amountIn}(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: token,
                fee: info.feeTier,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: minTokensOut,
                sqrtPriceLimitX96: 0
            })
        );

        totalTradeVolumeWei += value;
        totalFeesWei += fee;

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(info.pool).slot0();
        emit Trade(token, msg.sender, true, value, tokensOut, fee, sqrtPriceX96);
    }

    /// @notice Sell `token` for native currency. The flat 1% fee is taken
    ///         from the native proceeds and goes entirely to the creator.
    function sell(address token, uint256 amountIn, uint256 minNativeOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 nativeOut)
    {
        TokenInfo memory info = tokenInfo[token];
        if (info.pool == address(0)) revert UnknownToken();
        if (amountIn == 0) revert ZeroAmount();

        if (block.timestamp > deadline) revert Expired();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(token).forceApprove(address(swapRouter), amountIn);

        uint256 wethOut = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: address(weth),
                fee: info.feeTier,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        weth.withdraw(wethOut);
        uint256 fee = (wethOut * TRADE_FEE_BPS) / BPS;
        feeDistributor.accrue{value: fee}(token, info.creator);

        nativeOut = wethOut - fee;
        if (nativeOut < minNativeOut) revert InsufficientLiquidity();
        (bool ok, ) = msg.sender.call{value: nativeOut}("");
        if (!ok) revert TransferFailed();

        totalTradeVolumeWei += wethOut;
        totalFeesWei += fee;

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(info.pool).slot0();
        emit Trade(token, msg.sender, false, wethOut, amountIn, fee, sqrtPriceX96);
    }

    // ---------------------------------------------------------------------
    // Protocol-owned liquidity management
    // ---------------------------------------------------------------------

    /// @notice Withdraw a percentage (bps) of the protocol-owned liquidity
    ///         for `token`. Principal plus any accrued fees are sent to the
    ///         treasury.
    function withdrawLP(address token, uint16 bps) public nonReentrant onlyRole(LIQUIDITY_MANAGER_ROLE) {
        if (bps == 0 || bps > BPS) revert InvalidParams();
        TokenInfo memory info = _requireToken(token);

        (, , , , , , , uint128 liquidity, , , , ) = positionManager.positions(info.positionTokenId);
        uint128 toRemove = uint128((uint256(liquidity) * bps) / BPS);
        if (toRemove > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: info.positionTokenId,
                    liquidity: toRemove,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            );
        }

        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: info.positionTokenId,
                recipient: treasury,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        (uint256 tokenAmount, uint256 wethAmount) = info.tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);
        emit LPWithdrawn(token, tokenAmount, wethAmount);
    }

    /// @notice Withdraw 100% of the protocol-owned liquidity for `token`.
    function withdrawAllLP(address token) external {
        withdrawLP(token, BPS);
    }

    /// @notice Remove an exact liquidity amount from the position and send
    ///         the underlying assets to the treasury.
    function removeLiquidity(address token, uint128 liquidity) external nonReentrant onlyRole(LIQUIDITY_MANAGER_ROLE) {
        if (liquidity == 0) revert ZeroAmount();
        TokenInfo memory info = _requireToken(token);

        positionManager.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: info.positionTokenId,
                liquidity: liquidity,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            })
        );
        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: info.positionTokenId,
                recipient: treasury,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        (uint256 tokenAmount, uint256 wethAmount) = info.tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);
        emit LiquidityRemoved(token, liquidity, tokenAmount, wethAmount);
        emit LPWithdrawn(token, tokenAmount, wethAmount);
    }

    /// @notice Add liquidity to the protocol-owned position. The caller
    ///         provides tokens (via allowance) and native currency.
    function addLiquidity(address token, uint256 tokenAmount)
        external
        payable
        nonReentrant
        onlyRole(LIQUIDITY_MANAGER_ROLE)
    {
        if (tokenAmount == 0 && msg.value == 0) revert ZeroAmount();
        TokenInfo memory info = _requireToken(token);

        if (tokenAmount > 0) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
            IERC20(token).forceApprove(address(positionManager), tokenAmount);
        }
        if (msg.value > 0) {
            weth.deposit{value: msg.value}();
            weth.approve(address(positionManager), msg.value);
        }

        (uint256 amount0Desired, uint256 amount1Desired) = info.tokenIsToken0
            ? (tokenAmount, msg.value)
            : (msg.value, tokenAmount);

        (uint128 liquidity, uint256 amount0, uint256 amount1) = positionManager.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: info.positionTokenId,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            })
        );

        // Return whatever the position did not take to the treasury.
        uint256 tokenLeft = IERC20(token).balanceOf(address(this));
        if (tokenLeft > 0) IERC20(token).safeTransfer(treasury, tokenLeft);
        uint256 wethLeft = weth.balanceOf(address(this));
        if (wethLeft > 0) IERC20(address(weth)).safeTransfer(treasury, wethLeft);

        (uint256 usedToken, uint256 usedWeth) = info.tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);
        emit LiquidityAdded(token, usedToken, usedWeth, liquidity);
    }

    /// @notice Collect accrued Uniswap V3 trading fees for the protocol-owned
    ///         position and send them to the treasury.
    function collectLiquidityFees(address token) external nonReentrant onlyRole(LIQUIDITY_MANAGER_ROLE) {
        TokenInfo memory info = _requireToken(token);

        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: info.positionTokenId,
                recipient: treasury,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        (uint256 tokenAmount, uint256 wethAmount) = info.tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);
        emit LiquidityFeesCollected(token, tokenAmount, wethAmount);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setLaunchesPaused(bool paused) external onlyRole(OPERATOR_ROLE) {
        launchesPaused = paused;
        emit LaunchesPausedSet(paused);
    }

    function setFeatured(address token, bool featured) external onlyRole(OPERATOR_ROLE) {
        _requireToken(token);
        tokenInfo[token].featured = featured;
        emit TokenFeaturedSet(token, featured);
    }

    function setEthUsdPrice(uint256 price8) external onlyRole(OPERATOR_ROLE) {
        if (price8 == 0) revert InvalidParams();
        ethUsdPrice8 = price8;
        emit EthUsdPriceSet(price8);
    }

    function setPriceFeed(address feed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        priceFeed = IAggregatorV3(feed);
        emit PriceFeedSet(feed);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    function tokensOf(address creator) external view returns (address[] memory) {
        return tokensByCreator[creator];
    }

    /// @notice Native/USD price with 8 decimals, from the feed when set.
    function nativeUsdPrice() public view returns (uint256) {
        if (address(priceFeed) != address(0)) {
            (, int256 answer, , , ) = priceFeed.latestRoundData();
            if (answer > 0) {
                uint8 dec = priceFeed.decimals();
                if (dec == 8) return uint256(answer);
                if (dec < 8) return uint256(answer) * (10 ** (8 - dec));
                return uint256(answer) / (10 ** (dec - 8));
            }
        }
        if (ethUsdPrice8 == 0) revert PriceUnavailable();
        return ethUsdPrice8;
    }

    /// @notice Market cap of `token` denominated in wei of the native currency.
    function marketCapWeth(address token) public view returns (uint256) {
        TokenInfo memory info = tokenInfo[token];
        if (info.pool == address(0)) revert UnknownToken();

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(info.pool).slot0();
        uint256 supply = IERC20(token).totalSupply();

        if (info.tokenIsToken0) {
            // price(token in weth) = sqrtP^2 / 2^192
            uint256 a = Math.mulDiv(supply, sqrtPriceX96, 1 << 96);
            return Math.mulDiv(a, sqrtPriceX96, 1 << 96);
        } else {
            // price(token in weth) = 2^192 / sqrtP^2
            uint256 a = Math.mulDiv(supply, 1 << 96, sqrtPriceX96);
            return Math.mulDiv(a, 1 << 96, sqrtPriceX96);
        }
    }

    /// @notice Market cap of `token` in USD with 8 decimals.
    function marketCapUsd(address token) public view returns (uint256) {
        return Math.mulDiv(marketCapWeth(token), nativeUsdPrice(), 1e18);
    }

    /// @notice Graduation predicate read by LaunchToken on every transfer
    ///         while its limits are active.
    function shouldGraduate(address token) external view returns (bool) {
        return marketCapUsd(token) >= graduationCapUsd;
    }

    /// @notice Current trading restrictions and graduation progress.
    function tradingLimits(address token)
        external
        view
        returns (
            bool active,
            uint256 maxTxAmount,
            uint256 maxWalletAmount,
            uint256 buyCooldown,
            uint256 mcapUsd,
            uint256 remainingUsd
        )
    {
        _requireToken(token);
        LaunchToken t = LaunchToken(token);
        active = t.limitsActive();
        maxTxAmount = t.maxTxAmount();
        maxWalletAmount = t.maxWalletAmount();
        buyCooldown = t.buyCooldown();
        mcapUsd = marketCapUsd(token);
        remainingUsd = mcapUsd >= graduationCapUsd ? 0 : graduationCapUsd - mcapUsd;
    }

    /// @notice Pool state for the token: address, fee tier, price, liquidity
    ///         and the protocol-owned position.
    function poolInfo(address token)
        external
        view
        returns (
            address pool,
            uint24 feeTier,
            uint160 sqrtPriceX96,
            int24 tick,
            uint128 poolLiquidity,
            uint256 positionTokenId,
            uint128 positionLiquidity
        )
    {
        TokenInfo memory info = _requireToken(token);
        pool = info.pool;
        feeTier = info.feeTier;
        (sqrtPriceX96, tick, , , , , ) = IUniswapV3Pool(info.pool).slot0();
        poolLiquidity = IUniswapV3Pool(info.pool).liquidity();
        positionTokenId = info.positionTokenId;
        (, , , , , , , positionLiquidity, , , , ) = positionManager.positions(info.positionTokenId);
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _requireToken(address token) internal view returns (TokenInfo memory info) {
        info = tokenInfo[token];
        if (info.pool == address(0)) revert UnknownToken();
    }

    function _minUsableTick(int24 tickSpacing) internal pure returns (int24) {
        return (MIN_TICK / tickSpacing) * tickSpacing;
    }

    function _maxUsableTick(int24 tickSpacing) internal pure returns (int24) {
        return (MAX_TICK / tickSpacing) * tickSpacing;
    }

    /// @notice ERC-721 receiver so the position manager can mint to this contract.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
