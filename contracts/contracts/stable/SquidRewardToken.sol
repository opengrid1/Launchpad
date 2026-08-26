// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IFeeRecipientSource {
    function feeRecipient() external view returns (address);
}

/// @title SquidRewardToken
/// @notice Launchpad token with fully automatic, per-trade holder rewards.
///         There is no harvest step anywhere: on every BUY (a transfer out of
///         the AMM pool) the token itself skims a 1% fee in coins and records
///         it instantly - 0.50% to all holders via an O(1) accumulator, 0.40%
///         to the coin's creator and 0.10% to the platform. Sells are never
///         skimmed (Uniswap V3 pools reject fee-on-transfer on the input
///         side), so selling always works.
///
///         Claims are pull-based and named for their audience:
///           - holders call {claimRewards} (alias {claim} for integrations);
///           - the creator alone calls {claimCreatorFees};
///           - anyone may push {claimPlatformFees} to the platform wallet.
///
///         `owner()` is always the zero address: no taxes beyond the fixed
///         skim, no controls beyond the factory's one-time pool wiring.
contract SquidRewardToken is ERC20 {
    uint256 private constant ACC_PRECISION = 1e24;
    /// @notice Per-buy skim, in bps of the bought amount: holders / creator /
    ///         platform. Total 1%.
    uint16 public constant HOLDER_FEE_BPS = 50;
    uint16 public constant CREATOR_FEE_BPS = 40;
    uint16 public constant PLATFORM_FEE_BPS = 10;

    /// @notice Wallet credited as the token's creator (immutable attribution).
    address public immutable creator;
    /// @dev The launchpad factory: mints recipient, pool wirer, fee-recipient source.
    address private immutable _factory;

    /// @notice The AMM pool this coin trades on (set once by the factory).
    address public pool;

    /// @dev Accumulated reward per eligible share, scaled by ACC_PRECISION.
    uint256 private accRewardPerShare;
    /// @notice Supply eligible for rewards (excludes pool/system holders).
    uint256 public eligibleSupply;
    mapping(address => uint256) private rewardDebt;
    /// @dev Settled-but-unclaimed rewards per holder, in coins.
    mapping(address => uint256) public claimable;
    /// @notice Addresses that do not participate in rewards (pool, system).
    mapping(address => bool) public excluded;

    /// @notice Lifetime coins credited to holders.
    uint256 public totalRewardsDistributed;
    /// @notice Creator fees accrued and not yet claimed, in coins.
    uint256 public creatorFees;
    /// @notice Platform fees accrued and not yet claimed, in coins.
    uint256 public platformFees;

    string private _metadataURI;

    event RewardsAccrued(uint256 holderAmount, uint256 creatorAmount, uint256 platformAmount);
    event RewardsClaimed(address indexed holder, uint256 amount);
    event CreatorFeesClaimed(address indexed creator, uint256 amount);
    event PlatformFeesClaimed(address indexed recipient, uint256 amount);
    event ExcludedSet(address indexed account, bool excluded);

    error OnlyFactory();
    error OnlyCreator();
    error PoolAlreadySet();
    error Disabled();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 supply_,
        address creator_,
        address factory_,
        address // rewardToken slot kept for deployer-signature parity; rewards pay in this coin
    ) ERC20(name_, symbol_) {
        creator = creator_;
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

    /// @notice Rewards are paid in this coin itself.
    function rewardToken() external view returns (address) {
        return address(this);
    }

    /// @notice One-time pool wiring by the factory.
    function initPool(address pool_) external {
        if (msg.sender != _factory) revert OnlyFactory();
        if (pool != address(0)) revert PoolAlreadySet();
        pool = pool_;
        _setExcluded(pool_, true);
    }

    /// @notice Rewards accrue automatically per trade; the harvest path from
    ///         older tokens is disabled so nothing can double-distribute.
    function distributeRewards(uint256) external pure {
        revert Disabled();
    }

    // ------------------------------------------------------------------
    // Views + claims
    // ------------------------------------------------------------------

    /// @notice Pending, not-yet-claimed rewards for a holder, in coins.
    function pendingRewards(address holder) public view returns (uint256) {
        if (excluded[holder]) return claimable[holder];
        uint256 accrued = (balanceOf(holder) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[holder];
        return claimable[holder] + (accrued > debt ? accrued - debt : 0);
    }

    /// @notice Claim all accrued holder rewards to the caller.
    function claimRewards() public returns (uint256 amount) {
        return _claimTo(msg.sender);
    }

    /// @notice Alias of {claimRewards} for wallets and integrations.
    function claim() external returns (uint256 amount) {
        return claimRewards();
    }

    /// @notice Push a holder's rewards to THEIR wallet; callable by anyone.
    function claimFor(address holder) external returns (uint256 amount) {
        return _claimTo(holder);
    }

    /// @notice Batch push for keepers.
    function claimForMany(address[] calldata holders) external {
        for (uint256 i; i < holders.length; ++i) _claimTo(holders[i]);
    }

    /// @notice Creator-only: claim the accrued dev fees.
    function claimCreatorFees() external returns (uint256 amount) {
        if (msg.sender != creator) revert OnlyCreator();
        amount = creatorFees;
        if (amount == 0) return 0;
        creatorFees = 0;
        _transfer(address(this), creator, amount);
        emit CreatorFeesClaimed(creator, amount);
    }

    /// @notice Push accrued platform fees to the factory's fee recipient.
    function claimPlatformFees() external returns (uint256 amount) {
        address to = IFeeRecipientSource(_factory).feeRecipient();
        amount = platformFees;
        if (amount == 0) return 0;
        platformFees = 0;
        _transfer(address(this), to, amount);
        emit PlatformFeesClaimed(to, amount);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _claimTo(address holder) private returns (uint256 amount) {
        _settle(holder);
        amount = claimable[holder];
        if (amount == 0) return 0;
        claimable[holder] = 0;
        emit RewardsClaimed(holder, amount);
        _transfer(address(this), holder, amount);
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
