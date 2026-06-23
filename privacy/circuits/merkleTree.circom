pragma circom 2.1.6;

include "poseidon.circom";

// Computes Poseidon(left, right) where the ordering is chosen by `s`:
//   s == 0  ->  hash(in[0], in[1])   (our leaf/path element is on the left)
//   s == 1  ->  hash(in[1], in[0])   (our leaf/path element is on the right)
template HashLeftRight() {
    signal input in[2];
    signal input s;       // path index bit, constrained boolean
    signal output out;

    s * (1 - s) === 0;    // s must be 0 or 1

    // left  = in[0] + s*(in[1]-in[0])
    // right = in[1] - s*(in[1]-in[0])
    signal diff;
    diff <== in[1] - in[0];

    signal left;
    signal right;
    left  <== in[0] + s * diff;
    right <== in[1] - s * diff;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    out <== hasher.out;
}

// Verifies that `leaf` is a member of a Merkle tree of the given `root`,
// using a Poseidon-based path of length `levels`.
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];   // 0 = current node is left child, 1 = right

    component hashers[levels];
    signal hashes[levels + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        hashers[i] = HashLeftRight();
        hashers[i].in[0] <== hashes[i];
        hashers[i].in[1] <== pathElements[i];
        hashers[i].s     <== pathIndices[i];
        hashes[i + 1] <== hashers[i].out;
    }

    root === hashes[levels];
}
