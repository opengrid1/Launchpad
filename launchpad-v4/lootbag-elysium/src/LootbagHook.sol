// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";

interface IERC20Min {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

interface ILootbagPayout {
    function credit(address coin, uint256 amount) external;
}


/// @title LootbagHook
/// @notice The one Uniswap v4 hook every Lootbag pool uses. It takes a 2% fee on every buy and sell, always in the pool's
///         quote currency (VVV, WETH, USDC or a stock token). Only the factory can add or remove a pool's liquidity.
///         Of every fee, a quarter (0.5% of the trade) goes to the coin's holders through the payout contract, at once.
///         The rest (1.5%) is Lootbag's: it collects here and anyone can split it, 25% to the Bag pot, 10% to the trader
///         airdrop pot and 65% to the treasury.
/// @dev The fee is taken on the quote side of the swap whichever way it goes: in beforeSwap when the quote is the
///      amount the swapper specified (exact-in buys, exact-out sells), in afterSwap when it is the other side
///      (exact-out buys, exact-in sells). During the swap the fee is kept as PoolManager claims (ERC-6909), since the
///      swapper pays the PoolManager only after the swap; `flush` turns the claims into tokens, sends the holders' part
///      to the payout contract and leaves Lootbag's part here for `split`. The holders' part is booked to the coin's
///      holders at the moment of the trade, so who earns it never depends on when it is flushed. Liquidity can only be added by the factory, in the launch, and only the factory
///      can remove it (the factory owner's `collect`, disclosed on the site). The owner can point the three shares of Lootbag's fee at new wallets, nothing else: no fee
///      change, no pause, no access to the holders' share or the swaps.
contract LootbagHook is IHooks, IUnlockCallback {
    error NotPoolManager();
    error NotFactory();
    error NotOwner();
    error Locked();
    error UnknownPool();
    error ZeroAddress();
    error FactorySet();

    event Fee(address indexed coin, address indexed quote, uint256 holders, uint256 lootbag);
    event Split(address indexed quote, uint256 bags, uint256 airdrop, uint256 treasury);
    event Wallets(address bagPot, address airdropPot, address treasury);
    event OwnerChanged(address owner);

    uint256 public constant FEE_BPS = 200; // 2% of every trade
    uint256 public constant HOLDERS_OF_FEE = 2500; // 0.5% of the trade: a quarter of the fee
    uint256 public constant BAGS_OF_LOOTBAG = 2500;
    uint256 public constant AIRDROP_OF_LOOTBAG = 1000;

    IPoolManager public immutable poolManager;
    address public factory;
    address public owner;
    address public pendingOwner;
    ILootbagPayout public payout;
    address public bagPot;
    address public airdropPot;
    address public treasury;

    struct Pool {
        address coin;
        address quote;
    }

    mapping(PoolId => Pool) public pools;
    /// @notice Lootbag's share of the fees, per quote currency, waiting to be split
    mapping(address => uint256) public owed;
    /// @notice the holders' share of the fees, per quote currency, not yet sent to the payout contract
    mapping(address => uint256) public owedHolders;
    /// @notice fees still held as PoolManager claims, per quote currency
    mapping(address => uint256) public claims;

    constructor(IPoolManager pm, address owner_) {
        poolManager = pm;
        owner = owner_;
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: true,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: true,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    modifier onlyPM() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    // ------------------------------------------------------------------ setup

    /// @notice One-time wiring, done in the deployment: the factory and the payout contract never change
    function init(address factory_, address payout_, address bagPot_, address airdropPot_, address treasury_) external {
        if (msg.sender != owner) revert NotOwner();
        if (factory != address(0)) revert FactorySet();
        if (factory_ == address(0) || payout_ == address(0)) revert ZeroAddress();
        factory = factory_;
        payout = ILootbagPayout(payout_);
        _setWallets(bagPot_, airdropPot_, treasury_);
    }

    /// @notice Points Lootbag's three shares at new wallets (fees already owed follow the new wallets)
    function setWallets(address bagPot_, address airdropPot_, address treasury_) external {
        if (msg.sender != owner) revert NotOwner();
        _setWallets(bagPot_, airdropPot_, treasury_);
    }

    function _setWallets(address b, address a, address t) internal {
        if (b == address(0) || a == address(0) || t == address(0)) revert ZeroAddress();
        bagPot = b;
        airdropPot = a;
        treasury = t;
        emit Wallets(b, a, t);
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotOwner();
        pendingOwner = to;
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnerChanged(msg.sender);
    }

    /// @notice The factory registers a pool just before it creates it
    function register(PoolId id, address coin, address quote) external {
        if (msg.sender != factory) revert NotFactory();
        pools[id] = Pool(coin, quote);
    }

    /// @notice Splits Lootbag's collected fees in `quote`: 25% Bag pot, 10% airdrop pot, 65% treasury. Anyone can call.
    function split(address quote) external {
        flush(quote);
        uint256 amt = owed[quote];
        if (amt == 0) return;
        owed[quote] = 0;
        uint256 b = (amt * BAGS_OF_LOOTBAG) / 10_000;
        uint256 a = (amt * AIRDROP_OF_LOOTBAG) / 10_000;
        _send(quote, bagPot, b);
        _send(quote, airdropPot, a);
        _send(quote, treasury, amt - b - a);
        emit Split(quote, b, a, amt - b - a);
    }

    /// @notice Turns the fees held as PoolManager claims into tokens and sends the holders' part to the payout
    ///         contract. Anyone can call; the payout contract calls it before every payout.
    function flush(address quote) public {
        if (claims[quote] != 0) poolManager.unlock(abi.encode(quote));
        uint256 h = owedHolders[quote];
        if (h != 0) {
            owedHolders[quote] = 0;
            _send(quote, address(payout), h);
        }
    }

    function unlockCallback(bytes calldata data) external onlyPM returns (bytes memory) {
        address quote = abi.decode(data, (address));
        uint256 c = claims[quote];
        claims[quote] = 0;
        poolManager.burn(address(this), uint256(uint160(quote)), c);
        poolManager.take(Currency.wrap(quote), address(this), c);
        return "";
    }

    // ------------------------------------------------------------------ hooks

    function beforeInitialize(address sender, PoolKey calldata key, uint160) external view onlyPM returns (bytes4) {
        if (sender != factory) revert NotFactory();
        if (pools[key.toId()].coin == address(0)) revert UnknownPool();
        return IHooks.beforeInitialize.selector;
    }

    function beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPM
        returns (bytes4)
    {
        if (sender != factory) revert NotFactory();
        return IHooks.beforeAddLiquidity.selector;
    }

    /// @notice Only the factory removes liquidity from a Lootbag pool (its owner's disclosed `collect`); nobody else can
    function beforeRemoveLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPM
        returns (bytes4)
    {
        if (sender != factory) revert Locked();
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata p, bytes calldata)
        external
        onlyPM
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        Pool memory pool = pools[key.toId()];
        bool exactIn = p.amountSpecified < 0;
        bool specified0 = exactIn == p.zeroForOne;
        Currency specified = specified0 ? key.currency0 : key.currency1;
        if (Currency.unwrap(specified) != pool.quote) return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        uint256 amt = uint256(exactIn ? -p.amountSpecified : p.amountSpecified);
        // exact-in buy: 2% of what is paid in; exact-out sell: 2% of the gross, so the seller gets exactly what they asked
        uint256 fee = exactIn ? (amt * FEE_BPS) / 10_000 : (amt * FEE_BPS) / (10_000 - FEE_BPS);
        if (fee == 0) return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        _collect(pool, fee);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata p, BalanceDelta delta, bytes calldata)
        external
        onlyPM
        returns (bytes4, int128)
    {
        Pool memory pool = pools[key.toId()];
        bool exactIn = p.amountSpecified < 0;
        bool specified0 = exactIn == p.zeroForOne;
        Currency unspecified = specified0 ? key.currency1 : key.currency0;
        if (Currency.unwrap(unspecified) != pool.quote) return (IHooks.afterSwap.selector, 0);
        int128 q = specified0 ? delta.amount1() : delta.amount0();
        uint256 amt = uint256(int256(q < 0 ? -q : q));
        uint256 fee = (amt * FEE_BPS) / 10_000;
        if (fee == 0) return (IHooks.afterSwap.selector, 0);
        _collect(pool, fee);
        return (IHooks.afterSwap.selector, int128(int256(fee)));
    }

    /// @dev keeps the fee as a PoolManager claim (the returned delta pays for it) and books the holders' share now
    function _collect(Pool memory pool, uint256 fee) internal {
        poolManager.mint(address(this), uint256(uint160(pool.quote)), fee);
        claims[pool.quote] += fee;
        uint256 holders = (fee * HOLDERS_OF_FEE) / 10_000;
        owedHolders[pool.quote] += holders;
        payout.credit(pool.coin, holders);
        owed[pool.quote] += fee - holders;
        emit Fee(pool.coin, pool.quote, holders, fee - holders);
    }

    function _send(address token, address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok, bytes memory r) = token.call(abi.encodeCall(IERC20Min.transfer, (to, amt)));
        require(ok && (r.length == 0 || abi.decode(r, (bool))), "transfer");
    }

    // ------------------------------------------------------------------ unused hooks

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert();
    }

    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        revert();
    }

    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        revert();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert();
    }
}
