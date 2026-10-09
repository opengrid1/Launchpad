// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey, ModifyLiquidityParams, SwapParams, IInfinityVault, ICLPoolManager, InfinityLib} from "./infinity/IInfinity.sol";

interface IJeetWarsCoin {
    function sync() external returns (uint256);
}

/// @title JeetWarsHook
/// @notice Attached to every Jeet Wars pool on PancakeSwap Infinity. Each pool
///         pairs native BNB (currency0) with one coin (currency1).
///
///         Fee. Every swap pays a fixed 2% of its BNB side, whichever way the
///         trade goes, sent straight to the coin contract, which splits it
///         creator / holders / platform. No function changes the fee. Swaps
///         made by the Arena itself (a creator's first buy, merge buys) pay none.
///
///         Price record. Before the first swap in each block the pool's tick is
///         added to a running time-weighted sum, the same way a Uniswap V3
///         oracle does, so trades inside one block can't move the record. The
///         Arena reads the average tick over the deciding window (the last 10
///         minutes before the bell) to score each coin.
///
///         Round state. From the bell until the Arena settles the round, every
///         coin in it is frozen. After settling, the winner trades on and the
///         losers stay closed for good.
///
///         Liquidity. Only the Arena may add liquidity, so no one can strand
///         funds in a pool that later closes.
///
///         One setter exists: wiring the Arena, once, at deployment.
contract JeetWarsHook {
    using InfinityLib for PoolKey;

    uint16 public constant FEE_BPS = 200; // 2%
    uint16 internal constant BPS = 10_000;
    uint256 public constant WINDOW = 10 minutes;

    uint8 public constant OPEN = 0;
    uint8 public constant WON = 1;
    uint8 public constant LOST = 2;

    IInfinityVault public immutable vault;
    ICLPoolManager public immutable poolManager;
    address public immutable deployer;
    address public arena;

    struct Pool {
        address coin;
        uint64 bell; // 0 = not in a round
        uint8 status;
        bool registered;
        // Price record.
        uint64 lastTime;
        int24 blockTick; // tick at the start of block `lastTime`
        bool startTaken;
        int256 cum; // sum of tick * seconds up to lastTime
        int256 startCum; // the sum at bell - WINDOW
    }

    mapping(bytes32 => Pool) internal _pools;
    /// @notice Fees taken for a coin but still held here as Vault claims.
    mapping(address => uint256) public owed;

    event ArenaSet(address indexed arena);
    event PoolRegistered(address indexed coin, bytes32 indexed id, uint64 bell);
    event StatusSet(bytes32 indexed id, uint8 status);
    event FeeTaken(address indexed coin, uint256 fee);
    event FeeHeld(address indexed coin, uint256 amount);
    event FeeDelivered(address indexed coin, uint256 amount);

    error NotDeployer();
    error NotArena();
    error NotPoolManager();
    error NotVault();
    error AlreadySet();
    error ZeroAddress();
    error PoolClosed();
    error AwaitingSettle();
    error LiquidityLocked();

    constructor(IInfinityVault vault_, ICLPoolManager poolManager_) {
        vault = vault_;
        poolManager = poolManager_;
        deployer = msg.sender;
    }

    modifier onlyArena() {
        if (msg.sender != arena) revert NotArena();
        _;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    /// @notice One-time wiring of the Arena.
    function setArena(address arena_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (arena != address(0)) revert AlreadySet();
        if (arena_ == address(0)) revert ZeroAddress();
        arena = arena_;
        emit ArenaSet(arena_);
    }

    function getHooksRegistrationBitmap() external pure returns (uint16) {
        return InfinityLib.BEFORE_ADD_LIQUIDITY | InfinityLib.BEFORE_SWAP | InfinityLib.AFTER_SWAP
            | InfinityLib.BEFORE_SWAP_RETURNS_DELTA | InfinityLib.AFTER_SWAP_RETURNS_DELTA;
    }

    // ------------------------------------------------------------------
    // Arena
    // ------------------------------------------------------------------

    /// @notice Register a freshly initialized pool and the bell of its round.
    function register(bytes32 id, address coin, uint64 bell) external onlyArena {
        Pool storage p = _pools[id];
        if (p.registered) revert AlreadySet();
        (, int24 tick,,) = poolManager.getSlot0(id);
        p.coin = coin;
        p.bell = bell;
        p.registered = true;
        p.lastTime = uint64(block.timestamp);
        p.blockTick = tick;
        emit PoolRegistered(coin, id, bell);
    }

    /// @notice Set a pool's result when its round is settled.
    function setStatus(bytes32 id, uint8 status) external onlyArena {
        _pools[id].status = status;
        emit StatusSet(id, status);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function pool(bytes32 id) external view returns (Pool memory) {
        return _pools[id];
    }

    /// @notice Whether the pool accepts swaps right now.
    function tradable(bytes32 id) public view returns (bool) {
        Pool storage p = _pools[id];
        if (p.status == LOST) return false;
        if (p.status == OPEN && p.bell != 0 && block.timestamp >= p.bell) return false;
        return true;
    }

    /// @notice Average tick over [bell - WINDOW, bell]. Lower tick = pricier
    ///         coin (the price is coins per BNB). Valid once the bell has rung;
    ///         the pool is frozen from then on, so nothing moves it afterwards.
    function windowAverageTick(bytes32 id) external view returns (int256) {
        Pool storage p = _pools[id];
        int256 tickNow = _currentTick(id);
        uint256 bell = p.bell;
        uint256 ws = bell - WINDOW;
        int256 cumBell = p.cum + tickNow * int256(bell - p.lastTime);
        int256 cumStart;
        if (p.startTaken) cumStart = p.startCum;
        else if (p.lastTime <= ws) cumStart = p.cum + tickNow * int256(ws - p.lastTime);
        else cumStart = p.cum; // launched inside the window: averaged from launch
        uint256 span = p.startTaken || p.lastTime <= ws ? WINDOW : bell - p.lastTime;
        if (span == 0) return tickNow;
        return (cumBell - cumStart) / int256(span);
    }

    /// @notice The pool's tick at the start of this block: trades earlier in the
    ///         same block can't move it. The Arena caps merge buys against it.
    function blockStartTick(bytes32 id) external view returns (int24) {
        Pool storage p = _pools[id];
        if (p.lastTime == block.timestamp) return p.blockTick;
        return int24(_currentTick(id));
    }

    // ------------------------------------------------------------------
    // Hook callbacks
    // ------------------------------------------------------------------

    function beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        if (sender != arena) revert LiquidityLocked();
        return this.beforeAddLiquidity.selector;
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int256, uint24)
    {
        bytes32 id = key.toId();
        Pool storage p = _pools[id];
        if (p.registered) {
            if (p.status == LOST) revert PoolClosed();
            if (p.status == OPEN && p.bell != 0 && block.timestamp >= p.bell) revert AwaitingSettle();
            _observe(p, id);
        }
        int128 fee;
        if (p.registered && sender != arena && _specifiedIsBnb(params)) {
            fee = int128(int256((_abs(params.amountSpecified) * FEE_BPS) / BPS));
        }
        return (this.beforeSwap.selector, InfinityLib.beforeSwapDelta(fee, 0), 0);
    }

    function afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, int256 delta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        Pool storage p = _pools[key.toId()];
        if (!p.registered || sender == arena) return (this.afterSwap.selector, 0);
        uint256 fee;
        int128 ret;
        if (_specifiedIsBnb(params)) {
            fee = (_abs(params.amountSpecified) * FEE_BPS) / BPS;
        } else {
            int128 bnbSide = InfinityLib.amount0(delta);
            fee = (uint256(uint128(bnbSide < 0 ? -bnbSide : bnbSide)) * FEE_BPS) / BPS;
            ret = int128(int256(fee));
        }
        if (fee == 0) return (this.afterSwap.selector, ret);
        if (_deliver(p.coin, fee)) {
            // A failed sync loses nothing: the BNB is credited on the next one.
            try IJeetWarsCoin(p.coin).sync() {} catch {}
        }
        emit FeeTaken(p.coin, fee);
        return (this.afterSwap.selector, ret);
    }

    // ------------------------------------------------------------------
    // Fee delivery
    // ------------------------------------------------------------------

    /// @notice Deliver fees still held here as Vault claims. Anyone.
    function flush(address coin) external returns (uint256 amount) {
        amount = owed[coin];
        if (amount == 0) return 0;
        vault.lock(abi.encode(coin, amount));
    }

    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(vault)) revert NotVault();
        (address coin, uint256 amount) = abi.decode(data, (address, uint256));
        owed[coin] = 0;
        vault.burn(address(this), address(0), amount);
        vault.take(address(0), coin, amount);
        emit FeeDelivered(coin, amount);
        return "";
    }

    /// @dev Send the fee (plus anything held from earlier swaps) to the coin when
    ///      the Vault holds enough BNB; otherwise keep it as a claim for later.
    function _deliver(address coin, uint256 fee) internal returns (bool delivered) {
        uint256 held = owed[coin];
        uint256 due = held + fee;
        if (address(vault).balance >= due) {
            if (held != 0) {
                owed[coin] = 0;
                vault.burn(address(this), address(0), held);
                emit FeeDelivered(coin, held);
            }
            vault.take(address(0), coin, due);
            return true;
        }
        vault.mint(address(this), address(0), fee);
        owed[coin] = due;
        emit FeeHeld(coin, fee);
        return false;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev First swap of a block: add the tick that held since the last record.
    function _observe(Pool storage p, bytes32 id) internal {
        uint256 t = block.timestamp;
        uint256 last = p.lastTime;
        if (t == last) return;
        int24 tick = int24(_currentTick(id));
        if (!p.startTaken && p.bell != 0) {
            uint256 ws = uint256(p.bell) - WINDOW;
            if (t >= ws) {
                p.startCum = last <= ws ? p.cum + int256(tick) * int256(ws - last) : p.cum;
                p.startTaken = true;
            }
        }
        p.cum += int256(tick) * int256(t - last);
        p.lastTime = uint64(t);
        p.blockTick = tick;
    }

    function _currentTick(bytes32 id) internal view returns (int256) {
        (, int24 tick,,) = poolManager.getSlot0(id);
        return tick;
    }

    /// @dev Exact input: specified = input. Exact output: specified = output.
    ///      BNB is always currency0.
    function _specifiedIsBnb(SwapParams calldata params) internal pure returns (bool) {
        bool exactInput = params.amountSpecified < 0;
        return exactInput ? params.zeroForOne : !params.zeroForOne;
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return uint256(x < 0 ? -x : x);
    }
}
