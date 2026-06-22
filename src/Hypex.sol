// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title HYPEX
/// @notice Fixed-supply ERC20 with NO transfer tax (V3-safe). Holders earn SPCX
///         rewards pro-rata, funded by the buyback contract which buys SPCX on
///         HyperCore and then calls distribute(). Rewards are claim-based, tracked
///         with magnified per-share accounting (Roger Wu pattern). Addresses such
///         as the V3 pool and the fee locker are excluded from the reward
///         denominator so rewards never leak back into liquidity.
contract Hypex {
    // --- ERC20 ---
    string public constant name = "HyperX";
    string public constant symbol = "HYPEX";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    address public owner;
    IERC20 public immutable SPCX; // reward token (HyperCore-listed, EVM-linked)

    // --- SPCX dividend accounting ---
    uint256 internal constant MAG = 2 ** 128;
    uint256 public magnifiedSpcxPerShare;
    mapping(address => int256) internal corrections;
    mapping(address => uint256) public withdrawnSpcx;
    mapping(address => bool) public excludedFromRewards;
    uint256 public eligibleSupply; // totalSupply minus excluded balances
    uint256 public totalDistributed;

    event Distributed(uint256 amount);
    event Claimed(address indexed who, uint256 amount);
    event ExcludedSet(address indexed who, bool excluded);
    event OwnerRenounced();

    uint256 private _lock = 1;
    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(uint256 supply, address spcx, address treasury) {
        require(spcx != address(0) && treasury != address(0), "zero");
        owner = msg.sender;
        SPCX = IERC20(spcx);
        _mint(treasury, supply);
    }

    // ============================ Rewards ============================

    /// @notice Buyback contract approves SPCX to this token, then calls distribute().
    ///         Credits SPCX to all eligible HYPEX holders pro-rata.
    function distribute(uint256 amount) external {
        require(eligibleSupply > 0, "no eligible supply");
        require(amount > 0, "zero");
        require(SPCX.transferFrom(msg.sender, address(this), amount), "pull fail");
        magnifiedSpcxPerShare += (amount * MAG) / eligibleSupply;
        totalDistributed += amount;
        emit Distributed(amount);
    }

    /// @notice SPCX a holder can currently claim.
    function withdrawableSpcx(address a) public view returns (uint256) {
        if (excludedFromRewards[a]) return 0;
        int256 acc = int256(magnifiedSpcxPerShare * balanceOf[a]) + corrections[a];
        return uint256(acc) / MAG - withdrawnSpcx[a];
    }

    /// @notice Claim accrued SPCX.
    function claim() external nonReentrant returns (uint256 amount) {
        amount = withdrawableSpcx(msg.sender);
        require(amount > 0, "nothing to claim");
        withdrawnSpcx[msg.sender] += amount;
        require(SPCX.transfer(msg.sender, amount), "pay fail");
        emit Claimed(msg.sender, amount);
    }

    // ============================ Admin (limited) ============================

    /// @notice Exclude/include an address from the reward denominator (e.g. the V3
    ///         pool, the fee locker, the buyback). Excluded addresses never accrue.
    function excludeFromRewards(address a, bool ex) external {
        require(msg.sender == owner, "not owner");
        if (excludedFromRewards[a] == ex) return;
        uint256 bal = balanceOf[a];
        excludedFromRewards[a] = ex;
        if (ex) {
            // settle then freeze: zero out its future entitlement, drop from denominator
            eligibleSupply -= bal;
            corrections[a] += int256(magnifiedSpcxPerShare * bal);
        } else {
            eligibleSupply += bal;
            corrections[a] -= int256(magnifiedSpcxPerShare * bal);
        }
        emit ExcludedSet(a, ex);
    }

    function renounceOwnership() external {
        require(msg.sender == owner, "not owner");
        owner = address(0);
        emit OwnerRenounced();
    }

    // ============================ ERC20 ============================

    function transfer(address to, uint256 v) external returns (bool) {
        _transfer(msg.sender, to, v);
        return true;
    }

    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        uint256 a = allowance[f][msg.sender];
        if (a != type(uint256).max) {
            require(a >= v, "allowance");
            allowance[f][msg.sender] = a - v;
        }
        _transfer(f, to, v);
        return true;
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        emit Approval(msg.sender, s, v);
        return true;
    }

    function _mint(address to, uint256 amt) internal {
        totalSupply += amt;
        balanceOf[to] += amt;
        if (!excludedFromRewards[to]) {
            eligibleSupply += amt;
            corrections[to] -= int256(magnifiedSpcxPerShare * amt);
        }
        emit Transfer(address(0), to, amt);
    }

    function _transfer(address from, address to, uint256 v) internal {
        require(to != address(0), "zero to");
        require(balanceOf[from] >= v, "balance");
        balanceOf[from] -= v;
        balanceOf[to] += v;

        int256 m = int256(magnifiedSpcxPerShare * v);
        bool fEx = excludedFromRewards[from];
        bool tEx = excludedFromRewards[to];
        if (!fEx) corrections[from] += m; // eligible sender keeps what it earned
        if (!tEx) corrections[to] -= m; // eligible receiver doesn't get past rewards
        if (fEx && !tEx) eligibleSupply += v; // excluded -> eligible
        if (!fEx && tEx) eligibleSupply -= v; // eligible -> excluded

        emit Transfer(from, to, v);
    }
}
