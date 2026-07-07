// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IDistributorMove {
    function onTokenMove(address token, address from, address to) external;
}

/// Minimal burnable ERC20 that pings a distributor on every balance change,
/// mirroring LoxleyToken. Used only for tests.
contract MockCoin {
    string public name = "Mock Coin";
    string public symbol = "MOCK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public distributor;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(uint256 supply, address _distributor) {
        distributor = _distributor;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        _move(msg.sender, to, v);
        return true;
    }

    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - v;
        _move(from, to, v);
        return true;
    }

    function _move(address from, address to, uint256 v) internal {
        if (distributor != address(0)) IDistributorMove(distributor).onTokenMove(address(this), from, to);
        balanceOf[from] -= v;
        balanceOf[to] += v;
        emit Transfer(from, to, v);
    }

    function burn(uint256 v) external {
        if (distributor != address(0)) IDistributorMove(distributor).onTokenMove(address(this), msg.sender, address(0));
        balanceOf[msg.sender] -= v;
        totalSupply -= v;
        emit Transfer(msg.sender, address(0), v);
    }
}

/// Plain ERC20 to stand in for a tokenized stock (the quote currency).
contract MockStock {
    string public name = "Mock Stock";
    string public symbol = "mAAPL";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(uint256 supply) {
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        emit Transfer(msg.sender, to, v);
        return true;
    }

    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - v;
        balanceOf[from] -= v;
        balanceOf[to] += v;
        emit Transfer(from, to, v);
        return true;
    }
}

/// Stand-in for the v4 buyback swap. Holds a stash of coins; on buyback it
/// consumes the quote and delivers `amountIn * rate` coins to the recipient.
contract MockExecutor {
    MockCoin public coin;
    uint256 public rate; // coins delivered per 1 wei of quote
    address public quote; // address(0) = ETH

    constructor(MockCoin _coin, uint256 _rate, address _quote) {
        coin = _coin;
        rate = _rate;
        quote = _quote;
    }

    function buyback(address, address _quote, uint256 amountIn, address recipient)
        external
        payable
        returns (uint256 bought)
    {
        if (_quote == address(0)) {
            require(msg.value == amountIn, "eth in");
        } else {
            // distributor approved us; pull the quote in.
            MockStock(_quote).transferFrom(msg.sender, address(this), amountIn);
        }
        bought = amountIn * rate;
        coin.transfer(recipient, bought);
    }

    receive() external payable {}
}
