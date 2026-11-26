// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";

import {LootbagToken} from "./LootbagToken.sol";
import {Clones} from "./lib/Clones.sol";

interface IHookReg {
    function register(PoolId id, address coin, address quote) external;
}

interface IPayoutReg {
    function register(address coin, address quote, address[] calldata rewards) external;
}

interface IERC20F {
    function transfer(address to, uint256 v) external returns (bool);
    function transferFrom(address f, address t, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

/// @title LootbagFactory
/// @notice Launches Lootbag coins. One transaction creates the coin (1,000,000,000 supply, no owner, no mint), opens
///         its own Uniswap v4 pool against the chosen quote (VVV by default, or WETH, USDC or a stock token) with the
///         whole supply in it, locked forever, and makes the creator's dev buy in the same transaction, so nobody can
///         buy before them. The creator picks the rewards (1 to 10 tokens) the holders are paid in, in turns.
/// @dev The pool starts at the quote's opening tick (about $5K market cap) with the supply as a single-sided position
///      from there to the end of the price range, so the pool needs no quote to start. The pool has no LP fee: the
///      hook's 2% is the only fee. The position is the factory's and the hook refuses every removal.
///      The owner can: list quotes and rewards, set their opening ticks and minimum dev buys, pause new launches, and
///      move the fee wallet. The owner can't touch a launched coin, its pool, its liquidity or anyone's funds.
contract LootbagFactory is IUnlockCallback {
    error NotOwner();
    error NotPoolManager();
    error Paused();
    error BadName();
    error BadSymbol();
    error BadQuote();
    error BadRewards();
    error BadFee();
    error DevBuyTooSmall();
    error DevBuyTooBig(uint256 coins);
    error DevBuyShort(uint256 coins);
    error ZeroAddress();
    error NothingToSettle();

    event Launched(
        address indexed coin,
        address indexed creator,
        address indexed quote,
        PoolId poolId,
        string name,
        string symbol,
        address[] rewards,
        uint256 devBuyQuote,
        uint256 devBuyCoins
    );
    event QuoteSet(address indexed quote, bool listed, int24 startTick, uint256 minDevBuy);
    event RewardSet(address indexed token, bool listed);
    event CopyFeeSettled(address indexed coin, bool refunded);

    uint256 public constant SUPPLY = 1_000_000_000e18;
    uint256 public constant MAX_DEV_BUY = SUPPLY / 50; // 2%
    int24 public constant TICK_SPACING = 200;
    uint256 public constant LAUNCH_FEE = 0.001 ether;
    uint256 public constant COPY_FEE = 0.05 ether;
    uint256 public constant MAX_REWARDS = 10;

    IPoolManager public immutable poolManager;
    IHooks public immutable hook;
    address public immutable payout;
    LootbagToken public immutable implementation;

    address public owner;
    address public pendingOwner;
    address public treasury;
    bool public paused;
    uint256 public nonce;

    struct Quote {
        bool listed;
        int24 startTick; // the opening tick when the coin is currency0 (negated when it is currency1)
        uint256 minDevBuy;
    }

    mapping(address => Quote) public quotes;
    mapping(address => bool) public rewardListed;
    /// @notice tickers already launched (upper case): launching one again costs the copy fee
    mapping(bytes32 => bool) public tickerTaken;
    /// @notice copy fees held per coin until the owner refunds or keeps them
    mapping(address => uint256) public copyFeeHeld;
    mapping(address => address) public creatorOf;
    mapping(address => PoolKey) internal _keys;

    constructor(IPoolManager pm, IHooks hook_, address payout_, address owner_, address treasury_) {
        if (address(pm) == address(0) || address(hook_) == address(0) || payout_ == address(0)) revert ZeroAddress();
        if (owner_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        poolManager = pm;
        hook = hook_;
        payout = payout_;
        owner = owner_;
        treasury = treasury_;
        implementation = new LootbagToken();
    }

    // ------------------------------------------------------------------ owner

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setQuote(address quote, bool listed, int24 startTick, uint256 minDevBuy) external onlyOwner {
        if (startTick % TICK_SPACING != 0 || startTick <= TickMath.MIN_TICK + TICK_SPACING || startTick >= TickMath.MAX_TICK - TICK_SPACING) {
            revert BadQuote();
        }
        quotes[quote] = Quote(listed, startTick, minDevBuy);
        emit QuoteSet(quote, listed, startTick, minDevBuy);
    }

    function setReward(address token, bool listed) external onlyOwner {
        rewardListed[token] = listed;
        emit RewardSet(token, listed);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
    }

    /// @notice Refunds a copy fee to the coin's creator (it reached $70K within 48 hours) or keeps it
    function settleCopyFee(address coin, bool refund) external onlyOwner {
        uint256 a = copyFeeHeld[coin];
        if (a == 0) revert NothingToSettle();
        copyFeeHeld[coin] = 0;
        _sendEth(refund ? creatorOf[coin] : treasury, a);
        emit CopyFeeSettled(coin, refund);
    }

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ------------------------------------------------------------------ launch

    struct LaunchParams {
        string name;
        string symbol;
        address quote;
        address[] rewards;
        uint256 devBuy; // in the quote currency, pulled from the creator (approve it first)
        uint256 minCoinsOut;
    }

    function poolKey(address coin) external view returns (PoolKey memory) {
        return _keys[coin];
    }

    function tickerKey(string memory symbol) public pure returns (bytes32) {
        bytes memory b = bytes(symbol);
        for (uint256 i; i < b.length; i++) if (b[i] >= 0x61 && b[i] <= 0x7a) b[i] = bytes1(uint8(b[i]) - 32);
        return keccak256(b);
    }

    function launchFee(string calldata symbol) external view returns (uint256) {
        return LAUNCH_FEE + (tickerTaken[tickerKey(symbol)] ? COPY_FEE : 0);
    }

    function launch(LaunchParams calldata p) external payable returns (address coin) {
        if (paused) revert Paused();
        _checkName(p.name);
        bytes32 tk = _checkSymbol(p.symbol);
        Quote memory q = quotes[p.quote];
        if (!q.listed) revert BadQuote();
        uint256 nr = p.rewards.length;
        if (nr == 0 || nr > MAX_REWARDS) revert BadRewards();
        for (uint256 i; i < nr; i++) if (p.rewards[i] != p.quote && !rewardListed[p.rewards[i]]) revert BadRewards();
        if (p.devBuy < q.minDevBuy || p.devBuy == 0) revert DevBuyTooSmall();
        bool copy = tickerTaken[tk];
        if (msg.value != LAUNCH_FEE + (copy ? COPY_FEE : 0)) revert BadFee();
        tickerTaken[tk] = true;

        // the coin
        coin = Clones.cloneDeterministic(address(implementation), keccak256(abi.encode(msg.sender, nonce++)));
        LootbagToken(coin).initialize(p.name, p.symbol, SUPPLY, payout, msg.sender);
        LootbagToken(coin).exclude(address(poolManager));
        LootbagToken(coin).exclude(address(hook));
        creatorOf[coin] = msg.sender;

        // its pool
        bool coinIs0 = coin < p.quote;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(coinIs0 ? coin : p.quote),
            currency1: Currency.wrap(coinIs0 ? p.quote : coin),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });
        _keys[coin] = key;
        IHookReg(address(hook)).register(key.toId(), coin, p.quote);
        IPayoutReg(payout).register(coin, p.quote, p.rewards);
        int24 tick = coinIs0 ? q.startTick : -q.startTick;
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(tick));

        // the supply in, locked, and the dev buy, in one go
        _pull(p.quote, msg.sender, p.devBuy);
        uint256 got = abi.decode(poolManager.unlock(abi.encode(key, coinIs0, tick, p.devBuy, msg.sender)), (uint256));
        if (got > MAX_DEV_BUY) revert DevBuyTooBig(got);
        if (got < p.minCoinsOut) revert DevBuyShort(got);
        // rounding leaves a few coins out of the pool: burned
        uint256 dust = IERC20F(coin).balanceOf(address(this));
        if (dust != 0) IERC20F(coin).transfer(address(0xdEaD), dust);

        if (copy) copyFeeHeld[coin] = COPY_FEE;
        _sendEth(treasury, LAUNCH_FEE);
        emit Launched(coin, msg.sender, p.quote, key.toId(), p.name, p.symbol, p.rewards, p.devBuy, got);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolKey memory key, bool coinIs0, int24 tick, uint256 devBuy, address creator) =
            abi.decode(data, (PoolKey, bool, int24, uint256, address));
        address coin = Currency.unwrap(coinIs0 ? key.currency0 : key.currency1);
        address quote = Currency.unwrap(coinIs0 ? key.currency1 : key.currency0);

        // single-sided: from the opening price to the end of the range, coins only
        int24 lo = coinIs0 ? tick : TickMath.minUsableTick(TICK_SPACING);
        int24 hi = coinIs0 ? TickMath.maxUsableTick(TICK_SPACING) : tick;
        uint160 sa = TickMath.getSqrtPriceAtTick(lo);
        uint160 sb = TickMath.getSqrtPriceAtTick(hi);
        uint128 liq = coinIs0
            ? LiquidityAmounts.getLiquidityForAmount0(sa, sb, SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(sa, sb, SUPPLY);
        (BalanceDelta d,) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(uint256(liq)), salt: bytes32(0)}), ""
        );
        int128 owedCoin = coinIs0 ? d.amount0() : d.amount1();
        _settle(coin, uint256(int256(-owedCoin)));

        // the dev buy: quote in, coins to the creator (the hook takes its 2% like on any trade)
        bool zeroForOne = !coinIs0;
        BalanceDelta s = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(devBuy),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 paid = zeroForOne ? s.amount0() : s.amount1();
        int128 got = zeroForOne ? s.amount1() : s.amount0();
        _settle(quote, uint256(int256(-paid)));
        poolManager.take(Currency.wrap(coin), creator, uint256(int256(got)));
        return abi.encode(uint256(int256(got)));
    }

    // ------------------------------------------------------------------ internal

    function _settle(address token, uint256 amt) internal {
        poolManager.sync(Currency.wrap(token));
        IERC20F(token).transfer(address(poolManager), amt);
        poolManager.settle();
    }

    function _pull(address token, address from, uint256 amt) internal {
        (bool ok, bytes memory r) = token.call(abi.encodeCall(IERC20F.transferFrom, (from, address(this), amt)));
        require(ok && (r.length == 0 || abi.decode(r, (bool))), "pull");
    }

    function _sendEth(address to, uint256 a) internal {
        (bool ok,) = to.call{value: a}("");
        require(ok, "eth");
    }

    function _checkName(string calldata n) internal pure {
        uint256 l = bytes(n).length;
        if (l == 0 || l > 32) revert BadName();
    }

    function _checkSymbol(string calldata s) internal pure returns (bytes32) {
        bytes memory b = bytes(s);
        if (b.length < 2 || b.length > 10) revert BadSymbol();
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
            if (!ok) revert BadSymbol();
        }
        return tickerKey(s);
    }
}
