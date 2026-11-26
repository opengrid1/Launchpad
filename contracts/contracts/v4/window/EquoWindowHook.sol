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

interface IWindowFeeTo {
    function feeRecipient() external view returns (address);
}

interface IWHYPE {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title EquoWindowHook
/// @notice The Uniswap v4 hook every Equo pool on HyperEVM shares. It takes the coin's fixed fee on every swap, in
///         WHYPE, splits it between the coin's creator and the platform, and keeps the price above the pool's floor.
///
///         Every pool: coin = currency0, WHYPE = currency1. Buying pushes the price up.
///
///         FEE. Each coin picks its fee at launch, {MIN_FEE_BPS} to {MAX_FEE_BPS}; it never changes. Of each fee the
///         platform takes the larger of {PLATFORM_FEE_SHARE_BPS} of the fee and {PLATFORM_VOLUME_BPS} of the volume
///         (never more than the whole fee); the creator gets the rest. Window buys pay the same fee, on what they
///         spend on coins, through {recordFee}. Swaps by the liquidity manager (the creator's launch buy and premium
///         buybacks) pay none.
///
///         POOL GUARD. Only the factory can open a pool with this hook, and only the liquidity manager can add
///         liquidity to one, so a pool holds exactly what the manager put there. No swap may take the price below the
///         pool's floor (the lowest liquidity the manager placed): below it there is nothing to trade against.
contract EquoWindowHook is BaseHook, IUnlockCallback, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint16 public constant MIN_FEE_BPS = 30;
    uint16 public constant MAX_FEE_BPS = 500;
    uint16 public constant PLATFORM_FEE_SHARE_BPS = 2_000;
    uint16 public constant PLATFORM_VOLUME_BPS = 20;
    bytes32 internal constant FEE_SLOT = keccak256("equo.window.fee");
    bytes32 internal constant VOL_SLOT = keccak256("equo.window.volume");

    address public immutable whype;
    address public immutable deployer;
    address public factory;
    address public manager;

    struct PoolConfig {
        address token;
        uint16 feeBps;
        bool registered;
        uint160 floorSqrtPriceX96;
    }

    mapping(PoolId => PoolConfig) internal _config;
    mapping(address token => PoolId) internal _poolOf;
    mapping(address token => address) public creatorOf;
    mapping(address token => uint256) public creatorOwed;
    mapping(address token => uint256) public platformOwed;
    /// @notice Lifetime fees and volume per coin, in WHYPE.
    mapping(address token => uint256) public feesTotal;
    mapping(address token => uint256) public volumeTotal;

    event Wired(address indexed factory, address indexed manager);
    event PoolRegistered(address indexed token, uint16 feeBps, address creator);
    event FloorSet(address indexed token, uint160 floorSqrtPriceX96);
    event FeeTaken(address indexed token, uint256 fee, uint256 volume, uint256 creatorPart, uint256 platformPart);
    event CreatorPaid(address indexed token, address indexed to, uint256 amount);
    event PlatformPaid(address indexed token, address indexed to, uint256 amount);
    event CreatorSet(address indexed token, address indexed creator);

    error NotFactory();
    error NotManager();
    error AlreadySet();
    error BadFee();
    error NotThisPool();
    error BelowFloor();
    error InvalidParams();

    constructor(IPoolManager poolManager_, address whype_) BaseHook(poolManager_) {
        if (whype_ == address(0)) revert InvalidParams();
        whype = whype_;
        deployer = tx.origin; // the account behind the CREATE2 deployer
    }

    receive() external payable {}

    /// @notice One-time: the factory and the liquidity manager, wired by the account that deployed this hook.
    function wire(address factory_, address manager_) external {
        if (msg.sender != deployer || factory != address(0)) revert AlreadySet();
        if (factory_ == address(0) || manager_ == address(0)) revert InvalidParams();
        factory = factory_;
        manager = manager_;
        emit Wired(factory_, manager_);
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
    // Factory and manager
    // ---------------------------------------------------------------------

    function registerPool(PoolKey calldata key, address token, address creator, uint16 feeBps, uint160 floorSqrtPriceX96) external {
        if (msg.sender != factory) revert NotFactory();
        if (feeBps < MIN_FEE_BPS || feeBps > MAX_FEE_BPS) revert BadFee();
        PoolId id = key.toId();
        if (_config[id].registered || creator == address(0)) revert InvalidParams();
        _config[id] = PoolConfig({token: token, feeBps: feeBps, registered: true, floorSqrtPriceX96: floorSqrtPriceX96});
        _poolOf[token] = id;
        creatorOf[token] = creator;
        emit PoolRegistered(token, feeBps, creator);
    }

    /// @notice The manager lowers a pool's floor when it places liquidity below it.
    function setFloor(address token, uint160 floorSqrtPriceX96) external {
        if (msg.sender != manager) revert NotManager();
        PoolConfig storage c = _mustBeRegistered(token);
        c.floorSqrtPriceX96 = floorSqrtPriceX96;
        emit FloorSet(token, floorSqrtPriceX96);
    }

    /// @notice The fee on a window buy. The manager has already minted `fee` of WHYPE claims to this hook.
    function recordFee(address token, uint256 fee, uint256 volume) external {
        if (msg.sender != manager) revert NotManager();
        _mustBeRegistered(token);
        _book(token, fee, volume);
    }

    /// @notice Hand the creator's fee stream to someone else (the factory runs the two-step transfer). What the old
    ///         creator earned is paid to them first.
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
        address to = IWindowFeeTo(factory).feeRecipient();
        for (uint256 i; i < tokens.length; i++) {
            _mustBeRegistered(tokens[i]);
            uint256 amount = platformOwed[tokens[i]];
            if (amount == 0) continue;
            platformOwed[tokens[i]] = 0;
            poolManager.unlock(abi.encode(to, amount));
            emit PlatformPaid(tokens[i], to, amount);
        }
    }

    function _payCreator(address token) internal returns (uint256 amount) {
        amount = creatorOwed[token];
        if (amount == 0) return 0;
        creatorOwed[token] = 0;
        address to = creatorOf[token];
        poolManager.unlock(abi.encode(to, amount));
        emit CreatorPaid(token, to, amount);
    }

    /// @dev Turn fee claims back into HYPE and pay them out.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address to, uint256 amount) = abi.decode(data, (address, uint256));
        Currency cur = Currency.wrap(whype);
        poolManager.burn(address(this), cur.toId(), amount);
        poolManager.take(cur, address(this), amount);
        IWHYPE(whype).withdraw(amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) {
            // a contract that refuses HYPE gets WHYPE instead
            IWHYPE(whype).deposit{value: amount}();
            IERC20(whype).safeTransfer(to, amount);
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

    /// @notice How a fee of `fee` on a swap of `volume` splits.
    function split(uint256 fee, uint256 volume) public pure returns (uint256 creatorPart, uint256 platformPart) {
        platformPart = (fee * PLATFORM_FEE_SHARE_BPS) / BPS;
        uint256 byVolume = (volume * PLATFORM_VOLUME_BPS) / BPS;
        if (byVolume > platformPart) platformPart = byVolume;
        if (platformPart > fee) platformPart = fee;
        creatorPart = fee - platformPart;
    }

    function feeOf(address token, uint256 amount) external view returns (uint256) {
        return (amount * _config[_poolOf[token]].feeBps) / BPS;
    }

    function feeBpsOf(address token) external view returns (uint16) {
        return _config[_poolOf[token]].feeBps;
    }

    function floorOf(address token) external view returns (uint160) {
        return _config[_poolOf[token]].floorSqrtPriceX96;
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
        if (sender != manager) revert NotManager();
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolConfig storage c = _config[key.toId()];
        if (!c.registered || sender == manager || !_specifiedIsPair(params)) return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        uint256 amount = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint256 fee = (amount * c.feeBps) / BPS;
        _tset(FEE_SLOT, fee);
        _tset(VOL_SLOT, amount);
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        PoolConfig storage c = _config[id];
        if (!c.registered || sender == manager) return (BaseHook.afterSwap.selector, 0);
        (uint160 sqrtP,,,) = poolManager.getSlot0(id);
        if (sqrtP < c.floorSqrtPriceX96) revert BelowFloor();
        uint256 fee;
        uint256 volume;
        int128 ret = 0;
        if (_specifiedIsPair(params)) {
            fee = _tget(FEE_SLOT);
            volume = _tget(VOL_SLOT);
            _tset(FEE_SLOT, 0);
            _tset(VOL_SLOT, 0);
        } else {
            int128 unspecified = delta.amount1();
            volume = unspecified < 0 ? uint256(uint128(-unspecified)) : uint256(uint128(unspecified));
            fee = (volume * c.feeBps) / BPS;
            ret = int128(int256(fee));
        }
        if (fee == 0) return (BaseHook.afterSwap.selector, ret);
        poolManager.mint(address(this), key.currency1.toId(), fee);
        _book(c.token, fee, volume);
        return (BaseHook.afterSwap.selector, ret);
    }

    function _book(address token, uint256 fee, uint256 volume) internal {
        (uint256 creatorPart, uint256 platformPart) = split(fee, volume);
        creatorOwed[token] += creatorPart;
        platformOwed[token] += platformPart;
        feesTotal[token] += fee;
        volumeTotal[token] += volume;
        emit FeeTaken(token, fee, volume, creatorPart, platformPart);
    }

    function _mustBeRegistered(address token) internal view returns (PoolConfig storage c) {
        c = _config[_poolOf[token]];
        if (!c.registered) revert NotThisPool();
    }

    /// @dev WHYPE is always currency1.
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
