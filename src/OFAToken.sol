// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title OFAToken
/// @notice ERC20 with a built-in ETH reward distributor ("hold to earn", no staking).
///         Any ETH sent to the contract (via `distributeRewards` or a plain transfer) is
///         split pro-rata across all *eligible* holders. Holders claim their ETH whenever
///         they want — accrual is automatic just by holding.
///
///         Accounting is the MasterChef reward-debt pattern: O(1) per distribution, no
///         iteration over holders. Excluded addresses (the bonding curve, LP pools,
///         bridges, CEX wallets, treasury) never accrue, so rewards reach real holders.
///
/// @dev    Works in every phase: during the bonding curve (the curve forwards a reward
///         fee here) and after graduation (the OFA pool / anyone forwards surplus here).
contract OFAToken {
    // ----------------------------- ERC20 -----------------------------
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // -------------------------- rewards ------------------------------
    uint256 private constant PRECISION = 1e18;

    /// @notice Cumulative ETH-per-eligible-token, scaled by PRECISION.
    uint256 public magnifiedRewardPerShare;
    /// @notice Sum of balances that currently accrue rewards (totalSupply minus excluded).
    uint256 public eligibleSupply;
    /// @notice Total ETH ever distributed to holders.
    uint256 public totalRewardsDistributed;

    mapping(address => uint256) private rewardDebt; // balance * magPerShare / PRECISION at last touch
    mapping(address => uint256) private pendingReward; // banked, unclaimed ETH
    mapping(address => uint256) public withdrawnRewards; // lifetime claimed, per account
    mapping(address => bool) public excludedFromRewards;

    // --------------------------- admin -------------------------------
    address public owner;

    uint256 private _lock = 1;

    event RewardsDistributed(address indexed from, uint256 amount);
    event RewardClaimed(address indexed account, uint256 amount);
    event ExcludedFromRewards(address indexed account, bool excluded);
    event OwnershipTransferred(address indexed from, address indexed to);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(string memory name_, string memory symbol_, uint256 supply_, address recipient, address owner_) {
        require(recipient != address(0) && owner_ != address(0), "zero address");
        name = name_;
        symbol = symbol_;
        owner = owner_;
        totalSupply = supply_;
        balanceOf[recipient] = supply_;
        eligibleSupply = supply_; // recipient is eligible until excluded
        emit Transfer(address(0), recipient, supply_);
        emit OwnershipTransferred(address(0), owner_);
    }

    // ----------------------------- ERC20 -----------------------------

    function transfer(address to, uint256 value) external returns (bool) {
        return _transfer(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "ERC20: insufficient allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        return _transfer(from, to, value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal returns (bool) {
        require(to != address(0), "ERC20: transfer to zero");
        uint256 bal = balanceOf[from];
        require(bal >= value, "ERC20: insufficient balance");

        // bank rewards accrued at the *old* balances first
        _accrue(from);
        _accrue(to);

        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }

        // keep eligibleSupply in sync: only included balances count
        bool fromEx = excludedFromRewards[from];
        bool toEx = excludedFromRewards[to];
        if (fromEx != toEx) {
            if (fromEx) {
                // tokens moved from excluded -> included: now eligible
                eligibleSupply += value;
            } else {
                // included -> excluded: no longer eligible
                eligibleSupply -= value;
            }
        }

        // reset reward debt against new balances
        _resetDebt(from);
        _resetDebt(to);

        emit Transfer(from, to, value);
        return true;
    }

    // --------------------------- rewards -----------------------------

    /// @notice Distribute the attached ETH to all eligible holders.
    function distributeRewards() public payable {
        require(msg.value > 0, "no eth");
        require(eligibleSupply > 0, "no eligible supply");
        magnifiedRewardPerShare += (msg.value * PRECISION) / eligibleSupply;
        totalRewardsDistributed += msg.value;
        emit RewardsDistributed(msg.sender, msg.value);
    }

    /// @notice Plain ETH transfers are treated as a reward distribution.
    receive() external payable {
        distributeRewards();
    }

    /// @notice Claim all ETH rewards owed to the caller.
    function claim() external nonReentrant returns (uint256 amount) {
        _accrue(msg.sender);
        amount = pendingReward[msg.sender];
        require(amount > 0, "nothing to claim");
        pendingReward[msg.sender] = 0;
        withdrawnRewards[msg.sender] += amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "eth transfer failed");
        emit RewardClaimed(msg.sender, amount);
    }

    /// @notice ETH currently claimable by `account`.
    function withdrawableRewardOf(address account) public view returns (uint256) {
        if (excludedFromRewards[account]) return pendingReward[account];
        uint256 acc = (balanceOf[account] * magnifiedRewardPerShare) / PRECISION;
        return pendingReward[account] + (acc - rewardDebt[account]);
    }

    function _accrue(address a) internal {
        if (excludedFromRewards[a]) return;
        uint256 acc = (balanceOf[a] * magnifiedRewardPerShare) / PRECISION;
        pendingReward[a] += acc - rewardDebt[a];
        rewardDebt[a] = acc;
    }

    function _resetDebt(address a) internal {
        if (excludedFromRewards[a]) {
            rewardDebt[a] = 0;
        } else {
            rewardDebt[a] = (balanceOf[a] * magnifiedRewardPerShare) / PRECISION;
        }
    }

    // ---------------------------- admin ------------------------------

    /// @notice Exclude/include an address from reward accrual (curve, pools, CEX, treasury).
    function setExcludedFromRewards(address account, bool excluded) external onlyOwner {
        require(excludedFromRewards[account] != excluded, "unchanged");
        _accrue(account); // bank what it earned while its current status held
        excludedFromRewards[account] = excluded;
        uint256 bal = balanceOf[account];
        if (excluded) {
            eligibleSupply -= bal;
            rewardDebt[account] = 0;
        } else {
            eligibleSupply += bal;
            rewardDebt[account] = (bal * magnifiedRewardPerShare) / PRECISION;
        }
        emit ExcludedFromRewards(account, excluded);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
