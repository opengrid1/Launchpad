// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Launch-time checks for B20 tokens, Base's native token standard.
/// @dev A B20 token is ERC-20 compatible, but its issuer can pause transfers
///      and gate who may send, receive or execute them through policies held
///      in the Policy Registry. A coin paired with (or paying rewards in) a B20
///      token only works if Anypair's own contracts can move it, so a launch
///      checks that up front. Issuers can still change their rules later; that
///      is a property of the asset, not something a launchpad can prevent.
///
///      The B20 factory precompile has no bytecode, so it is reached with a raw
///      staticcall: on a chain without it the call returns nothing and the
///      token is treated as a plain ERC-20. Once a token is known to be B20,
///      any failed read fails closed.
library B20Check {
    address internal constant FACTORY = 0xB20f000000000000000000000000000000000000;
    address internal constant POLICY_REGISTRY = 0x8453000000000000000000000000000000000002;

    bytes32 internal constant TRANSFER_SENDER_POLICY = keccak256("TRANSFER_SENDER_POLICY");
    bytes32 internal constant TRANSFER_RECEIVER_POLICY = keccak256("TRANSFER_RECEIVER_POLICY");
    bytes32 internal constant TRANSFER_EXECUTOR_POLICY = keccak256("TRANSFER_EXECUTOR_POLICY");
    /// @dev IB20.PausableFeature.TRANSFER
    uint8 internal constant FEATURE_TRANSFER = 0;

    error B20Restricted(address token);

    /// @notice Whether `token` is a B20 token. Never reverts.
    function isB20(address token) internal view returns (bool) {
        (bool ok, bytes memory r) = FACTORY.staticcall(abi.encodeWithSignature("isB20(address)", token));
        return ok && r.length >= 32 && abi.decode(r, (bool));
    }

    /// @notice Reverts if `token` is a B20 token whose transfers are paused, or
    ///         whose transfer policies don't authorize every one of `parties` as
    ///         sender, receiver and executor. Plain ERC-20s pass untouched.
    function requireOpen(address token, address[] memory parties) internal view {
        if (!isB20(token)) return;
        if (_read(token, abi.encodeWithSignature("isPaused(uint8)", FEATURE_TRANSFER), token) != 0) revert B20Restricted(token);
        bytes32[3] memory scopes = [TRANSFER_SENDER_POLICY, TRANSFER_RECEIVER_POLICY, TRANSFER_EXECUTOR_POLICY];
        for (uint256 s; s < 3; s++) {
            uint256 id = _read(token, abi.encodeWithSignature("policyId(bytes32)", scopes[s]), token);
            if (id == 0) continue; // ALWAYS_ALLOW
            for (uint256 i; i < parties.length; i++) {
                if (_read(POLICY_REGISTRY, abi.encodeWithSignature("isAuthorized(uint64,address)", uint64(id), parties[i]), token) != 1) {
                    revert B20Restricted(token);
                }
            }
        }
    }

    /// @dev One-word view call; reverts B20Restricted(token) if it fails or returns nothing.
    function _read(address target, bytes memory data, address token) private view returns (uint256 v) {
        (bool ok, bytes memory r) = target.staticcall(data);
        if (!ok || r.length < 32) revert B20Restricted(token);
        v = abi.decode(r, (uint256));
    }
}
