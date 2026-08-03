// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @title TokenPresale
/// @notice Fixed-price presale for a pre-minted ERC20 (UMBRA). Every buyer pays
/// the same flat price. The sale succeeds if it reaches the soft cap before the
/// end; buyers then claim their tokens and the raise goes to the treasury. If
/// the soft cap is missed, the sale fails and every buyer can refund in full.
///
/// Fund the contract by transferring `tokensForSale` UMBRA to it before the
/// sale starts. Overpayment past the hard cap, per-wallet cap, or remaining
/// token supply is refunded inside the same buy transaction.
contract TokenPresale {
    IERC20 public immutable token;
    address public immutable treasury;

    uint256 public immutable price;        // wei per 1 whole token (1e18 base units)
    uint256 public immutable tokensForSale; // base units offered
    uint256 public immutable softCap;       // wei
    uint256 public immutable hardCap;       // wei
    uint256 public immutable startTime;
    uint256 public immutable endTime;
    uint256 public immutable perWalletCap;  // wei, 0 = no cap

    uint256 public totalRaised;
    uint256 public tokensSold;
    bool public finalized;
    bool public succeeded;

    mapping(address => uint256) public contributed; // wei in
    mapping(address => uint256) public owed;         // token base units to claim

    event Bought(address indexed buyer, uint256 weiIn, uint256 tokensOut);
    event Finalized(bool succeeded, uint256 totalRaised);
    event Claimed(address indexed buyer, uint256 tokens);
    event Refunded(address indexed buyer, uint256 weiOut);

    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(
        IERC20 token_,
        address treasury_,
        uint256 price_,
        uint256 tokensForSale_,
        uint256 softCap_,
        uint256 hardCap_,
        uint256 startTime_,
        uint256 endTime_,
        uint256 perWalletCap_
    ) {
        require(address(token_) != address(0) && treasury_ != address(0), "zero addr");
        require(price_ > 0 && tokensForSale_ > 0, "zero params");
        require(hardCap_ >= softCap_ && softCap_ > 0, "bad caps");
        require(endTime_ > startTime_ && startTime_ >= block.timestamp, "bad window");
        // The hard cap must not exceed what the offered tokens can absorb.
        require(hardCap_ <= tokensForSale_ * price_ / 1e18, "hardcap over supply");

        token = token_;
        treasury = treasury_;
        price = price_;
        tokensForSale = tokensForSale_;
        softCap = softCap_;
        hardCap = hardCap_;
        startTime = startTime_;
        endTime = endTime_;
        perWalletCap = perWalletCap_;
    }

    function tokensFor(uint256 weiAmount) public view returns (uint256) {
        return weiAmount * 1e18 / price;
    }

    /// @notice Buy at the flat price. Excess beyond any cap is refunded here.
    function buy() external payable nonReentrant {
        require(block.timestamp >= startTime, "not started");
        require(block.timestamp <= endTime, "ended");
        require(!finalized, "finalized");
        require(msg.value > 0, "no value");

        uint256 accept = msg.value;

        // clamp to remaining hard cap
        uint256 hardRoom = hardCap - totalRaised;
        require(hardRoom > 0, "hard cap reached");
        if (accept > hardRoom) accept = hardRoom;

        // clamp to per-wallet cap
        if (perWalletCap > 0) {
            uint256 walletRoom = perWalletCap - contributed[msg.sender];
            require(walletRoom > 0, "wallet cap reached");
            if (accept > walletRoom) accept = walletRoom;
        }

        // clamp to remaining token supply
        uint256 tokensOut = tokensFor(accept);
        uint256 tokensRoom = tokensForSale - tokensSold;
        require(tokensRoom > 0, "sold out");
        if (tokensOut > tokensRoom) {
            tokensOut = tokensRoom;
            accept = tokensOut * price / 1e18; // recompute the wei actually used
        }
        require(tokensOut > 0, "below min unit");

        contributed[msg.sender] += accept;
        owed[msg.sender] += tokensOut;
        totalRaised += accept;
        tokensSold += tokensOut;

        emit Bought(msg.sender, accept, tokensOut);

        uint256 excess = msg.value - accept;
        if (excess > 0) {
            (bool ok,) = msg.sender.call{value: excess}("");
            require(ok, "refund failed");
        }
    }

    /// @notice Settle the sale. Permissionless once the hard cap is hit or the
    /// window has closed, so a deployer can never trap buyer funds.
    function finalize() external nonReentrant {
        require(!finalized, "already finalized");
        require(totalRaised >= hardCap || block.timestamp > endTime, "not over");

        finalized = true;
        succeeded = totalRaised >= softCap;
        emit Finalized(succeeded, totalRaised);

        if (succeeded) {
            (bool ok,) = treasury.call{value: totalRaised}("");
            require(ok, "treasury transfer failed");
        }
    }

    /// @notice Claim purchased tokens after a successful sale.
    function claim() external nonReentrant {
        require(finalized && succeeded, "not claimable");
        uint256 amount = owed[msg.sender];
        require(amount > 0, "nothing to claim");
        owed[msg.sender] = 0;
        require(token.transfer(msg.sender, amount), "token transfer failed");
        emit Claimed(msg.sender, amount);
    }

    /// @notice Refund the full contribution after a failed sale.
    function refund() external nonReentrant {
        require(finalized && !succeeded, "not refundable");
        uint256 amount = contributed[msg.sender];
        require(amount > 0, "nothing to refund");
        contributed[msg.sender] = 0;
        owed[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "refund failed");
        emit Refunded(msg.sender, amount);
    }
}
