// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test stand-ins for Base's B20 precompiles, which a hardhat fork
///         cannot run. Tests deploy these, then copy the factory and registry
///         runtime code to the real precompile addresses with hardhat_setCode.

/// @dev Stand-in for the B20 factory precompile: only isB20, set per token.
contract MockB20FactoryView {
    mapping(address => bool) public isB20;

    function setB20(address token, bool on) external {
        isB20[token] = on;
    }
}

/// @dev Stand-in for the Policy Registry: id 0 allows everyone; any other id
///      is an allowlist (kind 1) or a blocklist (kind 2).
contract MockPolicyRegistry {
    mapping(uint64 => uint8) public kind;
    mapping(uint64 => mapping(address => bool)) public listed;

    function setPolicy(uint64 id, uint8 k) external {
        kind[id] = k;
    }

    function setListed(uint64 id, address[] calldata accounts, bool on) external {
        for (uint256 i; i < accounts.length; i++) listed[id][accounts[i]] = on;
    }

    function isAuthorized(uint64 id, address account) external view returns (bool) {
        if (id == 0) return true;
        uint8 k = kind[id];
        if (k == 1) return listed[id][account];
        if (k == 2) return !listed[id][account];
        return false;
    }
}

/// @dev A B20-like token: ERC-20 that enforces a transfer pause and the three
///      transfer policy scopes through the registry at the precompile address.
contract MockB20Token is ERC20 {
    address internal constant REGISTRY = 0x8453000000000000000000000000000000000002;
    bytes32 internal constant SENDER = keccak256("TRANSFER_SENDER_POLICY");
    bytes32 internal constant RECEIVER = keccak256("TRANSFER_RECEIVER_POLICY");
    bytes32 internal constant EXECUTOR = keccak256("TRANSFER_EXECUTOR_POLICY");

    error ContractPaused(uint8 feature);
    error PolicyForbids(bytes32 scope, uint64 policyId);

    mapping(bytes32 => uint64) public policyId;
    bool public transfersPaused;

    constructor(string memory n, string memory s, uint256 supply) ERC20(n, s) {
        _mint(msg.sender, supply);
    }

    function isPaused(uint8 feature) external view returns (bool) {
        return feature == 0 && transfersPaused;
    }

    function setPaused(bool on) external {
        transfersPaused = on;
    }

    function updatePolicy(bytes32 scope, uint64 id) external {
        policyId[scope] = id;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (transfersPaused) revert ContractPaused(0);
            _gate(SENDER, from);
            _gate(RECEIVER, to);
            _gate(EXECUTOR, msg.sender);
        }
        super._update(from, to, value);
    }

    function _gate(bytes32 scope, address account) private view {
        uint64 id = policyId[scope];
        if (id != 0 && !MockPolicyRegistry(REGISTRY).isAuthorized(id, account)) revert PolicyForbids(scope, id);
    }
}
