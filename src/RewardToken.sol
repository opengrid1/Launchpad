// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal interface for the ERC20 used as a reward stream.
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title RewardToken
/// @notice A fixed-supply ERC20 that distributes two reward streams — an ERC20
///         reward token and native HYPE — to its holders, pro-rata to balance,
///         using O(1) "magnified reward-per-share + corrections" accounting
///         (no per-holder loops). Rewards are funded by explicit top-ups, not a
///         transfer tax, so the token trades cleanly on a Hyperswap V3 pool.
///
///         Key properties:
///         - One accumulator per stream tracks total reward ever paid per share.
///           A top-up adds `amount / eligibleSupply` to it.
///         - A holder's owed amount = `balance * accPerShare - corrections`,
///           withdrawn via `claim()`. Corrections are snapshotted on every
///           balance change, so rewards are never retroactive: a new buyer
///           cannot claim top-ups that happened before they held, and what you
///           earned stays yours after you sell.
///         - Excluded addresses (e.g. the V3 pool and the treasury) are removed
///           from the denominator: they neither earn nor dilute other holders.
contract RewardToken {
    // --- ERC20 ---
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // --- Rewards ---
    /// @dev Fixed-point scaling factor for per-share accounting (Roger Wu's 2**128).
    uint256 internal constant MAGNITUDE = 2 ** 128;

    /// @notice The ERC20 distributed as the "token" reward stream.
    IERC20 public immutable rewardToken;

    /// @notice Sum of balances of all non-excluded accounts (the reward denominator).
    uint256 public eligibleSupply;

    /// @notice Whether an account is excluded from rewards (no earn, no dilute).
    mapping(address => bool) public isExcluded;

    struct Stream {
        uint256 magnifiedPerShare; // total reward ever distributed, scaled by MAGNITUDE / share
        mapping(address => int256) corrections; // per-account snapshot offset
        mapping(address => uint256) withdrawn; // per-account already-claimed amount
    }

    Stream private _tokenStream; // reward-token stream
    Stream private _hypeStream; // native HYPE stream

    event RewardTokenDeposited(address indexed from, uint256 amount);
    event HypeDeposited(address indexed from, uint256 amount);
    event Claimed(address indexed account, uint256 tokenAmount, uint256 hypeAmount);
    event ExclusionSet(address indexed account, bool excluded);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // --- Access / reentrancy ---
    address public owner;
    uint256 private _locked = 1;

    modifier nonReentrant() {
        require(_locked == 1, "reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @param name_     Token name.
    /// @param symbol_   Token symbol.
    /// @param supply_   Total fixed supply (in wei, 18 decimals).
    /// @param recipient Address that receives the entire supply at deploy.
    /// @param rewardToken_ ERC20 used as the token reward stream.
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply_,
        address recipient,
        address rewardToken_
    ) {
        require(recipient != address(0), "zero recipient");
        require(rewardToken_ != address(0), "zero reward token");
        require(supply_ > 0, "zero supply");

        name = name_;
        symbol = symbol_;
        totalSupply = supply_;
        rewardToken = IERC20(rewardToken_);
        owner = msg.sender;

        // Mint full supply to recipient. The recipient is eligible by default,
        // so it counts toward the denominator from the start.
        balanceOf[recipient] = supply_;
        eligibleSupply = supply_;
        emit Transfer(address(0), recipient, supply_);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ----------------------------------------------------------------------
    // ERC20
    // ----------------------------------------------------------------------

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "ERC20: insufficient allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "ERC20: transfer to zero");
        uint256 bal = balanceOf[from];
        require(bal >= value, "ERC20: insufficient balance");
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        // Keep reward accounting consistent for whichever side(s) are eligible.
        _moveShares(from, to, value);
        emit Transfer(from, to, value);
    }

    // ----------------------------------------------------------------------
    // Reward accounting
    // ----------------------------------------------------------------------

    /// @dev Adjusts corrections and eligibleSupply when `value` shares move from
    ///      `from` to `to`. `from == address(0)` is a mint, `to == address(0)` a
    ///      burn. Excluded accounts (and the zero address) are skipped on their
    ///      side, so `eligibleSupply` stays equal to the sum of eligible balances
    ///      and a holder's earned amount is invariant across pure transfers.
    function _moveShares(address from, address to, uint256 value) internal {
        if (value == 0) return;
        int256 signedValue = int256(value);

        if (from != address(0) && !isExcluded[from]) {
            eligibleSupply -= value;
            _tokenStream.corrections[from] += int256(_tokenStream.magnifiedPerShare) * signedValue;
            _hypeStream.corrections[from] += int256(_hypeStream.magnifiedPerShare) * signedValue;
        }
        if (to != address(0) && !isExcluded[to]) {
            eligibleSupply += value;
            _tokenStream.corrections[to] -= int256(_tokenStream.magnifiedPerShare) * signedValue;
            _hypeStream.corrections[to] -= int256(_hypeStream.magnifiedPerShare) * signedValue;
        }
    }

    function _distribute(Stream storage s, uint256 amount) internal {
        require(eligibleSupply > 0, "no eligible holders");
        require(amount > 0, "zero amount");
        // Truncation dust stays in the contract and is folded into the next top-up.
        s.magnifiedPerShare += (amount * MAGNITUDE) / eligibleSupply;
    }

    /// @notice Deposit `amount` of the reward token to be split among holders.
    /// @dev Uses the measured balance delta to support fee-on-transfer reward
    ///      tokens. Reverts if there are no eligible holders.
    function depositRewardToken(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        uint256 before = rewardToken.balanceOf(address(this));
        require(rewardToken.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        uint256 received = rewardToken.balanceOf(address(this)) - before;
        _distribute(_tokenStream, received);
        emit RewardTokenDeposited(msg.sender, received);
    }

    /// @notice Deposit native HYPE to be split among holders.
    function depositHype() external payable {
        _distribute(_hypeStream, msg.value);
        emit HypeDeposited(msg.sender, msg.value);
    }

    /// @dev Plain transfers of HYPE are treated as a top-up.
    receive() external payable {
        _distribute(_hypeStream, msg.value);
        emit HypeDeposited(msg.sender, msg.value);
    }

    // ----------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------

    function _accumulative(Stream storage s, address account) internal view returns (uint256) {
        // For eligible accounts this is >= 0 by construction; excluded accounts
        // don't earn, so callers gate on isExcluded before using this.
        int256 raw = int256(s.magnifiedPerShare * balanceOf[account]) + s.corrections[account];
        if (raw < 0) return 0;
        return uint256(raw) / MAGNITUDE;
    }

    /// @notice Reward-token amount currently claimable by `account`.
    function withdrawableRewardToken(address account) public view returns (uint256) {
        if (isExcluded[account]) return 0;
        return _accumulative(_tokenStream, account) - _tokenStream.withdrawn[account];
    }

    /// @notice HYPE amount currently claimable by `account`.
    function withdrawableHype(address account) public view returns (uint256) {
        if (isExcluded[account]) return 0;
        return _accumulative(_hypeStream, account) - _hypeStream.withdrawn[account];
    }

    // ----------------------------------------------------------------------
    // Claiming
    // ----------------------------------------------------------------------

    /// @notice Claim both reward streams to the caller.
    function claim() external nonReentrant {
        (uint256 tokenAmt, uint256 hypeAmt) = _claim(msg.sender, msg.sender);
        require(tokenAmt > 0 || hypeAmt > 0, "nothing to claim");
    }

    /// @dev Settles both streams for `account`, paying out to `to`. Effects
    ///      (withdrawn bookkeeping) precede interactions. Returns amounts paid.
    function _claim(address account, address to) internal returns (uint256 tokenAmt, uint256 hypeAmt) {
        if (!isExcluded[account]) {
            tokenAmt = _accumulative(_tokenStream, account) - _tokenStream.withdrawn[account];
            hypeAmt = _accumulative(_hypeStream, account) - _hypeStream.withdrawn[account];
        }

        if (tokenAmt > 0) {
            _tokenStream.withdrawn[account] += tokenAmt;
            require(rewardToken.transfer(to, tokenAmt), "reward transfer failed");
        }
        if (hypeAmt > 0) {
            _hypeStream.withdrawn[account] += hypeAmt;
            (bool ok,) = payable(to).call{value: hypeAmt}("");
            require(ok, "HYPE transfer failed");
        }
        if (tokenAmt > 0 || hypeAmt > 0) {
            emit Claimed(account, tokenAmt, hypeAmt);
        }
    }

    // ----------------------------------------------------------------------
    // Owner: exclusion management
    // ----------------------------------------------------------------------

    /// @notice Exclude an account (e.g. the V3 pool or treasury) from rewards.
    /// @dev Auto-claims any pending rewards to the account first so nothing is
    ///      stranded, then removes its balance from the denominator and freezes
    ///      its accounting (future top-ups won't accrue to it).
    function excludeFromRewards(address account) external onlyOwner nonReentrant {
        require(!isExcluded[account], "already excluded");
        require(account != address(0), "zero address");

        _claim(account, account);

        isExcluded[account] = true;
        uint256 bal = balanceOf[account];
        if (bal > 0) {
            eligibleSupply -= bal;
        }
        _freeze(account);
        emit ExclusionSet(account, true);
    }

    /// @notice Re-include a previously excluded account in rewards.
    /// @dev Resets its baseline so it only earns from future top-ups (no
    ///      retroactive claim on top-ups that happened while it was excluded).
    function includeInRewards(address account) external onlyOwner {
        require(isExcluded[account], "not excluded");

        isExcluded[account] = false;
        uint256 bal = balanceOf[account];
        if (bal > 0) {
            eligibleSupply += bal;
        }
        _freeze(account);
        emit ExclusionSet(account, false);
    }

    /// @dev Sets corrections so the account's current withdrawable is exactly 0
    ///      (earned == withdrawn) given its present balance and the live
    ///      accumulators. Used at exclusion (after auto-claim) and inclusion to
    ///      pin the baseline to "now".
    function _freeze(address account) internal {
        uint256 bal = balanceOf[account];
        _tokenStream.corrections[account] =
            int256(_tokenStream.withdrawn[account] * MAGNITUDE) - int256(_tokenStream.magnifiedPerShare * bal);
        _hypeStream.corrections[account] =
            int256(_hypeStream.withdrawn[account] * MAGNITUDE) - int256(_hypeStream.magnifiedPerShare * bal);
    }

    // ----------------------------------------------------------------------
    // Owner: admin
    // ----------------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Renounce ownership, permanently locking the exclusion list.
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }
}
