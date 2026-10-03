// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Minimal Uniswap V3 pool stand-in for oracle tests: fixed token order,
///      a settable spot tick and a settable TWAP tick (observe() returns
///      cumulatives consistent with that average over any window).
contract MockV3Pool {
    address public token0;
    address public token1;
    int24 public spotTick;
    int24 public twapTick;
    bool public tooOld;

    constructor(address t0, address t1) {
        token0 = t0;
        token1 = t1;
    }

    function set(int24 spot, int24 twap) external {
        spotTick = spot;
        twapTick = twap;
    }

    function setTooOld(bool v) external {
        tooOld = v;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (0, spotTick, 0, 0, 0, 0, true);
    }

    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory cum, uint160[] memory liq) {
        require(!tooOld, "OLD");
        cum = new int56[](secondsAgos.length);
        liq = new uint160[](secondsAgos.length);
        // cumulative at time T = twapTick * T; choose "now" = 1e6 seconds
        for (uint256 i; i < secondsAgos.length; ++i) {
            cum[i] = int56(twapTick) * int56(uint56(1_000_000 - secondsAgos[i]));
        }
    }
}
