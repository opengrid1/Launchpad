// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IFeeRecipientSource {
    function feeRecipient() external view returns (address);
    function swapRouter() external view returns (address);
    function POOL_FEE_TIER() external view returns (uint24);
}

interface ISquidRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface ISquidPool {
    function slot0() external view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool);
    function token0() external view returns (address);
}

/// @title SquidRewardToken
/// @notice Launchpad token with fully automatic, per-trade holder rewards that
///         are PAID OUT IN THE COIN'S PAIR ASSET (the tokenized stock, or WETH
///         for ETH-paired coins).
///
///         On every BUY (a transfer out of the AMM pool) the token skims a 1%
///         fee in coins and records it instantly - 0.50% to holders via an O(1)
///         accumulator, 0.40% to the creator, 0.10% to the platform. There is
///         no harvest step: by the time a buy confirms, every share is booked.
///         Sells are never skimmed (Uniswap V3 rejects fee-on-transfer on the
///         input side), so selling always works.
///
///         Claims convert on the spot: the skimmed coins owed to the claimer
///         are swapped through the coin's own pool into the pair asset and sent
///         out as that asset. Holders call {claimRewards}, the creator alone
///         calls {claimCreatorFees}, and anyone may push {claimPlatformFees}.
///         `pendingRewards` and `rewardToken` are denominated in the pair asset
///         so wallets show the stock the holder will receive.
///
///         `owner()` is always the zero address: no taxes beyond the fixed
///         skim, no controls beyond the factory's one-time pool wiring.
contract SquidRewardToken is ERC20, ReentrancyGuard {
    uint256 private constant ACC_PRECISION = 1e24;
    uint256 private constant Q96 = 0x1000000000000000000000000; // 2**96
    /// @notice Per-buy skim, in bps of the bought amount: holders / creator /
    ///         platform. Total 1%.
    uint16 public constant HOLDER_FEE_BPS = 50;
    uint16 public constant CREATOR_FEE_BPS = 40;
    uint16 public constant PLATFORM_FEE_BPS = 10;

    /// @notice Anti-snipe launch protection (adapted from the pons model). For a
    ///         short window after the pool opens, buys are throttled so bots
    ///         cannot grab a huge share on block one and dump on holders:
    ///           - on the launch block itself, only the creator's initial buy
    ///             executes (every other buy reverts);
    ///           - for the rest of the window, each wallet may buy at most
    ///             MAX_BUY_BPS and hold at most MAX_HOLD_BPS of total supply.
    ///         After the window all limits lift permanently. Sells are never
    ///         restricted.
    uint256 public constant PROTECT_BLOCKS = 2;
    uint16 public constant MAX_HOLD_BPS = 500;  // 5% of supply
    uint16 public constant MAX_BUY_BPS = 550;   // 5.5% of supply
    /// @notice Block the pool opened on; the protection window is
    ///         [launchBlock, launchBlock + PROTECT_BLOCKS). Zero until wired.
    uint256 public launchBlock;
    /// @dev Cumulative amount each wallet has bought during the window.
    mapping(address => uint256) private _boughtInWindow;

    /// @notice Wallet credited as the token's creator (immutable attribution).
    address public immutable creator;
    /// @notice The coin's pair asset: rewards are swapped into and paid in this
    ///         (a tokenized stock, or WETH for an ETH-paired coin).
    address public immutable pairAsset;
    /// @dev The launchpad factory: mints recipient, pool wirer, config source.
    address private immutable _factory;

    /// @notice The AMM pool this coin trades on (set once by the factory).
    address public pool;
    /// @dev SwapRouter and fee tier for the pool, cached from the factory.
    address private _router;
    uint24 private _feeTier;

    /// @dev Accumulated reward per eligible share, scaled by ACC_PRECISION.
    uint256 private accRewardPerShare;
    /// @notice Supply eligible for rewards (excludes pool/system holders).
    uint256 public eligibleSupply;
    mapping(address => uint256) private rewardDebt;
    /// @dev Settled-but-unclaimed rewards per holder, in COINS.
    mapping(address => uint256) public claimable;
    /// @notice Addresses that do not participate in rewards (pool, system).
    mapping(address => bool) public excluded;

    /// @notice Lifetime coins credited to holders (coin-denominated).
    uint256 public totalRewardsDistributed;
    /// @notice Creator fees accrued and not yet claimed, in COINS.
    uint256 public creatorFees;
    /// @notice Platform fees accrued and not yet claimed, in COINS.
    uint256 public platformFees;

    string private _metadataURI;

    event RewardsAccrued(uint256 holderAmount, uint256 creatorAmount, uint256 platformAmount);
    event RewardsClaimed(address indexed holder, uint256 coinAmount, uint256 pairAmount);
    event CreatorFeesClaimed(address indexed creator, uint256 coinAmount, uint256 pairAmount);
    event PlatformFeesClaimed(address indexed recipient, uint256 coinAmount, uint256 pairAmount);
    event ExcludedSet(address indexed account, bool excluded);

    error OnlyFactory();
    error OnlyCreator();
    error PoolAlreadySet();
    error LaunchGuard();
    error BuyCap();
    error HoldCap();
    error Disabled();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 supply_,
        address creator_,
        address factory_,
        address pairAsset_ // the coin's quote asset; rewards pay in this
    ) ERC20(name_, symbol_) {
        creator = creator_;
        pairAsset = pairAsset_;
        _factory = factory_;
        _metadataURI = metadataURI_;

        excluded[address(0)] = true;
        excluded[address(this)] = true;
        excluded[factory_] = true;

        _mint(factory_, supply_);
    }

    /// @notice Off-chain metadata JSON (description, logo, website, socials).
    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Interface parity with the launchpad's other tokens: never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice The asset rewards are paid in: this coin's pair (stock or WETH).
    function rewardToken() external view returns (address) {
        return pairAsset;
    }

    /// @notice One-time pool wiring by the factory: records the pool, excludes
    ///         it, and caches the router/tier plus an infinite coin allowance so
    ///         claims can swap coins to the pair asset.
    function initPool(address pool_) external {
        if (msg.sender != _factory) revert OnlyFactory();
        if (pool != address(0)) revert PoolAlreadySet();
        pool = pool_;
        _setExcluded(pool_, true);
        // Open the anti-snipe protection window from this block.
        launchBlock = block.number;

        _router = IFeeRecipientSource(_factory).swapRouter();
        _feeTier = IFeeRecipientSource(_factory).POOL_FEE_TIER();
        _approve(address(this), _router, type(uint256).max);
    }

    /// @notice Rewards accrue automatically per trade; the harvest path from
    ///         older tokens is disabled so nothing can double-distribute.
    function distributeRewards(uint256) external pure {
        revert Disabled();
    }

    // ------------------------------------------------------------------
    // Views + claims
    // ------------------------------------------------------------------

    /// @notice Pending, not-yet-claimed rewards for a holder, quoted in the
    ///         pair asset at the pool's current price (what a claim would pay,
    ///         before swap slippage).
    function pendingRewards(address holder) public view returns (uint256) {
        return _quoteToPair(pendingRewardsCoin(holder));
    }

    /// @notice Pending holder rewards in coin terms (pre-swap).
    function pendingRewardsCoin(address holder) public view returns (uint256) {
        if (excluded[holder]) return claimable[holder];
        uint256 accrued = (balanceOf(holder) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[holder];
        return claimable[holder] + (accrued > debt ? accrued - debt : 0);
    }

    /// @notice Creator fees quoted in the pair asset.
    function creatorFeesInPair() external view returns (uint256) {
        return _quoteToPair(creatorFees);
    }

    /// @notice Claim all accrued holder rewards to the caller, paid in the pair
    ///         asset.
    function claimRewards() public returns (uint256 pairAmount) {
        return _claimTo(msg.sender);
    }

    /// @notice Alias of {claimRewards} for wallets and integrations.
    function claim() external returns (uint256 pairAmount) {
        return claimRewards();
    }

    /// @notice Push a holder's rewards to THEIR wallet; callable by anyone.
    function claimFor(address holder) external returns (uint256 pairAmount) {
        return _claimTo(holder);
    }

    /// @notice Batch push for keepers.
    function claimForMany(address[] calldata holders) external {
        for (uint256 i; i < holders.length; ++i) _claimTo(holders[i]);
    }

    /// @notice Creator-only: claim the accrued dev fees, paid in the pair asset.
    function claimCreatorFees() external nonReentrant returns (uint256 pairAmount) {
        if (msg.sender != creator) revert OnlyCreator();
        uint256 coinAmount = creatorFees;
        if (coinAmount == 0) return 0;
        creatorFees = 0;
        pairAmount = _swapToPair(coinAmount, creator);
        emit CreatorFeesClaimed(creator, coinAmount, pairAmount);
    }

    /// @notice Push accrued platform fees to the factory's fee recipient, paid
    ///         in the pair asset.
    function claimPlatformFees() external nonReentrant returns (uint256 pairAmount) {
        address to = IFeeRecipientSource(_factory).feeRecipient();
        uint256 coinAmount = platformFees;
        if (coinAmount == 0) return 0;
        platformFees = 0;
        pairAmount = _swapToPair(coinAmount, to);
        emit PlatformFeesClaimed(to, coinAmount, pairAmount);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _claimTo(address holder) private nonReentrant returns (uint256 pairAmount) {
        _settle(holder);
        uint256 coinAmount = claimable[holder];
        if (coinAmount == 0) return 0;
        claimable[holder] = 0;
        pairAmount = _swapToPair(coinAmount, holder);
        emit RewardsClaimed(holder, coinAmount, pairAmount);
    }

    /// @dev Swap `coinAmount` of this coin into the pair asset through the
    ///      coin's own pool and send it to `to`. amountOutMinimum is 0: the
    ///      amounts are tiny next to the seeded pool, and it is the coin's own
    ///      market, so there is nothing to sandwich meaningfully.
    function _swapToPair(uint256 coinAmount, address to) private returns (uint256) {
        return ISquidRouter(_router).exactInputSingle(
            ISquidRouter.ExactInputSingleParams({
                tokenIn: address(this),
                tokenOut: pairAsset,
                fee: _feeTier,
                recipient: to,
                amountIn: coinAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @dev Spot-quote `coinAmount` of this coin into the pair asset from the
    ///      pool price. Both coin and pair are 18 decimals, so no decimal gap.
    function _quoteToPair(uint256 coinAmount) private view returns (uint256) {
        if (coinAmount == 0 || pool == address(0)) return 0;
        (uint160 sqrtP,,,,,,) = ISquidPool(pool).slot0();
        if (sqrtP == 0) return 0;
        bool coinIsToken0 = ISquidPool(pool).token0() == address(this);
        if (coinIsToken0) {
            // pair per coin = (sqrtP/Q96)^2
            return Math.mulDiv(Math.mulDiv(coinAmount, sqrtP, Q96), sqrtP, Q96);
        }
        // pair per coin = (Q96/sqrtP)^2
        return Math.mulDiv(Math.mulDiv(coinAmount, Q96, sqrtP), Q96, sqrtP);
    }

    function _settle(address account) private {
        if (account == address(0) || excluded[account]) return;
        uint256 accrued = (balanceOf(account) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[account];
        if (accrued > debt) claimable[account] += accrued - debt;
        rewardDebt[account] = accrued;
    }

    function _resetDebt(address account) private {
        rewardDebt[account] = (balanceOf(account) * accRewardPerShare) / ACC_PRECISION;
    }

    function _setExcluded(address account, bool value) private {
        if (excluded[account] == value) return;
        uint256 bal = balanceOf(account);
        if (value) {
            _settle(account);
            if (bal != 0) eligibleSupply -= bal;
        } else {
            if (bal != 0) eligibleSupply += bal;
            _resetDebt(account);
        }
        excluded[account] = value;
        emit ExcludedSet(account, value);
    }

    /// @dev A transfer OUT of the pool to a normal wallet is a buy: skim the
    ///      1% fee into this contract and record every share instantly. All
    ///      other transfers (sells into the pool included) move untouched.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && from == pool && !excluded[to] && value > 0) {
            // Anti-snipe: throttle buys during the launch window (sells and
            // excluded/system transfers are unaffected).
            uint256 lb = launchBlock;
            if (lb != 0 && block.number < lb + PROTECT_BLOCKS) {
                if (block.number == lb) {
                    // Launch block: only the creator's initial buy executes.
                    if (to != creator) revert LaunchGuard();
                } else {
                    uint256 supply = totalSupply();
                    uint256 bought = _boughtInWindow[to] + value;
                    if (bought > (supply * MAX_BUY_BPS) / 10_000) revert BuyCap();
                    // balanceOf(to) is still pre-transfer here; add net received.
                    if (balanceOf(to) + value > (supply * MAX_HOLD_BPS) / 10_000) revert HoldCap();
                    _boughtInWindow[to] = bought;
                }
            }

            uint256 holderFee = (value * HOLDER_FEE_BPS) / 10_000;
            uint256 creatorFee = (value * CREATOR_FEE_BPS) / 10_000;
            uint256 platformFee = (value * PLATFORM_FEE_BPS) / 10_000;
            uint256 fee = holderFee + creatorFee + platformFee;

            _move(from, to, value - fee);
            _move(from, address(this), fee);

            // Buyer's coins are already in `eligibleSupply` here, so their own
            // buy accrues them a share of this very trade's reward.
            if (holderFee > 0) {
                uint256 supply = eligibleSupply;
                if (supply > 0) {
                    accRewardPerShare += (holderFee * ACC_PRECISION) / supply;
                    totalRewardsDistributed += holderFee;
                } else {
                    creatorFee += holderFee;
                    holderFee = 0;
                }
            }
            creatorFees += creatorFee;
            platformFees += platformFee;
            emit RewardsAccrued(holderFee, creatorFee, platformFee);
            return;
        }
        _move(from, to, value);
    }

    /// @dev Core balance move with reward-eligibility accounting.
    function _move(address from, address to, uint256 value) private {
        bool fromEligible = from != address(0) && !excluded[from];
        bool toEligible = to != address(0) && !excluded[to];

        if (fromEligible) _settle(from);
        if (toEligible) _settle(to);

        super._update(from, to, value);

        if (fromEligible && !toEligible) eligibleSupply -= value;
        else if (!fromEligible && toEligible) eligibleSupply += value;

        if (fromEligible) _resetDebt(from);
        if (toEligible) _resetDebt(to);
    }
}
