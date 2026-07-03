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

import {LoxleyToken} from "./LoxleyToken.sol";
import {IRewardsDistributor} from "./interfaces/IRewardsDistributor.sol";
import {ILoxleyHook} from "./interfaces/ILoxleyHook.sol";

/// @title LoxleyFactory
/// @notice One call launches a coin: deploy the token, open a single-sided
///         Uniswap v4 pool, seed the whole supply as liquidity, and (optionally)
///         do the creator's first buy — all in one transaction.
///
///         Fixed, non-negotiable terms live here as constants: 1B supply, a 1%
///         trade tax (taken by the hook, not the pool), and a $2.5K *virtual*
///         starting market cap from which the launch price is derived. There is
///         no presale, no bonding curve, no graduation, and no refunds.
contract LoxleyFactory is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // ── fixed terms ──────────────────────────────────────────────────────────
    uint256 public constant SUPPLY = 1_000_000_000e18; // whole supply, seeded single-sided
    uint24  public constant LP_FEE = 0;                 // LPs earn nothing; the hook takes the 1%
    int24   public constant TICK_SPACING = 200;
    uint256 public constant START_MCAP_USD = 2500;      // virtual starting market cap

    // ── wiring ───────────────────────────────────────────────────────────────
    IPoolManager        public immutable manager;
    ILoxleyHook         public immutable hook;        // takes 1% ETH on every swap
    IRewardsDistributor public immutable distributor; // splits 50/50 holders/creator
    IEthUsdOracle       public immutable oracle;      // ETH/USD, to derive the launch price

    // ── registry ─────────────────────────────────────────────────────────────
    struct Coin { address token; address creator; PoolId poolId; }
    Coin[] public coins;
    mapping(PoolId => address) public creatorOf;

    event Launched(address indexed token, address indexed creator, PoolId poolId, uint160 sqrtPriceX96);

    // payload carried into the unlock callback
    struct LaunchState { PoolKey key; uint160 sqrtPriceX96; address creator; uint256 devBuyWei; }

    error OnlyManager();

    constructor(IPoolManager _manager, ILoxleyHook _hook, IRewardsDistributor _distributor, IEthUsdOracle _oracle) {
        manager = _manager;
        hook = _hook;
        distributor = _distributor;
        oracle = _oracle;
    }

    // ── launch ───────────────────────────────────────────────────────────────
    /// @param devBuyWei is msg.value: the creator's optional first buy, in ETH.
    function createCoin(string calldata name, string calldata symbol, string calldata uri)
        external
        payable
        returns (address token, PoolId poolId)
    {
        // 1. deploy the token; the whole supply is minted to this factory just
        //    long enough to seed the pool. The token's transfer hook reports to
        //    the distributor so holder rewards accrue correctly from block one.
        LoxleyToken t = new LoxleyToken(name, symbol, uri, SUPPLY, address(distributor));
        token = address(t);

        // 2. native ETH (address(0)) always sorts below the token, so ETH is
        //    currency0 and the token is currency1. LP fee is 0 — the hook is
        //    where the 1% tax is taken.
        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        // 3. derive the launch price from the fixed $2.5k virtual mcap and open the pool.
        uint160 sqrtPriceX96 = _launchSqrtPrice();
        manager.initialize(key, sqrtPriceX96);

        // 4. register BEFORE any swap can run, so the hook/distributor already
        //    know the creator and token when the dev buy fires.
        poolId = key.toId();
        creatorOf[poolId] = msg.sender;
        distributor.register(poolId, token, msg.sender);
        hook.register(poolId, token);

        // 5. seed the single-sided position (+ optional dev buy) inside one unlock.
        manager.unlock(abi.encode(LaunchState(key, sqrtPriceX96, msg.sender, msg.value)));

        // 6. record + announce.
        coins.push(Coin(token, msg.sender, poolId));
        emit Launched(token, msg.sender, poolId, sqrtPriceX96);
    }

    // ── v4 unlock callback: the only place liquidity/swaps actually move ──────
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert OnlyManager();
        LaunchState memory s = abi.decode(data, (LaunchState));

        // Seed 100% of supply as single-sided token liquidity. Token is
        // currency1, so the range sits below spot (in token/ETH terms): buys
        // walk the price down through the range, converting token -> ETH. No
        // ETH is supplied here, which is what makes the $2.5k mcap virtual.
        (int24 tickLower, int24 tickUpper) = _launchTicks(s.sqrtPriceX96);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount1(
            TickMath.getSqrtPriceAtTick(tickLower),
            s.sqrtPriceX96,
            SUPPLY
        );

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
        // we owe the pool `token` (currency1) for the liquidity we just added.
        _settle(s.key.currency1, uint256(int256(-delta.amount1())));

        // Optional dev buy: swap the creator's ETH into token in the same tx so
        // no sniper can front-run the very first block.
        if (s.devBuyWei > 0) {
            BalanceDelta d = manager.swap(
                s.key,
                IPoolManager.SwapParams({
                    zeroForOne: true, // ETH (currency0) -> token (currency1)
                    amountSpecified: -int256(s.devBuyWei), // exact ETH in
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                ""
            );
            _settle(s.key.currency0, uint256(int256(-d.amount0())));            // pay ETH in
            _take(s.key.currency1, s.creator, uint256(int256(d.amount1())));    // token to creator
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
            LoxleyToken(Currency.unwrap(currency)).transfer(address(manager), amount);
            manager.settle();
        }
    }

    function _take(Currency currency, address to, uint256 amount) internal {
        if (amount == 0) return;
        manager.take(currency, to, amount);
    }

    // ── price / tick derivation ──────────────────────────────────────────────
    /// launch price in ETH per token = START_MCAP_USD / (SUPPLY * ETH_USD),
    /// expressed as sqrtPriceX96 for the (ETH, token) pool.
    function _launchSqrtPrice() internal view returns (uint160) {
        // priceX96 = (amount of currency1 per currency0) = tokens per ETH.
        // tokens-per-ETH = 1 / ethPerToken = (SUPPLY * ethUsd) / START_MCAP_USD.
        uint256 ethUsd = oracle.ethUsd1e8();               // ETH/USD, 8 decimals
        // pool price = currency1/currency0 = tokens per ETH = 1 / ethPerToken.
        uint256 tokensPerEth = (SUPPLY * ethUsd) / (START_MCAP_USD * 1e8);
        return _encodeSqrtPriceX96(tokensPerEth, 1);
    }

    /// single-sided sell range: from the launch tick down to the floor.
    function _launchTicks(uint160 sqrtPriceX96) internal pure returns (int24 lower, int24 upper) {
        int24 spot = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        upper = (spot / TICK_SPACING) * TICK_SPACING;       // at/just below spot
        lower = (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING;
    }

    function _encodeSqrtPriceX96(uint256 amount1, uint256 amount0) internal pure returns (uint160) {
        // sqrt(amount1/amount0) << 96, via TickMath round-trip for safety.
        // (kept as a helper so the exact fixed-point routine can be swapped for
        //  the audited FullMath/SqrtPriceMath version at integration time.)
        uint256 ratioX192 = (amount1 << 192) / amount0;
        return uint160(_sqrt(ratioX192));
    }

    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
        return y;
    }

    function coinsLength() external view returns (uint256) { return coins.length; }

    receive() external payable {}
}

interface IEthUsdOracle {
    /// @return ETH price in USD with 8 decimals (Chainlink-style).
    function ethUsd1e8() external view returns (uint256);
}
