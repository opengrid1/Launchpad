// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IBuyRouter {
    function buy(address coin, bytes calldata route, uint256 minCoinOut) external payable returns (uint256);
}

/// @dev Test only: attacks the protections from a contract.
contract BackstopTestHelper is IUnlockCallback {
    IPoolManager public immutable pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    receive() external payable {}

    /// @dev Two buys in one transaction (same tx.origin, same block).
    function doubleBuy(address router, address coin) external payable {
        IBuyRouter(router).buy{value: msg.value / 2}(coin, "", 0);
        IBuyRouter(router).buy{value: msg.value / 2}(coin, "", 0);
    }

    /// @dev Stand up a second, hookless V4 pool for `coin` against `other` and
    ///      deposit liquidity from this contract's balances (what look-alike
    ///      pairs do).
    function foreignPool(address coin, address other, uint160 sqrtPriceX96, uint128 liquidity) external {
        (address a, address b) = coin < other ? (coin, other) : (other, coin);
        PoolKey memory key = PoolKey({currency0: Currency.wrap(a), currency1: Currency.wrap(b), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        pm.initialize(key, sqrtPriceX96);
        pm.unlock(abi.encode(key, liquidity));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "pm");
        (PoolKey memory key, uint128 liquidity) = abi.decode(data, (PoolKey, uint128));
        (BalanceDelta d,) = pm.modifyLiquidity(key, ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: int256(uint256(liquidity)), salt: 0}), "");
        _pay(key.currency0, d.amount0());
        _pay(key.currency1, d.amount1());
        return "";
    }

    function _pay(Currency c, int128 amt) internal {
        if (amt >= 0) return;
        pm.sync(c);
        IERC20(Currency.unwrap(c)).transfer(address(pm), uint256(uint128(-amt)));
        pm.settle();
    }
}
