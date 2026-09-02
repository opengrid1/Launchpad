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

import {IQuiverToken} from "../interfaces/IQuiverToken.sol";

interface IWrappedNative {
    function withdraw(uint256) external;
    function deposit() external payable;
}

/// @title StockRhHook
/// @notice Fee vault for the Robinhood-chain stock launchpad's V4 pools — the
///         V3 stock-reward model on Uniswap V4. Each coin pairs against a
///         tokenized stock (or WETH); every swap pays a per-token tax skimmed in
///         `afterSwap`. On `harvest`, coin-side fees are swapped into the pair
///         asset and the whole balance is split and paid in the pair asset:
///
///           1. holders  — 50%: credited pro-rata to every eligible holder via
///                         QuiverStockToken.distributeRewards (paid in the pair).
///           2. creator  — 40%: sent to the creator in the pair asset.
///           3. platform — 10%: sent to the platform fee recipient.
///
///         Ownership is renounced at deploy; a hardcoded, source-visible
///         immutable `admin` keeps the setter powers.
contract StockRhHook is BaseHook, Ownable, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint16 internal constant BPS = 10_000;
    // Same split as the V3 stock launchpad: 50% holders / 40% creator / 10%
    // platform, all paid in the pair asset (the tokenized stock or WETH).
    uint16 public constant HOLDER_FEE_BPS = 5_000;
    uint16 public constant CREATOR_FEE_BPS = 4_000;

    address public immutable WETH;
    /// @notice Immutable admin that survives `renounceOwnership()`.
    address public immutable admin;
    /// @notice Platform fee recipient (the 10% share of harvested fees).
    address public platform;

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
    /// @notice token => launched-coin fees awaiting harvest (from buys).
    mapping(address => uint256) public tokenFees;
    /// @notice token => pair-asset (stock/WETH) fees awaiting harvest (from sells).
    mapping(address => uint256) public pairFees;

    struct SwapAction {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
    }

    event PoolRegistered(address indexed token, PoolId indexed id, uint16 taxBps);
    event FeeAccrued(address indexed token, bool weth, uint256 amount);
    event Harvested(address indexed token, uint256 toHolders, uint256 toCreator);
    event FactorySet(address indexed factory);

    error NotFactory();
    error AlreadySet();
    error NotRegistered();

    constructor(IPoolManager pm, address owner_, address admin_, address weth_, address platform_) BaseHook(pm) Ownable(owner_) {
        require(admin_ != address(0) && weth_ != address(0) && platform_ != address(0), "zero");
        admin = admin_;
        WETH = weth_;
        platform = platform_;
    }

    function setFactory(address factory_) external onlyAdmin {
        require(factory_ != address(0), "factory=0");
        factory = factory_;
        emit FactorySet(factory_);
    }

    /// @notice Admin can re-point the platform fee recipient.
    function setPlatform(address platform_) external onlyAdmin {
        require(platform_ != address(0), "platform=0");
        platform = platform_;
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
    // afterSwap: skim the tax
    // ---------------------------------------------------------------------

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolConfig storage c = _config[key.toId()];
        if (!c.registered || c.taxBps == 0) return (BaseHook.afterSwap.selector, int128(0));

        bool exactInput = params.amountSpecified < 0;
        bool unspecifiedIsCurrency1 = (params.zeroForOne == exactInput);
        Currency unspecified = unspecifiedIsCurrency1 ? key.currency1 : key.currency0;
        int128 unspecifiedAmount = unspecifiedIsCurrency1 ? delta.amount1() : delta.amount0();

        uint256 magnitude = unspecifiedAmount < 0 ? uint256(uint128(-unspecifiedAmount)) : uint256(uint128(unspecifiedAmount));
        uint256 fee = (magnitude * c.taxBps) / BPS;
        if (fee == 0) return (BaseHook.afterSwap.selector, int128(0));

        poolManager.take(unspecified, address(this), fee);

        bool feeIsToken = Currency.unwrap(unspecified) == c.token;
        if (feeIsToken) tokenFees[c.token] += fee;
        else pairFees[c.token] += fee;
        emit FeeAccrued(c.token, !feeIsToken, fee);

        return (BaseHook.afterSwap.selector, int128(int256(fee)));
    }

    // ---------------------------------------------------------------------
    // harvest: normalise coin fees into the pair asset, split 50/40/10, pay in
    // the pair asset (the tokenized stock or WETH) — same model as V3.
    // ---------------------------------------------------------------------

    function harvest(address token) external nonReentrant {
        _harvest(token, 0);
    }

    function harvestBounded(address token, uint256 minPairOut) external nonReentrant {
        _harvest(token, minPairOut);
    }

    function _harvest(address token, uint256 minPairOut) private {
        PoolConfig storage c = _config[_poolOf[token]];
        if (!c.registered) revert NotRegistered();

        // Coin-denominated fees (from buys) are swapped into the pair asset so
        // the whole harvest pays out in one currency: the pair (stock/WETH).
        uint256 tf = tokenFees[token];
        if (tf > 0) {
            tokenFees[token] = 0;
            Currency tokenCurrency = c.tokenIsCurrency0 ? c.poolKey.currency0 : c.poolKey.currency1;
            pairFees[token] += _swap(c.poolKey, tokenCurrency, tf, minPairOut);
        }

        uint256 total = pairFees[token];
        if (total == 0) {
            emit Harvested(token, 0, 0);
            return;
        }
        pairFees[token] = 0;

        // The pair asset (non-coin side of the pool) is the reward currency.
        address pair = Currency.unwrap(c.tokenIsCurrency0 ? c.poolKey.currency1 : c.poolKey.currency0);

        uint256 toHolders = (total * HOLDER_FEE_BPS) / BPS; // 50%
        uint256 toCreator = (total * CREATOR_FEE_BPS) / BPS; // 40%
        uint256 toPlatform = total - toHolders - toCreator;  // 10%

        // Holders earn the pair asset: fund the coin, then credit the dividend
        // accumulator pro-rata to every eligible holder.
        if (toHolders > 0) {
            IERC20(pair).safeTransfer(token, toHolders);
            IQuiverToken(token).distributeRewards(toHolders);
        }
        if (toCreator > 0) IERC20(pair).safeTransfer(c.creator, toCreator);
        if (toPlatform > 0) IERC20(pair).safeTransfer(platform, toPlatform);

        emit Harvested(token, toHolders, toCreator);
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
