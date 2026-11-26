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
    function approve(address s, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

interface ISwapperF {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 out);
}

interface IWETHF {
    function deposit() external payable;
}

/// @title LootbagFactory
/// @notice Launches Lootbag coins. One transaction creates the coin (1,000,000,000 supply, no owner, no mint), opens
///         its own Uniswap v4 pool against the chosen quote (VVV by default, or WETH, USDC or a stock token) with the
///         whole supply in it, and makes the creator's dev buy in the same transaction, so nobody can buy before them.
///         The factory holds every pool's liquidity. It is not locked: the owner can withdraw any share of a pool's
///         liquidity, up to all of it, with `collect` (the same call as the BuzzPad locker's), and the site says so.
///         Holder rewards are not in the pool and stay claimable after a collect. The creator picks the rewards
///         (1 to 10 tokens) the holders are paid in, in turns.
///         A creator can launch in one transaction paying only ETH (`launchWithEth`: the ETH left after the launch
///         fee is swapped into the quote and becomes the dev buy), or bring the quote themselves (`launch`). A coin's
///         picture, description and links are published once, on-chain, as an event, and can't be changed.
/// @dev The pool starts at the quote's opening tick (about $5K market cap) with the supply as a single-sided position
///      from there to the end of the price range, so the pool needs no quote to start. The pool has no LP fee: the
///      hook's 2% is the only fee. The position is the factory's; the hook lets only the factory remove it.
///      The factory starts paused: no launch can happen until the owner opens launches.
///      The owner can: list quotes and rewards, set their opening ticks and minimum dev buys, pause new launches, and
///      move the fee wallet, and collect a pool's liquidity. The owner can't change a launched coin, its fee, or the
///      holders' rewards.
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
    error NothingToCollect();
    error BadBps();
    error NoEthForDevBuy();
    error NotCreator();
    error MetaAlreadySet();
    error MetaTooLong();

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
    event Collected(address indexed coin, uint16 bps, uint256 coins, uint256 quote, address indexed to);
    /// @notice a coin's picture (a small data: or https: URI), description and links, published once by its creator
    event MetaSet(address indexed coin, string image, string description, string x, string telegram, string website);

    uint256 public constant SUPPLY = 1_000_000_000e18;
    uint256 public constant MAX_DEV_BUY = SUPPLY / 50; // 2%
    int24 public constant TICK_SPACING = 200;
    uint256 public constant LAUNCH_FEE = 0.001 ether;
    uint256 public constant COPY_FEE = 0.05 ether;
    uint256 public constant MAX_REWARDS = 10;
    uint256 public constant MAX_IMAGE = 24_000; // bytes of the picture's URI: a small inline image fits
    uint256 public constant MAX_DESCRIPTION = 280;
    uint256 public constant MAX_LINK = 160;

    IPoolManager public immutable poolManager;
    IHooks public immutable hook;
    address public immutable payout;
    LootbagToken public immutable implementation;
    /// @notice the route swapper that turns a creator's ETH into the quote for `launchWithEth`
    ISwapperF public immutable swapper;
    address public immutable weth;

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
    /// @notice true once a coin's picture, description and links are published: they can't be changed after
    mapping(address => bool) public metaSet;
    mapping(address => PoolKey) internal _keys;

    struct Position {
        int24 lo;
        int24 hi;
        uint128 liquidity;
    }

    /// @notice each coin's pool position, held by this factory
    mapping(address => Position) public positions;

    constructor(
        IPoolManager pm,
        IHooks hook_,
        address payout_,
        address owner_,
        address treasury_,
        address swapper_,
        address weth_
    ) {
        if (address(pm) == address(0) || address(hook_) == address(0) || payout_ == address(0)) revert ZeroAddress();
        if (owner_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (swapper_ == address(0) || weth_ == address(0)) revert ZeroAddress();
        swapper = ISwapperF(swapper_);
        weth = weth_;
        poolManager = pm;
        hook = hook_;
        payout = payout_;
        owner = owner_;
        treasury = treasury_;
        paused = true; // launches open only when the owner says so
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

    /// @notice Withdraws `bps` (out of 10,000) of what is left of `coin`'s pool liquidity, both sides, to `to`: the
    ///         unsold coins and the quote buyers paid in. 10,000 takes all of it, and the coin can then no longer be
    ///         traded in its pool; less leaves a thinner pool. It cannot be undone. Holder rewards are held by the
    ///         payout contract, not the pool, and are untouched.
    function collect(address coin, uint16 bps, address to) external onlyOwner returns (uint256 coins, uint256 quote) {
        if (bps == 0 || bps > 10_000) revert BadBps();
        if (to == address(0)) revert ZeroAddress();
        Position storage p = positions[coin];
        uint128 removed = uint128((uint256(p.liquidity) * bps) / 10_000);
        if (removed == 0) revert NothingToCollect();
        p.liquidity -= removed;
        (coins, quote) = abi.decode(
            poolManager.unlock(abi.encode(uint8(1), abi.encode(coin, to, p.lo, p.hi, removed))), (uint256, uint256)
        );
        emit Collected(coin, bps, coins, quote, to);
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
        uint256 devBuy; // `launch`: in the quote currency, pulled from the creator (approve it first). Unused by `launchWithEth`.
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

    struct Meta {
        string image;
        string description;
        string x;
        string telegram;
        string website;
    }

    /// @notice Launches with the quote brought by the creator: `p.devBuy` of it is pulled from them (approve it
    ///         first), and `msg.value` is exactly the launch fee (`launchFee(symbol)`).
    function launch(LaunchParams calldata p) external payable returns (address coin) {
        if (msg.value != LAUNCH_FEE + (tickerTaken[tickerKey(p.symbol)] ? COPY_FEE : 0)) revert BadFee();
        coin = _launch(p, p.devBuy, true);
    }

    /// @notice Launches paying only ETH, in one transaction: the launch fee comes off `msg.value` and the rest is
    ///         swapped into the quote (at least `minQuoteOut` of it) and spent as the dev buy. Also publishes the
    ///         coin's picture, description and links. `p.devBuy` is not used; `p.minCoinsOut` still guards the buy.
    function launchWithEth(LaunchParams calldata p, Meta calldata m, uint256 minQuoteOut)
        external
        payable
        returns (address coin)
    {
        uint256 fee = LAUNCH_FEE + (tickerTaken[tickerKey(p.symbol)] ? COPY_FEE : 0);
        if (msg.value <= fee) revert NoEthForDevBuy();
        uint256 ethIn = msg.value - fee;
        IWETHF(weth).deposit{value: ethIn}();
        uint256 devBuy = ethIn;
        if (p.quote != weth) {
            IERC20F(weth).approve(address(swapper), ethIn);
            devBuy = swapper.swap(weth, p.quote, ethIn, minQuoteOut, address(this));
        }
        coin = _launch(p, devBuy, false);
        _setMeta(coin, m);
    }

    /// @notice A creator publishes their coin's picture, description and links, once, if the launch did not
    function setMeta(address coin, Meta calldata m) external {
        if (msg.sender != creatorOf[coin]) revert NotCreator();
        _setMeta(coin, m);
    }

    function _setMeta(address coin, Meta calldata m) internal {
        uint256 il = bytes(m.image).length;
        uint256 dl = bytes(m.description).length;
        uint256 ll = bytes(m.x).length + bytes(m.telegram).length + bytes(m.website).length;
        if (il + dl + ll == 0) return; // nothing to publish: the creator can still do it later
        if (metaSet[coin]) revert MetaAlreadySet();
        if (
            il > MAX_IMAGE || dl > MAX_DESCRIPTION || bytes(m.x).length > MAX_LINK || bytes(m.telegram).length > MAX_LINK
                || bytes(m.website).length > MAX_LINK
        ) revert MetaTooLong();
        metaSet[coin] = true;
        emit MetaSet(coin, m.image, m.description, m.x, m.telegram, m.website);
    }

    /// @dev The launch itself; the fee is already in msg.value. With `pull`, the dev buy's quote is taken from the
    ///      creator once the launch has been checked; without it, it is already in this contract.
    function _launch(LaunchParams calldata p, uint256 devBuy, bool pull) internal returns (address coin) {
        if (paused) revert Paused();
        _checkName(p.name);
        bytes32 tk = _checkSymbol(p.symbol);
        Quote memory q = quotes[p.quote];
        if (!q.listed) revert BadQuote();
        uint256 nr = p.rewards.length;
        if (nr == 0 || nr > MAX_REWARDS) revert BadRewards();
        for (uint256 i; i < nr; i++) if (p.rewards[i] != p.quote && !rewardListed[p.rewards[i]]) revert BadRewards();
        if (devBuy < q.minDevBuy || devBuy == 0) revert DevBuyTooSmall();
        bool copy = tickerTaken[tk];
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

        // the supply in, as the factory's own position, and the dev buy, in one go
        if (pull) _pull(p.quote, msg.sender, devBuy);
        uint256 got =
            abi.decode(poolManager.unlock(abi.encode(uint8(0), abi.encode(key, coinIs0, tick, devBuy, msg.sender))), (uint256));
        if (got > MAX_DEV_BUY) revert DevBuyTooBig(got);
        if (got < p.minCoinsOut) revert DevBuyShort(got);
        // rounding leaves a few coins out of the pool: burned
        uint256 dust = IERC20F(coin).balanceOf(address(this));
        if (dust != 0) IERC20F(coin).transfer(address(0xdEaD), dust);

        if (copy) copyFeeHeld[coin] = COPY_FEE;
        _sendEth(treasury, LAUNCH_FEE);
        emit Launched(coin, msg.sender, p.quote, key.toId(), p.name, p.symbol, p.rewards, devBuy, got);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 mode, bytes memory inner) = abi.decode(data, (uint8, bytes));
        if (mode == 1) return _collectCallback(inner);
        (PoolKey memory key, bool coinIs0, int24 tick, uint256 devBuy, address creator) =
            abi.decode(inner, (PoolKey, bool, int24, uint256, address));
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
        positions[coin] = Position(lo, hi, liq);

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

    function _collectCallback(bytes memory inner) internal returns (bytes memory) {
        (address coin, address to, int24 lo, int24 hi, uint128 removed) =
            abi.decode(inner, (address, address, int24, int24, uint128));
        PoolKey memory key = _keys[coin];
        (BalanceDelta d,) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: -int256(uint256(removed)), salt: bytes32(0)}), ""
        );
        uint256 a0 = uint256(int256(d.amount0()));
        uint256 a1 = uint256(int256(d.amount1()));
        if (a0 != 0) poolManager.take(key.currency0, to, a0);
        if (a1 != 0) poolManager.take(key.currency1, to, a1);
        bool coinIs0 = Currency.unwrap(key.currency0) == coin;
        return abi.encode(coinIs0 ? a0 : a1, coinIs0 ? a1 : a0);
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
