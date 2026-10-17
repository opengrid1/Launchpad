// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {InkySwapPair} from "./InkySwapPair.sol";
import {InkySwapFactory} from "./InkySwapFactory.sol";

interface IInkyStaking {
    function notifyReward(uint256 amount) external;
}

/// @title InkyFeeCollector
/// @notice The factory's `feeTo`. Holds the protocol-fee LP tokens, and on
///         `collect` burns them, swaps everything to WETH on the AMM itself and
///         hands the WETH to the staking contract. Anyone may call it; the
///         destination is fixed. Tokens without a WETH pair stay here until
///         one exists.
contract InkyFeeCollector is ReentrancyGuard {
    using SafeERC20 for IERC20;

    InkySwapFactory public immutable factory;
    address public immutable weth;
    IInkyStaking public immutable staking;

    event Collected(address indexed caller, uint256 pairs, uint256 wethOut);

    error SlippageTooHigh();

    constructor(address _factory, address _weth, address _staking) {
        factory = InkySwapFactory(_factory);
        weth = _weth;
        staking = IInkyStaking(_staking);
    }

    /// @notice WETH the collector would send if `pairs` were collected now, ignoring price impact. For the UI.
    function previewWeth(address[] calldata pairs) external view returns (uint256 total) {
        for (uint256 i; i < pairs.length; i++) {
            InkySwapPair pair = InkySwapPair(pairs[i]);
            uint256 lp = pair.balanceOf(address(this));
            if (lp == 0) continue;
            uint256 supply = pair.totalSupply();
            (uint256 r0, uint256 r1,) = pair.getReserves();
            address t0 = pair.token0();
            address t1 = pair.token1();
            uint256 a0 = lp * r0 / supply;
            uint256 a1 = lp * r1 / supply;
            total += _wethValue(t0, a0) + _wethValue(t1, a1);
        }
    }

    function _wethValue(address token, uint256 amount) private view returns (uint256) {
        if (amount == 0) return 0;
        if (token == weth) return amount;
        address p = factory.getPair(token, weth);
        if (p == address(0)) return 0;
        (uint256 r0, uint256 r1,) = InkySwapPair(p).getReserves();
        (uint256 rt, uint256 rw) = InkySwapPair(p).token0() == token ? (r0, r1) : (r1, r0);
        if (rt == 0) return 0;
        return amount * rw / rt;
    }

    /// @notice Burn the fee LP of `pairs`, swap to WETH, send to staking. Reverts if less than `minWethOut` results.
    function collect(address[] calldata pairs, uint256 minWethOut) external nonReentrant returns (uint256 wethOut) {
        for (uint256 i; i < pairs.length; i++) {
            InkySwapPair pair = InkySwapPair(pairs[i]);
            uint256 lp = pair.balanceOf(address(this));
            if (lp == 0) continue;
            IERC20(address(pair)).safeTransfer(address(pair), lp);
            (uint256 a0, uint256 a1) = pair.burn(address(this));
            _toWeth(pair.token0(), a0);
            _toWeth(pair.token1(), a1);
        }
        wethOut = IERC20(weth).balanceOf(address(this));
        if (wethOut < minWethOut) revert SlippageTooHigh();
        if (wethOut > 0) {
            IERC20(weth).forceApprove(address(staking), wethOut);
            staking.notifyReward(wethOut);
        }
        emit Collected(msg.sender, pairs.length, wethOut);
    }

    /// @dev Swap the whole balance of `token` to WETH through its WETH pair, if one exists.
    function _toWeth(address token, uint256 amount) private {
        if (token == weth || amount == 0) return;
        address p = factory.getPair(token, weth);
        if (p == address(0)) return;
        InkySwapPair pair = InkySwapPair(p);
        uint256 bal = IERC20(token).balanceOf(address(this));
        (uint256 r0, uint256 r1,) = pair.getReserves();
        bool tokenIs0 = pair.token0() == token;
        (uint256 rIn, uint256 rOut) = tokenIs0 ? (r0, r1) : (r1, r0);
        if (rIn == 0 || rOut == 0) return;
        uint256 inWithFee = bal * 997;
        uint256 out = inWithFee * rOut / (rIn * 1000 + inWithFee);
        if (out == 0) return;
        IERC20(token).safeTransfer(p, bal);
        if (tokenIs0) pair.swap(0, out, address(this), new bytes(0));
        else pair.swap(out, 0, address(this), new bytes(0));
    }
}
