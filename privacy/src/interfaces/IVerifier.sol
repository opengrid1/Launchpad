// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Groth16 verifier interface, matching the snarkjs-generated Verifier.
/// Public signals are [root, nullifierHash, recipient, relayer, fee, refund].
interface IVerifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[6] calldata input
    ) external view returns (bool);
}
