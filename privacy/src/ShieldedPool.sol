// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";
import {IComplianceGate} from "./interfaces/IComplianceGate.sol";

/// @title ShieldedPool
/// @notice Fixed-denomination ETH privacy pool. Deposit a note commitment with
/// exactly `denomination` ETH; later withdraw to any address by proving, in
/// zero knowledge, that you own a commitment in the tree — without revealing
/// which one. A per-note nullifier prevents double spends.
///
/// Privacy comes from the anonymity set (how many deposits share your
/// denomination), NOT from the ZK proof alone: with a single depositor the
/// deposit→withdrawal link is trivial. Use a fresh recipient address and wait
/// for the set to grow before withdrawing.
contract ShieldedPool is MerkleTreeWithHistory {
    IVerifier public immutable verifier;
    uint256 public immutable denomination;

    /// Optional deposit screening. address(0) == screening disabled (pure mixer).
    IComplianceGate public complianceGate;
    address public owner;

    mapping(uint256 => bool) public nullifierHashes; // spent notes
    mapping(uint256 => bool) public commitments; // seen commitments

    event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event Withdrawal(address indexed to, uint256 indexed nullifierHash, address indexed relayer, uint256 fee);
    event ComplianceGateUpdated(address indexed gate);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // Minimal non-reentrancy guard.
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(
        IVerifier _verifier,
        IHasher _hasher,
        uint256 _denomination,
        uint32 _levels,
        IComplianceGate _gate,
        address _owner
    ) MerkleTreeWithHistory(_levels, _hasher) {
        require(_denomination > 0, "zero denomination");
        verifier = _verifier;
        denomination = _denomination;
        complianceGate = _gate;
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

    /// @notice Deposit exactly `denomination` ETH against a note `commitment`
    /// (= Poseidon(nullifier, secret), computed off-chain). The commitment is a
    /// public hash; the preimage is the secret you keep to withdraw later.
    function deposit(uint256 commitment) external payable nonReentrant {
        require(msg.value == denomination, "wrong denomination");
        require(commitment < FIELD_SIZE, "commitment oob");
        require(!commitments[commitment], "commitment used");

        IComplianceGate gate = complianceGate;
        if (address(gate) != address(0)) {
            require(gate.isAllowed(msg.sender), "not allowed");
        }

        commitments[commitment] = true;
        uint32 index = _insert(commitment);
        emit Deposit(commitment, index, block.timestamp);
    }

    /// @notice Withdraw `denomination - fee` ETH to `recipient`, paying `fee` to
    /// `relayer`, by proving ownership of an unspent note. `root` must be a
    /// recent tree root and `nullifierHash` must be unused.
    /// @param refund must be 0 for this native-ETH pool (kept as a bound public
    /// signal for circuit compatibility with token pools).
    function withdraw(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint256 root,
        uint256 nullifierHash,
        address payable recipient,
        address payable relayer,
        uint256 fee,
        uint256 refund
    ) external nonReentrant {
        require(fee <= denomination, "fee too high");
        require(refund == 0, "refund unsupported");
        require(!nullifierHashes[nullifierHash], "note spent");
        require(isKnownRoot(root), "unknown root");

        uint[6] memory input = [
            root,
            nullifierHash,
            uint256(uint160(address(recipient))),
            uint256(uint160(address(relayer))),
            fee,
            refund
        ];
        require(verifier.verifyProof(a, b, c, input), "bad proof");

        nullifierHashes[nullifierHash] = true;

        uint256 amount = denomination - fee;
        (bool okR,) = recipient.call{value: amount}("");
        require(okR, "recipient transfer failed");
        if (fee > 0) {
            (bool okF,) = relayer.call{value: fee}("");
            require(okF, "fee transfer failed");
        }

        emit Withdrawal(recipient, nullifierHash, relayer, fee);
    }

    /// @notice True if a note with this nullifierHash has already been withdrawn.
    function isSpent(uint256 nullifierHash) external view returns (bool) {
        return nullifierHashes[nullifierHash];
    }

    // --- admin: only swaps the screening policy, never touches user funds ---

    function setComplianceGate(IComplianceGate _gate) external onlyOwner {
        complianceGate = _gate;
        emit ComplianceGateUpdated(address(_gate));
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
