// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LaunchToken} from "./LaunchToken.sol";
import {
    IWHYPE,
    IHyperswapV3Pool,
    INonfungiblePositionManager,
    ISwapRouter
} from "./interfaces/IHyperswapV3.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {FullMath} from "./libraries/FullMath.sol";

/// @title Launchpad — flaunch-style token launcher for HyperSwap V3 on HyperEVM
/// @notice No bonding curve and no sale phase. `createToken` deploys a fixed-supply ERC20,
///         creates a TOKEN/WHYPE pool on HyperSwap V3 at the creator's chosen starting price,
///         and deposits 100% of the supply as single-sided liquidity in one atomic transaction.
///         All trading happens directly on HyperSwap V3 from block one. Swap fees from the
///         1% pool tier are collected via `collectFees` and split 70% to the token's
///         creator / 30% to the platform treasury.
/// @dev TRUST NOTE: the owner can withdraw any launch's LP position via `withdrawPosition`.
///      Liquidity is therefore NOT trustlessly locked — token buyers must trust the
///      platform owner not to pull liquidity. Putting the owner behind a timelock or
///      multisig is strongly recommended.
contract Launchpad {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Pool fee tier used for every launch (1%). This is the revenue source.
    uint24 public constant POOL_FEE = 10_000;
    /// @notice Tick spacing of the 1% tier on HyperSwap V3 (verified on-chain).
    int24 public constant TICK_SPACING = 200;
    /// @notice Creator share of collected fees, in basis points (70%). Remainder is platform's.
    uint256 public constant CREATOR_SHARE_BPS = 7_000;
    uint256 internal constant BPS = 10_000;
    /// @notice TWAP window used to bound the token->WHYPE fee swap against sandwiching.
    uint32 public constant TWAP_WINDOW = 300;
    /// @notice Max accepted slippage vs TWAP for the fee swap, in bps.
    uint256 public constant TWAP_SLIPPAGE_BPS = 500;
    /// @notice Observation slots pre-paid at launch so the pool can serve TWAPs.
    uint16 public constant OBSERVATION_CARDINALITY = 32;

    uint256 internal constant Q96 = 0x1000000000000000000000000;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ---------------------------------------------------------------------
    // Immutables / admin
    // ---------------------------------------------------------------------

    INonfungiblePositionManager public immutable positionManager;
    ISwapRouter public immutable swapRouter;
    IWHYPE public immutable whype;

    address public owner;
    address public treasury;

    // ---------------------------------------------------------------------
    // Launch state
    // ---------------------------------------------------------------------

    struct Launch {
        address creator;
        uint64 createdAt;
        bool tokenIsToken0;
        bool positionWithdrawn;
        address pool;
        uint256 positionId;
    }

    /// @notice token address => launch info.
    mapping(address => Launch) public launches;
    /// @notice Every token ever launched, in creation order. See `allTokensLength`.
    address[] public allTokens;
    /// @notice Tokens launched by a given creator (launch-time creator; the list does
    ///         not move with `transferCreator`).
    mapping(address => address[]) private _creatorTokens;
    /// @notice Cumulative WHYPE-denominated fees ever collected for a token
    ///         (creator + platform combined).
    mapping(address => uint256) public lifetimeFeesHype;
    /// @notice Cumulative in-kind token fees ever collected for a token.
    mapping(address => uint256) public lifetimeFeesToken;
    /// @notice Creator-claimable fees per token, denominated in WHYPE.
    mapping(address => uint256) public creatorFeesHype;
    /// @notice Creator-claimable fees per token paid in-kind (only when the
    ///         TWAP-bounded swap to WHYPE was unavailable at collection time).
    mapping(address => uint256) public creatorFeesToken;
    /// @notice Platform-claimable fees, denominated in WHYPE (aggregate across launches).
    uint256 public platformFeesHype;
    /// @notice Platform-claimable in-kind fees per token.
    mapping(address => uint256) public platformFeesToken;

    uint256 private _locked = 1;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event TokenLaunched(
        address indexed token,
        address indexed creator,
        address pool,
        uint256 positionId,
        string name,
        string symbol,
        string tokenURI,
        uint256 totalSupply,
        uint256 priceWeiPerToken,
        uint256 devBuyHype,
        uint256 devBuyTokens
    );
    event FeesCollected(address indexed token, uint256 hypeAmount, uint256 tokenAmount);
    event CreatorFeesClaimed(address indexed token, address indexed creator, uint256 hypeAmount, uint256 tokenAmount);
    event PlatformFeesClaimed(address indexed treasury, uint256 hypeAmount);
    event PlatformTokenFeesClaimed(address indexed token, address indexed treasury, uint256 tokenAmount);
    event CreatorTransferred(address indexed token, address indexed oldCreator, address indexed newCreator);
    event PositionWithdrawn(address indexed token, uint256 indexed positionId, address indexed recipient);
    event TreasuryUpdated(address indexed treasury);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier nonReentrant() {
        require(_locked == 1, "reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(
        INonfungiblePositionManager positionManager_,
        ISwapRouter swapRouter_,
        IWHYPE whype_,
        address treasury_
    ) {
        require(
            address(positionManager_) != address(0) && address(swapRouter_) != address(0)
                && address(whype_) != address(0) && treasury_ != address(0),
            "zero address"
        );
        positionManager = positionManager_;
        swapRouter = swapRouter_;
        whype = whype_;
        treasury = treasury_;
        owner = msg.sender;
        // The router and position manager are trusted canonical periphery; max-approve once.
        whype_.approve(address(swapRouter_), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // Launching
    // ---------------------------------------------------------------------

    /// @notice Deploys a token and lists it on HyperSwap V3 in one transaction.
    /// @param name_            ERC20 name.
    /// @param symbol_          ERC20 symbol.
    /// @param tokenURI_        Metadata URI (e.g. ipfs://... JSON with image/description).
    /// @param totalSupply_     Fixed total supply, all of it pooled (18 decimals).
    /// @param priceWeiPerToken Starting price: HYPE wei per 1e18 token units. Sets the
    ///                         initial pool price / market cap.
    /// @param minDevBuyTokens  Slippage bound for the optional dev buy (ignored when
    ///                         msg.value == 0).
    /// @dev Send HYPE as msg.value to atomically perform the "dev buy": the creator buys
    ///      first, through the pool at the listed price, before anyone else can. Front-running
    ///      the pool creation is impossible because the token does not exist until this call.
    function createToken(
        string calldata name_,
        string calldata symbol_,
        string calldata tokenURI_,
        uint256 totalSupply_,
        uint256 priceWeiPerToken,
        uint256 minDevBuyTokens
    ) external payable nonReentrant returns (address token) {
        require(totalSupply_ > 0, "zero supply");
        require(priceWeiPerToken > 0, "zero price");

        token = address(new LaunchToken(name_, symbol_, tokenURI_, totalSupply_, address(this)));

        bool tokenIsToken0 = token < address(whype);
        (address token0, address token1) =
            tokenIsToken0 ? (token, address(whype)) : (address(whype), token);

        uint160 sqrtPriceX96 = _sqrtPriceX96(priceWeiPerToken, tokenIsToken0);

        address pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, sqrtPriceX96);
        IHyperswapV3Pool(pool).increaseObservationCardinalityNext(OBSERVATION_CARDINALITY);

        (int24 tickLower, int24 tickUpper) = _singleSidedRange(sqrtPriceX96, tokenIsToken0);

        LaunchToken(token).approve(address(positionManager), totalSupply_);
        (uint256 positionId,,,) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: tokenIsToken0 ? totalSupply_ : 0,
                amount1Desired: tokenIsToken0 ? 0 : totalSupply_,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );

        // Liquidity rounding can leave a few wei of tokens behind; burn them so the
        // launchpad never holds untracked supply.
        uint256 dust = LaunchToken(token).balanceOf(address(this));
        if (dust > 0) LaunchToken(token).transfer(DEAD, dust);

        launches[token] = Launch({
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            tokenIsToken0: tokenIsToken0,
            positionWithdrawn: false,
            pool: pool,
            positionId: positionId
        });
        allTokens.push(token);
        _creatorTokens[msg.sender].push(token);

        uint256 devBuyTokens = 0;
        if (msg.value > 0) {
            whype.deposit{value: msg.value}();
            devBuyTokens = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: address(whype),
                    tokenOut: token,
                    fee: POOL_FEE,
                    recipient: msg.sender,
                    deadline: block.timestamp,
                    amountIn: msg.value,
                    amountOutMinimum: minDevBuyTokens,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        emit TokenLaunched(
            token,
            msg.sender,
            pool,
            positionId,
            name_,
            symbol_,
            tokenURI_,
            totalSupply_,
            priceWeiPerToken,
            msg.value,
            devBuyTokens
        );
    }

    // ---------------------------------------------------------------------
    // Fee collection & claiming
    // ---------------------------------------------------------------------

    /// @notice Collects accrued swap fees from a launch's position and credits them
    ///         70/30 to creator/platform. Permissionless — anyone can poke it.
    /// @dev Token-denominated fees are swapped to WHYPE through the pool with a
    ///      TWAP-bounded minimum output. If the TWAP is unavailable (young pool) or the
    ///      bound is not met (price being manipulated), the swap is skipped and those
    ///      fees are credited in-kind instead — never lost, never sandwiched.
    function collectFees(address token) external nonReentrant returns (uint256 hypeAmount, uint256 tokenAmount) {
        Launch storage launch = launches[token];
        require(launch.creator != address(0), "unknown token");
        require(!launch.positionWithdrawn, "position withdrawn");

        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: launch.positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        (tokenAmount, hypeAmount) = launch.tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);

        if (tokenAmount > 0) {
            try this.swapTokenFeesToHype(token, tokenAmount) returns (uint256 amountOut) {
                hypeAmount += amountOut;
                tokenAmount = 0;
            } catch {}
        }

        if (hypeAmount > 0) {
            uint256 creatorCut = (hypeAmount * CREATOR_SHARE_BPS) / BPS;
            creatorFeesHype[token] += creatorCut;
            platformFeesHype += hypeAmount - creatorCut;
            lifetimeFeesHype[token] += hypeAmount;
        }
        if (tokenAmount > 0) {
            uint256 creatorCut = (tokenAmount * CREATOR_SHARE_BPS) / BPS;
            creatorFeesToken[token] += creatorCut;
            platformFeesToken[token] += tokenAmount - creatorCut;
            lifetimeFeesToken[token] += tokenAmount;
        }

        emit FeesCollected(token, hypeAmount, tokenAmount);
    }

    /// @notice Swaps collected token fees to WHYPE, bounded by the pool's TWAP.
    /// @dev Only callable by the contract itself (from `collectFees`, via try/catch so a
    ///      failed bound falls back to in-kind crediting).
    function swapTokenFeesToHype(address token, uint256 amountIn) external returns (uint256 amountOut) {
        require(msg.sender == address(this), "internal only");
        Launch storage launch = launches[token];

        uint256 minOut =
            (_twapQuote(launch.pool, launch.tokenIsToken0, amountIn) * (BPS - TWAP_SLIPPAGE_BPS)) / BPS;
        require(minOut > 0, "twap zero");

        LaunchToken(token).approve(address(swapRouter), amountIn);
        amountOut = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: address(whype),
                fee: POOL_FEE,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @notice Creator withdraws their accumulated 70% — HYPE (native) plus any in-kind tokens.
    function claimCreatorFees(address token) external nonReentrant {
        Launch storage launch = launches[token];
        require(msg.sender == launch.creator, "not creator");

        uint256 hypeAmount = creatorFeesHype[token];
        uint256 tokenAmount = creatorFeesToken[token];
        require(hypeAmount > 0 || tokenAmount > 0, "nothing to claim");
        creatorFeesHype[token] = 0;
        creatorFeesToken[token] = 0;

        if (tokenAmount > 0) LaunchToken(token).transfer(msg.sender, tokenAmount);
        if (hypeAmount > 0) _payNative(msg.sender, hypeAmount);

        emit CreatorFeesClaimed(token, msg.sender, hypeAmount, tokenAmount);
    }

    /// @notice Treasury withdraws the platform's accumulated 30% (WHYPE side, paid as native HYPE).
    function claimPlatformFees() external nonReentrant {
        require(msg.sender == treasury || msg.sender == owner, "not treasury");
        uint256 hypeAmount = platformFeesHype;
        require(hypeAmount > 0, "nothing to claim");
        platformFeesHype = 0;
        _payNative(treasury, hypeAmount);
        emit PlatformFeesClaimed(treasury, hypeAmount);
    }

    /// @notice Treasury withdraws the platform's in-kind token fees for a given launch.
    function claimPlatformTokenFees(address token) external nonReentrant {
        require(msg.sender == treasury || msg.sender == owner, "not treasury");
        uint256 tokenAmount = platformFeesToken[token];
        require(tokenAmount > 0, "nothing to claim");
        platformFeesToken[token] = 0;
        LaunchToken(token).transfer(treasury, tokenAmount);
        emit PlatformTokenFeesClaimed(token, treasury, tokenAmount);
    }

    /// @notice Transfers the creator fee stream of a token to a new address.
    /// @dev Unclaimed balances move with the role — claim first if that is not intended.
    function transferCreator(address token, address newCreator) external {
        Launch storage launch = launches[token];
        require(msg.sender == launch.creator, "not creator");
        require(newCreator != address(0), "zero address");
        launch.creator = newCreator;
        emit CreatorTransferred(token, msg.sender, newCreator);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Owner withdraws a launch's entire LP position NFT (principal + any
    ///         uncollected fees) to `recipient`.
    /// @dev WARNING — this is the rug switch. It removes the "liquidity locked" guarantee
    ///      for the token: whoever receives the NFT can burn the liquidity and take both
    ///      sides of the pool. Accrued-but-uncollected fees go with the position, so
    ///      `collectFees` is called first to settle the 70/30 split up to this moment.
    ///      After withdrawal `collectFees` is disabled for this token; already-credited
    ///      creator/platform balances remain claimable. Keep `owner` behind a
    ///      timelock/multisig and treat this as an emergency/migration tool.
    function withdrawPosition(address token, address recipient) external onlyOwner {
        require(recipient != address(0), "zero address");
        Launch storage launch = launches[token];
        require(launch.creator != address(0), "unknown token");
        require(!launch.positionWithdrawn, "position withdrawn");

        // Settle outstanding fees fairly before the position leaves.
        this.collectFees(token);

        launch.positionWithdrawn = true;
        positionManager.safeTransferFrom(address(this), recipient, launch.positionId);
        emit PositionWithdrawn(token, launch.positionId, recipient);
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "zero address");
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------------------------------------------------------------------
    // Views (frontend helpers)
    // ---------------------------------------------------------------------

    /// @notice Number of tokens ever launched.
    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    /// @notice All tokens launched by `creator` (launch-time attribution).
    function tokensByCreator(address creator) external view returns (address[] memory) {
        return _creatorTokens[creator];
    }

    /// @notice Current spot price of a launched token, in HYPE wei per 1e18 token units.
    function getPrice(address token) public view returns (uint256 priceWeiPerToken) {
        Launch storage launch = launches[token];
        require(launch.creator != address(0), "unknown token");
        (uint160 sqrtPriceX96,,,,,,) = IHyperswapV3Pool(launch.pool).slot0();
        if (launch.tokenIsToken0) {
            return FullMath.mulDiv(FullMath.mulDiv(1e18, sqrtPriceX96, Q96), sqrtPriceX96, Q96);
        }
        return FullMath.mulDiv(FullMath.mulDiv(1e18, Q96, sqrtPriceX96), Q96, sqrtPriceX96);
    }

    /// @notice Fully-diluted market cap of a launched token, in HYPE wei.
    function getMarketCap(address token) external view returns (uint256) {
        return FullMath.mulDiv(getPrice(token), LaunchToken(token).totalSupply(), 1e18);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev sqrtPriceX96 = sqrt(token1/token0) * 2^96, from a price quoted as
    ///      HYPE wei per 1e18 token units, for either token ordering.
    function _sqrtPriceX96(uint256 priceWeiPerToken, bool tokenIsToken0) internal pure returns (uint160) {
        uint256 ratioX192 = tokenIsToken0
            ? FullMath.mulDiv(priceWeiPerToken, 1 << 192, 1e18)
            : FullMath.mulDiv(1e18, 1 << 192, priceWeiPerToken);
        uint256 sqrtPrice = _sqrt(ratioX192);
        require(
            sqrtPrice > TickMath.MIN_SQRT_RATIO && sqrtPrice < TickMath.MAX_SQRT_RATIO,
            "price out of range"
        );
        return uint160(sqrtPrice);
    }

    /// @dev Range strictly on the token side of the current price, so the position is
    ///      funded with tokens only: above the price when the token is token0 (buys push
    ///      the price up into it), below when it is token1 (buys push the price down).
    function _singleSidedRange(uint160 sqrtPriceX96, bool tokenIsToken0)
        internal
        pure
        returns (int24 tickLower, int24 tickUpper)
    {
        int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        int24 floorTick = _floorToSpacing(tick);
        int24 maxTick = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;

        if (tokenIsToken0) {
            tickLower = floorTick + TICK_SPACING;
            tickUpper = maxTick;
        } else {
            tickLower = -maxTick;
            tickUpper = floorTick;
        }
        require(tickLower < tickUpper, "price too extreme");
    }

    function _floorToSpacing(int24 tick) internal pure returns (int24) {
        int24 compressed = tick / TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) compressed--;
        return compressed * TICK_SPACING;
    }

    /// @dev Expected WHYPE out for `amountIn` of the launch token at the pool's TWAP price.
    ///      Reverts if the pool cannot serve a TWAP_WINDOW-second observation yet.
    function _twapQuote(address pool, bool tokenIsToken0, uint256 amountIn) internal view returns (uint256) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = TWAP_WINDOW;
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives,) = IHyperswapV3Pool(pool).observe(secondsAgos);

        int56 delta = tickCumulatives[1] - tickCumulatives[0];
        int24 avgTick = int24(delta / int56(uint56(TWAP_WINDOW)));
        if (delta < 0 && (delta % int56(uint56(TWAP_WINDOW)) != 0)) avgTick--;

        uint160 sqrtRatioX96 = TickMath.getSqrtRatioAtTick(avgTick);
        if (tokenIsToken0) {
            // token1 out = amountIn * (sqrtRatio/2^96)^2
            return FullMath.mulDiv(FullMath.mulDiv(amountIn, sqrtRatioX96, Q96), sqrtRatioX96, Q96);
        }
        // token0 out = amountIn / (sqrtRatio/2^96)^2
        return FullMath.mulDiv(FullMath.mulDiv(amountIn, Q96, sqrtRatioX96), Q96, sqrtRatioX96);
    }

    function _payNative(address to, uint256 amount) internal {
        whype.withdraw(amount);
        (bool ok,) = to.call{value: amount}("");
        require(ok, "native transfer failed");
    }

    /// @dev Babylonian square root, rounded down.
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x >> 1) + 1;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @dev Accept the position NFT in case the position manager uses safe minting.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /// @dev Only WHYPE may send native HYPE here (during withdraw-for-claim).
    receive() external payable {
        require(msg.sender == address(whype), "direct HYPE not accepted");
    }
}
