// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title PlainToken — minimal fixed-supply ERC20, 0% tax, no owner/admin, no reward system.
/// @notice Whole supply minted to `mintTo` at construction. Intended to be deployed via CREATE2
///         (for a vanity address) and seeded single-sided into a Hyperswap V3 pool by the holder.
contract PlainToken {
    string public constant name = "HYPEX";
    string public constant symbol = "HYPEX";
    uint8 public constant decimals = 18;
    uint256 public constant totalSupply = 10_000e18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(address mintTo) {
        require(mintTo != address(0), "mintTo zero");
        balanceOf[mintTo] = totalSupply;
        emit Transfer(address(0), mintTo, totalSupply);
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        emit Approval(msg.sender, s, v);
        return true;
    }

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

    function _transfer(address f, address to, uint256 v) internal {
        require(to != address(0), "to zero");
        uint256 b = balanceOf[f];
        require(b >= v, "balance");
        balanceOf[f] = b - v;
        balanceOf[to] += v;
        emit Transfer(f, to, v);
    }
}
