// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {INonfungiblePositionManager, IHyperswapV3Pool, IWHYPE} from "../src/interfaces/IHyperswapV3.sol";
import {TickMath} from "../src/libraries/TickMath.sol";
import {FullMath} from "../src/libraries/FullMath.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice Seeds a single-sided HYPEX/WHYPE 1% pool with the deployer's full token balance, at
///         `PRICE_WEI` WHYPE-wei per token. The position NFT is held by the deployer (no manager,
///         no lock). Reads TOKEN and PRICE_WEI from env. PRIVATE_KEY = the holder of the supply.
contract SeedPlain is Script {
    address constant NFPM = 0x6eDA206207c09e5428F281761DdC0D300851fBC8;
    address constant WHYPE = 0x5555555555555555555555555555555555555555;
    uint24 constant POOL_FEE = 10_000;
    int24 constant TICK_SPACING = 200;
    uint16 constant OBS_CARD = 32;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("TOKEN");
        uint256 priceWei = vm.envUint("PRICE_WEI");
        address me = vm.addr(pk);

        uint256 supply = IERC20Min(token).balanceOf(me);
        require(supply > 0, "no tokens");

        bool t0 = token < WHYPE;
        (address token0, address token1) = t0 ? (token, WHYPE) : (WHYPE, token);
        uint160 sp = _sqrtPriceX96(priceWei, t0);

        vm.startBroadcast(pk);
        address pool =
            INonfungiblePositionManager(NFPM).createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, sp);
        IHyperswapV3Pool(pool).increaseObservationCardinalityNext(OBS_CARD);
        (int24 tl, int24 tu) = _singleSidedRange(sp, t0);
        IERC20Min(token).approve(NFPM, supply);
        (uint256 id,,,) = INonfungiblePositionManager(NFPM).mint(
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
                recipient: me,
                deadline: block.timestamp + 3600
            })
        );
        vm.stopBroadcast();
        console.log("pool       :", pool);
        console.log("positionId :", id);
        console.log("LP held by :", me);
    }

    function _sqrtPriceX96(uint256 p, bool t0) internal pure returns (uint160) {
        uint256 ratioX192 = t0 ? FullMath.mulDiv(p, 1 << 192, 1e18) : FullMath.mulDiv(1e18, 1 << 192, p);
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
}
