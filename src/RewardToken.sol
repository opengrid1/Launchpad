// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal UniswapV2 pair surface (the token swaps directly against its
///         own pair, so it needs no router and can't be broken by a router with
///         a non-standard swap interface).
interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @notice Wrapped HYPE (WHYPE) surface — the pair pays out WHYPE, which the
///         token unwraps to native HYPE before distributing.
interface IWHYPE {
    function withdraw(uint256) external;
    function balanceOf(address) external view returns (uint256);
}

/// @title RewardToken
/// @notice Fixed-supply reflections token (HALV-style) with a 5%/5% buy/sell tax
///         paid back to holders as TWO rewards, funded purely by trading volume:
///
///           1. TOKEN — a portion of the tax is kept and distributed as the
///                      token itself.
///           2. HYPE  — the rest is swapped to native HYPE (directly against the
///                      token's own pair) and distributed.
///
///         Distribution uses O(1) "magnified reward-per-share + corrections"
///         accounting (no per-holder loops). Corrections snapshot on every
///         balance change, so rewards are never retroactive and what you earned
///         stays yours after you sell. Excluded addresses (the pool, treasury)
///         are removed from the denominator: they neither earn nor dilute.
///
///         FEE-ON-TRANSFER: pair this on a UniswapV2-style DEX (Hyperswap V2 /
///         KittenSwap). V3 rejects fee-on-transfer tokens.
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
    uint256 internal constant MAGNITUDE = 2 ** 128;
    uint256 internal constant S_TOKEN = 0;
    uint256 internal constant S_HYPE = 1;
    uint256 internal constant N_STREAMS = 2;

    uint256 public eligibleSupply;
    mapping(address => bool) public isExcluded;

    struct Stream {
        uint256 magnifiedPerShare;
        mapping(address => int256) corrections;
        mapping(address => uint256) withdrawn;
    }

    Stream[N_STREAMS] private _streams;
    uint256[N_STREAMS] private _backlog;

    // --- Tax & swap-back ---
    address public immutable WHYPE;

    /// @notice The pair the token swaps its tax against (TOKEN/WHYPE).
    address public pair;
    /// @dev True if this token is token0 of the pair (set in setPair).
    bool private _isToken0;

    uint16 public constant MAX_TAX_BPS = 500; // 5% cap
    uint16 public buyTaxBps = 500;
    uint16 public sellTaxBps = 500;

    /// @notice Portion of tax (bps) swapped to HYPE; the rest stays as a token reward.
    uint16 public hypeShareBps = 5_000;

    uint256 public swapThreshold;
    uint256 public pendingTax;
    bool private _inSwap;

    mapping(address => bool) public isAMM;
    mapping(address => bool) public isTaxExempt;

    event TaxCollected(address indexed from, address indexed to, uint256 amount);
    event SwapBack(uint256 tokenReward, uint256 tokenSwapped, uint256 hypeReceived);
    event Claimed(address indexed account, uint256 tokenAmount, uint256 hypeAmount);
    event HypeDeposited(address indexed from, uint256 amount);
    event ExclusionSet(address indexed account, bool excluded);
    event AMMSet(address indexed amm, bool isAMM);
    event PairSet(address indexed pair, bool tokenIsToken0);
    event TaxExemptSet(address indexed account, bool exempt);
    event TaxesSet(uint16 buyTaxBps, uint16 sellTaxBps);
    event RewardSplitSet(uint16 hypeShareBps);
    event SwapThresholdSet(uint256 threshold);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

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
    /// @param supply_   Total fixed supply (wei, 18 decimals).
    /// @param recipient Address that receives the entire supply at deploy.
    /// @param whype_    Wrapped-HYPE address (0x5555..5555 on HyperEVM).
    constructor(string memory name_, string memory symbol_, uint256 supply_, address recipient, address whype_) {
        require(recipient != address(0), "zero recipient");
        require(whype_ != address(0), "zero WHYPE");
        require(supply_ > 0, "zero supply");

        name = name_;
        symbol = symbol_;
        totalSupply = supply_;
        WHYPE = whype_;
        owner = msg.sender;

        swapThreshold = supply_ / 2_000; // 0.05% of supply

        isExcluded[address(this)] = true;
        isTaxExempt[address(this)] = true;
        isTaxExempt[msg.sender] = true;
        isTaxExempt[recipient] = true;

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
            _moveShares(from, address(this), tax);
            pendingTax += tax;
            emit Transfer(from, address(this), tax);
            emit TaxCollected(from, to, tax);
        }
        emit Transfer(from, to, sendAmt);
    }

    function _taxFor(address from, address to, uint256 value) internal view returns (uint256) {
        if (isTaxExempt[from] || isTaxExempt[to]) return 0;
        if (isAMM[from]) return (value * buyTaxBps) / 10_000;
        if (isAMM[to]) return (value * sellTaxBps) / 10_000;
        return 0;
    }

    // ----------------------------------------------------------------------
    // Swap-back: split tax into a token reward + a HYPE reward
    // ----------------------------------------------------------------------

    function _swapBack() internal lockSwap {
        uint256 amount = pendingTax;
        if (amount == 0) return;
        pendingTax = 0;

        uint256 hypePart = (amount * hypeShareBps) / 10_000;
        uint256 tokenPart = amount - hypePart;

        if (tokenPart > 0) _accrue(S_TOKEN, tokenPart);

        if (hypePart > 0 && pair != address(0)) {
            // Swap directly against the pair, tolerating failure so a thin pool
            // can never brick trading (unsold tax returns to pending for retry).
            try this.swapTokenForHype(hypePart) returns (uint256 received) {
                if (received > 0) _accrue(S_HYPE, received);
                emit SwapBack(tokenPart, hypePart, received);
            } catch {
                pendingTax += hypePart;
                emit SwapBack(tokenPart, 0, 0);
            }
        } else {
            if (hypePart > 0) pendingTax += hypePart; // no pair set yet; keep for later
            emit SwapBack(tokenPart, 0, 0);
        }
    }

    /// @dev Swaps `tokenIn` of this token for native HYPE via the pair. External
    ///      only so `_swapBack` can wrap it in try/catch; restricted to self.
    function swapTokenForHype(uint256 tokenIn) external returns (uint256 hypeReceived) {
        require(msg.sender == address(this), "self only");
        IUniswapV2Pair p = IUniswapV2Pair(pair);
        (uint112 r0, uint112 r1,) = p.getReserves();
        (uint256 reserveIn, uint256 reserveOut) = _isToken0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 amountOut = _getAmountOut(tokenIn, reserveIn, reserveOut);
        if (amountOut == 0) return 0;

        // Move the tax tokens into the pair (untaxed: this contract is exempt).
        _transfer(address(this), pair, tokenIn);

        (uint256 amount0Out, uint256 amount1Out) = _isToken0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
        p.swap(amount0Out, amount1Out, address(this), "");

        // Unwrap the WHYPE we just received into native HYPE.
        uint256 wbal = IWHYPE(WHYPE).balanceOf(address(this));
        IWHYPE(WHYPE).withdraw(wbal);
        return wbal;
    }

    /// @dev UniswapV2 constant-product output (0.30% fee).
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) return 0;
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

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

    receive() external payable {
        if (_inSwap) return; // WHYPE unwrap during swap-back
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

    function withdrawableToken(address account) external view returns (uint256) {
        return _withdrawable(S_TOKEN, account);
    }

    function withdrawableHype(address account) external view returns (uint256) {
        return _withdrawable(S_HYPE, account);
    }

    // ----------------------------------------------------------------------
    // Claiming
    // ----------------------------------------------------------------------

    function claim() external nonReentrant {
        (uint256 t, uint256 h) = _claim(msg.sender, msg.sender);
        require(t > 0 || h > 0, "nothing to claim");
    }

    function _claim(address account, address to) internal returns (uint256 tokenAmt, uint256 hypeAmt) {
        if (!isExcluded[account]) {
            tokenAmt = _accumulative(S_TOKEN, account) - _streams[S_TOKEN].withdrawn[account];
            hypeAmt = _accumulative(S_HYPE, account) - _streams[S_HYPE].withdrawn[account];
        }

        if (tokenAmt > 0) {
            _streams[S_TOKEN].withdrawn[account] += tokenAmt;
            _transfer(address(this), to, tokenAmt); // untaxed (this is exempt), no swap-back
        }
        if (hypeAmt > 0) {
            _streams[S_HYPE].withdrawn[account] += hypeAmt;
            (bool ok,) = payable(to).call{value: hypeAmt}("");
            require(ok, "HYPE transfer failed");
        }
        if (tokenAmt > 0 || hypeAmt > 0) {
            emit Claimed(account, tokenAmt, hypeAmt);
        }
    }

    // ----------------------------------------------------------------------
    // Owner: tax / swap configuration
    // ----------------------------------------------------------------------

    /// @notice Set the pair used both as an AMM (for tax) and as the swap target
    ///         for the HYPE reward. Determines token ordering automatically.
    function setPair(address pair_) external onlyOwner {
        require(pair_ != address(0), "zero address");
        pair = pair_;
        isAMM[pair_] = true;
        _isToken0 = (IUniswapV2Pair(pair_).token0() == address(this));
        emit PairSet(pair_, _isToken0);
        emit AMMSet(pair_, true);
    }

    function setAMM(address amm, bool enabled) external onlyOwner {
        require(amm != address(0), "zero address");
        isAMM[amm] = enabled;
        emit AMMSet(amm, enabled);
    }

    function setTaxExempt(address account, bool exempt) external onlyOwner {
        isTaxExempt[account] = exempt;
        emit TaxExemptSet(account, exempt);
    }

    function setTaxes(uint16 buyTaxBps_, uint16 sellTaxBps_) external onlyOwner {
        require(buyTaxBps_ <= MAX_TAX_BPS && sellTaxBps_ <= MAX_TAX_BPS, "tax > 5%");
        buyTaxBps = buyTaxBps_;
        sellTaxBps = sellTaxBps_;
        emit TaxesSet(buyTaxBps_, sellTaxBps_);
    }

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

    function excludeFromRewards(address account) external onlyOwner nonReentrant {
        require(!isExcluded[account], "already excluded");
        require(account != address(0), "zero address");

        _claim(account, account);

        isExcluded[account] = true;
        uint256 bal = balanceOf[account];
        if (bal > 0) eligibleSupply -= bal;
        _freeze(account);
        emit ExclusionSet(account, true);
    }

    function includeInRewards(address account) external onlyOwner {
        require(isExcluded[account], "not excluded");
        require(account != address(this), "contract stays excluded");

        isExcluded[account] = false;
        uint256 bal = balanceOf[account];
        if (bal > 0) eligibleSupply += bal;
        _freeze(account);
        emit ExclusionSet(account, false);
    }

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
