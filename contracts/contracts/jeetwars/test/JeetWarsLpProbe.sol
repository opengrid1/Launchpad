// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey, ModifyLiquidityParams, IInfinityVault, ICLPoolManager, ILockCallback} from "../infinity/IInfinity.sol";

/// @dev Test helper: tries to add liquidity to a pool as a third party.
contract JeetWarsLpProbe is ILockCallback {
    IInfinityVault public immutable vault;
    ICLPoolManager public immutable poolManager;

    constructor(IInfinityVault vault_, ICLPoolManager poolManager_) {
        vault = vault_;
        poolManager = poolManager_;
    }

    function addLiquidity(PoolKey calldata key) external {
        vault.lock(abi.encode(key));
    }

    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        PoolKey memory key = abi.decode(data, (PoolKey));
        poolManager.modifyLiquidity(key, ModifyLiquidityParams({tickLower: -887_200, tickUpper: 887_200, liquidityDelta: 1e18, salt: 0}), "");
        return "";
    }
}
