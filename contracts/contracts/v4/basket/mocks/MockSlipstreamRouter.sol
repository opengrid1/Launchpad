// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {ISlipstreamRouter} from "../ISlipstreamRouter.sol";

/// @dev Test-only token anyone can mint.
contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Test-only stand-in for the Slipstream router: pulls the path's first
///      token from the caller and pays the path's last token from its own
///      inventory at a fixed rate (out = in * rateNum / rateDen).
contract MockSlipstreamRouter is ISlipstreamRouter {
    uint256 public rateNum = 1;
    uint256 public rateDen = 1;

    function setRate(uint256 num, uint256 den) external {
        rateNum = num;
        rateDen = den;
    }

    function exactInput(ExactInputParams calldata p) external payable returns (uint256 amountOut) {
        address tokenIn = address(bytes20(p.path[:20]));
        address tokenOut = address(bytes20(p.path[p.path.length - 20:]));
        require(block.timestamp <= p.deadline, "mock: deadline");
        amountOut = (p.amountIn * rateNum) / rateDen;
        require(amountOut >= p.amountOutMinimum, "mock: slippage");
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), p.amountIn), "mock: pull");
        require(IERC20(tokenOut).transfer(p.recipient, amountOut), "mock: pay");
    }
}
