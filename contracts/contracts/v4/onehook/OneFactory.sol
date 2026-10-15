// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {OneToken} from "./OneToken.sol";
import {OneTokenDeployer} from "./OneTokenDeployer.sol";
import {OneHook} from "./OneHook.sol";
import {IOneOracle} from "./IOneOracle.sol";

interface IOnePairRouter {
    function ethToPair(address pair, bytes calldata route, address to, uint256 minOut) external payable returns (uint256 pairOut);
}

/// @title OneFactory
/// @notice One-transaction launcher for OneHook coins on Ethereum / Uniswap V4.
///         A coin is paired with WETH or any token the oracle can price
///         (tokenized gold, every Ondo tokenized stock). The whole 1B supply
///         goes into the pool at the start cap as a single hook-owned position.
///         The coin's instincts (fee engine, anti-snipe, buyback, dividends,
///         max-wallet) are chosen here at launch, validated against the
///         constitution, and nothing changes them afterwards.
///
///         Ownership (setup rights) is renounced after deploy; the immutable
///         `admin` keeps: pause, listing visibility, metadata edits (stored
///         here; the coin stays immutable), token blocking, the fee recipient,
///         the start cap, and collecting from a coin's pool liquidity, which
///         only executes {COLLECT_DELAY} after a public on-chain announcement
///         naming the coin, the share and the recipient, so every holder can
///         see it coming and exit first. The admin cannot mint, change a
///         coin's fee or instincts, freeze transfers, move anyone's coins, or
///         touch the fee pots owed to creators, buybacks and dividends.
contract OneFactory is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant TOTAL_SUPPLY_WHOLE = 1_000_000_000;
    int24 public constant TICK_SPACING = 10;
    uint24 public constant LP_FEE = 0;
    /// @notice Notice a collect announcement must give holders before it can execute.
    uint64 public constant COLLECT_DELAY = 24 hours;
    /// @notice Largest share of a coin's liquidity one announcement can name.
    uint16 public constant MAX_COLLECT_BPS = 2_000;

    IPoolManager public immutable poolManager;
    OneHook public immutable hook;
    address public immutable weth;
    address public immutable admin;
    OneTokenDeployer public immutable tokenDeployer;
    IOneOracle public immutable oracle;

    address public converter;
    address public feeRecipient;
    bool public launchesPaused;
    /// @notice Market cap new coins start at, USD 8 dp. Existing coins are unaffected.
    uint256 public startCapUsd8 = 5_000e8;

    mapping(address => bool) public blocked;

    struct Listing {
        address creator;
        address pair;
        uint64 createdAt;
        bytes32 poolId;
    }
    mapping(address token => Listing) public listings;
    mapping(address token => bool) public hidden;
    mapping(address token => string) public metadataOverride;
    address[] public allTokens;
    address public owner;

    struct PendingCollect {
        uint16 bps;
        address recipient;
        uint64 executableAt;
    }
    /// @notice The one announced, not-yet-executed collect per coin.
    mapping(address token => PendingCollect) public pendingCollect;

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        address pair; // zero for WETH
        uint256 minPairOut;
        OneHook.Genes genes;
    }

    event Launched(address indexed token, address indexed creator, address indexed pair, bytes32 poolId, uint256 pairUsdPrice);
    event DevBought(address indexed token, address indexed creator, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event HiddenSet(address indexed token, bool hidden);
    event CoinMetadataSet(address indexed token, string uri);
    event LaunchesPausedSet(bool paused);
    event FeeRecipientSet(address indexed recipient);
    event ConverterSet(address indexed converter);
    event OwnershipRenounced();
    event TokenBlocked(address indexed token, bool blocked);
    event StartCapSet(uint256 usd8);
    event CollectAnnounced(address indexed token, uint16 bps, address indexed recipient, uint64 executableAt);
    event CollectCancelled(address indexed token);
    event Collected(address indexed token, uint16 bps, uint256 coins, uint256 pair, address indexed to);

    error LaunchesPaused();
    error InvalidParams();
    error BadGenes();
    error NotAdmin();
    error ZeroAddress();
    error Blocked();
    error CollectNotAnnounced();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAdminOrOwner() {
        if (msg.sender != admin && msg.sender != owner) revert NotAdmin();
        _;
    }

    constructor(address owner_, address admin_, IPoolManager poolManager_, OneHook hook_, OneTokenDeployer tokenDeployer_, address weth_, IOneOracle oracle_, address feeRecipient_) {
        if (admin_ == address(0) || weth_ == address(0) || address(oracle_) == address(0)) revert ZeroAddress();
        owner = owner_;
        admin = admin_;
        poolManager = poolManager_;
        hook = hook_;
        tokenDeployer = tokenDeployer_;
        weth = weth_;
        oracle = oracle_;
        feeRecipient = feeRecipient_ == address(0) ? admin_ : feeRecipient_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function pause() external onlyAdmin {
        launchesPaused = true;
        emit LaunchesPausedSet(true);
    }

    function resume() external onlyAdmin {
        launchesPaused = false;
        emit LaunchesPausedSet(false);
    }

    /// @notice Hide a coin from listings; it keeps trading.
    function setHidden(address token, bool hidden_) external onlyAdmin {
        if (listings[token].createdAt == 0) revert InvalidParams();
        hidden[token] = hidden_;
        emit HiddenSet(token, hidden_);
    }

    /// @notice Edit a coin's displayed metadata; empty restores the coin's own.
    function setCoinMetadata(address token, string calldata uri) external onlyAdmin {
        if (listings[token].createdAt == 0) revert InvalidParams();
        metadataOverride[token] = uri;
        emit CoinMetadataSet(token, uri);
    }

    function metadataOf(address token) external view returns (string memory) {
        string memory o = metadataOverride[token];
        return bytes(o).length > 0 ? o : OneToken(payable(token)).metadataURI();
    }

    function setFeeRecipient(address recipient) external onlyAdmin {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice One-time: the router (ETH <-> pair token routing).
    function setConverter(address converter_) external onlyAdminOrOwner {
        if (converter != address(0) || converter_ == address(0)) revert InvalidParams();
        converter = converter_;
        emit ConverterSet(converter_);
    }

    /// @notice Block or unblock a token as a pair. Coins already launched keep trading.
    function setTokenBlocked(address token, bool blocked_) external onlyAdmin {
        if (token == address(0) || token == weth) revert InvalidParams();
        blocked[token] = blocked_;
        emit TokenBlocked(token, blocked_);
    }

    /// @notice Start cap for coins launched from now on, USD 8 dp ($1,000 to $100,000).
    function setStartCap(uint256 usd8) external onlyAdmin {
        if (usd8 < 1_000e8 || usd8 > 100_000e8) revert InvalidParams();
        startCapUsd8 = usd8;
        emit StartCapSet(usd8);
    }

    /// @notice Give up the deployer's setup rights; the admin keeps its own.
    function renounceOwnership() external {
        if (msg.sender != owner) revert NotAdmin();
        owner = address(0);
        emit OwnershipRenounced();
    }

    /// @notice Announce a collect of `bps` of a coin's pool liquidity to
    ///         `recipient`. It can execute no sooner than {COLLECT_DELAY} from
    ///         now, so every holder sees it coming on-chain and can exit
    ///         first. Announcing again replaces the pending one and restarts
    ///         the clock.
    function announceCollect(address token, uint16 bps, address recipient) external onlyAdmin {
        if (listings[token].createdAt == 0 || bps == 0 || bps > MAX_COLLECT_BPS || recipient == address(0)) revert InvalidParams();
        uint64 at = uint64(block.timestamp) + COLLECT_DELAY;
        pendingCollect[token] = PendingCollect({bps: bps, recipient: recipient, executableAt: at});
        emit CollectAnnounced(token, bps, recipient, at);
    }

    /// @notice Withdraw a pending collect announcement.
    function cancelCollect(address token) external onlyAdmin {
        delete pendingCollect[token];
        emit CollectCancelled(token);
    }

    /// @notice Execute a collect announced at least {COLLECT_DELAY} ago, with
    ///         exactly the announced share and recipient. The fee pots are
    ///         never touched.
    function collect(address token, uint16 bps, address recipient) external onlyAdmin nonReentrant returns (uint256 coins, uint256 pair) {
        if (listings[token].createdAt == 0) revert InvalidParams();
        PendingCollect memory p = pendingCollect[token];
        if (p.executableAt == 0 || block.timestamp < p.executableAt || p.bps != bps || p.recipient != recipient) revert CollectNotAnnounced();
        delete pendingCollect[token];
        (coins, pair) = hook.collect(token, bps, recipient);
        emit Collected(token, bps, coins, pair, recipient);
    }

    /// @notice Push the platform's fee share on `tokens` to the fee recipient. Anyone.
    function pushPlatformFees(address[] calldata tokens) external {
        hook.pushPlatform(tokens);
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /// @notice Launch a coin with its instincts. Any ETH sent is the creator's
    ///         first buy: the router turns it into the pair token along `route`
    ///         (empty for WETH), it is swapped in the fresh pool and the coins
    ///         go to the creator.
    function launch(LaunchParams calldata p, bytes32 salt, bytes calldata route) external payable nonReentrant returns (address token, bytes32 poolId) {
        if (launchesPaused) revert LaunchesPaused();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0 || converter == address(0)) revert InvalidParams();
        _checkGenes(p.genes);
        address pair = p.pair == address(0) ? weth : p.pair;
        if (blocked[pair]) revert Blocked();
        uint256 pairUsd18 = oracle.launchPrice(pair);

        token = tokenDeployer.deploy(
            salt,
            OneTokenDeployer.Init({
                name: p.name,
                symbol: p.symbol,
                metadataURI: p.metadataURI,
                supply: TOTAL_SUPPLY,
                pairAsset: pair,
                poolManager: address(poolManager),
                hook: address(hook),
                converter: converter,
                weth: weth,
                dividends: p.genes.divShareBps != 0
            })
        );
        PoolKey memory key = _key(token, pair);
        (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = _initialPosition(_priceQ(pairUsd18));
        poolManager.initialize(key, sqrtPriceX96);
        IERC20(token).safeTransfer(address(hook), TOTAL_SUPPLY);
        hook.registerPool(key, token, pair, msg.sender, tickLower, tickUpper, p.genes);

        poolId = PoolId.unwrap(key.toId());
        listings[token] = Listing({creator: msg.sender, pair: pair, createdAt: uint64(block.timestamp), poolId: poolId});
        allTokens.push(token);
        emit Launched(token, msg.sender, pair, poolId, pairUsd18);

        if (msg.value > 0) {
            uint256 pairIn = IOnePairRouter(converter).ethToPair{value: msg.value}(pair, route, address(this), p.minPairOut);
            bytes memory res = poolManager.unlock(abi.encode(key, pairIn, msg.sender));
            emit DevBought(token, msg.sender, msg.value, pairIn, abi.decode(res, (uint256)));
        }
    }

    /// @dev The constitution's bounds on a coin's instincts.
    function _checkGenes(OneHook.Genes calldata g) internal view {
        if (g.feeMode > 2) revert BadGenes();
        if (g.feeBps < hook.MIN_FEE_BPS() || g.feeBps > hook.MAX_FEE_BPS()) revert BadGenes();
        if ((g.snipeBps == 0) != (g.snipeBlocks == 0)) revert BadGenes();
        if (g.snipeBps != 0 && (g.snipeBps <= g.feeBps || g.snipeBps > hook.MAX_SNIPE_BPS() || g.snipeBlocks < 5 || g.snipeBlocks > hook.MAX_SNIPE_BLOCKS())) revert BadGenes();
        if ((g.buybackShareBps == 0) != (g.buybackThreshold == 0)) revert BadGenes();
        if (g.buybackShareBps > hook.MAX_POT_EACH_BPS() || g.divShareBps > hook.MAX_POT_EACH_BPS()) revert BadGenes();
        if (uint256(g.buybackShareBps) + g.divShareBps > hook.MAX_POT_SHARE_BPS()) revert BadGenes();
        if (g.buybackShareBps != 0 && g.buybackThreshold < 1_000) revert BadGenes();
        if ((g.maxWalletBps == 0) != (g.maxWalletSecs == 0)) revert BadGenes();
        if (g.maxWalletBps != 0 && (g.maxWalletBps < 50 || g.maxWalletBps > 2_000 || g.maxWalletSecs < 600 || g.maxWalletSecs > 30 days)) revert BadGenes();
    }

    /// @dev The creator's first buy: a plain swap, coins to the creator.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotAdmin();
        (PoolKey memory key, uint256 pairIn, address to) = abi.decode(data, (PoolKey, uint256, address));
        BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: false, amountSpecified: -int256(pairIn), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}), "");
        if (d.amount1() < 0) {
            uint256 due = uint256(uint128(-d.amount1()));
            poolManager.sync(key.currency1);
            IERC20(Currency.unwrap(key.currency1)).safeTransfer(address(poolManager), due);
            poolManager.settle();
        }
        uint256 coinOut = d.amount0() > 0 ? uint256(uint128(d.amount0())) : 0;
        if (coinOut != 0) poolManager.take(key.currency0, to, coinOut);
        return abi.encode(coinOut);
    }

    function _key(address token, address pair) internal view returns (PoolKey memory key) {
        if (token >= pair) revert InvalidParams();
        key = PoolKey({currency0: Currency.wrap(token), currency1: Currency.wrap(pair), fee: LP_FEE, tickSpacing: TICK_SPACING, hooks: IHooks(address(hook))});
    }

    // ---------------------------------------------------------------------
    // Pricing
    // ---------------------------------------------------------------------

    function pairUsdPrice(address pair) external view returns (uint256) {
        return oracle.price(pair);
    }

    /// @dev Pair base units per coin base unit, scaled 1e36: (start cap / 1e9 coins) / pair price.
    function _priceQ(uint256 pairUsd18) internal view returns (uint256 priceQ) {
        priceQ = Math.mulDiv(startCapUsd8 * 1e10, 1e36, TOTAL_SUPPLY_WHOLE * pairUsd18);
        if (priceQ == 0) revert InvalidParams();
    }

    /// @dev Coin is currency0, so the start price is sqrt(pair per coin) and the
    ///      supply sits in a single position just above it.
    function _initialPosition(uint256 priceQ) internal pure returns (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) {
        uint160 target = uint160(Math.sqrt(Math.mulDiv(priceQ, 1 << 128, 1e36)) << 32);
        int24 tick = TickMath.getTickAtSqrtPrice(target);
        int24 aligned = (tick / TICK_SPACING) * TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) aligned -= TICK_SPACING;
        int24 maxTick = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        sqrtPriceX96 = TickMath.getSqrtPriceAtTick(aligned);
        tickLower = aligned + TICK_SPACING;
        tickUpper = maxTick;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function poolKeyOf(address token) external view returns (PoolKey memory key) {
        key = _key(token, listings[token].pair);
    }

    /// @notice The instincts `token` was born with.
    function genesOf(address token) external view returns (OneHook.Genes memory) {
        return hook.genesOf(token);
    }

    receive() external payable {}
}
