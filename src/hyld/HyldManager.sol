// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HyldToken} from "./HyldToken.sol";
import {
    IWHYPE,
    IHyperswapV3Pool,
    INonfungiblePositionManager
} from "../interfaces/IHyperswapV3.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {FullMath} from "../libraries/FullMath.sol";

/// @title HyldManager — seeds and holds the HYLD/WHYPE pool, routes fees to holders.
/// @notice At `seed()`, the manager creates the HYLD/WHYPE pool on HyperSwap V3 and deposits
///         100% of the HYLD supply as single-sided liquidity (no WHYPE added — buyers fill the
///         WHYPE side). The 1% pool fee accrues in BOTH tokens; `collect()` is permissionless
///         and pushes the entire collected amount to holders as dual dividends:
///           - WHYPE side -> unwrapped to native HYPE -> HyldToken.distributeHype
///           - HYLD side  -> HyldToken.distributeTokens
///         No platform cut: 100% of fees go to holders.
/// @dev TRUST NOTE — THIS LIQUIDITY IS NOT PERMANENTLY LOCKED. The owner can pull 100% of the
///      pool via `withdrawLiquidity`, which returns the underlying HYPE (funded by buyers) and
///      HYLD to a chosen address. Buyers must trust the owner not to do this. This is disclosed
///      in the project's whitepaper; it is the deliberate, honest counterpart to a locked LP,
///      not a hidden backdoor. There is no other path for assets to leave the pool.
contract HyldManager {
    uint24 public constant POOL_FEE = 10_000; // 1% tier
    int24 public constant TICK_SPACING = 200; // 1% tier spacing on HyperSwap V3
    uint16 public constant OBSERVATION_CARDINALITY = 32;

    HyldToken public immutable token;
    INonfungiblePositionManager public immutable positionManager;
    IWHYPE public immutable whype;

    address public owner;

    bool public tokenIsToken0;
    bool public seeded;
    bool public positionWithdrawn;
    address public pool;
    uint256 public positionId;

    uint256 public lifetimeFeesHype;
    uint256 public lifetimeFeesToken;

    event Seeded(address indexed pool, uint256 positionId, uint160 sqrtPriceX96);
    event FeesRouted(uint256 hypeToHolders, uint256 hyldToHolders);
    event LiquidityWithdrawn(address indexed to, uint256 hypeOut, uint256 hyldOut);
    event OwnershipTransferred(address indexed prev, address indexed next);

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

    constructor(HyldToken token_, INonfungiblePositionManager pm_, IWHYPE whype_, address owner_) {
        require(owner_ != address(0), "owner zero");
        token = token_;
        positionManager = pm_;
        whype = whype_;
        owner = owner_;
    }

    // ------------------------------------------------------------------ seed
    /// @notice Create the HYLD/WHYPE pool and deposit the manager's entire HYLD balance as
    ///         single-sided liquidity at `priceWeiPerToken` (WHYPE wei per 1e18 HYLD). One-shot.
    /// @dev The manager must already hold the full HYLD supply. Returns the pool so the caller
    ///      (deploy script) can exclude it from dividends.
    function seed(uint256 priceWeiPerToken) external onlyOwner returns (address) {
        require(!seeded, "seeded");
        uint256 supply = token.balanceOf(address(this));
        require(supply > 0, "no tokens");
        seeded = true;

        bool t0 = address(token) < address(whype);
        tokenIsToken0 = t0;
        (address token0, address token1) = t0 ? (address(token), address(whype)) : (address(whype), address(token));
        uint160 sqrtPriceX96 = _sqrtPriceX96(priceWeiPerToken, t0);

        pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, sqrtPriceX96);
        IHyperswapV3Pool(pool).increaseObservationCardinalityNext(OBSERVATION_CARDINALITY);

        (int24 tickLower, int24 tickUpper) = _singleSidedRange(sqrtPriceX96, t0);

        token.approve(address(positionManager), supply);
        (uint256 id,,,) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: t0 ? supply : 0,
                amount1Desired: t0 ? 0 : supply,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        positionId = id;
        emit Seeded(pool, id, sqrtPriceX96);
        return pool;
    }

    // ------------------------------------------------------------------ collect (permissionless)
    /// @notice Harvest the locked LP's accrued 1% fees and pay 100% to holders as dual
    ///         dividends (native HYPE + HYLD). Anyone may call it.
    function collect() external nonReentrant returns (uint256 hypeToHolders, uint256 hyldToHolders) {
        require(seeded, "not seeded");
        require(!positionWithdrawn, "withdrawn");
        return _collect();
    }

    function _collect() internal returns (uint256 hypeToHolders, uint256 hyldToHolders) {
        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        (uint256 hyldAmt, uint256 hypeAmt) = tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);

        if (hypeAmt > 0) {
            whype.withdraw(hypeAmt); // WHYPE -> native HYPE
            token.distributeHype{value: hypeAmt}();
            lifetimeFeesHype += hypeAmt;
            hypeToHolders = hypeAmt;
        }
        if (hyldAmt > 0) {
            token.distributeTokens(hyldAmt); // pulls HYLD from this manager into the reserve
            lifetimeFeesToken += hyldAmt;
            hyldToHolders = hyldAmt;
        }
        emit FeesRouted(hypeToHolders, hyldToHolders);
    }

    // ------------------------------------------------------------------ withdraw (owner)
    /// @notice OWNER WITHDRAW — removes 100% of the pool's liquidity and sends the underlying
    ///         native HYPE + HYLD to `to`. This is the disclosed, non-trustless withdraw: it
    ///         returns the HYPE that buyers put in. Outstanding fees are routed to holders first.
    function withdrawLiquidity(address to) external onlyOwner nonReentrant {
        require(to != address(0), "zero address");
        require(seeded, "not seeded");
        require(!positionWithdrawn, "withdrawn");

        _collect(); // settle accrued fees to holders before principal leaves
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
        (uint256 hyldAmt, uint256 hypeAmt) = tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);

        if (hypeAmt > 0) _payNative(to, hypeAmt);
        if (hyldAmt > 0) token.transfer(to, hyldAmt);
        emit LiquidityWithdrawn(to, hypeAmt, hyldAmt);
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "zero");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    // ------------------------------------------------------------------ internal math
    function _payNative(address to, uint256 amount) internal {
        whype.withdraw(amount);
        (bool ok,) = to.call{value: amount}("");
        require(ok, "native transfer failed");
    }

    /// @dev sqrtPriceX96 = sqrt(token1/token0) * 2^96, from a price quoted as WHYPE wei per
    ///      1e18 HYLD, for either token ordering.
    function _sqrtPriceX96(uint256 priceWeiPerToken, bool t0) internal pure returns (uint160) {
        uint256 ratioX192 = t0
            ? FullMath.mulDiv(priceWeiPerToken, 1 << 192, 1e18)
            : FullMath.mulDiv(1e18, 1 << 192, priceWeiPerToken);
        uint256 sqrtPrice = _sqrt(ratioX192);
        require(sqrtPrice > TickMath.MIN_SQRT_RATIO && sqrtPrice < TickMath.MAX_SQRT_RATIO, "price out of range");
        return uint160(sqrtPrice);
    }

    /// @dev Range strictly on the HYLD side of the current price (single-sided): above the
    ///      price when HYLD is token0 (buys push price up into it), below when token1.
    function _singleSidedRange(uint160 sqrtPriceX96, bool t0)
        internal
        pure
        returns (int24 tickLower, int24 tickUpper)
    {
        int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        int24 floorTick = _floorToSpacing(tick);
        int24 maxTick = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;

        if (t0) {
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
