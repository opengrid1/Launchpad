// A minimal v4 swap router for the test (exact-input, native or ERC-20 in), compiled against the vendored v4-core.
const fs = require('fs'); const path = require('path'); const solc = require('solc-0.8.26');
const SRC = path.join(__dirname, '..') + '/';
const router = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract TestSwapRouter is IUnlockCallback {
    IPoolManager public immutable pm;
    constructor(IPoolManager pm_) { pm = pm_; }
    function swap(PoolKey calldata key, bool zeroForOne, uint256 amountIn) external payable returns (int256 a0, int256 a1) {
        bytes memory r = pm.unlock(abi.encode(msg.sender, key, zeroForOne, amountIn));
        (a0, a1) = abi.decode(r, (int256, int256));
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm));
        (address user, PoolKey memory key, bool zeroForOne, uint256 amountIn) = abi.decode(data, (address, PoolKey, bool, uint256));
        BalanceDelta d = pm.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}), "");
        _settle(key.currency0, d.amount0(), user); _settle(key.currency1, d.amount1(), user);
        return abi.encode(int256(d.amount0()), int256(d.amount1()));
    }
    function _settle(Currency c, int128 amt, address user) private {
        if (amt < 0) { uint256 owed = uint256(uint128(-amt)); if (c.isAddressZero()) { pm.sync(c); pm.settle{value: owed}(); } else { pm.sync(c); IERC20(Currency.unwrap(c)).transferFrom(user, address(pm), owed); pm.settle(); } }
        else if (amt > 0) pm.take(c, user, uint256(uint128(amt)));
    }
    receive() external payable {}
}`;
const sources = { 'TestSwapRouter.sol': { content: router } };
const walk = (d) => { for (const f of fs.readdirSync(SRC + d)) { const p = d + '/' + f; if (fs.statSync(SRC + p).isDirectory()) walk(p); else if (p.endsWith('.sol')) sources[p] = { content: fs.readFileSync(SRC + p, 'utf8') }; } };
walk('contracts/lib/v4-core'); walk('contracts/lib/openzeppelin-contracts');
const input = { language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun', remappings: ['@uniswap/v4-core/=contracts/lib/v4-core/', '@openzeppelin/contracts/=contracts/lib/openzeppelin-contracts/contracts/'], outputSelection: { 'TestSwapRouter.sol': { TestSwapRouter: ['abi', 'evm.bytecode.object'] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter((e) => e.severity === 'error'); if (errs.length) { console.log(errs.map((e) => e.formattedMessage).join('\n')); process.exit(1); }
const c = out.contracts['TestSwapRouter.sol'].TestSwapRouter; fs.writeFileSync(path.join(__dirname, '../artifacts/TestSwapRouter.json'), JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }));
console.log('router compiled', c.evm.bytecode.object.length / 2, 'bytes');
