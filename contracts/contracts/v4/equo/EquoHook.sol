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
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IEquoCoin {
    function burn(uint256 amount) external;
    function distribute(uint256 amount) external;
    function totalShares() external view returns (uint256);
}

interface IEquoFeeRecipient {
    function feeRecipient() external view returns (address);
}

interface IEquoWrappedNative {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title EquoHook
/// @notice The one Uniswap V4 hook every EquoHook pool shares. It is a pure
///         swap-fee engine: it runs the coin's instincts (the per-coin
///         mechanics chosen at launch and burned into the pool) under a
///         constitution nothing can break. It holds no liquidity and has no
///         liquidity permissions at all: the launch position belongs to the
///         factory, which has no withdraw path either, so nobody can ever
///         move it. Nothing in this contract can add, remove or redirect pool
///         liquidity.
///
///         Every pool: coin = currency0, pair = currency1 (the deployer places
///         the coin below its pair). Buying pushes the price up.
///
///         The constitution (every coin, always):
///           - The coin is a plain ERC-20: fixed supply, no owner, and no
///             transfer logic of any kind. Everything here acts on swaps in
///             the coin's own pool, never on transfers.
///           - A sell can never be reverted by this hook, and never pays more
///             than the fee rules below. No code path blocks an exit.
///           - MEV-tax at the base: every swap's fee grows with the
///             transaction's priority fee above {MEV_FREE_PRIORITY}, capped at
///             {MEV_CAP_BPS} extra. A sandwich bot has to outbid the block to
///             bracket a victim, so the harder it bids, the more it pays the
///             pool. Ordinary wallets and read-only simulations (priority 0)
///             pay nothing extra.
///           - The launch block belongs to the creator: the only swap the pool
///             accepts in its first block is the creator's own first buy.
///           - The configured swap fee is capped at {MAX_FEE_BPS}. The one
///             further bounded exception a creator can opt into is anti-snipe
///             (launch-window only, <= {MAX_SNIPE_BPS}, decaying, buys only).
///           - The instincts are validated here as well as in the factory:
///             a pool can never be registered with a fee above {MAX_FEE_BPS},
///             an anti-snipe above {MAX_SNIPE_BPS}, or pots above their caps,
///             whatever contract calls {registerPool}.
///           - This hook never touches liquidity. The launch position is held
///             by the factory, which cannot remove it: the seed liquidity is
///             permanent for every coin.
///
///         The instincts (chosen per coin at launch, immutable afterwards):
///           - Fee engine: flat; dynamic (the fee widens while swaps cluster
///             and relaxes block by block when they stop); or MEV-tax (the
///             constitutional priority-fee tax at double slope).
///           - Anti-snipe: an extra tax on buys in the first blocks that
///             decays linearly from snipeBps back to the base fee.
///           - Reflexive buyback: a share of every fee accumulates and, past
///             the coin's threshold, market-buys the coin in its own pool and
///             burns it, inside the swap that tipped it over.
///           - Dividends: a share of every fee accumulates and is pushed to
///             the coin for holders to claim pro-rata (as ETH on a WETH pair).
///           - Max-wallet: while the coin's opening window runs, one wallet
///             (tx.origin) can buy at most its share of the supply from the
///             pool; the ledger is forgotten when the window ends. Sells and
///             plain transfers are never touched.
///
///         What's left of each fee splits 60% to the creator, 40% to the
///         platform, held as PoolManager claims until claimed by anyone.
///
///         Equo additions (v3):
///           - Cashback and referral: out of the platform's 40% only, a share
///             goes back to the trader (cashback) and a share to the trader's
///             referrer. The creator's 60% and the buyback and dividend pots
///             never change. Rewards are held as PoolManager claims per user
///             and pair asset and claimed with {claimRewards}.
///           - The trader is named by the trusted router (or the factory for
///             the creator's first buy) in hookData; any other swapper is
///             tx.origin. A referrer binds once per trader, through the router.
///           - The creator role can move: the factory changes it for a
///             two-step transfer or a community takeover. Fees already owed
///             are paid to the old creator first, by the factory.
contract EquoHook is BaseHook, IUnlockCallback, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    /// @notice Constitutional ceiling on the configured fee (flat or dynamic), in bps.
    uint16 public constant MAX_FEE_BPS = 300;
    uint16 public constant MIN_FEE_BPS = 10;
    /// @notice Of what's left after the buyback and dividend shares, the creator's part.
    uint16 public constant CREATOR_SPLIT_BPS = 6_000;
    uint16 public constant MAX_SNIPE_BPS = 3_000;
    uint32 public constant MAX_SNIPE_BLOCKS = 7_200; // ~24h of Ethereum blocks
    /// @notice Buyback + dividend shares of the fee may take at most this much.
    uint16 public constant MAX_POT_SHARE_BPS = 8_000;
    uint16 public constant MAX_POT_EACH_BPS = 5_000;
    /// @notice MEV-tax: priority fee up to this is free.
    uint256 public constant MEV_FREE_PRIORITY = 1 gwei;
    /// @notice MEV-tax: one bps per this much priority fee above the free band.
    uint256 public constant MEV_PRIORITY_UNIT = 0.05 gwei;
    /// @notice MEV-tax: at most this many bps on top of the base fee.
    uint16 public constant MEV_CAP_BPS = 2_000;
    /// @notice Cashback and referral may each take at most this share of the platform part.
    uint16 public constant MAX_REWARD_EACH_BPS = 5_000;

    /// @notice A buyback burn stops once the price has moved ~3% up (sqrt 1.0149^2), per call.
    uint256 public constant BUYBACK_SQRT_BPS = 10_149;

    int24 public constant TICK_SPACING = 10;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    /// @notice A coin can pre-commit at most this many evolution stages (stage 0 included).
    uint8 public constant MAX_STAGES = 6;

    bytes32 internal constant FEE_SLOT = keccak256("onehook.fee");
    bytes32 internal constant BPS_SLOT = keccak256("onehook.bps");

    address public immutable deployer;
    address public immutable weth;
    address public factory;
    /// @notice The router whose hookData names the trader and referrer. Set once, by the factory.
    address public router;
    /// @notice Share of the platform part paid back to the trader, in bps of that part.
    uint16 public cashbackBps;
    /// @notice Share of the platform part paid to the trader's referrer, in bps of that part.
    uint16 public referralBps;

    /// @notice A coin's instincts, fixed at launch. feeMode: 0 flat, 1 dynamic, 2 MEV-tax.
    struct Genes {
        uint8 feeMode;
        uint16 feeBps;
        uint16 snipeBps; // 0: no anti-snipe
        uint32 snipeBlocks;
        uint16 buybackShareBps; // 0: no buyback
        uint16 divShareBps; // 0: no dividends
        uint16 maxWalletBps; // enforced by the coin; recorded here
        uint32 maxWalletSecs;
        uint128 buybackThreshold; // pair units in the pot that trigger a buy & burn
    }

    /// @notice A pre-committed evolution stage. A coin starts at stage 0 and
    ///         advances, forward-only, to the next stage the first time the
    ///         pool's price reaches that stage's threshold. The factory proves
    ///         at launch that each advance only ever helps holders (lower fee,
    ///         bigger buyback/dividend shares, looser caps, same fee engine).
    struct Stage {
        uint160 sqrtThreshold; // pool sqrtPriceX96 at/above which this stage activates; 0 for stage 0
        uint64 mcapUsd8; // activation market cap, USD 8dp, frozen at launch (display only)
        Genes genes;
    }

    struct PoolConfig {
        address token;
        address pair;
        address creator;
        uint64 launchTime;
        uint64 launchBlock;
        bool registered;
        uint8 currentStage; // index into the coin's stages; 0 at launch
        uint8 stageCount; // number of pre-committed stages (1 = non-evolving)
        uint32 surgeBps; // dynamic fee state
        uint64 surgeBlock;
        Genes genes; // the active stage's genes
    }

    mapping(PoolId => PoolConfig) internal _config;
    mapping(PoolId => Stage[]) internal _stages;
    mapping(address token => PoolId) internal _poolOf;
    /// @notice Fee shares waiting as PoolManager claims in the pair currency, per coin.
    mapping(address token => uint256) public creatorOwed;
    mapping(address token => uint256) public platformOwed;
    mapping(address token => uint256) public buybackPot;
    mapping(address token => uint256) public dividendPot;
    /// @notice Coins bought from the pool per wallet while a coin's max-wallet window runs.
    ///         Gross cumulative per tx.origin: selling does not refill the allowance (that is
    ///         what closes buy-sell-rebuy cycling), and smart-wallet buys relayed by a shared
    ///         bundler EOA share that bundler's allowance for the few hours a window runs.
    mapping(PoolId => mapping(address => uint256)) public windowBought;
    /// @notice A trader's referrer, bound once on their first referred trade through the router.
    mapping(address trader => address) public referrerOf;
    /// @notice Cashback and referral rewards waiting per user, in each pair asset.
    mapping(address user => mapping(address pair => uint256)) public rewardsOwed;

    event PoolRegistered(address indexed token, address indexed pair, PoolId indexed id, address creator);
    event FeeTaken(address indexed token, uint256 fee, uint16 bps);
    event FactorySet(address indexed factory);
    event CreatorPaid(address indexed token, address indexed to, uint256 amount);
    event PlatformPaid(address indexed token, address indexed to, uint256 amount);
    event BuybackBurned(address indexed token, uint256 pairIn, uint256 coinsBurned);
    event DividendsPushed(address indexed token, uint256 amount);
    event Evolved(address indexed token, uint8 indexed stage, uint160 sqrtPriceX96);
    event RouterSet(address indexed router);
    event RewardSplitSet(uint16 cashbackBps, uint16 referralBps);
    event CreatorChanged(address indexed token, address indexed from, address indexed to);
    event ReferrerBound(address indexed trader, address indexed referrer);
    event RewardsCredited(address indexed token, address indexed trader, uint256 cashback, address indexed referrer, uint256 referral);
    event RewardsClaimed(address indexed user, address indexed pair, uint256 amount);

    error NotDeployer();
    error NotFactory();
    error AlreadySet();
    error ZeroAddress();
    error LaunchBlockClosed();
    error BuyCapExceeded();
    error NotThisPool();
    error BadGenes();
    error InvalidParams();
    error NothingToPush();
    error NoHolders();

    constructor(IPoolManager pm, address weth_) BaseHook(pm) {
        if (weth_ == address(0)) revert ZeroAddress();
        deployer = tx.origin;
        weth = weth_;
    }

    receive() external payable {}

    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /// @notice One-time: the router trusted to name traders and referrers. Factory only.
    function setRouter(address router_) external {
        if (msg.sender != factory) revert NotFactory();
        if (router != address(0)) revert AlreadySet();
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    /// @notice How the platform part is shared with traders and referrers. Factory only
    ///         (the admin's lever). It can only re-split the platform's own share.
    function setRewardSplit(uint16 cashbackBps_, uint16 referralBps_) external {
        if (msg.sender != factory) revert NotFactory();
        if (cashbackBps_ > MAX_REWARD_EACH_BPS || referralBps_ > MAX_REWARD_EACH_BPS) revert InvalidParams();
        cashbackBps = cashbackBps_;
        referralBps = referralBps_;
        emit RewardSplitSet(cashbackBps_, referralBps_);
    }

    /// @notice Move a coin's creator role. Factory only: it runs the two-step
    ///         transfer and the community takeover, and pays out what the old
    ///         creator is owed before calling this.
    function setCreator(address token, address newCreator) external {
        if (msg.sender != factory) revert NotFactory();
        if (newCreator == address(0)) revert ZeroAddress();
        PoolConfig storage c = _mustBeRegistered(token);
        emit CreatorChanged(token, c.creator, newCreator);
        c.creator = newCreator;
    }

    /// @notice Swap callbacks only. No initialize, liquidity or donate
    ///         permissions: the hook cannot gate, hold or move liquidity.
    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    // ---------------------------------------------------------------------
    // Launch: factory only
    // ---------------------------------------------------------------------

    /// @notice Register a freshly initialized pool with its instincts. Factory
    ///         only, once per pool. The factory seeds and holds the liquidity;
    ///         this hook only records what to charge and where it goes. Every
    ///         stage's genes are re-checked against the constitution here, so no
    ///         caller can register a fee or anti-snipe above the hook's caps.
    function registerPool(PoolKey calldata key, address token, address pair, address creator, Stage[] calldata stages) external {
        if (msg.sender != factory) revert NotFactory();
        if (Currency.unwrap(key.currency0) != token || Currency.unwrap(key.currency1) != pair) revert InvalidParams();
        if (key.fee != 0 || key.tickSpacing != TICK_SPACING || address(key.hooks) != address(this)) revert InvalidParams();
        if (stages.length == 0 || stages.length > MAX_STAGES || stages[0].sqrtThreshold != 0) revert InvalidParams();
        if (creator == address(0)) revert ZeroAddress();
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (c.registered) revert AlreadySet();
        c.token = token;
        c.pair = pair;
        c.creator = creator;
        c.launchTime = uint64(block.timestamp);
        c.launchBlock = uint64(block.number);
        c.registered = true;
        c.currentStage = 0;
        c.stageCount = uint8(stages.length);
        c.genes = stages[0].genes;
        // store the pre-committed stages; thresholds strictly increase, stage 0 is 0
        for (uint256 i; i < stages.length; i++) {
            if (i != 0 && stages[i].sqrtThreshold <= stages[i - 1].sqrtThreshold) revert InvalidParams();
            _checkGenes(stages[i].genes);
            _stages[id].push(stages[i]);
        }
        _poolOf[token] = id;
        emit PoolRegistered(token, pair, id, creator);
    }

    /// @dev The constitution's hard caps, enforced by the hook itself so they
    ///      hold for any registrar. The factory applies the finer rules
    ///      (pairings of fields, windows, evolution ordering) on top.
    function _checkGenes(Genes calldata g) internal pure {
        if (g.feeMode > 2) revert BadGenes();
        if (g.feeBps < MIN_FEE_BPS || g.feeBps > MAX_FEE_BPS) revert BadGenes();
        if (g.snipeBps > MAX_SNIPE_BPS || g.snipeBlocks > MAX_SNIPE_BLOCKS) revert BadGenes();
        if (g.buybackShareBps > MAX_POT_EACH_BPS || g.divShareBps > MAX_POT_EACH_BPS) revert BadGenes();
        if (uint256(g.buybackShareBps) + g.divShareBps > MAX_POT_SHARE_BPS) revert BadGenes();
        if (g.maxWalletBps > BPS) revert BadGenes();
    }

    // ---------------------------------------------------------------------
    // Fees out: anyone
    // ---------------------------------------------------------------------

    /// @notice Pay the creator's fee share to them. Anyone.
    function payCreator(address token) external nonReentrant returns (uint256 amount) {
        PoolConfig storage c = _mustBeRegistered(token);
        amount = creatorOwed[token];
        if (amount == 0) return 0;
        creatorOwed[token] = 0;
        poolManager.unlock(abi.encode(uint8(1), abi.encode(c.pair, c.creator, amount)));
        emit CreatorPaid(token, c.creator, amount);
    }

    /// @notice Pay the platform's fee share on `tokens` to the factory's fee recipient. Anyone.
    function pushPlatform(address[] calldata tokens) external nonReentrant {
        address to = IEquoFeeRecipient(factory).feeRecipient();
        for (uint256 i; i < tokens.length; i++) {
            PoolConfig storage c = _mustBeRegistered(tokens[i]);
            uint256 amount = platformOwed[tokens[i]];
            if (amount == 0) continue;
            platformOwed[tokens[i]] = 0;
            poolManager.unlock(abi.encode(uint8(1), abi.encode(c.pair, to, amount)));
            emit PlatformPaid(tokens[i], to, amount);
        }
    }

    /// @notice Spend the coin's buyback pot buying and burning it now, whatever
    ///         the threshold. Anyone. (Past the threshold the hook does this by
    ///         itself inside the swap that tipped it over.)
    function buybackBurn(address token) external nonReentrant returns (uint256 burned) {
        _mustBeRegistered(token);
        if (buybackPot[token] == 0) revert NothingToPush();
        burned = abi.decode(poolManager.unlock(abi.encode(uint8(3), abi.encode(_poolOf[token]))), (uint256));
    }

    /// @notice Claim your cashback and referral rewards in each of `pairs`.
    function claimRewards(address[] calldata pairs) external nonReentrant returns (uint256 total) {
        for (uint256 i; i < pairs.length; i++) {
            address pair = pairs[i];
            uint256 amount = rewardsOwed[msg.sender][pair];
            if (amount == 0) continue;
            rewardsOwed[msg.sender][pair] = 0;
            poolManager.unlock(abi.encode(uint8(1), abi.encode(pair, msg.sender, amount)));
            emit RewardsClaimed(msg.sender, pair, amount);
            total += amount;
        }
    }

    /// @notice Push the coin's dividend pot to the coin for holders to claim. Anyone.
    function pushDividends(address token) external nonReentrant returns (uint256 amount) {
        PoolConfig storage c = _mustBeRegistered(token);
        amount = dividendPot[token];
        if (amount == 0) revert NothingToPush();
        // the coin refuses dust-level distributions; mirror it so the pot keeps accruing instead
        if (IEquoCoin(token).totalShares() < SUPPLY / 10_000) revert NoHolders();
        dividendPot[token] = 0;
        poolManager.unlock(abi.encode(uint8(4), abi.encode(c.pair, token, amount)));
        IEquoCoin(token).distribute(amount);
        emit DividendsPushed(token, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function config(PoolId id) external view returns (PoolConfig memory) {
        return _config[id];
    }

    function poolOf(address token) external view returns (PoolId) {
        return _poolOf[token];
    }

    function creatorOf(address token) external view returns (address) {
        return _config[_poolOf[token]].creator;
    }

    function genesOf(address token) external view returns (Genes memory) {
        return _config[_poolOf[token]].genes;
    }

    /// @notice The coin's full pre-committed evolution path (stage 0 first).
    function stagesOf(address token) external view returns (Stage[] memory) {
        return _stages[_poolOf[token]];
    }

    /// @notice The fee a buy or sell by an ordinary sender pays right now, in
    ///         bps. For the dynamic mode this reads the decayed surge without
    ///         this swap's own bump; for the MEV-tax it assumes no priority fee.
    function feeBpsNow(address token, bool isBuy) external view returns (uint256 fee) {
        PoolConfig storage c = _config[_poolOf[token]];
        if (!c.registered) revert NotThisPool();
        Genes storage g = c.genes;
        fee = g.feeBps;
        if (g.feeMode == 1) {
            uint256 surge = c.surgeBps;
            uint256 decay = (uint256(g.feeBps) / 16 + 1) * (block.number - c.surgeBlock);
            surge = surge > decay ? surge - decay : 0;
            fee += surge;
            if (fee > MAX_FEE_BPS) fee = MAX_FEE_BPS;
        }
        if (isBuy && g.snipeBps != 0) {
            uint256 elapsed = block.number - c.launchBlock;
            if (elapsed < g.snipeBlocks && g.snipeBps > fee) fee = g.snipeBps - ((g.snipeBps - fee) * elapsed) / g.snipeBlocks;
        }
    }

    // ---------------------------------------------------------------------
    // Fee computation
    // ---------------------------------------------------------------------

    /// @dev The fee bps this swap pays. Mutates the dynamic surge, so it runs
    ///      once per swap, in beforeSwap.
    function _swapTaxBps(PoolId id, address sender, bool isBuy) internal returns (uint16) {
        PoolConfig storage c = _config[id];
        if (sender == address(this)) return 0;
        Genes storage g = c.genes;
        // the creator's first buy through the factory pays the flat base fee
        if (sender == factory) return g.feeBps;
        uint256 base = g.feeBps;
        if (g.feeMode == 1) base = _dynamicFee(c, g.feeBps);
        uint256 bps = base + _mevExtra(g.feeMode == 2);
        if (isBuy && g.snipeBps != 0) {
            uint256 elapsed = block.number - c.launchBlock;
            if (elapsed < g.snipeBlocks && g.snipeBps > bps) {
                return uint16(g.snipeBps - ((g.snipeBps - bps) * elapsed) / g.snipeBlocks);
            }
        }
        return uint16(bps);
    }

    /// @dev Dynamic fee: swaps bump a surge that decays block by block; the
    ///      fee is base + surge, clamped to the constitutional ceiling. Each
    ///      swap's own bump is felt by the next one.
    function _dynamicFee(PoolConfig storage c, uint16 baseBps) internal returns (uint256 fee) {
        uint256 surge = c.surgeBps;
        uint256 decay = (uint256(baseBps) / 16 + 1) * (block.number - c.surgeBlock);
        surge = surge > decay ? surge - decay : 0;
        fee = uint256(baseBps) + surge;
        if (fee > MAX_FEE_BPS) fee = MAX_FEE_BPS;
        surge += baseBps / 2;
        if (surge > MAX_FEE_BPS) surge = MAX_FEE_BPS;
        c.surgeBps = uint32(surge);
        c.surgeBlock = uint64(block.number);
    }

    /// @dev The constitutional MEV-tax: one bps per {MEV_PRIORITY_UNIT} of
    ///      priority fee above the free band (two with the mev-tax gene),
    ///      capped at {MEV_CAP_BPS}. An ordinary wallet pays nothing extra; a
    ///      sandwich bot bidding the block to bracket a victim pays the pool.
    function _mevExtra(bool doubled) internal view returns (uint256 extra) {
        uint256 priority = tx.gasprice > block.basefee ? tx.gasprice - block.basefee : 0;
        if (priority > MEV_FREE_PRIORITY) {
            extra = (priority - MEV_FREE_PRIORITY) / (doubled ? MEV_PRIORITY_UNIT / 2 : MEV_PRIORITY_UNIT);
            if (extra > MEV_CAP_BPS) extra = MEV_CAP_BPS;
        }
    }

    /// @dev Split a fee: the buyback and dividend shares into their pots, the
    ///      rest 60/40 creator/platform; cashback and referral come out of the
    ///      platform's 40% only.
    function _credit(PoolConfig storage c, uint256 fee, address trader, address ref) internal {
        Genes storage g = c.genes;
        uint256 bb = (fee * g.buybackShareBps) / BPS;
        uint256 dv = (fee * g.divShareBps) / BPS;
        uint256 rest = fee - bb - dv;
        uint256 creatorPart = (rest * CREATOR_SPLIT_BPS) / BPS;
        if (bb != 0) buybackPot[c.token] += bb;
        if (dv != 0) dividendPot[c.token] += dv;
        creatorOwed[c.token] += creatorPart;
        uint256 platformPart = rest - creatorPart;
        uint256 cb = trader != address(0) ? (platformPart * cashbackBps) / BPS : 0;
        uint256 rf = ref != address(0) ? (platformPart * referralBps) / BPS : 0;
        if (cb != 0) rewardsOwed[trader][c.pair] += cb;
        if (rf != 0) rewardsOwed[ref][c.pair] += rf;
        if (cb != 0 || rf != 0) emit RewardsCredited(c.token, trader, cb, ref, rf);
        platformOwed[c.token] += platformPart - cb - rf;
    }

    /// @dev Who this swap is for. The trusted router (and the factory, for the
    ///      creator's first buy) name the trader and an optional referrer in
    ///      hookData; anyone else trades as tx.origin. A referrer binds once per
    ///      trader and only through the router, so nobody can rebind someone
    ///      else's referrer by swapping in their name.
    function _traderOf(address sender, bytes calldata hookData) internal returns (address trader, address ref) {
        trader = tx.origin;
        if ((sender == router || sender == factory) && hookData.length == 64) {
            address named;
            (named, ref) = abi.decode(hookData, (address, address));
            if (named != address(0)) trader = named;
            if (sender == router && ref != address(0) && ref != trader && referrerOf[trader] == address(0)) {
                referrerOf[trader] = ref;
                emit ReferrerBound(trader, ref);
            }
        }
        ref = referrerOf[trader];
    }

    // ---------------------------------------------------------------------
    // PoolManager callback: pay claims (1), buyback (3), dividends (4).
    // There is deliberately no liquidity action of any kind.
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (action == 1) {
            (address pair, address to, uint256 amount) = abi.decode(payload, (address, address, uint256));
            Currency cur = Currency.wrap(pair);
            poolManager.burn(address(this), cur.toId(), amount);
            poolManager.take(cur, address(this), amount);
            _payPair(pair, to, amount);
            return "";
        }
        if (action == 3) {
            PoolId bid = abi.decode(payload, (PoolId));
            return abi.encode(_buybackBurn(bid));
        }
        if (action != 4) revert InvalidParams();
        // 4: dividends: burn the pot's claims and hand the pair tokens to the coin
        (address dPair, address dToken, uint256 dAmount) = abi.decode(payload, (address, address, uint256));
        Currency dCur = Currency.wrap(dPair);
        poolManager.burn(address(this), dCur.toId(), dAmount);
        poolManager.take(dCur, dToken, dAmount);
        return "";
    }

    /// @dev Spend the buyback pot in the coin's own pool and burn what it buys.
    ///      Runs inside an unlock: either afterSwap's (auto) or its own (manual).
    ///      One call moves the price at most ~3%, so sandwiching the burn can
    ///      never extract more than that from the pot; what the band leaves
    ///      unspent stays in the pot for the next call.
    function _buybackBurn(PoolId id) internal returns (uint256 burned) {
        PoolConfig storage c = _config[id];
        uint256 amount = buybackPot[c.token];
        if (amount == 0) return 0;
        PoolKey memory key = _keyOf(c);
        (uint160 sqrtP,,,) = poolManager.getSlot0(id);
        uint160 limit = uint160(Math.min((uint256(sqrtP) * BUYBACK_SQRT_BPS) / BPS, TickMath.MAX_SQRT_PRICE - 1));
        if (limit <= sqrtP) return 0;
        BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: false, amountSpecified: -int256(amount), sqrtPriceLimitX96: limit}), "");
        uint256 used = d.amount1() < 0 ? uint256(uint128(-d.amount1())) : 0;
        burned = d.amount0() > 0 ? uint256(uint128(d.amount0())) : 0;
        buybackPot[c.token] = amount - used;
        if (used != 0) poolManager.burn(address(this), key.currency1.toId(), used);
        if (burned != 0) {
            poolManager.take(key.currency0, address(this), burned);
            IEquoCoin(c.token).burn(burned);
        }
        emit BuybackBurned(c.token, used, burned);
    }

    /// @dev Advance the coin through its pre-committed stages: forward-only, to
    ///      the highest stage whose price threshold the pool has reached, and
    ///      swap in that stage's genes. Called on real swaps while more stages
    ///      remain. A sell lowers the price, so it can never move a coin back.
    function _maybeEvolve(PoolId id, PoolConfig storage c) internal {
        (uint160 sqrtP,,,) = poolManager.getSlot0(id);
        uint256 cur = c.currentStage;
        uint256 n = c.stageCount;
        uint256 next = cur;
        while (next + 1 < n && sqrtP >= _stages[id][next + 1].sqrtThreshold) next++;
        if (next != cur) {
            c.currentStage = uint8(next);
            c.genes = _stages[id][next].genes;
            // drop any inherited dynamic-fee surge: under the new (never-higher) base
            // fee it would decay more slowly, so clearing it keeps evolution holder-favorable.
            c.surgeBps = 0;
            c.surgeBlock = uint64(block.number);
            emit Evolved(c.token, uint8(next), sqrtP);
        }
    }

    function _keyOf(PoolConfig storage c) internal view returns (PoolKey memory) {
        return PoolKey({currency0: Currency.wrap(c.token), currency1: Currency.wrap(c.pair), fee: 0, tickSpacing: TICK_SPACING, hooks: this});
    }

    function _mustBeRegistered(address token) internal view returns (PoolConfig storage c) {
        c = _config[_poolOf[token]];
        if (!c.registered) revert NotThisPool();
    }

    function _payPair(address pair, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (pair == weth) {
            IEquoWrappedNative(weth).withdraw(amount);
            (bool ok,) = to.call{value: amount}("");
            if (!ok) {
                // a contract that refuses ETH gets WETH instead
                IEquoWrappedNative(weth).deposit{value: amount}();
                IERC20(weth).safeTransfer(to, amount);
            }
        } else {
            IERC20(pair).safeTransfer(to, amount);
        }
    }

    // ---------------------------------------------------------------------
    // Pool hooks
    // ---------------------------------------------------------------------

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (!c.registered) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        // the launch block belongs to the creator: the only BUY the pool accepts in its first
        // block is the factory's dev-buy swap. Sells are exempt, so a sell can never be
        // reverted in any block (in the launch block only the creator holds coins anyway).
        if (block.number == c.launchBlock && !params.zeroForOne && sender != factory && sender != address(this)) revert LaunchBlockClosed();
        uint16 bps = _swapTaxBps(id, sender, !params.zeroForOne);
        _tset(BPS_SLOT, bps);
        if (!_specifiedIsPair(params)) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint256 fee = (amount * bps) / BPS;
        _tset(FEE_SLOT, fee);
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (!c.registered) return (BaseHook.afterSwap.selector, 0);
        // max-wallet window: cap what one wallet can buy from the pool while it runs
        if (!params.zeroForOne && sender != address(this)) {
            Genes storage mw = c.genes;
            if (mw.maxWalletBps != 0 && block.timestamp < c.launchTime + mw.maxWalletSecs) {
                uint256 got = delta.amount0() > 0 ? uint256(uint128(delta.amount0())) : 0;
                uint256 total = windowBought[id][tx.origin] + got;
                if (total > (SUPPLY * mw.maxWalletBps) / BPS) revert BuyCapExceeded();
                windowBought[id][tx.origin] = total;
            }
        }

        uint16 bps = uint16(_tget(BPS_SLOT));
        _tset(BPS_SLOT, 0);
        uint256 fee;
        int128 ret = 0;
        if (_specifiedIsPair(params)) {
            fee = _tget(FEE_SLOT);
            _tset(FEE_SLOT, 0);
        } else {
            int128 unspecified = delta.amount1();
            uint256 amount = unspecified < 0 ? uint256(uint128(-unspecified)) : uint256(uint128(unspecified));
            fee = (amount * bps) / BPS;
            ret = int128(int256(fee));
        }
        if (fee == 0) return (BaseHook.afterSwap.selector, ret);
        poolManager.mint(address(this), key.currency1.toId(), fee);
        {
            (address trader, address ref) = _traderOf(sender, hookData);
            _credit(c, fee, trader, ref);
        }
        emit FeeTaken(c.token, fee, bps);
        // reflexive buyback then evolution, both only on real (non-hook) swaps
        if (sender != address(this)) {
            Genes storage g = c.genes;
            bool bought = g.buybackShareBps != 0 && buybackPot[c.token] >= g.buybackThreshold;
            if (bought) _buybackBurn(id);
            // evolution can only advance on a price rise: a buy, or a buyback that just pushed the price up
            if ((!params.zeroForOne || bought) && c.stageCount > c.currentStage + 1) _maybeEvolve(id, c);
        }
        return (BaseHook.afterSwap.selector, ret);
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
