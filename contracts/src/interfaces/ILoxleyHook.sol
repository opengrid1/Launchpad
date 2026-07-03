// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";

/// @notice v4 hook that skims a fixed 1% of the ETH side of every swap and
///         forwards it to the RewardsDistributor. Deployed at a mined address
///         whose flag bits enable `afterSwap` + `afterSwapReturnDelta`.
interface ILoxleyHook {
    /// Map a pool to its token so `afterSwap` knows where to route the tax.
    function register(PoolId poolId, address token) external;
}
