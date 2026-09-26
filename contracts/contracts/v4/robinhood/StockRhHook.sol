// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IStockCoin {
    /// @dev Credit a coin-denominated fee to the coin's own accumulator. The
    ///      hook has already transferred the coin to the token; this is pure
    ///      bookkeeping (split 50/40/10 done inside the token).
    function accrue(uint256 coinFee) external;
}

/// @title StockRhHook
/// @notice Fee engine for the Robinhood-chain stock launchpad's V4 pools — the
///         V3 stock-reward model on Uniswap V4, with NO harvest step. Every buy
///         (the pool sends the coin out to the trader) pays a 1% tax skimmed in
///         `afterSwap`; the hook hands that coin fee straight to the coin and
///         calls {IStockCoin.accrue}, so every holder's share is recorded on the
///         spot (MasterChef accumulator inside the coin). Sells are never taxed,
///         exactly like V3.
///
///         Rewards stay denominated in the coin until a holder claims: the coin
///         calls back into {swapCoinToPair}, which swaps the claimed coin into
///         the pool's pair asset (a tokenized stock or WETH) and pays the holder.
///         The 50/40/10 holders/creator/platform split lives inside the coin.
///
///         Ownership is renounced at deploy; a hardcoded, source-visible
///         immutable `admin` keeps the setter powers.
contract StockRhHook is BaseHook, Ownable, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint16 internal constant BPS = 10_000;

    /// @notice Immutable admin that survives `renounceOwnership()`.
    address public immutable admin;

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    struct PoolConfig {
        address token;
        address creator;
        uint16 taxBps;
        bool tokenIsCurrency0;
        bool registered;
        PoolKey poolKey;
    }

    address public factory;
    mapping(PoolId => PoolConfig) internal _config;
    mapping(address => PoolId) internal _poolOf;

    struct SwapAction {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
    }

    event PoolRegistered(address indexed token, PoolId indexed id, uint16 taxBps);
    event FeeAccrued(address indexed token, uint256 coinFee);
    event FactorySet(address indexed factory);

    error NotFactory();
    error AlreadySet();
    error NotRegistered();
    error NotCoin();

    constructor(IPoolManager pm, address owner_, address admin_) BaseHook(pm) Ownable(owner_) {
        require(admin_ != address(0), "zero");
        admin = admin_;
    }

    /// @notice One-time setup: the deployer (owner, pre-renounce) or the admin
    ///         wires the factory in. Owner is included so the launch flow can set
    ///         it in the same run before ownership is renounced.
    function setFactory(address factory_) external {
        require(msg.sender == owner() || msg.sender == admin, "not auth");
        require(factory_ != address(0), "factory=0");
        factory = factory_;
        emit FactorySet(factory_);
    }

    // ---------------------------------------------------------------------
    // Hook permissions + registration
    // ---------------------------------------------------------------------

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.afterSwap = true;
        p.afterSwapReturnDelta = true;
    }

    function registerPool(PoolKey calldata key, address token, address creator, uint16 taxBps, bool tokenIsCurrency0)
        external
    {
        if (msg.sender != factory) revert NotFactory();
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (c.registered) revert AlreadySet();
        c.token = token;
        c.creator = creator;
        c.taxBps = taxBps;
        c.tokenIsCurrency0 = tokenIsCurrency0;
        c.registered = true;
        c.poolKey = key;
        _poolOf[token] = id;
        emit PoolRegistered(token, id, taxBps);
    }

    function config(PoolId id) external view returns (PoolConfig memory) {
        return _config[id];
    }

    // ---------------------------------------------------------------------
    // afterSwap: skim the buy tax in coin, credit the coin's accumulator.
    // ---------------------------------------------------------------------

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolConfig storage c = _config[key.toId()];
        if (!c.registered || c.taxBps == 0) return (BaseHook.afterSwap.selector, int128(0));

        // The V4 return-delta path can only adjust the swap's *unspecified*
        // currency. We only tax buys, and only when the coin is that unspecified
        // side (exact-input buys — the router's default path). That keeps the fee
        // in the coin and the accounting exact; sells and exact-output buys pass
        // through untaxed, matching V3's "1% on buys, in coin" rule.
        bool exactInput = params.amountSpecified < 0;
        bool unspecifiedIsCurrency1 = (params.zeroForOne == exactInput);
        Currency unspecified = unspecifiedIsCurrency1 ? key.currency1 : key.currency0;
        if (Currency.unwrap(unspecified) != c.token) return (BaseHook.afterSwap.selector, int128(0));

        int128 unspecifiedAmount = unspecifiedIsCurrency1 ? delta.amount1() : delta.amount0();
        // Positive = the coin is flowing out to the trader → a buy.
        if (unspecifiedAmount <= 0) return (BaseHook.afterSwap.selector, int128(0));

        uint256 coinOut = uint256(uint128(unspecifiedAmount));
        uint256 fee = (coinOut * c.taxBps) / BPS;
        if (fee == 0) return (BaseHook.afterSwap.selector, int128(0));

        // Pull the coin fee out of the pool straight to the coin contract, then
        // record it — no swap here, no harvest later.
        poolManager.take(unspecified, c.token, fee);
        IStockCoin(c.token).accrue(fee);
        emit FeeAccrued(c.token, fee);

        return (BaseHook.afterSwap.selector, int128(int256(fee)));
    }

    // ---------------------------------------------------------------------
    // Claim path: the coin calls in to swap accrued coin into its pair asset.
    // ---------------------------------------------------------------------

    /// @notice Swap `coinAmount` of the calling coin into its pool's pair asset
    ///         and send the proceeds to `to`. Only a registered coin may call,
    ///         for its own pool. The coin has pre-approved the hook to pull it.
    function swapCoinToPair(uint256 coinAmount, address to) external nonReentrant returns (uint256 pairAmount) {
        PoolConfig storage c = _config[_poolOf[msg.sender]];
        if (!c.registered || c.token != msg.sender) revert NotCoin();
        if (coinAmount == 0) return 0;

        IERC20(msg.sender).safeTransferFrom(msg.sender, address(this), coinAmount);

        Currency coinCurrency = c.tokenIsCurrency0 ? c.poolKey.currency0 : c.poolKey.currency1;
        pairAmount = _swap(c.poolKey, coinCurrency, coinAmount, 0);

        if (pairAmount > 0) {
            address pair = Currency.unwrap(c.tokenIsCurrency0 ? c.poolKey.currency1 : c.poolKey.currency0);
            IERC20(pair).safeTransfer(to, pairAmount);
        }
    }

    // ---------------------------------------------------------------------
    // Swap plumbing (our own router, via PoolManager.unlock)
    // ---------------------------------------------------------------------

    function _swap(PoolKey memory key, Currency currencyIn, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 amountOut)
    {
        if (amountIn == 0) return 0;
        bool zeroForOne = Currency.unwrap(currencyIn) == Currency.unwrap(key.currency0);
        bytes memory res = poolManager.unlock(abi.encode(SwapAction(key, zeroForOne, amountIn)));
        amountOut = abi.decode(res, (uint256));
        require(amountOut >= minOut, "slippage");
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        SwapAction memory a = abi.decode(data, (SwapAction));

        BalanceDelta delta = poolManager.swap(
            a.key,
            SwapParams({
                zeroForOne: a.zeroForOne,
                amountSpecified: -int256(a.amountIn),
                sqrtPriceLimitX96: a.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        _resolve(a.key.currency0, delta.amount0());
        _resolve(a.key.currency1, delta.amount1());

        uint256 out = a.zeroForOne ? uint256(uint128(delta.amount1())) : uint256(uint128(delta.amount0()));
        return abi.encode(out);
    }

    function _resolve(Currency currency, int128 amount) internal {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), owed);
            poolManager.settle();
        } else if (amount > 0) {
            poolManager.take(currency, address(this), uint256(uint128(amount)));
        }
    }
}
