// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";

/// @notice Holds the 1% ETH tax per coin and splits it 50/50 between holders
///         (pro-rata, accumulator pattern) and the creator (claimable).
interface IRewardsDistributor {
    /// Register a coin at launch (called by the factory).
    function register(PoolId poolId, address token, address creator) external;

    /// Deposit collected ETH tax for a coin (called by the hook). Splits 50/50.
    function deposit(address token) external payable;

    /// Settle a holder's accrual on token movement (called by the token hook).
    function onTokenMove(address token, address from, address to) external;

    /// Holder claims their accrued ETH.
    function claim(address token) external;

    /// Creator claims their 50% share.
    function claimCreator(address token) external;

    /// View: ETH currently claimable by `user` for `token`.
    function claimable(address token, address user) external view returns (uint256);
}
