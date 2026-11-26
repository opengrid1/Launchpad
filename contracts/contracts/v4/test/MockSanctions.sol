// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Test stand-in for the Chainalysis sanctions oracle.
contract MockSanctions {
    mapping(address => bool) public isSanctioned;

    function set(address who, bool value) external {
        isSanctioned[who] = value;
    }
}
