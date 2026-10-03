// The private wallet's cryptography: keys from a recovery phrase, the passphrase
// vault in this browser, note encryption, notes, and the Merkle tree. Mirrors
// contracts/circuits/spend.circom and EstonksVault.sol.
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite";
import { x25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { bytesToHex, concat, hexToBytes, keccak256, toBytes, type Address, type Hex } from "viem";

export const FIELD = 21888242871839275222246405745257275088548364400416711303379718081614746492417n;
export const LEVELS = 20;
export const ETH = "0x0000000000000000000000000000000000000000" as Address;

const u8 = (s: string) => new TextEncoder().encode(s);
const toBig = (b: Uint8Array) => BigInt(bytesToHex(b));
const to32 = (v: bigint) => hexToBytes(`0x${v.toString(16).padStart(64, "0")}`);
const rand31 = () => toBig(crypto.getRandomValues(new Uint8Array(31)));
export const rand = rand31;

// -- keys -------------------------------------------------------------------

export interface Keys {
  sk: bigint; // spending secret
  pk: bigint; // owner key, Poseidon(sk)
  encSk: Uint8Array; // x25519 secret for reading notes
  encPk: Uint8Array;
}

export const newPhrase = () => generateMnemonic(wordlist, 256);
export const validPhrase = (p: string) => validateMnemonic(p.trim().toLowerCase().replace(/\s+/g, " "), wordlist);

export function keysFromPhrase(phrase: string): Keys {
  const seed = mnemonicToSeedSync(phrase.trim().toLowerCase().replace(/\s+/g, " "));
  const sk = toBig(sha256(concat([u8("estonks.private.spend"), seed]))) % FIELD;
  const encSk = sha256(concat([u8("estonks.private.read"), seed]));
  return { sk, pk: poseidon1([sk]), encSk, encPk: x25519.getPublicKey(encSk) };
}

/** A private address others can send to: owner key and reading key, 64 bytes. */
export const privateAddress = (k: Keys) => `ep1${bytesToHex(concat([to32(k.pk), k.encPk])).slice(2)}`;
export function parsePrivateAddress(a: string): { pk: bigint; encPk: Uint8Array } | null {
  const m = /^ep1([0-9a-f]{128})$/i.exec(a.trim());
  if (!m) return null;
  const b = hexToBytes(`0x${m[1]}`);
  const pk = toBig(b.slice(0, 32));
  return pk < FIELD ? { pk, encPk: b.slice(32) } : null;
}

// -- passphrase vault (localStorage) ----------------------------------------

const STORE = "estonks-private-v1";
export const hasVault = () => { try { return !!localStorage.getItem(STORE); } catch { return false; } };
export const clearVault = () => { try { localStorage.removeItem(STORE); } catch { /* ignore */ } };

async function passKey(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", u8(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealPhrase(phrase: string, pass: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await passKey(pass, salt), u8(phrase)));
  localStorage.setItem(STORE, JSON.stringify({ v: 1, salt: bytesToHex(salt), iv: bytesToHex(iv), data: bytesToHex(data) }));
}

export async function openPhrase(pass: string): Promise<string> {
  const raw = localStorage.getItem(STORE);
  if (!raw) throw new Error("No private wallet in this browser.");
  const v = JSON.parse(raw);
  try {
    const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(v.iv) }, await passKey(pass, hexToBytes(v.salt)), hexToBytes(v.data));
    return new TextDecoder().decode(out);
  } catch {
    throw new Error("Wrong passphrase.");
  }
}

// -- note encryption: x25519 + AES-GCM ----------------------------------------
// payload: asset (20) | amount (32) | blinding (32). A trade result's amount is
// unknown when it is encrypted; the vault's event carries it instead.

async function aesKey(shared: Uint8Array, eph: Uint8Array) {
  return crypto.subtle.importKey("raw", sha256(concat([shared, eph])), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealNote(encPk: Uint8Array, asset: Address, amount: bigint, blinding: bigint): Promise<Hex> {
  const eph = x25519.utils.randomPrivateKey();
  const ephPk = x25519.getPublicKey(eph);
  const key = await aesKey(x25519.getSharedSecret(eph, encPk), ephPk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, concat([hexToBytes(asset), to32(amount), to32(blinding)])));
  return bytesToHex(concat([ephPk, iv, ct]));
}

export async function openNote(encSk: Uint8Array, blob: Hex): Promise<{ asset: Address; amount: bigint; blinding: bigint } | null> {
  const b = hexToBytes(blob);
  if (b.length !== 32 + 12 + 84 + 16) return null;
  try {
    const key = await aesKey(x25519.getSharedSecret(encSk, b.slice(0, 32)), b.slice(0, 32));
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(32, 44) }, key, b.slice(44)));
    return { asset: bytesToHex(pt.slice(0, 20)) as Address, amount: toBig(pt.slice(20, 52)), blinding: toBig(pt.slice(52, 84)) };
  } catch {
    return null;
  }
}

/** Filler for an encrypted slot nobody needs to read, the same size as a real one. */
export const noiseNote = (): Hex => bytesToHex(crypto.getRandomValues(new Uint8Array(32 + 12 + 84 + 16)));

// -- notes ----------------------------------------------------------------------

export interface Note { asset: Address; amount: bigint; blinding: bigint; pk: bigint; index: number }
export const assetId = (a: Address) => BigInt(a);
export const partialOf = (pk: bigint, blinding: bigint) => poseidon2([pk, blinding]);
export const commitmentOf = (asset: Address, amount: bigint, partial: bigint) => poseidon3([assetId(asset), amount, partial]);
export const nullifierOf = (commitment: bigint, index: number, sk: bigint) => poseidon3([commitment, BigInt(index), sk]);

// -- tree -------------------------------------------------------------------------

export class Tree {
  zeros: bigint[] = [];
  leaves: bigint[] = [];
  constructor() {
    let z = BigInt(keccak256(toBytes("estonks.vault.empty"))) % FIELD;
    for (let i = 0; i <= LEVELS; i++) { this.zeros.push(z); z = poseidon2([z, z]); }
  }
  private up(nodes: bigint[], lvl: number) {
    const out: bigint[] = [];
    for (let i = 0; i < nodes.length; i += 2) out.push(poseidon2([nodes[i], i + 1 < nodes.length ? nodes[i + 1] : this.zeros[lvl]]));
    return out;
  }
  /** Root and the sibling paths for `indices`, in one pass. */
  proofs(indices: number[]): { root: bigint; paths: bigint[][] } {
    const paths = indices.map(() => [] as bigint[]);
    const pos = [...indices];
    let nodes = this.leaves;
    for (let lvl = 0; lvl < LEVELS; lvl++) {
      pos.forEach((p, i) => { const s = p ^ 1; paths[i].push(s < nodes.length ? nodes[s] : this.zeros[lvl]); pos[i] = p >> 1; });
      nodes = nodes.length ? this.up(nodes, lvl) : [];
    }
    return { root: nodes.length ? nodes[0] : this.zeros[LEVELS], paths };
  }
}
