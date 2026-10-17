import { createPublicClient, encodeAbiParameters, fallback, getAbiItem, http, keccak256, parseAbi, toEventSelector, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import type { Candle, CandleInterval, HolderRecord, TokenSummary, TradeRecord } from "@launchpad/sdk";
import { INTERVAL_SECONDS } from "@launchpad/sdk";

import { ADDRESSES, chain, env, FEES } from "./env";

export const publicClient = createPublicClient({
  chain,
  transport: fallback(
    env.rpcUrls.map((url) => http(url, { retryCount: 2, retryDelay: 700, timeout: 10_000, batch: { wait: 16, batchSize: 20 } })),
    { rank: { interval: 30_000, sampleCount: 5 } },
  ),
  pollingInterval: 4_000,
  batch: { multicall: { wait: 24 } },
}) as PublicClient;

/** Read-only client for eth_getLogs. The public Arc RPC allows about 5,000
 *  blocks per request, keeps roughly a million blocks of history, and
 *  rate-limits bursts, so every scan goes through the gate below. */
export const logClient = createPublicClient({
  chain,
  transport: fallback(env.logRpcUrls.map((url) => http(url, { retryCount: 3, retryDelay: 800, timeout: 30_000, batch: false }))),
}) as PublicClient;

const Q96 = 2n ** 96n;
const Q192 = Q96 * Q96;
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
/** Native USDC has 18 decimals; its ERC-20 interface (what pools hold) has 6. */
const NATIVE_PER_QUOTE = 10n ** 12n;
const LOG_CHUNK = env.logChunk;
/** Blocks of history the public RPC serves; older ranges error out. */
const RETAIN = env.logRetain;
/** First sync covers this many recent blocks (about six hours); the rest backfills in the background. */
const INITIAL = 43_200n;
const CREATOR_BPS = BigInt(FEES.creatorPct * 100);
const FEE_BPS = BigInt(FEES.taxPct * 100);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Concurrency gate with spacing, so bursts never trip the public RPC's rate limit.
 *  A 429 is retried after a pause instead of failing the whole scan. */
class Gate {
  private active = 0;
  private queue: (() => void)[] = [];
  private last = 0;
  constructor(private max: number, private gapMs: number) {}
  async run<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      for (let attempt = 0; ; attempt++) {
        const wait = this.last + this.gapMs - Date.now();
        if (wait > 0) await sleep(wait);
        this.last = Date.now();
        try {
          return await fn();
        } catch (e) {
          const msg = String((e as any)?.details ?? (e as any)?.shortMessage ?? (e as any)?.message ?? e);
          if (attempt < retries && /429|rate|Too Many/i.test(msg)) { await sleep(900 * (attempt + 1)); continue; }
          throw e;
        }
      }
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
const logGate = new Gate(2, 150);
const readGate = new Gate(4, 40);

const factoryAbi = parseAbi([
  "struct CreateParams { string name; string symbol; string metadataURI; address quote; uint256 marketCapUsd8; }",
  "function createToken(CreateParams p) returns (address token, address pool)",
  "function totalTokens() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
  "function listings(address token) view returns (address creator, address quote, address pool, int24 tickLower, int24 tickUpper, uint64 createdAt, bool tokenIsToken0)",
  "function positionLiquidity(address token) view returns (uint128)",
  "function pendingFees(address token) returns (uint256 tokenAmount, uint256 quoteAmount)",
  "function harvestFees(address token) returns (uint256, uint256, uint256, uint256)",
  "function harvestMany(address[] tokens) returns (uint256)",
  "function collect(address token, uint16 liquidityBps, address recipient) returns (uint256, uint256)",
  "function owner() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function launchesPaused() view returns (bool)",
  "function CREATOR_FEE_BPS() view returns (uint16)",
  "function POOL_FEE_TIER() view returns (uint24)",
  "function pause()",
  "function resume()",
  "function setFeeRecipient(address recipient)",
  "function setQuoteAsset(address quote, bool approved, uint64 usdPrice8)",
  "event TokenCreated(address indexed token, address indexed creator, string name, string symbol, string metadataURI, uint256 totalSupply)",
]);
const routerAbi = parseAbi([
  "function buy(address token, uint256 minOut) payable returns (uint256 out)",
  "function sell(address token, uint256 amountIn, uint256 minOut) returns (uint256 out)",
]);
const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);
const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function metadataURI() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const swapEvent = getAbiItem({ abi: poolAbi, name: "Swap" });
const transferEvent = getAbiItem({ abi: tokenAbi, name: "Transfer" });
const TOKEN_CREATED_TOPIC = toEventSelector(getAbiItem({ abi: factoryAbi, name: "TokenCreated" }));

/** A coin's pair asset. On Arc that is always native USDC. */
export interface PairInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  usd: number;
  isNative: boolean;
  /** The pair can be paid in the chain's native asset. */
  ethRoute: boolean;
}

/** An approved pair on the factory. */
export interface QuoteView extends PairInfo {
  approved: boolean;
  liqUsd: number;
  vol24Usd: number;
}

export type StockToken = TokenSummary & {
  pair: PairInfo;
  poolId: Hex;
  launchBlock: number;
  /** Pair-asset fees earned by holders / creator / platform over the scanned trades (18-dp wei). */
  rewards?: { holders: bigint; creator: bigint; platform: bigint };
  /** What actually sits in the pool right now: pair asset and coin, in wei. */
  reserves?: { pair: bigint; token: bigint };
};

export interface RewardsView {
  pending: bigint;
  creatorFees: bigint;
  platformFees: bigint;
  totalHolder: bigint;
  totalCreator: bigint;
  totalPlatform: bigint;
  isCreator: boolean;
  balance: bigint;
}

export interface ConfigView {
  admin: Address;
  owner: Address;
  feeRecipient: Address;
  paused: boolean;
  taxBps: number;
  creatorBps: number;
  holderBps: number;
  ethUsd: number;
  converter: Address;
  totalTokens: number;
}

interface Core {
  address: Address;
  creator: Address;
  pair: Address;
  pool: Address;
  tickLower: number;
  tickUpper: number;
  /** Estimated from the listing timestamp; a lower bound for log scans. */
  launchBlock: bigint;
  createdAt: number;
  name: string;
  symbol: string;
  metadata: Record<string, unknown>;
  tokenIsToken0: boolean;
}

/** USDC as the pair of every coin: pool amounts are 6-dp, the UI works in 18-dp native wei. */
const USDC_PAIR: PairInfo = { address: ADDRESSES.weth.toLowerCase() as Address, symbol: "USDC", name: "USD Coin", decimals: 18, usd: 1, isNative: true, ethRoute: true };

// -- small persistent cache (log scans survive reloads; history is pruned server-side) --
const STORE_PREFIX = `arcx.${ADDRESSES.factory.slice(2, 10).toLowerCase()}.v2.`;
const store = {
  get<T>(key: string): T | null {
    try { const raw = globalThis.localStorage?.getItem(STORE_PREFIX + key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
  },
  set(key: string, value: unknown) {
    try { globalThis.localStorage?.setItem(STORE_PREFIX + key, JSON.stringify(value)); } catch { /* quota or private mode */ }
  },
};

/** A scanned block range [lo, hi] with its records. lo = 0 means nothing scanned yet. */
interface Scan<T> { lo: bigint; hi: bigint; data: T }
interface TradeStore { lo: string; hi: string; byPool: Record<string, TradeRecord[]>; anchors: [string, number][] }
interface BalStore { lo: string; hi: string; bal: Record<string, string> }
const MAX_RECORDS_PER_POOL = 3000;

/** Backend-free client for the Arc launchpad: coins, prices, trades and fees
 *  come straight from the factory, the Uniswap V3 pools and the coins;
 *  trades go through ArcSwapRouter in native USDC. */
export class StockPadClient {
  readonly pc: PublicClient;
  private wc?: WalletClient;
  private cores = new Map<string, Core>();
  private coresUpTo = 0n;
  private coresInflight: Promise<Core[]> | null = null;
  /** One combined Swap scan across every launch pool. */
  private tr: Scan<Map<string, TradeRecord[]>> = { lo: 0n, hi: 0n, data: new Map() };
  private trInflight: Promise<void> | null = null;
  private trBackfilling = false;
  /** Block-number → timestamp anchors (one per scanned chunk) for estimating trade times. */
  private anchors: [bigint, number][] = [];
  /** Per-coin Transfer scans (token page only). */
  private bals = new Map<string, Scan<Map<string, bigint>>>();
  private balInflight = new Map<string, Promise<void>>();
  private balBackfilling = new Set<string>();
  private head?: { block: bigint; ts: number; at: number };

  constructor(pc: PublicClient) {
    this.pc = pc;
    const saved = store.get<TradeStore>("trades");
    if (saved) {
      this.tr = { lo: BigInt(saved.lo), hi: BigInt(saved.hi), data: new Map(Object.entries(saved.byPool)) };
      this.anchors = (saved.anchors ?? []).map(([b, t]) => [BigInt(b), t]);
    }
  }

  connectWallet(wc: WalletClient) {
    this.wc = wc;
  }
  private wallet(): WalletClient {
    if (!this.wc) throw new Error("No wallet connected");
    return this.wc;
  }
  private me(): Address {
    const a = this.wc?.account?.address;
    if (!a) throw new Error("No wallet connected");
    return a;
  }

  // -- chain head and time estimates --------------------------------------

  /** Latest block and its timestamp, cached a few seconds. */
  private async headInfo(): Promise<{ block: bigint; ts: number }> {
    if (this.head && Date.now() - this.head.at < 4_000) return this.head;
    const b = await readGate.run(() => this.pc.getBlock({ blockTag: "latest" }));
    this.head = { block: b.number ?? 0n, ts: Number(b.timestamp), at: Date.now() };
    return this.head;
  }

  private addAnchor(block: bigint, ts: number) {
    if (this.anchors.some(([b]) => b === block)) return;
    this.anchors.push([block, ts]);
    this.anchors.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (this.anchors.length > 400) this.anchors.splice(0, this.anchors.length - 400);
  }

  /** Timestamp for a block from the nearest anchor and Arc's steady block time. */
  private tsOf(block: bigint): number {
    let best: [bigint, number] | undefined;
    for (const a of this.anchors) if (!best || (a[0] > block ? a[0] - block : block - a[0]) < (best[0] > block ? best[0] - block : block - best[0])) best = a;
    if (!best) return Math.floor(Date.now() / 1000) - Math.round(Number((this.head?.block ?? block) - block) * env.secondsPerBlock);
    return best[1] + Math.round(Number(block - best[0]) * env.secondsPerBlock);
  }

  /** Rough block for a timestamp, biased early so it works as a scan floor. */
  private blockFromTimestamp(ts: number, head: { block: bigint; ts: number }): bigint {
    const back = BigInt(Math.max(0, Math.round((head.ts - ts) / env.secondsPerBlock))) + 4_000n;
    return back >= head.block ? 0n : head.block - back;
  }

  // -- discovery ---------------------------------------------------------

  private loadCores(): Promise<Core[]> {
    if (this.coresInflight) return this.coresInflight;
    this.coresInflight = this.loadCoresInner().finally(() => (this.coresInflight = null));
    return this.coresInflight;
  }

  private async loadCoresInner(): Promise<Core[]> {
    const head = await this.headInfo().catch(() => null);
    if (!head || (this.coresUpTo !== 0n && head.block <= this.coresUpTo)) return [...this.cores.values()];
    const total = Number(await readGate.run(() => this.pc.readContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "totalTokens" })).catch(() => 0n));
    if (total > this.cores.size) {
      const addrs = (await readGate.run(() => this.pc.multicall({
        allowFailure: false,
        contracts: Array.from({ length: total }, (_, i) => ({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "allTokens", args: [BigInt(i)] })),
      }))) as Address[];
      const fresh = addrs.filter((a) => !this.cores.has(a.toLowerCase()));
      for (let i = 0; i < fresh.length; i += 10) {
        const batch = fresh.slice(i, i + 10).map((a) => a.toLowerCase() as Address);
        const rows = await readGate.run(() => this.pc.multicall({
          allowFailure: true,
          contracts: batch.flatMap((token) => [
            { address: ADDRESSES.factory, abi: factoryAbi, functionName: "listings", args: [token] },
            { address: token, abi: tokenAbi, functionName: "name" },
            { address: token, abi: tokenAbi, functionName: "symbol" },
            { address: token, abi: tokenAbi, functionName: "metadataURI" },
          ]) as any,
        })).catch(() => null);
        if (!rows) continue;
        batch.forEach((token, j) => {
          const [l, n, s, m] = rows.slice(j * 4, j * 4 + 4);
          if (l.status !== "success" || n.status !== "success" || s.status !== "success") return;
          const listing = l.result as unknown as readonly [Address, Address, Address, number, number, bigint, boolean];
          const metaURI = m.status === "success" ? String(m.result) : "";
          let metadata: Record<string, unknown> = {};
          try { metadata = JSON.parse(metaURI); } catch { metadata = { description: metaURI }; }
          this.cores.set(token, {
            address: token, creator: listing[0].toLowerCase() as Address, pair: listing[1].toLowerCase() as Address, pool: listing[2].toLowerCase() as Address,
            tickLower: Number(listing[3]), tickUpper: Number(listing[4]), createdAt: Number(listing[5]), tokenIsToken0: listing[6],
            launchBlock: this.blockFromTimestamp(Number(listing[5]), head), name: String(n.result), symbol: String(s.result), metadata,
          });
        });
      }
    }
    this.coresUpTo = head.block;
    return [...this.cores.values()];
  }

  // -- pricing ------------------------------------------------------------

  /** Native USDC wei (18-dp) per whole coin from a pool sqrtPriceX96. */
  private priceFromSqrt(sqrtP: bigint, tokenIsToken0: boolean): bigint {
    if (sqrtP === 0n) return 0n;
    const scale = 10n ** 18n * NATIVE_PER_QUOTE;
    return tokenIsToken0 ? (sqrtP * sqrtP * scale) / Q192 : (Q192 * scale) / (sqrtP * sqrtP);
  }

  async assetUsdPrice(): Promise<number> { return 1; }
  async ethUsd(): Promise<number> { return 1; }
  async pairInfo(_pair?: Address): Promise<PairInfo> { return USDC_PAIR; }
  async pairOf(_token?: Address): Promise<PairInfo> { return USDC_PAIR; }
  async quotes(): Promise<QuoteView[]> { return [{ ...USDC_PAIR, approved: true, liqUsd: 0, vol24Usd: 0 }]; }

  // -- trades: one Swap scan over every pool, forward on demand, backward in the background --

  private async getLogsRange(addresses: Address[], event: any, from: bigint, to: bigint): Promise<any[]> {
    return logGate.run(() => logClient.getLogs({ address: addresses, event, fromBlock: from, toBlock: to }) as Promise<any[]>);
  }

  /** Split [from, to] into RPC-sized windows and fetch them through the gate; a failed window is skipped. */
  private async scanRange(addresses: Address[], event: any, from: bigint, to: bigint): Promise<any[]> {
    const windows: [bigint, bigint][] = [];
    for (let a = from; a <= to; a += LOG_CHUNK + 1n) windows.push([a, a + LOG_CHUNK > to ? to : a + LOG_CHUNK]);
    const parts = await Promise.all(windows.map(([a, b]) => this.getLogsRange(addresses, event, a, b).catch(() => [] as any[])));
    return parts.flat();
  }

  private poolCores(): Map<string, Core> {
    return new Map([...this.cores.values()].map((c) => [c.pool, c]));
  }

  private ingestSwaps(logs: any[]) {
    const byPool = this.poolCores();
    const abs = (v: bigint) => (v < 0n ? -v : v);
    const fresh = new Map<string, TradeRecord[]>();
    for (const log of logs) {
      const core = byPool.get(String(log.address).toLowerCase());
      if (!core) continue;
      const a0 = log.args.amount0 as bigint, a1 = log.args.amount1 as bigint;
      // V3 deltas are the pool's: positive came in, negative went out.
      const quoteDelta = core.tokenIsToken0 ? a1 : a0;
      const tokenDelta = core.tokenIsToken0 ? a0 : a1;
      const quoteWei = abs(quoteDelta) * NATIVE_PER_QUOTE;
      const block = log.blockNumber as bigint;
      const rec: TradeRecord = {
        id: `${log.transactionHash}-${log.logIndex}`, token: core.address, trader: String(log.args.recipient).toLowerCase() as Address,
        isBuy: tokenDelta < 0n, nativeAmountWei: quoteWei.toString(), tokenAmount: abs(tokenDelta).toString(),
        feeWei: ((quoteWei * FEE_BPS) / 10_000n).toString(),
        priceWei: this.priceFromSqrt(log.args.sqrtPriceX96 as bigint, core.tokenIsToken0).toString(),
        blockNumber: Number(block), txHash: log.transactionHash, timestamp: this.tsOf(block),
      };
      const arr = fresh.get(core.pool) ?? [];
      arr.push(rec);
      fresh.set(core.pool, arr);
    }
    for (const [pool, recs] of fresh) {
      const have = this.tr.data.get(pool) ?? [];
      const seen = new Set(have.map((r) => r.id));
      const merged = have.concat(recs.filter((r) => !seen.has(r.id))).sort((a, b) => a.blockNumber - b.blockNumber || a.id.localeCompare(b.id));
      this.tr.data.set(pool, merged.length > MAX_RECORDS_PER_POOL ? merged.slice(-MAX_RECORDS_PER_POOL) : merged);
    }
    return fresh;
  }

  /** Real timestamps for a few blocks (newest first), which also become anchors. */
  private async stampBlocks(blocks: bigint[]) {
    const want = [...new Set(blocks)].sort((a, b) => (a < b ? 1 : -1)).slice(0, 8).filter((b) => !this.anchors.some(([x]) => x === b));
    const got = await Promise.allSettled(want.map((b) => readGate.run(() => this.pc.getBlock({ blockNumber: b }))));
    got.forEach((r, i) => { if (r.status === "fulfilled") this.addAnchor(want[i], Number(r.value.timestamp)); });
  }

  private restamp() {
    for (const recs of this.tr.data.values()) for (const r of recs) r.timestamp = this.tsOf(BigInt(r.blockNumber));
  }

  /** Sells pay the router first, so the Swap recipient is the router; look up the sender for the newest ones. */
  private async attributeSells(fresh: Map<string, TradeRecord[]>) {
    const router = ADDRESSES.router.toLowerCase();
    const recs = [...fresh.values()].flat().filter((r) => r.trader === router).sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 24);
    if (!recs.length) return;
    const hashes = [...new Set(recs.map((r) => r.txHash))];
    const txs = await Promise.allSettled(hashes.map((h) => readGate.run(() => this.pc.getTransaction({ hash: h as Hex }))));
    const from = new Map<string, Address>();
    txs.forEach((r, i) => { if (r.status === "fulfilled" && r.value?.from) from.set(hashes[i], r.value.from.toLowerCase() as Address); });
    for (const recsOfPool of this.tr.data.values()) for (const r of recsOfPool) if (r.trader === router && from.has(r.txHash)) r.trader = from.get(r.txHash)!;
  }

  private persistTrades() {
    store.set("trades", { lo: this.tr.lo.toString(), hi: this.tr.hi.toString(), byPool: Object.fromEntries([...this.tr.data.entries()].map(([p, r]) => [p, r.slice(-1500)])), anchors: this.anchors.map(([b, t]) => [b.toString(), t]) } satisfies TradeStore);
  }

  /** Oldest block any scan needs: the earliest launch, bounded by what the RPC still serves. */
  private floorBlock(head: bigint): bigint {
    const launches = [...this.cores.values()].map((c) => c.launchBlock);
    const oldest = launches.length ? launches.reduce((a, b) => (a < b ? a : b)) : head;
    const retained = head > RETAIN ? head - RETAIN : 0n;
    return oldest > retained ? oldest : retained;
  }

  /** Bring the combined trade scan up to the chain head. */
  private syncTrades(): Promise<void> {
    if (this.trInflight) return this.trInflight;
    this.trInflight = this.syncTradesInner().catch(() => undefined).finally(() => (this.trInflight = null));
    return this.trInflight;
  }

  private async syncTradesInner() {
    const cores = await this.loadCores();
    if (!cores.length) return;
    const head = await this.headInfo();
    this.addAnchor(head.block, head.ts);
    const pools = cores.map((c) => c.pool);
    const floor = this.floorBlock(head.block);
    let from: bigint;
    if (this.tr.hi === 0n) from = head.block - INITIAL > floor ? head.block - INITIAL : floor;
    else { from = this.tr.hi + 1n; if (from > head.block) return; }
    const logs = await this.scanRange(pools, swapEvent, from, head.block);
    await this.stampBlocks(logs.map((l) => l.blockNumber as bigint));
    const fresh = this.ingestSwaps(logs);
    this.restamp();
    if (this.tr.lo === 0n) this.tr.lo = from;
    this.tr.hi = head.block;
    await this.attributeSells(fresh).catch(() => undefined);
    this.persistTrades();
    this.backfillTrades();
  }

  /** Extend the scan backwards one window at a time, until the oldest launch or the RPC's retention edge. */
  private backfillTrades() {
    if (this.trBackfilling || typeof window === "undefined") return;
    this.trBackfilling = true;
    const done = () => { this.trBackfilling = false; };
    const step = async () => {
      try {
        const floor = this.floorBlock(this.tr.hi);
        if (this.tr.lo === 0n || this.tr.lo <= floor) return done();
        const to = this.tr.lo - 1n;
        const from = to - LOG_CHUNK > floor ? to - LOG_CHUNK : floor;
        const pools = [...this.cores.values()].map((c) => c.pool);
        const logs = await this.getLogsRange(pools, swapEvent, from, to).catch(() => null);
        if (logs === null) { this.tr.lo = floor; this.persistTrades(); return done(); } // pruned or refused: stop here
        const b = await readGate.run(() => this.pc.getBlock({ blockNumber: from })).catch(() => null);
        if (b) this.addAnchor(from, Number(b.timestamp));
        this.ingestSwaps(logs);
        this.restamp();
        this.tr.lo = from;
        this.persistTrades();
        setTimeout(step, 250);
      } catch { done(); }
    };
    setTimeout(step, 300);
  }

  private async tradesOf(token: Address): Promise<TradeRecord[]> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    if (!core) return [];
    await this.syncTrades();
    return this.tr.data.get(core.pool) ?? [];
  }

  // -- summaries ----------------------------------------------------------

  private async summarize(core: Core, sqrtP: bigint, liquidity: bigint): Promise<StockToken> {
    const trades = this.tr.data.get(core.pool) ?? [];
    const pair = USDC_PAIR;
    const priceWei = sqrtP > 0n ? this.priceFromSqrt(sqrtP, core.tokenIsToken0) : trades.length ? BigInt(trades[trades.length - 1].priceWei) : 0n;
    const pricePair = Number(priceWei) / 1e18;
    const priceUsd = pricePair * pair.usd;
    const mcap = priceUsd * 1e9;
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    const day = trades.filter((t) => t.timestamp >= dayAgo);
    const vol24 = day.reduce((a, t) => a + BigInt(t.nativeAmountWei), 0n);
    const volTotal = trades.reduce((a, t) => a + BigInt(t.nativeAmountWei), 0n);
    const ref = [...trades].reverse().find((t) => t.timestamp <= dayAgo) ?? trades[0];
    const refP = ref ? Number(ref.priceWei) : 0;
    const change = refP > 0 && trades.length > 1 ? ((Number(priceWei) - refP) / refP) * 100 : null;
    // Holder count from a completed Transfer scan when the token page has built one; else distinct buyers.
    const bal = this.bals.get(core.address);
    const holderCount = bal && bal.lo !== 0n && bal.lo <= core.launchBlock ? this.holderEntries(core, bal.data).length : new Set(trades.filter((t) => t.isBuy).map((t) => t.trader)).size;

    // Liquidity: both legs of the launch position at the live price, in USDC wei
    // (the coin leg converted at spot, the way Dexscreener reports it).
    let liquidityWei = 0n;
    let reserves: StockToken["reserves"];
    const L = Number(liquidity);
    if (L > 0 && sqrtP > 0n) {
      const sp = Number(sqrtP) / 2 ** 96, sa = Math.sqrt(1.0001 ** core.tickLower), sb = Math.sqrt(1.0001 ** core.tickUpper);
      let amount0 = 0, amount1 = 0;
      if (sp <= sa) amount0 = (L * (sb - sa)) / (sa * sb);
      else if (sp >= sb) amount1 = L * (sb - sa);
      else { amount0 = (L * (sb - sp)) / (sp * sb); amount1 = L * (sp - sa); }
      const quoteRaw = core.tokenIsToken0 ? amount1 : amount0;
      const tokenUnits = core.tokenIsToken0 ? amount0 : amount1;
      const pairUnits = quoteRaw * 1e12;
      liquidityWei = BigInt(Math.max(0, Math.round(pairUnits + tokenUnits * pricePair)));
      reserves = { pair: BigInt(Math.max(0, Math.round(pairUnits))), token: BigInt(Math.max(0, Math.round(tokenUnits))) };
    }

    // Fees earned over the scanned trades: the pool's 1% of volume, split 80/20.
    const fees = (volTotal * FEE_BPS) / 10_000n;
    const creator = (fees * CREATOR_BPS) / 10_000n;
    const rewards = { holders: 0n, creator, platform: fees - creator };

    return {
      address: core.address, name: core.name, symbol: core.symbol, creator: core.creator, pool: core.pool, feeTier: FEES.taxPct * 100,
      createdAt: core.createdAt, featured: false, metadata: core.metadata as any, totalSupply: TOTAL_SUPPLY.toString(),
      priceWei: priceWei.toString(), priceUsd: String(priceUsd), marketCapUsd: String(mcap), liquidityWei: liquidityWei.toString(),
      volume24hWei: vol24.toString(), volumeTotalWei: volTotal.toString(), txCount24h: day.length, holderCount,
      limitsActive: false, remainingToGraduationUsd: "0", priceChange24hPct: change,
      pair, poolId: core.pool as Hex, launchBlock: Number(core.launchBlock), rewards, reserves,
    };
  }

  /** slot0 and position liquidity for many coins in one multicall. */
  private async poolState(cores: Core[]): Promise<Map<string, { sqrtP: bigint; liquidity: bigint }>> {
    const out = new Map<string, { sqrtP: bigint; liquidity: bigint }>();
    for (let i = 0; i < cores.length; i += 40) {
      const batch = cores.slice(i, i + 40);
      const rows = await readGate.run(() => this.pc.multicall({
        allowFailure: true,
        contracts: batch.flatMap((c) => [
          { address: c.pool, abi: poolAbi, functionName: "slot0" },
          { address: ADDRESSES.factory, abi: factoryAbi, functionName: "positionLiquidity", args: [c.address] },
        ]) as any,
      })).catch(() => null);
      batch.forEach((c, j) => {
        const s = rows?.[j * 2], l = rows?.[j * 2 + 1];
        out.set(c.address, {
          sqrtP: s?.status === "success" ? ((s.result as unknown as readonly [bigint])[0] ?? 0n) : 0n,
          liquidity: l?.status === "success" ? (l.result as unknown as bigint) : 0n,
        });
      });
    }
    return out;
  }

  async getTokens(opts?: { sort?: string; limit?: number }): Promise<StockToken[]> {
    const cores = await this.loadCores();
    const [state] = await Promise.all([this.poolState(cores), this.syncTrades()]);
    const list = await Promise.all(cores.map((c) => { const s = state.get(c.address) ?? { sqrtP: 0n, liquidity: 0n }; return this.summarize(c, s.sqrtP, s.liquidity); }));
    if (opts?.sort === "mcap") list.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else list.sort((a, b) => b.createdAt - a.createdAt);
    return list.slice(0, opts?.limit ?? 120);
  }

  async getToken(token: string): Promise<StockToken | null> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    if (!core) return null;
    const [state] = await Promise.all([this.poolState([core]), this.syncTrades()]);
    const s = state.get(core.address) ?? { sqrtP: 0n, liquidity: 0n };
    return this.summarize(core, s.sqrtP, s.liquidity);
  }

  async getTrades(token: string, opts?: { limit?: number }): Promise<TradeRecord[]> {
    const t = await this.tradesOf(token as Address);
    return [...t].reverse().slice(0, opts?.limit ?? 60);
  }

  async getCandles(token: string, interval: CandleInterval, opts?: { limit?: number }): Promise<Candle[]> {
    const trades = await this.tradesOf(token as Address);
    const span = INTERVAL_SECONDS[interval];
    const buckets = new Map<number, Candle>();
    for (const t of trades) {
      const b = Math.floor(t.timestamp / span) * span;
      const price = Number(t.priceWei) / 1e18, vol = Number(t.nativeAmountWei) / 1e18;
      const c = buckets.get(b);
      if (!c) buckets.set(b, { time: b, open: String(price), high: String(price), low: String(price), close: String(price), volume: String(vol) });
      else { c.high = String(Math.max(Number(c.high), price)); c.low = String(Math.min(Number(c.low), price)); c.close = String(price); c.volume = String(Number(c.volume) + vol); }
    }
    const arr = [...buckets.values()].sort((a, b) => a.time - b.time);
    if (arr.length === 0) return arr;
    const limit = opts?.limit ?? 400;
    const now = Math.max(Math.floor(Date.now() / 1000 / span) * span, arr[arr.length - 1].time);
    const start = Math.max(arr[0].time, now - span * (limit - 1));
    let prev = arr[0].open;
    for (const c of arr) { if (c.time < start) prev = c.close; else break; }
    const filled: Candle[] = [];
    let i = arr.findIndex((c) => c.time >= start);
    if (i < 0) i = arr.length;
    for (let t = start; t <= now; t += span) {
      const c = i < arr.length && arr[i].time === t ? arr[i++] : null;
      if (c) { c.open = prev; c.high = String(Math.max(Number(c.high), Number(prev))); c.low = String(Math.min(Number(c.low), Number(prev))); filled.push(c); prev = c.close; }
      else filled.push({ time: t, open: prev, high: prev, low: prev, close: prev, volume: "0" });
    }
    return filled.slice(-limit);
  }

  // -- holders: Transfer scan per coin, only when a token page asks ----------

  private ingestTransfers(bal: Map<string, bigint>, logs: any[]) {
    for (const l of logs) {
      const f = String(l.args.from).toLowerCase(), t = String(l.args.to).toLowerCase(), v = l.args.value as bigint;
      bal.set(f, (bal.get(f) ?? 0n) - v);
      bal.set(t, (bal.get(t) ?? 0n) + v);
    }
  }

  private persistBal(token: string, s: Scan<Map<string, bigint>>) {
    store.set(`bal.${token}`, { lo: s.lo.toString(), hi: s.hi.toString(), bal: Object.fromEntries([...s.data.entries()].filter(([, v]) => v !== 0n).map(([a, v]) => [a, v.toString()])) } satisfies BalStore);
  }

  private syncBalances(token: Address): Promise<void> {
    const key = token.toLowerCase();
    const inflight = this.balInflight.get(key);
    if (inflight) return inflight;
    const p = this.syncBalancesInner(key).catch(() => undefined).finally(() => this.balInflight.delete(key));
    this.balInflight.set(key, p);
    return p;
  }

  private async syncBalancesInner(key: string) {
    const core = this.cores.get(key);
    if (!core) return;
    let s = this.bals.get(key);
    if (!s) {
      const saved = store.get<BalStore>(`bal.${key}`);
      s = saved ? { lo: BigInt(saved.lo), hi: BigInt(saved.hi), data: new Map(Object.entries(saved.bal).map(([a, v]) => [a, BigInt(v)])) } : { lo: 0n, hi: 0n, data: new Map() };
      this.bals.set(key, s);
    }
    const head = await this.headInfo();
    const retained = head.block > RETAIN ? head.block - RETAIN : 0n;
    const floor = core.launchBlock > retained ? core.launchBlock : retained;
    let from: bigint;
    if (s.hi === 0n) from = head.block - INITIAL > floor ? head.block - INITIAL : floor;
    else { from = s.hi + 1n; if (from > head.block) { this.backfillBalances(key); return; } }
    const logs = await this.scanRange([core.address], transferEvent, from, head.block);
    this.ingestTransfers(s.data, logs);
    if (s.lo === 0n) s.lo = from;
    s.hi = head.block;
    this.persistBal(key, s);
    this.backfillBalances(key);
  }

  private backfillBalances(key: string) {
    if (this.balBackfilling.has(key) || typeof window === "undefined") return;
    const core = this.cores.get(key), s = this.bals.get(key);
    if (!core || !s) return;
    this.balBackfilling.add(key);
    const step = async () => {
      try {
        const retained = s.hi > RETAIN ? s.hi - RETAIN : 0n;
        const floor = core.launchBlock > retained ? core.launchBlock : retained;
        if (s.lo <= floor || s.lo === 0n) { this.balBackfilling.delete(key); return; }
        const to = s.lo - 1n;
        const from = to - LOG_CHUNK > floor ? to - LOG_CHUNK : floor;
        const logs = await this.getLogsRange([core.address], transferEvent, from, to).catch(() => null);
        if (logs === null) { s.lo = floor; this.balBackfilling.delete(key); return; }
        this.ingestTransfers(s.data, logs);
        s.lo = from;
        this.persistBal(key, s);
        setTimeout(step, 250);
      } catch { this.balBackfilling.delete(key); }
    };
    setTimeout(step, 300);
  }

  private holderEntries(core: Core, bal: Map<string, bigint>): [string, bigint][] {
    const skip = new Set([core.pool, ADDRESSES.factory.toLowerCase(), ADDRESSES.router.toLowerCase(), ZERO]);
    return [...bal.entries()].filter(([a, b]) => b > 0n && !skip.has(a)).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  }

  async getHolders(token: string, opts?: { limit?: number }): Promise<HolderRecord[]> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    if (!core) return [];
    await this.syncBalances(token as Address);
    const s = this.bals.get(core.address);
    if (!s) return [];
    const total = 1e9;
    return this.holderEntries(core, s.data).slice(0, opts?.limit ?? 30)
      .map(([address, b]) => ({ address: address as Address, balance: b.toString(), pct: (Number(b) / 1e18 / total) * 100 }));
  }

  subscribeToTrades(token: string, cb: (t: TradeRecord) => void): () => void {
    const seen = new Set<string>();
    let seeded = false;
    const tick = () => this.tradesOf(token as Address).then((tr) => {
      if (!seeded) { for (const r of tr) seen.add(r.id); seeded = true; return; }
      for (const r of tr) if (!seen.has(r.id)) { seen.add(r.id); cb(r); }
    }).catch(() => undefined);
    void tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }

  // -- fees ---------------------------------------------------------------

  /** Fees sitting in a coin's pool position, in native USDC wei: creator share and platform share. */
  private async pendingSplit(tokens: Address[]): Promise<Map<string, { creator: bigint; platform: bigint }>> {
    if (tokens.length === 0) return new Map();
    const res = await readGate.run(() => this.pc.multicall({ allowFailure: true, contracts: tokens.map((t) => ({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "pendingFees" as const, args: [t] as const })) as any }));
    return new Map(tokens.map((t, i) => {
      const r = res[i];
      const quote = r.status === "success" ? ((r.result as unknown as readonly [bigint, bigint])[1] ?? 0n) * NATIVE_PER_QUOTE : 0n;
      const creator = (quote * CREATOR_BPS) / 10_000n;
      return [t.toLowerCase(), { creator, platform: quote - creator }];
    }));
  }

  async rewards(token: Address, account?: Address): Promise<RewardsView> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    const [split, balance] = await Promise.all([
      this.pendingSplit([token]),
      account ? readGate.run(() => this.pc.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [account] }) as Promise<bigint>).catch(() => 0n) : Promise.resolve(0n),
    ]);
    const s = split.get(token.toLowerCase()) ?? { creator: 0n, platform: 0n };
    const trades = core ? this.tr.data.get(core.pool) ?? [] : [];
    const fees = (trades.reduce((a, t) => a + BigInt(t.nativeAmountWei), 0n) * FEE_BPS) / 10_000n;
    const totalCreator = (fees * CREATOR_BPS) / 10_000n;
    return {
      pending: 0n, creatorFees: s.creator, platformFees: s.platform, totalHolder: 0n, totalCreator, totalPlatform: fees - totalCreator,
      isCreator: !!account && !!core && core.creator === account.toLowerCase(), balance,
    };
  }

  /** No holder rewards on Arc: the pool fee is split creator / platform only. */
  async claimRewards(): Promise<Hex> { throw new Error("This launchpad has no holder rewards."); }

  /** Harvest a coin's pool fees: the creator and the platform are both paid in the same call. */
  async claimCreatorFees(token: Address, _asEth?: boolean): Promise<Hex> {
    const wc = this.wallet();
    return wc.writeContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "harvestFees", args: [token], chain: wc.chain, account: wc.account! });
  }

  async claimPlatformFees(token: Address): Promise<Hex> {
    return this.claimCreatorFees(token);
  }

  /** Harvest many coins in one transaction; coins with nothing waiting are skipped. */
  async pushPlatformFees(tokens: Address[]): Promise<Hex> {
    const wc = this.wallet();
    return wc.writeContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "harvestMany", args: [tokens], chain: wc.chain, account: wc.account! });
  }

  /** Platform share waiting in each coin's pool, in native USDC wei. */
  async platformWaiting(tokens: Address[]): Promise<Map<string, bigint>> {
    const split = await this.pendingSplit(tokens);
    return new Map([...split.entries()].map(([k, v]) => [k, v.platform]));
  }

  // -- trading ------------------------------------------------------------

  private async ensureAllowance(erc: Address, spender: Address, amount: bigint) {
    const me = this.me();
    const have = (await this.pc.readContract({ address: erc, abi: tokenAbi, functionName: "allowance", args: [me, spender] })) as bigint;
    if (have >= amount) return;
    const wc = this.wallet();
    const h = await wc.writeContract({ address: erc, abi: tokenAbi, functionName: "approve", args: [spender, 2n ** 256n - 1n], chain: wc.chain, account: wc.account! });
    await this.pc.waitForTransactionReceipt({ hash: h });
  }

  /** Storage slot of `allowance[owner][spender]` on the launch token (OpenZeppelin ERC20: mapping at slot 1). */
  private allowanceSlot(owner: Address, spender: Address): Hex {
    const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner, 1n]));
    return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, inner]));
  }

  /** Simulate a buy (USDC in) or sell (coins in), returning the exact fill.
   *  Sells are simulated with the allowance overridden, so no approval is needed to see a quote. */
  async previewSwapOut(token: Address, side: "buy" | "sell", amountIn: bigint): Promise<bigint | null> {
    if (amountIn <= 0n) return 0n;
    const me = this.wc?.account?.address as Address | undefined;
    if (!me) return null;
    try {
      if (side === "buy") {
        const { result } = await this.pc.simulateContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "buy", args: [token, 0n], value: amountIn, account: me });
        return result as bigint;
      }
      const { result } = await this.pc.simulateContract({
        address: ADDRESSES.router, abi: routerAbi, functionName: "sell", args: [token, amountIn, 0n], account: me,
        stateOverride: [{ address: token, stateDiff: [{ slot: this.allowanceSlot(me, ADDRESSES.router), value: `0x${"ff".repeat(32)}` as Hex }] }],
      });
      return result as bigint;
    } catch {
      return null;
    }
  }

  /** Buy with native USDC. `amountIn` is native wei (18-dp); `minOut` is coin wei. */
  async buyToken(token: Address, amountIn: bigint, minOut: bigint): Promise<Hex> {
    const wc = this.wallet();
    return wc.writeContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "buy", args: [token, minOut], value: amountIn, chain: wc.chain, account: wc.account! });
  }

  /** Sell coins for native USDC. `minOut` is native wei (18-dp). */
  async sellToken(token: Address, amountIn: bigint, minOut: bigint): Promise<Hex> {
    const wc = this.wallet();
    await this.ensureAllowance(token, ADDRESSES.router, amountIn);
    return wc.writeContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "sell", args: [token, amountIn, minOut], chain: wc.chain, account: wc.account! });
  }

  // -- launch -------------------------------------------------------------

  private launchArgs(p: { name: string; symbol: string; metadataURI: string }) {
    return [{ name: p.name, symbol: p.symbol, metadataURI: p.metadataURI, quote: ADDRESSES.weth, marketCapUsd8: 0n }] as const;
  }

  /** Launch a coin. The whole supply goes into a USDC pool at the default market cap.
   *  A first buy is a separate router transaction right after (see Launch page). */
  async createToken(p: { name: string; symbol: string; metadataURI: string; pair: Address; devBuyWei?: bigint }): Promise<Hex> {
    const wc = this.wallet();
    return wc.writeContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "createToken", args: this.launchArgs(p), chain: wc.chain, account: wc.account! });
  }

  /** Gas estimate for a launch, so the form can warn before a wallet prompt. */
  async estimateLaunch(p: { name: string; symbol: string; metadataURI: string; pair: Address; devBuyWei?: bigint }, from: Address): Promise<bigint> {
    return this.pc.estimateContractGas({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "createToken", args: this.launchArgs(p), account: from });
  }

  /** The coin a launch transaction created, from its TokenCreated log. */
  async launchedToken(hash: Hex): Promise<Address | null> {
    const rc = await this.pc.getTransactionReceipt({ hash }).catch(() => null);
    if (!rc) return null;
    const log = rc.logs.find((l) => l.address.toLowerCase() === ADDRESSES.factory.toLowerCase() && l.topics[0] === TOKEN_CREATED_TOPIC);
    return log?.topics[1] ? (`0x${log.topics[1].slice(26)}`.toLowerCase() as Address) : null;
  }

  // -- admin --------------------------------------------------------------

  async config(): Promise<ConfigView> {
    const [owner, feeRecipient, paused, creatorBps, feeTier, total] = (await readGate.run(() => this.pc.multicall({ allowFailure: false, contracts: [
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "owner" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "feeRecipient" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "launchesPaused" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "CREATOR_FEE_BPS" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "POOL_FEE_TIER" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "totalTokens" },
    ] }))) as [Address, Address, boolean, number, number, bigint];
    return { admin: owner, owner, feeRecipient, paused, taxBps: Number(feeTier) / 10, creatorBps: Number(creatorBps), holderBps: 0, ethUsd: 1, converter: ZERO, totalTokens: Number(total) };
  }

  async adminCall(fn: "pause" | "resume" | "setFeeRecipient" | "setQuoteAsset" | "collect", args: unknown[] = []): Promise<Hex> {
    const wc = this.wallet();
    return wc.writeContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: fn as any, args: args as any, chain: wc.chain, account: wc.account! });
  }

  async holdersWithPending(): Promise<{ address: Address; pending: bigint }[]> { return []; }
  async pushRewards(): Promise<Hex> { throw new Error("This launchpad has no holder rewards."); }

  /** The pool fee is fixed per coin: the tier's 1%. */
  async feeNow(_token?: Address): Promise<{ total: number; base: number }> {
    return { total: FEES.taxPct * 100, base: FEES.taxPct * 100 };
  }
}

export let client = new StockPadClient(publicClient);
/** Swap the live client for another (the preview build's sample-data client). */
export function setClient(c: StockPadClient) { client = c; }
