// Shared helpers: Poseidon hashing, the zero subtree values, and a JS mirror of
// the on-chain incremental Merkle tree. Kept dependency-light so the same logic
// drives both fixture generation and the deploy/relayer scripts.
const { buildPoseidon } = require("circomlibjs");

const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ZERO_VALUE must match ShieldedPool's ZERO_VALUE constant exactly.
// = uint256(keccak256("launchpad-privacy")) % FIELD_SIZE, precomputed below.
const ZERO_VALUE =
  21246759419405332465520188860141733587548810565578933042550028263297341952858n;

let _poseidon = null;
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

// Poseidon over field elements, returned as a bigint.
async function poseidon(inputs) {
  const p = await getPoseidon();
  const out = p(inputs.map((x) => BigInt(x)));
  return p.F.toObject(out);
}

// Precompute zeros[i] = the root of an all-empty subtree of height i.
async function computeZeros(levels) {
  const zeros = [ZERO_VALUE];
  for (let i = 1; i < levels; i++) {
    zeros.push(await poseidon([zeros[i - 1], zeros[i - 1]]));
  }
  return zeros;
}

// Minimal append-only Merkle tree matching the contract's insertion order.
class MerkleTree {
  constructor(levels, zeros) {
    this.levels = levels;
    this.zeros = zeros;
    this.leaves = [];
  }
  insert(leaf) {
    this.leaves.push(BigInt(leaf));
    return this.leaves.length - 1;
  }
  async _layer(nodes, height) {
    if (nodes.length === 0) return [this.zeros[height]];
    const out = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i];
      const right = i + 1 < nodes.length ? nodes[i + 1] : this.zeros[height];
      out.push(await poseidon([left, right]));
    }
    return out;
  }
  // Returns { root, pathElements, pathIndices } for the leaf at `index`.
  async path(index) {
    const pathElements = [];
    const pathIndices = [];
    let nodes = this.leaves.slice();
    let idx = index;
    for (let h = 0; h < this.levels; h++) {
      const isRight = idx % 2;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      const sibling =
        siblingIdx < nodes.length ? nodes[siblingIdx] : this.zeros[h];
      pathElements.push(sibling);
      pathIndices.push(isRight);
      nodes = await this._layer(nodes, h);
      idx = Math.floor(idx / 2);
    }
    return { root: nodes[0], pathElements, pathIndices };
  }
}

module.exports = { FIELD_SIZE, ZERO_VALUE, getPoseidon, poseidon, computeZeros, MerkleTree };
