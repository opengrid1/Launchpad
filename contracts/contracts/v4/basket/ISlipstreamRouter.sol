// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Aerodrome Slipstream SwapRouter surface (a Uniswap V3 periphery
///         fork). The exact-input path packs `token, int24 tickSpacing, token,
///         ...`, so it starts and ends with a 20-byte token address. This is
///         where the Base tokenized stocks hold their USDC liquidity.
interface ISlipstreamRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Path checks shared by the contracts that let a keeper pick a route:
///         the keeper chooses the hops, never the input or output token.
library SwapPath {
    error BadPath();

    function requireEndpoints(bytes calldata path, address tokenIn, address tokenOut) internal pure {
        // token (20) + [tickSpacing (3) + token (20)] * hops
        if (path.length < 43 || (path.length - 20) % 23 != 0) revert BadPath();
        address first = address(bytes20(path[:20]));
        address last = address(bytes20(path[path.length - 20:]));
        if (first != tokenIn || last != tokenOut) revert BadPath();
    }
}
