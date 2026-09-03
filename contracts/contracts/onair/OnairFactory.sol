// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {OnairTokenDeployer} from "./OnairTokenDeployer.sol";
import {OnairToken} from "./OnairToken.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {IUniswapV3Factory, INonfungiblePositionManager, ISwapRouter, IWETH9} from "../interfaces/IUniswapV3.sol";
import {AuctionParameters, IContinuousClearingAuction} from "../cca/interfaces/IContinuousClearingAuction.sol";
import {IContinuousClearingAuctionFactory} from "../cca/interfaces/IContinuousClearingAuctionFactory.sol";
import {LBPInitializationParams} from "../cca/vendor/ll/interfaces/ILBPInitializer.sol";

/// @title OnairFactory
/// @notice Launchpad for HyperEVM with two launch models on one factory:
///
///   INSTANT  One transaction deploys the coin, opens a HyperSwap V3 pool at a
///            target market cap (default $3,000) seeded single-sided with the
///            whole supply, and trading starts on the official router.
///
///   AUCTION  The coin's supply is split: AUCTION_BPS goes into an unmodified
///            Uniswap Continuous Clearing Auction (budget + max price bids,
///            spread across the remaining blocks, one rising uniform clearing
///            price). When the auction ends and has graduated (raised at least
///            the configured minimum), {finalize} sweeps the raised HYPE and the
///            unsold coins back here and seeds a two-sided, factory-locked V3
///            pool at the auction's clearing price. If it did not graduate,
///            every bidder refunds themselves from the auction contract.
///
/// Both models share the fee model: the pool's 1% fee tier accrues to the held
/// position and {harvestFees} splits the WHYPE side holders / creator /
/// platform per the deploy-time bps (ONAIR ships 0 / 7000 / 3000: 70% to the
/// creator, 30% to the platform; the holder tracker stays available for a
/// future split). Liquidity positions never leave this contract
/// except through the owner's {collectFees}, which is the only privileged
/// path to principal. Coins are ownerless and tax-free.
contract OnairFactory is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error ZeroAddress();
    error InvalidParams();
    error LaunchesArePaused();
    error NotPaused();
    error UnknownToken();
    error FeeTierNotSupported();
    error MarketCapOutOfRange();
    error NothingToCollect();
    error NativeTransferFailed();
    error NotAnAuction();
    error AuctionStillRunning();
    error AlreadyFinalized();

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, string metadataURI, uint8 mode);
    event PoolCreated(address indexed token, address pool, uint24 feeTier, uint160 sqrtPriceX96, uint256 marketCapUsd8);
    event LiquidityAdded(address indexed token, uint256 positionId, uint128 liquidity, uint256 tokenAmount, uint256 quoteAmount);
    event AuctionStarted(address indexed token, address indexed auction, uint64 startBlock, uint64 endBlock, uint256 floorPriceQ96, uint256 requiredCurrencyRaised);
    event AuctionFinalized(address indexed token, address indexed auction, bool graduated, uint256 clearingPriceQ96, uint256 tokensSold, uint256 currencyRaised);
    event FeesCollected(address indexed token, address indexed creator, uint256 creatorTokenAmount, uint256 creatorQuoteAmount, uint256 platformTokenAmount, uint256 platformQuoteAmount);
    event LiquidityCollected(address indexed token, uint128 liquidityRemoved, uint256 tokenAmount, uint256 quoteAmount, address indexed recipient);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event FactoryPaused(address indexed by);
    event FactoryResumed(address indexed by);
    event EmergencyRecovered(address indexed asset, uint256 amount, address indexed to);
    event QuoteUsdUpdated(uint64 usdPrice8);
    event AuctionConfigUpdated(uint64 durationBlocks, uint64 claimDelayBlocks, uint256 floorMcapUsd8, uint256 minFdvUsd8);

    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------
    enum Mode { Instant, Auction }

    struct CreateParams {
        string name;
        string symbol;
        string metadataURI;
        /// @dev Instant only: optional starting market cap, USD 8-dec. 0 = default.
        uint256 marketCapUsd8;
        /// @dev Instant only: optional first buy in HYPE, sent as msg.value.
        uint256 devBuyQuote;
    }

    /// @notice Registry row, shaped like the instant launchpad's so clients can
    ///         read both factories the same way. `pool` is zero while an
    ///         auction is still running or failed.
    struct Listing {
        address creator;
        address quote;
        address pool;
        uint256 positionId;
        uint64 createdAt;
        bool tokenIsToken0;
    }

    struct AuctionInfo {
        address auction;
        Mode mode;
        bool finalized;
        bool graduated;
        /// @dev Second single-sided position holding coins left over after the
        ///      two-sided seed (0 when none).
        uint256 overflowPositionId;
    }

    struct QuoteAsset {
        bool approved;
        uint64 usdPrice8;
        uint8 decimals;
    }

    struct AuctionConfig {
        /// @dev Auction length in blocks (HyperEVM blocks ~1s).
        uint64 durationBlocks;
        /// @dev Blocks after the end before bidders may claim (0 = immediately).
        uint64 claimDelayBlocks;
        /// @dev Floor price expressed as a fully-diluted market cap, USD 8-dec.
        uint256 floorMcapUsd8;
        /// @dev Minimum fully-diluted valuation at the clearing price for the
        ///      auction to graduate, USD 8-dec (pools.trade uses $10,000).
        uint256 minFdvUsd8;
    }

    // ------------------------------------------------------------------
    // Constants / immutables
    // ------------------------------------------------------------------
    uint16 internal constant BPS = 10_000;
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;
    uint256 internal constant Q96 = 1 << 96;
    uint24 internal constant MPS = 1e7;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    /// @notice Share of supply sold in an auction (the rest seeds the pool).
    uint16 public constant AUCTION_BPS = 5_000;
    uint256 public constant AUCTION_SUPPLY = (TOTAL_SUPPLY * AUCTION_BPS) / BPS;
    uint256 public constant DEFAULT_MARKET_CAP_USD8 = 3_000e8;
    uint256 public constant MIN_MARKET_CAP_USD8 = 100e8;
    uint256 public constant MAX_MARKET_CAP_USD8 = 100_000_000e8;

    uint24 public immutable POOL_FEE_TIER;
    uint16 public immutable HOLDER_FEE_BPS;
    uint16 public immutable CREATOR_FEE_BPS;
    uint16 public immutable PLATFORM_FEE_BPS;

    OnairTokenDeployer public immutable tokenDeployer;
    IUniswapV3Factory public immutable uniswapFactory;
    INonfungiblePositionManager public immutable positionManager;
    ISwapRouter public immutable swapRouter;
    address public immutable wrappedNative;
    IContinuousClearingAuctionFactory public immutable ccaFactory;

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    address public feeRecipient;
    bool public launchesPaused;
    AuctionConfig public auctionConfig;

    mapping(address quote => QuoteAsset) public quoteAssets;
    mapping(address token => Listing) public listings;
    mapping(address token => AuctionInfo) public auctions;
    address[] public allTokens;
    uint256 private _salt;

    // ------------------------------------------------------------------
    // Construction
    // ------------------------------------------------------------------
    constructor(
        address owner_,
        address feeRecipient_,
        OnairTokenDeployer tokenDeployer_,
        IUniswapV3Factory uniswapFactory_,
        INonfungiblePositionManager positionManager_,
        ISwapRouter swapRouter_,
        address wrappedNative_,
        IContinuousClearingAuctionFactory ccaFactory_,
        uint64 hypeUsd8_,
        uint16 holderFeeBps_,
        uint16 creatorFeeBps_,
        uint24 poolFeeTier_
    ) Ownable(owner_) {
        if (
            feeRecipient_ == address(0) || address(tokenDeployer_) == address(0) || address(uniswapFactory_) == address(0)
                || address(positionManager_) == address(0) || address(swapRouter_) == address(0) || wrappedNative_ == address(0)
                || address(ccaFactory_) == address(0)
        ) revert ZeroAddress();
        if (creatorFeeBps_ == 0 || uint256(holderFeeBps_) + creatorFeeBps_ > BPS || poolFeeTier_ == 0 || hypeUsd8_ == 0) revert InvalidParams();
        POOL_FEE_TIER = poolFeeTier_;
        HOLDER_FEE_BPS = holderFeeBps_;
        CREATOR_FEE_BPS = creatorFeeBps_;
        PLATFORM_FEE_BPS = BPS - holderFeeBps_ - creatorFeeBps_;
        feeRecipient = feeRecipient_;
        tokenDeployer = tokenDeployer_;
        uniswapFactory = uniswapFactory_;
        positionManager = positionManager_;
        swapRouter = swapRouter_;
        wrappedNative = wrappedNative_;
        ccaFactory = ccaFactory_;
        quoteAssets[wrappedNative_] = QuoteAsset({approved: true, usdPrice8: hypeUsd8_, decimals: 18});
        // 4 hours at ~1s blocks, claim right after the end, $3k floor, $10k FDV to graduate.
        auctionConfig = AuctionConfig({durationBlocks: 14_400, claimDelayBlocks: 0, floorMcapUsd8: 3_000e8, minFdvUsd8: 10_000e8});
    }

    // ------------------------------------------------------------------
    // Instant launch
    // ------------------------------------------------------------------

    /// @notice Deploy a coin and open its market in one transaction.
    function createToken(CreateParams calldata p)
        external
        payable
        nonReentrant
        returns (address token, address pool, uint256 positionId)
    {
        if (launchesPaused) revert LaunchesArePaused();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidParams();
        if (msg.value != p.devBuyQuote) revert InvalidParams();
        int24 tickSpacing = uniswapFactory.feeAmountTickSpacing(POOL_FEE_TIER);
        if (tickSpacing == 0) revert FeeTierNotSupported();
        uint256 mcapUsd8 = p.marketCapUsd8 == 0 ? DEFAULT_MARKET_CAP_USD8 : p.marketCapUsd8;
        if (mcapUsd8 < MIN_MARKET_CAP_USD8 || mcapUsd8 > MAX_MARKET_CAP_USD8) revert MarketCapOutOfRange();

        token = tokenDeployer.deploy(msg.sender, p.name, p.symbol, p.metadataURI, wrappedNative);
        emit TokenCreated(token, msg.sender, p.name, p.symbol, p.metadataURI, uint8(Mode.Instant));

        bool tokenIsToken0 = token < wrappedNative;
        uint160 sqrtPriceX96 = _sqrtPriceForMcap(tokenIsToken0, tickSpacing, mcapUsd8, true);
        pool = _createPool(token, tokenIsToken0, sqrtPriceX96, mcapUsd8);

        (int24 lower, int24 upper) = _aboveRange(tokenIsToken0, tickSpacing, sqrtPriceX96);
        uint256 tokenAmt;
        (positionId, tokenAmt,) = _mint(token, tokenIsToken0, lower, upper, TOTAL_SUPPLY, 0);
        emit LiquidityAdded(token, positionId, 0, tokenAmt, 0);

        listings[token] = Listing({creator: msg.sender, quote: wrappedNative, pool: pool, positionId: positionId, createdAt: uint64(block.timestamp), tokenIsToken0: tokenIsToken0});
        auctions[token] = AuctionInfo({auction: address(0), mode: Mode.Instant, finalized: true, graduated: true, overflowPositionId: 0});
        allTokens.push(token);

        if (p.devBuyQuote > 0) {
            IWETH9(wrappedNative).deposit{value: p.devBuyQuote}();
            IERC20(wrappedNative).forceApprove(address(swapRouter), p.devBuyQuote);
            swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: wrappedNative, tokenOut: token, fee: POOL_FEE_TIER, recipient: msg.sender,
                    amountIn: p.devBuyQuote, amountOutMinimum: 0, sqrtPriceLimitX96: 0
                })
            );
        }
    }

    // ------------------------------------------------------------------
    // Auction launch
    // ------------------------------------------------------------------

    /// @notice Deploy a coin and put AUCTION_BPS of its supply into a fresh
    ///         Continuous Clearing Auction, paid in native HYPE. Bidding goes
    ///         directly to the returned auction contract.
    function createAuction(CreateParams calldata p) external nonReentrant returns (address token, address auction) {
        if (launchesPaused) revert LaunchesArePaused();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidParams();
        AuctionConfig memory c = auctionConfig;

        token = tokenDeployer.deploy(msg.sender, p.name, p.symbol, p.metadataURI, wrappedNative);
        emit TokenCreated(token, msg.sender, p.name, p.symbol, p.metadataURI, uint8(Mode.Auction));

        // Prices in the auction are HYPE-wei per token-wei, Q96.
        // Bid granularity: 1% of the floor. The floor itself must sit on a tick
        // boundary (a multiple of the spacing), so it is re-derived from it.
        uint256 tickSpacingQ96 = _priceQ96ForMcap(c.floorMcapUsd8) / 100;
        if (tickSpacingQ96 == 0) revert InvalidParams();
        uint256 floorPriceQ96 = tickSpacingQ96 * 100;
        // Graduation: at the clearing price P the raise is P * AUCTION_SUPPLY, so a
        // minimum FDV maps to minFdv * AUCTION_BPS / BPS in HYPE.
        uint256 required = (_mcapToQuoteWei(c.minFdvUsd8) * AUCTION_BPS) / BPS;

        uint64 startBlock = uint64(block.number);
        uint64 endBlock = startBlock + c.durationBlocks;
        AuctionParameters memory params = AuctionParameters({
            currency: address(0),
            tokensRecipient: address(this),
            fundsRecipient: address(this),
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: endBlock + c.claimDelayBlocks,
            tickSpacing: tickSpacingQ96,
            validationHook: address(0),
            floorPrice: floorPriceQ96,
            requiredCurrencyRaised: uint128(required),
            auctionStepsData: _steps(c.durationBlocks)
        });
        auction = address(ccaFactory.create(token, AUCTION_SUPPLY, abi.encode(params), bytes32(++_salt)));

        // Hand the auction its supply; it never earns holder rewards.
        OnairToken(token).setExcluded(auction, true);
        IERC20(token).safeTransfer(auction, AUCTION_SUPPLY);
        IContinuousClearingAuction(auction).onTokensReceived();

        listings[token] = Listing({creator: msg.sender, quote: wrappedNative, pool: address(0), positionId: 0, createdAt: uint64(block.timestamp), tokenIsToken0: token < wrappedNative});
        auctions[token] = AuctionInfo({auction: auction, mode: Mode.Auction, finalized: false, graduated: false, overflowPositionId: 0});
        allTokens.push(token);
        emit AuctionStarted(token, auction, startBlock, endBlock, floorPriceQ96, required);
    }

    /// @notice After the auction's end block: seed the locked pool at the
    ///         clearing price (graduated) or release the unsold supply back here
    ///         (failed; bidders refund themselves on the auction). Anyone may call.
    function finalize(address token) external nonReentrant returns (address pool) {
        AuctionInfo storage a = auctions[token];
        if (a.mode != Mode.Auction || a.auction == address(0)) revert NotAnAuction();
        if (a.finalized) revert AlreadyFinalized();
        IContinuousClearingAuction cca = IContinuousClearingAuction(a.auction);
        if (block.number < cca.endBlock()) revert AuctionStillRunning();
        a.finalized = true;

        // Both sweeps checkpoint the end block themselves. Unsold coins come back
        // either way; currency only when graduated.
        cca.sweepUnsoldTokens();
        if (!cca.isGraduated()) {
            emit AuctionFinalized(token, a.auction, false, 0, 0, 0);
            return address(0);
        }
        a.graduated = true;
        cca.sweepCurrency();
        LBPInitializationParams memory lp = cca.lbpInitializationParams();

        uint256 raised = address(this).balance; // native HYPE swept in
        IWETH9(wrappedNative).deposit{value: raised}();
        uint256 coins = IERC20(token).balanceOf(address(this)); // reserve + unsold

        Listing storage l = listings[token];
        int24 tickSpacing = uniswapFactory.feeAmountTickSpacing(POOL_FEE_TIER);
        uint160 sqrtPriceX96 = _sqrtPriceFromQ96(l.tokenIsToken0, tickSpacing, lp.initialPriceX96);
        pool = _createPool(token, l.tokenIsToken0, sqrtPriceX96, _quoteWeiToMcap(Math.mulDiv(lp.initialPriceX96, TOTAL_SUPPLY, Q96)));

        // 1) two-sided full-range position: all raised HYPE against as many coins
        //    as the price ratio takes.
        int24 fullLower = (MIN_TICK / tickSpacing) * tickSpacing;
        int24 fullUpper = (MAX_TICK / tickSpacing) * tickSpacing;
        (uint256 posId, uint256 usedCoins, uint256 usedQuote) = _mint(token, l.tokenIsToken0, fullLower, fullUpper, coins, raised);
        l.pool = pool;
        l.positionId = posId;
        emit LiquidityAdded(token, posId, 0, usedCoins, usedQuote);

        // 2) whatever coins the ratio left behind go single-sided above price, so
        //    the pool holds every coin the auction did not sell.
        uint256 left = IERC20(token).balanceOf(address(this));
        if (left > 0) {
            (int24 lower, int24 upper) = _aboveRange(l.tokenIsToken0, tickSpacing, sqrtPriceX96);
            (uint256 posId2, uint256 c2,) = _mint(token, l.tokenIsToken0, lower, upper, left, 0);
            a.overflowPositionId = posId2;
            emit LiquidityAdded(token, posId2, 0, c2, 0);
        }
        emit AuctionFinalized(token, a.auction, true, lp.initialPriceX96, lp.tokensSold, lp.currencyRaised);
    }

    // ------------------------------------------------------------------
    // Fees: holders / creator / platform
    // ------------------------------------------------------------------

    /// @notice Collect the fees accrued to a coin's positions and split the
    ///         WHYPE side holders / creator / platform. Permissionless.
    function harvestFees(address token)
        external
        nonReentrant
        returns (uint256 creatorToken, uint256 creatorQuote, uint256 platformToken, uint256 platformQuote)
    {
        Listing memory l = listings[token];
        if (l.pool == address(0)) revert UnknownToken();
        (uint256 tokenAmount, uint256 quoteAmount) = _collect(l.positionId, l.tokenIsToken0);
        uint256 ov = auctions[token].overflowPositionId;
        if (ov != 0) {
            (uint256 t2, uint256 q2) = _collect(ov, l.tokenIsToken0);
            tokenAmount += t2;
            quoteAmount += q2;
        }
        if (tokenAmount == 0 && quoteAmount == 0) revert NothingToCollect();

        uint256 holderQuote = (quoteAmount * HOLDER_FEE_BPS) / BPS;
        creatorQuote = (quoteAmount * CREATOR_FEE_BPS) / BPS;
        if (holderQuote > 0) {
            if (OnairToken(token).eligibleSupply() > 0) {
                IERC20(l.quote).safeTransfer(token, holderQuote);
                OnairToken(token).distributeRewards(holderQuote);
            } else {
                creatorQuote += holderQuote;
            }
        }
        platformQuote = quoteAmount - holderQuote - ((quoteAmount * CREATOR_FEE_BPS) / BPS);
        uint16 cpBps = CREATOR_FEE_BPS + PLATFORM_FEE_BPS;
        creatorToken = cpBps == 0 ? 0 : (tokenAmount * CREATOR_FEE_BPS) / cpBps;
        platformToken = tokenAmount - creatorToken;
        if (creatorToken > 0) IERC20(token).safeTransfer(l.creator, creatorToken);
        if (creatorQuote > 0) IERC20(l.quote).safeTransfer(l.creator, creatorQuote);
        if (platformToken > 0) IERC20(token).safeTransfer(feeRecipient, platformToken);
        if (platformQuote > 0) IERC20(l.quote).safeTransfer(feeRecipient, platformQuote);
        emit FeesCollected(token, l.creator, creatorToken, creatorQuote, platformToken, platformQuote);
    }

    // ------------------------------------------------------------------
    // Owner (admin)
    // ------------------------------------------------------------------

    /// @notice Remove a coin's liquidity and send everything to the owner.
    function collectFees(address token) external onlyOwner nonReentrant returns (uint256 tokenAmount, uint256 quoteAmount) {
        Listing memory l = listings[token];
        if (l.pool == address(0)) revert UnknownToken();
        (uint128 liq, uint256 t, uint256 q) = _unwind(l.positionId, l.tokenIsToken0);
        tokenAmount += t;
        quoteAmount += q;
        uint256 ov = auctions[token].overflowPositionId;
        if (ov != 0) {
            (, uint256 t2, uint256 q2) = _unwind(ov, l.tokenIsToken0);
            tokenAmount += t2;
            quoteAmount += q2;
        }
        if (tokenAmount == 0 && quoteAmount == 0) revert NothingToCollect();
        emit LiquidityCollected(token, liq, tokenAmount, quoteAmount, owner());
    }

    /// @notice USD per HYPE (8 decimals), used to size floors and minimums.
    function setQuoteUsd(uint64 usdPrice8) external onlyOwner {
        if (usdPrice8 == 0) revert InvalidParams();
        quoteAssets[wrappedNative].usdPrice8 = usdPrice8;
        emit QuoteUsdUpdated(usdPrice8);
    }

    function setAuctionConfig(uint64 durationBlocks, uint64 claimDelayBlocks, uint256 floorMcapUsd8, uint256 minFdvUsd8) external onlyOwner {
        if (durationBlocks < 100 || durationBlocks > 1_000_000 || floorMcapUsd8 == 0 || minFdvUsd8 < floorMcapUsd8) revert InvalidParams();
        auctionConfig = AuctionConfig({durationBlocks: durationBlocks, claimDelayBlocks: claimDelayBlocks, floorMcapUsd8: floorMcapUsd8, minFdvUsd8: minFdvUsd8});
        emit AuctionConfigUpdated(durationBlocks, claimDelayBlocks, floorMcapUsd8, minFdvUsd8);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function pause() external onlyOwner {
        if (launchesPaused) revert InvalidParams();
        launchesPaused = true;
        emit FactoryPaused(msg.sender);
    }

    function resume() external onlyOwner {
        if (!launchesPaused) revert NotPaused();
        launchesPaused = false;
        emit FactoryResumed(msg.sender);
    }

    function recoverERC20(address asset, uint256 amount) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidParams();
        IERC20(asset).safeTransfer(owner(), amount);
        emit EmergencyRecovered(asset, amount, owner());
    }

    function recoverNative() external onlyOwner {
        uint256 amount = address(this).balance;
        if (amount == 0) revert InvalidParams();
        (bool ok,) = owner().call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit EmergencyRecovered(address(0), amount, owner());
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    /// @notice Preview the floor price (Q96) and required raise for a new auction.
    function auctionPreview() external view returns (uint256 floorPriceQ96, uint256 requiredCurrencyRaised, uint64 durationBlocks) {
        AuctionConfig memory c = auctionConfig;
        floorPriceQ96 = (_priceQ96ForMcap(c.floorMcapUsd8) / 100) * 100;
        requiredCurrencyRaised = (_mcapToQuoteWei(c.minFdvUsd8) * AUCTION_BPS) / BPS;
        durationBlocks = c.durationBlocks;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    receive() external payable {}

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev Market cap (USD 8-dec) -> HYPE wei at the configured HYPE price.
    function _mcapToQuoteWei(uint256 mcapUsd8) internal view returns (uint256) {
        return Math.mulDiv(mcapUsd8, 1e18, quoteAssets[wrappedNative].usdPrice8);
    }

    function _quoteWeiToMcap(uint256 quoteWei) internal view returns (uint256) {
        return Math.mulDiv(quoteWei, quoteAssets[wrappedNative].usdPrice8, 1e18);
    }

    /// @dev HYPE-wei per token-wei, Q96, at a fully-diluted market cap.
    function _priceQ96ForMcap(uint256 mcapUsd8) internal view returns (uint256) {
        uint256 p = Math.mulDiv(_mcapToQuoteWei(mcapUsd8), Q96, TOTAL_SUPPLY);
        if (p == 0) revert InvalidParams();
        return p;
    }

    /// @dev Single step: issue the whole auction supply evenly over `blocks`.
    ///      Packed uint64 per step = (mps << 40) | blockDelta, and the sum of
    ///      mps * blockDelta must equal MPS; a second step absorbs rounding.
    function _steps(uint64 blocks) internal pure returns (bytes memory) {
        uint24 mps = uint24(MPS / blocks);
        uint64 rem = uint64(MPS - uint256(mps) * blocks);
        if (rem == 0) return abi.encodePacked(uint64((uint64(mps) << 40) | blocks));
        // (blocks - rem) blocks at mps, then rem blocks at mps + 1.
        return abi.encodePacked(
            uint64((uint64(mps) << 40) | (blocks - rem)),
            uint64((uint64(mps + 1) << 40) | rem)
        );
    }

    /// @dev Pool sqrt price from a target market cap, snapped down to a tick.
    function _sqrtPriceForMcap(bool tokenIsToken0, int24 tickSpacing, uint256 mcapUsd8, bool aboveForSeed)
        internal
        view
        returns (uint160)
    {
        uint256 priceQ96 = _priceQ96ForMcap(mcapUsd8);
        return _sqrtPriceFromQ96(tokenIsToken0, tickSpacing, priceQ96) + (aboveForSeed ? 0 : 0);
    }

    /// @dev sqrtPriceX96 for a HYPE-per-token Q96 price, respecting token order,
    ///      snapped to the tick grid (down, so a single-sided seed sits above).
    function _sqrtPriceFromQ96(bool tokenIsToken0, int24 tickSpacing, uint256 priceQ96) internal pure returns (uint160) {
        // token0-denominated price (token1 per token0) in Q96
        uint256 pQ96 = tokenIsToken0 ? priceQ96 : Math.mulDiv(Q96, Q96, priceQ96);
        uint160 target = uint160(Math.sqrt(pQ96 << 96));
        int24 tick = TickMath.getTickAtSqrtRatio(target);
        int24 aligned = (tick / tickSpacing) * tickSpacing;
        if (tick < 0 && tick % tickSpacing != 0) aligned -= tickSpacing;
        return TickMath.getSqrtRatioAtTick(tokenIsToken0 ? aligned : aligned + tickSpacing);
    }

    /// @dev Range strictly above the current price on the coin's side.
    function _aboveRange(bool tokenIsToken0, int24 tickSpacing, uint160 sqrtPriceX96) internal pure returns (int24 lower, int24 upper) {
        int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        int24 aligned = (tick / tickSpacing) * tickSpacing;
        if (tick < 0 && tick % tickSpacing != 0) aligned -= tickSpacing;
        if (tokenIsToken0) {
            lower = aligned + tickSpacing;
            upper = (MAX_TICK / tickSpacing) * tickSpacing;
        } else {
            lower = (MIN_TICK / tickSpacing) * tickSpacing;
            upper = aligned; // price sits on this boundary; the range is entirely below it
        }
    }

    function _createPool(address token, bool tokenIsToken0, uint160 sqrtPriceX96, uint256 mcapUsd8) internal returns (address pool) {
        (address t0, address t1) = tokenIsToken0 ? (token, wrappedNative) : (wrappedNative, token);
        pool = positionManager.createAndInitializePoolIfNecessary(t0, t1, POOL_FEE_TIER, sqrtPriceX96);
        OnairToken(token).initPool(pool);
        emit PoolCreated(token, pool, POOL_FEE_TIER, sqrtPriceX96, mcapUsd8);
    }

    function _mint(address token, bool tokenIsToken0, int24 lower, int24 upper, uint256 tokenDesired, uint256 quoteDesired)
        internal
        returns (uint256 positionId, uint256 tokenUsed, uint256 quoteUsed)
    {
        if (tokenDesired > 0) IERC20(token).forceApprove(address(positionManager), tokenDesired);
        if (quoteDesired > 0) IERC20(wrappedNative).forceApprove(address(positionManager), quoteDesired);
        (address t0, address t1) = tokenIsToken0 ? (token, wrappedNative) : (wrappedNative, token);
        (uint256 a0, uint256 a1) = tokenIsToken0 ? (tokenDesired, quoteDesired) : (quoteDesired, tokenDesired);
        uint256 amount0;
        uint256 amount1;
        (positionId,, amount0, amount1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: t0, token1: t1, fee: POOL_FEE_TIER, tickLower: lower, tickUpper: upper,
                amount0Desired: a0, amount1Desired: a1, amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            })
        );
        (tokenUsed, quoteUsed) = tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);
    }

    function _collect(uint256 positionId, bool tokenIsToken0) internal returns (uint256 tokenAmount, uint256 quoteAmount) {
        (uint256 a0, uint256 a1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({tokenId: positionId, recipient: address(this), amount0Max: type(uint128).max, amount1Max: type(uint128).max})
        );
        (tokenAmount, quoteAmount) = tokenIsToken0 ? (a0, a1) : (a1, a0);
    }

    function _unwind(uint256 positionId, bool tokenIsToken0) internal returns (uint128 liquidity, uint256 tokenAmount, uint256 quoteAmount) {
        (,,,,,,, liquidity,,,,) = positionManager.positions(positionId);
        if (liquidity > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({tokenId: positionId, liquidity: liquidity, amount0Min: 0, amount1Min: 0, deadline: block.timestamp})
            );
        }
        (uint256 a0, uint256 a1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({tokenId: positionId, recipient: owner(), amount0Max: type(uint128).max, amount1Max: type(uint128).max})
        );
        (tokenAmount, quoteAmount) = tokenIsToken0 ? (a0, a1) : (a1, a0);
    }
}
