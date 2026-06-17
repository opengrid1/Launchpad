// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal interface for the ERC20 used as a reward stream.
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title RewardToken
/// @notice A fixed-supply ERC20 with a buy/sell tax that pays holders a dividend,
///         using O(1) "magnified reward-per-share + corrections" accounting (no
///         per-holder loops).
///
///         Three reward streams, all claimed together:
///         - GRID:        funded by the buy/sell tax (default 5%/5%), paid in
///                        this token itself.
///         - reward ERC20: funded by manual `depositRewardToken` top-ups.
///         - native HYPE:  funded by manual `depositHype` top-ups.
///
///         Accounting properties:
///         - Each top-up/tax adds `amount / eligibleSupply` to that stream's
///           accumulator. A holder's owed amount = `balance * accPerShare -
///           corrections`, claimed via `claim()`.
///         - Corrections snapshot on every balance change, so rewards are never
///           retroactive (a new buyer can't claim past distributions) and what
///           you earned stays yours after you sell.
///         - Excluded addresses (the AMM pool, treasury) are removed from the
///           denominator: they neither earn nor dilute other holders.
///
///         NOTE: the buy/sell tax makes this a fee-on-transfer token. Pair it on
///         a UniswapV2-style DEX (Hyperswap V2 / KittenSwap), which supports
///         fee-on-transfer via its `...SupportingFeeOnTransferTokens` swap calls.
///         Uniswap/Hyperswap V3 does NOT support fee-on-transfer tokens.
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

    uint256 internal constant S_TOKEN = 0; // reward ERC20 (top-ups)
    uint256 internal constant S_HYPE = 1; // native HYPE (top-ups)
    uint256 internal constant S_GRID = 2; // this token (buy/sell tax)
    uint256 internal constant N_STREAMS = 3;

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

    Stream[N_STREAMS] private _streams;

    /// @dev Tax collected while eligibleSupply was 0; folded into the next distribution.
    uint256 internal _gridBacklog;

    // --- Tax ---
    uint16 public constant MAX_TAX_BPS = 500; // 5% hard cap (owner can only lower)
    uint16 public buyTaxBps = 500;
    uint16 public sellTaxBps = 500;

    /// @notice AMM pools — a transfer from one is a buy, to one is a sell.
    mapping(address => bool) public isAMM;
    /// @notice Accounts not subject to the buy/sell tax (owner, treasury, this contract...).
    mapping(address => bool) public isTaxExempt;

    event RewardTokenDeposited(address indexed from, uint256 amount);
    event HypeDeposited(address indexed from, uint256 amount);
    event TaxCollected(address indexed from, address indexed to, uint256 amount);
    event Claimed(address indexed account, uint256 tokenAmount, uint256 hypeAmount, uint256 gridAmount);
    event ExclusionSet(address indexed account, bool excluded);
    event AMMSet(address indexed pair, bool isAMM);
    event TaxExemptSet(address indexed account, bool exempt);
    event TaxesSet(uint16 buyTaxBps, uint16 sellTaxBps);
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

    /// @param name_        Token name.
    /// @param symbol_      Token symbol.
    /// @param supply_      Total fixed supply (in wei, 18 decimals).
    /// @param recipient    Address that receives the entire supply at deploy.
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

        // The contract never earns its own tax dividends.
        isExcluded[address(this)] = true;
        // Sensible default tax exemptions; the pool is intentionally NOT exempt.
        isTaxExempt[address(this)] = true;
        isTaxExempt[msg.sender] = true;
        isTaxExempt[recipient] = true;

        // Mint full supply to recipient (eligible by default, counts toward denominator).
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

        uint256 tax = _taxFor(from, to, value);
        uint256 sendAmt = value - tax;

        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += sendAmt;
        }
        // Shares actually delivered to `to`; `from` is debited the full value below.
        _moveShares(from, to, sendAmt);

        if (tax > 0) {
            unchecked {
                balanceOf[address(this)] += tax;
            }
            // Debit the taxed portion from `from`; the contract is excluded so no credit.
            _moveShares(from, address(this), tax);
            _accrueTax(tax);
            emit Transfer(from, address(this), tax);
            emit TaxCollected(from, to, tax);
        }
        emit Transfer(from, to, sendAmt);
    }

    /// @dev Returns the tax owed on a transfer of `value` from `from` to `to`.
    function _taxFor(address from, address to, uint256 value) internal view returns (uint256) {
        if (isTaxExempt[from] || isTaxExempt[to]) return 0;
        if (isAMM[from]) return (value * buyTaxBps) / 10_000; // buy
        if (isAMM[to]) return (value * sellTaxBps) / 10_000; // sell
        return 0;
    }

    // ----------------------------------------------------------------------
    // Reward accounting
    // ----------------------------------------------------------------------

    /// @dev Adjusts corrections (all streams) and eligibleSupply when `value`
    ///      shares move from `from` to `to`. Excluded accounts (and the zero
    ///      address) are skipped on their side, so `eligibleSupply` stays equal
    ///      to the sum of eligible balances and a holder's earned amount is
    ///      invariant across pure transfers.
    function _moveShares(address from, address to, uint256 value) internal {
        if (value == 0) return;
        int256 signedValue = int256(value);

        if (from != address(0) && !isExcluded[from]) {
            eligibleSupply -= value;
            for (uint256 i = 0; i < N_STREAMS; ++i) {
                _streams[i].corrections[from] += int256(_streams[i].magnifiedPerShare) * signedValue;
            }
        }
        if (to != address(0) && !isExcluded[to]) {
            eligibleSupply += value;
            for (uint256 i = 0; i < N_STREAMS; ++i) {
                _streams[i].corrections[to] -= int256(_streams[i].magnifiedPerShare) * signedValue;
            }
        }
    }

    function _distribute(uint256 streamId, uint256 amount) internal {
        require(eligibleSupply > 0, "no eligible holders");
        require(amount > 0, "zero amount");
        // Truncation dust stays in the contract and folds into the next top-up.
        _streams[streamId].magnifiedPerShare += (amount * MAGNITUDE) / eligibleSupply;
    }

    /// @dev Distributes collected tax into the GRID stream. Never reverts: if
    ///      there are momentarily no eligible holders, the tax is held back and
    ///      folded into the next distribution.
    function _accrueTax(uint256 amount) internal {
        uint256 total = _gridBacklog + amount;
        if (eligibleSupply > 0 && total > 0) {
            _streams[S_GRID].magnifiedPerShare += (total * MAGNITUDE) / eligibleSupply;
            _gridBacklog = 0;
        } else {
            _gridBacklog = total;
        }
    }

    /// @notice Deposit `amount` of the reward token to be split among holders.
    /// @dev Uses the measured balance delta to support fee-on-transfer reward tokens.
    function depositRewardToken(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        uint256 before = rewardToken.balanceOf(address(this));
        require(rewardToken.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        uint256 received = rewardToken.balanceOf(address(this)) - before;
        _distribute(S_TOKEN, received);
        emit RewardTokenDeposited(msg.sender, received);
    }

    /// @notice Deposit native HYPE to be split among holders.
    function depositHype() external payable {
        _distribute(S_HYPE, msg.value);
        emit HypeDeposited(msg.sender, msg.value);
    }

    /// @dev Plain transfers of HYPE are treated as a top-up.
    receive() external payable {
        _distribute(S_HYPE, msg.value);
        emit HypeDeposited(msg.sender, msg.value);
    }

    // ----------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------

    function _accumulative(uint256 streamId, address account) internal view returns (uint256) {
        Stream storage s = _streams[streamId];
        int256 raw = int256(s.magnifiedPerShare * balanceOf[account]) + s.corrections[account];
        if (raw < 0) return 0;
        return uint256(raw) / MAGNITUDE;
    }

    function _withdrawable(uint256 streamId, address account) internal view returns (uint256) {
        if (isExcluded[account]) return 0;
        return _accumulative(streamId, account) - _streams[streamId].withdrawn[account];
    }

    /// @notice Reward-token amount currently claimable by `account`.
    function withdrawableRewardToken(address account) external view returns (uint256) {
        return _withdrawable(S_TOKEN, account);
    }

    /// @notice HYPE amount currently claimable by `account`.
    function withdrawableHype(address account) external view returns (uint256) {
        return _withdrawable(S_HYPE, account);
    }

    /// @notice GRID (tax dividend) amount currently claimable by `account`.
    function withdrawableGrid(address account) external view returns (uint256) {
        return _withdrawable(S_GRID, account);
    }

    // ----------------------------------------------------------------------
    // Claiming
    // ----------------------------------------------------------------------

    /// @notice Claim all three reward streams to the caller.
    function claim() external nonReentrant {
        (uint256 t, uint256 h, uint256 g) = _claim(msg.sender, msg.sender);
        require(t > 0 || h > 0 || g > 0, "nothing to claim");
    }

    /// @dev Settles all streams for `account`, paying out to `to`. Effects
    ///      (withdrawn bookkeeping) precede interactions.
    function _claim(address account, address to)
        internal
        returns (uint256 tokenAmt, uint256 hypeAmt, uint256 gridAmt)
    {
        if (!isExcluded[account]) {
            tokenAmt = _accumulative(S_TOKEN, account) - _streams[S_TOKEN].withdrawn[account];
            hypeAmt = _accumulative(S_HYPE, account) - _streams[S_HYPE].withdrawn[account];
            gridAmt = _accumulative(S_GRID, account) - _streams[S_GRID].withdrawn[account];
        }

        if (tokenAmt > 0) {
            _streams[S_TOKEN].withdrawn[account] += tokenAmt;
            require(rewardToken.transfer(to, tokenAmt), "reward transfer failed");
        }
        if (hypeAmt > 0) {
            _streams[S_HYPE].withdrawn[account] += hypeAmt;
            (bool ok,) = payable(to).call{value: hypeAmt}("");
            require(ok, "HYPE transfer failed");
        }
        if (gridAmt > 0) {
            _streams[S_GRID].withdrawn[account] += gridAmt;
            // Pay the GRID dividend out of the contract's tax holdings. `from` is
            // tax-exempt, so this internal transfer is itself untaxed.
            _transfer(address(this), to, gridAmt);
        }
        if (tokenAmt > 0 || hypeAmt > 0 || gridAmt > 0) {
            emit Claimed(account, tokenAmt, hypeAmt, gridAmt);
        }
    }

    // ----------------------------------------------------------------------
    // Owner: tax configuration
    // ----------------------------------------------------------------------

    /// @notice Mark/unmark an AMM pool (so trades through it are taxed).
    function setAMM(address pair, bool enabled) external onlyOwner {
        require(pair != address(0), "zero address");
        isAMM[pair] = enabled;
        emit AMMSet(pair, enabled);
    }

    /// @notice Exempt/unexempt an account from the buy/sell tax.
    function setTaxExempt(address account, bool exempt) external onlyOwner {
        isTaxExempt[account] = exempt;
        emit TaxExemptSet(account, exempt);
    }

    /// @notice Update tax rates. Each is capped at MAX_TAX_BPS (5%); owner can
    ///         only set within [0, 5%], so the token can never become a honeypot.
    function setTaxes(uint16 buyTaxBps_, uint16 sellTaxBps_) external onlyOwner {
        require(buyTaxBps_ <= MAX_TAX_BPS && sellTaxBps_ <= MAX_TAX_BPS, "tax > 5%");
        buyTaxBps = buyTaxBps_;
        sellTaxBps = sellTaxBps_;
        emit TaxesSet(buyTaxBps_, sellTaxBps_);
    }

    // ----------------------------------------------------------------------
    // Owner: exclusion management
    // ----------------------------------------------------------------------

    /// @notice Exclude an account (e.g. the AMM pool or treasury) from rewards.
    /// @dev Auto-claims any pending rewards to the account first so nothing is
    ///      stranded, then removes its balance from the denominator and freezes
    ///      its accounting.
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
    /// @dev Resets its baseline so it only earns from future distributions.
    function includeInRewards(address account) external onlyOwner {
        require(isExcluded[account], "not excluded");
        require(account != address(this), "contract stays excluded");

        isExcluded[account] = false;
        uint256 bal = balanceOf[account];
        if (bal > 0) {
            eligibleSupply += bal;
        }
        _freeze(account);
        emit ExclusionSet(account, false);
    }

    /// @dev Pins every stream's withdrawable for `account` to exactly 0 given its
    ///      current balance and accumulators. Used at exclusion (after auto-claim)
    ///      and inclusion to anchor the baseline to "now".
    function _freeze(address account) internal {
        uint256 bal = balanceOf[account];
        for (uint256 i = 0; i < N_STREAMS; ++i) {
            _streams[i].corrections[account] =
                int256(_streams[i].withdrawn[account] * MAGNITUDE) - int256(_streams[i].magnifiedPerShare * bal);
        }
    }

    // ----------------------------------------------------------------------
    // Owner: admin
    // ----------------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Renounce ownership, permanently locking tax/exclusion config.
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }
}
