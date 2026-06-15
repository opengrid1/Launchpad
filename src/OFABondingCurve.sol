// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title OFABondingCurve
/// @notice A constant-product (x*y=k) bonding curve sale with virtual reserves.
///         Buyers send ETH and receive tokens at a price that rises as the curve fills.
///
///         There is NO buy cap and NO automatic graduation. The curve keeps taking
///         buys and accumulating ETH until the owner calls `pullLiquidity`, which sweeps
///         all ETH and the remaining tokens to a chosen address so the owner can add the
///         Uniswap LP manually. Pulling liquidity closes the curve permanently.
///
/// @dev    Trust note: the owner can call `pullLiquidity` at any time and receive all
///         buyer ETH. This is intentional (manual LP deployment) but means buyers are
///         trusting the owner. Point `pullLiquidity` at a multisig where possible.
contract OFABondingCurve {
    /// @notice Token being sold on the curve.
    IERC20 public immutable token;

    /// @notice Owner: can pull liquidity and transfer ownership.
    address public owner;

    /// @notice Virtual ETH reserve (starts at `virtualEth`, grows with every buy).
    uint256 public ethReserve;
    /// @notice Token reserve still on the curve (starts at `tokensForSale`, shrinks with buys).
    uint256 public tokenReserve;
    /// @notice Constant-product invariant: ethReserve * tokenReserve.
    uint256 public immutable k;

    /// @notice Initial virtual ETH reserve — anchors the starting price.
    uint256 public immutable virtualEth;
    /// @notice Tokens originally seeded onto the curve.
    uint256 public immutable tokensForSale;

    /// @notice Real ETH collected from buyers (excludes the virtual portion).
    uint256 public totalEthRaised;
    /// @notice Tokens sold so far.
    uint256 public tokensSold;
    /// @notice True once `pullLiquidity` has been called; buys are then disabled.
    bool public graduated;

    uint256 private _lock = 1;

    event Buy(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 newPriceWeiPerToken);
    event LiquidityPulled(address indexed to, uint256 ethAmount, uint256 tokenAmount);
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

    /// @param _token         ERC20 to sell. The sale allocation must be transferred to this
    ///                       contract before any buys (balance >= _tokensForSale).
    /// @param _tokensForSale Token amount seeded onto the curve (18 decimals).
    /// @param _virtualEth    Virtual ETH reserve in wei. Start price = _virtualEth / _tokensForSale.
    ///                       Larger value = higher start price + flatter curve.
    /// @param _owner         Owner address (receives liquidity on pull).
    constructor(address _token, uint256 _tokensForSale, uint256 _virtualEth, address _owner) {
        require(_token != address(0) && _owner != address(0), "zero address");
        require(_tokensForSale > 0 && _virtualEth > 0, "bad params");
        token = IERC20(_token);
        owner = _owner;
        tokensForSale = _tokensForSale;
        virtualEth = _virtualEth;
        ethReserve = _virtualEth;
        tokenReserve = _tokensForSale;
        k = _virtualEth * _tokensForSale;
        emit OwnershipTransferred(address(0), _owner);
    }

    /// @notice Buy tokens with ETH. No cap, no per-wallet limit.
    /// @param minTokensOut Slippage guard — revert if fewer tokens would be received.
    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        require(!graduated, "graduated");
        require(msg.value > 0, "no eth");

        uint256 newEth = ethReserve + msg.value;
        uint256 newToken = k / newEth; // rounds down -> never over-pays the buyer
        tokensOut = tokenReserve - newToken;
        require(tokensOut >= minTokensOut, "slippage");
        require(tokensOut > 0, "zero out");

        ethReserve = newEth;
        tokenReserve = newToken;
        totalEthRaised += msg.value;
        tokensSold += tokensOut;

        require(token.transfer(msg.sender, tokensOut), "token transfer failed");
        emit Buy(msg.sender, msg.value, tokensOut, priceWeiPerToken());
    }

    /// @notice Owner sweeps all ETH and remaining tokens to `to` and closes the curve.
    ///         Use the funds to seed the Uniswap LP manually.
    function pullLiquidity(address to) external onlyOwner nonReentrant {
        require(to != address(0), "zero address");
        require(!graduated, "already pulled");
        graduated = true;

        uint256 ethAmount = address(this).balance;
        uint256 tokenAmount = token.balanceOf(address(this));

        if (tokenAmount > 0) {
            require(token.transfer(to, tokenAmount), "token transfer failed");
        }
        if (ethAmount > 0) {
            (bool ok,) = payable(to).call{value: ethAmount}("");
            require(ok, "eth transfer failed");
        }
        emit LiquidityPulled(to, ethAmount, tokenAmount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ----------------------------- views -----------------------------

    /// @notice Current marginal price, in wei of ETH per whole token (1e18 units).
    function priceWeiPerToken() public view returns (uint256) {
        return (ethReserve * 1e18) / tokenReserve;
    }

    /// @notice Tokens a buyer would receive for `ethIn` right now (before slippage).
    function quoteTokensOut(uint256 ethIn) external view returns (uint256) {
        if (graduated || ethIn == 0) return 0;
        uint256 newEth = ethReserve + ethIn;
        return tokenReserve - (k / newEth);
    }

    /// @notice Real ETH currently held by the curve (claimable via pullLiquidity).
    function ethInCurve() external view returns (uint256) {
        return address(this).balance;
    }
}
