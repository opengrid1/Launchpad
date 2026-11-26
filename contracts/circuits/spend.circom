pragma circom 2.1.9;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/switcher.circom";

// Estonks private vault: one spend of up to two notes into up to two new notes,
// plus an amount that leaves the notes publicly (a withdrawal, a private trade's
// input, or a relayer fee).
//
//   owner key     pk         = Poseidon(sk)
//   partial note  partial    = Poseidon(pk, blinding)          hides the owner
//   note          commitment = Poseidon(asset, amount, partial)
//   nullifier                = Poseidon(commitment, leafIndex, sk)
//
// A private trade's result is not known when the proof is made, so the prover
// commits only to the partial note of the result (`partialOut`); the vault
// finishes the note on chain from the amount the trade actually returned.
//
// Every input and output note is of one asset. An input with amount 0 is a
// dummy: its Merkle membership is not checked, but its nullifier is still
// published, so dummies must use fresh random blindings.

// Merkle root of `leaf` at `index` for a Poseidon(2) tree of `levels`.
template MerkleRoot(levels) {
    signal input leaf;
    signal input index;
    signal input siblings[levels];
    signal output root;

    component bits = Num2Bits(levels);
    bits.in <== index;

    component sw[levels];
    component h[levels];
    signal node[levels + 1];
    node[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        sw[i] = Switcher();
        sw[i].sel <== bits.out[i];
        sw[i].L <== node[i];
        sw[i].R <== siblings[i];
        h[i] = Poseidon(2);
        h[i].inputs[0] <== sw[i].outL;
        h[i].inputs[1] <== sw[i].outR;
        node[i + 1] <== h[i].out;
    }
    root <== node[levels];
}

template Spend(levels) {
    // Public.
    signal input root;
    signal input nullifier[2];
    signal input outCommitment[2];
    signal input partialOut;
    signal input asset;
    signal input publicOut;
    signal input extDataHash;

    // Private.
    signal input sk;
    signal input inAmount[2];
    signal input inBlinding[2];
    signal input inIndex[2];
    signal input inSiblings[2][levels];
    signal input outAmount[2];
    signal input outPk[2];
    signal input outBlinding[2];

    component pk = Poseidon(1);
    pk.inputs[0] <== sk;

    component inPartial[2];
    component inNote[2];
    component inNull[2];
    component inTree[2];
    component inRange[2];
    component isDummy[2];
    for (var i = 0; i < 2; i++) {
        inRange[i] = Num2Bits(248);
        inRange[i].in <== inAmount[i];

        inPartial[i] = Poseidon(2);
        inPartial[i].inputs[0] <== pk.out;
        inPartial[i].inputs[1] <== inBlinding[i];

        inNote[i] = Poseidon(3);
        inNote[i].inputs[0] <== asset;
        inNote[i].inputs[1] <== inAmount[i];
        inNote[i].inputs[2] <== inPartial[i].out;

        inNull[i] = Poseidon(3);
        inNull[i].inputs[0] <== inNote[i].out;
        inNull[i].inputs[1] <== inIndex[i];
        inNull[i].inputs[2] <== sk;
        inNull[i].out === nullifier[i];

        inTree[i] = MerkleRoot(levels);
        inTree[i].leaf <== inNote[i].out;
        inTree[i].index <== inIndex[i];
        for (var j = 0; j < levels; j++) inTree[i].siblings[j] <== inSiblings[i][j];

        // Membership is required unless the note is a zero-amount dummy.
        isDummy[i] = IsZero();
        isDummy[i].in <== inAmount[i];
        (inTree[i].root - root) * (1 - isDummy[i].out) === 0;
    }

    // The two inputs must be different notes.
    component same = IsEqual();
    same.in[0] <== nullifier[0];
    same.in[1] <== nullifier[1];
    same.out === 0;

    component outPartial[2];
    component outNote[2];
    component outRange[2];
    for (var i = 0; i < 2; i++) {
        outRange[i] = Num2Bits(248);
        outRange[i].in <== outAmount[i];

        outPartial[i] = Poseidon(2);
        outPartial[i].inputs[0] <== outPk[i];
        outPartial[i].inputs[1] <== outBlinding[i];

        outNote[i] = Poseidon(3);
        outNote[i].inputs[0] <== asset;
        outNote[i].inputs[1] <== outAmount[i];
        outNote[i].inputs[2] <== outPartial[i].out;
        outNote[i].out === outCommitment[i];
    }

    component pubRange = Num2Bits(248);
    pubRange.in <== publicOut;

    // Value is conserved: what goes in comes out as new notes or leaves publicly.
    inAmount[0] + inAmount[1] === outAmount[0] + outAmount[1] + publicOut;

    // Bind the public values that no other constraint touches, so a relayer
    // cannot alter them without invalidating the proof.
    signal partialSq <== partialOut * partialOut;
    signal extSq <== extDataHash * extDataHash;
}

component main {public [root, nullifier, outCommitment, partialOut, asset, publicOut, extDataHash]} = Spend(20);
