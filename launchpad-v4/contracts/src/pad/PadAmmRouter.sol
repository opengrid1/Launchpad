// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PadAmmFactory} from "./PadAmmFactory.sol";
import {PadAmmPair} from "./PadAmmPair.sol";

interface IWNative {
    function deposit() external payable;
    function withdraw(uint256) external;
    function transfer(address to, uint256 value) external returns (bool);
}

/**
 * @title PadAmmRouter
 * @notice The user-facing side of the AMM: add and remove liquidity (with the native coin wrapped on the way in and
 * unwrapped on the way out), exact-input swaps along a path of pairs, and the quotes the site shows. Every amount
 * out is sized with the factory's total fee, so the pair's invariant check passes exactly.
 */
contract PadAmmRouter {
    using SafeERC20 for IERC20;

    error Expired();
    error InsufficientAAmount();
    error InsufficientBAmount();
    error InsufficientOutput();
    error InvalidPath();
    error ZeroAmount();
    error InsufficientLiquidity();
    error NotWNative();
    error TransferFailed();

    uint256 private constant BPS = 10_000;
    PadAmmFactory public immutable factory;
    address public immutable WNATIVE;

    constructor(PadAmmFactory factory_, address wnative) {
        factory = factory_;
        WNATIVE = wnative;
    }

    receive() external payable {
        if (msg.sender != WNATIVE) revert NotWNative();
    }

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    // ---- quotes -----------------------------------------------------------------------------------------------------

    function totalFeeBps() public view returns (uint256) {
        return uint256(factory.lpFeeBps()) + factory.protocolFeeBps();
    }

    /// @notice The amount of the other token that keeps the pool's ratio.
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) public pure returns (uint256) {
        if (amountA == 0) revert ZeroAmount();
        if (reserveA == 0 || reserveB == 0) revert InsufficientLiquidity();
        return (amountA * reserveB) / reserveA;
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public view returns (uint256) {
        if (amountIn == 0) revert ZeroAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 inWithFee = amountIn * (BPS - totalFeeBps());
        return (inWithFee * reserveOut) / (reserveIn * BPS + inWithFee);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) public view returns (uint256) {
        if (amountOut == 0) revert ZeroAmount();
        if (reserveIn == 0 || reserveOut == 0 || amountOut >= reserveOut) revert InsufficientLiquidity();
        return (reserveIn * amountOut * BPS) / ((reserveOut - amountOut) * (BPS - totalFeeBps())) + 1;
    }

    function getReserves(address tokenA, address tokenB) public view returns (uint256 reserveA, uint256 reserveB) {
        address pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) return (0, 0);
        (uint112 r0, uint112 r1,) = PadAmmPair(pair).getReserves();
        (reserveA, reserveB) = tokenA < tokenB ? (r0, r1) : (r1, r0);
    }

    function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts) {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 rIn, uint256 rOut) = getReserves(path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], rIn, rOut);
        }
    }

    // ---- liquidity --------------------------------------------------------------------------------------------------

    function _addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin)
        private
        returns (uint256 amountA, uint256 amountB, address pair)
    {
        pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) pair = factory.createPair(tokenA, tokenB);
        (uint256 reserveA, uint256 reserveB) = getReserves(tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                if (amountBOptimal < amountBMin) revert InsufficientBAmount();
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = quote(amountBDesired, reserveB, reserveA);
                if (amountAOptimal > amountADesired || amountAOptimal < amountAMin) revert InsufficientAAmount();
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline)
        external
        ensure(deadline)
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        address pair;
        (amountA, amountB, pair) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        IERC20(tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, pair, amountB);
        liquidity = PadAmmPair(pair).mint(to);
    }

    /// @notice Adds `token` plus the native coin sent with the call; what the ratio does not need is refunded.
    function addLiquidityNative(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountNativeMin, address to, uint256 deadline)
        external
        payable
        ensure(deadline)
        returns (uint256 amountToken, uint256 amountNative, uint256 liquidity)
    {
        address pair;
        (amountToken, amountNative, pair) = _addLiquidity(token, WNATIVE, amountTokenDesired, msg.value, amountTokenMin, amountNativeMin);
        IERC20(token).safeTransferFrom(msg.sender, pair, amountToken);
        IWNative(WNATIVE).deposit{value: amountNative}();
        if (!IWNative(WNATIVE).transfer(pair, amountNative)) revert TransferFailed();
        liquidity = PadAmmPair(pair).mint(to);
        if (msg.value > amountNative) _sendNative(msg.sender, msg.value - amountNative);
    }

    function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline)
        public
        ensure(deadline)
        returns (uint256 amountA, uint256 amountB)
    {
        address pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) revert InvalidPath();
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = PadAmmPair(pair).burn(to);
        (amountA, amountB) = tokenA < tokenB ? (amount0, amount1) : (amount1, amount0);
        if (amountA < amountAMin) revert InsufficientAAmount();
        if (amountB < amountBMin) revert InsufficientBAmount();
    }

    function removeLiquidityNative(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountNativeMin, address to, uint256 deadline)
        external
        ensure(deadline)
        returns (uint256 amountToken, uint256 amountNative)
    {
        (amountToken, amountNative) = removeLiquidity(token, WNATIVE, liquidity, amountTokenMin, amountNativeMin, address(this), deadline);
        IERC20(token).safeTransfer(to, amountToken);
        IWNative(WNATIVE).withdraw(amountNative);
        _sendNative(to, amountNative);
    }

    // ---- swaps ------------------------------------------------------------------------------------------------------

    /// @dev Requires the first amount to already sit in the first pair; pays each hop forward, the last one to `to`.
    function _swap(uint256[] memory amounts, address[] memory path, address to) private {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (uint256 amount0Out, uint256 amount1Out) = input < output ? (uint256(0), amounts[i + 1]) : (amounts[i + 1], uint256(0));
            address next = i < path.length - 2 ? factory.getPair(output, path[i + 2]) : to;
            PadAmmPair(factory.getPair(input, output)).swap(amount0Out, amount1Out, next);
        }
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        amounts = getAmountsOut(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();
        IERC20(path[0]).safeTransferFrom(msg.sender, factory.getPair(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactNativeForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        if (path[0] != WNATIVE) revert InvalidPath();
        amounts = getAmountsOut(msg.value, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();
        IWNative(WNATIVE).deposit{value: amounts[0]}();
        if (!IWNative(WNATIVE).transfer(factory.getPair(path[0], path[1]), amounts[0])) revert TransferFailed();
        _swap(amounts, path, to);
    }

    function swapExactTokensForNative(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        if (path[path.length - 1] != WNATIVE) revert InvalidPath();
        amounts = getAmountsOut(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();
        IERC20(path[0]).safeTransferFrom(msg.sender, factory.getPair(path[0], path[1]), amounts[0]);
        _swap(amounts, path, address(this));
        IWNative(WNATIVE).withdraw(amounts[amounts.length - 1]);
        _sendNative(to, amounts[amounts.length - 1]);
    }

    function _sendNative(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
