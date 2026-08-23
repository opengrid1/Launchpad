// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IUniswapV3FactoryCore, IUniswapV3PoolCore} from "../stable/IUniswapV3Core.sol";

interface IWHYPE {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @title HyperSwapRouter
/// @notice Native-HYPE buy/sell entry for launchpad pools on HyperSwap V3.
///         Buys are paid in native HYPE (msg.value), wrapped to WHYPE and
///         swapped into the coin; sells swap the coin back to WHYPE and unwrap
///         to native HYPE. WHYPE is the canonical 18-decimal wrapped native, so
///         (unlike the Arc USDC-mirror router) there is no decimal rescaling.
///         Trades go straight through the coin's HyperSwap V3 pool; the pool's
///         1% fee tier is the only trading cost.
contract HyperSwapRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NotPool();
    error ZeroAmount();
    error SlippageExceeded();
    error PoolMissing();
    error NativeTransferFailed();

    uint24 public constant POOL_FEE_TIER = 10_000;
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    IUniswapV3FactoryCore public immutable uniswapFactory;
    /// @notice Canonical wrapped native (WHYPE).
    address public immutable weth;

    address private _expectedPool;

    event Bought(address indexed token, address indexed buyer, uint256 nativeIn, uint256 tokensOut);
    event Sold(address indexed token, address indexed seller, uint256 tokensIn, uint256 nativeOut);

    constructor(IUniswapV3FactoryCore uniswapFactory_, address weth_) {
        uniswapFactory = uniswapFactory_;
        weth = weth_;
    }

    /// @notice Buy `token` with native HYPE. `minOut` is in token wei (18d).
    function buy(address token, uint256 minOut) external payable nonReentrant returns (uint256 out) {
        if (msg.value == 0) revert ZeroAmount();
        IWHYPE(weth).deposit{value: msg.value}();

        IUniswapV3PoolCore pool = _pool(token);
        bool zeroForOne = weth < token; // WHYPE in -> token out
        _expectedPool = address(pool);
        (int256 a0, int256 a1) = pool.swap(
            msg.sender,
            zeroForOne,
            int256(msg.value),
            zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            ""
        );
        _expectedPool = address(0);

        out = uint256(-(zeroForOne ? a1 : a0));
        if (out < minOut) revert SlippageExceeded();
        emit Bought(token, msg.sender, msg.value, out);
    }

    /// @notice Sell `amountIn` of `token` (18d) for native HYPE. `minOut` is in
    ///         native wei (18d). Requires prior token approval.
    function sell(address token, uint256 amountIn, uint256 minOut) external nonReentrant returns (uint256 out) {
        if (amountIn == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountIn);

        IUniswapV3PoolCore pool = _pool(token);
        bool zeroForOne = token < weth; // token in -> WHYPE out
        _expectedPool = address(pool);
        (int256 a0, int256 a1) = pool.swap(
            address(this),
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            ""
        );
        _expectedPool = address(0);

        out = uint256(-(zeroForOne ? a1 : a0));
        if (out < minOut) revert SlippageExceeded();
        IWHYPE(weth).withdraw(out);
        (bool ok,) = msg.sender.call{value: out}("");
        if (!ok) revert NativeTransferFailed();
        emit Sold(token, msg.sender, amountIn, out);
    }

    /// @notice Pool swap callback: pay what the pool is owed. The WHYPE side is
    ///         paid from this contract's wrapped balance; the token side from
    ///         tokens pulled before the swap.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != _expectedPool) revert NotPool();
        if (amount0Delta > 0) {
            IERC20(IUniswapV3PoolCore(msg.sender).token0()).safeTransfer(msg.sender, uint256(amount0Delta));
        }
        if (amount1Delta > 0) {
            IERC20(IUniswapV3PoolCore(msg.sender).token1()).safeTransfer(msg.sender, uint256(amount1Delta));
        }
    }

    function _pool(address token) internal view returns (IUniswapV3PoolCore) {
        address pool = uniswapFactory.getPool(token, weth, POOL_FEE_TIER);
        if (pool == address(0)) revert PoolMissing();
        return IUniswapV3PoolCore(pool);
    }

    /// @dev Receives native from WHYPE.withdraw during sells.
    receive() external payable {}
}
