// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The part of the Wormhole Core Bridge HypexBridge uses (Elysium 0xC8aD24fC6063c41cB5C12a8e3851AafC3b3CF027,
///         Wormhole chain 74; HyperEVM 0x7C0faFc4384551f063e05aee704ab943b8B53aB3, Wormhole chain 47).
interface IWormhole {
    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint8 guardianIndex;
    }

    struct VM {
        uint8 version;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
        uint32 guardianSetIndex;
        Signature[] signatures;
        bytes32 hash;
    }

    function publishMessage(uint32 nonce, bytes memory payload, uint8 consistencyLevel)
        external
        payable
        returns (uint64 sequence);

    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        returns (VM memory vm, bool valid, string memory reason);

    function messageFee() external view returns (uint256);

    function chainId() external view returns (uint16);
}
