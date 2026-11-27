// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice EIP-1167 minimal proxies at CREATE2 addresses
library Clones {
    error CloneFailed();

    function cloneDeterministic(address impl, bytes32 salt) internal returns (address inst) {
        assembly {
            mstore(0x00, or(shr(0xe8, shl(0x60, impl)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            mstore(0x20, or(shl(0x78, impl), 0x5af43d82803e903d91602b57fd5bf3))
            inst := create2(0, 0x09, 0x37, salt)
        }
        if (inst == address(0)) revert CloneFailed();
    }

    function predict(address impl, bytes32 salt, address deployer) internal pure returns (address) {
        bytes32 code = keccak256(
            abi.encodePacked(hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", impl, hex"5af43d82803e903d91602b57fd5bf3")
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, code)))));
    }
}
