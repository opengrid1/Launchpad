// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IPairConverter {
    /// @dev Convert `amount` of `pair` (pulled from the caller by allowance)
    ///      into native ETH along `route` and send it to `to`.
    function pairToEth(address pair, uint256 amount, address to, uint256 minOut, bytes calldata route) external returns (uint256 ethOut);
}

interface IFeeRecipientSource {
    function feeRecipient() external view returns (address);
}

interface IEtherStockHook {
    /// @dev Deliver fees the hook still holds for `token` as V4 claims.
    function flush(address token) external returns (uint256);
}

/// @title EtherStockToken
/// @notice The Etherstock coin. Fixed 1B supply, no owner, no mint, no pause,
///         metadata on-chain. Every swap in the coin's Uniswap V4 pool pays a
///         fee in the PAIR asset (ETH or a tokenized stock); the pool hook
///         hands that fee to this contract and calls {accrue}, which credits
///         creator / platform on the spot and sets the burn share aside.
///
///         Auto buyback and burn: once the burn share reaches `buybackMin`
///         (about $25 of the pair, set at launch) the very next swap in the
///         pool triggers a buyback. Still inside that swap's PoolManager
///         unlock, this contract swaps the whole reserve into its own coin
///         through the same pool and burns what it gets. No keeper, no gas
///         wallet, no button. Anyone may also call {buybackAndBurn} directly,
///         which does the same in its own unlock. The hook charges no fee on
///         the coin's own buyback swaps.
///
///         Anti-snipe: in the launch block only the creator may receive coins
///         from the pool; for the next PROTECT_BLOCKS every wallet is capped at
///         MAX_BUY_BPS bought and MAX_HOLD_BPS held. The hook adds a decaying
///         fee on top for the first seconds.
contract EtherStockToken is ERC20, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;

    uint16 internal constant BPS = 10_000;

    /// @notice Wallet credited as the coin's creator (immutable attribution).
    address public immutable creator;
    /// @notice The coin's pair asset. Fees are paid in this.
    address public immutable pairAsset;
    /// @notice The V4 PoolManager: coins arriving from it are buys.
    IPoolManager public immutable poolManager;
    /// @notice Fee split, bps of every fee: creator / burn; the rest is platform.
    uint16 public immutable creatorBps;
    uint16 public immutable burnBps;
    address private immutable _factory;

    /// @notice The pool hook that skims fees; set once by the factory.
    address public hook;
    /// @notice The router that converts pair fees to ETH on request; set once.
    address public converter;
    /// @notice The coin's own pool, for buybacks.
    PoolKey public poolKey;
    bool public tokenIsCurrency0;
    /// @notice Pair amount the burn reserve must reach before a swap triggers a buyback.
    uint256 public buybackMin;

    /// @notice Lifetime pair-asset credited to creator / platform / the burn reserve.
    uint256 public totalCreatorFees;
    uint256 public totalPlatformFees;
    uint256 public totalBurnFees;
    /// @notice Accrued and not yet claimed, in the pair asset.
    uint256 public creatorFees;
    uint256 public platformFees;
    /// @notice Pair asset waiting to be spent on the next buyback.
    uint256 public burnReserve;
    /// @notice Lifetime pair spent on buybacks and coins burned by them.
    uint256 public totalBuybackPair;
    uint256 public totalBurned;
    bool private _inBuyback;

    // Anti-snipe launch protection.
    uint256 public constant PROTECT_BLOCKS = 3;
    uint16 public constant MAX_HOLD_BPS = 300; // 3% of supply
    uint16 public constant MAX_BUY_BPS = 300;
    uint256 public launchBlock;
    uint256 public launchTime;
    mapping(address => uint256) private _boughtInWindow;

    /// @notice Addresses the launch caps do not apply to (pool, factory, hook, router).
    mapping(address => bool) public excluded;

    string private _metadataURI;

    event FeesAccrued(uint256 burnAmount, uint256 creatorAmount, uint256 platformAmount);
    event Buyback(uint256 pairIn, uint256 coinsBurned, bool inSwap);
    event CreatorFeesClaimed(address indexed creator, uint256 amount, bool asEth);
    event PlatformFeesClaimed(address indexed recipient, uint256 amount);
    event ExcludedSet(address indexed account, bool excluded);
    event HookSet(address indexed hook, address indexed converter);

    error OnlyFactory();
    error OnlyHook();
    error OnlyCreator();
    error OnlyPoolManager();
    error AlreadyInit();
    error LaunchGuard();
    error BuyCap();
    error HoldCap();
    error NoConverter();
    error NothingToBuy();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 supply_,
        address creator_,
        address factory_,
        address pairAsset_,
        IPoolManager poolManager_,
        uint16 creatorBps_,
        uint16 burnBps_
    ) ERC20(name_, symbol_) {
        creator = creator_;
        pairAsset = pairAsset_;
        poolManager = poolManager_;
        creatorBps = creatorBps_;
        burnBps = burnBps_;
        _factory = factory_;
        _metadataURI = metadataURI_;

        excluded[address(0)] = true;
        excluded[address(this)] = true;
        excluded[factory_] = true;
        excluded[address(poolManager_)] = true;

        _mint(factory_, supply_);
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Interface parity with the other launchpad coins: never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice One-time wiring by the factory in the launch transaction.
    function initHook(address hook_, address converter_, PoolKey calldata key, bool tokenIsCurrency0_, uint256 buybackMin_, address[] calldata excludedAddrs) external {
        if (msg.sender != _factory) revert OnlyFactory();
        if (hook != address(0)) revert AlreadyInit();
        hook = hook_;
        converter = converter_;
        poolKey = key;
        tokenIsCurrency0 = tokenIsCurrency0_;
        buybackMin = buybackMin_;
        emit HookSet(hook_, converter_);
        _setExcluded(hook_, true);
        if (converter_ != address(0)) _setExcluded(converter_, true);
        for (uint256 i; i < excludedAddrs.length; ++i) _setExcluded(excludedAddrs[i], true);
        launchBlock = block.number;
        launchTime = block.timestamp;
    }

    // ------------------------------------------------------------------
    // Fee accrual (hook-driven, automatic)
    // ------------------------------------------------------------------

    /// @notice Called by the pool hook, inside a swap, after it moved `fee + extra`
    ///         of the pair asset into this contract (or credited it as a claim).
    ///         `fee` is split creator / burn / platform; `extra` (the anti-snipe
    ///         surcharge) is platform only. When the burn reserve is ready, the
    ///         buyback runs right here, inside the same PoolManager unlock.
    function accrue(uint256 fee, uint256 extra) external {
        if (msg.sender != hook) revert OnlyHook();
        if (fee == 0 && extra == 0) return;
        uint256 burnFee = (fee * burnBps) / BPS;
        uint256 creatorFee = (fee * creatorBps) / BPS;
        uint256 platformFee = fee - burnFee - creatorFee + extra;

        burnReserve += burnFee;
        creatorFees += creatorFee;
        platformFees += platformFee;
        totalBurnFees += burnFee;
        totalCreatorFees += creatorFee;
        totalPlatformFees += platformFee;
        emit FeesAccrued(burnFee, creatorFee, platformFee);

        // The pool is unlocked (we are inside a swap's callback), so the
        // buyback can swap directly and settle its own deltas.
        uint256 reserve = burnReserve;
        if (!_inBuyback && reserve >= buybackMin && IERC20(pairAsset).balanceOf(address(this)) >= reserve) {
            _buyback(reserve, true);
        }
    }

    // ------------------------------------------------------------------
    // Buyback and burn
    // ------------------------------------------------------------------

    /// @notice Spend the whole burn reserve on the coin and burn it. Anyone may
    ///         call at any time; the swap happens in this call's own unlock.
    function buybackAndBurn() external nonReentrant returns (uint256 burned) {
        uint256 reserve = burnReserve;
        if (reserve == 0) revert NothingToBuy();
        _ensure(reserve);
        bytes memory res = poolManager.unlock(abi.encode(reserve));
        burned = abi.decode(res, (uint256));
    }

    /// @dev {buybackAndBurn} only: the unlock body.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        uint256 reserve = abi.decode(data, (uint256));
        return abi.encode(_buyback(reserve, false));
    }

    /// @dev Swap `pairIn` of the pair into the coin through our own pool and
    ///      burn the output. Requires an active PoolManager unlock; settles the
    ///      pair leg by transfer and takes the coin leg here.
    function _buyback(uint256 pairIn, bool inSwap) private returns (uint256 burned) {
        _inBuyback = true;
        burnReserve -= pairIn;
        bool zeroForOne = !tokenIsCurrency0; // pair in, coin out
        BalanceDelta d = poolManager.swap(
            poolKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(pairIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 pairDelta = tokenIsCurrency0 ? d.amount1() : d.amount0();
        int128 coinDelta = tokenIsCurrency0 ? d.amount0() : d.amount1();
        if (pairDelta < 0) {
            Currency pc = Currency.wrap(pairAsset);
            poolManager.sync(pc);
            IERC20(pairAsset).safeTransfer(address(poolManager), uint256(uint128(-pairDelta)));
            poolManager.settle();
        }
        if (coinDelta > 0) {
            burned = uint256(uint128(coinDelta));
            poolManager.take(Currency.wrap(address(this)), address(this), burned);
            _burn(address(this), burned);
        }
        totalBuybackPair += pairIn;
        totalBurned += burned;
        _inBuyback = false;
        emit Buyback(pairIn, burned, inSwap);
    }

    // ------------------------------------------------------------------
    // Claims
    // ------------------------------------------------------------------

    /// @notice Creator-only: claim accrued creator fees, in the pair or as ETH.
    function claimCreatorFees(bool asEth, uint256 minEthOut, bytes calldata route) external nonReentrant returns (uint256 amount) {
        if (msg.sender != creator) revert OnlyCreator();
        amount = creatorFees;
        if (amount == 0) return 0;
        creatorFees = 0;
        _payout(creator, amount, asEth, minEthOut, route);
        emit CreatorFeesClaimed(creator, amount, asEth);
    }

    /// @notice Push accrued platform fees to the factory's fee recipient. Anyone.
    function claimPlatformFees() external nonReentrant returns (uint256 amount) {
        address to = IFeeRecipientSource(_factory).feeRecipient();
        amount = platformFees;
        if (amount == 0) return 0;
        platformFees = 0;
        _ensure(amount);
        IERC20(pairAsset).safeTransfer(to, amount);
        emit PlatformFeesClaimed(to, amount);
    }

    /// @notice Burn coins held by the caller.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev Fees are credited the moment a swap happens, but the hook may still
    ///      be holding the pair as a V4 claim (see EtherStockHook). Pull it in
    ///      before paying out.
    function _ensure(uint256 amount) private {
        if (IERC20(pairAsset).balanceOf(address(this)) < amount && hook != address(0)) IEtherStockHook(hook).flush(address(this));
    }

    function _payout(address to, uint256 amount, bool asEth, uint256 minEthOut, bytes memory route) private {
        _ensure(amount);
        if (!asEth) {
            IERC20(pairAsset).safeTransfer(to, amount);
            return;
        }
        address c = converter;
        if (c == address(0)) revert NoConverter();
        IERC20(pairAsset).forceApprove(c, amount);
        IPairConverter(c).pairToEth(pairAsset, amount, to, minEthOut, route);
    }

    function _setExcluded(address account, bool value) private {
        if (excluded[account] == value) return;
        excluded[account] = value;
        emit ExcludedSet(account, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Anti-snipe: throttle buys (coins leaving the PoolManager) during the
        // launch window. Sells and system transfers are unaffected.
        // Coins reach a buyer straight from the PoolManager, or through the
        // launchpad router (PoolManager -> router -> buyer); both count.
        if ((from == address(poolManager) || (from == converter && from != address(0))) && !excluded[to] && value > 0) {
            uint256 lb = launchBlock;
            if (lb != 0 && block.number < lb + PROTECT_BLOCKS) {
                if (block.number == lb) {
                    if (to != creator) revert LaunchGuard();
                } else {
                    uint256 supply = totalSupply();
                    uint256 bought = _boughtInWindow[to] + value;
                    if (bought > (supply * MAX_BUY_BPS) / BPS) revert BuyCap();
                    if (balanceOf(to) + value > (supply * MAX_HOLD_BPS) / BPS) revert HoldCap();
                    _boughtInWindow[to] = bought;
                }
            }
        }
        super._update(from, to, value);
    }
}
