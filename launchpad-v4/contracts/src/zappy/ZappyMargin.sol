// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PositionInfo, PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";

import {BuzzPadFactory} from "../buzzpad/BuzzPadFactory.sol";
import {BuzzPadHook} from "../buzzpad/BuzzPadHook.sol";
import {ZappyLocker} from "./ZappyLocker.sol";
import {ZappySwapper} from "./ZappySwapper.sol";

/**
 * @title ZappyMargin
 * @notice Leveraged longs on every Zappy coin, ETH-paired or stock-paired,
 * funded by the coin's own pool: the ZappyLocker lends part of the pair in the
 * coin's passed bands. No vault and no outside lender.
 *
 * The trader always pays ETH. For a stock-paired coin the ZappySwapper turns
 * the ETH margin into the stock first; the position then lives in the pair:
 * debt, value and health are all counted in it, so only the coin's price
 * against its pair moves them. The rest of the size is borrowed from the
 * coin's pool, the whole amount buys the coin, and the coins stay here as
 * collateral. Closing sells them, repays the pool and sends the rest to the
 * trader in ETH (the stock swapped back).
 *
 * There is no running interest: a meme position lives minutes or hours. A
 * one-time borrow fee (borrowFeeBps of the borrowed pair) is taken from the
 * margin at open; it and liquidation penalties go back into the coin's pool.
 *
 * Health compares the debt with what the coins are worth at the pool's spot
 * price, less the pool's base sell fee and creator tax (the temporary
 * volatility surcharge is left out). Past (100% - maintenanceBps) of that
 * value anyone may flag the position; if it is still past it
 * liquidationDelay seconds later, anyone may liquidate it. A liquidation
 * sells the coins, pays the caller keeperRewardBps of the proceeds, repays
 * the pool with up to liquidationFeeBps more, and returns any rest to the
 * trader, all in the pair. A loan the sale cannot cover is a loss to that
 * coin's pool.
 */
contract ZappyMargin is Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PositionInfoLibrary for PositionInfo;

    struct Position {
        address owner;
        address token;
        address pair; // address(0) = ETH
        uint256 tokens; // coins held as collateral
        uint256 principal; // pair owed to the pool
        uint256 margin; // pair the trader put in, open plus top-ups
        uint40 openedAt;
        uint40 flaggedAt;
        uint32 leverageBps;
    }

    uint256 private constant BPS = 10_000;
    uint256 private constant MAX_LEVERAGE_CEILING_BPS = 50_000; // 5x, the hard ceiling
    uint256 private constant MIN_MAINTENANCE_BPS = 500;
    uint256 private constant MAX_KEEPER_REWARD_BPS = 300;
    uint256 private constant MAX_LIQUIDATION_FEE_BPS = 1_000;
    uint256 private constant MAX_BORROW_FEE_BPS = 300;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    error NotPoolManager();
    error UnknownCoin();
    error NoPairRoute();
    error OpensDisabled();
    error CoinTooNew(uint256 opensAt);
    error PoolTooThin(uint256 depth, uint256 minimum);
    error InvalidLeverage();
    error MarginTooSmall(uint256 minimum);
    error NotEnoughToBorrow(uint256 available);
    error PositionTooLarge(uint256 maximum);
    error Slippage(uint256 got, uint256 minimum);
    error OpensUnhealthy();
    error NotOwner();
    error NoPosition();
    error Healthy();
    error NotFlagged();
    error DelayNotElapsed(uint256 at);
    error Underwater(uint256 proceeds, uint256 debt);
    error InvalidParam();
    error TransferFailed();
    error OwnershipCannotBeRenounced();

    event PositionOpened(
        uint256 indexed id, address indexed owner, address indexed token, uint256 margin, uint256 borrowed, uint256 tokens, uint256 leverageBps
    );
    event PositionClosed(uint256 indexed id, address indexed owner, uint256 proceeds, uint256 debtPaid, uint256 toOwner);
    event MarginAdded(uint256 indexed id, uint256 amount, uint256 debtPaid);
    event PositionFlagged(uint256 indexed id, address indexed by, uint256 debt, uint256 value);
    event FlagCleared(uint256 indexed id);
    event PositionLiquidated(
        uint256 indexed id, address indexed keeper, uint256 proceeds, uint256 debt, uint256 reward, uint256 penalty, uint256 shortfall, uint256 toOwner
    );
    event Credited(address indexed to, address indexed pair, uint256 amount);
    event Claimed(address indexed to, address indexed pair, uint256 amount);
    event ParamsUpdated();
    event OpensEnabled(bool enabled);

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    BuzzPadFactory public immutable factory;
    BuzzPadHook public immutable hook;
    ZappyLocker public immutable locker;
    ZappySwapper public immutable swapper;

    bool public opensEnabled;
    uint256 public maxLeverageBps = 30_000; // 3x
    uint256 public maintenanceBps = 1_000; // liquidatable when equity < 10% of value
    uint256 public initialBps = 2_000; // a new position needs equity >= 20% of value
    uint256 public liquidationDelay = 15; // seconds a flag must stand
    uint256 public keeperRewardBps = 100; // of liquidation proceeds, to the caller
    uint256 public liquidationFeeBps = 300; // of liquidation proceeds, back to the coin's pool
    uint256 public borrowFeeBps = 30; // one-time, 0.3% of the borrowed pair at open, paid to the coin's pool; no running interest
    uint256 public minMargin = 0.001 ether; // ETH
    uint256 public minCoinAge = 10 minutes;
    uint256 public positionCapBps = 300; // one position's size <= 3% of the pair in its pool
    uint256 public minPoolDepth = 5 ether; // ETH pairs; a stock pair's minimum is its swapper route's

    uint256 public nextId = 1;
    mapping(uint256 => Position) public positions;
    mapping(address owner => uint256[]) private _ownerIds;
    // what a liquidation owed a trader whose address refused it, per pair (address(0) = ETH); claimed with claim(pair)
    mapping(address owner => mapping(address pair => uint256)) public claimable;

    constructor(address initialOwner, BuzzPadFactory factory_, ZappySwapper swapper_) Ownable(initialOwner) {
        factory = factory_;
        swapper = swapper_;
        poolManager = factory_.poolManager();
        positionManager = factory_.positionManager();
        hook = factory_.hook();
        locker = ZappyLocker(payable(address(factory_.locker())));
    }

    receive() external payable {
        if (msg.sender != address(poolManager) && msg.sender != address(locker) && msg.sender != address(swapper)) revert TransferFailed();
    }

    // ------------------------------------------------------------------ views

    function positionsOf(address owner) external view returns (uint256[] memory) {
        return _ownerIds[owner];
    }

    /// @notice The pair in the coin's locked positions at the current price, plus its idle pair in the locker.
    function poolDepth(address token) public view returns (uint256 depth) {
        PoolKey memory key = factory.poolKeyOf(token);
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        uint256[3] memory ids = locker.positionsOf(token);
        for (uint256 i; i < 3; ++i) {
            (, PositionInfo info) = positionManager.getPoolAndPositionInfo(ids[i]);
            uint128 liq = positionManager.getPositionLiquidity(ids[i]);
            uint160 lo = TickMath.getSqrtPriceAtTick(info.tickLower());
            uint160 hi = TickMath.getSqrtPriceAtTick(info.tickUpper());
            // the pair (currency0) a position holds: all of its range above the price, none below it
            if (sqrtP < hi) depth += SqrtPriceMath.getAmount0Delta(sqrtP > lo ? sqrtP : lo, hi, liq, false);
        }
        depth += locker.idle(token);
    }

    /// @notice The pool depth, in the pair, a coin needs before it can be levered.
    function minDepthOf(address pair) public view returns (uint256) {
        return pair == address(0) ? minPoolDepth : swapper.minDepth(pair);
    }

    /// @notice The pair `tokens` of `token` are worth at the spot price, less the pool's base sell fee and creator tax.
    function valueOf(address token, uint256 tokens) public view returns (uint256) {
        PoolId id = factory.poolKeyOf(token).toId();
        (uint160 sqrtP,,,) = poolManager.getSlot0(id);
        // price = token1 per token0 = sqrtP^2 / 2^192, so pair = tokens * 2^192 / sqrtP^2
        uint256 v = FullMath.mulDiv(FullMath.mulDiv(tokens, 1 << 96, sqrtP), 1 << 96, sqrtP);
        (uint256 base,,, uint256 tax) = hook.feeNow(id);
        uint256 fee = base + tax;
        return fee >= BPS ? 0 : (v * (BPS - fee)) / BPS;
    }

    function debtOf(uint256 id) public view returns (uint256) {
        return positions[id].principal;
    }

    /// @return debt pair owed, value what the coins fetch at spot (in the pair), liquidatable whether it is past maintenance
    function health(uint256 id) public view returns (uint256 debt, uint256 value, bool liquidatable) {
        Position memory p = positions[id];
        if (p.owner == address(0)) revert NoPosition();
        debt = p.principal;
        value = valueOf(p.token, p.tokens);
        liquidatable = debt * BPS > value * (BPS - maintenanceBps);
    }

    /// @notice The price (pair per whole coin, 1e18) at which the position becomes liquidatable.
    function liquidationPrice(uint256 id) external view returns (uint256) {
        Position memory p = positions[id];
        if (p.owner == address(0) || p.tokens == 0) return 0;
        (uint256 base,,, uint256 tax) = hook.feeNow(factory.poolKeyOf(p.token).toId());
        uint256 keep = (BPS - maintenanceBps) * (BPS - Math.min(BPS - 1, base + tax));
        return Math.mulDiv(p.principal * 1e18, BPS * BPS, keep * p.tokens);
    }

    /// @notice The most margin (in the pair) one more position on `token` at `leverageBps` can take now.
    function maxMargin(address token, uint256 leverageBps) external view returns (uint256) {
        if (leverageBps <= BPS || leverageBps > maxLeverageBps) return 0;
        address pair = factory.getLaunchedToken(token).pairToken;
        if (pair != address(0) && !swapper.hasRoute(pair)) return 0;
        uint256 depth = poolDepth(token);
        if (depth < minDepthOf(pair)) return 0;
        uint256 byRoom = (locker.lendable(token) * BPS) / (leverageBps - BPS);
        uint256 bySize = (depth * positionCapBps) / leverageBps;
        return Math.min(byRoom, bySize);
    }

    // ----------------------------------------------------------------- trader

    /**
     * @notice Opens a long on `token` with `msg.value` ETH as margin at
     * `leverageBps` (e.g. 30000 = 3x). For a stock-paired coin the ETH is
     * swapped into the stock first, at least `minPairIn`. `minTokens` bounds the buy.
     */
    function open(address token, uint256 leverageBps, uint256 minTokens, uint256 minPairIn) external payable nonReentrant returns (uint256 id) {
        if (!opensEnabled) revert OpensDisabled();
        if (leverageBps <= BPS || leverageBps > maxLeverageBps) revert InvalidLeverage();
        if (msg.value < minMargin) revert MarginTooSmall(minMargin);
        BuzzPadFactory.LaunchedToken memory rec = factory.getLaunchedToken(token);
        if (!rec.exists) revert UnknownCoin();
        address pair = rec.pairToken;
        if (pair != address(0) && !swapper.hasRoute(pair)) revert NoPairRoute();
        if (block.timestamp < uint256(rec.launchedAt) + minCoinAge) revert CoinTooNew(uint256(rec.launchedAt) + minCoinAge);

        uint256 marginPair = pair == address(0) ? msg.value : swapper.ethToPair{value: msg.value}(pair, minPairIn);
        uint256 borrowed = (marginPair * (leverageBps - BPS)) / BPS;
        uint256 size = marginPair + borrowed;
        uint256 depth = poolDepth(token);
        if (depth < minDepthOf(pair)) revert PoolTooThin(depth, minDepthOf(pair));
        uint256 posCap = (depth * positionCapBps) / BPS;
        if (size > posCap) revert PositionTooLarge(posCap);
        uint256 room = locker.lendable(token);
        if (borrowed > room) revert NotEnoughToBorrow(room);

        locker.lend(token, borrowed);
        // the one-time borrow fee comes out of the margin and goes straight back into the coin's pool
        uint256 fee = (borrowed * borrowFeeBps) / BPS;
        if (fee != 0) _payLocker(token, pair, 0, fee);
        uint256 tokens = _swap(factory.poolKeyOf(token), true, size - fee);
        if (tokens < minTokens) revert Slippage(tokens, minTokens);

        id = nextId++;
        positions[id] = Position({
            owner: msg.sender,
            token: token,
            pair: pair,
            tokens: tokens,
            principal: borrowed,
            margin: marginPair,
            openedAt: uint40(block.timestamp),
            flaggedAt: 0,
            leverageBps: uint32(leverageBps)
        });
        _ownerIds[msg.sender].push(id);
        (uint256 debt, uint256 value,) = health(id);
        if (debt * BPS > value * (BPS - initialBps)) revert OpensUnhealthy();
        emit PositionOpened(id, msg.sender, token, marginPair, borrowed, tokens, leverageBps);
    }

    /// @notice Sells the position, repays the pool and sends the rest to the owner in ETH. `minOut` bounds that ETH.
    function close(uint256 id, uint256 minOut) external nonReentrant returns (uint256 toOwner) {
        Position memory p = positions[id];
        if (p.owner == address(0)) revert NoPosition();
        if (p.owner != msg.sender) revert NotOwner();
        uint256 proceeds = _swap(factory.poolKeyOf(p.token), false, p.tokens);
        uint256 debt = p.principal;
        if (proceeds < debt) revert Underwater(proceeds, debt);
        delete positions[id];
        _payLocker(p.token, p.pair, p.principal, debt);
        uint256 rest = proceeds - debt;
        if (p.pair == address(0)) {
            toOwner = rest;
            if (toOwner < minOut) revert Slippage(toOwner, minOut);
            _send(p.owner, toOwner);
        } else {
            if (rest != 0) {
                IERC20(p.pair).forceApprove(address(swapper), rest);
                toOwner = swapper.pairToEth(p.pair, rest, minOut, p.owner);
            }
        }
        emit PositionClosed(id, p.owner, proceeds, debt, toOwner);
    }

    /**
     * @notice Pays down the position's debt with `msg.value` ETH (swapped into
     * the stock first for a stock-paired coin, at least `minPairIn`); anything
     * beyond the debt is returned in the pair.
     */
    function addMargin(uint256 id, uint256 minPairIn) external payable nonReentrant {
        Position storage p = positions[id];
        if (p.owner == address(0)) revert NoPosition();
        if (msg.value == 0) revert InvalidParam();
        address pair = p.pair;
        uint256 amount = pair == address(0) ? msg.value : swapper.ethToPair{value: msg.value}(pair, minPairIn);
        uint256 pay = Math.min(amount, p.principal);
        p.principal -= pay;
        p.margin += pay;
        address token = p.token;
        if (p.flaggedAt != 0) {
            (,, bool liq) = health(id);
            if (!liq) {
                p.flaggedAt = 0;
                emit FlagCleared(id);
            }
        }
        _payLocker(token, pair, pay, pay);
        if (amount > pay) _sendPair(pair, msg.sender, amount - pay);
        emit MarginAdded(id, amount, pay);
    }

    /// @notice What a liquidation owed you and could not send, in `pair` (address(0) = ETH).
    function claim(address pair) external nonReentrant {
        uint256 a = claimable[msg.sender][pair];
        claimable[msg.sender][pair] = 0;
        _sendPair(pair, msg.sender, a);
        emit Claimed(msg.sender, pair, a);
    }

    // ------------------------------------------------------------- liquidation

    /// @notice Marks a position past maintenance, or clears a flag on a position that is healthy again.
    function flag(uint256 id) external {
        Position storage p = positions[id];
        (uint256 debt, uint256 value, bool liq) = health(id);
        if (!liq) {
            if (p.flaggedAt == 0) revert Healthy();
            p.flaggedAt = 0;
            emit FlagCleared(id);
            return;
        }
        if (p.flaggedAt == 0) {
            p.flaggedAt = uint40(block.timestamp);
            emit PositionFlagged(id, msg.sender, debt, value);
        }
    }

    /// @notice Liquidates a position flagged at least liquidationDelay ago and still past maintenance. Paid out in the pair.
    function liquidate(uint256 id) external nonReentrant {
        Position memory p = positions[id];
        if (p.owner == address(0)) revert NoPosition();
        if (p.flaggedAt == 0) revert NotFlagged();
        if (block.timestamp < uint256(p.flaggedAt) + liquidationDelay) revert DelayNotElapsed(uint256(p.flaggedAt) + liquidationDelay);
        (,, bool liq) = health(id);
        if (!liq) revert Healthy();
        delete positions[id];

        uint256 proceeds = _swap(factory.poolKeyOf(p.token), false, p.tokens);
        // coins the pool could not take are burned rather than left here
        if (proceeds == 0) IERC20(p.token).safeTransfer(DEAD, p.tokens);
        uint256 debt = p.principal;
        uint256 reward = (proceeds * keeperRewardBps) / BPS;
        uint256 rest = proceeds - reward;
        uint256 penalty;
        uint256 shortfall;
        uint256 toOwner;
        if (rest >= debt) {
            penalty = Math.min(rest - debt, (proceeds * liquidationFeeBps) / BPS);
            toOwner = rest - debt - penalty;
            _payLocker(p.token, p.pair, p.principal, debt + penalty);
        } else {
            shortfall = debt - rest;
            _payLocker(p.token, p.pair, p.principal, rest);
        }
        _sendPair(p.pair, msg.sender, reward);
        // a trader's address must not be able to block its own liquidation by refusing the payout
        if (toOwner != 0 && !_trySendPair(p.pair, p.owner, toOwner)) {
            claimable[p.owner][p.pair] += toOwner;
            emit Credited(p.owner, p.pair, toOwner);
        }
        emit PositionLiquidated(id, msg.sender, proceeds, debt, reward, penalty, shortfall, toOwner);
    }

    // ------------------------------------------------------------------ owner

    function setOpensEnabled(bool enabled) external onlyOwner {
        opensEnabled = enabled;
        emit OpensEnabled(enabled);
    }

    function setRiskParams(
        uint256 maxLeverageBps_,
        uint256 maintenanceBps_,
        uint256 initialBps_,
        uint256 liquidationDelay_,
        uint256 positionCapBps_,
        uint256 minPoolDepth_,
        uint256 minCoinAge_,
        uint256 minMargin_
    ) external onlyOwner {
        if (maxLeverageBps_ <= BPS || maxLeverageBps_ > MAX_LEVERAGE_CEILING_BPS) revert InvalidParam();
        if (maintenanceBps_ < MIN_MAINTENANCE_BPS || initialBps_ <= maintenanceBps_ || initialBps_ >= 5_000) revert InvalidParam();
        if (liquidationDelay_ == 0 || liquidationDelay_ > 10 minutes) revert InvalidParam();
        if (positionCapBps_ == 0 || positionCapBps_ > 2_000) revert InvalidParam();
        if (minPoolDepth_ < 0.1 ether || minCoinAge_ > 7 days) revert InvalidParam();
        maxLeverageBps = maxLeverageBps_;
        maintenanceBps = maintenanceBps_;
        initialBps = initialBps_;
        liquidationDelay = liquidationDelay_;
        positionCapBps = positionCapBps_;
        minPoolDepth = minPoolDepth_;
        minCoinAge = minCoinAge_;
        minMargin = minMargin_;
        emit ParamsUpdated();
    }

    /// @notice The keeper reward, the liquidation penalty and the one-time borrow fee (for positions opened from now on).
    function setFees(uint256 keeperRewardBps_, uint256 liquidationFeeBps_, uint256 borrowFeeBps_) external onlyOwner {
        if (keeperRewardBps_ > MAX_KEEPER_REWARD_BPS || liquidationFeeBps_ > MAX_LIQUIDATION_FEE_BPS || borrowFeeBps_ > MAX_BORROW_FEE_BPS) {
            revert InvalidParam();
        }
        keeperRewardBps = keeperRewardBps_;
        liquidationFeeBps = liquidationFeeBps_;
        borrowFeeBps = borrowFeeBps_;
        emit ParamsUpdated();
    }

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    // --------------------------------------------------------------- internal

    /// @dev Hands `amount` of the pair to the locker for a loan of `principal`: ETH with the call, an ERC-20 transferred first.
    function _payLocker(address token, address pair, uint256 principal, uint256 amount) private {
        if (pair == address(0)) {
            locker.repay{value: amount}(token, principal, amount);
        } else {
            if (amount != 0) IERC20(pair).safeTransfer(address(locker), amount);
            locker.repay(token, principal, amount);
        }
    }

    function _sendPair(address pair, address to, uint256 amount) private {
        if (amount == 0) return;
        if (pair == address(0)) _send(to, amount);
        else IERC20(pair).safeTransfer(to, amount);
    }

    function _trySendPair(address pair, address to, uint256 amount) private returns (bool ok) {
        if (pair == address(0)) {
            (ok,) = to.call{value: amount, gas: 50_000}("");
        } else {
            bytes memory ret;
            (ok, ret) = pair.call(abi.encodeCall(IERC20.transfer, (to, amount)));
            ok = ok && (ret.length == 0 || abi.decode(ret, (bool)));
        }
    }

    /// @dev Exact-input swap on the coin's pool through PoolManager.unlock. Buy: pair in, coins to here. Sell: coins in, pair to here.
    function _swap(PoolKey memory key, bool buy, uint256 amountIn) private returns (uint256 out) {
        if (!buy) {
            // the price already sits at the top of the range: nobody is left to buy, the coins fetch nothing
            (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
            if (sqrtP >= TickMath.MAX_SQRT_PRICE - 1) return 0;
        }
        out = abi.decode(poolManager.unlock(abi.encode(key, buy, amountIn)), (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolKey memory key, bool buy, uint256 amountIn) = abi.decode(data, (PoolKey, bool, uint256));
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: buy,
                amountSpecified: -SafeCast.toInt256(amountIn),
                sqrtPriceLimitX96: buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        uint256 out;
        if (buy) {
            uint256 owed = uint256(uint128(-delta.amount0()));
            out = uint256(uint128(delta.amount1()));
            if (key.currency0.isAddressZero()) {
                poolManager.settle{value: owed}();
            } else {
                poolManager.sync(key.currency0);
                IERC20(Currency.unwrap(key.currency0)).safeTransfer(address(poolManager), owed);
                poolManager.settle();
            }
            poolManager.take(key.currency1, address(this), out);
        } else {
            uint256 owed = uint256(uint128(-delta.amount1()));
            out = uint256(uint128(delta.amount0()));
            poolManager.sync(key.currency1);
            IERC20(Currency.unwrap(key.currency1)).safeTransfer(address(poolManager), owed);
            poolManager.settle();
            poolManager.take(key.currency0, address(this), out);
        }
        return abi.encode(out);
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
