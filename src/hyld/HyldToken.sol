// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title HyldToken — HyperYield (HYLD), a fixed-supply ERC20 with a dual dividend engine.
/// @notice 10,000 HYLD, fixed. There is NO transfer tax: transfers move tokens 1:1 and take
///         no cut. Holders earn two reward streams, claimable in O(1):
///           - HYPE dividends  (native, from the WHYPE side of the pool's 1% swap fee)
///           - HYLD dividends  (from the HYLD side of the pool's 1% swap fee)
///         The HyldManager collects the locked LP's fees and pushes them here, where they are
///         shared pro-rata across non-excluded holders. Excluded addresses (the pool, the
///         manager, this contract's dividend reserve, dead) do not earn.
/// @dev Standard magnified-dividend-per-share accumulator. shares == balance for holders.
contract HyldToken {
    // --- ERC20 ---
    string public constant name = "HyperYield";
    string public constant symbol = "HYLD";
    uint8 public constant decimals = 18;
    uint256 public constant totalSupply = 10_000e18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // --- admin ---
    address public owner;
    mapping(address => bool) public isExcluded; // excluded from dividends
    event ExcludedSet(address indexed account, bool excluded);
    event OwnershipTransferred(address indexed prev, address indexed next);

    // --- dividend engine ---
    uint256 internal constant MAGNITUDE = 2 ** 128;
    uint256 public magHypePerShare; // native HYPE per share, scaled
    uint256 public magTokPerShare; // HYLD per share, scaled
    uint256 public totalShares; // sum of non-excluded holder balances
    uint256 internal bufHype; // HYPE distributed while totalShares == 0, flushed later
    uint256 internal bufTok; // HYLD distributed while totalShares == 0

    mapping(address => uint256) public shares;
    mapping(address => int256) internal hypeCorrection;
    mapping(address => int256) internal tokCorrection;
    mapping(address => uint256) public withdrawnHype;
    mapping(address => uint256) public withdrawnTok;

    event HypeDistributed(uint256 amount);
    event TokensDistributed(uint256 amount);
    event HypeClaimed(address indexed account, uint256 amount);
    event TokensClaimed(address indexed account, uint256 amount);

    uint256 private _locked = 1;

    modifier nonReentrant() {
        require(_locked == 1, "reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }

    /// @param mintTo Receives the whole supply (the manager, which seeds the LP). Starts
    ///        excluded so the pre-seed supply earns nothing; the pool is excluded after it
    ///        is created. This contract self-excludes so its HYLD dividend reserve is inert.
    constructor(address mintTo) {
        require(mintTo != address(0), "bad init");
        owner = msg.sender;

        _setExcluded(address(this), true);
        _setExcluded(mintTo, true);
        balanceOf[mintTo] = totalSupply;
        emit Transfer(address(0), mintTo, totalSupply);
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

        _updateShares(from);
        _updateShares(to);
    }

    /// @dev Recompute `a`'s shares (== balance unless excluded) and rebalance the dividend
    ///      accumulators so already-accrued, unclaimed dividends survive the share change.
    function _updateShares(address a) internal {
        uint256 newShares = isExcluded[a] ? 0 : balanceOf[a];
        uint256 old = shares[a];
        if (newShares == old) return;

        if (newShares > old) {
            uint256 d = newShares - old;
            hypeCorrection[a] -= int256(magHypePerShare * d);
            tokCorrection[a] -= int256(magTokPerShare * d);
            totalShares += d;
        } else {
            uint256 d = old - newShares;
            hypeCorrection[a] += int256(magHypePerShare * d);
            tokCorrection[a] += int256(magTokPerShare * d);
            totalShares -= d;
        }
        shares[a] = newShares;
    }

    // ------------------------------------------------------------------ distribute
    /// @notice Add native HYPE to the holder dividend pool. Permissionless (the manager calls
    ///         this after unwrapping the WHYPE fee side; anyone may also top it up).
    function distributeHype() external payable {
        _distHype(msg.value);
    }

    function _distHype(uint256 amt) internal {
        if (amt == 0 && bufHype == 0) return;
        if (totalShares == 0) {
            bufHype += amt;
            return;
        }
        uint256 a = amt + bufHype;
        bufHype = 0;
        magHypePerShare += (a * MAGNITUDE) / totalShares;
        emit HypeDistributed(a);
    }

    /// @notice Add HYLD to the holder token-dividend pool. Caller must hold the HYLD; it is
    ///         pulled into this contract (the inert, excluded dividend reserve) via _transfer.
    function distributeTokens(uint256 amount) external {
        require(amount > 0, "zero");
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
    function withdrawableHype(address a) public view returns (uint256) {
        return _accumulated(magHypePerShare, shares[a], hypeCorrection[a]) - withdrawnHype[a];
    }

    function withdrawableTokens(address a) public view returns (uint256) {
        return _accumulated(magTokPerShare, shares[a], tokCorrection[a]) - withdrawnTok[a];
    }

    function _accumulated(uint256 magPerShare, uint256 s, int256 corr) internal pure returns (uint256) {
        int256 total = int256(magPerShare * s) + corr;
        if (total < 0) total = 0;
        return uint256(total) / MAGNITUDE;
    }

    function claimHype() external nonReentrant {
        uint256 amt = withdrawableHype(msg.sender);
        require(amt > 0, "nothing");
        withdrawnHype[msg.sender] += amt;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "hype send");
        emit HypeClaimed(msg.sender, amt);
    }

    function claimTokens() external nonReentrant {
        uint256 amt = withdrawableTokens(msg.sender);
        require(amt > 0, "nothing");
        withdrawnTok[msg.sender] += amt;
        _transfer(address(this), msg.sender, amt); // pay from the excluded reserve
        emit TokensClaimed(msg.sender, amt);
    }

    // ------------------------------------------------------------------ admin
    /// @notice Exclude/include an address from dividends. Used to mark the pool, manager,
    ///         and dead address as non-earning. No effect on balances or transfers.
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

    /// @notice There is no mint, pause, or freeze. Ownership only gates the exclusion list;
    ///         it can be renounced to address(0) once the pool/manager are excluded.
    function transferOwnership(address next) external {
        require(msg.sender == owner, "not owner");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    receive() external payable {
        _distHype(msg.value);
    }
}
