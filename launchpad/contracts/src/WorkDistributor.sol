// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPresaleView {
    function contributors(uint256 index) external view returns (address);
    function contributorsCount() external view returns (uint256);
    function tokensOwed(address buyer) external view returns (uint256);
    function closed() external view returns (bool);
}

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title WorkDistributor
/// @notice Pays out $WORK to presale contributors, pro-rata to what they paid,
/// at the fixed presale price. Fund this contract with the presale allocation
/// of $WORK, then call distribute() once the presale is closed.
///
/// Distribution is push-based and batched (call distribute(count) repeatedly for
/// large contributor sets). It is idempotent: each contributor is paid once.
contract WorkDistributor {
    IPresaleView public immutable presale;
    IERC20Min public immutable token; // $WORK

    address public owner;
    uint256 public nextIndex;
    bool public finished;
    mapping(address => bool) public paid;

    event Distributed(address indexed to, uint256 amount);
    event Finished(uint256 contributorCount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _presale, address _token) {
        require(_presale != address(0) && _token != address(0), "zero");
        presale = IPresaleView(_presale);
        token = IERC20Min(_token);
        owner = msg.sender;
    }

    /// @notice Distribute $WORK to the next `count` contributors.
    function distribute(uint256 count) external onlyOwner {
        require(presale.closed(), "presale open");
        require(!finished, "finished");

        uint256 n = presale.contributorsCount();
        uint256 i = nextIndex;
        uint256 end = i + count;
        if (end > n) end = n;

        for (; i < end; i++) {
            address a = presale.contributors(i);
            if (paid[a]) continue;
            paid[a] = true;
            uint256 amt = presale.tokensOwed(a);
            if (amt > 0) {
                require(token.transfer(a, amt), "transfer failed");
                emit Distributed(a, amt);
            }
        }

        nextIndex = i;
        if (nextIndex >= n) {
            finished = true;
            emit Finished(n);
        }
    }

    /// @notice Total $WORK required to pay every contributor.
    function totalOwed() external view returns (uint256 sum) {
        uint256 n = presale.contributorsCount();
        for (uint256 i; i < n; i++) {
            sum += presale.tokensOwed(presale.contributors(i));
        }
    }

    /// @notice Recover leftover $WORK after distribution completes.
    function sweep(address to) external onlyOwner {
        require(finished, "not finished");
        require(to != address(0), "to=0");
        token.transfer(to, token.balanceOf(address(this)));
    }
}
