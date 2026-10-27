// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IEquoFeeTo {
    function feeRecipient() external view returns (address);
}

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title EquoFeeHook
/// @notice The Uniswap V4 hook every Equo pool on this chain shares. It takes one fixed fee on every swap, in the
///         pool's pair token (the chain's wrapped native coin), and splits it between the coin's creator and the
///         platform. That is all it does to a swap.
///
///         Every pool: coin = currency0, pair = currency1. Buying pushes the price up.
///
///         FEE. Each coin picks its fee at launch, {MIN_FEE_BPS} to {MAX_FEE_BPS}; it never changes. The creator's
///         launch buy, made by the factory in the launch transaction, pays no fee.
///
///         SPLIT. Of each fee, the platform takes the larger of {PLATFORM_FEE_SHARE_BPS} of the fee and
///         {PLATFORM_VOLUME_BPS} of the swap's volume (never more than the whole fee); the creator gets the rest.
///         Both sides are paid out by anyone, any time, to the creator and the platform's fee recipient.
///
///         POOL GUARD. Only the factory can open a pool with this hook or add liquidity to one, so a coin's pool
///         holds exactly its launch position. A swap may not take the price below where the pool opened (the bottom
///         of the launch range): below it the pool holds nothing to trade against.
///
///         LAST-BUYER POT. {POT_VOLUME_BPS} of every swap's volume comes out of its fee into the coin's pot. A buy of
///         at least the coin's minimum ($50 of the pair at launch) makes its wallet (the transaction's sender, so it
///         works from any terminal or router) the last buyer and sets a {ROUND} timer. When the timer runs out the
///         last buyer wins the pot less {ROLLOVER_BPS}, which starts the next round. Winnings are paid out by anyone.
///
///         CRASH SHIELD. When the price falls {SHIELD_DROP_PCT}% or more below its high of the last {SHIELD_WINDOW},
///         the shield goes up: sells pay up to {SHIELD_SELL_BPS} extra (into the pot) and buys pay up to half the fee
///         less, both fading to normal over {SHIELD_DECAY} after the fall stops.
contract EquoFeeHook is BaseHook, IUnlockCallback, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint16 public constant MIN_FEE_BPS = 30;
    uint16 public constant MAX_FEE_BPS = 500;
    uint16 public constant PLATFORM_FEE_SHARE_BPS = 2_000;
    uint16 public constant PLATFORM_VOLUME_BPS = 20;
    /// @notice The pot's part of every swap: this share of the volume, out of the fee (after the platform's part).
    uint16 public constant POT_VOLUME_BPS = 10;
    uint16 public constant ROLLOVER_BPS = 2_000;
    uint64 public constant ROUND = 20 minutes;
    uint16 public constant SHIELD_DROP_PCT = 20;
    /// @dev sqrt(1 - 20%) in millionths: the shield trips when sqrtPrice falls to this share of its recent high.
    uint256 internal constant SHIELD_SQRT_PPM = 894_427;
    uint64 public constant SHIELD_WINDOW = 10 minutes;
    uint64 public constant SHIELD_DECAY = 30 minutes;
    uint16 public constant SHIELD_SELL_BPS = 500;
    bytes32 internal constant FEE_SLOT = keccak256("equo.fee.pending");
    bytes32 internal constant VOL_SLOT = keccak256("equo.fee.volume");
    bytes32 internal constant EXTRA_SLOT = keccak256("equo.fee.extra");

    address public immutable weth;
    address public immutable deployer;
    address public factory;

    struct PoolConfig {
        address token;
        address pair;
        uint16 feeBps;
        bool registered;
        uint160 floorSqrtPriceX96; // where the pool opened: the bottom of the launch range
    }

    struct Pot {
        uint128 amount; // in the pair token
        uint128 minBuy; // the smallest buy (pair spent on coins) that sets the last buyer
        address lastBuyer;
        uint64 deadline;
        uint32 round;
    }

    struct Shield {
        uint160 peakSqrtPriceX96; // the highest price since `peakAt`
        uint64 peakAt;
        uint64 until; // the shield fades out at this time
    }

    mapping(PoolId => PoolConfig) internal _config;
    mapping(address token => Pot) public pots;
    mapping(address token => Shield) public shields;
    /// @notice Pot winnings waiting to be paid, per coin and winner, in the coin's pair token.
    mapping(address token => mapping(address winner => uint256)) public wonOf;
    mapping(address token => PoolId) internal _poolOf;
    mapping(address token => address) public creatorOf;
    mapping(address token => uint256) public creatorOwed;
    mapping(address token => uint256) public platformOwed;
    /// @notice Lifetime fees and volume per coin, in its pair token.
    mapping(address token => uint256) public feesTotal;
    mapping(address token => uint256) public volumeTotal;

    event FactorySet(address indexed factory);
    event PoolRegistered(address indexed token, address indexed pair, uint16 feeBps, address creator);
    event FeeTaken(address indexed token, uint256 fee, uint256 volume, uint256 creatorPart, uint256 platformPart, uint256 potPart);
    event LastBuyer(address indexed token, address indexed buyer, uint32 round, uint64 deadline, uint256 pot);
    event RoundWon(address indexed token, address indexed winner, uint32 round, uint256 prize, uint256 rolledOver);
    event PotPaid(address indexed token, address indexed winner, uint256 amount);
    event ShieldUp(address indexed token, uint160 sqrtPriceX96, uint160 peakSqrtPriceX96, uint64 until);
    event CreatorPaid(address indexed token, address indexed to, uint256 amount);
    event PlatformPaid(address indexed token, address indexed to, uint256 amount);
    event CreatorSet(address indexed token, address indexed creator);

    error NotFactory();
    error AlreadySet();
    error BadFee();
    error NotThisPool();
    error BelowFloor();
    error InvalidParams();

    constructor(IPoolManager poolManager_, address weth_) BaseHook(poolManager_) {
        if (weth_ == address(0)) revert InvalidParams();
        weth = weth_;
        deployer = tx.origin; // the account behind the CREATE2 deployer
    }

    receive() external payable {}

    /// @notice One-time: the factory, wired by the account that deployed this hook.
    function setFactory(address factory_) external {
        if (msg.sender != deployer || factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert InvalidParams();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.beforeAddLiquidity = true;
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    // ---------------------------------------------------------------------
    // Factory
    // ---------------------------------------------------------------------

    function registerPool(PoolKey calldata key, address token, address pair, address creator, uint16 feeBps, uint160 floorSqrtPriceX96, uint256 minBuy)
        external
    {
        if (msg.sender != factory) revert NotFactory();
        if (feeBps < MIN_FEE_BPS || feeBps > MAX_FEE_BPS) revert BadFee();
        PoolId id = key.toId();
        if (_config[id].registered || creator == address(0) || minBuy == 0 || minBuy > type(uint128).max) revert InvalidParams();
        _config[id] = PoolConfig({token: token, pair: pair, feeBps: feeBps, registered: true, floorSqrtPriceX96: floorSqrtPriceX96});
        pots[token].minBuy = uint128(minBuy);
        shields[token] = Shield({peakSqrtPriceX96: floorSqrtPriceX96, peakAt: uint64(block.timestamp), until: 0});
        _poolOf[token] = id;
        creatorOf[token] = creator;
        emit PoolRegistered(token, pair, feeBps, creator);
    }

    /// @notice Hand the creator's fee stream to someone else (the factory runs the two-step transfer).
    ///         What the old creator earned is paid to them first.
    function setCreator(address token, address newCreator) external nonReentrant {
        if (msg.sender != factory) revert NotFactory();
        if (newCreator == address(0)) revert InvalidParams();
        _mustBeRegistered(token);
        _payCreator(token);
        creatorOf[token] = newCreator;
        emit CreatorSet(token, newCreator);
    }

    // ---------------------------------------------------------------------
    // Payouts (anyone)
    // ---------------------------------------------------------------------

    function payCreator(address token) external nonReentrant returns (uint256) {
        _mustBeRegistered(token);
        return _payCreator(token);
    }

    function payPlatform(address[] calldata tokens) external nonReentrant {
        address to = IEquoFeeTo(factory).feeRecipient();
        for (uint256 i; i < tokens.length; i++) {
            PoolConfig storage c = _mustBeRegistered(tokens[i]);
            uint256 amount = platformOwed[tokens[i]];
            if (amount == 0) continue;
            platformOwed[tokens[i]] = 0;
            poolManager.unlock(abi.encode(c.pair, to, amount));
            emit PlatformPaid(tokens[i], to, amount);
        }
    }

    /// @notice End the round if its timer has run out: the last buyer wins. Anyone; swaps do it too.
    function settleRound(address token) external {
        _mustBeRegistered(token);
        _settleRound(token);
    }

    /// @notice Pay `winner` what they won on `token`'s pot, in the pair token (the native coin for a native pair).
    function payWinner(address token, address winner) external nonReentrant returns (uint256 amount) {
        PoolConfig storage c = _mustBeRegistered(token);
        _settleRound(token);
        amount = wonOf[token][winner];
        if (amount == 0) return 0;
        wonOf[token][winner] = 0;
        poolManager.unlock(abi.encode(c.pair, winner, amount));
        emit PotPaid(token, winner, amount);
    }

    function _settleRound(address token) internal {
        Pot storage p = pots[token];
        if (p.lastBuyer == address(0) || block.timestamp < p.deadline) return;
        uint256 prize = (uint256(p.amount) * (BPS - ROLLOVER_BPS)) / BPS;
        address winner = p.lastBuyer;
        p.amount -= uint128(prize);
        wonOf[token][winner] += prize;
        emit RoundWon(token, winner, p.round, prize, p.amount);
        p.lastBuyer = address(0);
        p.deadline = 0;
        p.round += 1;
    }

    function _payCreator(address token) internal returns (uint256 amount) {
        amount = creatorOwed[token];
        if (amount == 0) return 0;
        creatorOwed[token] = 0;
        address to = creatorOf[token];
        poolManager.unlock(abi.encode(_config[_poolOf[token]].pair, to, amount));
        emit CreatorPaid(token, to, amount);
    }

    /// @dev Turn fee claims back into the pair token and pay them out.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address pair, address to, uint256 amount) = abi.decode(data, (address, address, uint256));
        Currency cur = Currency.wrap(pair);
        poolManager.burn(address(this), cur.toId(), amount);
        poolManager.take(cur, address(this), amount);
        if (pair == weth) {
            IWrappedNative(weth).withdraw(amount);
            (bool ok,) = to.call{value: amount}("");
            if (!ok) {
                // a contract that refuses ETH gets the wrapped coin instead
                IWrappedNative(weth).deposit{value: amount}();
                IERC20(weth).safeTransfer(to, amount);
            }
        } else {
            IERC20(pair).safeTransfer(to, amount);
        }
        return "";
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function config(address token) external view returns (PoolConfig memory) {
        return _config[_poolOf[token]];
    }

    function poolOf(address token) external view returns (PoolId) {
        return _poolOf[token];
    }

    /// @notice How a fee of `fee` on a swap of `volume` splits: the platform the larger of 20% of the fee and 0.2%
    ///         of the volume, the pot 0.1% of the volume out of what is left, the creator the rest.
    function split(uint256 fee, uint256 volume) public pure returns (uint256 creatorPart, uint256 platformPart, uint256 potPart) {
        platformPart = (fee * PLATFORM_FEE_SHARE_BPS) / BPS;
        uint256 byVolume = (volume * PLATFORM_VOLUME_BPS) / BPS;
        if (byVolume > platformPart) platformPart = byVolume;
        if (platformPart > fee) platformPart = fee;
        potPart = (volume * POT_VOLUME_BPS) / BPS;
        if (potPart > fee - platformPart) potPart = fee - platformPart;
        creatorPart = fee - platformPart - potPart;
    }

    /// @notice How far up the crash shield is now, in bps (10000 = just tripped, 0 = down).
    function shieldOf(address token) public view returns (uint256) {
        uint64 until = shields[token].until;
        if (until <= block.timestamp) return 0;
        return (uint256(until - block.timestamp) * BPS) / SHIELD_DECAY;
    }

    /// @notice The fee a buy or a sell pays now, in bps, with the shield.
    function feeNow(address token, bool sell) public view returns (uint256 bps) {
        uint256 base = _config[_poolOf[token]].feeBps;
        uint256 up = shieldOf(token);
        return sell ? base + (SHIELD_SELL_BPS * up) / BPS : base - (base * up) / (2 * BPS);
    }

    // ---------------------------------------------------------------------
    // Pool hooks
    // ---------------------------------------------------------------------

    function _beforeInitialize(address sender, PoolKey calldata, uint160) internal view override returns (bytes4) {
        if (sender != factory) revert NotFactory();
        return BaseHook.beforeInitialize.selector;
    }

    function _beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        if (sender != factory) revert NotFactory();
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolConfig storage c = _config[key.toId()];
        // the creator's launch buy (the factory's only swap) pays no fee
        if (!c.registered || sender == factory || !_specifiedIsPair(params)) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        (uint256 fee, uint256 extra) = _fee(c, params.zeroForOne, amount);
        _tset(FEE_SLOT, fee);
        _tset(VOL_SLOT, amount);
        _tset(EXTRA_SLOT, extra);
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (!c.registered) return (BaseHook.afterSwap.selector, 0);
        (uint160 sqrtP,,,) = poolManager.getSlot0(id);
        if (sqrtP < c.floorSqrtPriceX96) revert BelowFloor();
        if (sender == factory) return (BaseHook.afterSwap.selector, 0);
        uint256 fee;
        uint256 volume;
        uint256 extra;
        int128 ret = 0;
        if (_specifiedIsPair(params)) {
            fee = _tget(FEE_SLOT);
            volume = _tget(VOL_SLOT);
            extra = _tget(EXTRA_SLOT);
            _tset(FEE_SLOT, 0);
            _tset(VOL_SLOT, 0);
            _tset(EXTRA_SLOT, 0);
        } else {
            int128 unspecified = delta.amount1();
            volume = unspecified < 0 ? uint256(uint128(-unspecified)) : uint256(uint128(unspecified));
            (fee, extra) = _fee(c, params.zeroForOne, volume);
            ret = int128(int256(fee));
        }
        if (fee > 0) {
            poolManager.mint(address(this), key.currency1.toId(), fee);
            _book(c.token, fee, extra, volume);
        }
        _afterTrade(c.token, params.zeroForOne, delta, sqrtP);
        return (BaseHook.afterSwap.selector, ret);
    }

    /// @dev The fee on `amount` of pair token, and the shield's extra part of it (a sell's, which goes to the pot).
    function _fee(PoolConfig storage c, bool sell, uint256 amount) internal view returns (uint256 fee, uint256 extra) {
        uint256 up = shieldOf(c.token);
        if (sell) {
            extra = (amount * SHIELD_SELL_BPS * up) / (BPS * BPS);
            fee = (amount * c.feeBps) / BPS + extra;
        } else {
            fee = (amount * (uint256(c.feeBps) * (2 * BPS - up))) / (2 * BPS * BPS);
        }
    }

    function _book(address token, uint256 fee, uint256 extra, uint256 volume) internal {
        (uint256 creatorPart, uint256 platformPart, uint256 potPart) = split(fee - extra, volume);
        creatorOwed[token] += creatorPart;
        platformOwed[token] += platformPart;
        pots[token].amount += uint128(potPart + extra);
        feesTotal[token] += fee;
        volumeTotal[token] += volume;
        emit FeeTaken(token, fee, volume, creatorPart, platformPart, potPart + extra);
    }

    /// @dev After every swap: end a finished round, let a big enough buy take the pot's timer, move the shield.
    function _afterTrade(address token, bool sell, BalanceDelta delta, uint160 sqrtP) internal {
        _settleRound(token);
        if (!sell) {
            int128 paid = delta.amount1();
            uint256 spent = paid < 0 ? uint256(uint128(-paid)) : 0;
            Pot storage p = pots[token];
            if (spent >= p.minBuy) {
                p.lastBuyer = tx.origin;
                p.deadline = uint64(block.timestamp) + ROUND;
                emit LastBuyer(token, tx.origin, p.round, p.deadline, p.amount);
            }
        }
        Shield storage sh = shields[token];
        if (block.timestamp > sh.peakAt + SHIELD_WINDOW || sqrtP > sh.peakSqrtPriceX96) {
            sh.peakSqrtPriceX96 = sqrtP;
            sh.peakAt = uint64(block.timestamp);
        } else if (uint256(sqrtP) * 1e6 <= uint256(sh.peakSqrtPriceX96) * SHIELD_SQRT_PPM) {
            sh.until = uint64(block.timestamp) + SHIELD_DECAY;
            emit ShieldUp(token, sqrtP, sh.peakSqrtPriceX96, sh.until);
        }
    }

    function _mustBeRegistered(address token) internal view returns (PoolConfig storage c) {
        c = _config[_poolOf[token]];
        if (!c.registered) revert NotThisPool();
    }

    /// @dev Pair is always currency1.
    function _specifiedIsPair(SwapParams calldata params) internal pure returns (bool) {
        bool exactInput = params.amountSpecified < 0;
        bool specifiedIsCurrency0 = exactInput ? params.zeroForOne : !params.zeroForOne;
        return !specifiedIsCurrency0;
    }

    function _tset(bytes32 s, uint256 v) internal {
        assembly ("memory-safe") { tstore(s, v) }
    }

    function _tget(bytes32 s) internal view returns (uint256 v) {
        assembly ("memory-safe") { v := tload(s) }
    }
}
