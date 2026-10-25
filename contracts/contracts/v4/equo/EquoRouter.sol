// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {EquoFactory} from "./EquoFactory.sol";

interface IEquoWrapped {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @dev Uniswap V3 pool.
interface IEquoV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @dev Uniswap V2 pair.
interface IEquoV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 r0, uint112 r1, uint32 last);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title EquoRouter
/// @notice One-tap trading for EquoHook coins in plain ETH, whatever the pair
///         token. The ETH <-> pair leg follows a caller-supplied route of up to
///         four hops through the pools the token trades in on Ethereum:
///
///           route = abi.encode(Hop[])   Hop = (dex, pool, v4Key)
///
///         dex 1 Uniswap V2 (by pair address), 2 Uniswap V3 or a V3 fork (by
///         pool address), 3 Uniswap V4 (by key), 4 Algebra (by pool address;
///         KittenSwap and Nest on HyperEVM). Buying walks WETH -> ... -> pair;
///         selling walks the same hops backwards. A WETH-paired coin needs no
///         route. It holds no funds between calls.
///
///         Every coin swap tells the hook who the trader is (msg.sender) and an
///         optional referrer, so the trader earns cashback and the referrer its
///         share. A referrer binds to a trader once, on their first referred trade.
///
///         Trading from any chain, against the one pool on Ethereum:
///           - {buyFor}: a cross-chain payment service (the trader paid on their own chain) buys for the trader.
///             The coins and the cashback go to the trader. A referrer only binds when the trader buys for
///             themselves, so nobody can set another trader's referrer by buying in their name.
///           - {sellWithSig}: the trader signs a sell once (amount, minimum payout, maximum gas fee, payout address,
///             deadline) and any relayer submits it, paying the gas and taking at most the signed fee out of the
///             proceeds. The trader needs no ETH on Ethereum to sell.
contract EquoRouter is IUnlockCallback, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint8 internal constant UNI_V2 = 1;
    uint8 internal constant UNI_V3 = 2;
    uint8 internal constant UNI_V4 = 3;
    uint8 internal constant ALGEBRA = 4;
    uint256 internal constant MAX_HOPS = 4;

    IPoolManager public immutable poolManager;
    EquoFactory public immutable factory;
    address public immutable weth;

    struct Hop {
        uint8 dex;
        address pool;
        PoolKey key;
    }

    struct V4Swap {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        bytes hookData;
    }

    address private _activePool;

    /// @notice A sell the owner signed once, for anyone to submit. `minEthOut` is what `payTo` must receive after
    ///         the relayer's fee; `maxFee` caps that fee; `nonce` is the owner's next {sellNonces} value.
    struct SellIntent {
        address owner;
        address coin;
        uint256 amountIn;
        uint256 minEthOut;
        uint256 maxFee;
        address payTo;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice An optional EIP-2612 permit for the coin, so the owner needs no approve transaction. `deadline`
    ///         zero means none: the owner approved the router already.
    struct Permit {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    bytes32 public constant SELL_TYPEHASH = keccak256(
        "SellIntent(address owner,address coin,uint256 amountIn,uint256 minEthOut,uint256 maxFee,address payTo,uint256 nonce,uint256 deadline)"
    );
    /// @notice The next sell nonce of each owner; a signed sell is good once.
    mapping(address owner => uint256) public sellNonces;

    event Bought(address indexed coin, address indexed buyer, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event Sold(address indexed coin, address indexed seller, uint256 coinIn, uint256 pairOut, uint256 ethOut);
    event SoldWithSig(address indexed coin, address indexed owner, address indexed payTo, uint256 coinIn, uint256 ethOut, uint256 fee, address relayer);

    error Expired();
    error BadSignature();
    error FeeTooHigh();
    error NotListed();
    error Slippage();
    error ZeroAmount();
    error BadRoute();
    error ZeroAddress();
    /// @dev Carries a simulated amount out of {quoteEthToPair}.
    error QuoteResult(uint256 amount);

    constructor(IPoolManager pm, EquoFactory factory_, address weth_) EIP712("EquoRouter", "1") {
        if (address(pm) == address(0) || address(factory_) == address(0) || weth_ == address(0)) revert ZeroAddress();
        poolManager = pm;
        factory = factory_;
        weth = weth_;
    }

    receive() external payable {}

    // ---------------------------------------------------------------------
    // ETH in / ETH out
    // ---------------------------------------------------------------------

    /// @notice Buy `coin` with the ETH sent, along `route` (empty for a WETH pair).
    ///         `referrer` (zero for none) binds to the buyer on their first referred trade.
    function buy(address coin, bytes calldata route, uint256 minCoinOut, address referrer) external payable nonReentrant returns (uint256 coinOut) {
        if (msg.value == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
        _poke(pair);
        uint256 pairIn = _ethToPair(pair, msg.value, route);
        coinOut = _coinSwap(coin, pair, pairIn, msg.sender, referrer);
        if (coinOut < minCoinOut) revert Slippage();
        IERC20(coin).safeTransfer(msg.sender, coinOut);
        emit Bought(coin, msg.sender, msg.value, pairIn, coinOut);
    }

    /// @notice Buy `coin` with the ETH sent, for `recipient`: the coins and the cashback are theirs. How a payment
    ///         made on another chain buys in the one pool. `referrer` only binds when the caller is the recipient;
    ///         anyone else buying in their name trades under the recipient's existing referrer, if any.
    function buyFor(address coin, bytes calldata route, uint256 minCoinOut, address referrer, address recipient)
        external
        payable
        nonReentrant
        returns (uint256 coinOut)
    {
        if (msg.value == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        address pair = _pairOf(coin);
        _poke(pair);
        uint256 pairIn = _ethToPair(pair, msg.value, route);
        coinOut = _coinSwap(coin, pair, pairIn, recipient, msg.sender == recipient ? referrer : address(0));
        if (coinOut < minCoinOut) revert Slippage();
        IERC20(coin).safeTransfer(recipient, coinOut);
        emit Bought(coin, recipient, msg.value, pairIn, coinOut);
    }

    /// @notice Submit a sell the owner signed (see {SellIntent}). The caller pays the gas and takes `fee` (at most the
    ///         signed `maxFee`) out of the ETH proceeds; `payTo` receives the rest, at least the signed `minEthOut`.
    ///         `permit` (optional) approves the router with the coin's EIP-2612 permit in the same call.
    function sellWithSig(SellIntent calldata it, bytes calldata route, uint256 fee, bytes calldata signature, Permit calldata permit)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        if (block.timestamp > it.deadline) revert Expired();
        if (fee > it.maxFee) revert FeeTooHigh();
        if (it.amountIn == 0) revert ZeroAmount();
        if (it.payTo == address(0)) revert ZeroAddress();
        if (it.nonce != sellNonces[it.owner]++) revert BadSignature();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(SELL_TYPEHASH, it.owner, it.coin, it.amountIn, it.minEthOut, it.maxFee, it.payTo, it.nonce, it.deadline))
        );
        if (ECDSA.recover(digest, signature) != it.owner) revert BadSignature();
        if (permit.deadline != 0) {
            // a front-run permit has already set the allowance; the transfer below is what must succeed
            try IERC20Permit(it.coin).permit(it.owner, address(this), it.amountIn, permit.deadline, permit.v, permit.r, permit.s) {} catch {}
        }
        address pair = _pairOf(it.coin);
        _poke(pair);
        IERC20(it.coin).safeTransferFrom(it.owner, address(this), it.amountIn);
        uint256 pairOut = _coinSwap(it.coin, it.coin, it.amountIn, it.owner, address(0));
        ethOut = _pairToWeth(pair, pairOut, route);
        if (ethOut < fee || ethOut - fee < it.minEthOut) revert Slippage();
        IEquoWrapped(weth).withdraw(ethOut);
        _sendEth(it.payTo, ethOut - fee);
        if (fee != 0) _sendEth(msg.sender, fee);
        emit SoldWithSig(it.coin, it.owner, it.payTo, it.amountIn, ethOut, fee, msg.sender);
    }

    /// @notice The EIP-712 domain separator signed sells use.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "eth xfer");
    }

    /// @notice Sell `amountIn` of `coin` for ETH along `route` (the buy route, walked backwards).
    function sell(address coin, uint256 amountIn, bytes calldata route, uint256 minEthOut, address referrer) external nonReentrant returns (uint256 ethOut) {
        if (amountIn == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
        _poke(pair);
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 pairOut = _coinSwap(coin, coin, amountIn, msg.sender, referrer);
        ethOut = _pairToWeth(pair, pairOut, route);
        if (ethOut < minEthOut) revert Slippage();
        IEquoWrapped(weth).withdraw(ethOut);
        (bool ok,) = msg.sender.call{value: ethOut}("");
        require(ok, "eth xfer");
        emit Sold(coin, msg.sender, amountIn, pairOut, ethOut);
    }

    // ---------------------------------------------------------------------
    // Pair in / pair out (for wallets that hold the pair)
    // ---------------------------------------------------------------------

    function buyWithPair(address coin, uint256 pairIn, uint256 minCoinOut, address referrer) external nonReentrant returns (uint256 coinOut) {
        if (pairIn == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
        IERC20(pair).safeTransferFrom(msg.sender, address(this), pairIn);
        coinOut = _coinSwap(coin, pair, pairIn, msg.sender, referrer);
        if (coinOut < minCoinOut) revert Slippage();
        IERC20(coin).safeTransfer(msg.sender, coinOut);
        emit Bought(coin, msg.sender, 0, pairIn, coinOut);
    }

    function sellForPair(address coin, uint256 amountIn, uint256 minPairOut, address referrer) external nonReentrant returns (uint256 pairOut) {
        if (amountIn == 0) revert ZeroAmount();
        address pair = _pairOf(coin);
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amountIn);
        pairOut = _coinSwap(coin, coin, amountIn, msg.sender, referrer);
        if (pairOut < minPairOut) revert Slippage();
        IERC20(pair).safeTransfer(msg.sender, pairOut);
        emit Sold(coin, msg.sender, amountIn, pairOut, 0);
    }

    // ---------------------------------------------------------------------
    // Conversions for the factory (first buy) and wallets
    // ---------------------------------------------------------------------

    /// @notice Turn the ETH sent into `pair` along `route`, delivered to `to`.
    function ethToPair(address pair, bytes calldata route, address to, uint256 minOut) external payable nonReentrant returns (uint256 pairOut) {
        if (msg.value == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        pairOut = _ethToPair(pair, msg.value, route);
        if (pairOut < minOut) revert Slippage();
        IERC20(pair).safeTransfer(to, pairOut);
    }

    /// @notice Pull `amount` of `pair` from the caller, turn it into ETH along
    ///         `route` (walked backwards) and send it to `to`.
    function pairToEth(address pair, uint256 amount, address to, uint256 minOut, bytes calldata route) external nonReentrant returns (uint256 ethOut) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) return 0;
        IERC20(pair).safeTransferFrom(msg.sender, address(this), amount);
        ethOut = _pairToWeth(pair, amount, route);
        if (ethOut < minOut) revert Slippage();
        IEquoWrapped(weth).withdraw(ethOut);
        (bool ok,) = to.call{value: ethOut}("");
        require(ok, "eth xfer");
    }

    /// @notice Simulate the ETH -> pair leg for the ETH sent: always reverts with QuoteResult(pairOut).
    ///         For eth_call only (a wallet simulating with a balance override needs no funds); it works for
    ///         every dex kind a route can contain, with no quoter contract.
    function quoteEthToPair(address pair, bytes calldata route) external payable {
        revert QuoteResult(_ethToPair(pair, msg.value, route));
    }

    // ---------------------------------------------------------------------
    // Routing
    // ---------------------------------------------------------------------

    function _hops(bytes calldata route) internal pure returns (Hop[] memory hops) {
        if (route.length == 0) revert BadRoute();
        hops = abi.decode(route, (Hop[]));
        if (hops.length == 0 || hops.length > MAX_HOPS) revert BadRoute();
    }

    function _ethToPair(address pair, uint256 ethAmount, bytes calldata route) internal returns (uint256) {
        IEquoWrapped(weth).deposit{value: ethAmount}();
        return _wethToPair(pair, ethAmount, route);
    }

    function _wethToPair(address pair, uint256 wethAmount, bytes calldata route) internal returns (uint256 amount) {
        if (pair == weth || wethAmount == 0) return wethAmount;
        Hop[] memory hops = _hops(route);
        address held = weth;
        amount = wethAmount;
        for (uint256 i; i < hops.length; i++) (held, amount) = _hop(hops[i], held, amount);
        if (held != pair) revert BadRoute();
    }

    function _pairToWeth(address pair, uint256 pairAmount, bytes calldata route) internal returns (uint256 amount) {
        if (pair == weth || pairAmount == 0) return pairAmount;
        Hop[] memory hops = _hops(route);
        address held = pair;
        amount = pairAmount;
        for (uint256 i = hops.length; i > 0; i--) (held, amount) = _hop(hops[i - 1], held, amount);
        if (held != weth) revert BadRoute();
    }

    function _hop(Hop memory h, address tokenIn, uint256 amountIn) internal returns (address tokenOut, uint256 amountOut) {
        if (h.dex == UNI_V4) {
            address c0 = Currency.unwrap(h.key.currency0);
            address c1 = Currency.unwrap(h.key.currency1);
            address s0 = c0 == address(0) ? weth : c0;
            bool zeroForOne;
            if (tokenIn == s0) { zeroForOne = true; tokenOut = c1; }
            else if (tokenIn == c1) { tokenOut = s0; }
            else revert BadRoute();
            amountOut = _v4Swap(h.key, zeroForOne, amountIn, "");
            return (tokenOut, amountOut);
        }
        address t0 = IEquoV3Pool(h.pool).token0();
        address t1 = IEquoV3Pool(h.pool).token1();
        bool zfo;
        if (tokenIn == t0) { zfo = true; tokenOut = t1; }
        else if (tokenIn == t1) { tokenOut = t0; }
        else revert BadRoute();
        uint256 before = IERC20(tokenOut).balanceOf(address(this));
        if (h.dex == UNI_V2) {
            IERC20(tokenIn).safeTransfer(h.pool, amountIn);
            (uint112 r0, uint112 r1,) = IEquoV2Pair(h.pool).getReserves();
            (uint256 rin, uint256 rout) = zfo ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
            uint256 got = IERC20(tokenIn).balanceOf(h.pool) - rin;
            uint256 inFee = got * 997;
            uint256 out = (inFee * rout) / (rin * 1000 + inFee);
            IEquoV2Pair(h.pool).swap(zfo ? 0 : out, zfo ? out : 0, address(this), "");
        } else if (h.dex == UNI_V3 || h.dex == ALGEBRA) {
            // the same swap call; Algebra pools answer through a differently named callback
            _activePool = h.pool;
            IEquoV3Pool(h.pool).swap(address(this), zfo, int256(amountIn), zfo ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1, abi.encode(tokenIn));
            _activePool = address(0);
        } else {
            revert BadRoute();
        }
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - before;
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _payPool(amount0Delta, amount1Delta, data);
    }

    function algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _payPool(amount0Delta, amount1Delta, data);
    }

    function _payPool(int256 amount0Delta, int256 amount1Delta, bytes calldata data) internal {
        if (msg.sender != _activePool || msg.sender == address(0)) revert BadRoute();
        address tokenIn = abi.decode(data, (address));
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        IERC20(tokenIn).safeTransfer(msg.sender, owed);
    }

    // ---------------------------------------------------------------------
    // V4 swap plumbing
    // ---------------------------------------------------------------------

    function _poke(address pair) internal {
        if (pair == weth) return;
        try factory.oracle().poke(pair) {} catch {}
    }

    function _pairOf(address coin) internal view returns (address pair) {
        (, pair,,) = factory.listings(coin);
        if (pair == address(0)) revert NotListed();
    }

    /// @dev Swap through the coin's own pool: `currencyIn` is the coin (sell) or its pair (buy).
    ///      The hook learns the trader (the buyer, seller or named recipient) and the referrer from hookData.
    function _coinSwap(address coin, address currencyIn, uint256 amountIn, address trader, address referrer) internal returns (uint256) {
        PoolKey memory key = factory.poolKeyOf(coin);
        return _v4Swap(key, currencyIn == Currency.unwrap(key.currency0), amountIn, abi.encode(trader, referrer));
    }

    function _v4Swap(PoolKey memory key, bool zeroForOne, uint256 amountIn, bytes memory hookData) internal returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        bytes memory res = poolManager.unlock(abi.encode(V4Swap(key, zeroForOne, amountIn, hookData)));
        amountOut = abi.decode(res, (uint256));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        V4Swap memory a = abi.decode(data, (V4Swap));
        BalanceDelta delta = poolManager.swap(
            a.key,
            SwapParams({zeroForOne: a.zeroForOne, amountSpecified: -int256(a.amountIn), sqrtPriceLimitX96: a.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}),
            a.hookData
        );
        _resolve(a.key.currency0, delta.amount0());
        _resolve(a.key.currency1, delta.amount1());
        int128 o = a.zeroForOne ? delta.amount1() : delta.amount0();
        return abi.encode(o > 0 ? uint256(uint128(o)) : 0);
    }

    function _resolve(Currency currency, int128 amount) internal {
        address c = Currency.unwrap(currency);
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            if (c == address(0)) {
                IEquoWrapped(weth).withdraw(owed);
                poolManager.settle{value: owed}();
            } else {
                poolManager.sync(currency);
                IERC20(c).safeTransfer(address(poolManager), owed);
                poolManager.settle();
            }
        } else if (amount > 0) {
            uint256 got = uint256(uint128(amount));
            poolManager.take(currency, address(this), got);
            if (c == address(0)) IEquoWrapped(weth).deposit{value: got}();
        }
    }
}
