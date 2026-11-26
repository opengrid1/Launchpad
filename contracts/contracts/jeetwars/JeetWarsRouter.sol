// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoolKey, SwapParams, IInfinityVault, ICLPoolManager, ILockCallback, InfinityLib} from "./infinity/IInfinity.sol";

interface IWBNB {
    function deposit() external payable;
}

/// @dev PancakeSwap V3 SmartRouter (exactInput without a deadline).
interface IPancakeV3Router {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

interface IJeetWarsArenaKeys {
    function poolKeyOf(address coin) external view returns (PoolKey memory);
    function isCoin(address coin) external view returns (bool);
}

/// @title JeetWarsRouter
/// @notice Buys and sells Jeet Wars coins through their PancakeSwap Infinity
///         pools in native BNB, and turns BNB into a bStock through PancakeSwap
///         V3 for holders who take their rewards as stock. Holds nothing
///         between calls and has no owner.
contract JeetWarsRouter is ILockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using InfinityLib for PoolKey;

    IInfinityVault public immutable vault;
    ICLPoolManager public immutable poolManager;
    IJeetWarsArenaKeys public immutable arena;
    address public immutable wbnb;
    IPancakeV3Router public immutable v3Router;

    event Bought(address indexed coin, address indexed to, uint256 bnbIn, uint256 coinsOut);
    event Sold(address indexed coin, address indexed to, uint256 coinsIn, uint256 bnbOut);

    error NotVault();
    error Slippage();
    error BadPath();
    error ZeroAmount();
    error TransferFailed();
    error UnknownCoin();

    constructor(IInfinityVault vault_, ICLPoolManager poolManager_, address arena_, address wbnb_, address v3Router_) {
        vault = vault_;
        poolManager = poolManager_;
        arena = IJeetWarsArenaKeys(arena_);
        wbnb = wbnb_;
        v3Router = IPancakeV3Router(v3Router_);
    }

    receive() external payable {}

    /// @notice Buy `coin` with all the BNB sent; at least `minOut` coins to `to`.
    function buy(address coin, uint256 minOut, address to) external payable nonReentrant returns (uint256 out) {
        if (msg.value == 0) revert ZeroAmount();
        PoolKey memory key = _key(coin);
        out = abi.decode(vault.lock(abi.encode(key, true, msg.value, to)), (uint256));
        if (out < minOut) revert Slippage();
        emit Bought(coin, to, msg.value, out);
    }

    /// @notice Sell `amount` of `coin` (pulled from you); at least `minOut` BNB to `to`.
    function sell(address coin, uint256 amount, uint256 minOut, address to) external nonReentrant returns (uint256 out) {
        if (amount == 0) revert ZeroAmount();
        PoolKey memory key = _key(coin);
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amount);
        out = abi.decode(vault.lock(abi.encode(key, false, amount, to)), (uint256));
        if (out < minOut) revert Slippage();
        emit Sold(coin, to, amount, out);
    }

    /// @notice Swap the BNB sent into `stock` along a PancakeSwap V3 `path`
    ///         (WBNB first, `stock` last); at least `minOut` to `to`.
    function bnbToStock(address stock, bytes calldata path, uint256 minOut, address to) external payable nonReentrant returns (uint256 out) {
        if (msg.value == 0) revert ZeroAmount();
        if (path.length < 43 || address(bytes20(path[0:20])) != wbnb || address(bytes20(path[path.length - 20:])) != stock) revert BadPath();
        IWBNB(wbnb).deposit{value: msg.value}();
        IERC20(wbnb).forceApprove(address(v3Router), msg.value);
        out = v3Router.exactInput(IPancakeV3Router.ExactInputParams({path: path, recipient: to, amountIn: msg.value, amountOutMinimum: minOut}));
    }

    /// @dev Vault callback: one swap, settled and taken.
    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(vault)) revert NotVault();
        (PoolKey memory key, bool isBuy, uint256 amount, address to) = abi.decode(data, (PoolKey, bool, uint256, address));
        int256 delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: isBuy,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: isBuy ? InfinityLib.MIN_SQRT_RATIO + 1 : InfinityLib.MAX_SQRT_RATIO - 1
            }),
            ""
        );
        int128 d0 = InfinityLib.amount0(delta);
        int128 d1 = InfinityLib.amount1(delta);
        uint256 out;
        if (isBuy) {
            uint256 paid = uint256(uint128(-d0));
            vault.settle{value: paid}();
            out = uint256(uint128(d1));
            vault.take(key.currency1, to, out);
            if (paid < amount) _sendBnb(to, amount - paid); // price limit reached: refund the rest
        } else {
            uint256 paid = uint256(uint128(-d1));
            vault.sync(key.currency1);
            IERC20(key.currency1).safeTransfer(address(vault), paid);
            vault.settle();
            out = uint256(uint128(d0));
            vault.take(address(0), to, out);
            if (paid < amount) IERC20(key.currency1).safeTransfer(to, amount - paid);
        }
        return abi.encode(out);
    }

    function _key(address coin) internal view returns (PoolKey memory key) {
        if (!arena.isCoin(coin)) revert UnknownCoin();
        key = arena.poolKeyOf(coin);
    }

    function _sendBnb(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
