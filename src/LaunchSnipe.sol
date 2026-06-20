// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* ------------------------------------------------------------------ *
 *  Minimal Uniswap-V3 (fork) interfaces — Robinhood L2, chainId 4663  *
 * ------------------------------------------------------------------ */

interface IERC20 {
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IWETH9 is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title LaunchSnipe — atomic "block 0" launch + dev-buy
/// @notice Creates a Uniswap-V3 WETH pool, seeds liquidity, and executes one or
///         more dev-buys ALL IN A SINGLE TRANSACTION. Because the buys run in the
///         same tx (and therefore the same block) as the liquidity add, they are
///         guaranteed to be the first trades — true block-0 sniping with no
///         dependence on a mempool (which this chain doesn't expose anyway).
///
/// @dev Usage:
///   1. Deploy with the chain's factory / NPM / router / WETH addresses.
///   2. Owner approves this contract to pull `liqTokenAmount` of the token, and
///      either sends ETH as msg.value or pre-funds the contract with ETH.
///   3. Owner calls launchAndSnipe(...). The LP NFT goes to the owner; bought
///      tokens go to each buyer address.
contract LaunchSnipe {
    address public owner;
    IUniswapV3Factory public immutable factory;
    INonfungiblePositionManager public immutable npm;
    ISwapRouter02 public immutable router;
    IWETH9 public immutable weth;

    error NotOwner();
    error LengthMismatch();
    error InsufficientEth();
    error SlippageTooHigh();

    event Launched(address indexed token, address pool, uint256 lpTokenId, uint256 totalBought);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    struct LaunchParams {
        address token;
        uint24 fee;
        uint160 sqrtPriceX96; // initial price; 0 = pool already initialised
        int24 tickLower;
        int24 tickUpper;
        uint256 liqTokenAmount; // token side of liquidity
        uint256 liqWethAmount; // WETH side of liquidity
        address[] buyers; // dev-buy recipients (block 0)
        uint256[] buyWethAmounts; // WETH spent per buyer
        uint256 minTokenOutTotal; // revert if total bought < this
    }

    constructor(address _factory, address _npm, address _router, address _weth) {
        owner = msg.sender;
        factory = IUniswapV3Factory(_factory);
        npm = INonfungiblePositionManager(_npm);
        router = ISwapRouter02(_router);
        weth = IWETH9(_weth);
    }

    /// @notice Atomically create+seed the pool and run the dev-buys (block 0).
    function launchAndSnipe(LaunchParams calldata p)
        external
        payable
        onlyOwner
        returns (uint256 lpTokenId, uint256 totalBought)
    {
        if (p.buyers.length != p.buyWethAmounts.length) revert LengthMismatch();

        uint256 totalBuyWeth;
        for (uint256 i; i < p.buyWethAmounts.length; ++i) {
            totalBuyWeth += p.buyWethAmounts[i];
        }
        uint256 needWeth = p.liqWethAmount + totalBuyWeth;
        if (address(this).balance < needWeth) revert InsufficientEth();

        // 1. Wrap exactly what we need.
        weth.deposit{value: needWeth}();

        // 2. Pull the LP token side from the owner.
        IERC20(p.token).transferFrom(owner, address(this), p.liqTokenAmount);

        // 3. Create + initialise the pool if needed.
        address pool = factory.getPool(p.token, address(weth), p.fee);
        if (pool == address(0)) {
            pool = factory.createPool(p.token, address(weth), p.fee);
        }
        if (p.sqrtPriceX96 != 0) {
            (uint160 existing,,,,,,) = IUniswapV3Pool(pool).slot0();
            if (existing == 0) {
                IUniswapV3Pool(pool).initialize(p.sqrtPriceX96);
            }
        }

        // 4. Seed liquidity (LP NFT to owner). Sort tokens for V3 ordering.
        lpTokenId = _mintLiquidity(p);

        // 5. Dev-buys, same tx => same block => first trades.
        if (totalBuyWeth > 0) {
            weth.approve(address(router), totalBuyWeth);
            for (uint256 i; i < p.buyers.length; ++i) {
                if (p.buyWethAmounts[i] == 0) continue;
                totalBought += router.exactInputSingle(
                    ISwapRouter02.ExactInputSingleParams({
                        tokenIn: address(weth),
                        tokenOut: p.token,
                        fee: p.fee,
                        recipient: p.buyers[i],
                        amountIn: p.buyWethAmounts[i],
                        amountOutMinimum: 0,
                        sqrtPriceLimitX96: 0
                    })
                );
            }
            if (totalBought < p.minTokenOutTotal) revert SlippageTooHigh();
        }

        // 6. Sweep any dust back to the owner.
        _sweep(p.token);

        emit Launched(p.token, pool, lpTokenId, totalBought);
    }

    function _mintLiquidity(LaunchParams calldata p) internal returns (uint256 lpTokenId) {
        IERC20(p.token).approve(address(npm), p.liqTokenAmount);
        weth.approve(address(npm), p.liqWethAmount);

        (address token0, address token1) =
            p.token < address(weth) ? (p.token, address(weth)) : (address(weth), p.token);
        (uint256 amt0, uint256 amt1) =
            p.token < address(weth) ? (p.liqTokenAmount, p.liqWethAmount) : (p.liqWethAmount, p.liqTokenAmount);

        (lpTokenId,,,) = npm.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: p.fee,
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                amount0Desired: amt0,
                amount1Desired: amt1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: owner,
                deadline: block.timestamp
            })
        );
    }

    function _sweep(address token) internal {
        uint256 w = weth.balanceOf(address(this));
        if (w > 0) {
            weth.withdraw(w);
        }
        uint256 t = IERC20(token).balanceOf(address(this));
        if (t > 0) {
            IERC20(token).transfer(owner, t);
        }
        if (address(this).balance > 0) {
            (bool ok,) = owner.call{value: address(this).balance}("");
            require(ok, "refund failed");
        }
    }

    /// @notice Rescue stuck ETH/tokens.
    function rescue(address token) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = owner.call{value: address(this).balance}("");
            require(ok, "rescue failed");
        } else {
            IERC20(token).transfer(owner, IERC20(token).balanceOf(address(this)));
        }
    }

    receive() external payable {}
}
