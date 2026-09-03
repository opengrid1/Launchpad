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
import {IUniswapV3Factory, IUniswapV3Pool, INonfungiblePositionManager, ISwapRouter, IWETH9} from "../interfaces/IUniswapV3.sol";
import {OnairAuctionHouse} from "./OnairAuctionHouse.sol";

/// @title OnairFactory
/// @notice Launchpad for HyperEVM with two launch models on one factory:
///
///   INSTANT  One transaction deploys the coin, opens a HyperSwap V3 pool at a
///            target market cap (default $3,000) seeded single-sided with the
///            whole supply, and trading starts on the official router.
///
///   AUCTION  The coin's supply is split: AUCTION_BPS goes into the ONAIR
///            auction house, a continuous clearing auction (budget + max price
///            bids, spread across the remaining blocks, one rising uniform
///            clearing price) whose escrow this protocol holds. When the auction
///            ends and has graduated (raised at least the configured bond),
///            {finalize} moves the raised HYPE and the unsold coins here and
///            seeds a two-sided, factory-locked HyperSwap V3 pool at the
///            clearing price. If it did not graduate, every bidder is refunded.
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
    error NotFinalized();
    error HouseAlreadySet();
    error PoolTampered();

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, string metadataURI, uint8 mode);
    event PoolCreated(address indexed token, address pool, uint24 feeTier, uint160 sqrtPriceX96, uint256 marketCapUsd8);
    event LiquidityAdded(address indexed token, uint256 positionId, uint128 liquidity, uint256 tokenAmount, uint256 quoteAmount);
    event AuctionStarted(address indexed token, uint64 startBlock, uint64 endBlock, uint256 floorPriceQ96, uint256 minRaiseWei);
    event AuctionFinalized(address indexed token, bool graduated, uint256 clearingPriceQ96, uint256 tokensSold, uint256 currencyRaised);
    event AuctionHouseSet(address indexed house);
    event EscrowCollected(address indexed token, address indexed to, uint256 amount);
    event EscrowSwept(address indexed token, address indexed to, uint256 amount);
    event FeesCollected(address indexed token, address indexed creator, uint256 creatorTokenAmount, uint256 creatorQuoteAmount, uint256 platformTokenAmount, uint256 platformQuoteAmount);
    event LiquidityCollected(address indexed token, uint128 liquidityRemoved, uint256 tokenAmount, uint256 quoteAmount, address indexed recipient);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event FactoryPaused(address indexed by);
    event FactoryResumed(address indexed by);
    event EmergencyRecovered(address indexed asset, uint256 amount, address indexed to);
    event QuoteUsdUpdated(uint64 usdPrice8);
    event AuctionConfigUpdated(uint64 durationBlocks, uint256 minBidWei, uint256 floorMcapUsd8, uint256 minRaiseWei);
    event PoolPriceRestored(address indexed pool, uint160 fromSqrtPriceX96, uint160 toSqrtPriceX96, int256 amount0, int256 amount1);

    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------
    enum Mode { Instant, Auction }

    struct CreateParams {
        string name;
        string symbol;
        string metadataURI;
        /// @dev Instant: optional starting market cap, USD 8-dec (0 = default).
        ///      Auction: the max market cap of the creator's opening bid
        ///      (0 = 100x the floor, i.e. practically never outbid).
        uint256 marketCapUsd8;
        /// @dev Optional first buy in HYPE, sent as msg.value. Instant: swapped
        ///      on the fresh pool. Auction: placed as the creator's opening bid.
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
        /// @dev Smallest bid budget accepted (wei). Keeps dust bids from
        ///      bloating the tick list that repricing has to walk.
        uint256 minBidWei;
        /// @dev Floor price expressed as a fully-diluted market cap, USD 8-dec.
        uint256 floorMcapUsd8;
        /// @dev HYPE (wei) the auction must raise to graduate ("bond"). Below
        ///      this every bidder is refunded and no pool opens.
        uint256 minRaiseWei;
    }

    // ------------------------------------------------------------------
    // Constants / immutables
    // ------------------------------------------------------------------
    uint16 internal constant BPS = 10_000;
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;
    uint256 internal constant Q96 = 1 << 96;

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
    /// @notice The auction house (escrow + clearing), wired once after deploy.
    OnairAuctionHouse public house;

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
    /// @dev Pool allowed to call the swap callback during a price restore.
    address private _swapPool;

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
        uint64 hypeUsd8_,
        uint16 holderFeeBps_,
        uint16 creatorFeeBps_,
        uint24 poolFeeTier_
    ) Ownable(owner_) {
        if (
            feeRecipient_ == address(0) || address(tokenDeployer_) == address(0) || address(uniswapFactory_) == address(0)
                || address(positionManager_) == address(0) || address(swapRouter_) == address(0) || wrappedNative_ == address(0)
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
        quoteAssets[wrappedNative_] = QuoteAsset({approved: true, usdPrice8: hypeUsd8_, decimals: 18});
        // 4 hours at ~1s blocks, 0.05 HYPE smallest bid, $3k floor, 220 HYPE raised to graduate.
        auctionConfig = AuctionConfig({durationBlocks: 14_400, minBidWei: 0.05 ether, floorMcapUsd8: 3_000e8, minRaiseWei: 220 ether});
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
        uint160 sqrtPriceX96 = _sqrtPriceFromQ96(tokenIsToken0, tickSpacing, _priceQ96ForMcap(mcapUsd8));
        pool = _createPool(token, tokenIsToken0, sqrtPriceX96, mcapUsd8);

        // Every coin we hold (the whole supply, less anything a price restore
        // sold above the launch price) goes single-sided above the price.
        (int24 lower, int24 upper) = _aboveRange(tokenIsToken0, tickSpacing, sqrtPriceX96);
        uint256 tokenAmt;
        (positionId, tokenAmt,) = _mint(token, tokenIsToken0, lower, upper, IERC20(token).balanceOf(address(this)), 0);
        emit LiquidityAdded(token, positionId, 0, tokenAmt, 0);

        listings[token] = Listing({creator: msg.sender, quote: wrappedNative, pool: pool, positionId: positionId, createdAt: uint64(block.timestamp), tokenIsToken0: tokenIsToken0});
        auctions[token] = AuctionInfo({mode: Mode.Instant, finalized: true, graduated: true, overflowPositionId: 0});
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

    /// @notice Deploy a coin and put AUCTION_BPS of its supply into the auction
    ///         house, paid in native HYPE. Bidding goes to the house. An optional
    ///         `devBuyQuote` (msg.value) becomes the creator's opening bid.
    function createAuction(CreateParams calldata p) external payable nonReentrant returns (address token) {
        if (launchesPaused) revert LaunchesArePaused();
        if (address(house) == address(0)) revert ZeroAddress();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidParams();
        if (msg.value != p.devBuyQuote) revert InvalidParams();
        AuctionConfig memory c = auctionConfig;

        token = tokenDeployer.deploy(msg.sender, p.name, p.symbol, p.metadataURI, wrappedNative);
        emit TokenCreated(token, msg.sender, p.name, p.symbol, p.metadataURI, uint8(Mode.Auction));

        // Prices are HYPE-wei per coin-wei, Q96. Bid granularity is 1% of the
        // floor; the floor is re-derived from it so it sits on the grid.
        uint256 tickSpacingQ96 = _priceQ96ForMcap(c.floorMcapUsd8) / 100;
        if (tickSpacingQ96 == 0) revert InvalidParams();
        uint256 floorPriceQ96 = tickSpacingQ96 * 100;

        // The house never earns holder rewards; hand it the auctioned supply.
        OnairToken(token).setExcluded(address(house), true);
        IERC20(token).safeTransfer(address(house), AUCTION_SUPPLY);
        house.open(token, AUCTION_SUPPLY, OnairAuctionHouse.Params({durationBlocks: c.durationBlocks, floorPriceQ96: floorPriceQ96, tickSpacingQ96: tickSpacingQ96, minRaiseWei: c.minRaiseWei, minBidWei: c.minBidWei}));

        listings[token] = Listing({creator: msg.sender, quote: wrappedNative, pool: address(0), positionId: 0, createdAt: uint64(block.timestamp), tokenIsToken0: token < wrappedNative});
        auctions[token] = AuctionInfo({mode: Mode.Auction, finalized: false, graduated: false, overflowPositionId: 0});
        allTokens.push(token);
        emit AuctionStarted(token, uint64(block.number), uint64(block.number) + c.durationBlocks, floorPriceQ96, c.minRaiseWei);

        if (p.devBuyQuote > 0) {
            // Creator's opening bid: max price from `marketCapUsd8`, rounded up
            // to the grid; 0 means 100x the floor.
            uint256 maxPriceQ96 = p.marketCapUsd8 == 0 ? floorPriceQ96 * 100 : _priceQ96ForMcap(p.marketCapUsd8);
            maxPriceQ96 = ((maxPriceQ96 + tickSpacingQ96 - 1) / tickSpacingQ96) * tickSpacingQ96;
            if (maxPriceQ96 < floorPriceQ96) maxPriceQ96 = floorPriceQ96;
            house.bidFor{value: p.devBuyQuote}(token, msg.sender, maxPriceQ96, 0);
        }
    }

    /// @notice After the auction's end block: seed the locked pool at the
    ///         clearing price (graduated) or release the unsold supply back here
    ///         (failed; bidders are refunded on claim). Anyone may call.
    function finalize(address token) external nonReentrant returns (address pool) {
        return _finalize(token);
    }

    /// @notice One-step exit for a bidder once the auction is finalized: coins
    ///         and the refund of unspent HYPE go to the bid's owner, whoever
    ///         calls. `cpHint` comes from {OnairAuctionHouse.exitHint}.
    function settle(address token, uint256 bidId, uint32 cpHint) external nonReentrant returns (uint256 coins, uint256 refund) {
        AuctionInfo storage a = auctions[token];
        if (a.mode != Mode.Auction) revert NotAnAuction();
        if (!a.finalized) revert NotFinalized();
        return house.claim(token, bidId, cpHint);
    }

    function _finalize(address token) internal returns (address pool) {
        AuctionInfo storage a = auctions[token];
        if (a.mode != Mode.Auction) revert NotAnAuction();
        if (a.finalized) revert AlreadyFinalized();
        a.finalized = true;

        (bool graduated, uint256 clearingQ96, uint256 raised, uint256 sold,) = house.finalize(token);
        if (!graduated) {
            emit AuctionFinalized(token, false, 0, 0, 0);
            return address(0);
        }
        a.graduated = true;

        // Wrap exactly the HYPE the house just sent (raised minus any escrow the
        // owner already collected; 0 after a sweep). Stray native balance is
        // left alone for {recoverNative}.
        if (raised > 0) IWETH9(wrappedNative).deposit{value: raised}();

        Listing storage l = listings[token];
        int24 tickSpacing = uniswapFactory.feeAmountTickSpacing(POOL_FEE_TIER);
        uint160 sqrtPriceX96 = _sqrtPriceFromQ96(l.tokenIsToken0, tickSpacing, clearingQ96);
        pool = _createPool(token, l.tokenIsToken0, sqrtPriceX96, _quoteWeiToMcap(Math.mulDiv(clearingQ96, TOTAL_SUPPLY, Q96)));

        // Seed with every coin we hold for this launch (reserve + unsold) and
        // all the WHYPE we hold (the raise, plus anything a price restore sold
        // coins for above the clearing price).
        uint256 coins = IERC20(token).balanceOf(address(this));
        uint256 hype = IERC20(wrappedNative).balanceOf(address(this));

        // 1) two-sided full-range position: all the HYPE against as many coins as
        //    the price ratio takes.
        int24 fullLower = (MIN_TICK / tickSpacing) * tickSpacing;
        int24 fullUpper = (MAX_TICK / tickSpacing) * tickSpacing;
        uint256 posId;
        uint256 usedCoins;
        uint256 usedQuote;
        if (hype > 0) {
            (posId, usedCoins, usedQuote) = _mint(token, l.tokenIsToken0, fullLower, fullUpper, coins, hype);
            emit LiquidityAdded(token, posId, 0, usedCoins, usedQuote);
        }

        // 2) the two-sided seed takes the full amount of one side and leaves the
        //    other's remainder. Coins left over go single-sided above the price,
        //    WHYPE left over single-sided below it, so the pool ends up holding
        //    everything the launch raised and did not sell. Dust stays here:
        //    V3 rejects zero-liquidity mints.
        uint256 leftCoins = IERC20(token).balanceOf(address(this));
        uint256 leftHype = IERC20(wrappedNative).balanceOf(address(this));
        if (leftCoins > TOTAL_SUPPLY / 1e6) {
            (int24 lower, int24 upper) = _aboveRange(l.tokenIsToken0, tickSpacing, sqrtPriceX96);
            // V3 may round the pulled amount up by a wei; keep a hair back.
            (uint256 posId2, uint256 c2,) = _mint(token, l.tokenIsToken0, lower, upper, leftCoins - 1e3, 0);
            if (posId == 0) posId = posId2; else a.overflowPositionId = posId2;
            emit LiquidityAdded(token, posId2, 0, c2, 0);
        } else if (leftHype > 1e12) {
            // the HYPE side sits on the other side of the price
            (int24 lower, int24 upper) = _aboveRange(!l.tokenIsToken0, tickSpacing, sqrtPriceX96);
            (uint256 posId2,, uint256 q2) = _mint(token, l.tokenIsToken0, lower, upper, 0, leftHype - 1e3);
            a.overflowPositionId = posId2;
            emit LiquidityAdded(token, posId2, 0, 0, q2);
        }
        l.pool = pool;
        l.positionId = posId;
        emit AuctionFinalized(token, true, clearingQ96, sold, raised);
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

    /// @notice Owner: pull `liquidityBps` of a coin's liquidity (plus any fees
    ///         sitting on the positions) to `recipient`. 10000 = everything.
    function collect(address token, uint16 liquidityBps, address recipient)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokenAmount, uint256 quoteAmount)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (liquidityBps > BPS) revert InvalidParams();
        Listing memory l = listings[token];
        if (l.pool == address(0)) revert UnknownToken();
        (uint128 liq, uint256 t, uint256 q) = _unwind(l.positionId, l.tokenIsToken0, liquidityBps, recipient);
        tokenAmount += t;
        quoteAmount += q;
        uint256 ov = auctions[token].overflowPositionId;
        if (ov != 0) {
            (uint128 liq2, uint256 t2, uint256 q2) = _unwind(ov, l.tokenIsToken0, liquidityBps, recipient);
            liq += liq2;
            tokenAmount += t2;
            quoteAmount += q2;
        }
        if (tokenAmount == 0 && quoteAmount == 0) revert NothingToCollect();
        emit LiquidityCollected(token, liq, tokenAmount, quoteAmount, recipient);
    }

    /// @notice Owner: remove all of a coin's liquidity to the owner.
    function collectFees(address token) external onlyOwner nonReentrant returns (uint256 tokenAmount, uint256 quoteAmount) {
        Listing memory l = listings[token];
        if (l.pool == address(0)) revert UnknownToken();
        (uint128 liq, uint256 t, uint256 q) = _unwind(l.positionId, l.tokenIsToken0, BPS, owner());
        tokenAmount += t;
        quoteAmount += q;
        uint256 ov = auctions[token].overflowPositionId;
        if (ov != 0) {
            (, uint256 t2, uint256 q2) = _unwind(ov, l.tokenIsToken0, BPS, owner());
            tokenAmount += t2;
            quoteAmount += q2;
        }
        if (tokenAmount == 0 && quoteAmount == 0) revert NothingToCollect();
        emit LiquidityCollected(token, liq, tokenAmount, quoteAmount, owner());
    }

    /// @notice One-time wiring of the auction house (it needs this factory's address first).
    function setAuctionHouse(OnairAuctionHouse house_) external onlyOwner {
        if (address(house) != address(0)) revert HouseAlreadySet();
        if (address(house_) == address(0) || house_.factory() != address(this)) revert InvalidParams();
        house = house_;
        emit AuctionHouseSet(address(house_));
    }

    /// @notice Owner: take the HYPE bidders have already spent in a running
    ///         auction out of escrow, to `to`. Unspent budgets stay for refunds;
    ///         after this the auction cannot fail (fills stand).
    function collectEscrow(address token, address to) external onlyOwner nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        if (auctions[token].mode != Mode.Auction) revert NotAnAuction();
        amount = house.collectEscrow(token, to);
        emit EscrowCollected(token, to, amount);
    }

    /// @notice Owner: take the whole escrow of an auction (spent and unspent) to
    ///         `to`, at any time. Bidders keep the coins their bids filled; no
    ///         HYPE is refunded; the pool is seeded with coins only.
    function sweepEscrow(address token, address to) external onlyOwner nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        if (auctions[token].mode != Mode.Auction) revert NotAnAuction();
        amount = house.sweepEscrow(token, to);
        emit EscrowSwept(token, to, amount);
    }

    /// @notice Owner: stop a running auction; every bidder is refunded in full on claim.
    function cancelAuction(address token) external onlyOwner {
        if (auctions[token].mode != Mode.Auction) revert NotAnAuction();
        house.cancel(token);
    }

    /// @notice USD per HYPE (8 decimals), used to size floors and minimums.
    function setQuoteUsd(uint64 usdPrice8) external onlyOwner {
        if (usdPrice8 == 0) revert InvalidParams();
        quoteAssets[wrappedNative].usdPrice8 = usdPrice8;
        emit QuoteUsdUpdated(usdPrice8);
    }

    function setAuctionConfig(uint64 durationBlocks, uint256 minBidWei, uint256 floorMcapUsd8, uint256 minRaiseWei) external onlyOwner {
        if (
            durationBlocks < 100 || durationBlocks > 1_000_000 || floorMcapUsd8 < MIN_MARKET_CAP_USD8 || floorMcapUsd8 > MAX_MARKET_CAP_USD8
                || minRaiseWei == 0 || minRaiseWei > type(uint128).max || minBidWei > type(uint128).max
        ) revert InvalidParams();
        auctionConfig = AuctionConfig({durationBlocks: durationBlocks, minBidWei: minBidWei, floorMcapUsd8: floorMcapUsd8, minRaiseWei: minRaiseWei});
        emit AuctionConfigUpdated(durationBlocks, minBidWei, floorMcapUsd8, minRaiseWei);
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
        requiredCurrencyRaised = c.minRaiseWei;
        durationBlocks = c.durationBlocks;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /// @dev Pays a price-restoring swap (see {_restorePoolPrice}). Only the pool
    ///      being restored may call this, and only during that swap.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender == address(0) || msg.sender != _swapPool) revert PoolTampered();
        if (amount0Delta > 0) IERC20(IUniswapV3Pool(msg.sender).token0()).safeTransfer(msg.sender, uint256(amount0Delta));
        if (amount1Delta > 0) IERC20(IUniswapV3Pool(msg.sender).token1()).safeTransfer(msg.sender, uint256(amount1Delta));
    }

    /// @dev Native HYPE arrives here only from the auction house at finalize.
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

    /// @dev Create the pool at `sqrtPriceX96`. Anyone can create a V3 pool for a
    ///      known token address ahead of us (an auction coin's address is public
    ///      for hours) and initialise it at any price, so the pool that comes
    ///      back is only trusted once its price is the one we asked for.
    function _createPool(address token, bool tokenIsToken0, uint160 sqrtPriceX96, uint256 mcapUsd8) internal returns (address pool) {
        (address t0, address t1) = tokenIsToken0 ? (token, wrappedNative) : (wrappedNative, token);
        pool = positionManager.createAndInitializePoolIfNecessary(t0, t1, POOL_FEE_TIER, sqrtPriceX96);
        (uint160 current,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (current != sqrtPriceX96) _restorePoolPrice(pool, t0, t1, current, sqrtPriceX96);
        OnairToken(token).initPool(pool);
        emit PoolCreated(token, pool, POOL_FEE_TIER, sqrtPriceX96, mcapUsd8);
    }

    /// @dev Move a pre-existing pool from `current` to `target`. With no
    ///      liquidity on the way a swap moves the price for free. If someone
    ///      parked liquidity in between, the swap trades what we hold into it
    ///      (coins sold above our price, or WHYPE spent below it) and stops at
    ///      `target`; the proceeds stay here and join the seed. If the price
    ///      still is not ours afterwards the launch reverts rather than seed a
    ///      mispriced pool.
    function _restorePoolPrice(address pool, address t0, address t1, uint160 current, uint160 target) internal {
        bool zeroForOne = current > target;
        uint256 have = IERC20(zeroForOne ? t0 : t1).balanceOf(address(this));
        _swapPool = pool;
        (int256 a0, int256 a1) = IUniswapV3Pool(pool).swap(address(this), zeroForOne, int256(have == 0 ? 1 : have), target, "");
        _swapPool = address(0);
        (uint160 after_,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (after_ != target) revert PoolTampered();
        emit PoolPriceRestored(pool, current, target, a0, a1);
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

    function _unwind(uint256 positionId, bool tokenIsToken0, uint16 bps, address to)
        internal
        returns (uint128 liquidity, uint256 tokenAmount, uint256 quoteAmount)
    {
        (,,,,,,, uint128 total,,,,) = positionManager.positions(positionId);
        liquidity = uint128((uint256(total) * bps) / BPS);
        if (liquidity > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({tokenId: positionId, liquidity: liquidity, amount0Min: 0, amount1Min: 0, deadline: block.timestamp})
            );
        }
        (uint256 a0, uint256 a1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({tokenId: positionId, recipient: to, amount0Max: type(uint128).max, amount1Max: type(uint128).max})
        );
        (tokenAmount, quoteAmount) = tokenIsToken0 ? (a0, a1) : (a1, a0);
    }
}
