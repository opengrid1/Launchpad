// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {IOneOracle} from "../onehook/IOneOracle.sol";
import {LiqioTokenDeployer} from "../liqio/LiqioTokenDeployer.sol";
import {EquoWindowHook} from "./EquoWindowHook.sol";
import {EquoWindows} from "./EquoWindows.sol";

/// @title EquoWindowFactory
/// @notice Launches Equo coins on HyperEVM, paired with HYPE, in pools whose buys can be bought with a window.
///
///         A launch makes the coin (1B, 18 decimals, an EIP-1167 clone so the launch fits HyperEVM's small blocks),
///         opens its Uniswap v4 pool at a $3,000 market cap priced from HyperCore's HYPE oracle, and hands the
///         whole supply to {EquoWindows}, which puts it into the pool single-sided. The HYPE sent with the launch,
///         if any, is the creator's launch buy: fee-free, made in the same transaction, so nobody trades before it.
///
///         ADMIN. Sets the fee recipient, and holds one lever over liquidity: {collect}, which removes a share of a
///         coin's pool liquidity to a recipient. It never touches what open windows hold.
contract EquoWindowFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint256 public constant SUPPLY = 1_000_000_000 * 1e18;
    uint256 public constant START_MCAP_USD18 = 3_000e18;

    struct Listing {
        address creator;
        uint64 createdAt;
        uint16 feeBps;
        bytes32 poolId;
        uint256 hypeUsd18;
        int24 startTick;
    }

    IPoolManager public immutable poolManager;
    EquoWindowHook public immutable hook;
    EquoWindows public immutable windows;
    LiqioTokenDeployer public immutable tokenDeployer;
    IOneOracle public immutable oracle;
    address public immutable whype;
    address public immutable admin;

    address public feeRecipient;
    mapping(address token => Listing) public listings;
    mapping(address token => address) public pendingCreator;
    address[] public allTokens;

    event Launched(address indexed token, address indexed creator, bytes32 poolId, uint16 feeBps, uint256 hypeUsd18, int24 startTick, string name, string symbol, string metadataURI);
    event LaunchBought(address indexed token, address indexed creator, uint256 hypeIn, uint256 coinOut);
    event FeeRecipientSet(address indexed recipient);
    event CreatorTransferStarted(address indexed token, address indexed from, address indexed to);
    event CreatorTransferred(address indexed token, address indexed from, address indexed to);

    error NotAdmin();
    error NotCreator();
    error InvalidParams();
    error BadPrice();

    constructor(
        address admin_,
        IPoolManager poolManager_,
        EquoWindowHook hook_,
        EquoWindows windows_,
        LiqioTokenDeployer tokenDeployer_,
        IOneOracle oracle_,
        address whype_,
        address feeRecipient_
    ) {
        if (admin_ == address(0) || whype_ == address(0)) revert InvalidParams();
        admin = admin_;
        poolManager = poolManager_;
        hook = hook_;
        windows = windows_;
        tokenDeployer = tokenDeployer_;
        oracle = oracle_;
        whype = whype_;
        feeRecipient = feeRecipient_ == address(0) ? admin_ : feeRecipient_;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setFeeRecipient(address recipient) external onlyAdmin {
        if (recipient == address(0)) revert InvalidParams();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice Admin-only: remove `bps` of a coin's pool liquidity to `to`, over up to `maxSegments` segments of its
    ///         liquidity list from `from` (any tick at or below the floor starts at the floor). Returns where the next
    ///         call should start: the pool's top when done. Not reversible; never touches open windows' funds.
    function collect(address token, uint16 bps, address to, int24 from, uint256 maxSegments)
        external
        onlyAdmin
        nonReentrant
        returns (int24 next, uint256 coins, uint256 whypeOut)
    {
        if (listings[token].createdAt == 0) revert InvalidParams();
        return windows.collect(token, bps, to, from, maxSegments);
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

    /// @notice Launch a coin. The HYPE sent is the creator's launch buy (optional). `salt` picks the coin's address
    ///         (see {predict}).
    function launch(string calldata name, string calldata symbol, string calldata metadataURI, uint16 feeBps, bytes32 salt)
        external
        payable
        nonReentrant
        returns (address token)
    {
        if (bytes(name).length == 0 || bytes(name).length > 64 || bytes(symbol).length == 0 || bytes(symbol).length > 16) revert InvalidParams();
        uint256 hypeUsd = oracle.price(whype);
        (uint160 sqrtStart, int24 lower, int24 upper) = opening(hypeUsd);
        token = tokenDeployer.deploy(
            _salt(msg.sender, salt),
            LiqioTokenDeployer.Init({
                name: name,
                symbol: symbol,
                metadataURI: metadataURI,
                supply: SUPPLY,
                pairAsset: whype,
                poolManager: address(poolManager),
                hook: address(hook),
                converter: address(0),
                weth: whype,
                bridgeFeeTo: address(0),
                dividends: false
            }),
            ""
        );
        PoolKey memory key = windows.keyFor(token, whype);
        poolManager.initialize(key, sqrtStart);
        hook.registerPool(key, token, msg.sender, feeBps, sqrtStart);
        IERC20(token).safeTransfer(address(windows), SUPPLY);
        uint256 bought = windows.seed{value: msg.value}(token, whype, lower, upper, msg.sender, msg.value);

        bytes32 poolId = PoolId.unwrap(key.toId());
        listings[token] = Listing({creator: msg.sender, createdAt: uint64(block.timestamp), feeBps: feeBps, poolId: poolId, hypeUsd18: hypeUsd, startTick: lower});
        allTokens.push(token);
        emit Launched(token, msg.sender, poolId, feeBps, hypeUsd, lower, name, symbol, metadataURI);
        if (msg.value > 0) emit LaunchBought(token, msg.sender, msg.value, bought);
    }

    /// @notice The coin address `creator` gets with `salt`.
    function predict(address creator, bytes32 salt) external view returns (address token) {
        (token,) = tokenDeployer.predict(_salt(creator, salt), whype, false);
    }

    /// @notice Where a coin opens with HYPE at `hypeUsd18`: the first step at or above $3,000 for the 1B, up to the top
    ///         of the price range.
    function opening(uint256 hypeUsd18) public pure returns (uint160 sqrtStart, int24 lower, int24 upper) {
        if (hypeUsd18 == 0) revert BadPrice();
        // WHYPE wei per coin wei, 1e36 fixed point
        uint256 priceQ = Math.mulDiv(START_MCAP_USD18 * 1e18, 1e36, hypeUsd18 * SUPPLY);
        if (priceQ == 0) revert BadPrice();
        uint160 target = uint160(Math.sqrt(Math.mulDiv(priceQ, 1 << 128, 1e36)) << 32);
        if (target < TickMath.MIN_SQRT_PRICE || target >= TickMath.MAX_SQRT_PRICE) revert BadPrice();
        int24 step = 10;
        int24 tick = TickMath.getTickAtSqrtPrice(target);
        if (TickMath.getSqrtPriceAtTick(tick) < target) tick += 1;
        int24 aligned = tick / step * step;
        if (aligned < tick) aligned += step;
        lower = aligned;
        upper = (TickMath.MAX_TICK / step) * step;
        sqrtStart = TickMath.getSqrtPriceAtTick(lower);
    }

    function _salt(address creator, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function poolKeyOf(address token) external view returns (PoolKey memory) {
        return windows.keyFor(token, whype);
    }
}
