pragma circom 2.1.6;

include "poseidon.circom";
include "merkleTree.circom";

// Shielded-pool withdrawal circuit (Tornado-style, Poseidon variant).
//
// A note is defined by two secret field elements (nullifier, secret).
//   commitment   = Poseidon(nullifier, secret)   -> stored as a leaf on deposit
//   nullifierHash = Poseidon(nullifier)          -> revealed on withdraw, prevents double-spend
//
// The proof shows: "I know a (nullifier, secret) whose commitment is in the tree
// with this public root, and here is its nullifierHash" — without revealing which leaf.
//
// recipient / relayer / fee / refund are public inputs that are NOT used in any
// hash; they are bound into the proof via dummy quadratic constraints so that the
// proof is non-malleable (an observer can't re-target a valid proof to a new
// recipient or change the fee).
template Withdraw(levels) {
    signal input root;            // public
    signal input nullifierHash;   // public
    signal input recipient;       // public
    signal input relayer;         // public
    signal input fee;             // public
    signal input refund;          // public

    signal input nullifier;       // private
    signal input secret;          // private
    signal input pathElements[levels];  // private
    signal input pathIndices[levels];   // private

    // commitment = Poseidon(nullifier, secret)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;

    // nullifierHash = Poseidon(nullifier)
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash === nullifierHasher.out;

    // Membership proof for the commitment.
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitmentHasher.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i]  <== pathIndices[i];
    }

    // Bind public signals into the proof (non-malleability). These add no logic
    // but force the prover to commit to exact values; the optimizer can't drop them.
    signal recipientSquare;
    signal relayerSquare;
    signal feeSquare;
    signal refundSquare;
    recipientSquare <== recipient * recipient;
    relayerSquare   <== relayer * relayer;
    feeSquare       <== fee * fee;
    refundSquare    <== refund * refund;
}

component main {public [root, nullifierHash, recipient, relayer, fee, refund]} = Withdraw(20);
