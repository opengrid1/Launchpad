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

interface IQuiverTokenM {
    function distributeRewards(uint8 idx, uint256 amount) external;
    function eligibleSupply() external view returns (uint256);
}

/// @title QuiverHookS
/// @notice Fee hook for STOCK-PAIRED launchpad pools: each launched token
///         trades directly against a tokenized stock, so the tax is collected
///         in that stock (and the token). On `harvest` everything normalises
///         to the paired stock and splits 50/25/25:
///
///           1. holders  — 50%: split across the creator's reward basket
///                         (1..5 stocks). The paired stock's share needs NO
///                         swap at all; other stocks route stock -> USDG ->
///                         stock through their listed liquid pools.
///           2. creator  — 25%: claimable in the paired stock
///           3. protocol — 25%: paired stock sent to the treasury
///
///         Fold-forward safety: whenever a routed leg cannot deliver (empty
///         pool, zero output), whatever currency the hook is HOLDING at that
///         point goes to the treasury instead. Value moves only forward, so a
///         dead route can never strand funds or revert the harvest — the
///         failure mode of the v1 hook this replaces.
contract QuiverHookS is BaseHook, Ownable, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint16 internal constant BPS = 10_000;
    uint256 public constant MAX_REWARDS = 5;

    struct RewardRoute {
        address stock; // reward the holders receive
        PoolKey usdgKey; // that stock's liquid USDG pool (unused when == pair)
    }

    struct PoolConfig {
        address token;
        address pairStock; // the stock the pool is quoted in
        address creator;
        uint16 taxBps;
        bool tokenIsCurrency0;
        bool registered;
        uint8 rewardCount;
        PoolKey poolKey; // token/pairStock pool
        PoolKey pairUsdgKey; // pairStock's liquid USDG pool (for reward routing)
        RewardRoute[MAX_REWARDS] rewards;
    }

    address public factory;
    address public protocolTreasury;
    /// @notice USDG — the routing quote between stocks.
    address public immutable USDG;

    mapping(PoolId => PoolConfig) internal _config;
    /// @notice token => paired-stock fees awaiting harvest.
    mapping(address => uint256) public stockFees;
    /// @notice token => launched-token fees awaiting harvest.
    mapping(address => uint256) public tokenFees;
    /// @notice token => paired-stock amount claimable by its creator.
    mapping(address => uint256) public creatorClaimable;
    mapping(address => PoolId) internal _poolOf;

    struct SwapAction {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
    }

    event PoolRegistered(address indexed token, PoolId indexed id, address pairStock, uint16 taxBps);
    event FeeAccrued(address indexed token, bool stockSide, uint256 amount);
    event Harvested(address indexed token, uint256 toCreator, uint256 toHolders, uint256 toProtocol);
    event RewardDelivered(address indexed token, address indexed stock, uint256 amount);
    event RouteFolded(address indexed token, address indexed currency, uint256 amount);
    event CreatorClaimed(address indexed token, address indexed creator, uint256 amount);
    event ProtocolTreasurySet(address indexed treasury);
    event FactorySet(address indexed factory);

    error NotFactory();
    error AlreadySet();
    error NotRegistered();
    error NotCreator();

    constructor(IPoolManager pm, address owner_, address treasury_, address usdg_)
        BaseHook(pm)
        Ownable(owner_)
    {
        require(treasury_ != address(0) && usdg_ != address(0), "zero");
        protocolTreasury = treasury_;
        USDG = usdg_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setFactory(address factory_) external onlyOwner {
        require(factory_ != address(0), "factory=0");
        factory = factory_;
        emit FactorySet(factory_);
    }

    function setProtocolTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "treasury=0");
        protocolTreasury = treasury_;
        emit ProtocolTreasurySet(treasury_);
    }

    // ---------------------------------------------------------------------
    // Hook permissions
    // ---------------------------------------------------------------------

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.afterSwap = true;
        p.afterSwapReturnDelta = true;
    }

    // ---------------------------------------------------------------------
    // Registration (factory only)
    // ---------------------------------------------------------------------

    function registerPool(
        PoolKey calldata key,
        address token,
        address pairStock,
        address creator,
        uint16 taxBps,
        bool tokenIsCurrency0,
        PoolKey calldata pairUsdgKey,
        RewardRoute[] calldata rewards
    ) external {
        if (msg.sender != factory) revert NotFactory();
        require(rewards.length > 0 && rewards.length <= MAX_REWARDS, "rewards");
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (c.registered) revert AlreadySet();
        c.token = token;
        c.pairStock = pairStock;
        c.creator = creator;
        c.taxBps = taxBps;
        c.tokenIsCurrency0 = tokenIsCurrency0;
        c.registered = true;
        c.poolKey = key;
        c.pairUsdgKey = pairUsdgKey;
        c.rewardCount = uint8(rewards.length);
        for (uint256 i; i < rewards.length; ++i) {
            c.rewards[i] = rewards[i];
        }
        _poolOf[token] = id;
        emit PoolRegistered(token, id, pairStock, taxBps);
    }

    function config(PoolId id) external view returns (PoolConfig memory) {
        return _config[id];
    }

    function poolOf(address token) external view returns (PoolId) {
        return _poolOf[token];
    }

    // ---------------------------------------------------------------------
    // afterSwap: skim the tax on every trade
    // ---------------------------------------------------------------------

    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        PoolConfig storage c = _config[key.toId()];
        if (!c.registered || c.taxBps == 0) return (BaseHook.afterSwap.selector, int128(0));

        // Tax the UNSPECIFIED currency so both exact-input and exact-output
        // trades pay — no order shape dodges the fee.
        bool exactInput = params.amountSpecified < 0;
        bool unspecifiedIsCurrency1 = (params.zeroForOne == exactInput);
        Currency unspecified = unspecifiedIsCurrency1 ? key.currency1 : key.currency0;
        int128 unspecifiedAmount = unspecifiedIsCurrency1 ? delta.amount1() : delta.amount0();

        uint256 magnitude = unspecifiedAmount < 0
            ? uint256(uint128(-unspecifiedAmount))
            : uint256(uint128(unspecifiedAmount));
        uint256 fee = (magnitude * c.taxBps) / BPS;
        if (fee == 0) return (BaseHook.afterSwap.selector, int128(0));

        poolManager.take(unspecified, address(this), fee);

        bool feeIsToken = Currency.unwrap(unspecified) == c.token;
        if (feeIsToken) {
            tokenFees[c.token] += fee;
        } else {
            stockFees[c.token] += fee;
        }
        emit FeeAccrued(c.token, !feeIsToken, fee);

        return (BaseHook.afterSwap.selector, int128(int256(fee)));
    }

    // ---------------------------------------------------------------------
    // harvest
    // ---------------------------------------------------------------------

    /// @notice Permissionless harvest with no slippage bounds. Anyone may call;
    ///         the keeper does on a schedule.
    function harvest(address token) external nonReentrant {
        _harvest(token, 0);
    }

    /// @notice Harvest with a minimum on the token->stock conversion.
    function harvestBounded(address token, uint256 minStockOut) external nonReentrant {
        _harvest(token, minStockOut);
    }

    function _harvest(address token, uint256 minStockOut) private {
        PoolConfig storage c = _config[_poolOf[token]];
        if (!c.registered) revert NotRegistered();

        // 1. Convert launched-token fees into the paired stock via its own
        //    pool (factory-seeded, always liquid).
        uint256 tf = tokenFees[token];
        if (tf > 0) {
            tokenFees[token] = 0;
            Currency tokenCurrency = c.tokenIsCurrency0 ? c.poolKey.currency0 : c.poolKey.currency1;
            (uint256 used, uint256 got) = _swap(c.poolKey, tokenCurrency, tf);
            require(got >= minStockOut, "slippage");
            stockFees[token] += got;
            // Partial fill: the unconsumed remainder is still ours — keep it
            // accounted so a later harvest retries it.
            if (used < tf) tokenFees[token] = tf - used;
        }

        uint256 total = stockFees[token];
        if (total == 0) {
            emit Harvested(token, 0, 0, 0);
            return;
        }
        stockFees[token] = 0;

        uint256 toCreator = total / 4;
        uint256 toHolders = total / 2;
        uint256 toProtocol = total - toCreator - toHolders;

        creatorClaimable[token] += toCreator;

        // 2. Holders' share, split equally across the reward basket. The fold
        //    happens BEFORE any spend when there is nobody to pay.
        if (IQuiverTokenM(token).eligibleSupply() == 0) {
            toProtocol += toHolders;
            toHolders = 0;
        } else {
            uint256 n = c.rewardCount;
            uint256 share = toHolders / n;
            uint256 delivered;
            for (uint256 i; i < n; ++i) {
                uint256 s = (i == n - 1) ? toHolders - share * (n - 1) : share;
                delivered += _deliverReward(token, c, uint8(i), s);
            }
            // Whatever could not be delivered was already folded forward to
            // the treasury inside _deliverReward, in-kind.
            toHolders = delivered;
        }

        // 3. Protocol share in the paired stock.
        if (toProtocol > 0) {
            IERC20(c.pairStock).safeTransfer(protocolTreasury, toProtocol);
        }

        emit Harvested(token, toCreator, toHolders, toProtocol);
    }

    /// @dev Deliver `amountPair` (in paired stock) as reward `idx`. Returns the
    ///      pair-stock value actually delivered to holders; anything that a
    ///      dead route leaves in hand is sent to the treasury in-kind.
    function _deliverReward(address token, PoolConfig storage c, uint8 idx, uint256 amountPair)
        private
        returns (uint256 deliveredPairValue)
    {
        if (amountPair == 0) return 0;
        RewardRoute storage r = c.rewards[idx];

        // Paired stock itself: direct distribution, no route, cannot fail.
        if (r.stock == c.pairStock) {
            IERC20(c.pairStock).safeTransfer(token, amountPair);
            IQuiverTokenM(token).distributeRewards(idx, amountPair);
            emit RewardDelivered(token, r.stock, amountPair);
            return amountPair;
        }

        // Routed: pairStock -> USDG -> reward stock. Fold forward on any dead
        // or partial leg — whatever currency is left in hand goes to the
        // treasury, spent value is never re-counted.
        (uint256 pairUsed, uint256 usdgOut) = _swap(c.pairUsdgKey, _currencyOf(c.pairUsdgKey, c.pairStock), amountPair);
        if (pairUsed < amountPair) {
            uint256 left = amountPair - pairUsed;
            IERC20(c.pairStock).safeTransfer(protocolTreasury, left);
            emit RouteFolded(token, c.pairStock, left);
        }
        if (usdgOut == 0) return 0;
        (uint256 usdgUsed, uint256 stockOut) = _swap(r.usdgKey, _currencyOf(r.usdgKey, USDG), usdgOut);
        if (usdgUsed < usdgOut) {
            uint256 leftU = usdgOut - usdgUsed;
            IERC20(USDG).safeTransfer(protocolTreasury, leftU);
            emit RouteFolded(token, USDG, leftU);
        }
        if (stockOut == 0) return 0;
        IERC20(r.stock).safeTransfer(token, stockOut);
        IQuiverTokenM(token).distributeRewards(idx, stockOut);
        emit RewardDelivered(token, r.stock, stockOut);
        return pairUsed;
    }

    function _currencyOf(PoolKey storage key, address token) private view returns (Currency) {
        return Currency.unwrap(key.currency0) == token ? key.currency0 : key.currency1;
    }

    /// @notice Creator withdraws accrued paired-stock fees.
    function claimCreatorFees(address token) external nonReentrant returns (uint256 amount) {
        PoolConfig storage c = _config[_poolOf[token]];
        if (!c.registered) revert NotRegistered();
        if (msg.sender != c.creator) revert NotCreator();
        amount = creatorClaimable[token];
        if (amount == 0) return 0;
        creatorClaimable[token] = 0;
        IERC20(c.pairStock).safeTransfer(msg.sender, amount);
        emit CreatorClaimed(token, msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Swap plumbing (own router via PoolManager.unlock)
    // ---------------------------------------------------------------------

    /// @dev Exact-input swap. Returns BOTH the input actually consumed and the
    ///      output received, so callers can account for partial fills.
    function _swap(PoolKey memory key, Currency currencyIn, uint256 amountIn)
        internal
        returns (uint256 amountInUsed, uint256 amountOut)
    {
        if (amountIn == 0) return (0, 0);
        bool zeroForOne = Currency.unwrap(currencyIn) == Currency.unwrap(key.currency0);
        bytes memory res = poolManager.unlock(abi.encode(SwapAction(key, zeroForOne, amountIn)));
        (amountInUsed, amountOut) = abi.decode(res, (uint256, uint256));
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

        (int128 inDelta, int128 outDelta) = a.zeroForOne
            ? (delta.amount0(), delta.amount1())
            : (delta.amount1(), delta.amount0());
        uint256 inUsed = inDelta < 0 ? uint256(uint128(-inDelta)) : 0;
        uint256 out = outDelta > 0 ? uint256(uint128(outDelta)) : 0;
        return abi.encode(inUsed, out);
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
