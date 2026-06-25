// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title WorkPresale
/// @notice Fixed-price presale for the Coinworks token ($WORK).
/// Every contribution is recorded on-chain (so distribution can be computed)
/// and the ETH is forwarded straight to the project wallet in the same call.
/// The contract never custodies funds: it is a thin recorder + forwarder.
///
/// $WORK itself is a native B20 token that can only be minted once B20 is live
/// on Base mainnet, so this presale runs first and the distributor pays out
/// $WORK afterwards (see WorkDistributor).
contract WorkPresale {
    /// @notice Project wallet that receives every contribution (an EOA).
    address public immutable proceeds;
    /// @notice Fundraising goal. Informational; the sale is non-refundable.
    uint256 public immutable softCap;
    /// @notice Maximum total ETH the sale accepts.
    uint256 public immutable hardCap;
    /// @notice Price as wei of ETH per 1.0 $WORK (18 decimals).
    /// e.g. 0.00000004 ETH per WORK == 40_000_000_000 wei.
    uint256 public immutable priceWeiPerToken;

    address public owner;
    bool public closed;
    uint256 public totalRaised;

    address[] public contributors;
    mapping(address => uint256) public contributed;

    event Contributed(address indexed buyer, uint256 amount, uint256 buyerTotal, uint256 totalRaised);
    event Closed(uint256 totalRaised);
    event OwnerTransferred(address indexed from, address indexed to);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _proceeds, uint256 _softCap, uint256 _hardCap, uint256 _priceWeiPerToken) {
        require(_proceeds != address(0), "proceeds=0");
        require(_softCap > 0 && _hardCap >= _softCap, "caps");
        require(_priceWeiPerToken > 0, "price=0");
        proceeds = _proceeds;
        softCap = _softCap;
        hardCap = _hardCap;
        priceWeiPerToken = _priceWeiPerToken;
        owner = msg.sender;
    }

    receive() external payable {
        contribute();
    }

    /// @notice Contribute ETH. Records the buyer and forwards the ETH to the
    /// project wallet. No per-wallet limit; reverts past the hard cap.
    function contribute() public payable {
        require(!closed, "closed");
        require(msg.value > 0, "zero");
        require(totalRaised + msg.value <= hardCap, "hard cap");

        if (contributed[msg.sender] == 0) {
            contributors.push(msg.sender);
        }
        contributed[msg.sender] += msg.value;
        totalRaised += msg.value;

        emit Contributed(msg.sender, msg.value, contributed[msg.sender], totalRaised);

        // forward to the project wallet (an EOA, cannot reenter)
        (bool ok,) = proceeds.call{value: msg.value}("");
        require(ok, "forward failed");
    }

    /// @notice Close the sale. After this no more contributions are accepted
    /// and the distributor can pay out $WORK.
    function close() external onlyOwner {
        closed = true;
        emit Closed(totalRaised);
    }

    function transferOwnership(address to) external onlyOwner {
        require(to != address(0), "to=0");
        emit OwnerTransferred(owner, to);
        owner = to;
    }

    /// @notice Amount of $WORK (18 decimals) a buyer is owed for the sale.
    function tokensOwed(address buyer) public view returns (uint256) {
        return (contributed[buyer] * 1e18) / priceWeiPerToken;
    }

    function contributorsCount() external view returns (uint256) {
        return contributors.length;
    }

    function softCapReached() external view returns (bool) {
        return totalRaised >= softCap;
    }
}
