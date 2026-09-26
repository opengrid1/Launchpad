/** Users and their wallets, in one JSON file with keys encrypted at rest.
 *  Small on purpose: a bot at this size has hundreds of users, not millions. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "./config.js";

export interface User {
  tgId: number;
  /** Implicit NEAR account: the hex of the public key. */
  accountId: string;
  publicKey: string;
  /** AES-256-GCM: iv.tag.ciphertext, base64. */
  secretKeyEnc: string;
  slippageBps: number;
  /** Buy presets in NEAR. */
  presets: number[];
  createdAt: number;
}

interface Db { users: Record<string, User> }

const file = join(config.dataDir, "store.json");
let db: Db = { users: {} };

export function load() {
  mkdirSync(config.dataDir, { recursive: true });
  try { db = JSON.parse(readFileSync(file, "utf8")) as Db; } catch { db = { users: {} }; }
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

export const allUsers = (): User[] => Object.values(db.users);
