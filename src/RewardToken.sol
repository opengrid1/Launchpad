// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal UniswapV2-style router surface used for the tax swap-back.
interface IUniswapV2Router02 {
    function WETH() external view returns (address);
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

/// @title RewardToken
/// @notice A fixed-supply reflections token (HALV-style) that charges a 5%/5%
///         buy/sell tax and pays it back to holders as TWO rewards, both funded
///         purely by trading volume — no manual top-ups required:
///
///           1. GRID  — the token itself (a portion of the tax is kept and
///                      distributed directly to holders).
///           2. HYPE  — the remaining portion of the tax is auto-swapped to
///                      native HYPE on a UniswapV2-style DEX and distributed.
///
///         Distribution uses O(1) "magnified reward-per-share + corrections"
///         accounting (no per-holder loops):
///         - Each distribution adds `amount / eligibleSupply` to that stream's
///           accumulator; a holder's owed amount = `balance * accPerShare -
///           corrections`, claimed via `claim()`.
///         - Corrections snapshot on every balance change, so rewards are never
///           retroactive and what you earned stays yours after you sell.
///         - Excluded addresses (the pool, treasury) are removed from the
///           denominator: they neither earn nor dilute.
///
///         FEE-ON-TRANSFER: the buy/sell tax makes this a fee-on-transfer token,
///         so it MUST be paired on a UniswapV2-style DEX (Hyperswap V2 /
///         KittenSwap). Uniswap/Hyperswap V3 rejects fee-on-transfer tokens.
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

    uint256 internal constant S_GRID = 0; // reward in the token itself
    uint256 internal constant S_HYPE = 1; // reward in native HYPE (swapped from tax)
    uint256 internal constant N_STREAMS = 2;

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
    /// @dev Per-stream amount distributed while eligibleSupply was 0; folded into the next distribution.
    uint256[N_STREAMS] private _backlog;

    // --- Tax & swap-back ---
    IUniswapV2Router02 public immutable router;
    address public immutable WHYPE;

    uint16 public constant MAX_TAX_BPS = 500; // 5% hard cap (owner can only lower)
    uint16 public buyTaxBps = 500;
    uint16 public sellTaxBps = 500;

    /// @notice Portion of collected tax (in bps) swapped to HYPE; the rest stays
    ///         as a GRID reward. Default 50% HYPE / 50% GRID.
    uint16 public hypeShareBps = 5_000;

    /// @notice Minimum GRID tax accumulated before a sell triggers a swap-back.
    uint256 public swapThreshold;

    /// @dev GRID collected from tax that hasn't been processed (split + swapped) yet.
    uint256 public pendingTax;

    bool private _inSwap;

    /// @notice AMM pools — a transfer from one is a buy, to one is a sell.
    mapping(address => bool) public isAMM;
    /// @notice Accounts not subject to the buy/sell tax (owner, treasury, this contract...).
    mapping(address => bool) public isTaxExempt;

    event TaxCollected(address indexed from, address indexed to, uint256 amount);
    event SwapBack(uint256 gridReward, uint256 gridSwapped, uint256 hypeReceived);
    event Claimed(address indexed account, uint256 gridAmount, uint256 hypeAmount);
    event HypeDeposited(address indexed from, uint256 amount);
    event ExclusionSet(address indexed account, bool excluded);
    event AMMSet(address indexed pair, bool isAMM);
    event TaxExemptSet(address indexed account, bool exempt);
    event TaxesSet(uint16 buyTaxBps, uint16 sellTaxBps);
    event RewardSplitSet(uint16 hypeShareBps);
    event SwapThresholdSet(uint256 threshold);
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

    modifier lockSwap() {
        _inSwap = true;
        _;
        _inSwap = false;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @param name_     Token name.
    /// @param symbol_   Token symbol.
    /// @param supply_   Total fixed supply (in wei, 18 decimals).
    /// @param recipient Address that receives the entire supply at deploy.
    /// @param router_   UniswapV2-style router used to swap tax → HYPE.
    constructor(string memory name_, string memory symbol_, uint256 supply_, address recipient, address router_) {
        require(recipient != address(0), "zero recipient");
        require(router_ != address(0), "zero router");
        require(supply_ > 0, "zero supply");

        name = name_;
        symbol = symbol_;
        totalSupply = supply_;
        router = IUniswapV2Router02(router_);
        WHYPE = IUniswapV2Router02(router_).WETH();
        owner = msg.sender;

        // Swap-back kicks in once accumulated tax reaches 0.05% of supply.
        swapThreshold = supply_ / 2_000;

        // The contract never earns its own rewards; it is also tax-exempt so its
        // own swap-back sells are untaxed.
        isExcluded[address(this)] = true;
        isTaxExempt[address(this)] = true;
        isTaxExempt[msg.sender] = true;
        isTaxExempt[recipient] = true;

        // Pre-approve the router to pull this token during swap-back.
        allowance[address(this)][router_] = type(uint256).max;
        emit Approval(address(this), router_, type(uint256).max);

        // Mint full supply to recipient (eligible by default).
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

        // On a sell (tokens heading into an AMM), process accumulated tax first.
        if (!_inSwap && isAMM[to] && !isTaxExempt[from] && pendingTax >= swapThreshold && swapThreshold > 0) {
            _swapBack();
        }

        uint256 tax = _inSwap ? 0 : _taxFor(from, to, value);
        uint256 sendAmt = value - tax;

        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += sendAmt;
        }
        _moveShares(from, to, sendAmt);

        if (tax > 0) {
            unchecked {
                balanceOf[address(this)] += tax;
            }
            // Debit the taxed portion from `from`; the contract is excluded so no credit.
            _moveShares(from, address(this), tax);
            pendingTax += tax;
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
    // Swap-back: split accumulated tax into a GRID reward + a HYPE reward
    // ----------------------------------------------------------------------

    function _swapBack() internal lockSwap {
        uint256 amount = pendingTax;
        if (amount == 0) return;
        pendingTax = 0;

        uint256 hypePart = (amount * hypeShareBps) / 10_000;
        uint256 gridPart = amount - hypePart;

        // GRID reward: these tokens are already held by the contract; just book
        // them into the GRID stream so holders can claim them.
        if (gridPart > 0) _accrue(S_GRID, gridPart);

        // HYPE reward: sell the rest for native HYPE and book the proceeds.
        if (hypePart > 0) {
            uint256 balBefore = address(this).balance;
            address[] memory path = new address[](2);
            path[0] = address(this);
            path[1] = WHYPE;
            // Tolerate swap failure (e.g. thin liquidity) so trading never bricks:
            // the unsold tax returns to the pending pool and is retried later.
            try router.swapExactTokensForETHSupportingFeeOnTransferTokens(hypePart, 0, path, address(this), block.timestamp)
            {
                uint256 received = address(this).balance - balBefore;
                if (received > 0) _accrue(S_HYPE, received);
                emit SwapBack(gridPart, hypePart, received);
            } catch {
                pendingTax += hypePart;
                emit SwapBack(gridPart, 0, 0);
            }
        } else {
            emit SwapBack(gridPart, 0, 0);
        }
    }

    // ----------------------------------------------------------------------
    // Reward accounting
    // ----------------------------------------------------------------------

    /// @dev Adjusts corrections (all streams) and eligibleSupply when `value`
    ///      shares move from `from` to `to`.
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

    /// @dev Distributes `amount` into a stream. Never reverts: if there are
    ///      momentarily no eligible holders, the amount is held back and folded
    ///      into the next distribution.
    function _accrue(uint256 id, uint256 amount) internal {
        uint256 total = _backlog[id] + amount;
        if (eligibleSupply > 0 && total > 0) {
            _streams[id].magnifiedPerShare += (total * MAGNITUDE) / eligibleSupply;
            _backlog[id] = 0;
        } else {
            _backlog[id] = total;
        }
    }

    /// @notice Optional: top up the HYPE reward stream directly (bonus rewards).
    function depositHype() external payable {
        _accrue(S_HYPE, msg.value);
        emit HypeDeposited(msg.sender, msg.value);
    }

    /// @dev Accept HYPE. Router refunds during swap-back are kept silent; any
    ///      other incoming HYPE is treated as a bonus top-up to the HYPE stream.
    receive() external payable {
        if (_inSwap) return;
        _accrue(S_HYPE, msg.value);
        emit HypeDeposited(msg.sender, msg.value);
    }

    // ----------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------

    function _accumulative(uint256 id, address account) internal view returns (uint256) {
        Stream storage s = _streams[id];
        int256 raw = int256(s.magnifiedPerShare * balanceOf[account]) + s.corrections[account];
        if (raw < 0) return 0;
        return uint256(raw) / MAGNITUDE;
    }

    function _withdrawable(uint256 id, address account) internal view returns (uint256) {
        if (isExcluded[account]) return 0;
        return _accumulative(id, account) - _streams[id].withdrawn[account];
    }

    /// @notice GRID (token) reward currently claimable by `account`.
    function withdrawableGrid(address account) external view returns (uint256) {
        return _withdrawable(S_GRID, account);
    }

    /// @notice HYPE reward currently claimable by `account`.
    function withdrawableHype(address account) external view returns (uint256) {
        return _withdrawable(S_HYPE, account);
    }

    // ----------------------------------------------------------------------
    // Claiming
    // ----------------------------------------------------------------------

    /// @notice Claim both rewards (GRID + HYPE) to the caller.
    function claim() external nonReentrant {
        (uint256 g, uint256 h) = _claim(msg.sender, msg.sender);
        require(g > 0 || h > 0, "nothing to claim");
    }

    function _claim(address account, address to) internal returns (uint256 gridAmt, uint256 hypeAmt) {
        if (!isExcluded[account]) {
            gridAmt = _accumulative(S_GRID, account) - _streams[S_GRID].withdrawn[account];
            hypeAmt = _accumulative(S_HYPE, account) - _streams[S_HYPE].withdrawn[account];
        }

        if (gridAmt > 0) {
            _streams[S_GRID].withdrawn[account] += gridAmt;
            // Pay the GRID reward out of the contract's holdings. `from` is
            // tax-exempt and `to` is not an AMM, so this is untaxed and triggers
            // no swap-back.
            _transfer(address(this), to, gridAmt);
        }
        if (hypeAmt > 0) {
            _streams[S_HYPE].withdrawn[account] += hypeAmt;
            (bool ok,) = payable(to).call{value: hypeAmt}("");
            require(ok, "HYPE transfer failed");
        }
        if (gridAmt > 0 || hypeAmt > 0) {
            emit Claimed(account, gridAmt, hypeAmt);
        }
    }

    // ----------------------------------------------------------------------
    // Owner: tax / swap configuration
    // ----------------------------------------------------------------------

    function setAMM(address pair, bool enabled) external onlyOwner {
        require(pair != address(0), "zero address");
        isAMM[pair] = enabled;
        emit AMMSet(pair, enabled);
    }

    function setTaxExempt(address account, bool exempt) external onlyOwner {
        isTaxExempt[account] = exempt;
        emit TaxExemptSet(account, exempt);
    }

    /// @notice Each tax is capped at 5%; owner can only set within [0, 5%], so
    ///         the token can never be turned into a higher-tax honeypot.
    function setTaxes(uint16 buyTaxBps_, uint16 sellTaxBps_) external onlyOwner {
        require(buyTaxBps_ <= MAX_TAX_BPS && sellTaxBps_ <= MAX_TAX_BPS, "tax > 5%");
        buyTaxBps = buyTaxBps_;
        sellTaxBps = sellTaxBps_;
        emit TaxesSet(buyTaxBps_, sellTaxBps_);
    }

    /// @notice Set the share of collected tax (bps) that is swapped to HYPE; the
    ///         remainder is distributed as a GRID reward.
    function setRewardSplit(uint16 hypeShareBps_) external onlyOwner {
        require(hypeShareBps_ <= 10_000, "bad split");
        hypeShareBps = hypeShareBps_;
        emit RewardSplitSet(hypeShareBps_);
    }

    function setSwapThreshold(uint256 threshold) external onlyOwner {
        swapThreshold = threshold;
        emit SwapThresholdSet(threshold);
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
    ///      current balance and accumulators.
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

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }
}
