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
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {EquoToken} from "./EquoToken.sol";
import {EquoTokenDeployer} from "./EquoTokenDeployer.sol";
import {EquoHook} from "./EquoHook.sol";
import {EquoLaunchRules} from "./EquoLaunchRules.sol";
import {IOneOracle} from "../onehook/IOneOracle.sol";

interface IEquoPairRouter {
    function ethToPair(address pair, bytes calldata route, address to, uint256 minOut) external payable returns (uint256 pairOut);
}

/// @title EquoFactory
/// @notice One-transaction launcher for EquoHook coins on Ethereum / Uniswap V4.
///         A coin is paired with WETH or any token the oracle can price
///         (tokenized gold, every Ondo tokenized stock). The whole 1B supply
///         goes into the pool at the start cap as a single position that THIS
///         contract holds. The hook never touches liquidity: it is a pure
///         swap-fee engine. The coin's instincts (fee engine, anti-snipe,
///         buyback, dividends, max-wallet) are chosen here at launch,
///         validated against the constitution, and nothing changes them
///         afterwards.
///
///         The launch position never leaves the pool: this contract has no
///         function that removes liquidity, the hook has no liquidity
///         permissions, and nobody (admin included) can withdraw it. The only
///         way coins leave the position is a buy.
///
///         Ownership (setup rights) is renounced after deploy; the immutable
///         `admin` keeps platform housekeeping only: pause, listing
///         visibility, metadata edits (stored here; the coin stays immutable),
///         token blocking, the fee recipient and the start cap. The admin
///         cannot mint, change a coin's fee or instincts, freeze transfers,
///         move anyone's coins, touch liquidity, or touch the fee pots owed to
///         creators, buybacks and dividends.
///
///         Equo additions (v3):
///           - Start cap presets: the admin keeps a short list of start caps and
///             each launch picks one.
///           - Creator metadata: a coin's creator can edit its displayed
///             metadata (an admin override still wins, for moderation).
///           - Creator transfer: two steps, the new creator must accept.
///           - Community takeover: once a creator has been idle for
///             {TAKEOVER_IDLE}, anyone staking at least {TAKEOVER_STAKE} of the
///             coin can propose a new creator. A bigger stake replaces a running
///             proposal (the earlier stake is returned and the clock restarts),
///             so the community can outbid a bad proposal. The creator can cancel
///             at any time during {TAKEOVER_DELAY}; after it, anyone executes.
///             Fees the old creator earned are paid to them first; every stake
///             goes back to its proposer.
///           - Reward split: the admin sets the cashback and referral shares,
///             which only ever come out of the platform's own part of a fee.
contract EquoFactory is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant TOTAL_SUPPLY_WHOLE = 1_000_000_000;
    int24 public constant TICK_SPACING = 10;
    uint24 public constant LP_FEE = 0;
    /// @notice A coin may pre-commit at most this many later evolution stages (on top of genesis).
    uint8 public constant MAX_EVOLUTION_STAGES = 5;
    /// @notice Coins kept out of the seed position to absorb rounding in the liquidity math.
    uint256 public constant COIN_SLACK = 1e12;
    uint256 public constant MAX_PRESETS = 4;
    /// @notice A creator must have done nothing for this long before a takeover can be proposed.
    uint256 public constant TAKEOVER_IDLE = 30 days;
    /// @notice The creator's window to cancel a takeover before anyone can execute it.
    uint256 public constant TAKEOVER_DELAY = 7 days;
    /// @notice The least a proposer locks here while a takeover runs (5% of supply); always returned.
    uint256 public constant TAKEOVER_STAKE = TOTAL_SUPPLY / 20;

    IPoolManager public immutable poolManager;
    EquoHook public immutable hook;
    address public immutable weth;
    address public immutable admin;
    EquoTokenDeployer public immutable tokenDeployer;
    /// @notice Every launch on this chain opens with a first buy of at least this much of the native coin, paid by
    ///         the creator (or, on the chains the creator did not pay on, by the launch service out of the launch
    ///         fee). No pool ever starts empty: there is always pair in it to sell into, so scanners and trading
    ///         bots that simulate a sell on a fresh coin never read it as a honeypot. Set per chain at deployment.
    uint256 public immutable minFirstBuy;
    IOneOracle public immutable oracle;

    address public converter;
    address public feeRecipient;
    bool public launchesPaused;
    /// @dev Start caps a launch can pick from, USD 8 dp. Index 0 is the default.
    uint64[] internal _capPresets;
    /// @notice The start cap each coin launched at, USD 8 dp.
    mapping(address token => uint64) public capOf;
    /// @notice Metadata the coin's current creator set; an admin override still wins.
    mapping(address token => string) public creatorMetadata;
    /// @notice A creator transfer waiting for the new creator to accept.
    mapping(address token => address) public pendingCreator;
    /// @notice When the coin's creator last acted through this factory (launch included).
    mapping(address token => uint64) public creatorActiveAt;

    struct Takeover {
        address proposer;
        uint64 startedAt;
        address newCreator;
        uint96 stake;
    }
    mapping(address token => Takeover) public takeovers;

    mapping(address => bool) public blocked;
    /// @notice Operators allowed to launch for a creator (the multichain launch service).
    mapping(address => bool) public launchers;

    struct Listing {
        address creator;
        address pair;
        uint64 createdAt;
        bytes32 poolId;
    }
    mapping(address token => Listing) public listings;

    /// @dev The one V4 position this factory holds per coin: the launch
    ///      liquidity. Recorded for reads only; nothing can remove it.
    struct Position {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }
    mapping(address token => Position) public positions;
    mapping(address token => bool) public hidden;
    mapping(address token => string) public metadataOverride;
    address[] public allTokens;
    address public owner;

    /// @notice A later evolution stage the coin pre-commits to at launch. It
    ///         activates the first time the pool's market cap reaches `mcapUsd8`
    ///         (frozen to a price threshold at launch). Each stage may only help
    ///         holders relative to the one before it; the factory enforces that.
    struct StageParam {
        uint64 mcapUsd8; // activation market cap, USD 8dp; strictly above the start cap and each earlier stage
        EquoHook.Genes genes;
    }

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        address pair; // zero for WETH
        uint256 minPairOut;
        uint8 capPreset; // index into capPresets()
        EquoHook.Genes genes; // genesis (stage 0) instincts
        StageParam[] stages; // optional later stages; empty = a non-evolving coin
    }

    event LauncherSet(address indexed launcher, bool allowed);
    event Launched(address indexed token, address indexed creator, address indexed pair, bytes32 poolId, uint256 pairUsdPrice);
    event DevBought(address indexed token, address indexed creator, uint256 ethIn, uint256 pairIn, uint256 coinOut);
    event HiddenSet(address indexed token, bool hidden);
    event CoinMetadataSet(address indexed token, string uri);
    event LaunchesPausedSet(bool paused);
    event FeeRecipientSet(address indexed recipient);
    event ConverterSet(address indexed converter);
    event OwnershipRenounced();
    event TokenBlocked(address indexed token, bool blocked);
    event Collected(address indexed token, uint16 bps, uint128 liquidity, uint256 coins, uint256 pair, address indexed to);
    event StartCapSet(uint256 usd8);
    event CapPresetsSet(uint64[] usd8);
    event CreatorMetadataSet(address indexed token, string uri);
    event CreatorTransferStarted(address indexed token, address indexed from, address indexed to);
    event CreatorTransferred(address indexed token, address indexed from, address indexed to);
    event CreatorActive(address indexed token, address indexed creator);
    event TakeoverProposed(address indexed token, address indexed proposer, address indexed newCreator);
    event TakeoverCancelled(address indexed token, address indexed by);
    event TakeoverExecuted(address indexed token, address indexed from, address indexed to);

    error LaunchesPaused();
    error FirstBuyTooSmall();
    error InvalidParams();
    error BadGenes();
    error NotAdmin();
    error ZeroAddress();
    error Blocked();
    error NotCreator();
    error TakeoverClosed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAdminOrOwner() {
        if (msg.sender != admin && msg.sender != owner) revert NotAdmin();
        _;
    }

    constructor(address owner_, address admin_, IPoolManager poolManager_, EquoHook hook_, EquoTokenDeployer tokenDeployer_, address weth_, IOneOracle oracle_, address feeRecipient_, uint256 minFirstBuy_) {
        if (admin_ == address(0) || weth_ == address(0) || address(oracle_) == address(0)) revert ZeroAddress();
        if (minFirstBuy_ == 0) revert InvalidParams();
        minFirstBuy = minFirstBuy_;
        owner = owner_;
        admin = admin_;
        poolManager = poolManager_;
        hook = hook_;
        tokenDeployer = tokenDeployer_;
        weth = weth_;
        oracle = oracle_;
        feeRecipient = feeRecipient_ == address(0) ? admin_ : feeRecipient_;
        _capPresets.push(3_000e8);
    }

    modifier onlyCreator(address token) {
        if (msg.sender != hook.creatorOf(token)) revert NotCreator();
        _;
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

    /// @notice Displayed metadata: the admin override, else the creator's, else the coin's own.
    function metadataOf(address token) external view returns (string memory) {
        string memory o = metadataOverride[token];
        if (bytes(o).length > 0) return o;
        o = creatorMetadata[token];
        return bytes(o).length > 0 ? o : EquoToken(payable(token)).metadataURI();
    }

    function setFeeRecipient(address recipient) external onlyAdmin {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice One-time: the router (ETH <-> pair token routing). The hook trusts
    ///         it to name the trader and referrer of each swap.
    function setConverter(address converter_) external onlyAdminOrOwner {
        if (converter != address(0) || converter_ == address(0)) revert InvalidParams();
        converter = converter_;
        hook.setRouter(converter_);
        emit ConverterSet(converter_);
    }

    /// @notice Cashback and referral shares, each in bps of the platform's part of a fee.
    ///         The deployer can set the launch values until it renounces; the admin always can.
    function setRewardSplit(uint16 cashbackBps, uint16 referralBps) external onlyAdminOrOwner {
        hook.setRewardSplit(cashbackBps, referralBps);
    }

    /// @notice Block or unblock a token as a pair. Coins already launched keep trading.
    function setLauncher(address launcher, bool allowed) external onlyAdmin {
        launchers[launcher] = allowed;
        emit LauncherSet(launcher, allowed);
    }

    function setTokenBlocked(address token, bool blocked_) external onlyAdmin {
        if (token == address(0) || token == weth) revert InvalidParams();
        blocked[token] = blocked_;
        emit TokenBlocked(token, blocked_);
    }

    /// @notice Start caps a launch can pick from, USD 8 dp ($1,000 to $1,000,000 each,
    ///         1 to {MAX_PRESETS} of them). Coins already launched are unaffected.
    function setCapPresets(uint64[] calldata usd8) external onlyAdminOrOwner {
        if (usd8.length == 0 || usd8.length > MAX_PRESETS) revert InvalidParams();
        delete _capPresets;
        for (uint256 i; i < usd8.length; i++) {
            if (usd8[i] < 1_000e8 || usd8[i] > 1_000_000e8) revert InvalidParams();
            _capPresets.push(usd8[i]);
        }
        emit CapPresetsSet(usd8);
    }

    /// @notice Start cap for coins launched from now on, USD 8 dp ($1,000 to $100,000):
    ///         sets the default preset (preset 0). Same lever as OneHook's.
    function setStartCap(uint256 usd8) external onlyAdmin {
        if (usd8 < 1_000e8 || usd8 > 100_000e8) revert InvalidParams();
        _capPresets[0] = uint64(usd8);
        emit StartCapSet(usd8);
    }

    /// @notice Admin-only: pull `bps` of a coin's launch position (coins and
    ///         pair) out of its pool to `recipient`. Not reversible. Same as
    ///         OneHook's deployed factory: the one power anyone has over pool
    ///         liquidity; the hook has none. The fee pots owed to creators,
    ///         holders and buybacks, and the rewards owed to traders, are never touched.
    function collect(address token, uint16 bps, address recipient) external onlyAdmin nonReentrant returns (uint256 coins, uint256 pair) {
        if (bps == 0 || bps > 10_000 || recipient == address(0)) revert InvalidParams();
        Listing storage l = listings[token];
        if (l.createdAt == 0) revert InvalidParams();
        Position storage pos = positions[token];
        uint128 removed = uint128((uint256(pos.liquidity) * bps) / 10_000);
        if (removed == 0) revert InvalidParams();
        pos.liquidity -= removed;
        PoolKey memory key = _key(token, l.pair);
        bytes memory res = poolManager.unlock(abi.encode(uint8(2), abi.encode(key, pos.tickLower, pos.tickUpper, removed, recipient)));
        (coins, pair) = abi.decode(res, (uint256, uint256));
        emit Collected(token, bps, removed, coins, pair, recipient);
    }

    function capPresets() external view returns (uint64[] memory) {
        return _capPresets;
    }

    /// @notice The default start cap (preset 0), USD 8 dp.
    function startCapUsd8() external view returns (uint256) {
        return _capPresets[0];
    }

    // ---------------------------------------------------------------------
    // Creator: metadata, transfer, activity
    // ---------------------------------------------------------------------

    /// @notice Set the coin's displayed metadata (logo, description, links). Creator only.
    function setCreatorMetadata(address token, string calldata uri) external onlyCreator(token) {
        creatorMetadata[token] = uri;
        _active(token);
        emit CreatorMetadataSet(token, uri);
    }

    /// @notice Offer the creator role to `to`; they become creator when they accept.
    ///         Zero cancels a pending offer. Creator only.
    function transferCreator(address token, address to) external onlyCreator(token) {
        pendingCreator[token] = to;
        _active(token);
        emit CreatorTransferStarted(token, msg.sender, to);
    }

    /// @notice Accept a creator role offered to you.
    function acceptCreator(address token) external nonReentrant {
        if (msg.sender != pendingCreator[token] || msg.sender == address(0)) revert NotCreator();
        address from = hook.creatorOf(token);
        _endTakeover(token, msg.sender);
        _changeCreator(token, msg.sender);
        emit CreatorTransferred(token, from, msg.sender);
    }

    /// @notice Show you are still running the coin; resets the takeover clock. Creator only.
    function poke(address token) external onlyCreator(token) {
        _active(token);
    }

    /// @notice Claim the creator's fees and reset the takeover clock. Creator only.
    function claimCreatorFees(address token) external onlyCreator(token) returns (uint256) {
        _active(token);
        return hook.payCreator(token);
    }

    function _active(address token) internal {
        creatorActiveAt[token] = uint64(block.timestamp);
        emit CreatorActive(token, msg.sender);
    }

    /// @dev Pay the outgoing creator what they earned, then hand the role over.
    function _changeCreator(address token, address to) internal {
        hook.payCreator(token);
        hook.setCreator(token, to);
        delete pendingCreator[token];
        creatorActiveAt[token] = uint64(block.timestamp);
    }

    // ---------------------------------------------------------------------
    // Community takeover
    // ---------------------------------------------------------------------

    /// @notice Propose `newCreator` for a coin whose creator has been idle for
    ///         {TAKEOVER_IDLE}, locking `stake` of the coin here (approve it
    ///         first; at least {TAKEOVER_STAKE}). A running proposal can only be
    ///         replaced by a bigger stake; the earlier one is returned and the
    ///         delay restarts. Every stake comes back when its proposal ends.
    function proposeTakeover(address token, address newCreator, uint256 stake) external nonReentrant {
        if (listings[token].createdAt == 0 || newCreator == address(0) || stake < TAKEOVER_STAKE || stake > TOTAL_SUPPLY) revert InvalidParams();
        if (block.timestamp < uint256(creatorActiveAt[token]) + TAKEOVER_IDLE) revert TakeoverClosed();
        if (stake <= takeovers[token].stake) revert TakeoverClosed();
        IERC20(token).safeTransferFrom(msg.sender, address(this), stake);
        _endTakeover(token, msg.sender);
        takeovers[token] = Takeover({proposer: msg.sender, startedAt: uint64(block.timestamp), newCreator: newCreator, stake: uint96(stake)});
        emit TakeoverProposed(token, msg.sender, newCreator);
    }

    /// @notice Cancel a running takeover: the creator (which also resets their
    ///         idle clock) or the proposer. The stake goes back to the proposer.
    function cancelTakeover(address token) external nonReentrant {
        Takeover memory t = takeovers[token];
        if (t.proposer == address(0)) revert TakeoverClosed();
        bool isCreator = msg.sender == hook.creatorOf(token);
        if (!isCreator && msg.sender != t.proposer) revert NotCreator();
        if (isCreator) _active(token);
        _endTakeover(token, msg.sender);
    }

    /// @notice Hand the coin to the proposed creator once {TAKEOVER_DELAY} has
    ///         passed with no sign of the old creator. Anyone.
    function executeTakeover(address token) external nonReentrant {
        Takeover memory t = takeovers[token];
        if (t.proposer == address(0) || block.timestamp < uint256(t.startedAt) + TAKEOVER_DELAY) revert TakeoverClosed();
        if (creatorActiveAt[token] >= t.startedAt) revert TakeoverClosed();
        address from = hook.creatorOf(token);
        _endTakeover(token, address(0));
        _changeCreator(token, t.newCreator);
        emit TakeoverExecuted(token, from, t.newCreator);
    }

    /// @dev Close any running takeover and return the stake to its proposer.
    function _endTakeover(address token, address by) internal {
        Takeover memory t = takeovers[token];
        if (t.proposer == address(0)) return;
        delete takeovers[token];
        IERC20(token).safeTransfer(t.proposer, t.stake);
        if (by != address(0)) emit TakeoverCancelled(token, by);
    }

    /// @notice Give up the deployer's setup rights; the admin keeps its own.
    function renounceOwnership() external {
        if (msg.sender != owner) revert NotAdmin();
        owner = address(0);
        emit OwnershipRenounced();
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
    function launch(LaunchParams calldata p, bytes32 salt, bytes calldata route, bytes calldata peers) external payable nonReentrant returns (address token, bytes32 poolId) {
        return _launch(msg.sender, p, salt, route, peers);
    }

    /// @notice Launch for `creator` (an approved launcher only): how a coin goes live on the chains its creator
    ///         did not pay on. The creator gets the role, the fees and any first-buy coins.
    function launchFor(address creator, LaunchParams calldata p, bytes32 salt, bytes calldata route, bytes calldata peers)
        external
        payable
        nonReentrant
        returns (address token, bytes32 poolId)
    {
        if (!launchers[msg.sender] || creator == address(0)) revert NotAdmin();
        return _launch(creator, p, salt, route, peers);
    }

    function _launch(address creator, LaunchParams calldata p, bytes32 salt, bytes calldata route, bytes calldata peers)
        internal
        returns (address token, bytes32 poolId)
    {
        if (launchesPaused) revert LaunchesPaused();
        if (msg.value < minFirstBuy) revert FirstBuyTooSmall();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0 || converter == address(0)) revert InvalidParams();
        address pair = p.pair == address(0) ? weth : p.pair;
        if (blocked[pair]) revert Blocked();
        uint256 pairUsd18 = oracle.launchPrice(pair);
        if (p.capPreset >= _capPresets.length) revert InvalidParams();
        uint256 capUsd8 = _capPresets[p.capPreset];
        // validate + freeze the evolution path up front, before anything is deployed
        EquoHook.Stage[] memory stages = _buildStages(p.genes, p.stages, pairUsd18, capUsd8);
        token = _createToken(creator, p, salt, pair, peers);
        PoolKey memory key = _key(token, pair);
        (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = _initialPosition(_priceQ(pairUsd18, capUsd8));
        poolManager.initialize(key, sqrtPriceX96);
        // the hook records the instincts; the liquidity stays ours
        hook.registerPool(key, token, pair, creator, stages);

        poolId = PoolId.unwrap(key.toId());
        listings[token] = Listing({creator: creator, pair: pair, createdAt: uint64(block.timestamp), poolId: poolId});
        allTokens.push(token);
        capOf[token] = uint64(capUsd8);
        creatorActiveAt[token] = uint64(block.timestamp);

        // seed the whole supply as one single-sided position above the start price, held here
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount0(
            TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), TOTAL_SUPPLY - COIN_SLACK
        );
        positions[token] = Position({tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity});
        poolManager.unlock(abi.encode(uint8(0), abi.encode(key, tickLower, tickUpper, liquidity)));
        emit Launched(token, creator, pair, poolId, pairUsd18);

        if (msg.value > 0) _firstBuy(token, key, pair, route, creator, p.minPairOut);
    }

    /// @dev Create the coin through the token deployer. The salt is the creator's: nobody else can take a coin's
    ///      address on a chain it has not launched on yet. Kept out of {_launch} for stack depth.
    function _createToken(address creator, LaunchParams calldata p, bytes32 salt, address pair, bytes calldata peers) internal returns (address) {
        bool divs = p.genes.divShareBps != 0;
        for (uint256 i; i < p.stages.length && !divs; i++) {
            if (p.stages[i].genes.divShareBps != 0) divs = true;
        }
        return tokenDeployer.deploy(
            keccak256(abi.encode(creator, salt)),
            EquoTokenDeployer.Init({
                name: p.name,
                symbol: p.symbol,
                metadataURI: p.metadataURI,
                supply: TOTAL_SUPPLY,
                pairAsset: pair,
                poolManager: address(poolManager),
                hook: address(hook),
                converter: converter,
                weth: weth,
                bridgeFeeTo: feeRecipient,
                dividends: divs
            }),
            peers
        );
    }

    /// @dev The creator's first buy: the attached native coin becomes the pair token along `route` and is swapped in
    ///      the fresh pool; the coins go to the creator.
    function _firstBuy(address token, PoolKey memory key, address pair, bytes calldata route, address creator, uint256 minPairOut) internal {
        uint256 pairIn = IEquoPairRouter(converter).ethToPair{value: msg.value}(pair, route, address(this), minPairOut);
        bytes memory res = poolManager.unlock(abi.encode(uint8(1), abi.encode(key, pairIn, creator)));
        emit DevBought(token, creator, msg.value, pairIn, abi.decode(res, (uint256)));
    }

    /// @dev Validate and freeze a coin's evolution path. Stage 0 is genesis;
    ///      each later stage must pass the constitution (`_checkGenes`), sit
    ///      strictly above the start cap and every earlier stage in market cap,
    ///      and only ever help holders (`_checkEvolve`). Its USD milestone is
    ///      frozen to a pool price threshold with the launch oracle price, so
    ///      the hook never needs an oracle after launch.
    function _buildStages(EquoHook.Genes calldata genesis, StageParam[] calldata later, uint256 pairUsd18, uint256 capUsd8)
        internal
        view
        returns (EquoHook.Stage[] memory stages)
    {
        EquoLaunchRules.checkGenes(genesis, hook); // genesis passes the constitution first; later stages below
        uint256 n = later.length;
        if (n > MAX_EVOLUTION_STAGES) revert BadGenes();
        stages = new EquoHook.Stage[](n + 1);
        stages[0] = EquoHook.Stage({sqrtThreshold: 0, mcapUsd8: 0, genes: genesis});
        uint256 prevUsd = capUsd8;
        uint160 prevSqrt = 0;
        for (uint256 i; i < n; i++) {
            EquoHook.Genes calldata g = later[i].genes;
            EquoLaunchRules.checkGenes(g, hook);
            EquoLaunchRules.checkEvolve(stages[i].genes, g);
            uint256 usd = later[i].mcapUsd8;
            if (usd <= prevUsd || usd > 1_000_000_000e8) revert BadGenes();
            uint160 sqrtT = _sqrtPriceForCap(usd, pairUsd18);
            if (sqrtT <= prevSqrt) revert BadGenes();
            stages[i + 1] = EquoHook.Stage({sqrtThreshold: sqrtT, mcapUsd8: uint64(usd), genes: g});
            prevUsd = usd;
            prevSqrt = sqrtT;
        }
    }

    /// @dev The pool sqrtPriceX96 a coin reaches at `usd8` market cap, using the
    ///      launch oracle price for the pair. Mirrors `_initialPosition`'s target
    ///      so a stage threshold lines up with the price pipeline the pool uses.
    function _sqrtPriceForCap(uint256 usd8, uint256 pairUsd18) internal pure returns (uint160) {
        uint256 priceQ = Math.mulDiv(usd8 * 1e10, 1e36, TOTAL_SUPPLY_WHOLE * pairUsd18);
        if (priceQ == 0) revert BadGenes();
        uint256 s = Math.sqrt(Math.mulDiv(priceQ, 1 << 128, 1e36)) << 32;
        if (s == 0 || s >= uint256(TickMath.MAX_SQRT_PRICE)) revert BadGenes();
        return uint160(s);
    }

    /// @dev PoolManager callback: seed the launch position (0), the creator's
    ///      first buy (1). There is no liquidity-removal action: the seed
    ///      position is permanent.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotAdmin();
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (action == 0) {
            (PoolKey memory key, int24 lower, int24 upper, uint128 liquidity) = abi.decode(payload, (PoolKey, int24, int24, uint128));
            (BalanceDelta d,) = poolManager.modifyLiquidity(key, ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)}), "");
            _pay(key.currency0, d.amount0());
            _pay(key.currency1, d.amount1());
            return "";
        }
        if (action == 1) {
            (PoolKey memory key, uint256 pairIn, address to) = abi.decode(payload, (PoolKey, uint256, address));
            BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: false, amountSpecified: -int256(pairIn), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}), abi.encode(to, address(0)));
            _pay(key.currency1, d.amount1());
            uint256 coinOut = d.amount0() > 0 ? uint256(uint128(d.amount0())) : 0;
            if (coinOut != 0) poolManager.take(key.currency0, to, coinOut);
            return abi.encode(coinOut);
        }
        if (action != 2) revert InvalidParams();
        (PoolKey memory ck, int24 cl, int24 cu, uint128 removed, address recipient) = abi.decode(payload, (PoolKey, int24, int24, uint128, address));
        (BalanceDelta cd,) = poolManager.modifyLiquidity(ck, ModifyLiquidityParams({tickLower: cl, tickUpper: cu, liquidityDelta: -int256(uint256(removed)), salt: bytes32(0)}), "");
        uint256 coinsOut = _takeTo(ck.currency0, cd.amount0(), recipient);
        uint256 pairOut = _takeTo(ck.currency1, cd.amount1(), recipient);
        return abi.encode(coinsOut, pairOut);
    }

    /// @dev Take a positive delta straight to `to`; returns the amount taken.
    function _takeTo(Currency currency, int128 amount, address to) internal returns (uint256 value) {
        if (amount <= 0) return 0;
        value = uint256(uint128(amount));
        poolManager.take(currency, to, value);
    }

    /// @dev Settle what this contract owes the PoolManager for `currency` (a negative delta).
    function _pay(Currency currency, int128 amount) internal {
        if (amount >= 0) return;
        uint256 due = uint256(uint128(-amount));
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), due);
        poolManager.settle();
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
    function _priceQ(uint256 pairUsd18, uint256 capUsd8) internal pure returns (uint256 priceQ) {
        priceQ = Math.mulDiv(capUsd8 * 1e10, 1e36, TOTAL_SUPPLY_WHOLE * pairUsd18);
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

    /// @notice The launch position this factory holds for `token`.
    function positionOf(address token) external view returns (Position memory) {
        return positions[token];
    }

    receive() external payable {}
}
