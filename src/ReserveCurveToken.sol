// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ReserveCurveToken
/// @notice ERC20 minted/burned along a linear bonding curve, fully backed by an
///         ETH reserve. The contract is always solvent: the reserve always equals
///         the exact integral of the curve up to the current supply, so it can
///         always buy back every token. No transfer tax, no team mint, no admin
///         withdrawal of the reserve.
///
///         Pricing (per whole 1e18 token):  p(s) = BASE + SLOPE * s / 1e18
///         where s is the current totalSupply (in wei-tokens, 18 decimals).
///
///         Cost to mint from s0 -> s1 (wei of ETH):
///           BASE*(s1-s0)/1e18 + SLOPE*(s1^2 - s0^2)/(2*1e36)
///
///         The reserve ETH is intended to be deployed to an external yield source
///         (e.g. an LST/Aave adapter). Any *surplus* above the curve reserve and
///         the pending dividends is harvested and distributed to holders as ETH,
///         pro-rata, via magnified per-share accounting (claimable). Yield is the
///         only source of upside beyond the curve — there are no inflationary
///         emissions.
contract ReserveCurveToken {
    // --- ERC20 ---
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // --- Curve ---
    uint256 public immutable BASE;  // wei per token at supply 0
    uint256 public immutable SLOPE; // wei per token added per whole token minted
    uint256 private constant WAD = 1e18;

    // --- Reserve / yield ---
    uint256 public reserve;         // ETH (wei) owed to the curve = integral(0..supply)
    address public owner;
    IYieldAdapter public yieldAdapter;

    // --- dividends (magnified per-share, Roger Wu pattern) ---
    uint256 internal constant MAGNITUDE = 2 ** 128;
    uint256 public magnifiedDividendPerShare;
    mapping(address => int256) internal magnifiedCorrections;
    mapping(address => uint256) public withdrawnDividends;
    uint256 public totalDividendsDistributed;
    uint256 public totalDividendsWithdrawn;

    event Buy(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 newSupply);
    event Sell(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 newSupply);
    event Harvest(uint256 distributed);
    event DividendClaimed(address indexed holder, uint256 amount);
    event YieldAdapterSet(address adapter);
    event OwnerRenounced();

    // --- reentrancy guard ---
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(string memory _name, string memory _symbol, uint256 _base, uint256 _slope) {
        require(_base > 0 || _slope > 0, "flat curve");
        name = _name;
        symbol = _symbol;
        BASE = _base;
        SLOPE = _slope;
        owner = msg.sender;
    }

    // ============================ Curve math ============================

    /// @notice ETH cost (wei) to mint `amount` tokens at the current supply.
    function buyCost(uint256 amount) public view returns (uint256) {
        return _integral(totalSupply, totalSupply + amount);
    }

    /// @notice ETH refund (wei) for selling `amount` tokens at the current supply.
    function sellRefund(uint256 amount) public view returns (uint256) {
        require(amount <= totalSupply, "amount > supply");
        return _integral(totalSupply - amount, totalSupply);
    }

    /// @notice Marginal spot price (wei per whole token) at the current supply.
    function spotPrice() external view returns (uint256) {
        return BASE + (SLOPE * totalSupply) / WAD;
    }

    /// @dev Integral of p(s) ds from s0 to s1, s in wei-tokens, result in wei ETH.
    function _integral(uint256 s0, uint256 s1) internal view returns (uint256) {
        // BASE term: BASE * (s1 - s0) / WAD
        uint256 baseTerm = (BASE * (s1 - s0)) / WAD;
        // SLOPE term: SLOPE * (s1^2 - s0^2) / (2 * WAD^2)
        uint256 sqDiff = s1 * s1 - s0 * s0;
        uint256 slopeTerm = (SLOPE * sqDiff) / (2 * WAD * WAD);
        return baseTerm + slopeTerm;
    }

    // ============================ Trading ============================

    /// @notice Buy at least `minTokensOut` tokens with the ETH sent.
    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        require(msg.value > 0, "no ETH");
        tokensOut = _tokensForEth(msg.value);
        require(tokensOut >= minTokensOut, "slippage");
        require(tokensOut > 0, "dust");

        uint256 cost = _integral(totalSupply, totalSupply + tokensOut);
        require(cost <= msg.value, "cost overflow");

        reserve += cost;
        _mint(msg.sender, tokensOut);
        emit Buy(msg.sender, cost, tokensOut, totalSupply);

        uint256 refund = msg.value - cost;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok, "refund fail");
        }
    }

    /// @notice Sell `amount` tokens back to the curve for ETH (>= minEthOut).
    function sell(uint256 amount, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        require(amount > 0 && balanceOf[msg.sender] >= amount, "balance");
        ethOut = _integral(totalSupply - amount, totalSupply);
        require(ethOut >= minEthOut, "slippage");

        reserve -= ethOut;
        _burn(msg.sender, amount);
        emit Sell(msg.sender, amount, ethOut, totalSupply);

        _ensureLiquidity(ethOut);
        (bool ok,) = msg.sender.call{value: ethOut}("");
        require(ok, "pay fail");
    }

    /// @dev Largest token amount whose exact mint cost is <= ethIn (binary search).
    function _tokensForEth(uint256 ethIn) internal view returns (uint256) {
        uint256 lo = 0;
        uint256 hi = BASE > 0 ? (ethIn * WAD) / BASE + 1 : ethIn + WAD;
        while (_integral(totalSupply, totalSupply + hi) <= ethIn) {
            hi *= 2;
        }
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (_integral(totalSupply, totalSupply + mid) <= ethIn) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return lo;
    }

    // ============================ Yield / dividends ============================

    /// @notice Distribute yield surplus (backing above curve reserve + pending
    ///         dividends) to holders pro-rata. Anyone can call.
    function harvest() external nonReentrant returns (uint256 distributed) {
        require(totalSupply > 0, "no supply");
        uint256 pending = totalDividendsDistributed - totalDividendsWithdrawn;
        uint256 backing = _totalBacking();
        require(backing > reserve + pending, "no surplus");
        distributed = backing - reserve - pending;

        magnifiedDividendPerShare += (distributed * MAGNITUDE) / totalSupply;
        totalDividendsDistributed += distributed;
        emit Harvest(distributed);
    }

    /// @notice ETH dividends a holder can currently withdraw.
    function withdrawableDividend(address holder) public view returns (uint256) {
        int256 acc = int256(magnifiedDividendPerShare * balanceOf[holder]) + magnifiedCorrections[holder];
        uint256 accrued = uint256(acc) / MAGNITUDE;
        return accrued - withdrawnDividends[holder];
    }

    /// @notice Claim accrued ETH dividends.
    function claim() external nonReentrant returns (uint256 amount) {
        amount = withdrawableDividend(msg.sender);
        require(amount > 0, "nothing to claim");
        withdrawnDividends[msg.sender] += amount;
        totalDividendsWithdrawn += amount;
        _ensureLiquidity(amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "pay fail");
        emit DividendClaimed(msg.sender, amount);
    }

    /// @dev Total ETH backing available = idle balance + whatever the adapter holds.
    function _totalBacking() internal view returns (uint256) {
        uint256 adapterBal = address(yieldAdapter) != address(0) ? yieldAdapter.totalAssets() : 0;
        return address(this).balance + adapterBal;
    }

    /// @dev Ensure at least `need` wei is idle here, withdrawing from the adapter.
    function _ensureLiquidity(uint256 need) internal {
        if (address(this).balance >= need) return;
        uint256 short = need - address(this).balance;
        require(address(yieldAdapter) != address(0), "insufficient idle");
        yieldAdapter.withdraw(short);
        require(address(this).balance >= need, "withdraw short");
    }

    // ============================ Admin (limited) ============================

    function setYieldAdapter(address adapter) external {
        require(msg.sender == owner, "not owner");
        yieldAdapter = IYieldAdapter(adapter);
        emit YieldAdapterSet(adapter);
    }

    /// @notice Push idle ETH into the yield adapter. Cannot exceed idle balance and
    ///         never touches dividend/reserve accounting.
    function deployToYield(uint256 amount) external {
        require(msg.sender == owner, "not owner");
        require(address(yieldAdapter) != address(0), "no adapter");
        require(amount <= address(this).balance, "too much");
        yieldAdapter.deposit{value: amount}();
    }

    /// @notice Renounce ownership. After this, no admin functions can be called.
    function renounceOwnership() external {
        require(msg.sender == owner, "not owner");
        owner = address(0);
        emit OwnerRenounced();
    }

    // ============================ ERC20 + dividend bookkeeping ============================

    function _mint(address to, uint256 amt) internal {
        totalSupply += amt;
        balanceOf[to] += amt;
        magnifiedCorrections[to] -= int256(magnifiedDividendPerShare * amt);
        emit Transfer(address(0), to, amt);
    }

    function _burn(address from, uint256 amt) internal {
        balanceOf[from] -= amt;
        totalSupply -= amt;
        magnifiedCorrections[from] += int256(magnifiedDividendPerShare * amt);
        emit Transfer(from, address(0), amt);
    }

    function transfer(address to, uint256 v) external returns (bool) {
        _transfer(msg.sender, to, v);
        return true;
    }

    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= v, "allowance");
            allowance[from][msg.sender] = a - v;
        }
        _transfer(from, to, v);
        return true;
    }

    function approve(address spender, uint256 v) external returns (bool) {
        allowance[msg.sender][spender] = v;
        emit Approval(msg.sender, spender, v);
        return true;
    }

    function _transfer(address from, address to, uint256 v) internal {
        require(to != address(0), "zero to");
        require(balanceOf[from] >= v, "balance");
        balanceOf[from] -= v;
        balanceOf[to] += v;
        // move accrued dividend entitlement with the tokens
        int256 magnified = int256(magnifiedDividendPerShare * v);
        magnifiedCorrections[from] += magnified;
        magnifiedCorrections[to] -= magnified;
        emit Transfer(from, to, v);
    }

    /// @dev Accept ETH (e.g. yield adapter returning funds, or simulated yield).
    receive() external payable {}
}

interface IYieldAdapter {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function totalAssets() external view returns (uint256);
}
