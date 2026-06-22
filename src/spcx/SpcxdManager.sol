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

/// @title SpcxdManager — turns the 1% pool fee into SPCXD rewards, delivered on HyperCore.
/// @notice There is NO WHYPE/USDC pool on HyperEVM, so USDC is sourced on HyperCore instead of an
///         EVM swap. Pipeline (each step its own call; the HyperCore parts are ASYNC and retryable):
///   1. harvest()              collect fee -> all to WHYPE -> unwrap to HYPE -> bridge HYPE->Core
///   2. sellHypeForUsdc(px,sz)  sell HYPE -> USDC on the Core book (HYPE/USDC, 24/7)
///   3. buySpcxd(px,sz)         buy SPCXD with the USDC on the Core book (SPCXD/USDC, market hours)
///   4. deliverToToken()        spot-send SPCXD to the token's Core account + book it to holders
/// @dev TRUST NOTE — THE LIQUIDITY IS NOT PERMANENTLY LOCKED. The owner can pull 100% of the
///      pool via `withdrawLiquidity`, returning the underlying HYPE (funded by buyers) and the
///      launch token to a chosen address. This is the disclosed, honest counterpart to a locked
///      LP, not a hidden backdoor — it lives in the verified source and is the ONLY path for
///      principal to leave the pool. Collected fees can still only become SPCXD rewards; the
///      owner cannot divert USDC/SPCXD/HYPE rewards, only withdraw the LP principal.
contract SpcxdManager {
    uint24 public constant POOL_FEE = 10_000; // 1%
    int24 public constant TICK_SPACING = 200;
    uint16 public constant OBS_CARD = 32;

    uint64 public constant HYPE_CORE = 150; // HYPE core token id
    uint64 public constant USDC_CORE = 0;
    uint64 public constant SPCXD_CORE = 610;
    uint32 public constant HYPE_USDC_ASSET = 10107; // HYPE/USDC spot order asset
    uint32 public constant SPCXD_ASSET = 10465; // SPCXD/USDC spot order asset

    SpcxdToken public immutable token;
    INonfungiblePositionManager public immutable positionManager;
    ISwapRouter public immutable swapRouter;
    IWHYPE public immutable whype;

    address public owner;
    bool public tokenIsToken0;
    bool public seeded;
    bool public positionWithdrawn;
    address public pool;
    uint256 public positionId;

    uint256 public lifetimeHypeBridged;
    uint64 public lifetimeSpcxdDelivered;

    event Seeded(address pool, uint256 positionId);
    event Harvested(uint256 hypeBridged);
    event SellPlaced(uint64 px1e8, uint64 sz1e8);
    event BuyPlaced(uint64 px1e8, uint64 sz1e8);
    event Delivered(uint64 spcxdCoreAmount);
    event LiquidityWithdrawn(address indexed to, uint256 hypeOut, uint256 tokenOut);

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
        address owner_
    ) {
        require(owner_ != address(0), "owner zero");
        token = token_;
        positionManager = pm_;
        swapRouter = router_;
        whype = whype_;
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

    // ------------------------------------------------------------ step 1: harvest -> HYPE -> Core
    /// @notice Collect the 1% fee, convert it all to HYPE, and bridge it to this contract's Core
    ///         account. Permissionless.
    function harvest() external nonReentrant returns (uint256 hypeBridged) {
        require(seeded, "not seeded");
        require(!positionWithdrawn, "withdrawn");
        hypeBridged = _harvestFees();
    }

    /// @dev Collect the position's accrued fees, convert all of it to native HYPE, and bridge to
    ///      this contract's Core account. Shared by harvest() and withdrawLiquidity().
    function _harvestFees() internal returns (uint256 hypeBridged) {
        (uint256 a0, uint256 a1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        (uint256 tokAmt,) = tokenIsToken0 ? (a0, a1) : (a1, a0);

        // launch-token fees -> WHYPE through the launch pool
        if (tokAmt > 0) {
            IERC20Full(address(token)).approve(address(swapRouter), tokAmt);
            _swap(address(token), address(whype), POOL_FEE, tokAmt);
        }
        // unwrap all WHYPE held -> native HYPE, then bridge native HYPE -> Core
        uint256 wbal = whype.balanceOf(address(this));
        if (wbal > 0) whype.withdraw(wbal);
        uint256 nativeBal = address(this).balance;
        if (nativeBal > 0) {
            HyperCore.bridgeHypeToCore(nativeBal);
            lifetimeHypeBridged += nativeBal;
            hypeBridged = nativeBal;
        }
        emit Harvested(hypeBridged);
    }

    // ------------------------------------------------------------ owner withdraw (disclosed)
    /// @notice OWNER WITHDRAW — removes 100% of the pool's liquidity and sends the underlying
    ///         native HYPE + launch token to `to`. This is the disclosed, non-trustless withdraw
    ///         (HYLD/Hyprpad-style): it returns the HYPE buyers put in. Accrued fees are routed to
    ///         holders as SPCXD first, so withdrawing principal never steals pending rewards.
    function withdrawLiquidity(address to) external onlyOwner nonReentrant {
        require(to != address(0), "zero address");
        require(seeded, "not seeded");
        require(!positionWithdrawn, "withdrawn");

        _harvestFees(); // settle accrued fees into the reward pipeline before principal leaves
        positionWithdrawn = true;

        (,,,,,,, uint128 liquidity,,,,) = positionManager.positions(positionId);
        if (liquidity > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: positionId,
                    liquidity: liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            );
        }
        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        (uint256 tokenAmt, uint256 hypeAmt) = tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);

        if (hypeAmt > 0) {
            whype.withdraw(hypeAmt);
            (bool ok,) = to.call{value: hypeAmt}("");
            require(ok, "native transfer failed");
        }
        if (tokenAmt > 0) IERC20Full(address(token)).transfer(to, tokenAmt);
        emit LiquidityWithdrawn(to, hypeAmt, tokenAmt);
    }

    // ------------------------------------------------------------ step 2: HYPE -> USDC on Core
    /// @notice Sell the bridged HYPE for USDC on the Core order book (HYPE trades 24/7).
    function sellHypeForUsdc(uint64 px1e8, uint64 sz1e8) external onlyOwner {
        require(HyperCore.spotBalance(address(this), HYPE_CORE) > 0, "no hype on core");
        HyperCore.limitOrder(HYPE_USDC_ASSET, false, px1e8, sz1e8); // isBuy=false: sell HYPE
        emit SellPlaced(px1e8, sz1e8);
    }

    // ------------------------------------------------------------ step 3: USDC -> SPCXD on Core
    /// @notice Buy SPCXD with the USDC. dStock market hours apply; off-hours this won't fill.
    function buySpcxd(uint64 px1e8, uint64 sz1e8) external onlyOwner {
        require(HyperCore.spotBalance(address(this), USDC_CORE) > 0, "no usdc on core");
        HyperCore.limitOrder(SPCXD_ASSET, true, px1e8, sz1e8); // isBuy=true: buy SPCXD
        emit BuyPlaced(px1e8, sz1e8);
    }

    // ------------------------------------------------------------ step 4: deliver + book
    function deliverToToken() external nonReentrant returns (uint64 amount) {
        amount = HyperCore.spotBalance(address(this), SPCXD_CORE);
        require(amount > 0, "no spcxd on core");
        HyperCore.spotSend(address(token), SPCXD_CORE, amount);
        token.notifyReward(amount);
        lifetimeSpcxdDelivered += amount;
        emit Delivered(amount);
    }

    // ------------------------------------------------------------ views
    function coreHype() external view returns (uint64) {
        return HyperCore.spotBalance(address(this), HYPE_CORE);
    }

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
