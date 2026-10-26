// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
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

import {EquoCoinDeployer} from "./EquoCoinDeployer.sol";
import {EquoFeeHook} from "./EquoFeeHook.sol";

interface IWrappedNativeDeposit {
    function deposit() external payable;
}

/// @title EquoLaunchFactory
/// @notice Launches an Equo coin on this chain as one leg of a launch that spans several chains.
///
///         ONE SIGNED SNAPSHOT FOR EVERY CHAIN. The launch service signs a snapshot of the whole launch once (EIP-712,
///         no chain in the domain, so the same signature works on every chain): the coin's name, symbol, metadata
///         and fee, and one leg per chain with that chain's coin address, salt, supply (1B on every chain, so a coin on
///         N chains has N billion in all) and the USD price of its pair. Each chain's factory checks the signature, its
///         own leg and that every leg is 1B, then opens its pool at $3,000 for its 1B: the same price on every chain. A snapshot is good for at most an hour and
///         each launch id launches once per chain.
///
///         WHO LAUNCHES. The creator, an approved launcher (the launch service, which completes the legs the
///         creator did not pay for), or anyone carrying the creator's own signature over the snapshot.
///
///         THE POOL. The whole slice goes into one single-sided position from the opening price up to the top of
///         the price range, held here. The pool opens at the bottom of that range, never cheaper than the snapshot
///         price and at most one tick spacing (0.6%) dearer. The hook takes the coin's fixed fee on every swap.
///         Any native coin sent with the launch is the creator's launch buy: swapped fee-free, coins to the creator.
///
///         ADMIN. Sets the snapshot signer, launchers, the fee recipient and the pair price band, and holds one
///         lever over liquidity: {collect}, which removes a share of a coin's launch position to a recipient.
contract EquoLaunchFactory is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    /// @notice A coin's supply on each of its chains: 1B coins of 9 decimals. A coin on N chains has N billion.
    uint256 public constant CHAIN_SUPPLY = 1_000_000_000 * 1e9;
    /// @notice Every chain's 1B opens at this market cap, so every chain opens at the same price.
    uint256 public constant START_MCAP_USD18 = 3_000e18;
    int24 public constant TICK_SPACING = 60;
    uint64 public constant MAX_SNAPSHOT_LIFE = 1 hours;
    uint256 public constant MAX_LEGS = 16;
    /// @notice Coins kept out of the seed position to absorb rounding in the liquidity math.
    uint256 public constant COIN_SLACK = 1e6;

    bytes32 public constant LEG_TYPEHASH = keccak256("Leg(uint32 eid,bytes32 coin,bytes32 legSalt,uint256 slice,uint256 quoteUsd18)");
    bytes32 public constant SNAPSHOT_TYPEHASH = keccak256(
        "Snapshot(bytes32 launchId,address creator,string name,string symbol,string metadataURI,uint16 feeBps,uint64 deadline,Leg[] legs)"
        "Leg(uint32 eid,bytes32 coin,bytes32 legSalt,uint256 slice,uint256 quoteUsd18)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version)"), keccak256("Equo"), keccak256("2")));

    struct Leg {
        uint32 eid; // LayerZero endpoint id of the leg's chain
        bytes32 coin; // the coin's address on that chain (a Solana leg: its OFT store)
        bytes32 legSalt; // the salt that gives that address (zero for a non-EVM leg)
        uint256 slice; // the leg's supply: always 1B (9 decimals)
        uint256 quoteUsd18; // the USD price of one whole pair token on that chain, 18 decimals
    }

    struct Snapshot {
        bytes32 launchId;
        address creator;
        string name;
        string symbol;
        string metadataURI;
        uint16 feeBps;
        uint64 deadline;
        Leg[] legs;
    }

    struct Listing {
        address creator;
        bytes32 launchId;
        uint64 createdAt;
        uint16 feeBps;
        bytes32 poolId;
        uint256 slice;
        uint256 quoteUsd18;
    }

    struct Position {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    IPoolManager public immutable poolManager;
    EquoFeeHook public immutable hook;
    EquoCoinDeployer public immutable coinDeployer;
    address public immutable weth;
    address public immutable admin;
    uint32 public immutable eid;

    address public signer;
    address public feeRecipient;
    /// @notice A snapshot's price for this chain's pair must sit in this band (USD, 18 decimals).
    uint256 public minQuoteUsd18;
    uint256 public maxQuoteUsd18;
    mapping(address => bool) public launchers;
    mapping(bytes32 launchId => bool) public launched;
    mapping(address token => Listing) public listings;
    mapping(address token => Position) public positions;
    mapping(address token => address) public pendingCreator;
    address[] public allTokens;

    event Launched(address indexed token, address indexed creator, bytes32 indexed launchId, bytes32 poolId, uint256 slice, uint16 feeBps, uint256 quoteUsd18);
    event LaunchBought(address indexed token, address indexed creator, uint256 pairIn, uint256 coinOut);
    event SignerSet(address indexed signer);
    event LauncherSet(address indexed launcher, bool allowed);
    event FeeRecipientSet(address indexed recipient);
    event QuoteBandSet(uint256 minUsd18, uint256 maxUsd18);
    event Collected(address indexed token, uint16 bps, uint128 liquidity, uint256 coins, uint256 pair, address indexed to);
    event CreatorTransferStarted(address indexed token, address indexed from, address indexed to);
    event CreatorTransferred(address indexed token, address indexed from, address indexed to);

    error NotAdmin();
    error NotAllowed();
    error BadSnapshot();
    error BadSignature();
    error Expired();
    error AlreadyLaunched();
    error PriceOutOfBand();
    error InvalidParams();
    error NotCreator();

    constructor(
        address admin_,
        IPoolManager poolManager_,
        EquoFeeHook hook_,
        EquoCoinDeployer coinDeployer_,
        address weth_,
        uint32 eid_,
        address signer_,
        address feeRecipient_,
        uint256 minQuoteUsd18_,
        uint256 maxQuoteUsd18_
    ) {
        if (admin_ == address(0) || weth_ == address(0) || signer_ == address(0)) revert InvalidParams();
        if (minQuoteUsd18_ == 0 || maxQuoteUsd18_ <= minQuoteUsd18_) revert InvalidParams();
        admin = admin_;
        poolManager = poolManager_;
        hook = hook_;
        coinDeployer = coinDeployer_;
        weth = weth_;
        eid = eid_;
        signer = signer_;
        feeRecipient = feeRecipient_ == address(0) ? admin_ : feeRecipient_;
        minQuoteUsd18 = minQuoteUsd18_;
        maxQuoteUsd18 = maxQuoteUsd18_;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setSigner(address signer_) external onlyAdmin {
        if (signer_ == address(0)) revert InvalidParams();
        signer = signer_;
        emit SignerSet(signer_);
    }

    function setLauncher(address launcher, bool allowed) external onlyAdmin {
        launchers[launcher] = allowed;
        emit LauncherSet(launcher, allowed);
    }

    function setFeeRecipient(address recipient) external onlyAdmin {
        if (recipient == address(0)) revert InvalidParams();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function setQuoteBand(uint256 minUsd18, uint256 maxUsd18) external onlyAdmin {
        if (minUsd18 == 0 || maxUsd18 <= minUsd18) revert InvalidParams();
        minQuoteUsd18 = minUsd18;
        maxQuoteUsd18 = maxUsd18;
        emit QuoteBandSet(minUsd18, maxUsd18);
    }

    /// @notice Admin-only: pull `bps` of a coin's launch position (coins and pair) out of its pool to `recipient`.
    ///         Not reversible. The fees owed to the creator and the platform are never touched.
    function collect(address token, uint16 bps, address recipient) external onlyAdmin nonReentrant returns (uint256 coins, uint256 pair) {
        if (bps == 0 || bps > 10_000 || recipient == address(0)) revert InvalidParams();
        if (listings[token].createdAt == 0) revert InvalidParams();
        Position storage pos = positions[token];
        uint128 removed = uint128((uint256(pos.liquidity) * bps) / 10_000);
        if (removed == 0) revert InvalidParams();
        pos.liquidity -= removed;
        bytes memory res = poolManager.unlock(abi.encode(uint8(2), abi.encode(_key(token), pos.tickLower, pos.tickUpper, removed, recipient)));
        (coins, pair) = abi.decode(res, (uint256, uint256));
        emit Collected(token, bps, removed, coins, pair, recipient);
    }

    // ---------------------------------------------------------------------
    // Creator
    // ---------------------------------------------------------------------

    /// @notice Offer the creator role (and its fee stream) to `to`; zero cancels. Creator only.
    function transferCreator(address token, address to) external {
        if (msg.sender != hook.creatorOf(token)) revert NotCreator();
        pendingCreator[token] = to;
        emit CreatorTransferStarted(token, msg.sender, to);
    }

    function acceptCreator(address token) external {
        if (msg.sender != pendingCreator[token] || msg.sender == address(0)) revert NotCreator();
        address from = hook.creatorOf(token);
        delete pendingCreator[token];
        hook.setCreator(token, msg.sender);
        emit CreatorTransferred(token, from, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Launch
    // ---------------------------------------------------------------------

    /// @notice The EIP-712 digest the signer (and, for {launchSigned}, the creator) signs.
    function digest(Snapshot calldata s) public view returns (bytes32) {
        bytes32[] memory legHashes = new bytes32[](s.legs.length);
        for (uint256 i; i < s.legs.length; i++) {
            Leg calldata l = s.legs[i];
            legHashes[i] = keccak256(abi.encode(LEG_TYPEHASH, l.eid, l.coin, l.legSalt, l.slice, l.quoteUsd18));
        }
        bytes32 structHash = keccak256(
            abi.encode(
                SNAPSHOT_TYPEHASH,
                s.launchId,
                s.creator,
                keccak256(bytes(s.name)),
                keccak256(bytes(s.symbol)),
                keccak256(bytes(s.metadataURI)),
                s.feeBps,
                s.deadline,
                keccak256(abi.encodePacked(legHashes))
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice The salt this chain's leg creates its coin with.
    function coinSalt(bytes32 launchId, address creator, bytes32 legSalt) public pure returns (bytes32) {
        return keccak256(abi.encode(launchId, creator, legSalt));
    }

    /// @notice Launch this chain's leg: the creator itself, or an approved launcher.
    function launch(Snapshot calldata s, bytes calldata signature) external payable nonReentrant returns (address token) {
        if (msg.sender != s.creator && !launchers[msg.sender]) revert NotAllowed();
        return _launch(s, signature);
    }

    /// @notice Launch this chain's leg for a creator who signed the snapshot themselves; anyone may submit it.
    function launchSigned(Snapshot calldata s, bytes calldata signature, bytes calldata creatorSignature) external payable nonReentrant returns (address token) {
        if (ECDSA.recover(digest(s), creatorSignature) != s.creator) revert BadSignature();
        return _launch(s, signature);
    }

    function _launch(Snapshot calldata s, bytes calldata signature) internal returns (address token) {
        if (block.timestamp > s.deadline || s.deadline > block.timestamp + MAX_SNAPSHOT_LIFE) revert Expired();
        if (launched[s.launchId]) revert AlreadyLaunched();
        if (s.creator == address(0) || bytes(s.name).length == 0 || bytes(s.name).length > 64 || bytes(s.symbol).length == 0 || bytes(s.symbol).length > 16) {
            revert BadSnapshot();
        }
        if (ECDSA.recover(digest(s), signature) != signer) revert BadSignature();
        launched[s.launchId] = true;

        (uint256 me, uint32[] memory eids, bytes32[] memory peers) = _legs(s.legs);
        Leg calldata leg = s.legs[me];
        if (leg.quoteUsd18 < minQuoteUsd18 || leg.quoteUsd18 > maxQuoteUsd18) revert PriceOutOfBand();
        token = coinDeployer.deploy(
            coinSalt(s.launchId, s.creator, leg.legSalt),
            EquoCoinDeployer.Init({
                name: s.name,
                symbol: s.symbol,
                metadataURI: s.metadataURI,
                slice: leg.slice,
                launchTotal: leg.slice * s.legs.length,
                creator: s.creator,
                bridgeFeeTo: feeRecipient
            }),
            eids,
            peers
        );
        if (bytes32(uint256(uint160(token))) != leg.coin) revert BadSnapshot();

        PoolKey memory key = _key(token);
        (uint160 sqrtStart, int24 lower, int24 upper) = _opening(leg.quoteUsd18);
        poolManager.initialize(key, sqrtStart);
        hook.registerPool(key, token, weth, s.creator, s.feeBps, sqrtStart);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount0(sqrtStart, TickMath.getSqrtPriceAtTick(upper), leg.slice - COIN_SLACK);
        positions[token] = Position({tickLower: lower, tickUpper: upper, liquidity: liquidity});
        poolManager.unlock(abi.encode(uint8(0), abi.encode(key, lower, upper, liquidity)));

        bytes32 poolId = PoolId.unwrap(key.toId());
        listings[token] = Listing({
            creator: s.creator, launchId: s.launchId, createdAt: uint64(block.timestamp), feeBps: s.feeBps, poolId: poolId, slice: leg.slice, quoteUsd18: leg.quoteUsd18
        });
        allTokens.push(token);
        emit Launched(token, s.creator, s.launchId, poolId, leg.slice, s.feeBps, leg.quoteUsd18);

        if (msg.value > 0) {
            IWrappedNativeDeposit(weth).deposit{value: msg.value}();
            bytes memory res = poolManager.unlock(abi.encode(uint8(1), abi.encode(key, msg.value, s.creator)));
            emit LaunchBought(token, s.creator, msg.value, abi.decode(res, (uint256)));
        }
    }

    /// @dev Check the legs (ascending chains, 1B each) and find this chain's; the others become the coin's peers.
    function _legs(Leg[] calldata legs) internal view returns (uint256 me, uint32[] memory eids, bytes32[] memory peers) {
        uint256 n = legs.length;
        if (n == 0 || n > MAX_LEGS) revert BadSnapshot();
        bool found;
        eids = new uint32[](n - 1);
        peers = new bytes32[](n - 1);
        uint256 k;
        for (uint256 i; i < n; i++) {
            Leg calldata l = legs[i];
            if (i > 0 && l.eid <= legs[i - 1].eid) revert BadSnapshot();
            if (l.slice != CHAIN_SUPPLY || l.coin == bytes32(0)) revert BadSnapshot();
            if (l.eid == eid) {
                me = i;
                found = true;
            } else {
                if (k == n - 1) revert BadSnapshot();
                eids[k] = l.eid;
                peers[k] = l.coin;
                k++;
            }
        }
        if (!found) revert BadSnapshot();
    }

    /// @dev The opening price: the snapshot's USD price as pair units per coin unit, rounded up to a usable tick so
    ///      the pool never opens cheaper than the snapshot. The position spans from there to the top of the range.
    function _opening(uint256 quoteUsd18) internal view returns (uint160 sqrtStart, int24 lower, int24 upper) {
        uint256 pairUnit = 10 ** IERC20Metadata(weth).decimals();
        // pair units per coin unit, 1e36 fixed point: (start cap / the chain's coin units) / (USD per pair unit)
        uint256 priceQ = Math.mulDiv(START_MCAP_USD18 * pairUnit, 1e36, quoteUsd18 * CHAIN_SUPPLY);
        if (priceQ == 0) revert PriceOutOfBand();
        uint160 target = uint160(Math.sqrt(Math.mulDiv(priceQ, 1 << 128, 1e36)) << 32);
        if (target < TickMath.MIN_SQRT_PRICE || target >= TickMath.MAX_SQRT_PRICE) revert PriceOutOfBand();
        int24 tick = TickMath.getTickAtSqrtPrice(target);
        if (TickMath.getSqrtPriceAtTick(tick) < target) tick += 1;
        int24 aligned = tick / TICK_SPACING * TICK_SPACING;
        if (aligned < tick) aligned += TICK_SPACING;
        lower = aligned;
        upper = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        if (lower >= upper) revert PriceOutOfBand();
        sqrtStart = TickMath.getSqrtPriceAtTick(lower);
    }

    // ---------------------------------------------------------------------
    // PoolManager callback: seed (0), launch buy (1), collect (2)
    // ---------------------------------------------------------------------

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
            BalanceDelta d = poolManager.swap(key, SwapParams({zeroForOne: false, amountSpecified: -int256(pairIn), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}), "");
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

    function _takeTo(Currency currency, int128 amount, address to) internal returns (uint256 value) {
        if (amount <= 0) return 0;
        value = uint256(uint128(amount));
        poolManager.take(currency, to, value);
    }

    function _pay(Currency currency, int128 amount) internal {
        if (amount >= 0) return;
        uint256 due = uint256(uint128(-amount));
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), due);
        poolManager.settle();
    }

    function _key(address token) internal view returns (PoolKey memory key) {
        if (token >= weth) revert InvalidParams();
        key = PoolKey({currency0: Currency.wrap(token), currency1: Currency.wrap(weth), fee: 0, tickSpacing: TICK_SPACING, hooks: IHooks(address(hook))});
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function poolKeyOf(address token) external view returns (PoolKey memory) {
        return _key(token);
    }

    function positionOf(address token) external view returns (Position memory) {
        return positions[token];
    }

    receive() external payable {}
}
