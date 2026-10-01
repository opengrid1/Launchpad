// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {PoolKey, ModifyLiquidityParams, SwapParams, IInfinityVault, ICLPoolManager, ILockCallback, InfinityLib} from "./infinity/IInfinity.sol";
import {JeetWarsToken} from "./JeetWarsToken.sol";
import {JeetWarsHook} from "./JeetWarsHook.sol";
import {JeetWarsTokenDeployer} from "./JeetWarsTokenDeployer.sol";
import {JeetWarsRedeemer} from "./JeetWarsRedeemer.sol";

interface IJeetWarsCoinFees {
    function payPlatform() external returns (uint256);
    function burn(uint256 amount) external;
}

/// @title JeetWarsArena
/// @notice Launches Jeet Wars coins and runs the rounds.
///
///         Clock. Round r starts at genesis + r * 90 min: 15 min enlisting,
///         45 min battle, then the bell. A coin launched while enlisting is open
///         (and the round has a free slot) fights in the current round,
///         otherwise in the next one. Up to 8 coins per round.
///
///         Launch. The whole 1,000,000,000 supply goes into a PancakeSwap
///         Infinity pool against native BNB as single-sided liquidity owned by
///         this contract. An optional first buy (max 0.5 BNB) is made in the
///         same transaction for the creator.
///
///         Settle. After the bell anyone may settle the round: the coin with the
///         lowest average tick over the last 10 minutes (the highest average
///         market cap) wins; the others are closed and their liquidity is pulled.
///         Their coins come back here and are burned; their BNB is the loot.
///
///         Merge. The loot buys the winner in 10 hits, at least 3 minutes apart.
///         Each hit may move the price at most ~10% from the price at the start
///         of its block. Bought tokens go to the Redeemer; after the last hit,
///         each loser's holders can redeem for their share, plus any BNB the hits
///         did not spend. Settling and every hit pay the caller a small tip from
///         the tip budget, when funded.
///
///         Admin. Pause and resume launches, hide coins from listings, edit the
///         displayed metadata, set the fee recipient, manage armies, and collect
///         a coin's liquidity. The 2% fee, the split and the round rules have no
///         setter.
contract JeetWarsArena is ILockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using InfinityLib for PoolKey;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant SUPPLY = 1_000_000_000 ether;
    int24 public constant TICK_SPACING = 200;
    int24 public constant TICK_LOWER = -887_200;
    uint256 public constant ENLIST = 15 minutes;
    uint256 public constant BATTLE = 45 minutes;
    uint256 public constant ROUND = 90 minutes;
    uint256 public constant MAX_COINS = 8;
    uint8 public constant HITS = 10;
    uint256 public constant HIT_GAP = 3 minutes;
    /// @dev sqrt(1 / 1.1) in bps: a hit moves the coin's price at most ~10%.
    uint256 public constant HIT_SQRT_CAP_BPS = 9535;
    uint256 public constant MAX_FIRST_BUY = 0.5 ether;
    uint16 public constant CREATOR_BPS = 3500; // 0.7% of each trade
    uint16 public constant HOLDER_BPS = 1500; // 0.3% of each trade

    uint8 private constant ACT_LAUNCH = 0;
    uint8 private constant ACT_REMOVE = 1;
    uint8 private constant ACT_HIT = 2;
    uint8 private constant ACT_COLLECT = 3;

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------

    IInfinityVault public immutable vault;
    ICLPoolManager public immutable poolManager;
    JeetWarsHook public immutable hook;
    JeetWarsTokenDeployer public immutable tokenDeployer;
    JeetWarsRedeemer public immutable redeemer;
    uint256 public immutable genesis;
    /// @notice Starting tick of every pool (the top of the liquidity range).
    int24 public immutable startTick;
    /// @notice Runtime code hash shared by every official Binance bStock.
    bytes32 public immutable bstockCodehash;
    /// @notice Paid to whoever settles a round or makes a merge hit.
    uint256 public immutable tip;
    address public immutable admin;

    address public owner;
    address public feeRecipient;
    /// @notice The Jeet Wars router: holder payouts in stock go through it.
    address public converter;
    bool public launchesPaused;
    uint256 public tipBudget;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    struct Army {
        address stock;
        bool enabled;
        string name;
    }

    struct Coin {
        address creator;
        uint32 round;
        uint8 army;
        bool pulled;
        uint64 launchedAt;
        bytes32 poolId;
    }

    struct Round {
        bool settled;
        bool finalized;
        uint8 hits;
        uint64 lastHit;
        address winner;
        uint256 loot;
        uint256 spent;
        uint256 bought;
    }

    Army[] internal _armies;
    mapping(address => Coin) public coins;
    address[] public allCoins;
    mapping(uint32 => address[]) internal _roundCoins;
    mapping(uint32 => Round) public rounds;
    /// @notice BNB pulled from each losing coin's pool.
    mapping(address => uint256) public lootOf;
    mapping(bytes32 => bool) public tickerTaken;
    mapping(address => bool) public hidden;
    mapping(address => string) public metadataOverride;

    // ---------------------------------------------------------------------
    // Events / errors
    // ---------------------------------------------------------------------

    event Launched(address indexed coin, address indexed creator, uint32 indexed round, uint8 army, bytes32 poolId, uint256 firstBuy, uint256 firstBuyOut);
    event Settled(uint32 indexed round, address indexed winner, uint256 loot, address caller);
    event Hit(uint32 indexed round, uint8 index, uint256 bnbIn, uint256 tokensOut);
    event Finalized(uint32 indexed round, address indexed winner, uint256 bought, uint256 unspent);
    event LaunchesPausedSet(bool paused);
    event HiddenSet(address indexed coin, bool hidden);
    event CoinMetadataSet(address indexed coin, string uri);
    event FeeRecipientSet(address indexed recipient);
    event ConverterSet(address indexed converter);
    event ArmySet(uint8 indexed id, address stock, bool enabled, string name);
    event OwnershipRenounced();
    event Collected(address indexed coin, uint128 liquidity, uint256 bnb, uint256 coins, address indexed to);
    event TipsFunded(address indexed from, uint256 amount);

    error NotAdmin();
    error NotVault();
    error InvalidParams();
    error ZeroAddress();
    error LaunchesPaused();
    error NoConverter();
    error FirstBuyTooBig();
    error ArmyOff();
    error BadName();
    error BadTicker();
    error TickerTaken();
    error RoundsFull();
    error UnknownCoin();
    error TooEarly();
    error AlreadySettled();
    error NotSettled();
    error MergeDone();
    error NotBStock();
    error NothingToCollect();
    error TransferFailed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @dev Setup calls: the deployer (owner, until renounced) or the admin.
    modifier onlyAdminOrOwner() {
        if (msg.sender != admin && msg.sender != owner) revert NotAdmin();
        _;
    }

    struct Config {
        address owner;
        address admin;
        IInfinityVault vault;
        ICLPoolManager poolManager;
        JeetWarsHook hook;
        JeetWarsTokenDeployer tokenDeployer;
        JeetWarsRedeemer redeemer;
        uint256 genesis;
        int24 startTick;
        bytes32 bstockCodehash;
        uint256 tip;
    }

    constructor(Config memory c) {
        if (c.admin == address(0) || address(c.hook) == address(0)) revert ZeroAddress();
        if (c.startTick % TICK_SPACING != 0 || c.startTick <= TICK_LOWER || c.startTick >= TickMath.MAX_TICK) revert InvalidParams();
        owner = c.owner;
        admin = c.admin;
        feeRecipient = c.admin;
        vault = c.vault;
        poolManager = c.poolManager;
        hook = c.hook;
        tokenDeployer = c.tokenDeployer;
        redeemer = c.redeemer;
        genesis = c.genesis;
        startTick = c.startTick;
        bstockCodehash = c.bstockCodehash;
        tip = c.tip;
    }

    receive() external payable {}

    // ---------------------------------------------------------------------
    // Admin (survives renounce)
    // ---------------------------------------------------------------------

    function pause() external onlyAdmin {
        launchesPaused = true;
        emit LaunchesPausedSet(true);
    }

    function resume() external onlyAdmin {
        launchesPaused = false;
        emit LaunchesPausedSet(false);
    }

    /// @notice Hide a coin from the listings (sites and bots read this). It
    ///         keeps trading and keeps its place in its round.
    function setHidden(address coin, bool hidden_) external onlyAdmin {
        _known(coin);
        hidden[coin] = hidden_;
        emit HiddenSet(coin, hidden_);
    }

    /// @notice Edit a coin's displayed metadata. The coin contract's own
    ///         metadata never changes; an empty string restores it.
    function setCoinMetadata(address coin, string calldata uri) external onlyAdmin {
        _known(coin);
        metadataOverride[coin] = uri;
        emit CoinMetadataSet(coin, uri);
    }

    function setFeeRecipient(address recipient) external onlyAdmin {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice Pull `bps` of a coin's pool position (BNB and coins) to `to`.
    ///         Works at any time. Pulling all of it takes the coin out of its
    ///         round if the round isn't settled yet; if it is the winner of a
    ///         merge still running, the remaining hits are paid out as BNB.
    function collect(address coin, uint16 bps, address to) external onlyAdmin nonReentrant {
        if (bps == 0 || bps > 10_000) revert InvalidParams();
        if (to == address(0)) revert ZeroAddress();
        Coin storage c = _known(coin);
        uint128 liq = _liquidity(c.poolId);
        if (liq == 0) revert NothingToCollect();
        uint128 amount = bps == 10_000 ? liq : uint128((uint256(liq) * bps) / 10_000);
        if (amount == 0) revert NothingToCollect();
        (uint256 bnb, uint256 coinsOut) = abi.decode(vault.lock(abi.encode(ACT_COLLECT, abi.encode(coin, amount, to))), (uint256, uint256));
        if (amount == liq) c.pulled = true;
        emit Collected(coin, amount, bnb, coinsOut, to);
    }

    /// @notice One-time: the Jeet Wars router.
    function setConverter(address converter_) external onlyAdminOrOwner {
        if (converter != address(0) || converter_ == address(0)) revert InvalidParams();
        converter = converter_;
        emit ConverterSet(converter_);
    }

    /// @notice Add an army (`id == armies().length`) or update one. The stock
    ///         must be an official Binance bStock. Coins keep the stock they
    ///         launched with.
    function setArmy(uint8 id, address stock, bool enabled, string calldata name) external onlyAdminOrOwner {
        if (stock == address(0)) revert ZeroAddress();
        if (stock.codehash != bstockCodehash) revert NotBStock();
        if (id == _armies.length) _armies.push(Army(stock, enabled, name));
        else if (id < _armies.length) _armies[id] = Army(stock, enabled, name);
        else revert InvalidParams();
        emit ArmySet(id, stock, enabled, name);
    }

    /// @notice Give up the deployer's setup rights; the admin keeps its own.
    function renounceOwnership() external {
        if (msg.sender != owner) revert NotAdmin();
        owner = address(0);
        emit OwnershipRenounced();
    }

    // ---------------------------------------------------------------------
    // Anyone
    // ---------------------------------------------------------------------

    /// @notice Add BNB to the budget that tips settlers and merge hitters.
    function fundTips() external payable {
        tipBudget += msg.value;
        emit TipsFunded(msg.sender, msg.value);
    }

    /// @notice Push the platform share waiting in each coin to the fee recipient.
    function pushPlatformFees(address[] calldata list) external {
        for (uint256 i; i < list.length; i++) {
            _known(list[i]);
            IJeetWarsCoinFees(list[i]).payPlatform();
        }
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        uint8 army;
    }

    /// @notice Launch a coin. BNB sent is the creator's first buy (max 0.5 BNB).
    function launch(LaunchParams calldata p) external payable nonReentrant returns (address coin) {
        if (launchesPaused) revert LaunchesPaused();
        if (converter == address(0)) revert NoConverter();
        if (msg.value > MAX_FIRST_BUY) revert FirstBuyTooBig();
        if (p.army >= _armies.length || !_armies[p.army].enabled) revert ArmyOff();
        uint256 nameLen = bytes(p.name).length;
        if (nameLen < 2 || nameLen > 28) revert BadName();
        bytes32 tk = _ticker(p.symbol);
        if (tickerTaken[tk]) revert TickerTaken();
        tickerTaken[tk] = true;

        uint32 r = _assignRound();
        coin = tokenDeployer.deploy(
            JeetWarsToken.Init({
                name: p.name,
                symbol: p.symbol,
                metadataURI: p.metadataURI,
                supply: SUPPLY,
                creator: msg.sender,
                stock: _armies[p.army].stock,
                arena: address(this),
                hook: address(hook),
                router: converter,
                vault: address(vault),
                redeemer: address(redeemer),
                creatorBps: CREATOR_BPS,
                holderBps: HOLDER_BPS
            })
        );

        PoolKey memory key = poolKeyOf(coin);
        bytes32 id = key.toId();
        coins[coin] = Coin({creator: msg.sender, round: r, army: p.army, pulled: false, launchedAt: uint64(block.timestamp), poolId: id});
        allCoins.push(coin);
        _roundCoins[r].push(coin);

        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(startTick));
        hook.register(id, coin, uint64(bellOf(r)));

        uint128 liquidity = uint128(
            FullMath.mulDiv(SUPPLY, 1 << 96, TickMath.getSqrtPriceAtTick(startTick) - TickMath.getSqrtPriceAtTick(TICK_LOWER))
        );
        uint256 out = abi.decode(vault.lock(abi.encode(ACT_LAUNCH, abi.encode(key, liquidity, msg.value, msg.sender))), (uint256));

        // Rounding dust from the position never leaves the Arena: burn it.
        uint256 dust = IERC20(coin).balanceOf(address(this));
        if (dust > 0) IJeetWarsCoinFees(coin).burn(dust);

        emit Launched(coin, msg.sender, r, p.army, id, msg.value, out);
    }

    // ---------------------------------------------------------------------
    // Rounds
    // ---------------------------------------------------------------------

    /// @notice Score the round, close the losers and pull their liquidity.
    function settle(uint32 r) external nonReentrant {
        Round storage R = rounds[r];
        if (R.settled) revert AlreadySettled();
        if (block.timestamp < bellOf(r)) revert TooEarly();
        address[] storage list = _roundCoins[r];

        address win;
        int256 best;
        for (uint256 i; i < list.length; i++) {
            Coin storage c = coins[list[i]];
            if (_liquidity(c.poolId) == 0) {
                c.pulled = true;
                continue;
            }
            int256 s = hook.windowAverageTick(c.poolId);
            if (win == address(0) || s < best) {
                win = list[i];
                best = s;
            }
        }
        R.settled = true;
        R.winner = win;
        for (uint256 i; i < list.length; i++) {
            hook.setStatus(coins[list[i]].poolId, list[i] == win ? hook.WON() : hook.LOST());
        }
        if (win != address(0) && list.length > 1) {
            R.loot = abi.decode(vault.lock(abi.encode(ACT_REMOVE, abi.encode(r))), (uint256));
            for (uint256 i; i < list.length; i++) {
                if (list[i] == win) continue;
                uint256 bal = IERC20(list[i]).balanceOf(address(this));
                if (bal > 0) IJeetWarsCoinFees(list[i]).burn(bal);
            }
        }
        if (R.loot == 0) _finalize(r);
        _tip(msg.sender);
        emit Settled(r, win, R.loot, msg.sender);
    }

    /// @notice Make the next merge hit for a settled round.
    function hit(uint32 r) external nonReentrant {
        Round storage R = rounds[r];
        if (!R.settled) revert NotSettled();
        if (R.finalized) revert MergeDone();
        uint8 i = R.hits;
        if (block.timestamp < bellOf(r) + uint256(i) * HIT_GAP) revert TooEarly();
        if (i > 0 && block.timestamp < uint256(R.lastHit) + HIT_GAP) revert TooEarly();

        uint256 budget = (R.loot - R.spent) / (HITS - i);
        uint256 paid;
        uint256 out;
        Coin storage w = coins[R.winner];
        if (budget > 0 && _liquidity(w.poolId) > 0) {
            uint160 limit = uint160(
                (uint256(TickMath.getSqrtPriceAtTick(hook.blockStartTick(w.poolId))) * HIT_SQRT_CAP_BPS) / 10_000
            );
            (uint160 sqrtNow,,,) = poolManager.getSlot0(w.poolId);
            if (limit < sqrtNow && limit > TickMath.MIN_SQRT_PRICE) {
                (paid, out) = abi.decode(
                    vault.lock(abi.encode(ACT_HIT, abi.encode(poolKeyOf(R.winner), budget, limit))), (uint256, uint256)
                );
                R.spent += paid;
                R.bought += out;
            }
        }
        R.hits = i + 1;
        R.lastHit = uint64(block.timestamp);
        emit Hit(r, i, paid, out);
        if (R.hits == HITS) _finalize(r);
        _tip(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Vault callback
    // ---------------------------------------------------------------------

    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(vault)) revert NotVault();
        (uint8 act, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (act == ACT_LAUNCH) return _lockLaunch(payload);
        if (act == ACT_REMOVE) return _lockRemove(payload);
        if (act == ACT_HIT) return _lockHit(payload);
        return _lockCollect(payload);
    }

    function _lockLaunch(bytes memory payload) internal returns (bytes memory) {
        (PoolKey memory key, uint128 liquidity, uint256 firstBuy, address creator) = abi.decode(payload, (PoolKey, uint128, uint256, address));
        (int256 delta,) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: TICK_LOWER, tickUpper: startTick, liquidityDelta: int256(uint256(liquidity)), salt: 0}), ""
        );
        uint256 owe = uint256(uint128(-InfinityLib.amount1(delta)));
        vault.sync(key.currency1);
        IERC20(key.currency1).safeTransfer(address(vault), owe);
        vault.settle();

        uint256 out;
        if (firstBuy > 0) {
            int256 d = poolManager.swap(
                key, SwapParams({zeroForOne: true, amountSpecified: -int256(firstBuy), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}), ""
            );
            uint256 paid = uint256(uint128(-InfinityLib.amount0(d)));
            vault.settle{value: paid}();
            out = uint256(uint128(InfinityLib.amount1(d)));
            vault.take(key.currency1, creator, out);
            if (paid < firstBuy) _send(creator, firstBuy - paid);
        }
        return abi.encode(out);
    }

    function _lockRemove(bytes memory payload) internal returns (bytes memory) {
        uint32 r = abi.decode(payload, (uint32));
        address[] storage list = _roundCoins[r];
        address win = rounds[r].winner;
        uint256 total;
        for (uint256 i; i < list.length; i++) {
            address coin = list[i];
            if (coin == win) continue;
            bytes32 id = coins[coin].poolId;
            uint128 liq = _liquidity(id);
            if (liq == 0) continue;
            (uint256 bnb, uint256 back) = _remove(poolKeyOf(coin), liq, address(this));
            back;
            lootOf[coin] = bnb;
            total += bnb;
        }
        return abi.encode(total);
    }

    function _lockHit(bytes memory payload) internal returns (bytes memory) {
        (PoolKey memory key, uint256 budget, uint160 limit) = abi.decode(payload, (PoolKey, uint256, uint160));
        int256 d = poolManager.swap(key, SwapParams({zeroForOne: true, amountSpecified: -int256(budget), sqrtPriceLimitX96: limit}), "");
        uint256 paid = uint256(uint128(-InfinityLib.amount0(d)));
        uint256 out = uint256(uint128(InfinityLib.amount1(d)));
        if (paid > 0) vault.settle{value: paid}();
        if (out > 0) vault.take(key.currency1, address(redeemer), out);
        return abi.encode(paid, out);
    }

    function _lockCollect(bytes memory payload) internal returns (bytes memory) {
        (address coin, uint128 amount, address to) = abi.decode(payload, (address, uint128, address));
        (uint256 bnb, uint256 back) = _remove(poolKeyOf(coin), amount, to);
        return abi.encode(bnb, back);
    }

    function _remove(PoolKey memory key, uint128 liq, address to) internal returns (uint256 bnb, uint256 back) {
        (int256 delta,) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: TICK_LOWER, tickUpper: startTick, liquidityDelta: -int256(uint256(liq)), salt: 0}), ""
        );
        bnb = uint256(uint128(InfinityLib.amount0(delta)));
        back = uint256(uint128(InfinityLib.amount1(delta)));
        if (bnb > 0) vault.take(address(0), to, bnb);
        if (back > 0) vault.take(key.currency1, to, back);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function poolKeyOf(address coin) public view returns (PoolKey memory) {
        return PoolKey({
            currency0: address(0),
            currency1: coin,
            hooks: address(hook),
            poolManager: address(poolManager),
            fee: 0,
            parameters: InfinityLib.parameters(hook.getHooksRegistrationBitmap(), TICK_SPACING)
        });
    }

    function roundStart(uint32 r) public view returns (uint256) {
        return genesis + uint256(r) * ROUND;
    }

    function bellOf(uint32 r) public view returns (uint256) {
        return roundStart(r) + ENLIST + BATTLE;
    }

    function currentRound() public view returns (uint32) {
        if (block.timestamp < genesis) return 0;
        return uint32((block.timestamp - genesis) / ROUND);
    }

    function roundCoins(uint32 r) external view returns (address[] memory) {
        return _roundCoins[r];
    }

    function isCoin(address coin) external view returns (bool) {
        return coins[coin].creator != address(0);
    }

    function totalCoins() external view returns (uint256) {
        return allCoins.length;
    }

    function armies() external view returns (Army[] memory) {
        return _armies;
    }

    /// @notice The metadata sites should show: the admin's edit if any, else the coin's own.
    function metadataOf(address coin) external view returns (string memory) {
        string memory o = metadataOverride[coin];
        return bytes(o).length > 0 ? o : JeetWarsToken(payable(coin)).metadataURI();
    }

    /// @notice Liquidity still in a coin's pool position.
    function liquidityOf(address coin) external view returns (uint128) {
        return _liquidity(coins[coin].poolId);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _finalize(uint32 r) internal {
        Round storage R = rounds[r];
        R.finalized = true;
        address win = R.winner;
        uint256 unspent = R.loot - R.spent;
        if (win != address(0)) {
            address[] storage list = _roundCoins[r];
            for (uint256 i; i < list.length; i++) {
                address coin = list[i];
                if (coin == win) continue;
                uint256 share = lootOf[coin];
                uint256 tokens = R.loot == 0 ? 0 : (R.bought * share) / R.loot;
                uint256 bnb = R.loot == 0 ? 0 : (unspent * share) / R.loot;
                redeemer.register{value: bnb}(coin, win, r, tokens);
            }
        }
        emit Finalized(r, win, R.bought, unspent);
    }

    function _assignRound() internal view returns (uint32) {
        uint32 cur = currentRound();
        bool enlisting = block.timestamp < genesis || block.timestamp < roundStart(cur) + ENLIST;
        if (enlisting && _roundCoins[cur].length < MAX_COINS) return cur;
        if (_roundCoins[cur + 1].length < MAX_COINS) return cur + 1;
        revert RoundsFull();
    }

    /// @dev Tickers: 2-8 characters, A-Z and 0-9, unique.
    function _ticker(string calldata s) internal pure returns (bytes32) {
        bytes calldata b = bytes(s);
        if (b.length < 2 || b.length > 8) revert BadTicker();
        for (uint256 i; i < b.length; i++) {
            bytes1 ch = b[i];
            if (!((ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9"))) revert BadTicker();
        }
        return keccak256(b);
    }

    function _known(address coin) internal view returns (Coin storage c) {
        c = coins[coin];
        if (c.creator == address(0)) revert UnknownCoin();
    }

    function _liquidity(bytes32 id) internal view returns (uint128) {
        return poolManager.getLiquidity(id, address(this), TICK_LOWER, startTick, bytes32(0));
    }

    function _tip(address to) internal {
        uint256 t = tip;
        if (t == 0 || tipBudget < t) return;
        tipBudget -= t;
        (bool ok,) = to.call{value: t}("");
        if (!ok) tipBudget += t;
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
