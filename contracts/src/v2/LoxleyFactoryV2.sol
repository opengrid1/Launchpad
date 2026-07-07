// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "v4-periphery/libraries/LiquidityAmounts.sol";

import {LoxleyTokenV2} from "./LoxleyTokenV2.sol";

interface IRewardsDistributorV2Reg { function register(address token, address creator, address quote, bool buybackOn) external; }
interface ILoxleyHookV2Reg { function register(PoolId poolId, address token, address quote, bool quoteIsZero) external; }
interface IStockRegistry { function isAllowedQuote(address quote) external view returns (bool); }
interface IERC20Meta {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title LoxleyFactoryV2
/// @notice One call launches a coin, with three creator choices layered on top of
///         the same fair-launch machine:
///
///           1. QUOTE PAIRING — pair against native ETH (quote = address(0)) or a
///              real on-chain tokenized stock allowlisted in the StockRegistry.
///              The quote is also the reward currency ("choose your reward").
///
///           2. CUSTOM STARTING MARKET CAP — the creator passes startMcapQuote:
///              the total value of the whole supply, denominated in the QUOTE
///              (raw units). No oracle — the launch price is derived directly from
///              that quote-denominated cap, fully on-chain.
///
///           3. CREATOR BUYBACK — a launch flag; if on, the creator's 50% fee
///              share is pooled for buy-and-burn (toggleable later).
///
///         Fixed & non-negotiable: 1B supply seeded 100% single-sided, 1% trade
///         tax taken by the hook, 50/50 holders/creator, no presale, no bonding
///         curve, no graduation, no refunds, and NO admin able to move LP or fees.
contract LoxleyFactoryV2 is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 public constant SUPPLY = 1_000_000_000e18;
    uint24  public constant LP_FEE = 0;         // hook takes the 1%, not the LP
    int24   public constant TICK_SPACING = 200;

    IPoolManager public immutable manager;
    IHooks public immutable hook;
    IRewardsDistributorV2Reg public immutable distributor;
    IStockRegistry public immutable registry;

    // ── admin (funds-safe) ────────────────────────────────────────────────────
    // Generalises v1's setStartingMarketCap: the owner sets a DEFAULT starting
    // market cap PER QUOTE (in that quote's raw units), used when a creator
    // launches with startMcapQuote == 0. This is the only admin power and it is
    // funds-safe — it changes the price of FUTURE launches only, and can never
    // touch an existing pool, its LP, its fees, or any holder's balance.
    address public owner;
    mapping(address => uint256) public defaultMcapQuote; // quote => default cap (raw)

    struct Coin { address token; address creator; address quote; PoolId poolId; }
    Coin[] public coins;

    event Launched(address indexed token, address indexed creator, address indexed quote, PoolId poolId, uint256 startMcapQuote, bool buybackOn, uint160 sqrtPriceX96);
    event OwnerChanged(address indexed from, address indexed to);
    event DefaultMcapChanged(address indexed quote, uint256 mcapQuote);

    struct LaunchState { PoolKey key; uint160 sqrtPriceX96; address token; address creator; address quote; bool coinIsZero; uint256 devBuyAmount; }

    error OnlyManager(); error OnlyOwner(); error BadQuote(); error BadMcap(); error BadPrice();
    modifier onlyOwner() { if (msg.sender != owner) revert OnlyOwner(); _; }

    constructor(IPoolManager _manager, IHooks _hook, IRewardsDistributorV2Reg _distributor, IStockRegistry _registry, address _owner) {
        manager = _manager; hook = _hook; distributor = _distributor; registry = _registry; owner = _owner;
        emit OwnerChanged(address(0), _owner);
    }

    // admin — funds-safe (future launches only)
    function setDefaultMcap(address quote, uint256 mcapQuote) external onlyOwner {
        if (!registry.isAllowedQuote(quote)) revert BadQuote();
        defaultMcapQuote[quote] = mcapQuote;
        emit DefaultMcapChanged(quote, mcapQuote);
    }
    function transferOwnership(address to) external onlyOwner { emit OwnerChanged(owner, to); owner = to; }

    // ── launch ───────────────────────────────────────────────────────────────
    /// @param quote          address(0) for native ETH, or an allowlisted stock.
    /// @param startMcapQuote total supply value in the quote's raw units. 0 = use
    ///                       the owner-set default for this quote.
    /// @param buybackOn      route the creator's 50% into buy-and-burn.
    /// @param devBuyQuote    optional first buy size in the quote (msg.value for
    ///                       ETH; approved ERC20 pull for a stock).
    function createCoin(string calldata name, string calldata symbol, string calldata uri, address quote, uint256 startMcapQuote, bool buybackOn, uint256 devBuyQuote)
        external payable returns (address token, PoolId poolId)
    {
        if (!registry.isAllowedQuote(quote)) revert BadQuote();
        uint256 mcap = startMcapQuote == 0 ? defaultMcapQuote[quote] : startMcapQuote;
        if (mcap == 0) revert BadMcap();

        // 1. deploy the coin; whole supply to this factory to seed the pool.
        LoxleyTokenV2 t = new LoxleyTokenV2(name, symbol, uri, SUPPLY, address(distributor));
        token = address(t);

        // 2. sort (quote, coin) into (currency0, currency1); ETH always sorts first.
        bool coinIsZero = uint160(token) < uint160(quote);
        (Currency c0, Currency c1) = coinIsZero ? (Currency.wrap(token), _cur(quote)) : (_cur(quote), Currency.wrap(token));
        PoolKey memory key = PoolKey({currency0: c0, currency1: c1, fee: LP_FEE, tickSpacing: TICK_SPACING, hooks: hook});

        // 3. derive the launch price from the quote-denominated mcap, validate,
        //    and open the pool.
        uint160 sqrtPriceX96 = _launchSqrtPrice(mcap, coinIsZero);
        if (sqrtPriceX96 <= TickMath.MIN_SQRT_PRICE || sqrtPriceX96 >= TickMath.MAX_SQRT_PRICE) revert BadPrice();
        manager.initialize(key, sqrtPriceX96);

        // 4. register everywhere BEFORE any swap can run.
        poolId = key.toId();
        distributor.register(token, msg.sender, quote, buybackOn);
        ILoxleyHookV2Reg(address(hook)).register(poolId, token, quote, !coinIsZero);

        // 5. pull dev-buy funds (stock quote) if any, then seed + dev buy in one unlock.
        uint256 devBuy = quote == address(0) ? msg.value : devBuyQuote;
        if (quote != address(0) && devBuyQuote > 0) IERC20Meta(quote).transferFrom(msg.sender, address(this), devBuyQuote);
        manager.unlock(abi.encode(LaunchState(key, sqrtPriceX96, token, msg.sender, quote, coinIsZero, devBuy)));

        coins.push(Coin(token, msg.sender, quote, poolId));
        emit Launched(token, msg.sender, quote, poolId, mcap, buybackOn, sqrtPriceX96);
    }

    // ── v4 unlock callback ────────────────────────────────────────────────────
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert OnlyManager();
        LaunchState memory s = abi.decode(data, (LaunchState));
        Currency coinCur = s.coinIsZero ? s.key.currency0 : s.key.currency1;

        // seed 100% supply single-sided, entirely on the coin side of spot.
        (int24 tl, int24 tu) = _seedTicks(s.sqrtPriceX96, s.coinIsZero);
        uint128 liq = s.coinIsZero
            ? LiquidityAmounts.getLiquidityForAmount0(s.sqrtPriceX96, TickMath.getSqrtPriceAtTick(tu), SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(tl), s.sqrtPriceX96, SUPPLY);
        (BalanceDelta delta,) = manager.modifyLiquidity(s.key, IPoolManager.ModifyLiquidityParams({tickLower: tl, tickUpper: tu, liquidityDelta: int256(uint256(liq)), salt: bytes32(0)}), "");
        uint256 owed = s.coinIsZero ? uint256(int256(-delta.amount0())) : uint256(int256(-delta.amount1()));
        _settle(coinCur, owed);

        // optional dev buy in the same tx (quote -> coin).
        if (s.devBuyAmount > 0) {
            bool quoteToCoin = !s.coinIsZero;
            BalanceDelta d = manager.swap(s.key, IPoolManager.SwapParams({zeroForOne: quoteToCoin, amountSpecified: -int256(s.devBuyAmount), sqrtPriceLimitX96: quoteToCoin ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}), "");
            Currency quoteCur = s.coinIsZero ? s.key.currency1 : s.key.currency0;
            uint256 quoteIn = s.coinIsZero ? uint256(int256(-d.amount1())) : uint256(int256(-d.amount0()));
            uint256 coinOut = s.coinIsZero ? uint256(int256(d.amount0())) : uint256(int256(d.amount1()));
            _settle(quoteCur, quoteIn);
            _take(coinCur, s.creator, coinOut);
        }
        return "";
    }

    function _settle(Currency c, uint256 a) internal { if (a == 0) return; manager.sync(c); if (c.isAddressZero()) manager.settle{value: a}(); else { IERC20Meta(Currency.unwrap(c)).transfer(address(manager), a); manager.settle(); } }
    function _take(Currency c, address to, uint256 a) internal { if (a == 0) return; manager.take(c, to, a); }

    // ── price / tick derivation (oracle-free) ─────────────────────────────────
    /// Launch price from the quote-denominated market cap. Price is the raw ratio
    /// quote-per-coin = mcapQuote / SUPPLY (both already in raw units, so any
    /// decimal difference is handled). Encoded as sqrtPriceX96 for the sorted
    /// pool using v4-core's audited FullMath.mulDiv — no lossy hand-rolled math.
    function _launchSqrtPrice(uint256 mcapQuote, bool coinIsZero) internal pure returns (uint160) {
        // price = amount(currency1) / amount(currency0).
        // coinIsZero: coin=c0, quote=c1 → price = quote/coin = mcapQuote/SUPPLY.
        // else:       quote=c0, coin=c1 → price = coin/quote = SUPPLY/mcapQuote.
        (uint256 amount1, uint256 amount0) = coinIsZero ? (mcapQuote, SUPPLY) : (SUPPLY, mcapQuote);
        // ratioX192 = amount1 * 2^192 / amount0  (512-bit safe via mulDiv)
        uint256 ratioX192 = FullMath.mulDiv(amount1, 1 << 192, amount0);
        return uint160(_sqrt(ratioX192)); // sqrt(ratioX192) = sqrt(price) * 2^96
    }

    /// single-sided range for the seeded coin: all on the coin side of spot.
    function _seedTicks(uint160 p, bool coinIsZero) internal pure returns (int24 lower, int24 upper) {
        int24 aligned = (TickMath.getTickAtSqrtPrice(p) / TICK_SPACING) * TICK_SPACING;
        if (coinIsZero) { lower = aligned; upper = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING; }
        else { lower = (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING; upper = aligned; }
    }

    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = (x + 1) / 2; uint256 y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
        return y;
    }

    function _cur(address a) internal pure returns (Currency) { return a == address(0) ? CurrencyLibrary.ADDRESS_ZERO : Currency.wrap(a); }
    function coinsLength() external view returns (uint256) { return coins.length; }
    receive() external payable {}
}
