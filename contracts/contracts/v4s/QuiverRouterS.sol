// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IFactoryS {
    function listings(address token)
        external
        view
        returns (address creator, address pairStock, uint16 taxBps, uint64 createdAt, bytes32 poolId);
    function stockPool(address stock) external view returns (PoolKey memory);
}

/// @title QuiverRouterS
/// @notice Trading front door for STOCK-PAIRED Quiver markets. Two entrances:
///
///           - buyWithStock / sellForStock: trade directly in the paired stock
///             (Robinhood Chain wallets hold tokenized stocks natively)
///           - buyWithEth / sellForEth: convenience path that routes
///             ETH <-> WETH <-> USDG <-> pair stock <-> token in one tx
///
///         The pool's hook applies the launchpad tax automatically on the
///         final token<->stock leg. Stateless and permissionless.
contract QuiverRouterS is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    IWETH public immutable weth;
    address public immutable usdg;
    address public immutable hook;
    IFactoryS public immutable factory;
    /// @notice The liquid WETH/USDG pool used by the ETH convenience path.
    PoolKey internal _wethUsdgKey;

    uint24 public constant LP_FEE = 0;
    int24 public constant TICK_SPACING = 60;

    struct Hop {
        PoolKey key;
        bool zeroForOne;
    }

    struct Order {
        Hop[] hops; // executed in sequence, each spending the previous output
        uint256 amountIn;
        address tokenIn; // ERC20 the payer provides
        address payer; // address(this) when the router pre-holds (ETH wrap)
        address recipient; // receiver of the final output
    }

    error TooLittleReceived();
    error UnknownToken();

    constructor(IPoolManager pm, IWETH weth_, address usdg_, address hook_, IFactoryS factory_, PoolKey memory wethUsdgKey_) {
        poolManager = pm;
        weth = weth_;
        usdg = usdg_;
        hook = hook_;
        factory = factory_;
        _wethUsdgKey = wethUsdgKey_;
    }

    function wethUsdgKey() external view returns (PoolKey memory) {
        return _wethUsdgKey;
    }

    // ---------------------------------------------------------------------
    // Key builders
    // ---------------------------------------------------------------------

    function _pairKey(address token, address pairStock) internal view returns (PoolKey memory key, bool tokenIsC0) {
        tokenIsC0 = token < pairStock;
        key = PoolKey({
            currency0: Currency.wrap(tokenIsC0 ? token : pairStock),
            currency1: Currency.wrap(tokenIsC0 ? pairStock : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
    }

    function _dir(PoolKey memory key, address tokenIn) internal pure returns (bool) {
        return Currency.unwrap(key.currency0) == tokenIn;
    }

    function _pairStockOf(address token) internal view returns (address pairStock) {
        (, pairStock, , , ) = factory.listings(token);
        if (pairStock == address(0)) revert UnknownToken();
    }

    // ---------------------------------------------------------------------
    // Stock-denominated trading
    // ---------------------------------------------------------------------

    /// @notice Buy `token` with `amountIn` of its paired stock.
    function buyWithStock(address token, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        returns (uint256 out)
    {
        require(amountIn > 0, "no amount");
        address pairStock = _pairStockOf(token);
        (PoolKey memory key, ) = _pairKey(token, pairStock);
        Hop[] memory hops = new Hop[](1);
        hops[0] = Hop(key, _dir(key, pairStock));
        out = _run(hops, amountIn, pairStock, msg.sender, msg.sender);
        if (out < minOut) revert TooLittleReceived();
    }

    /// @notice Sell `amountIn` of `token` for its paired stock.
    function sellForStock(address token, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        returns (uint256 out)
    {
        require(amountIn > 0, "no amount");
        address pairStock = _pairStockOf(token);
        (PoolKey memory key, ) = _pairKey(token, pairStock);
        Hop[] memory hops = new Hop[](1);
        hops[0] = Hop(key, _dir(key, token));
        out = _run(hops, amountIn, token, msg.sender, msg.sender);
        if (out < minOut) revert TooLittleReceived();
    }

    // ---------------------------------------------------------------------
    // ETH convenience path (ETH <-> USDG <-> pair stock <-> token)
    // ---------------------------------------------------------------------

    function buyWithEth(address token, uint256 minOut) external payable nonReentrant returns (uint256 out) {
        require(msg.value > 0, "no eth");
        address pairStock = _pairStockOf(token);
        weth.deposit{value: msg.value}();
        Hop[] memory hops = _ethHops(token, pairStock, true);
        out = _run(hops, msg.value, address(weth), address(this), msg.sender);
        if (out < minOut) revert TooLittleReceived();
    }

    function sellForEth(address token, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        returns (uint256 out)
    {
        require(amountIn > 0, "no amount");
        address pairStock = _pairStockOf(token);
        Hop[] memory hops = _ethHops(token, pairStock, false);
        out = _run(hops, amountIn, token, msg.sender, address(this));
        if (out < minOut) revert TooLittleReceived();
        weth.withdraw(out);
        (bool ok, ) = payable(msg.sender).call{value: out}("");
        require(ok, "eth xfer");
    }

    function _ethHops(address token, address pairStock, bool buying) internal view returns (Hop[] memory hops) {
        PoolKey memory stockUsdg = factory.stockPool(pairStock);
        (PoolKey memory pool, ) = _pairKey(token, pairStock);
        hops = new Hop[](3);
        if (buying) {
            hops[0] = Hop(_wethUsdgKey, _dir(_wethUsdgKey, address(weth)));
            hops[1] = Hop(stockUsdg, _dir(stockUsdg, usdg));
            hops[2] = Hop(pool, _dir(pool, pairStock));
        } else {
            hops[0] = Hop(pool, _dir(pool, token));
            hops[1] = Hop(stockUsdg, _dir(stockUsdg, pairStock));
            hops[2] = Hop(_wethUsdgKey, _dir(_wethUsdgKey, usdg));
        }
    }

    // ---------------------------------------------------------------------
    // Execution
    // ---------------------------------------------------------------------

    function _run(Hop[] memory hops, uint256 amountIn, address tokenIn, address payer, address recipient)
        internal
        returns (uint256 out)
    {
        bytes memory res = poolManager.unlock(abi.encode(Order(hops, amountIn, tokenIn, payer, recipient)));
        out = abi.decode(res, (uint256));
    }

    function unlockCallback(bytes calldata raw) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pm");
        Order memory o = abi.decode(raw, (Order));

        uint256 amount = o.amountIn;
        Currency inC;
        Currency outC;
        for (uint256 i; i < o.hops.length; ++i) {
            Hop memory h = o.hops[i];
            BalanceDelta delta = poolManager.swap(
                h.key,
                SwapParams({
                    zeroForOne: h.zeroForOne,
                    amountSpecified: -int256(amount),
                    sqrtPriceLimitX96: h.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            );
            inC = h.zeroForOne ? h.key.currency0 : h.key.currency1;
            outC = h.zeroForOne ? h.key.currency1 : h.key.currency0;
            int128 inDelta = h.zeroForOne ? delta.amount0() : delta.amount1();
            int128 outDelta = h.zeroForOne ? delta.amount1() : delta.amount0();

            uint256 owed = inDelta < 0 ? uint256(uint128(-inDelta)) : 0;
            poolManager.sync(inC);
            if (i == 0) {
                // First hop is paid by the payer (or by the router for ETH wraps).
                if (o.payer == address(this)) {
                    IERC20(o.tokenIn).safeTransfer(address(poolManager), owed);
                } else {
                    IERC20(o.tokenIn).safeTransferFrom(o.payer, address(poolManager), owed);
                }
            } else {
                // Intermediate legs spend what the previous leg took here.
                IERC20(Currency.unwrap(inC)).safeTransfer(address(poolManager), owed);
            }
            poolManager.settle();

            uint256 got = outDelta > 0 ? uint256(uint128(outDelta)) : 0;
            // Intermediate outputs come to the router; the final one goes out.
            address to = (i == o.hops.length - 1) ? o.recipient : address(this);
            poolManager.take(outC, to, got);
            amount = got;
        }
        return abi.encode(amount);
    }

    receive() external payable {
        require(msg.sender == address(weth), "direct eth");
    }
}
