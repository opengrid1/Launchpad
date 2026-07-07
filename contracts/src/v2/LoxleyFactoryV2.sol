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
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "v4-periphery/libraries/LiquidityAmounts.sol";

import {LoxleyTokenV2} from "./LoxleyTokenV2.sol";

interface IRewardsDistributorV2Reg {
    function register(address token, address creator, address quote, bool buybackOn) external;
}

interface ILoxleyHookV2Reg {
    function register(PoolId poolId, address token, address quote, bool quoteIsZero) external;
}

interface IStockRegistry {
    function isAllowedQuote(address quote) external view returns (bool);
    function quoteUsd1e8(address quote) external view returns (uint256);
}

interface IEthUsdOracle {
    function ethUsd1e8() external view returns (uint256);
}

interface IERC20Meta {
    function decimals() external view returns (uint8);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title LoxleyFactoryV2
/// @notice One call launches a coin, now with three creator choices layered on
///         top of the same fair-launch machine:
///
///           1. QUOTE PAIRING — pair against native ETH (quote = address(0)) or
///              an allowlisted tokenized stock. The quote currency is also the
///              currency holder/creator rewards are paid in ("choose your
///              reward"): ETH-paired → ETH rewards, stock-paired → stock rewards.
///
///           2. CUSTOM STARTING MARKET CAP — the creator passes startMcapUsd
///              (bounded by MIN/MAX), and the launch price is derived from it
///              instead of a single fixed floor.
///
///           3. CREATOR BUYBACK — a launch flag; if on, the creator's 50% fee
///              share is pooled for buy-and-burn instead of being claimable. The
///              creator can still toggle it later on the distributor.
///
///         Everything else is unchanged and non-negotiable: 1B supply seeded
///         100% single-sided, a 1% trade tax taken by the hook (not the LP fee),
///         50/50 holders/creator, no presale, no bonding curve, no graduation,
///         no refunds, and no admin able to move LP or fees.
contract LoxleyFactoryV2 is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // ── fixed terms ──────────────────────────────────────────────────────────
    uint256 public constant SUPPLY = 1_000_000_000e18;
    uint24 public constant LP_FEE = 0; // hook takes the 1%, not the LP
    int24 public constant TICK_SPACING = 200;

    // creator-chosen start mcap is clamped to this band (USD, whole dollars).
    uint256 public constant MIN_MCAP_USD = 1_000;
    uint256 public constant MAX_MCAP_USD = 10_000_000;

    // ── wiring ───────────────────────────────────────────────────────────────
    IPoolManager public immutable manager;
    IHooks public immutable hook;
    IRewardsDistributorV2Reg public immutable distributor;
    IStockRegistry public immutable registry;
    IEthUsdOracle public immutable oracle;

    // ── admin (forked from v1) ────────────────────────────────────────────────
    // The owner sets the DEFAULT starting market cap used when a creator launches
    // without specifying one (startMcapUsd == 0). This is the only admin power on
    // the factory and it is funds-safe: it changes the price of FUTURE launches
    // only — it can never touch an existing pool, its LP, its fees, or any
    // holder's balance. Ownership can be transferred to a multisig or renounced.
    address public owner;
    uint256 public startingMarketCapUsd; // owner-set default, whole USD

    struct Coin {
        address token;
        address creator;
        address quote;
        PoolId poolId;
    }

    Coin[] public coins;

    event Launched(
        address indexed token,
        address indexed creator,
        address indexed quote,
        PoolId poolId,
        uint256 startMcapUsd,
        bool buybackOn,
        uint160 sqrtPriceX96
    );

    struct LaunchState {
        PoolKey key;
        uint160 sqrtPriceX96;
        address token;
        address creator;
        address quote;
        bool coinIsZero; // true if the coin sorted to currency0
        uint256 devBuyAmount; // creator's optional first buy, in the quote currency
    }

    event OwnerChanged(address indexed from, address indexed to);
    event StartingMarketCapChanged(uint256 usd);

    error OnlyManager();
    error OnlyOwner();
    error BadQuote();
    error BadMcap();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(
        IPoolManager _manager,
        IHooks _hook,
        IRewardsDistributorV2Reg _distributor,
        IStockRegistry _registry,
        IEthUsdOracle _oracle,
        address _owner,
        uint256 _startingMarketCapUsd
    ) {
        manager = _manager;
        hook = _hook;
        distributor = _distributor;
        registry = _registry;
        oracle = _oracle;
        owner = _owner;
        if (_startingMarketCapUsd < MIN_MCAP_USD || _startingMarketCapUsd > MAX_MCAP_USD) revert BadMcap();
        startingMarketCapUsd = _startingMarketCapUsd;
        emit OwnerChanged(address(0), _owner);
        emit StartingMarketCapChanged(_startingMarketCapUsd);
    }

    // ── admin: set the default starting market cap (funds-safe) ───────────────
    /// Forked from v1. Affects only launches that don't pass their own mcap.
    /// Cannot change any existing coin's price, LP, fees, or holder balances.
    function setStartingMarketCap(uint256 usd) external onlyOwner {
        if (usd < MIN_MCAP_USD || usd > MAX_MCAP_USD) revert BadMcap();
        startingMarketCapUsd = usd;
        emit StartingMarketCapChanged(usd);
    }

    function transferOwnership(address to) external onlyOwner {
        emit OwnerChanged(owner, to);
        owner = to; // pass to a multisig, or to address(0) to renounce.
    }

    // ── launch ───────────────────────────────────────────────────────────────
    /// @param quote        address(0) for native ETH, or an allowlisted stock.
    /// @param startMcapUsd creator-chosen starting market cap in whole USD.
    /// @param buybackOn    route the creator's 50% into buy-and-burn.
    /// @param devBuyQuote  optional first buy size, in the quote currency. For an
    ///                     ETH quote this is msg.value; for a stock quote the
    ///                     creator must have approved this factory for devBuyQuote
    ///                     of the stock (and msg.value must be 0).
    function createCoin(
        string calldata name,
        string calldata symbol,
        string calldata uri,
        address quote,
        uint256 startMcapUsd,
        bool buybackOn,
        uint256 devBuyQuote
    ) external payable returns (address token, PoolId poolId) {
        if (!registry.isAllowedQuote(quote)) revert BadQuote();
        // 0 = use the owner-set default; otherwise the creator's own choice,
        // clamped to the safety band.
        uint256 mcap = startMcapUsd == 0 ? startingMarketCapUsd : startMcapUsd;
        if (mcap < MIN_MCAP_USD || mcap > MAX_MCAP_USD) revert BadMcap();

        // 1. deploy the coin; whole supply to this factory to seed the pool.
        LoxleyTokenV2 t = new LoxleyTokenV2(name, symbol, uri, SUPPLY, address(distributor));
        token = address(t);

        // 2. sort (quote, coin) into (currency0, currency1) by address. Native
        //    ETH (address(0)) always sorts first.
        bool coinIsZero = uint160(token) < uint160(quote);
        (Currency c0, Currency c1) = coinIsZero
            ? (Currency.wrap(token), _cur(quote))
            : (_cur(quote), Currency.wrap(token));

        PoolKey memory key =
            PoolKey({currency0: c0, currency1: c1, fee: LP_FEE, tickSpacing: TICK_SPACING, hooks: hook});

        // 3. derive the launch price from the chosen mcap and the quote's USD
        //    price, then open the pool.
        uint160 sqrtPriceX96 = _launchSqrtPrice(token, quote, mcap, coinIsZero);
        manager.initialize(key, sqrtPriceX96);

        // 4. register everywhere BEFORE any swap can run.
        poolId = key.toId();
        distributor.register(token, msg.sender, quote, buybackOn);
        ILoxleyHookV2Reg(address(hook)).register(poolId, token, quote, !coinIsZero);

        // 5. pull the dev buy funds in (stock quote) if any, then seed + dev buy
        //    inside one unlock.
        uint256 devBuy = quote == address(0) ? msg.value : devBuyQuote;
        if (quote != address(0) && devBuyQuote > 0) {
            IERC20Meta(quote).transferFrom(msg.sender, address(this), devBuyQuote);
        }
        manager.unlock(abi.encode(LaunchState(key, sqrtPriceX96, token, msg.sender, quote, coinIsZero, devBuy)));

        coins.push(Coin(token, msg.sender, quote, poolId));
        emit Launched(token, msg.sender, quote, poolId, mcap, buybackOn, sqrtPriceX96);
    }

    // ── v4 unlock callback ────────────────────────────────────────────────────
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert OnlyManager();
        LaunchState memory s = abi.decode(data, (LaunchState));

        Currency coinCur = s.coinIsZero ? s.key.currency0 : s.key.currency1;

        // Seed 100% of supply as single-sided coin liquidity. The range is placed
        // entirely on the coin side of spot so buys walk price through it,
        // converting coin -> quote. No quote is supplied, which is what makes the
        // starting market cap "virtual".
        (int24 tickLower, int24 tickUpper) = _seedTicks(s.sqrtPriceX96, s.coinIsZero);
        uint128 liquidity = s.coinIsZero
            ? LiquidityAmounts.getLiquidityForAmount0(s.sqrtPriceX96, TickMath.getSqrtPriceAtTick(tickUpper), SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(tickLower), s.sqrtPriceX96, SUPPLY);

        (BalanceDelta delta,) = manager.modifyLiquidity(
            s.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );
        // settle the coin we owe the pool for the liquidity we added.
        uint256 owed = s.coinIsZero ? uint256(int256(-delta.amount0())) : uint256(int256(-delta.amount1()));
        _settle(coinCur, owed);

        // Optional dev buy in the same tx (quote -> coin) so no sniper front-runs
        // the first block.
        if (s.devBuyAmount > 0) {
            bool quoteToCoin = !s.coinIsZero; // buying coin means selling quote
            BalanceDelta d = manager.swap(
                s.key,
                IPoolManager.SwapParams({
                    zeroForOne: quoteToCoin,
                    amountSpecified: -int256(s.devBuyAmount), // exact quote in
                    sqrtPriceLimitX96: quoteToCoin ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            );
            Currency quoteCur = s.coinIsZero ? s.key.currency1 : s.key.currency0;
            uint256 quoteIn = s.coinIsZero ? uint256(int256(-d.amount1())) : uint256(int256(-d.amount0()));
            uint256 coinOut = s.coinIsZero ? uint256(int256(d.amount0())) : uint256(int256(d.amount1()));
            _settle(quoteCur, quoteIn); // pay quote in
            _take(coinCur, s.creator, coinOut); // coin to creator
        }
        return "";
    }

    // ── settlement helpers (v4 flash accounting) ─────────────────────────────
    function _settle(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        manager.sync(currency);
        if (currency.isAddressZero()) {
            manager.settle{value: amount}();
        } else {
            IERC20Meta(Currency.unwrap(currency)).transfer(address(manager), amount);
            manager.settle();
        }
    }

    function _take(Currency currency, address to, uint256 amount) internal {
        if (amount == 0) return;
        manager.take(currency, to, amount);
    }

    // ── price / tick derivation ──────────────────────────────────────────────
    /// launch price of the coin, in quote per coin, from the chosen mcap:
    ///   coinUsd  = startMcapUsd / SUPPLY
    ///   quotePerCoin = coinUsd / quoteUsd
    /// expressed as sqrtPriceX96 for the sorted (currency0, currency1) pool.
    function _launchSqrtPrice(address token, address quote, uint256 startMcapUsd, bool coinIsZero)
        internal
        view
        returns (uint160)
    {
        uint256 quoteUsd1e8 = quote == address(0) ? oracle.ethUsd1e8() : registry.quoteUsd1e8(quote);
        uint256 quoteUnit = quote == address(0) ? 1e18 : 10 ** IERC20Meta(quote).decimals();

        // tokens of quote per 1 coin, scaled by 1e18 for precision:
        //   quotePerCoin = (startMcapUsd * 1e8 / SUPPLY_whole) / quoteUsd1e8
        // work in "smallest units": quote units per 1e18 coin units.
        // price = amount(currency1) per amount(currency0).
        // We compute quotePerCoin (quote units per 1 coin unit) then invert if
        // the coin is currency0.
        // quotePerCoin_1e18 = startMcapUsd * 1e8 * quoteUnit / (SUPPLY * quoteUsd1e8)
        uint256 quotePerCoinScaled = (startMcapUsd * 1e8 * quoteUnit) / ((SUPPLY / 1e18) * quoteUsd1e8);
        // quotePerCoinScaled is quote-units per 1 coin-unit (already unscaled by 1e18? see below)
        // NOTE: exact fixed-point is deferred to the audited SqrtPriceMath at
        // integration; this helper documents the intent and must be replaced
        // with the same routine v1 used (encodeSqrtRatioX96 over unit amounts).

        // price ratio currency1/currency0:
        uint256 amount1;
        uint256 amount0;
        if (coinIsZero) {
            // currency0 = coin, currency1 = quote → price = quote per coin
            amount1 = quotePerCoinScaled;
            amount0 = 1;
        } else {
            // currency0 = quote, currency1 = coin → price = coin per quote = 1/quotePerCoin
            amount1 = 1;
            amount0 = quotePerCoinScaled;
        }
        return _encodeSqrtPriceX96(amount1, amount0);
    }

    /// single-sided range for the seeded coin: all on the coin side of spot.
    function _seedTicks(uint160 sqrtPriceX96, bool coinIsZero) internal pure returns (int24 lower, int24 upper) {
        int24 spot = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        int24 aligned = (spot / TICK_SPACING) * TICK_SPACING;
        if (coinIsZero) {
            // coin is currency0: liquidity above spot sells coin as price rises.
            lower = aligned;
            upper = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        } else {
            // coin is currency1: liquidity below spot sells coin as price falls.
            lower = (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING;
            upper = aligned;
        }
    }

    function _encodeSqrtPriceX96(uint256 amount1, uint256 amount0) internal pure returns (uint160) {
        uint256 ratioX192 = (amount1 << 192) / amount0;
        return uint160(_sqrt(ratioX192));
    }

    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    function _cur(address a) internal pure returns (Currency) {
        return a == address(0) ? CurrencyLibrary.ADDRESS_ZERO : Currency.wrap(a);
    }

    function coinsLength() external view returns (uint256) {
        return coins.length;
    }

    receive() external payable {}
}
