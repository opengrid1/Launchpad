// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title RewardToken
/// @notice An ERC20 whose holders passively earn TWO reward streams just by holding —
///         no staking, no deposits, no LP NFT to lock up:
///           1. an external ERC20 reward token (set once at construction), and
///           2. native HYPE (the HyperEVM gas coin).
///
///         Rewards are distributed pull-based via a `magnifiedRewardPerShare` accumulator
///         (the same constant-gas math MasterChef uses) so there is never a loop over holders.
///         Funding is "top-up" style: a treasury (or anyone) pushes rewards in with
///         `distributeTokenRewards` / `distributeHypeRewards`, which sidesteps the
///         fee-on-transfer problems that fee-on-swap tokens hit on V3-style routers.
///
///         Addresses that should not earn (the DEX pair, this contract, a treasury) can be
///         excluded by the owner so they don't dilute real holders.
contract RewardToken {
    // --------------------------------------------------------------------- //
    //                              ERC20 state                              //
    // --------------------------------------------------------------------- //
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // --------------------------------------------------------------------- //
    //                          Reward accounting                            //
    // --------------------------------------------------------------------- //

    /// @dev Fixed-point scalar for the per-share accumulators. 2**128 leaves plenty of
    ///      headroom for `magPerShare * shares` to stay within 256 bits in practice.
    uint256 internal constant MAGNITUDE = 2 ** 128;

    /// @notice The external ERC20 paid out to holders (stream #1). Immutable for safety.
    IERC20 public immutable rewardToken;

    /// @notice Reward-eligible balance per account (0 for excluded accounts) and their sum.
    mapping(address => uint256) public shares;
    uint256 public totalShares;

    /// @notice Accounts that do not earn rewards (DEX pair, this contract, treasury, ...).
    mapping(address => bool) public excludedFromRewards;

    // Stream #1: external reward token.
    uint256 internal magnifiedTokenPerShare;
    mapping(address => int256) internal tokenCorrections;
    mapping(address => uint256) public withdrawnToken;

    // Stream #2: native HYPE.
    uint256 internal magnifiedHypePerShare;
    mapping(address => int256) internal hypeCorrections;
    mapping(address => uint256) public withdrawnHype;

    /// @notice HYPE received while there were no eligible holders, held until the next
    ///         distribution so deposits can never revert/brick.
    uint256 public undistributedHype;

    address public owner;

    event RewardsDistributed(address indexed asset, uint256 amount); // asset == address(0) for HYPE
    event RewardsClaimed(address indexed account, uint256 tokenAmount, uint256 hypeAmount);
    event ExcludedSet(address indexed account, bool excluded);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @param name_       Token name.
    /// @param symbol_     Token symbol.
    /// @param supply_     Fixed total supply, minted to `recipient`.
    /// @param recipient   Receives the full supply at deploy.
    /// @param rewardToken_ External ERC20 distributed to holders (stream #1).
    /// @param owner_      Can manage reward exclusions.
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply_,
        address recipient,
        address rewardToken_,
        address owner_
    ) {
        require(rewardToken_ != address(0), "reward token zero");
        require(recipient != address(0), "recipient zero");
        name = name_;
        symbol = symbol_;
        rewardToken = IERC20(rewardToken_);
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);

        // This contract custodies reward funds; it must never earn rewards itself.
        excludedFromRewards[address(this)] = true;
        emit ExcludedSet(address(this), true);

        _mint(recipient, supply_);
    }

    // --------------------------------------------------------------------- //
    //                               ERC20                                   //
    // --------------------------------------------------------------------- //

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
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        _syncShares(from);
        _syncShares(to);
        emit Transfer(from, to, value);
        return true;
    }

    function _mint(address to, uint256 value) internal {
        require(to != address(0), "ERC20: mint to zero");
        totalSupply += value;
        unchecked {
            balanceOf[to] += value;
        }
        _syncShares(to);
        emit Transfer(address(0), to, value);
    }

    // --------------------------------------------------------------------- //
    //                          Share bookkeeping                            //
    // --------------------------------------------------------------------- //

    /// @dev Re-point an account's reward shares to its current eligible balance, carrying the
    ///      per-share corrections for BOTH streams so already-accrued rewards are preserved.
    function _syncShares(address account) internal {
        uint256 target = excludedFromRewards[account] ? 0 : balanceOf[account];
        uint256 current = shares[account];
        if (target == current) return;

        int256 delta = int256(target) - int256(current);
        shares[account] = target;
        totalShares = uint256(int256(totalShares) + delta);

        // Standard magnified-dividend correction: new shares must not retroactively
        // earn past distributions, removed shares must not forfeit accrued rewards.
        tokenCorrections[account] -= int256(magnifiedTokenPerShare) * delta;
        hypeCorrections[account] -= int256(magnifiedHypePerShare) * delta;
    }

    // --------------------------------------------------------------------- //
    //                            Distribution                               //
    // --------------------------------------------------------------------- //

    /// @notice Push `amount` of the external reward token to all eligible holders, pro-rata.
    ///         Caller must have approved this contract for `amount`.
    function distributeTokenRewards(uint256 amount) external {
        require(totalShares > 0, "no eligible holders");
        require(amount > 0, "zero amount");
        require(rewardToken.transferFrom(msg.sender, address(this), amount), "transfer failed");
        magnifiedTokenPerShare += (amount * MAGNITUDE) / totalShares;
        emit RewardsDistributed(address(rewardToken), amount);
    }

    /// @notice Push native HYPE to all eligible holders, pro-rata. Send value with the call.
    function distributeHypeRewards() public payable {
        _distributeHype(msg.value);
    }

    /// @notice Plain HYPE transfers are treated as a reward distribution.
    receive() external payable {
        _distributeHype(msg.value);
    }

    function _distributeHype(uint256 incoming) internal {
        uint256 amount = incoming + undistributedHype;
        if (amount == 0) return;
        if (totalShares == 0) {
            // Hold until there are eligible holders so a transfer can never revert.
            undistributedHype = amount;
            return;
        }
        undistributedHype = 0;
        magnifiedHypePerShare += (amount * MAGNITUDE) / totalShares;
        emit RewardsDistributed(address(0), amount);
    }

    // --------------------------------------------------------------------- //
    //                               Claiming                                //
    // --------------------------------------------------------------------- //

    /// @notice Total reward-token ever allocated to `account` (claimed + unclaimed).
    function accumulativeTokenOf(address account) public view returns (uint256) {
        return uint256(int256(magnifiedTokenPerShare * shares[account]) + tokenCorrections[account]) / MAGNITUDE;
    }

    /// @notice Total HYPE ever allocated to `account` (claimed + unclaimed).
    function accumulativeHypeOf(address account) public view returns (uint256) {
        return uint256(int256(magnifiedHypePerShare * shares[account]) + hypeCorrections[account]) / MAGNITUDE;
    }

    /// @notice Reward token currently claimable by `account`.
    function withdrawableTokenOf(address account) public view returns (uint256) {
        return accumulativeTokenOf(account) - withdrawnToken[account];
    }

    /// @notice HYPE currently claimable by `account`.
    function withdrawableHypeOf(address account) public view returns (uint256) {
        return accumulativeHypeOf(account) - withdrawnHype[account];
    }

    /// @notice Claim both reward streams for the caller in one transaction.
    function claim() external returns (uint256 tokenAmount, uint256 hypeAmount) {
        tokenAmount = withdrawableTokenOf(msg.sender);
        if (tokenAmount > 0) {
            withdrawnToken[msg.sender] += tokenAmount;
            require(rewardToken.transfer(msg.sender, tokenAmount), "token payout failed");
        }

        hypeAmount = withdrawableHypeOf(msg.sender);
        if (hypeAmount > 0) {
            withdrawnHype[msg.sender] += hypeAmount;
            (bool ok,) = msg.sender.call{value: hypeAmount}("");
            require(ok, "hype payout failed");
        }

        emit RewardsClaimed(msg.sender, tokenAmount, hypeAmount);
    }

    // --------------------------------------------------------------------- //
    //                                Admin                                  //
    // --------------------------------------------------------------------- //

    /// @notice Include/exclude an address from earning rewards. Excluding zeroes its shares
    ///         (forfeiting future accrual); re-including re-points shares to its balance.
    function setExcludedFromRewards(address account, bool excluded) external onlyOwner {
        require(excludedFromRewards[account] != excluded, "unchanged");
        excludedFromRewards[account] = excluded;
        emit ExcludedSet(account, excluded);
        _syncShares(account);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}
