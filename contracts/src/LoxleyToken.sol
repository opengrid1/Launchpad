// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRewardsDistributor} from "./interfaces/IRewardsDistributor.sol";

/// @notice Minimal fixed-supply ERC-20 for a Loxley coin.
///
///         There is NO transfer tax on the token itself — the 1% is taken in
///         ETH by the v4 hook on swap, which keeps the token fully compatible
///         with the pool. The only special behaviour is a settlement hook: on
///         every balance change we ping the distributor so holder rewards
///         (an ETH accumulator) stay exact.
contract LoxleyToken {
    string public name;
    string public symbol;
    string public uri; // metadata / image
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;

    IRewardsDistributor public immutable distributor;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _uri,
        uint256 _supply,
        address _distributor
    ) {
        name = _name;
        symbol = _symbol;
        uri = _uri;
        totalSupply = _supply;
        distributor = IRewardsDistributor(_distributor);
        // whole supply to the deployer (the factory), which seeds the pool.
        balanceOf[msg.sender] = _supply;
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
        // settle both sides' reward accrual BEFORE balances change.
        distributor.onTokenMove(address(this), from, to);
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
