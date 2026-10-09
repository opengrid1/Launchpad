/** NEAR access: views through the RPC, and signing for a user's bot wallet. */
import { Account, KeyPair, KeyPairSigner, providers } from "near-api-js";
import { actionCreators } from "@near-js/transactions";

const { JsonRpcProvider, FailoverRpcProvider } = providers;
type FinalExecutionOutcome = Awaited<ReturnType<Account["signAndSendTransaction"]>>;

import { config } from "./config.js";
import { addWallet, decrypt, encrypt, getUser, putUser, type User, type Wallet } from "./store.js";

export const provider = new FailoverRpcProvider(config.rpcUrls.map((url) => new JsonRpcProvider({ url })));

export const NEAR = 10n ** 24n;
export const TGAS = (n: number) => BigInt(n) * 10n ** 12n;
export const yocto = (near: number | string) => {
  const s = String(near).trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return 0n;
  const [w, f = ""] = s.split(".");
  return BigInt(w || "0") * NEAR + BigInt((f + "0".repeat(24)).slice(0, 24) || "0");
};

/** Big-integer string in `d` decimals to a number. */
export function units(v: string | bigint, d: number): number {
  const b = typeof v === "bigint" ? v : BigInt(v || "0");
  const base = 10n ** BigInt(d);
  return Number(b / base) + Number(b % base) / Number(base);
}

/** A decimal typed by a person to raw units. */
export function toUnits(v: string | number, d: number): bigint {
  const s = String(v).trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return 0n;
  const [w, f = ""] = s.split(".");
  return BigInt(w || "0") * 10n ** BigInt(d) + BigInt((f + "0".repeat(d)).slice(0, d) || "0");
}

export async function view<T>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction(contract, method, args)) as T;
}

/** Native balance; zero for an implicit account nobody has funded yet. Goes
 *  straight to the RPC so a missing account is an answer, not a failover. */
export async function balanceOf(accountId: string): Promise<bigint> {
  for (const url of config.rpcUrls) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: accountId } }), signal: AbortSignal.timeout(10_000) });
      const j = (await r.json()) as { result?: { amount: string }; error?: { cause?: { name?: string } } };
      if (j.result) return BigInt(j.result.amount);
      if (j.error?.cause?.name === "UNKNOWN_ACCOUNT") return 0n;
    } catch { /* next url */ }
  }
  return 0n;
}

export const ftBalance = async (token: string, accountId: string) => BigInt((await view<string>(token, "ft_balance_of", { account_id: accountId }).catch(() => "0")) || "0");
export const ftRegistered = async (token: string, accountId: string) => !!(await view<unknown>(token, "storage_balance_of", { account_id: accountId }).catch(() => null));

/** A fresh key pair as an implicit account: it exists once someone sends NEAR to it. */
function freshKey() {
  const kp = KeyPair.fromRandom("ed25519");
  const pk = kp.getPublicKey();
  return { accountId: Buffer.from(pk.data).toString("hex"), publicKey: pk.toString(), secretKeyEnc: encrypt(kp.toString()) };
}

/** First contact: a user record with one wallet. */
export function createUser(tgId: number): User {
  const w = freshKey();
  const u: User = { tgId, ...w, wallets: [{ ...w, label: "W1" }], active: 0, slippageBps: 500, presets: [1, 5, 10], createdAt: Date.now() };
  putUser(u);
  return u;
}

export const ensureUser = (tgId: number): User => getUser(tgId) ?? createUser(tgId);

/** Another bot-made wallet for the same user; it becomes the active one. */
export const newWallet = (tgId: number): Wallet => addWallet(tgId, freshKey());

/** The accounts a public key belongs to, from FastNear's index. */
async function accountsForKey(publicKey: string): Promise<string[]> {
  try {
    const r = await fetch(`https://api.fastnear.com/v0/public_key/${publicKey}`, { signal: AbortSignal.timeout(10_000) });
    const j = (await r.json()) as { account_ids?: string[] };
    return j.account_ids ?? [];
  } catch { return []; }
}

/** Whether the key is a full-access key on the account; trades need that. */
async function isFullAccess(accountId: string, publicKey: string): Promise<boolean> {
  try {
    const r = await provider.query({ request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey }) as unknown as { permission?: unknown };
    return r.permission === "FullAccess";
  } catch { return false; }
}

export type ImportResult = { ok: true; wallet: Wallet } | { ok: false; reason: string } | { choose: string[]; publicKey: string };

/** Imports a private key. With no account given, FastNear says which named
 *  accounts hold the key; several means the user picks. None means the
 *  implicit hex account. */
export async function importKey(tgId: number, secret: string, accountId?: string): Promise<ImportResult> {
  let kp: KeyPair;
  try { kp = KeyPair.fromString((secret.startsWith("ed25519:") ? secret : `ed25519:${secret}`) as `ed25519:${string}`); }
  catch { return { ok: false, reason: "That is not a valid ed25519 private key." }; }
  const pk = kp.getPublicKey(); const publicKey = pk.toString();
  const implicit = Buffer.from(pk.data).toString("hex");
  const u = getUser(tgId)!;
  const finish = (acct: string): ImportResult => {
    if (u.wallets.some((w) => w.accountId === acct)) return { ok: false, reason: `${acct} is already in your wallets.` };
    return { ok: true, wallet: addWallet(tgId, { accountId: acct, publicKey, secretKeyEnc: encrypt(kp.toString()), imported: true }) };
  };
  if (accountId) {
    if (accountId !== implicit && !(await isFullAccess(accountId, publicKey))) return { ok: false, reason: `That key is not a full-access key on ${accountId}.` };
    return finish(accountId);
  }
  const named = (await accountsForKey(publicKey)).filter((a) => a !== implicit);
  const full: string[] = [];
  for (const a of named) if (await isFullAccess(a, publicKey)) full.push(a);
  if (full.length === 0) return finish(implicit);
  if (full.length === 1) return finish(full[0]);
  return { choose: full, publicKey };
}

export const secretKeyOf = (u: User) => decrypt(u.secretKeyEnc);

export function accountOf(u: User): Account {
  return new Account(u.accountId, provider, KeyPairSigner.fromSecretKey(secretKeyOf(u) as `ed25519:${string}`));
}

export interface Call { receiverId: string; method: string; args?: Record<string, unknown>; gas?: bigint; deposit?: bigint }

/** Runs calls in order, one transaction per receiver group, and stops at the
 *  first failure. Returns the last outcome. */
export async function run(u: User, calls: Call[]): Promise<FinalExecutionOutcome> {
  const acct = accountOf(u);
  let last: FinalExecutionOutcome | undefined;
  // Consecutive calls to the same receiver share a transaction.
  const groups: Call[][] = [];
  for (const c of calls) {
    const g = groups[groups.length - 1];
    if (g && g[0].receiverId === c.receiverId) g.push(c); else groups.push([c]);
  }
  for (const g of groups) {
    last = await acct.signAndSendTransaction({
      receiverId: g[0].receiverId,
      actions: g.map((c) => actionCreators.functionCall(c.method, c.args ?? {}, c.gas ?? TGAS(100), c.deposit ?? 0n)),
      throwOnFailure: true,
    });
  }
  return last!;
}

export async function sendNear(u: User, to: string, amount: bigint): Promise<FinalExecutionOutcome> {
  return accountOf(u).signAndSendTransaction({ receiverId: to, actions: [actionCreators.transfer(amount)], throwOnFailure: true });
}

export const txUrl = (hash: string) => `https://nearblocks.io/txns/${hash}`;

/** Plain words for a failed call. */
export function friendlyError(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  const m = s.match(/Smart contract panicked: (?:panicked at [^\n]*\n)?([^\n"]+)/);
  if (m) return m[1].trim();
  if (/does not exist while viewing|UNKNOWN_ACCOUNT/i.test(s)) return "Your wallet has no NEAR yet. Deposit first.";
  if (/NotEnoughBalance|LackBalanceForState/i.test(s)) return "Not enough NEAR in your wallet for that, after gas and storage.";
  if (/InvalidNonce|Timeout|timed out/i.test(s)) return "The network was slow. Check your balance before trying again.";
  return s.slice(0, 200);
}
