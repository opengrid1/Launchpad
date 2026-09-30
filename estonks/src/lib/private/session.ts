// The unlocked private wallet for this tab, and every private action.
import { useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";

import { client, logClient, publicClient } from "../client";
import { ADDRESSES, PRIVATE } from "../env";
import { clearVault, ETH, hasVault, newPhrase, openPhrase, parsePrivateAddress, privateAddress, sealPhrase, validPhrase } from "./core";
import { FEE_BPS, KIND, PrivateWallet, type Ext, type Owned, type Recipient, type SpendCall } from "./wallet";

const IDLE_MS = 15 * 60 * 1000;
const ZERO = ETH;

// Unlock survives reloads until the idle timer runs out: the phrase is kept in
// IndexedDB encrypted under a random AES key that is non-extractable (the page
// can use it but never read it out). Locking, or 15 idle minutes, deletes it.
// The passphrase-sealed copy in localStorage stays the only copy at rest.
const IDB = "estonks-private-session";
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("s");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await idb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction("s", mode);
      const req = fn(tx.objectStore("s"));
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const idle = {
  async save(phrase: string) {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(phrase));
    await idbOp("readwrite", (s) => s.put({ key, iv, data, expires: Date.now() + IDLE_MS }, "current"));
  },
  async load(): Promise<string | null> {
    const rec = await idbOp<any>("readonly", (s) => s.get("current"));
    if (!rec || !(rec.expires > Date.now())) { await idle.clear(); return null; }
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv }, rec.key, rec.data));
  },
  async extend() {
    const rec = await idbOp<any>("readonly", (s) => s.get("current"));
    if (rec) await idbOp("readwrite", (s) => s.put({ ...rec, expires: Date.now() + IDLE_MS }, "current"));
  },
  clear: () => idbOp("readwrite", (s) => s.delete("current")).catch(() => undefined),
};

export interface RelayInfo { relayer: Address; gasPrice: bigint; units: Record<string, bigint>; margin: bigint; online: boolean }
export interface PrivateState {
  live: boolean; // a vault is configured
  exists: boolean; // this browser holds a sealed private wallet
  unlocked: boolean;
  address?: string;
  balances: Map<string, bigint>;
  syncing: boolean;
  step?: string; // what a running action is doing
}

type Listener = () => void;

class Session {
  private w: PrivateWallet | null = null;
  private listeners = new Set<Listener>();
  private idle?: ReturnType<typeof setTimeout>;
  state: PrivateState = { live: !!ADDRESSES.vault, exists: hasVault(), unlocked: false, balances: new Map(), syncing: false };

  private extended = 0;

  constructor() {
    if (typeof window === "undefined") return;
    for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, () => this.touch(), { passive: true });
    if (this.state.live && this.state.exists && "indexedDB" in window) {
      idle.load().then((phrase) => { if (phrase && !this.w) this.open(phrase, false); }).catch(() => undefined);
    }
  }

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(patch: Partial<PrivateState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()); }
  private touch() {
    if (!this.w) return;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.lock(), IDLE_MS);
    if (Date.now() - this.extended > 30_000) { this.extended = Date.now(); void idle.extend().catch(() => undefined); }
  }

  private open(phrase: string, persist = true) {
    if (!ADDRESSES.vault) throw new Error("Private trading is not live yet.");
    this.w = new PrivateWallet(phrase, publicClient, logClient, ADDRESSES.vault as Address, PRIVATE.startBlock);
    this.set({ unlocked: true, exists: true, address: privateAddress(this.w.keys) });
    this.touch();
    if (persist && "indexedDB" in window) void idle.save(phrase).catch(() => undefined);
    void this.refresh();
  }

  /** New wallet: saves it locked and returns the 24-word recovery phrase to write down.
   *  It opens with {start} once the holder confirms they saved the words. */
  async create(pass: string): Promise<string> {
    if (pass.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
    const phrase = newPhrase();
    await sealPhrase(phrase, pass);
    this.set({ exists: true });
    return phrase;
  }
  start(phrase: string) { this.open(phrase); }
  async restore(phrase: string, pass: string) {
    if (!validPhrase(phrase)) throw new Error("That is not a valid 24-word recovery phrase.");
    if (pass.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
    await sealPhrase(phrase.trim().toLowerCase().replace(/\s+/g, " "), pass);
    this.open(phrase);
  }
  async unlock(pass: string) { this.open(await openPhrase(pass)); }
  async reveal(pass: string) { return openPhrase(pass); }
  lock() { this.w = null; clearTimeout(this.idle); void idle.clear(); this.set({ unlocked: false, address: undefined, balances: new Map(), step: undefined }); }
  forget() { this.lock(); clearVault(); this.set({ exists: false }); }

  async refresh() {
    if (!this.w) return;
    this.set({ syncing: true });
    try { await this.w.sync(); this.set({ balances: this.w.balances() }); } finally { this.set({ syncing: false }); }
  }

  private wallet(): PrivateWallet {
    if (!this.w) throw new Error("Unlock your private wallet first.");
    this.touch();
    return this.w;
  }

  // -- relay --------------------------------------------------------------

  async relay(): Promise<RelayInfo> {
    const r = await fetch(PRIVATE.relay, { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !j?.relayer) throw new Error(j?.reason ?? "The private relay is offline. Try again soon.");
    return { relayer: j.relayer, gasPrice: BigInt(j.gasPrice), units: Object.fromEntries(Object.entries(j.units).map(([k, v]) => [k, BigInt(v as string)])), margin: BigInt(j.margin), online: !!j.online };
  }

  /** The relay's fee for a kind, in ETH wei, with room for gas to move before it lands. */
  private feeEth(info: RelayInfo, kind: number) { return (info.units[String(kind)] * info.gasPrice * info.margin * 130n) / 10_000n; }

  /** The same fee in coins, for coin transfers and withdrawals. */
  private async feeInCoin(coin: Address, feeEth: bigint) {
    const t = await client.getToken(coin);
    const ethUsd = await client.ethUsd();
    const priceEth = t ? (Number(t.priceWei) / 1e18) * (t.pair.usd / (ethUsd || 1)) : 0; // ETH per coin
    if (!(priceEth > 0)) throw new Error("No price for this coin right now.");
    return BigInt(Math.ceil((Number(feeEth) / priceEth) * 1.2));
  }

  private async submit(call: SpendCall, label: string): Promise<Hex> {
    this.set({ step: `${label}: sending` });
    const body = JSON.stringify(call, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const r = await fetch(PRIVATE.relay, { method: "POST", headers: { "content-type": "application/json" }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.hash) throw new Error(friendly(j.reason ?? "The relay did not accept it."));
    this.set({ step: `${label}: confirming` });
    const rc = await publicClient.waitForTransactionReceipt({ hash: j.hash, timeout: 240_000 });
    if (rc.status !== "success") throw new Error("The transaction reverted.");
    await this.refresh();
    return j.hash as Hex;
  }

  private ext(o: Partial<Ext>): Ext {
    return { kind: 0, recipient: ZERO, relayer: ZERO, relayerFee: 0n, coin: ZERO, route: "0x", minOut: 0n, ...o };
  }

  /** Notes covering `amount` of `asset`, merging small notes first when two are not enough. */
  private async notesFor(asset: Address, amount: bigint, info: RelayInfo): Promise<Owned[]> {
    const w = this.wallet();
    await w.sync();
    for (let i = 0; i < 6; i++) {
      const picked = w.pick(asset, amount);
      if (picked) return picked;
      const ns = w.notes(asset).sort((x, y) => (x.amount > y.amount ? -1 : 1)).slice(0, 2);
      const fee = asset === ZERO ? this.feeEth(info, KIND.transfer) : await this.feeInCoin(asset, this.feeEth(info, KIND.transfer));
      const total = ns[0].amount + ns[1].amount;
      this.set({ step: "Merging your private notes: proving" });
      const call = await w.build({ asset, inputs: ns, outputs: [{ to: w.self(), amount: total - fee }], publicOut: fee, ext: this.ext({ kind: KIND.transfer, relayer: info.relayer, relayerFee: fee }) });
      await this.submit(call, "Merging notes");
    }
    throw new Error("Too many small notes. Try again.");
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } finally { this.set({ step: undefined }); }
  }

  // -- actions --------------------------------------------------------------

  /** Move ETH (asset 0x0) or coins from the connected public wallet into the private wallet. */
  shield(asset: Address, amount: bigint): Promise<Hex> {
    return this.run(async () => {
      const w = this.wallet();
      const { partial, encrypted } = await w.depositArgs(asset, amount);
      this.set({ step: "Confirm in your wallet" });
      return client.vaultDeposit(ADDRESSES.vault as Address, asset, amount, partial, encrypted);
    });
  }

  /** Buy `coin` with `ethIn` of private ETH (fees included); the coins land privately. */
  buy(coin: Address, ethIn: bigint, slippagePct = 5): Promise<Hex> {
    return this.run(async () => {
      const w = this.wallet();
      const info = await this.relay();
      const fee = this.feeEth(info, KIND.buy);
      const spendable = ethIn - (ethIn * FEE_BPS) / 10_000n - fee;
      if (spendable <= 0n) throw new Error("Too small to cover the relay fee.");
      const route = await client.routeFor(coin);
      if (route === null) throw new Error("This coin can't be bought with ETH.");
      const quote = await client.quoteBuy(coin, spendable);
      const ins = await this.notesFor(ZERO, ethIn, info);
      const have = ins.reduce((s, n) => s + n.amount, 0n);
      this.set({ step: "Private buy: proving" });
      const call = await w.build({
        asset: ZERO, inputs: ins, outputs: [{ to: w.self(), amount: have - ethIn }], publicOut: ethIn, result: coin,
        ext: this.ext({ kind: KIND.buy, relayer: info.relayer, relayerFee: fee, coin, route, minOut: (quote * BigInt(100 - slippagePct)) / 100n }),
      });
      return this.submit(call, "Private buy");
    });
  }

  /** Sell `amount` of private `coin`; the ETH lands privately. `minEthOut` is before fees. */
  sell(coin: Address, amount: bigint, minEthOut: bigint): Promise<Hex> {
    return this.run(async () => {
      const w = this.wallet();
      const info = await this.relay();
      const fee = this.feeEth(info, KIND.sell);
      const route = await client.routeFor(coin);
      if (route === null) throw new Error("This coin can't be sold for ETH.");
      const ins = await this.notesFor(coin, amount, info);
      const have = ins.reduce((s, n) => s + n.amount, 0n);
      this.set({ step: "Private sell: proving" });
      const call = await w.build({
        asset: coin, inputs: ins, outputs: [{ to: w.self(), amount: have - amount }], publicOut: amount, result: ZERO,
        ext: this.ext({ kind: KIND.sell, relayer: info.relayer, relayerFee: fee, coin, route, minOut: minEthOut }),
      });
      return this.submit(call, "Private sell");
    });
  }

  /** Send private ETH or coins to any public address. The relay fee comes out of `amount`. */
  withdraw(asset: Address, amount: bigint, to: Address): Promise<Hex> {
    return this.run(async () => {
      const w = this.wallet();
      const info = await this.relay();
      const feeEth = this.feeEth(info, KIND.withdraw);
      const fee = asset === ZERO ? feeEth : await this.feeInCoin(asset, feeEth);
      if (amount <= fee) throw new Error("Too small to cover the relay fee.");
      const ins = await this.notesFor(asset, amount, info);
      const have = ins.reduce((s, n) => s + n.amount, 0n);
      this.set({ step: "Withdraw: proving" });
      const call = await w.build({ asset, inputs: ins, outputs: [{ to: w.self(), amount: have - amount }], publicOut: amount, ext: this.ext({ kind: KIND.withdraw, recipient: to, relayer: info.relayer, relayerFee: fee }) });
      return this.submit(call, "Withdraw");
    });
  }

  /** Send privately to another private wallet (an ep1 address). The relay fee comes out of `amount`. */
  send(asset: Address, amount: bigint, to: string): Promise<Hex> {
    return this.run(async () => {
      const w = this.wallet();
      const dest = parsePrivateAddress(to);
      if (!dest) throw new Error("That is not a private address. They start with ep1.");
      const info = await this.relay();
      const feeEth = this.feeEth(info, KIND.transfer);
      const fee = asset === ZERO ? feeEth : await this.feeInCoin(asset, feeEth);
      if (amount <= fee) throw new Error("Too small to cover the relay fee.");
      const ins = await this.notesFor(asset, amount, info);
      const have = ins.reduce((s, n) => s + n.amount, 0n);
      this.set({ step: "Private send: proving" });
      const recipient: Recipient = { pk: dest.pk, encPk: dest.encPk };
      const call = await w.build({ asset, inputs: ins, outputs: [{ to: recipient, amount: amount - fee }, { to: w.self(), amount: have - amount }], publicOut: fee, ext: this.ext({ kind: KIND.transfer, relayer: info.relayer, relayerFee: fee }) });
      return this.submit(call, "Private send");
    });
  }
}

function friendly(reason: string): string {
  if (/BadProof/.test(reason)) return "The proof was rejected. Refresh and try again.";
  if (/UnknownRoot/.test(reason)) return "Your wallet was a step behind. Try again.";
  if (/AlreadySpent/.test(reason)) return "Those notes were already spent. Refresh and try again.";
  if (/Paused/.test(reason)) return "Private deposits and trades are paused right now. Withdrawals still work.";
  if (/Sanctioned/.test(reason)) return "That address can't use the vault.";
  if (/Slippage/.test(reason)) return "Price moved. Try again.";
  return reason;
}

export const priv = new Session();
export const usePrivate = () => useSyncExternalStore(priv.subscribe, () => priv.state);
