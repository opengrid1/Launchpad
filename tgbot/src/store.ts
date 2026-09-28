/** Users and their wallets, in one JSON file with keys encrypted at rest.
 *  Small on purpose: a bot at this size has hundreds of users, not millions. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "./config.js";

export interface Wallet {
  /** Implicit hex account, or a named account the user imported. */
  accountId: string;
  publicKey: string;
  /** AES-256-GCM: iv.tag.ciphertext, base64. */
  secretKeyEnc: string;
  label: string;
  imported?: boolean;
}

export interface User {
  tgId: number;
  /** The active wallet, mirrored from `wallets[active]` so trade code reads one place. */
  accountId: string;
  publicKey: string;
  secretKeyEnc: string;
  wallets: Wallet[];
  active: number;
  slippageBps: number;
  /** Buy presets in NEAR. */
  presets: number[];
  createdAt: number;
}

interface Db { users: Record<string, User>; tokens: Record<string, string> }

const file = join(config.dataDir, "store.json");
let db: Db = { users: {}, tokens: {} };

export function load() {
  mkdirSync(config.dataDir, { recursive: true });
  try { db = JSON.parse(readFileSync(file, "utf8")) as Db; } catch { db = { users: {}, tokens: {} }; }
  db.tokens ??= {};
  // Users from before multi-wallet: their one wallet becomes W1.
  for (const u of Object.values(db.users)) {
    if (!u.wallets) { u.wallets = [{ accountId: u.accountId, publicKey: u.publicKey, secretKeyEnc: u.secretKeyEnc, label: "W1" }]; u.active = 0; }
  }
}

function save() {
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(db, null, 1));
  renameSync(tmp, file);
}

const key = () => createHash("sha256").update(config.secret).digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export const getUser = (tgId: number): User | undefined => db.users[String(tgId)];

export function putUser(u: User) { db.users[String(u.tgId)] = u; save(); }

export function updateUser(tgId: number, patch: Partial<User>) {
  const u = getUser(tgId);
  if (!u) return;
  Object.assign(u, patch);
  save();
}

/** Makes wallet `k` the active one. */
export function activate(tgId: number, k: number) {
  const u = getUser(tgId);
  if (!u || !u.wallets[k]) return;
  const w = u.wallets[k];
  Object.assign(u, { active: k, accountId: w.accountId, publicKey: w.publicKey, secretKeyEnc: w.secretKeyEnc });
  save();
}

export function addWallet(tgId: number, w: Omit<Wallet, "label">): Wallet {
  const u = getUser(tgId)!;
  const label = `W${u.wallets.length + 1}`;
  const full = { ...w, label };
  u.wallets.push(full);
  activate(tgId, u.wallets.length - 1);
  return full;
}

export function removeWallet(tgId: number, k: number) {
  const u = getUser(tgId);
  if (!u || u.wallets.length < 2 || !u.wallets[k]) return;
  u.wallets.splice(k, 1);
  u.wallets.forEach((w, i) => { w.label = `W${i + 1}`; });
  activate(tgId, Math.min(u.active, u.wallets.length - 1));
}

export const allUsers = (): User[] => Object.values(db.users);

/** Callback data is capped at 64 bytes and token ids can be longer, so
 *  buttons carry a short alias that maps back here. */
export function tokenAlias(token: string): string {
  const a = createHash("sha1").update(token).digest("hex").slice(0, 12);
  if (db.tokens[a] !== token) { db.tokens[a] = token; save(); }
  return a;
}
export const tokenFromAlias = (a: string): string | undefined => db.tokens[a];
