// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IComplianceGate} from "./interfaces/IComplianceGate.sol";

/// @notice Simplest compliance gate: an owner-managed allowlist. Stand-in for a
/// real screening provider — in production you'd point the pool at a gate that
/// reads attestations (Coinbase EAS, Binance BABT) or an association-set root.
contract AllowlistGate is IComplianceGate {
    address public owner;
    mapping(address => bool) public allowed;

    event Allowed(address indexed account, bool status);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _owner) {
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

    function isAllowed(address depositor) external view returns (bool) {
        return allowed[depositor];
    }

    function setAllowed(address account, bool status) external onlyOwner {
        allowed[account] = status;
        emit Allowed(account, status);
    }

    function setAllowedBatch(address[] calldata accounts, bool status) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            allowed[accounts[i]] = status;
            emit Allowed(accounts[i], status);
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
