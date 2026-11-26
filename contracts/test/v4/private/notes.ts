// Client side of the Estonks private vault: keys, notes, the Merkle tree and
// proof inputs, mirroring circuits/spend.circom and EstonksVault.sol.
import path from "node:path";
import { ethers } from "ethers";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildPoseidon } = require("circomlibjs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs = require("snarkjs");

export const FIELD = 21888242871839275222246405745257275088548364400416711303379718081614746492417n;
export const LEVELS = 20;
export const ETH = ethers.ZeroAddress;
const BUILD = path.join(__dirname, "..", "..", "..", "circuits", "build");
export const WASM = path.join(BUILD, "spend_js", "spend.wasm");
export const ZKEY = path.join(BUILD, "spend.zkey");

export const EXT_T = "tuple(uint8 kind,address recipient,address relayer,uint256 relayerFee,address coin,bytes route,uint256 minOut)";
export const KIND = { transfer: 0, withdraw: 1, buy: 2, sell: 3 } as const;

let P: any;
export async function poseidonReady() { P ??= await buildPoseidon(); }
export const H = (...xs: bigint[]): bigint => BigInt(P.F.toString(P(xs)));

export const rand = (): bigint => BigInt(ethers.hexlify(ethers.randomBytes(31)));
export const assetId = (a: string): bigint => BigInt(a);

export interface Keys { sk: bigint; pk: bigint }
export const newKeys = (): Keys => { const sk = rand(); return { sk, pk: H(sk) }; };

export interface Note { asset: bigint; amount: bigint; blinding: bigint; pk: bigint; index?: number }
export const partialOf = (pk: bigint, blinding: bigint) => H(pk, blinding);
export const commitmentOf = (n: Note) => H(n.asset, n.amount, partialOf(n.pk, n.blinding));
export const nullifierOf = (n: Note, sk: bigint) => H(commitmentOf(n), BigInt(n.index ?? 0), sk);

/** Mirror of the vault's append-only tree (leaves appended two at a time). */
export class Tree {
  zeros: bigint[] = [];
  leaves: bigint[] = [];
  constructor() {
    let z = BigInt(ethers.keccak256(ethers.toUtf8Bytes("estonks.vault.empty"))) % FIELD;
    for (let i = 0; i <= LEVELS; i++) { this.zeros.push(z); z = H(z, z); }
  }
  insert(...ls: bigint[]) { this.leaves.push(...ls); }
  private level(nodes: bigint[], lvl: number): bigint[] {
    const out: bigint[] = [];
    for (let i = 0; i < nodes.length; i += 2) out.push(H(nodes[i], i + 1 < nodes.length ? nodes[i + 1] : this.zeros[lvl]));
    return out;
  }
  root(): bigint {
    let nodes = this.leaves;
    for (let lvl = 0; lvl < LEVELS; lvl++) nodes = nodes.length ? this.level(nodes, lvl) : [];
    return nodes.length ? nodes[0] : this.zeros[LEVELS];
  }
  path(index: number): bigint[] {
    const sib: bigint[] = [];
    let nodes = this.leaves, idx = index;
    for (let lvl = 0; lvl < LEVELS; lvl++) {
      const s = idx ^ 1;
      sib.push(s < nodes.length ? nodes[s] : this.zeros[lvl]);
      nodes = this.level(nodes, lvl);
      idx >>= 1;
    }
    return sib;
  }
}

export interface SpendPlan {
  keys: Keys;
  asset: string;
  inputs: Note[]; // 0..2 real notes owned by keys
  outputs: Note[]; // 0..2 new notes
  publicOut: bigint;
  partialOut: bigint; // trade result partial (0 if none)
  ext: { kind: number; recipient: string; relayer: string; relayerFee: bigint; coin: string; route: string; minOut: bigint };
  encrypted: [string, string, string];
}

export const extHashOf = (ext: SpendPlan["ext"], enc: string[]) =>
  BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([EXT_T, "bytes[3]"], [ext, enc]))) % FIELD;

/** Build the proof and the vault's calldata for a spend. */
export async function prove(tree: Tree, p: SpendPlan) {
  const asset = assetId(p.asset);
  const ins: Note[] = [...p.inputs];
  while (ins.length < 2) ins.push({ asset, amount: 0n, blinding: rand(), pk: p.keys.pk, index: 0 });
  const outs: Note[] = [...p.outputs];
  while (outs.length < 2) outs.push({ asset, amount: 0n, blinding: rand(), pk: rand() });
  const root = tree.root();
  const extDataHash = extHashOf(p.ext, p.encrypted);
  const input = {
    root: root.toString(),
    nullifier: ins.map((n) => nullifierOf(n, p.keys.sk).toString()),
    outCommitment: outs.map((n) => commitmentOf(n).toString()),
    partialOut: p.partialOut.toString(),
    asset: asset.toString(),
    publicOut: p.publicOut.toString(),
    extDataHash: extDataHash.toString(),
    sk: p.keys.sk.toString(),
    inAmount: ins.map((n) => n.amount.toString()),
    inBlinding: ins.map((n) => n.blinding.toString()),
    inIndex: ins.map((n) => String(n.index ?? 0)),
    inSiblings: ins.map((n) => (n.amount > 0n ? tree.path(n.index!) : tree.path(0)).map(String)),
    outAmount: outs.map((n) => n.amount.toString()),
    outPk: outs.map((n) => n.pk.toString()),
    outBlinding: outs.map((n) => n.blinding.toString()),
  };
  const { proof } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  return {
    proof: {
      a: [proof.pi_a[0], proof.pi_a[1]],
      b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
      c: [proof.pi_c[0], proof.pi_c[1]],
    },
    pub: {
      root, nullifier: input.nullifier.map(BigInt), outCommitment: input.outCommitment.map(BigInt),
      partialOut: p.partialOut, asset, publicOut: p.publicOut,
    },
    ext: p.ext,
    encrypted: p.encrypted,
    outs,
  };
}
