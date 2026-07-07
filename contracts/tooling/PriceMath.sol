// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
// Standalone mirror of LoxleyFactoryV2._launchSqrtPrice, with the audited
// FullMath.mulDiv inlined, to unit-test the price derivation without v4.
library FullMath {
    function mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0; uint256 prod1;
            assembly { let mm := mulmod(a, b, not(0)) prod0 := mul(a, b) prod1 := sub(sub(mm, prod0), lt(mm, prod0)) }
            if (prod1 == 0) { require(d > 0); assembly { result := div(prod0, d) } return result; }
            require(d > prod1);
            uint256 remainder; assembly { remainder := mulmod(a, b, d) }
            assembly { prod1 := sub(prod1, gt(remainder, prod0)) prod0 := sub(prod0, remainder) }
            uint256 twos = d & (~d + 1);
            assembly { d := div(d, twos) prod0 := div(prod0, twos) twos := add(div(sub(0, twos), twos), 1) }
            prod0 |= prod1 * twos;
            uint256 inv = (3 * d) ^ 2;
            inv *= 2 - d * inv; inv *= 2 - d * inv; inv *= 2 - d * inv;
            inv *= 2 - d * inv; inv *= 2 - d * inv; inv *= 2 - d * inv;
            result = prod0 * inv;
        }
    }
}
contract PriceMath {
    uint256 public constant SUPPLY = 1_000_000_000e18;
    function launchSqrtPrice(uint256 mcapQuote, bool coinIsZero) external pure returns (uint160) {
        (uint256 a1, uint256 a0) = coinIsZero ? (mcapQuote, SUPPLY) : (SUPPLY, mcapQuote);
        return uint160(_sqrt(FullMath.mulDiv(a1, 1 << 192, a0)));
    }
    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = (x + 1) / 2; uint256 y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
        return y;
    }
}
