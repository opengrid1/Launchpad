// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IHasher} from "./interfaces/IHasher.sol";

/// @notice Append-only incremental Merkle tree with a rolling window of recent
/// roots, hashed with Poseidon. Mirrors Tornado's design but uses Poseidon (via
/// an external hasher) instead of MiMC. A withdrawal may reference any root from
/// the last ROOT_HISTORY_SIZE updates, so it stays valid even as others deposit.
contract MerkleTreeWithHistory {
    // BN254 scalar field. All leaves/roots live in this field.
    uint256 internal constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // ZERO_VALUE = uint256(keccak256("launchpad-privacy")) % FIELD_SIZE.
    // Must match ZERO_VALUE in js/lib.js exactly.
    uint256 internal constant ZERO_VALUE =
        21246759419405332465520188860141733587548810565578933042550028263297341952858;

    uint32 public constant ROOT_HISTORY_SIZE = 30;

    IHasher public immutable hasher;
    uint32 public immutable levels;

    // The "empty subtree" root at each height, derived from ZERO_VALUE.
    mapping(uint256 => uint256) public zeros;
    // The left-hand siblings needed to extend the tree as it fills.
    mapping(uint256 => uint256) public filledSubtrees;
    // Rolling history of recent roots.
    mapping(uint256 => uint256) public roots;

    uint32 public currentRootIndex;
    uint32 public nextIndex;

    constructor(uint32 _levels, IHasher _hasher) {
        require(_levels > 0 && _levels < 32, "bad levels");
        levels = _levels;
        hasher = _hasher;

        // Derive zeros[i] = root of an all-empty subtree of height i, and seed
        // filledSubtrees so the first insert hashes against empty siblings.
        uint256 current = ZERO_VALUE;
        zeros[0] = current;
        filledSubtrees[0] = current;
        for (uint32 i = 1; i < _levels; i++) {
            current = _hashLeftRight(current, current);
            zeros[i] = current;
            filledSubtrees[i] = current;
        }
        roots[0] = _hashLeftRight(current, current);
    }

    function _hashLeftRight(uint256 left, uint256 right) internal view returns (uint256) {
        require(left < FIELD_SIZE, "left oob");
        require(right < FIELD_SIZE, "right oob");
        return hasher.poseidon([left, right]);
    }

    /// @dev Inserts `leaf` and returns its index. Updates the rolling root.
    function _insert(uint256 leaf) internal returns (uint32 index) {
        uint32 _nextIndex = nextIndex;
        require(_nextIndex != uint32(2) ** levels, "tree full");
        require(leaf < FIELD_SIZE, "leaf oob");

        uint32 currentIndex = _nextIndex;
        uint256 currentHash = leaf;
        uint256 left;
        uint256 right;

        for (uint32 i = 0; i < levels; i++) {
            if (currentIndex % 2 == 0) {
                // current node is a left child; its right sibling is still empty
                left = currentHash;
                right = zeros[i];
                filledSubtrees[i] = currentHash;
            } else {
                // current node is a right child; the left sibling was filled earlier
                left = filledSubtrees[i];
                right = currentHash;
            }
            currentHash = _hashLeftRight(left, right);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentHash;
        nextIndex = _nextIndex + 1;
        return _nextIndex;
    }

    /// @notice True if `root` is one of the last ROOT_HISTORY_SIZE roots.
    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        uint32 _current = currentRootIndex;
        uint32 i = _current;
        do {
            if (root == roots[i]) return true;
            if (i == 0) i = ROOT_HISTORY_SIZE;
            i--;
        } while (i != _current);
        return false;
    }

    /// @notice The most recent root.
    function getLastRoot() public view returns (uint256) {
        return roots[currentRootIndex];
    }
}
