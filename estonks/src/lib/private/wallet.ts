// The private wallet: finds this wallet's notes in the vault's public events,
// builds spends (proofs made in this browser) and submits them through the
// relay, which pays the gas so no public wallet is linked to the action.
import { encodeAbiParameters, keccak256, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";

import {
  assetId, commitmentOf, ETH, FIELD, keysFromPhrase, noiseNote, nullifierOf, openNote, partialOf, rand, sealNote, Tree,
  type Keys, type Note,
} from "./core";

export const KIND = { transfer: 0, withdraw: 1, buy: 2, sell: 3 } as const;
export const FEE_BPS = 50n;

const noteEvent = parseAbiItem("event Note(uint256 indexed index, uint256 commitment, address asset, uint256 amount, uint256 partialNote, bytes encrypted)");
const spentEvent = parseAbiItem("event Spent(uint256 indexed nullifier)");
const EXT = {
  type: "tuple",
  components: [
    { name: "kind", type: "uint8" }, { name: "recipient", type: "address" }, { name: "relayer", type: "address" }, { name: "relayerFee", type: "uint256" },
    { name: "coin", type: "address" }, { name: "route", type: "bytes" }, { name: "minOut", type: "uint256" },
  ],
} as const;

export interface Ext { kind: number; recipient: Address; relayer: Address; relayerFee: bigint; coin: Address; route: Hex; minOut: bigint }
export interface SpendCall {
  proof: { a: [bigint, bigint]; b: [[bigint, bigint], [bigint, bigint]]; c: [bigint, bigint] };
  pub: { root: bigint; nullifier: [bigint, bigint]; outCommitment: [bigint, bigint]; partialOut: bigint; asset: bigint; publicOut: bigint };
  ext: Ext;
  encrypted: [Hex, Hex, Hex];
}
export interface Recipient { pk: bigint; encPk: Uint8Array }

export const vaultAbi = [
  {
    type: "function", name: "spend", stateMutability: "nonpayable", outputs: [],
    inputs: [
      { name: "proof", type: "tuple", components: [{ name: "a", type: "uint256[2]" }, { name: "b", type: "uint256[2][2]" }, { name: "c", type: "uint256[2]" }] },
      { name: "pub", type: "tuple", components: [{ name: "root", type: "uint256" }, { name: "nullifier", type: "uint256[2]" }, { name: "outCommitment", type: "uint256[2]" }, { name: "partialOut", type: "uint256" }, { name: "asset", type: "uint256" }, { name: "publicOut", type: "uint256" }] },
      { name: "ext", ...EXT },
      { name: "encrypted", type: "bytes[3]" },
    ],
  },
  { type: "function", name: "deposit", stateMutability: "payable", outputs: [], inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "partialNote", type: "uint256" }, { name: "encrypted", type: "bytes" }] },
  { type: "function", name: "root", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "depositsPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "tradesPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "feesOwed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "liabilities", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const extHashOf = (ext: Ext, enc: readonly Hex[]) => BigInt(keccak256(encodeAbiParameters([EXT, { type: "bytes[3]" }], [ext, enc as [Hex, Hex, Hex]]))) % FIELD;

// snarkjs's browser build, loaded once from this site.
let snark: Promise<any> | null = null;
function snarkjs(): Promise<any> {
  snark ??= new Promise((resolve, reject) => {
    if ((window as any).snarkjs) return resolve((window as any).snarkjs);
    const s = document.createElement("script");
    s.src = "/zk/snarkjs.min.js";
    s.onload = () => resolve((window as any).snarkjs);
    s.onerror = () => { snark = null; reject(new Error("Could not load the prover.")); };
    document.head.appendChild(s);
  });
  return snark;
}

export interface Owned extends Note { commitment: bigint; nullifier: bigint }

export class PrivateWallet {
  readonly keys: Keys;
  private tree = new Tree();
  private scannedTo: bigint;
  private opened = new Map<number, Owned>();
  private spentSet = new Set<string>();
  private busy: Promise<void> | null = null;

  constructor(phrase: string, private pc: PublicClient, private logs: PublicClient, private vault: Address, private fromBlock: bigint) {
    this.keys = keysFromPhrase(phrase);
    this.scannedTo = fromBlock - 1n;
  }

  /** Read new vault events and pick out this wallet's notes. */
  sync(): Promise<void> {
    this.busy ??= this.syncInner().finally(() => (this.busy = null));
    return this.busy;
  }

  private async syncInner() {
    const latest = await this.pc.getBlockNumber({ cacheTime: 0 }); // the default cache would miss a note from seconds ago
    const STEP = 5_000n;
    for (let from = this.scannedTo + 1n; from <= latest; from += STEP + 1n) {
      const to = from + STEP > latest ? latest : from + STEP;
      const [notes, spent] = await Promise.all([
        this.logs.getLogs({ address: this.vault, event: noteEvent, fromBlock: from, toBlock: to }),
        this.logs.getLogs({ address: this.vault, event: spentEvent, fromBlock: from, toBlock: to }),
      ]);
      for (const l of notes) {
        const { index, commitment, asset, amount, partialNote, encrypted } = l.args as any;
        const i = Number(index);
        this.tree.leaves[i] = commitment as bigint;
        if (!encrypted || encrypted === "0x") continue;
        const got = await openNote(this.keys.encSk, encrypted as Hex);
        if (!got) continue;
        // A note the vault built (deposit, trade result) carries its asset and amount in the event.
        const a = (amount as bigint) > 0n ? (asset as Address) : got.asset;
        const v = (amount as bigint) > 0n ? (amount as bigint) : got.amount;
        if (v === 0n) continue;
        const partial = partialOf(this.keys.pk, got.blinding);
        if ((amount as bigint) > 0n && partial !== (partialNote as bigint)) continue;
        const c = commitmentOf(a, v, partial);
        if (c !== (commitment as bigint)) continue;
        this.opened.set(i, { asset: a.toLowerCase() as Address, amount: v, blinding: got.blinding, pk: this.keys.pk, index: i, commitment: c, nullifier: nullifierOf(c, i, this.keys.sk) });
      }
      for (const l of spent) this.spentSet.add(String((l.args as any).nullifier));
      this.scannedTo = to;
    }
  }

  notes(asset?: Address): Owned[] {
    return [...this.opened.values()].filter((n) => !this.spentSet.has(String(n.nullifier)) && (!asset || n.asset === asset.toLowerCase()));
  }

  balances(): Map<string, bigint> {
    const m = new Map<string, bigint>();
    for (const n of this.notes()) m.set(n.asset, (m.get(n.asset) ?? 0n) + n.amount);
    return m;
  }

  /** Up to two notes covering `amount`, or null when a merge is needed first. */
  pick(asset: Address, amount: bigint): Owned[] | null {
    const ns = this.notes(asset).sort((x, y) => (x.amount > y.amount ? -1 : 1));
    const total = ns.reduce((s, n) => s + n.amount, 0n);
    if (total < amount) throw new Error("Not enough private balance.");
    const one = [...ns].reverse().find((n) => n.amount >= amount);
    if (one) return [one];
    if (ns[0].amount + ns[1].amount >= amount) return [ns[0], ns[1]];
    return null;
  }

  /** Deposit calldata: the note's partial and its encrypted opening, for this wallet. */
  async depositArgs(asset: Address, amount: bigint): Promise<{ partial: bigint; encrypted: Hex }> {
    const blinding = rand();
    return { partial: partialOf(this.keys.pk, blinding), encrypted: await sealNote(this.keys.encPk, asset, amount, blinding) };
  }

  /**
   * Build a spend: `inputs` (this wallet's notes) into `outputs` plus `publicOut`
   * leaving the notes. For a trade, `result` names the asset the vault will
   * credit to this wallet.
   */
  async build(p: { asset: Address; inputs: Owned[]; outputs: { to: Recipient; amount: bigint }[]; publicOut: bigint; ext: Ext; result?: Address }): Promise<SpendCall> {
    await this.sync();
    const asset = p.asset.toLowerCase() as Address;
    const ins = [...p.inputs];
    while (ins.length < 2) ins.push({ asset, amount: 0n, blinding: rand(), pk: this.keys.pk, index: 0, commitment: 0n, nullifier: 0n });
    const dummies = ins.map((n) => (n.amount === 0n ? commitmentOf(asset, 0n, partialOf(this.keys.pk, n.blinding)) : n.commitment));

    const outs = await Promise.all([0, 1].map(async (i) => {
      const o = p.outputs[i];
      const blinding = rand();
      if (!o || o.amount === 0n) { const pk = rand(); return { amount: 0n, pk, blinding, c: commitmentOf(asset, 0n, partialOf(pk, blinding)), enc: noiseNote() }; }
      return { amount: o.amount, pk: o.to.pk, blinding, c: commitmentOf(asset, o.amount, partialOf(o.to.pk, blinding)), enc: await sealNote(o.to.encPk, asset, o.amount, blinding) };
    }));

    let partialOut = 0n;
    let resultEnc = noiseNote();
    if (p.result) {
      const b = rand();
      partialOut = partialOf(this.keys.pk, b);
      resultEnc = await sealNote(this.keys.encPk, p.result, 0n, b);
    }
    const encrypted: [Hex, Hex, Hex] = [outs[0].enc, outs[1].enc, resultEnc];
    const { root, paths } = this.tree.proofs(ins.map((n) => (n.amount > 0n ? n.index : 0)));
    const nullifier = ins.map((n, i) => nullifierOf(dummies[i], n.amount > 0n ? n.index : 0, this.keys.sk)) as [bigint, bigint];
    const input = {
      root: root.toString(), nullifier: nullifier.map(String), outCommitment: outs.map((o) => o.c.toString()),
      partialOut: partialOut.toString(), asset: assetId(asset).toString(), publicOut: p.publicOut.toString(),
      extDataHash: extHashOf(p.ext, encrypted).toString(), sk: this.keys.sk.toString(),
      inAmount: ins.map((n) => n.amount.toString()), inBlinding: ins.map((n) => n.blinding.toString()),
      inIndex: ins.map((n) => String(n.amount > 0n ? n.index : 0)), inSiblings: paths.map((s) => s.map(String)),
      outAmount: outs.map((o) => o.amount.toString()), outPk: outs.map((o) => o.pk.toString()), outBlinding: outs.map((o) => o.blinding.toString()),
    };
    const { proof } = await (await snarkjs()).groth16.fullProve(input, "/zk/spend.wasm", "/zk/spend.zkey");
    const B = (x: string) => BigInt(x);
    return {
      proof: { a: [B(proof.pi_a[0]), B(proof.pi_a[1])], b: [[B(proof.pi_b[0][1]), B(proof.pi_b[0][0])], [B(proof.pi_b[1][1]), B(proof.pi_b[1][0])]], c: [B(proof.pi_c[0]), B(proof.pi_c[1])] },
      pub: { root, nullifier, outCommitment: [outs[0].c, outs[1].c], partialOut, asset: assetId(asset), publicOut: p.publicOut },
      ext: p.ext, encrypted,
    };
  }

  self(): Recipient { return { pk: this.keys.pk, encPk: this.keys.encPk }; }
}

export const ZERO = ETH;
