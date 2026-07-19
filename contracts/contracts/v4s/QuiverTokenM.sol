// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title QuiverTokenM
/// @notice Fixed-supply launchpad token whose holders earn a BASKET of up to
///         five reward ERC-20s (tokenized stocks). Same gas-safe MasterChef
///         accumulator as QuiverToken, one accumulator per reward token, all
///         settled together on every transfer so sellers stop accruing
///         instantly. Rewards are pushed to holder wallets by the keeper via
///         the permissionless claimFor/claimForMany — no user action needed.
contract QuiverTokenM is ERC20 {
    using SafeERC20 for IERC20;

    uint256 private constant ACC_PRECISION = 1e24;
    uint256 public constant MAX_REWARDS = 5;

    address public immutable creator;
    address public hook;
    uint16 public immutable taxBps;

    /// @notice Reward currencies (1..5 tokenized stocks), fixed at launch.
    address[] private _rewardTokens;

    /// @dev One accumulator per reward index.
    uint256[MAX_REWARDS] private accRewardPerShare;
    uint256 public eligibleSupply;
    mapping(address => uint256[MAX_REWARDS]) private rewardDebt;
    mapping(address => uint256[MAX_REWARDS]) private _claimable;
    mapping(address => bool) public excluded;

    /// @notice Lifetime distributed per reward index, in that reward's units.
    uint256[MAX_REWARDS] private _totalDistributed;

    string private _metadataURI;

    event HookSet(address indexed hook);
    event ExcludedSet(address indexed account, bool excluded);
    event RewardsDistributed(uint8 indexed idx, uint256 amount);
    event RewardsClaimed(address indexed holder, uint8 indexed idx, uint256 amount);

    error OnlyFactory();
    error OnlyHook();
    error HookAlreadySet();
    error BadRewards();

    address private immutable _factory;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 supply_,
        address creator_,
        address supplyRecipient_,
        uint16 taxBps_,
        address[] memory rewardTokens_
    ) ERC20(name_, symbol_) {
        require(taxBps_ <= 1000, "tax>10%");
        uint256 n = rewardTokens_.length;
        if (n == 0 || n > MAX_REWARDS) revert BadRewards();
        for (uint256 i; i < n; ++i) {
            if (rewardTokens_[i] == address(0)) revert BadRewards();
            for (uint256 j; j < i; ++j) if (rewardTokens_[i] == rewardTokens_[j]) revert BadRewards();
        }
        _factory = msg.sender;
        creator = creator_;
        taxBps = taxBps_;
        _rewardTokens = rewardTokens_;
        _metadataURI = metadataURI_;

        excluded[address(0)] = true;
        excluded[address(this)] = true;
        excluded[supplyRecipient_] = true;

        _mint(supplyRecipient_, supply_);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    function rewardCount() public view returns (uint256) {
        return _rewardTokens.length;
    }

    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    /// @notice First reward currency — kept for QuiverToken ABI compatibility.
    function rewardToken() external view returns (address) {
        return _rewardTokens[0];
    }

    function totalRewardsDistributedAt(uint256 idx) external view returns (uint256) {
        return _totalDistributed[idx];
    }

    /// @notice Pending (settled + unsettled) rewards per reward index.
    function pendingRewardsAll(address holder) public view returns (uint256[] memory out) {
        uint256 n = _rewardTokens.length;
        out = new uint256[](n);
        bool ex = excluded[holder];
        uint256 bal = balanceOf(holder);
        for (uint256 i; i < n; ++i) {
            uint256 c = _claimable[holder][i];
            if (!ex) {
                uint256 accrued = (bal * accRewardPerShare[i]) / ACC_PRECISION;
                uint256 debt = rewardDebt[holder][i];
                if (accrued > debt) c += accrued - debt;
            }
            out[i] = c;
        }
    }

    /// @notice Aggregate pending across the basket (keeper "anything due?" probe).
    ///         Mixed units — meaningful only as a zero/non-zero signal.
    function pendingRewards(address holder) external view returns (uint256 total) {
        uint256[] memory p = pendingRewardsAll(holder);
        for (uint256 i; i < p.length; ++i) total += p[i];
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Factory wiring (one-time)
    // ---------------------------------------------------------------------

    function initHook(address hook_, address[] calldata excludedAddrs) external {
        if (msg.sender != _factory) revert OnlyFactory();
        if (hook != address(0)) revert HookAlreadySet();
        hook = hook_;
        emit HookSet(hook_);
        _setExcluded(hook_, true);
        for (uint256 i; i < excludedAddrs.length; ++i) {
            _setExcluded(excludedAddrs[i], true);
        }
    }

    // ---------------------------------------------------------------------
    // Dividend distribution
    // ---------------------------------------------------------------------

    /// @notice Credit a distribution of reward `idx` to all eligible holders.
    ///         The hook transfers the funds here first. No-op when there is no
    ///         eligible supply (caller keeps the funds — fold them forward).
    function distributeRewards(uint8 idx, uint256 amount) external {
        if (msg.sender != hook) revert OnlyHook();
        require(idx < _rewardTokens.length, "idx");
        uint256 supply = eligibleSupply;
        if (amount == 0 || supply == 0) return;
        accRewardPerShare[idx] += (amount * ACC_PRECISION) / supply;
        _totalDistributed[idx] += amount;
        emit RewardsDistributed(idx, amount);
    }

    /// @notice Claim the caller's full basket.
    function claim() external {
        _claimTo(msg.sender);
    }

    /// @notice Push a holder's accrued basket to THEIR wallet. Permissionless
    ///         (keeper-driven), non-custodial by construction.
    function claimFor(address holder) external {
        _claimTo(holder);
    }

    function claimForMany(address[] calldata holders) external {
        for (uint256 i; i < holders.length; ++i) {
            try this.claimFor(holders[i]) {} catch {}
        }
    }

    function _claimTo(address holder) private {
        _settle(holder);
        uint256 n = _rewardTokens.length;
        for (uint256 i; i < n; ++i) {
            uint256 amount = _claimable[holder][i];
            if (amount == 0) continue;
            _claimable[holder][i] = 0;
            emit RewardsClaimed(holder, uint8(i), amount);
            IERC20(_rewardTokens[i]).safeTransfer(holder, amount);
        }
    }

    // ---------------------------------------------------------------------
    // Accounting
    // ---------------------------------------------------------------------

    function _settle(address account) private {
        if (account == address(0) || excluded[account]) return;
        uint256 bal = balanceOf(account);
        uint256 n = _rewardTokens.length;
        for (uint256 i; i < n; ++i) {
            uint256 accrued = (bal * accRewardPerShare[i]) / ACC_PRECISION;
            uint256 debt = rewardDebt[account][i];
            if (accrued > debt) _claimable[account][i] += accrued - debt;
            rewardDebt[account][i] = accrued;
        }
    }

    function _resetDebt(address account) private {
        uint256 bal = balanceOf(account);
        uint256 n = _rewardTokens.length;
        for (uint256 i; i < n; ++i) {
            rewardDebt[account][i] = (bal * accRewardPerShare[i]) / ACC_PRECISION;
        }
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

    function _update(address from, address to, uint256 value) internal override {
        bool fromEligible = from != address(0) && !excluded[from];
        bool toEligible = to != address(0) && !excluded[to];

        if (fromEligible) _settle(from);
        if (toEligible) _settle(to);

        super._update(from, to, value);

        if (fromEligible && !toEligible) {
            eligibleSupply -= value;
        } else if (!fromEligible && toEligible) {
            eligibleSupply += value;
        }

        if (fromEligible) _resetDebt(from);
        if (toEligible) _resetDebt(to);
    }
}
