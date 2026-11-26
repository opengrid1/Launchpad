// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IB20FactoryMin, IB20TokenMin} from "../base/IB20Min.sol";
import {BasketOwnable} from "./BasketOwnable.sol";
import {BasketFeeHook} from "./BasketFeeHook.sol";
import {BasketVaultDeployer} from "./BasketVaultDeployer.sol";
import {ISlipstreamRouter} from "./ISlipstreamRouter.sol";

interface IWETHLike {
    function deposit() external payable;
}

/// @title BasketFactory
/// @notice Launches "coins that pay holders" on Base.
///
///         One transaction mints a fixed 1B-supply B-20 coin with no admin
///         left on it, opens its Uniswap v4 pool against an approved pair
///         token, seeds the whole supply single-sided from the pair's start
///         market cap, and makes the creator's required opening buy.
///
///         LIQUIDITY IS PROTOCOL-MANAGED, NOT LOCKED. The liquidity position
///         of every coin is held by this contract, and the owner can withdraw
///         any share of it at any time with `collect`, receiving both the
///         coins and the pair tokens buyers paid in. Anything that describes
///         these launches to users must say so.
///
///         The creator chooses where the coin's share of trade fees goes:
///           - Holders: to a reward vault that pays holders in the reward
///             token the creator picked (the pair itself, or an approved
///             token such as a tokenized stock).
///           - Creator: to the creator's fee wallet.
///
///         Admin follows the BuzzPad model: a single owner with two-step
///         handover that cannot be renounced. The owner sets the launch
///         switch, launch fee, pair configs, reward-token allowlist, fee
///         policy for future launches, keeper and swap router, and can
///         `collect` liquidity. The settings never change the fee terms of a
///         coin that has already launched.
contract BasketFactory is BasketOwnable, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 private constant BPS = 10_000;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    int24 public constant TICK_SPACING = 60;
    uint24 public constant LP_FEE = 0;
    /// @notice Hard ceilings no admin setting can exceed.
    uint16 public constant MAX_TAX_BPS = 200;
    uint16 public constant MAX_OPENING_BUY_BPS = 500;
    uint256 public constant MAX_LAUNCH_FEE = 0.05 ether;

    enum FeeMode {
        Holders,
        Creator
    }

    /// @notice Fee levels snapshotted into each pool at launch. All values are
    ///         bps of the trade. The protocol takes whatever the coin's side
    ///         (holders or creator) does not.
    struct FeePolicy {
        uint16 preTaxBps;
        uint16 postTaxBps;
        uint16 holdersPreBps;
        uint16 holdersPostBps;
        uint16 creatorPreBps;
        uint16 creatorPostBps;
    }

    /// @notice Launch terms for one pair token, in that token's base units.
    struct PairConfig {
        bool enabled;
        /// @dev Market cap the coin opens at.
        uint256 startMcap;
        /// @dev Market cap at which the coin graduates to the lower fee.
        uint256 gradMcap;
        /// @dev Smallest opening buy the creator must make.
        uint256 minOpeningBuy;
    }

    /// @dev Same shape as the StockFly factories so the existing
    ///      StockTradeRouter can trade Basket coins unchanged.
    struct Listing {
        address creator;
        address pair;
        uint16 taxBps;
        uint64 createdAt;
        bytes32 poolId;
    }

    struct LaunchInfo {
        FeeMode feeMode;
        /// @dev Token holders are paid in (Holders mode), else zero.
        address rewardToken;
        /// @dev The coin's reward vault (Holders mode), else zero.
        address vault;
        /// @dev The creator's fee wallet (Creator mode), else zero.
        address feeRecipient;
    }

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        address pair;
        FeeMode feeMode;
        /// @dev Holders mode: token holders earn. Zero means the pair token.
        address rewardToken;
        /// @dev Creator mode: fee wallet. Zero means the launcher.
        address feeRecipient;
        /// @dev Opening buy size for a non-WETH pair, pulled from the launcher.
        ///      For a WETH pair the opening buy is `msg.value - launchFee`.
        uint256 openingBuyIn;
        uint256 minTokensOut;
    }

    struct Position {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    IPoolManager public immutable poolManager;
    BasketFeeHook public immutable hook;
    BasketVaultDeployer public immutable vaultDeployer;
    IB20FactoryMin public immutable b20Factory;
    address public immutable weth;

    bool public launchEnabled = true;
    uint256 public launchFee;
    /// @notice Most of the supply a creator may take in the opening buy.
    uint16 public maxOpeningBuyBps = 200;
    /// @notice The wallet that runs reward swaps and posts payout roots for
    ///         every vault this factory deploys.
    address public keeper;
    /// @notice Router new vaults will use to swap the pair into the reward.
    ISlipstreamRouter public swapRouter;
    FeePolicy public feePolicy;

    mapping(address pair => PairConfig) public pairConfig;
    mapping(address token => bool) public rewardTokenApproved;

    mapping(address token => Listing) public listings;
    mapping(address token => LaunchInfo) public launchInfo;
    mapping(address token => Position) public positions;
    mapping(address token => string) public metadataURIOf;
    address[] public allTokens;
    mapping(address creator => address[]) internal _tokensByCreator;

    error LaunchDisabled();
    error InvalidTokenParams();
    error InvalidConfig();
    error PairNotEnabled();
    error RewardTokenNotApproved();
    error LaunchFeeNotPaid();
    error OpeningBuyTooSmall(uint256 got, uint256 minimum);
    error OpeningBuyTooLarge(uint256 tokensOut, uint256 cap);
    error OpeningBuySlippage(uint256 tokensOut, uint256 minimum);
    error NotPoolManager();
    error TokenNotFound();
    error NothingToCollect();

    event TokenLaunched(
        address indexed token,
        address indexed creator,
        address indexed pair,
        bytes32 poolId,
        FeeMode feeMode,
        address rewardToken,
        address beneficiary
    );
    event OpeningBuy(address indexed token, address indexed buyer, uint256 pairIn, uint256 tokensOut);
    event Collected(address indexed token, uint16 bps, uint256 tokenAmount, uint256 pairAmount, address indexed recipient);
    event LaunchEnabledUpdated(bool enabled);
    event LaunchFeeUpdated(uint256 launchFee);
    event MaxOpeningBuyUpdated(uint16 bps);
    event KeeperUpdated(address keeper);
    event SwapRouterUpdated(address swapRouter);
    event FeePolicyUpdated(FeePolicy policy);
    event PairConfigUpdated(address indexed pair, PairConfig config);
    event RewardTokenApprovalUpdated(address indexed token, bool approved);

    constructor(
        address owner_,
        IPoolManager poolManager_,
        BasketFeeHook hook_,
        BasketVaultDeployer vaultDeployer_,
        IB20FactoryMin b20Factory_,
        address weth_,
        address keeper_,
        ISlipstreamRouter swapRouter_
    ) BasketOwnable(owner_) {
        if (
            address(poolManager_) == address(0) || address(hook_) == address(0) || address(vaultDeployer_) == address(0)
                || address(b20Factory_) == address(0) || weth_ == address(0) || keeper_ == address(0)
                || address(swapRouter_) == address(0)
        ) revert ZeroAddress();
        poolManager = poolManager_;
        hook = hook_;
        vaultDeployer = vaultDeployer_;
        b20Factory = b20Factory_;
        weth = weth_;
        keeper = keeper_;
        swapRouter = swapRouter_;
        // Basket's schedule: 2% before graduation, 1.25% after. Holders mode
        // gives holders 0.5% then 0.67%; creator mode gives the creator 1%
        // then 0.67%. The protocol takes the rest.
        feePolicy = FeePolicy({
            preTaxBps: 200,
            postTaxBps: 125,
            holdersPreBps: 50,
            holdersPostBps: 67,
            creatorPreBps: 100,
            creatorPostBps: 67
        });
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setLaunchEnabled(bool enabled) external onlyOwner {
        launchEnabled = enabled;
        emit LaunchEnabledUpdated(enabled);
    }

    function setLaunchFee(uint256 newLaunchFee) external onlyOwner {
        if (newLaunchFee > MAX_LAUNCH_FEE) revert InvalidConfig();
        launchFee = newLaunchFee;
        emit LaunchFeeUpdated(newLaunchFee);
    }

    function setMaxOpeningBuyBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > MAX_OPENING_BUY_BPS) revert InvalidConfig();
        maxOpeningBuyBps = bps;
        emit MaxOpeningBuyUpdated(bps);
    }

    function setKeeper(address keeper_) external onlyOwner {
        if (keeper_ == address(0)) revert ZeroAddress();
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
    }

    /// @notice Router for vaults of FUTURE launches. Existing vaults keep the
    ///         router they were created with.
    function setSwapRouter(ISlipstreamRouter swapRouter_) external onlyOwner {
        if (address(swapRouter_) == address(0)) revert ZeroAddress();
        swapRouter = swapRouter_;
        emit SwapRouterUpdated(address(swapRouter_));
    }

    /// @notice Fee levels for FUTURE launches. Launched coins keep theirs.
    function setFeePolicy(FeePolicy calldata p) external onlyOwner {
        if (
            p.preTaxBps > MAX_TAX_BPS || p.postTaxBps > p.preTaxBps || p.holdersPreBps > p.preTaxBps
                || p.creatorPreBps > p.preTaxBps || p.holdersPostBps > p.postTaxBps || p.creatorPostBps > p.postTaxBps
        ) revert InvalidConfig();
        feePolicy = p;
        emit FeePolicyUpdated(p);
    }

    /// @notice Approve a pair token and set its launch terms, or disable it.
    function setPairConfig(address pair, PairConfig calldata config) external onlyOwner {
        if (pair == address(0) || pair.code.length == 0) revert InvalidConfig();
        if (config.enabled && (config.startMcap == 0 || config.gradMcap <= config.startMcap)) revert InvalidConfig();
        pairConfig[pair] = config;
        emit PairConfigUpdated(pair, config);
    }

    function setRewardTokenApproved(address token, bool approved) external onlyOwner {
        if (token == address(0) || token.code.length == 0) revert InvalidConfig();
        rewardTokenApproved[token] = approved;
        emit RewardTokenApprovalUpdated(token, approved);
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    function launch(LaunchParams calldata p, bytes32 salt)
        external
        payable
        nonReentrant
        returns (address token, bytes32 poolId)
    {
        if (!launchEnabled) revert LaunchDisabled();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidTokenParams();
        PairConfig memory cfg = pairConfig[p.pair];
        if (!cfg.enabled) revert PairNotEnabled();

        // Launch fee is always paid in native ETH. The opening buy is the
        // rest of msg.value for a WETH pair, or `openingBuyIn` of the pair
        // token pulled from the launcher otherwise.
        uint256 fee = launchFee;
        if (msg.value < fee) revert LaunchFeeNotPaid();
        uint256 buyIn;
        if (p.pair == weth) {
            buyIn = msg.value - fee;
        } else {
            if (msg.value != fee) revert LaunchFeeNotPaid();
            buyIn = p.openingBuyIn;
        }
        if (buyIn == 0 || buyIn < cfg.minOpeningBuy) revert OpeningBuyTooSmall(buyIn, cfg.minOpeningBuy);

        token = _createCoin(p.name, p.symbol, salt);
        metadataURIOf[token] = p.metadataURI;

        bool tokenIsCurrency0 = token < p.pair;
        PoolKey memory key = _poolKey(token, p.pair);
        poolId = PoolId.unwrap(key.toId());

        // Open the pool at the start market cap and seed the whole supply
        // single-sided above it. This contract holds the position; only the
        // owner's `collect` can remove any of it.
        {
            (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper) = _initialPosition(tokenIsCurrency0, cfg.startMcap);
            poolManager.initialize(key, sqrtPriceX96);
            uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
            uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
            uint128 liquidity = tokenIsCurrency0
                ? LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, TOTAL_SUPPLY)
                : LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, TOTAL_SUPPLY);
            positions[token] = Position({tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity});
            poolManager.unlock(abi.encode(uint8(0), abi.encode(key, tickLower, tickUpper, liquidity)));
        }

        (address beneficiary, uint16 taxBps) = _configureFees(token, key, tokenIsCurrency0, cfg.gradMcap, p);

        listings[token] = Listing({
            creator: msg.sender,
            pair: p.pair,
            taxBps: taxBps,
            createdAt: uint64(block.timestamp),
            poolId: poolId
        });
        allTokens.push(token);
        _tokensByCreator[msg.sender].push(token);
        emit TokenLaunched(
            token, msg.sender, p.pair, poolId, p.feeMode, launchInfo[token].rewardToken, beneficiary
        );

        if (fee > 0) {
            IWETHLike(weth).deposit{value: fee}();
            IERC20(weth).safeTransfer(hook.protocolFeeRecipient(), fee);
        }

        // Required opening buy, atomic with the launch so nobody trades first.
        if (p.pair == weth) {
            IWETHLike(weth).deposit{value: buyIn}();
        } else {
            IERC20(p.pair).safeTransferFrom(msg.sender, address(this), buyIn);
        }
        uint256 out =
            abi.decode(poolManager.unlock(abi.encode(uint8(1), abi.encode(key, buyIn, tokenIsCurrency0))), (uint256));
        uint256 cap = (TOTAL_SUPPLY * maxOpeningBuyBps) / BPS;
        if (out > cap) revert OpeningBuyTooLarge(out, cap);
        if (out < p.minTokensOut) revert OpeningBuySlippage(out, p.minTokensOut);
        IERC20(token).safeTransfer(msg.sender, out);
        emit OpeningBuy(token, msg.sender, buyIn, out);
    }

    /// @dev Mint the fixed supply to this contract and leave the coin with no
    ///      admin and no minter.
    function _createCoin(string calldata name, string calldata symbol, bytes32 salt) private returns (address token) {
        bytes memory createParams = abi.encode(
            IB20FactoryMin.B20AssetCreateParams({
                version: 1,
                name: name,
                symbol: symbol,
                initialAdmin: address(this),
                decimals: 18
            })
        );
        token = b20Factory.createB20(
            IB20FactoryMin.B20Variant.ASSET, _creatorSalt(msg.sender, salt), createParams, new bytes[](0)
        );
        IB20TokenMin b20 = IB20TokenMin(token);
        bytes32 mintRole = b20.MINT_ROLE();
        b20.grantRole(mintRole, address(this));
        b20.mint(address(this), TOTAL_SUPPLY);
        b20.revokeRole(mintRole, address(this));
        b20.renounceLastAdmin();
    }

    /// @dev The coin's address depends on the launcher as well as their salt,
    ///      so nobody can copy a pending launch's salt to take its address and
    ///      make it revert.
    function _creatorSalt(address creator, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }

    /// @notice The address `creator` would get by launching with `salt`.
    function predictTokenAddress(address creator, bytes32 salt) external view returns (address) {
        return b20Factory.getB20Address(IB20FactoryMin.B20Variant.ASSET, address(this), _creatorSalt(creator, salt));
    }

    function _configureFees(
        address token,
        PoolKey memory key,
        bool tokenIsCurrency0,
        uint256 gradMcap,
        LaunchParams calldata p
    ) private returns (address beneficiary, uint16 taxBps) {
        FeePolicy memory f = feePolicy;
        taxBps = f.preTaxBps;
        uint16 preBps;
        uint16 postBps;
        LaunchInfo memory info;
        info.feeMode = p.feeMode;

        if (p.feeMode == FeeMode.Holders) {
            address reward = p.rewardToken == address(0) ? p.pair : p.rewardToken;
            if (reward != p.pair && !rewardTokenApproved[reward]) revert RewardTokenNotApproved();
            beneficiary = vaultDeployer.deploy(token, p.pair, reward, swapRouter);
            info.rewardToken = reward;
            info.vault = beneficiary;
            (preBps, postBps) = (f.holdersPreBps, f.holdersPostBps);
        } else {
            beneficiary = p.feeRecipient == address(0) ? msg.sender : p.feeRecipient;
            info.feeRecipient = beneficiary;
            (preBps, postBps) = (f.creatorPreBps, f.creatorPostBps);
        }
        launchInfo[token] = info;

        hook.configurePool(
            key, tokenIsCurrency0, f.preTaxBps, f.postTaxBps, preBps, postBps, _sqrtPriceAtMcap(tokenIsCurrency0, gradMcap), beneficiary
        );
    }

    // ---------------------------------------------------------------------
    // Liquidity (owner)
    // ---------------------------------------------------------------------

    /// @notice Remove `bps` (of 10,000) of a coin's remaining liquidity and
    ///         send both sides, the coins and the pair tokens, to `recipient`.
    ///         Owner only. It cannot be undone, it thins the pool, and it
    ///         takes pair tokens that buyers paid in. This is the reason the
    ///         liquidity of these launches is protocol-managed, not locked.
    function collect(address token, uint16 bps, address recipient)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokenAmount, uint256 pairAmount)
    {
        if (bps == 0 || bps > BPS) revert InvalidConfig();
        if (recipient == address(0)) revert ZeroAddress();
        address pair = listings[token].pair;
        if (pair == address(0)) revert TokenNotFound();

        Position storage pos = positions[token];
        uint128 removed = uint128((uint256(pos.liquidity) * bps) / BPS);
        if (removed == 0) revert NothingToCollect();
        pos.liquidity -= removed;

        bool tokenIsCurrency0 = token < pair;
        bytes memory res = poolManager.unlock(
            abi.encode(uint8(2), abi.encode(_poolKey(token, pair), pos.tickLower, pos.tickUpper, removed, recipient))
        );
        (uint256 amount0, uint256 amount1) = abi.decode(res, (uint256, uint256));
        (tokenAmount, pairAmount) = tokenIsCurrency0 ? (amount0, amount1) : (amount1, amount0);
        emit Collected(token, bps, tokenAmount, pairAmount, recipient);
    }

    // ---------------------------------------------------------------------
    // PoolManager plumbing
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));

        if (action == 0) {
            (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity) =
                abi.decode(payload, (PoolKey, int24, int24, uint128));
            (BalanceDelta delta,) = poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: int256(uint256(liquidity)),
                    salt: bytes32(0)
                }),
                ""
            );
            _settleNeg(key.currency0, delta.amount0());
            _settleNeg(key.currency1, delta.amount1());
            return "";
        }

        if (action == 2) {
            (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 removed, address recipient) =
                abi.decode(payload, (PoolKey, int24, int24, uint128, address));
            (BalanceDelta delta,) = poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: -int256(uint256(removed)),
                    salt: bytes32(0)
                }),
                ""
            );
            return abi.encode(_takePos(key.currency0, delta.amount0(), recipient), _takePos(key.currency1, delta.amount1(), recipient));
        }

        // Opening buy: spend the pair token for the coin.
        (PoolKey memory k, uint256 amountIn, bool tokenIs0) = abi.decode(payload, (PoolKey, uint256, bool));
        bool zeroForOne = !tokenIs0;
        BalanceDelta d = poolManager.swap(
            k,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        _settleNeg(k.currency0, d.amount0());
        _settleNeg(k.currency1, d.amount1());
        int128 got = tokenIs0 ? d.amount0() : d.amount1();
        uint256 out = got > 0 ? uint256(uint128(got)) : 0;
        if (out > 0) poolManager.take(tokenIs0 ? k.currency0 : k.currency1, address(this), out);
        return abi.encode(out);
    }

    function _takePos(Currency currency, int128 amount, address to) private returns (uint256 value) {
        if (amount <= 0) return 0;
        value = uint256(uint128(amount));
        poolManager.take(currency, to, value);
    }

    function _settleNeg(Currency currency, int128 amount) private {
        if (amount >= 0) return;
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), uint256(uint128(-amount)));
        poolManager.settle();
    }

    // ---------------------------------------------------------------------
    // Pricing
    // ---------------------------------------------------------------------

    /// @dev sqrtPriceX96 at which the 1B supply is worth `mcap` pair units.
    function _sqrtPriceAtMcap(bool tokenIsCurrency0, uint256 mcap) private pure returns (uint160) {
        uint256 ratioX192 = tokenIsCurrency0
            ? Math.mulDiv(mcap, 1 << 192, TOTAL_SUPPLY)
            : Math.mulDiv(TOTAL_SUPPLY, 1 << 192, mcap);
        return uint160(Math.sqrt(ratioX192));
    }

    function _initialPosition(bool tokenIsCurrency0, uint256 startMcap)
        private
        pure
        returns (uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper)
    {
        int24 tick = TickMath.getTickAtSqrtPrice(_sqrtPriceAtMcap(tokenIsCurrency0, startMcap));
        int24 aligned = (tick / TICK_SPACING) * TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) aligned -= TICK_SPACING;

        if (tokenIsCurrency0) {
            sqrtPriceX96 = TickMath.getSqrtPriceAtTick(aligned);
            tickLower = aligned + TICK_SPACING;
            tickUpper = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        } else {
            sqrtPriceX96 = TickMath.getSqrtPriceAtTick(aligned + TICK_SPACING);
            tickLower = (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING;
            tickUpper = aligned + TICK_SPACING;
        }
    }

    function _poolKey(address token, address pair) private view returns (PoolKey memory key) {
        bool tokenIsCurrency0 = token < pair;
        key = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : pair),
            currency1: Currency.wrap(tokenIsCurrency0 ? pair : token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function tokensByCreator(address creator) external view returns (address[] memory) {
        return _tokensByCreator[creator];
    }

    function poolKeyOf(address token) public view returns (PoolKey memory) {
        address pair = listings[token].pair;
        if (pair == address(0)) revert TokenNotFound();
        return _poolKey(token, pair);
    }

    function isGraduated(address token) external view returns (bool) {
        return hook.isGraduated(poolKeyOf(token).toId());
    }

    /// @notice Live spot for a launched coin: sqrtPriceX96, which side the
    ///         coin sits on, and the pair token's decimals.
    function poolSpot(address token)
        external
        view
        returns (uint160 sqrtPriceX96, bool tokenIsCurrency0, uint8 pairDecimals)
    {
        PoolKey memory key = poolKeyOf(token);
        address pair = listings[token].pair;
        tokenIsCurrency0 = token < pair;
        try IERC20Metadata(pair).decimals() returns (uint8 d) {
            pairDecimals = d;
        } catch {
            pairDecimals = 18;
        }
        (sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
    }
}
