// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IDistributorMove {
    function onTokenMove(address token, address from, address to) external;
}

/// @notice Fixed-supply ERC-20 for a Loxley coin (v2).
///
///         Same as v1 — no transfer tax on the token itself (the 1% is taken in
///         the quote currency by the v4 hook on swap), and a settlement ping to
///         the distributor on every balance change so holder rewards stay exact.
///
///         v2 adds `burn`, used only by the buyback path: the distributor buys
///         the coin with the creator's fee share and burns it, permanently
///         reducing supply. Anyone can burn their own tokens; no one can burn
///         someone else's.
contract LoxleyTokenV2 {
    string public name;
    string public symbol;
    string public uri;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    IDistributorMove public immutable distributor;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, string memory _uri, uint256 _supply, address _distributor) {
        name = _name;
        symbol = _symbol;
        uri = _uri;
        totalSupply = _supply;
        distributor = IDistributorMove(_distributor);
        balanceOf[msg.sender] = _supply; // to the factory, which seeds the pool
        emit Transfer(address(0), msg.sender, _supply);
    }

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
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        distributor.onTokenMove(address(this), from, to); // settle BEFORE balances move
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    /// Burn caller's own tokens (used by the distributor's buyback).
    function burn(uint256 value) external {
        distributor.onTokenMove(address(this), msg.sender, address(0));
        balanceOf[msg.sender] -= value;
        totalSupply -= value;
        emit Transfer(msg.sender, address(0), value);
    }
}
