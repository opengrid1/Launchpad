// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

interface IStrategyHook {
    function flush(address token) external returns (uint256 amount, uint256 platformCut);
    function twapTick(PoolId id, uint32 window) external view returns (bool ok, int24 tick);
}

interface IStrategyOracle {
    function poke(address token) external returns (uint256);
    function settled(address token) external view returns (bool);
}

interface IStrategyFactory {
    function feeRecipient() external view returns (address);
    function lpThresholdUsd() external view returns (uint256);
}

interface IStrategyCoin {
    function totalSupply() external view returns (uint256);
    function eligibleSupply() external view returns (uint256);
    function fund(uint256 amount) external;
    function burn(uint256 amount) external;
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title BackstopStrategy
/// @notice One per coin. Receives the coin's trade tax (in the backing token)
///         from the pool hook and runs the strategy the creator fixed at launch.
///
///         Split. The hook reports the platform's exact 1% of every trade with
///         the tax; everything else is divided by the creator's fixed weights
///         between themselves, holders, the vault, the buyback fund, auto-LP
///         and auto-burn. Anti-snipe and dynamic-tax surcharges go the same way.
///         Backing tokens sent here without a report are split the same way.
///
///         Vault. Holds the backing token. No function withdraws it: it leaves
///         only through {redeem} (holders burn coins for vault x amount / supply)
///         and take-profit.
///
///         {execute} (anyone; the router calls it after every trade) runs:
///           - auto-burn: buys the coin with the auto-burn share and burns it;
///           - dip buyback: when the pool's 30-minute average price is 20% under
///             its high since the last buyback, half the fund buys the coin and
///             burns it, and the high resets to that price;
///           - take profit: when the vault is worth its target more than it
///             paid (USD, from the oracle), the gain buys the coin and burns it;
///           - auto-LP: once the auto-LP share is worth the threshold, half of it
///             buys the coin and both go into the pool as full-range liquidity
///             owned by this contract, which has no function to remove it.
///         Every buy here is capped at ~3% above the 30-minute average price,
///         so a pumped pool can't make the strategy overpay; the rest waits.
///
///         Creator share: vests linearly over the chosen period (or none).
///         Nothing here is owned or settable.
contract BackstopStrategy is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    uint16 public constant PLATFORM_BPS = 100;
    uint32 public constant TWAP_WINDOW = 1800;
    /// @dev 20% under the high: ln(0.8) / ln(1.0001).
    int24 public constant DIP_TICKS = 2231;
    /// @dev Buys stop ~3% above the 30-minute average.
    int24 public constant MAX_PREMIUM_TICKS = 300;
    int24 internal constant TICK_SPACING = 60;

    address public immutable factory;
    IStrategyHook public immutable hook;
    IPoolManager public immutable poolManager;
    IStrategyOracle public immutable oracle;
    address public immutable token;
    address public immutable pair;
    address public immutable creator;
    bool public immutable tokenIsCurrency0;
    uint256 public immutable launchTime;

    uint16 public immutable taxBps;
    uint16 public immutable creatorBps;
    uint16 public immutable holderBps;
    uint16 public immutable vaultBps;
    uint16 public immutable buybackBps;
    uint16 public immutable lpBps;
    uint16 public immutable burnBps;
    /// @notice Take-profit target, bps over cost (0 = off).
    uint16 public immutable tpBps;
    bool public immutable redeemable;
    uint32 public immutable vestSecs;

    /// @notice Backing token held here, by bucket.
    uint256 public vault;
    uint256 public fund;
    uint256 public lpPending;
    uint256 public burnPending;
    uint256 public platformOwed;
    uint256 public creatorEarned;
    uint256 public creatorClaimed;
    /// @dev Sum of the buckets; anything above it is new tax.
    uint256 public reserved;
    /// @dev Platform cut reported by the hook and not yet split out.
    uint256 internal _platPending;

    /// @notice What the vault paid, USD 18 dp (for take-profit); vault added since the last pricing.
    uint256 public costUsd;
    uint256 public vaultUncosted;

    /// @notice Dip buyback: highest 30-minute average coin tick since the last buyback.
    int24 public high;
    bool public highSet;

    uint256 public totalBurned;
    uint256 public totalLpAdded;
    uint256 public totalHolderPaid;

    event Split(uint256 amount, uint256 platform, uint256 creator, uint256 holders, uint256 vault, uint256 buyback, uint256 lp, uint256 burn);
    event Burned(uint8 indexed kind, uint256 pairSpent, uint256 coinsBurned); // 1 auto-burn, 2 dip buyback, 3 take profit
    event LiquidityAdded(uint256 pairIn, uint256 coinIn, uint128 liquidity);
    event Redeemed(address indexed holder, uint256 coinsBurned, uint256 pairOut);
    event CreatorPaid(uint256 amount);
    event PlatformPaid(address indexed to, uint256 amount);

    error InvalidParams();
    error NotRedeemable();
    error Slippage();
    error NotPoolManager();

    struct Init {
        address factory;
        address hook;
        address poolManager;
        address oracle;
        address token;
        address pair;
        address creator;
        uint16 taxBps;
        uint16 creatorBps;
        uint16 holderBps;
        uint16 vaultBps;
        uint16 buybackBps;
        uint16 lpBps;
        uint16 burnBps;
        uint16 tpBps;
        bool redeemable;
        uint32 vestSecs;
    }

    constructor(Init memory p) {
        uint256 sum = uint256(PLATFORM_BPS) + p.creatorBps + p.holderBps + p.vaultBps + p.buybackBps + p.lpBps + p.burnBps;
        if (sum != p.taxBps) revert InvalidParams();
        if ((p.tpBps != 0 || p.redeemable) && p.vaultBps == 0) revert InvalidParams();
        factory = p.factory;
        hook = IStrategyHook(p.hook);
        poolManager = IPoolManager(p.poolManager);
        oracle = IStrategyOracle(p.oracle);
        token = p.token;
        pair = p.pair;
        creator = p.creator;
        tokenIsCurrency0 = p.token < p.pair;
        launchTime = block.timestamp;
        taxBps = p.taxBps;
        creatorBps = p.creatorBps;
        holderBps = p.holderBps;
        vaultBps = p.vaultBps;
        buybackBps = p.buybackBps;
        lpBps = p.lpBps;
        burnBps = p.burnBps;
        tpBps = p.tpBps;
        redeemable = p.redeemable;
        vestSecs = p.vestSecs;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function poolKey() public view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : pair),
            currency1: Currency.wrap(tokenIsCurrency0 ? pair : token),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    function poolId() public view returns (PoolId) {
        return poolKey().toId();
    }

    /// @notice Backing token per 1e18 coins: vault / total supply.
    function backingPerCoin() external view returns (uint256) {
        return Math.mulDiv(vault, 1e18, IStrategyCoin(token).totalSupply());
    }

    function creatorClaimable() public view returns (uint256) {
        uint256 vested = creatorEarned;
        if (vestSecs != 0) {
            uint256 el = block.timestamp - launchTime;
            if (el < vestSecs) vested = Math.mulDiv(creatorEarned, el, vestSecs);
        }
        return vested > creatorClaimed ? vested - creatorClaimed : 0;
    }

    /// @notice Coin price at the pool's 30-minute average, as a coin tick (pair per coin), and whether one exists yet.
    function coinTwap() public view returns (bool ok, int24 tick) {
        int24 raw;
        (ok, raw) = hook.twapTick(poolId(), TWAP_WINDOW);
        tick = _coinTick(raw);
    }

    /// @notice Dip trigger as a coin tick, and whether the buyback is armed.
    function dipLine() external view returns (bool armed, int24 line) {
        return (highSet && buybackBps != 0, high - DIP_TICKS);
    }

    // ---------------------------------------------------------------------
    // Split
    // ---------------------------------------------------------------------

    /// @notice Split every backing token that arrived since the last sync. Anyone.
    function sync() external nonReentrant {
        _sync();
    }

    /// @notice Tax arrived from the hook; `platformCut` of it is the platform's 1%.
    function onTax(uint256 platformCut) external nonReentrant {
        if (msg.sender != address(hook)) revert InvalidParams();
        _platPending += platformCut;
        _sync();
    }

    function _flush() internal {
        try hook.flush(token) returns (uint256, uint256 plat) { _platPending += plat; } catch {}
    }

    function _sync() internal {
        uint256 bal = IERC20(pair).balanceOf(address(this));
        uint256 res = reserved;
        if (bal <= res) return;
        uint256 amt = bal - res;
        uint256 plat = _platPending;
        if (plat > amt) plat = amt;
        _platPending -= plat;
        uint256 t = taxBps - PLATFORM_BPS; // the creator's weights add up to this
        if (t == 0) plat = amt; // a 1% tax is all platform
        uint256 rest = amt - plat;
        if (t == 0) t = 1;
        uint256 cr = (rest * creatorBps) / t;
        uint256 ho = (rest * holderBps) / t;
        uint256 va = (rest * vaultBps) / t;
        uint256 bb = (rest * buybackBps) / t;
        uint256 lp = (rest * lpBps) / t;
        uint256 bu = (rest * burnBps) / t;
        cr += rest - cr - ho - va - bb - lp - bu; // rounding dust

        if (ho != 0) {
            if (IStrategyCoin(token).eligibleSupply() == 0) {
                cr += ho;
                ho = 0;
            } else {
                IERC20(pair).forceApprove(token, ho);
                try IStrategyCoin(token).fund(ho) {
                    totalHolderPaid += ho;
                } catch {
                    cr += ho;
                    ho = 0;
                }
            }
        }
        platformOwed += plat;
        creatorEarned += cr;
        vault += va;
        if (tpBps != 0) vaultUncosted += va;
        fund += bb;
        lpPending += lp;
        burnPending += bu;
        reserved = res + amt - ho;
        emit Split(amt, plat, cr, ho, va, bb, lp, bu);
    }

    // ---------------------------------------------------------------------
    // Execute
    // ---------------------------------------------------------------------

    /// @notice Run whatever the strategy has due: auto-burn, dip buyback,
    ///         take-profit and auto-LP. Anyone; never needs to be called more
    ///         than once a block.
    function execute() external nonReentrant {
        _flush();
        _sync();

        (bool ok, int24 avg) = coinTwap();
        (, int24 rawSpot,,) = poolManager.getSlot0(poolId());
        int24 spot = _coinTick(rawSpot);
        int24 ref = ok ? avg : spot;
        int24 cap = ref + MAX_PREMIUM_TICKS;

        uint256 px;
        if (tpBps != 0 && vaultUncosted != 0) {
            px = _px();
            if (px != 0) {
                costUsd += Math.mulDiv(vaultUncosted, px, 1e18);
                vaultUncosted = 0;
            }
        }

        // auto-burn
        if (burnPending != 0 && spot < cap) {
            uint256 spent = _buyBurn(burnPending, cap, 1);
            burnPending -= spent;
        }

        // dip buyback, on the 30-minute average only
        if (ok && buybackBps != 0) {
            if (!highSet || avg > high) {
                high = avg;
                highSet = true;
            } else if (avg <= high - DIP_TICKS && fund != 0) {
                uint256 spent = _buyBurn(fund / 2, cap, 2);
                fund -= spent;
                high = avg;
            }
        }

        // take profit
        if (tpBps != 0 && vault != 0 && costUsd != 0 && vaultUncosted == 0 && oracle.settled(pair)) {
            if (px == 0) px = _px();
            if (px != 0) {
                uint256 value = Math.mulDiv(vault, px, 1e18);
                if (value * 10_000 >= costUsd * (10_000 + uint256(tpBps))) {
                    uint256 gainAmt = Math.mulDiv(vault, value - costUsd, value);
                    uint256 spent = _buyBurn(gainAmt, cap, 3);
                    vault -= spent;
                }
            }
        }

        // auto-LP, only near the average price
        if (lpPending != 0 && spot < cap && spot > ref - MAX_PREMIUM_TICKS) {
            if (px == 0) px = _px();
            if (px != 0 && Math.mulDiv(lpPending, px, 1e18) >= IStrategyFactory(factory).lpThresholdUsd()) _addLiquidity(cap);
        }
    }

    function _px() internal returns (uint256 px) {
        try oracle.poke(pair) returns (uint256 p) { px = p; } catch {}
    }

    function _coinTick(int24 raw) internal view returns (int24) {
        return tokenIsCurrency0 ? raw : -raw;
    }

    /// @dev Buy the coin with up to `amount` of the backing token, never above
    ///      coin tick `cap`, and burn it. Returns the backing token spent.
    function _buyBurn(uint256 amount, int24 cap, uint8 kind) internal returns (uint256 spent) {
        if (amount == 0) return 0;
        bytes memory res = poolManager.unlock(abi.encode(uint8(1), amount, cap));
        uint256 out;
        (spent, out) = abi.decode(res, (uint256, uint256));
        if (out != 0) {
            IStrategyCoin(token).burn(out);
            totalBurned += out;
        }
        reserved -= spent;
        emit Burned(kind, spent, out);
    }

    function _addLiquidity(int24 cap) internal {
        uint256 amount = lpPending;
        bytes memory res = poolManager.unlock(abi.encode(uint8(2), amount, cap));
        (uint256 pairUsed, uint256 coinUsed, uint256 coinLeft, uint128 liq) = abi.decode(res, (uint256, uint256, uint256, uint128));
        if (coinLeft != 0) {
            IStrategyCoin(token).burn(coinLeft);
            totalBurned += coinLeft;
        }
        lpPending -= pairUsed;
        reserved -= pairUsed;
        totalLpAdded += pairUsed;
        emit LiquidityAdded(pairUsed, coinUsed, liq);
    }

    // ---------------------------------------------------------------------
    // PoolManager callback: 1 buy, 2 add liquidity
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 action, uint256 amount, int24 cap) = abi.decode(data, (uint8, uint256, int24));
        PoolKey memory key = poolKey();
        if (action == 1) {
            (uint256 spent, uint256 out) = _swapBuy(key, amount, cap);
            _settle(key.currency0);
            _settle(key.currency1);
            return abi.encode(spent, out);
        }
        // add liquidity: buy with half, then pair the coins with the other half
        (uint256 spentHalf, uint256 coinOut) = _swapBuy(key, amount / 2, cap);
        uint256 pairLeft = amount - spentHalf;
        (uint160 sp,,,) = poolManager.getSlot0(key.toId());
        int24 lo = (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING;
        int24 hi = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        (uint256 a0, uint256 a1) = tokenIsCurrency0 ? (coinOut, pairLeft) : (pairLeft, coinOut);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(sp, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), a0, a1);
        if (liq != 0) {
            poolManager.modifyLiquidity(key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(uint256(liq)), salt: bytes32(0)}), "");
        }
        int256 dPair = poolManager.currencyDelta(address(this), Currency.wrap(pair));
        int256 dCoin = poolManager.currencyDelta(address(this), Currency.wrap(token));
        _settle(key.currency0);
        _settle(key.currency1);
        uint256 pairUsed = dPair < 0 ? uint256(-dPair) : 0;
        uint256 coinLeft = dCoin > 0 ? uint256(dCoin) : 0;
        return abi.encode(pairUsed, coinOut - coinLeft, coinLeft, liq);
    }

    /// @dev Exact-input buy of the coin, stopping at coin tick `cap`. Leaves deltas open.
    function _swapBuy(PoolKey memory key, uint256 amount, int24 cap) internal returns (uint256 spent, uint256 out) {
        if (amount == 0) return (0, 0);
        bool zeroForOne = !tokenIsCurrency0; // pay the pair
        int24 rawCap = tokenIsCurrency0 ? cap : -cap;
        if (rawCap > TickMath.MAX_TICK - 1) rawCap = TickMath.MAX_TICK - 1;
        if (rawCap < TickMath.MIN_TICK + 1) rawCap = TickMath.MIN_TICK + 1;
        uint160 limit = TickMath.getSqrtPriceAtTick(rawCap);
        (uint160 sp,,,) = poolManager.getSlot0(key.toId());
        if (zeroForOne ? limit >= sp : limit <= sp) return (0, 0);
        BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amount), sqrtPriceLimitX96: limit}), "");
        int128 dp = tokenIsCurrency0 ? d.amount1() : d.amount0();
        int128 dc = tokenIsCurrency0 ? d.amount0() : d.amount1();
        spent = dp < 0 ? uint256(uint128(-dp)) : 0;
        out = dc > 0 ? uint256(uint128(dc)) : 0;
    }

    /// @dev Close this contract's open delta in `c`: pay what it owes, take what it is owed.
    function _settle(Currency c) internal {
        int256 d = poolManager.currencyDelta(address(this), c);
        if (d < 0) {
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(poolManager), uint256(-d));
            poolManager.settle();
        } else if (d > 0) {
            poolManager.take(c, address(this), uint256(d));
        }
    }

    // ---------------------------------------------------------------------
    // Holders, creator, platform
    // ---------------------------------------------------------------------

    /// @notice Burn `amount` coins (approved to this contract) for their share
    ///         of the vault: vault x amount / total supply, sent to `to`.
    function redeem(uint256 amount, uint256 minOut, address to) external nonReentrant returns (uint256 out) {
        if (!redeemable) revert NotRedeemable();
        if (amount == 0 || to == address(0)) revert InvalidParams();
        _flush();
        _sync();
        uint256 v = vault;
        out = Math.mulDiv(v, amount, IStrategyCoin(token).totalSupply());
        if (out < minOut || out == 0) revert Slippage();
        IStrategyCoin(token).transferFrom(msg.sender, address(this), amount);
        IStrategyCoin(token).burn(amount);
        totalBurned += amount;
        if (costUsd != 0) costUsd -= Math.mulDiv(costUsd, out, v);
        if (vaultUncosted != 0) vaultUncosted -= Math.mulDiv(vaultUncosted, out, v);
        vault = v - out;
        reserved -= out;
        IERC20(pair).safeTransfer(to, out);
        emit Redeemed(msg.sender, amount, out);
    }

    /// @notice Push the creator's vested share to the creator. Anyone.
    function payCreator() external nonReentrant returns (uint256 amount) {
        _flush();
        _sync();
        amount = creatorClaimable();
        if (amount == 0) return 0;
        creatorClaimed += amount;
        reserved -= amount;
        IERC20(pair).safeTransfer(creator, amount);
        emit CreatorPaid(amount);
    }

    /// @notice Push the platform share to the factory's fee recipient. Anyone.
    function payPlatform() external nonReentrant returns (uint256 amount) {
        _flush();
        _sync();
        amount = platformOwed;
        if (amount == 0) return 0;
        platformOwed = 0;
        reserved -= amount;
        address to = IStrategyFactory(factory).feeRecipient();
        IERC20(pair).safeTransfer(to, amount);
        emit PlatformPaid(to, amount);
    }
}
