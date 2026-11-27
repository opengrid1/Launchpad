// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IFactoryR {
    function poolKey(address coin) external view returns (PoolKey memory);
}

interface ISwapperR {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 out);
}

interface IWETHR {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IERC20R {
    function transfer(address to, uint256 v) external returns (bool);
    function transferFrom(address f, address t, uint256 v) external returns (bool);
    function approve(address s, uint256 v) external returns (bool);
}

/// @title KinetiqPumpRouter
/// @notice Buys and sells KinetiqPump coins with plain HYPE, whatever the coin is paired with. `weth` is WHYPE and the
///         amounts named "eth" are HYPE.
///           buy:  HYPE -> WHYPE -> the coin's quote (through the route swapper; skipped when the quote is WHYPE)
///                 -> the coin, in its own Uniswap v4 pool
///           sell: the coin -> its quote, in its pool -> WHYPE (through the route swapper) -> HYPE
///         The caller names the least they will accept at the end of the whole trip; less than that reverts.
/// @dev The router never holds a coin. On a sell the coins go straight from the seller into the PoolManager before
///      the swap, and on a buy they come out of it straight to the buyer. That matters because the hook books each
///      trade's holder share at the moment of the swap: coins sitting in a router at that moment would earn part
///      of it, and nobody could ever claim it. No owner, no fees of its own, nothing to configure.
contract KinetiqPumpRouter is IUnlockCallback {
    error NotPoolManager();
    error UnknownCoin();
    error ZeroAmount();
    error ZeroAddress();
    error TooLittle(uint256 out, uint256 minOut);
    error Reentered();
    error EthNotSent();
    error TokenCallFailed();
    error PoolTooThin();

    event Bought(address indexed coin, address indexed to, uint256 ethIn, uint256 coinsOut);
    event Sold(address indexed coin, address indexed seller, uint256 coinsIn, uint256 ethOut);

    IPoolManager public immutable poolManager;
    IFactoryR public immutable factory;
    ISwapperR public immutable swapper;
    address public immutable weth;

    uint256 private _lock = 1;

    modifier once() {
        if (_lock != 1) revert Reentered();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IPoolManager pm, address factory_, address swapper_, address weth_) {
        if (address(pm) == address(0) || factory_ == address(0) || swapper_ == address(0) || weth_ == address(0)) {
            revert ZeroAddress();
        }
        poolManager = pm;
        factory = IFactoryR(factory_);
        swapper = ISwapperR(swapper_);
        weth = weth_;
    }

    /// @dev HYPE only arrives here from WHYPE, when a sale is unwrapped
    receive() external payable {
        if (msg.sender != weth) revert EthNotSent();
    }

    /// @notice Buys `coin` with the ETH sent and gives the coins to `to`. Reverts if fewer than `minCoinsOut` come out.
    function buy(address coin, uint256 minCoinsOut, address to) external payable once returns (uint256 coinsOut) {
        if (msg.value == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        (PoolKey memory key, address quote) = _pool(coin);
        IWETHR(weth).deposit{value: msg.value}();
        uint256 quoteIn = msg.value;
        if (quote != weth) {
            _call(weth, abi.encodeCall(IERC20R.approve, (address(swapper), msg.value)));
            quoteIn = swapper.swap(weth, quote, msg.value, 0, address(this));
        }
        coinsOut = abi.decode(poolManager.unlock(abi.encode(key, quote, coin, quoteIn, address(this), to)), (uint256));
        if (coinsOut < minCoinsOut) revert TooLittle(coinsOut, minCoinsOut);
        emit Bought(coin, to, msg.value, coinsOut);
    }

    /// @notice Sells `coinsIn` of `coin` from the caller (who approved this router for them) and sends the ETH to
    ///         `to`. Reverts if less than `minEthOut` comes out.
    function sell(address coin, uint256 coinsIn, uint256 minEthOut, address to) external once returns (uint256 ethOut) {
        if (coinsIn == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        (PoolKey memory key, address quote) = _pool(coin);
        uint256 quoteOut =
            abi.decode(poolManager.unlock(abi.encode(key, coin, quote, coinsIn, msg.sender, address(this))), (uint256));
        ethOut = quoteOut;
        if (quote != weth) {
            _call(quote, abi.encodeCall(IERC20R.approve, (address(swapper), quoteOut)));
            ethOut = swapper.swap(quote, weth, quoteOut, 0, address(this));
        }
        if (ethOut < minEthOut) revert TooLittle(ethOut, minEthOut);
        IWETHR(weth).withdraw(ethOut);
        (bool ok,) = to.call{value: ethOut}("");
        if (!ok) revert EthNotSent();
        emit Sold(coin, msg.sender, coinsIn, ethOut);
    }

    function _pool(address coin) internal view returns (PoolKey memory key, address quote) {
        key = factory.poolKey(coin);
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (c0 == coin && c1 != address(0)) quote = c1;
        else if (c1 == coin && c0 != address(0)) quote = c0;
        else revert UnknownCoin();
    }

    /// @dev One exact-input swap in a coin's pool. The input is paid in before the swap (from this router's balance
    ///      on a buy, straight from the seller on a sell) and the output goes straight to `to`.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolKey memory key, address tokenIn, address tokenOut, uint256 amountIn, address payer, address to) =
            abi.decode(data, (PoolKey, address, address, uint256, address, address));

        poolManager.sync(Currency.wrap(tokenIn));
        if (payer == address(this)) {
            _call(tokenIn, abi.encodeCall(IERC20R.transfer, (address(poolManager), amountIn)));
        } else {
            _call(tokenIn, abi.encodeCall(IERC20R.transferFrom, (payer, address(poolManager), amountIn)));
        }
        poolManager.settle();

        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 spent = zeroForOne ? d.amount0() : d.amount1(); // negative: what the swap took of the input
        int128 got = zeroForOne ? d.amount1() : d.amount0();
        // a pool with too little liquidity left (after a collect) takes less than was paid in: no partial trades
        if (spent >= 0 || uint256(uint128(-spent)) != amountIn || got <= 0) revert PoolTooThin();
        uint256 out = uint256(uint128(got));
        poolManager.take(Currency.wrap(tokenOut), to, out);
        return abi.encode(out);
    }

    function _call(address token, bytes memory data) internal {
        (bool ok, bytes memory r) = token.call(data);
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TokenCallFailed();
    }
}
