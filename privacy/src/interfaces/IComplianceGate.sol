// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Pluggable deposit screening (Privacy-Pools / 0xbow style). The pool
/// asks the gate whether a depositor may enter. Swap in different gates without
/// touching the pool: a fixed allowlist, an attestation reader (Coinbase EAS,
/// Binance BABT), or an association-set provider. Setting the gate to address(0)
/// disables screening entirely (pure mixer mode).
interface IComplianceGate {
    /// @return true if `depositor` is permitted to deposit into the pool.
    function isAllowed(address depositor) external view returns (bool);
}
