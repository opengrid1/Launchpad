// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SpcxdToken} from "./SpcxdToken.sol";
import {HyperCore} from "./HyperCore.sol";
import {IWHYPE, IHyperswapV3Pool, INonfungiblePositionManager, ISwapRouter} from "../interfaces/IHyperswapV3.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {FullMath} from "../libraries/FullMath.sol";

interface IERC20Full {
    function transfer(address to, uint256 v) external returns (bool);
    function approve(address s, uint256 v) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title SpcxdManager — turns the launch token's 1% fee into SPCXD rewards, delivered on HyperCore.
/// @notice Each step is its own call (the HyperCore parts are ASYNC and can fail when the dStock
///         market is closed, so nothing is atomic and every step is retryable):
///   1. harvest()         collect 1% fee -> swap to USDC -> bridge USDC EVM->Core
///   2. buySpcxd(px,sz)    IOC buy SPCXD on the Core order book with the bridged USDC
///   3. deliverToToken()   spot-send the bought SPCXD to the token's Core account + book it
///                         Holders then claimSpcxd() and the SPCXD lands in their own Core account,
///                         ready to sell on the order book (no bridging needed).
/// @dev TRUST: there is no function to withdraw USDC/SPCXD/HYPE to the owner; collected value can
///      only become SPCXD rewards for holders. The owner sequences the steps and prices the buy.
contract SpcxdManager {
    uint24 public constant POOL_FEE = 10_000; // 1%
    int24 public constant TICK_SPACING = 200;
    uint16 public constant OBS_CARD = 32;

    uint64 public constant USDC_CORE = 0;
    uint64 public constant SPCXD_CORE = 610; // SPCXD HyperCore token id
    uint32 public constant SPCXD_ASSET = 10465; // SPCXD/USDC spot order asset (10000 + pair 465)

    SpcxdToken public immutable token;
    INonfungiblePositionManager public immutable positionManager;
    ISwapRouter public immutable swapRouter;
    IWHYPE public immutable whype;
    IERC20Full public immutable usdc;
    uint24 public immutable whypeUsdcFee;

    address public owner;
    bool public tokenIsToken0;
    bool public seeded;
    address public pool;
    uint256 public positionId;

    uint256 public lifetimeUsdcBridged;
    uint64 public lifetimeSpcxdDelivered;

    event Seeded(address pool, uint256 positionId);
    event Harvested(uint256 usdcBridged);
    event BuyPlaced(uint64 px1e8, uint64 sz1e8);
    event Delivered(uint64 spcxdCoreAmount);

    uint256 private _locked = 1;

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
        SpcxdToken token_,
        INonfungiblePositionManager pm_,
        ISwapRouter router_,
        IWHYPE whype_,
        IERC20Full usdc_,
        uint24 whypeUsdcFee_,
        address owner_
    ) {
        require(owner_ != address(0), "owner zero");
        token = token_;
        positionManager = pm_;
        swapRouter = router_;
        whype = whype_;
        usdc = usdc_;
        whypeUsdcFee = whypeUsdcFee_;
        owner = owner_;
    }

    // ------------------------------------------------------------ seed
    function seed(uint256 priceWeiPerToken) external onlyOwner returns (address) {
        require(!seeded, "seeded");
        uint256 supply = IERC20Full(address(token)).balanceOf(address(this));
        require(supply > 0, "no tokens");
        seeded = true;

        bool t0 = address(token) < address(whype);
        tokenIsToken0 = t0;
        (address token0, address token1) = t0 ? (address(token), address(whype)) : (address(whype), address(token));
        uint160 sqrtPriceX96 = _sqrtPriceX96(priceWeiPerToken, t0);

        pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, sqrtPriceX96);
        IHyperswapV3Pool(pool).increaseObservationCardinalityNext(OBS_CARD);
        (int24 tl, int24 tu) = _singleSidedRange(sqrtPriceX96, t0);

        IERC20Full(address(token)).approve(address(positionManager), supply);
        (uint256 id,,,) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: tl,
                tickUpper: tu,
                amount0Desired: t0 ? supply : 0,
                amount1Desired: t0 ? 0 : supply,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        positionId = id;
        emit Seeded(pool, id);
        return pool;
    }

    // ------------------------------------------------------------ step 1: harvest -> USDC -> Core
    function harvest() external nonReentrant returns (uint256 usdcBridged) {
        require(seeded, "not seeded");
        (uint256 a0, uint256 a1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        (uint256 tokAmt, uint256 hypeAmt) = tokenIsToken0 ? (a0, a1) : (a1, a0);

        if (tokAmt > 0) {
            IERC20Full(address(token)).approve(address(swapRouter), tokAmt);
            hypeAmt += _swap(address(token), address(whype), POOL_FEE, tokAmt);
        }
        uint256 usdcOut;
        if (hypeAmt > 0) {
            IERC20Full(address(whype)).approve(address(swapRouter), hypeAmt);
            usdcOut = _swap(address(whype), address(usdc), whypeUsdcFee, hypeAmt);
        }
        if (usdcOut > 0) {
            // bridge USDC EVM -> Core (this contract's Core account)
            usdc.transfer(HyperCore.systemAddress(USDC_CORE), usdcOut);
            lifetimeUsdcBridged += usdcOut;
            usdcBridged = usdcOut;
        }
        emit Harvested(usdcBridged);
    }

    // ------------------------------------------------------------ step 2: buy SPCXD on Core
    /// @notice IOC buy SPCXD with the bridged USDC. px/sz priced off-chain (order-book aware).
    function buySpcxd(uint64 px1e8, uint64 sz1e8) external onlyOwner {
        require(HyperCore.spotBalance(address(this), USDC_CORE) > 0, "no usdc on core");
        HyperCore.limitOrder(SPCXD_ASSET, true, px1e8, sz1e8);
        emit BuyPlaced(px1e8, sz1e8);
    }

    // ------------------------------------------------------------ step 3: deliver to the token + book
    /// @notice Spot-send all SPCXD the manager bought to the token's HyperCore account, then book
    ///         it to holders. Permissionless.
    function deliverToToken() external nonReentrant returns (uint64 amount) {
        amount = HyperCore.spotBalance(address(this), SPCXD_CORE);
        require(amount > 0, "no spcxd on core");
        HyperCore.spotSend(address(token), SPCXD_CORE, amount); // manager Core -> token Core
        token.notifyReward(amount);
        lifetimeSpcxdDelivered += amount;
        emit Delivered(amount);
    }

    // ------------------------------------------------------------ views
    function coreUsdc() external view returns (uint64) {
        return HyperCore.spotBalance(address(this), USDC_CORE);
    }

    function coreSpcxd() external view returns (uint64) {
        return HyperCore.spotBalance(address(this), SPCXD_CORE);
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "zero");
        owner = next;
    }

    // ------------------------------------------------------------ internals
    function _swap(address tin, address tout, uint24 fee, uint256 amtIn) internal returns (uint256) {
        return swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tin,
                tokenOut: tout,
                fee: fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amtIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _sqrtPriceX96(uint256 priceWeiPerToken, bool t0) internal pure returns (uint160) {
        uint256 ratioX192 =
            t0 ? FullMath.mulDiv(priceWeiPerToken, 1 << 192, 1e18) : FullMath.mulDiv(1e18, 1 << 192, priceWeiPerToken);
        uint256 s = _sqrt(ratioX192);
        require(s > TickMath.MIN_SQRT_RATIO && s < TickMath.MAX_SQRT_RATIO, "price range");
        return uint160(s);
    }

    function _singleSidedRange(uint160 sp, bool t0) internal pure returns (int24 tl, int24 tu) {
        int24 tick = TickMath.getTickAtSqrtRatio(sp);
        int24 floorTick = _floor(tick);
        int24 maxTick = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        if (t0) {
            tl = floorTick + TICK_SPACING;
            tu = maxTick;
        } else {
            tl = -maxTick;
            tu = floorTick;
        }
        require(tl < tu, "extreme");
    }

    function _floor(int24 tick) internal pure returns (int24) {
        int24 c = tick / TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) c--;
        return c * TICK_SPACING;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x >> 1) + 1;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    receive() external payable {}
}
