// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ApexToken — ERC20 with a dual (ETH + token) dividend engine and conviction weighting.
/// @notice Holders earn two streams, claimable O(1):
///         - ETH dividends   (funded by curve sell fees + Apex sell tax)
///         - token dividends (funded by Apex buy tax)
///         Dividend weight = balance × conviction multiplier. Conviction grows the longer you
///         hold without selling; ANY outgoing transfer (a sell) resets it. Excluded addresses
///         (curve, pool, dead, game) don't earn.
/// @dev Standard magnified-dividend-per-share accumulator, generalized to weighted shares.
contract ApexToken {
    // --- ERC20 ---
    string public constant name = "Apex";
    string public constant symbol = "APEX";
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // --- admin ---
    address public owner;
    mapping(address => bool) public isExcluded; // excluded from dividends + conviction
    event ExcludedSet(address indexed account, bool excluded);
    event OwnershipTransferred(address indexed prev, address indexed next);

    // --- dividend engine ---
    uint256 internal constant MAGNITUDE = 2 ** 128;
    uint256 public magEthPerShare;
    uint256 public magTokPerShare;
    uint256 public totalShares; // sum of weighted shares of non-excluded holders
    uint256 internal bufEth; // ETH distributed while totalShares == 0, flushed later
    uint256 internal bufTok;

    mapping(address => uint256) public shares; // cached weighted share per account
    mapping(address => int256) internal ethCorrection;
    mapping(address => int256) internal tokCorrection;
    mapping(address => uint256) public withdrawnEth;
    mapping(address => uint256) public withdrawnTok;

    // --- conviction ---
    mapping(address => uint64) public firstHeldAt; // 0 = not currently holding

    event EthDistributed(uint256 amount);
    event TokensDistributed(uint256 amount);
    event EthClaimed(address indexed account, uint256 amount);
    event TokensClaimed(address indexed account, uint256 amount);

    uint256 private _locked = 1;

    modifier nonReentrant() {
        require(_locked == 1, "reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(uint256 supply_, address mintTo) {
        require(supply_ > 0 && mintTo != address(0), "bad init");
        owner = msg.sender;
        totalSupply = supply_;

        // Mint the whole supply to the initial holder (the deployer, who funds the curve).
        // mintTo starts excluded so unsold/curve-held supply earns no dividends; the curve
        // and pool are added as the system is wired up.
        _setExcluded(mintTo, true);
        balanceOf[mintTo] = supply_;
        emit Transfer(address(0), mintTo, supply_);
    }

    // ------------------------------------------------------------------ ERC20
    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "to zero");
        uint256 bal = balanceOf[from];
        require(bal >= value, "balance");
        balanceOf[from] = bal - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);

        _afterBalanceChange(from, false); // from decreased -> resets conviction
        _afterBalanceChange(to, true); // to increased
    }

    // ------------------------------------------------------------------ conviction
    /// @notice Fixed conviction schedule (bps over balance). Tunable later.
    function convictionMultBps(address a) public view returns (uint256) {
        uint64 since = firstHeldAt[a];
        if (since == 0) return 10_000;
        uint256 held = block.timestamp - since;
        if (held >= 30 days) return 20_000;
        if (held >= 7 days) return 15_000;
        if (held >= 1 days) return 12_500;
        return 10_000;
    }

    /// @notice Re-sync an account's weighted shares to its current conviction tier.
    ///         Permissionless — anyone can poke (e.g. after you cross a tier threshold).
    function syncConviction(address a) external {
        _updateShares(a);
    }

    function _afterBalanceChange(address a, bool increased) internal {
        if (!isExcluded[a]) {
            if (balanceOf[a] == 0) {
                firstHeldAt[a] = 0; // sold out entirely -> clear
            } else if (firstHeldAt[a] == 0) {
                firstHeldAt[a] = uint64(block.timestamp); // first entry
            } else if (!increased) {
                firstHeldAt[a] = uint64(block.timestamp); // sold some -> conviction resets
            }
        }
        _updateShares(a);
    }

    /// @dev Recompute weighted shares for `a` and rebalance the dividend accumulators so that
    ///      already-accrued (unclaimed) dividends are preserved across the share change.
    function _updateShares(address a) internal {
        uint256 newShares = isExcluded[a] ? 0 : (balanceOf[a] * convictionMultBps(a)) / 10_000;
        uint256 old = shares[a];
        if (newShares == old) return;

        if (newShares > old) {
            uint256 d = newShares - old;
            ethCorrection[a] -= int256(magEthPerShare * d);
            tokCorrection[a] -= int256(magTokPerShare * d);
            totalShares += d;
        } else {
            uint256 d = old - newShares;
            ethCorrection[a] += int256(magEthPerShare * d);
            tokCorrection[a] += int256(magTokPerShare * d);
            totalShares -= d;
        }
        shares[a] = newShares;
    }

    // ------------------------------------------------------------------ distribute
    /// @notice Add ETH to the holder dividend pool (called by curve/game; permissionless).
    function distributeEth() external payable {
        _distEth(msg.value);
    }

    function _distEth(uint256 amt) internal {
        if (amt == 0 && bufEth == 0) return;
        if (totalShares == 0) {
            bufEth += amt;
            return;
        }
        uint256 a = amt + bufEth;
        bufEth = 0;
        magEthPerShare += (a * MAGNITUDE) / totalShares;
        emit EthDistributed(a);
    }

    /// @notice Add APEX tokens to the holder token-dividend pool. Caller must approve first.
    function distributeTokens(uint256 amount) external {
        require(amount > 0, "zero");
        // Pull into this contract (held as the token-dividend reserve).
        _transfer(msg.sender, address(this), amount);
        if (totalShares == 0) {
            bufTok += amount;
            return;
        }
        uint256 a = amount + bufTok;
        bufTok = 0;
        magTokPerShare += (a * MAGNITUDE) / totalShares;
        emit TokensDistributed(a);
    }

    // ------------------------------------------------------------------ claim / views
    function withdrawableEth(address a) public view returns (uint256) {
        return _accumulated(magEthPerShare, shares[a], ethCorrection[a]) - withdrawnEth[a];
    }

    function withdrawableTokens(address a) public view returns (uint256) {
        return _accumulated(magTokPerShare, shares[a], tokCorrection[a]) - withdrawnTok[a];
    }

    function _accumulated(uint256 magPerShare, uint256 s, int256 corr) internal pure returns (uint256) {
        int256 total = int256(magPerShare * s) + corr;
        if (total < 0) total = 0;
        return uint256(total) / MAGNITUDE;
    }

    function claimEth() external nonReentrant {
        uint256 amt = withdrawableEth(msg.sender);
        require(amt > 0, "nothing");
        withdrawnEth[msg.sender] += amt;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "eth send");
        emit EthClaimed(msg.sender, amt);
    }

    function claimTokens() external nonReentrant {
        uint256 amt = withdrawableTokens(msg.sender);
        require(amt > 0, "nothing");
        withdrawnTok[msg.sender] += amt;
        // Pay from the contract's token-dividend reserve. address(this) is excluded, so this
        // transfer doesn't touch share accounting for a real holder.
        _transfer(address(this), msg.sender, amt);
        emit TokensClaimed(msg.sender, amt);
    }

    // ------------------------------------------------------------------ admin
    function setExcluded(address a, bool excluded) external {
        require(msg.sender == owner, "not owner");
        _setExcluded(a, excluded);
        _updateShares(a);
    }

    function _setExcluded(address a, bool excluded) internal {
        if (isExcluded[a] == excluded) return;
        isExcluded[a] = excluded;
        emit ExcludedSet(a, excluded);
    }

    function transferOwnership(address next) external {
        require(msg.sender == owner, "not owner");
        require(next != address(0), "zero");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    receive() external payable {
        _distEth(msg.value);
    }
}
