import { createPublicClient, encodeAbiParameters, fallback, getAbiItem, http, keccak256, parseAbi, toEventSelector, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import type { Candle, CandleInterval, HolderRecord, TokenSummary, TradeRecord } from "@launchpad/sdk";
import { INTERVAL_SECONDS } from "@launchpad/sdk";

import { ADDRESSES, chain, env, FEES } from "./env";

export const publicClient = createPublicClient({
  chain,
  transport: fallback(
    env.rpcUrls.map((url) => http(url, { retryCount: 1, retryDelay: 200, timeout: 8_000, batch: { wait: 16, batchSize: 20 } })),
    { rank: { interval: 30_000, sampleCount: 5 } },
  ),
  pollingInterval: 4_000,
  batch: { multicall: { wait: 24 } },
}) as PublicClient;

/** Read-only client for eth_getLogs. The public Arc RPC allows about 5,000
 *  blocks per request and keeps roughly a million blocks of history. */
export const logClient = createPublicClient({
  chain,
  transport: fallback(env.logRpcUrls.map((url) => http(url, { retryCount: 2, retryDelay: 500, timeout: 30_000, batch: false }))),
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
const CONCURRENCY = 6;
const CREATOR_BPS = BigInt(FEES.creatorPct * 100);

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
  "event FeesCollected(address indexed token, address indexed creator, uint256 creatorTokenAmount, uint256 creatorQuoteAmount, uint256 platformTokenAmount, uint256 platformQuoteAmount)",
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
const tokenCreatedEvent = getAbiItem({ abi: factoryAbi, name: "TokenCreated" });
const feesCollectedEvent = getAbiItem({ abi: factoryAbi, name: "FeesCollected" });
const swapEvent = getAbiItem({ abi: poolAbi, name: "Swap" });
const transferEvent = getAbiItem({ abi: tokenAbi, name: "Transfer" });
const TOKEN_CREATED_TOPIC = toEventSelector(tokenCreatedEvent);

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
  /** Lifetime pair-asset paid to holders / creator / platform (18-dp wei). */
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
const STORE_PREFIX = `arcx.${ADDRESSES.factory.slice(2, 10).toLowerCase()}.`;
const store = {
  get<T>(key: string): T | null {
    try { const raw = globalThis.localStorage?.getItem(STORE_PREFIX + key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
  },
  set(key: string, value: unknown) {
    try { globalThis.localStorage?.setItem(STORE_PREFIX + key, JSON.stringify(value)); } catch { /* quota or private mode */ }
  },
};

interface FactoryScan { upTo: string; launch: Record<string, string>; fees: Record<string, { c: string; p: string }> }

/** Run `fn` over [from, to] in LOG_CHUNK windows, a few at a time. Pruned or
 *  failing windows are skipped so one bad range does not empty the result. */
async function scanRange<T>(from: bigint, to: bigint, fn: (a: bigint, b: bigint) => Promise<T[]>): Promise<T[]> {
  const windows: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += LOG_CHUNK + 1n) windows.push([a, a + LOG_CHUNK > to ? to : a + LOG_CHUNK]);
  const out: T[] = [];
  for (let i = 0; i < windows.length; i += CONCURRENCY) {
    const part = await Promise.all(windows.slice(i, i + CONCURRENCY).map(([a, b]) => fn(a, b).catch(() => [] as T[])));
    for (const p of part) out.push(...p);
  }
  return out;
}

/** Backend-free client for the Arc launchpad: coins, prices, trades and fees
 *  come straight from the factory, the Uniswap V3 pools and the coins;
 *  trades go through ArcSwapRouter in native USDC. */
export class StockPadClient {
  readonly pc: PublicClient;
  private wc?: WalletClient;
  private cores = new Map<string, Core>();
  private coresUpTo = 0n;
  private coresInflight: Promise<Core[]> | null = null;
  private scan: FactoryScan = store.get<FactoryScan>("factory") ?? { upTo: "0", launch: {}, fees: {} };
  private scanInflight: Promise<void> | null = null;
  private trades = new Map<string, { records: TradeRecord[]; upTo: bigint }>();
  private tradesInflight = new Map<string, Promise<TradeRecord[]>>();
  private balances = new Map<string, { bal: Map<string, bigint>; upTo: bigint }>();
  private balancesInflight = new Map<string, Promise<Map<string, bigint>>>();
  private blockAnchor?: { block: bigint; ts: number };

  constructor(pc: PublicClient) {
    this.pc = pc;
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

  // -- factory log scan: launch blocks and lifetime fee payouts ------------

  private scanFactory(latest: bigint): Promise<void> {
    if (this.scanInflight) return this.scanInflight;
    this.scanInflight = this.scanFactoryInner(latest).finally(() => (this.scanInflight = null));
    return this.scanInflight;
  }

  private async scanFactoryInner(latest: bigint) {
    const upTo = BigInt(this.scan.upTo);
    let from = upTo > 0n ? upTo + 1n : env.startBlock;
    if (from < latest - RETAIN) from = latest - RETAIN;
    if (from > latest) return;
    const logs = await scanRange(from, latest, (a, b) => logClient.getLogs({ address: ADDRESSES.factory, events: [tokenCreatedEvent, feesCollectedEvent] as any, fromBlock: a, toBlock: b }) as Promise<any[]>);
    for (const l of logs) {
      const token = String(l.args.token).toLowerCase();
      if (l.eventName === "TokenCreated") this.scan.launch[token] = String(l.blockNumber);
      else if (l.eventName === "FeesCollected") {
        const cur = this.scan.fees[token] ?? { c: "0", p: "0" };
        this.scan.fees[token] = { c: (BigInt(cur.c) + (l.args.creatorQuoteAmount as bigint)).toString(), p: (BigInt(cur.p) + (l.args.platformQuoteAmount as bigint)).toString() };
      }
    }
    this.scan.upTo = latest.toString();
    store.set("factory", this.scan);
  }

  // -- discovery ---------------------------------------------------------

  private loadCores(): Promise<Core[]> {
    if (this.coresInflight) return this.coresInflight;
    this.coresInflight = this.loadCoresInner().finally(() => (this.coresInflight = null));
    return this.coresInflight;
  }

  private async loadCoresInner(): Promise<Core[]> {
    const latest = await this.pc.getBlockNumber().catch(() => 0n);
    if (latest === 0n || (this.coresUpTo !== 0n && latest <= this.coresUpTo)) return [...this.cores.values()];
    const total = Number(await this.pc.readContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "totalTokens" }).catch(() => 0n));
    if (total > this.cores.size) {
      const addrs = (await this.pc.multicall({
        allowFailure: false,
        contracts: Array.from({ length: total }, (_, i) => ({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "allTokens", args: [BigInt(i)] })),
      })) as Address[];
      const fresh = addrs.filter((a) => !this.cores.has(a.toLowerCase()));
      if (fresh.length) await this.scanFactory(latest).catch(() => undefined);
      for (const raw of fresh) {
        const token = raw.toLowerCase() as Address;
        try {
          const [listing, name, symbol, metaURI] = (await this.pc.multicall({
            allowFailure: false,
            contracts: [
              { address: ADDRESSES.factory, abi: factoryAbi, functionName: "listings", args: [token] },
              { address: token, abi: tokenAbi, functionName: "name" },
              { address: token, abi: tokenAbi, functionName: "symbol" },
              { address: token, abi: tokenAbi, functionName: "metadataURI" },
            ],
          })) as [readonly [Address, Address, Address, number, number, bigint, boolean], string, string, string];
          let metadata: Record<string, unknown> = {};
          try { metadata = JSON.parse(metaURI); } catch { metadata = { description: metaURI }; }
          const launch = this.scan.launch[token];
          this.cores.set(token, {
            address: token, creator: listing[0].toLowerCase() as Address, pair: listing[1].toLowerCase() as Address, pool: listing[2].toLowerCase() as Address,
            tickLower: Number(listing[3]), tickUpper: Number(listing[4]), createdAt: Number(listing[5]), tokenIsToken0: listing[6],
            launchBlock: launch ? BigInt(launch) : this.blockFromTimestamp(Number(listing[5]), latest),
            name, symbol, metadata,
          });
        } catch { /* picked up next refresh */ }
      }
    }
    this.coresUpTo = latest;
    return [...this.cores.values()];
  }

  /** Rough block for a timestamp when the launch log is out of reach. */
  private blockFromTimestamp(ts: number, latest: bigint): bigint {
    const anchorTs = this.blockAnchor?.ts ?? Math.floor(Date.now() / 1000);
    const back = BigInt(Math.max(0, Math.round((anchorTs - ts) / env.secondsPerBlock)));
    return back >= latest ? 0n : latest - back;
  }

  private async blockTs(block: bigint, latest: bigint): Promise<number> {
    if (!this.blockAnchor || this.blockAnchor.block !== latest) {
      const b = await this.pc.getBlock({ blockNumber: latest }).catch(() => null);
      this.blockAnchor = { block: latest, ts: b ? Number(b.timestamp) : Math.floor(Date.now() / 1000) };
    }
    return this.blockAnchor.ts - Math.round(Number(latest - block) * env.secondsPerBlock);
  }

  // -- pricing ------------------------------------------------------------

  /** Native USDC wei (18-dp) per whole coin from a pool sqrtPriceX96. */
  private priceFromSqrt(sqrtP: bigint, tokenIsToken0: boolean): bigint {
    if (sqrtP === 0n) return 0n;
    const scale = 10n ** 18n * NATIVE_PER_QUOTE;
    return tokenIsToken0 ? (sqrtP * sqrtP * scale) / Q192 : (Q192 * scale) / (sqrtP * sqrtP);
  }

  private async slot0(pool: Address): Promise<bigint> {
    try {
      const [sqrtP] = (await this.pc.readContract({ address: pool, abi: poolAbi, functionName: "slot0" })) as readonly [bigint, number, number, number, number, number, boolean];
      return sqrtP;
    } catch {
      return 0n;
    }
  }

  async assetUsdPrice(): Promise<number> { return 1; }
  async ethUsd(): Promise<number> { return 1; }
  async pairInfo(_pair?: Address): Promise<PairInfo> { return USDC_PAIR; }
  async pairOf(_token?: Address): Promise<PairInfo> { return USDC_PAIR; }
  async quotes(): Promise<QuoteView[]> { return [{ ...USDC_PAIR, approved: true, liqUsd: 0, vol24Usd: 0 }]; }

  // -- trades -------------------------------------------------------------

  private loadTrades(token: Address): Promise<TradeRecord[]> {
    const key = token.toLowerCase();
    const inflight = this.tradesInflight.get(key);
    if (inflight) return inflight;
    const p = this.loadTradesInner(token).finally(() => this.tradesInflight.delete(key));
    this.tradesInflight.set(key, p);
    return p;
  }

  private async loadTradesInner(token: Address): Promise<TradeRecord[]> {
    await this.loadCores();
    const key = token.toLowerCase();
    const core = this.cores.get(key);
    if (!core) return [];
    let cached = this.trades.get(key);
    if (!cached) {
      const saved = store.get<{ upTo: string; records: TradeRecord[] }>(`trades.${key}`);
      if (saved) { cached = { records: saved.records, upTo: BigInt(saved.upTo) }; this.trades.set(key, cached); }
    }
    try {
      const latest = await this.pc.getBlockNumber();
      let fromBlock = cached ? cached.upTo + 1n : core.launchBlock;
      if (fromBlock < latest - RETAIN) fromBlock = latest - RETAIN;
      if (cached && fromBlock > latest) return cached.records;
      const logs = await scanRange(fromBlock, latest, (a, b) => logClient.getLogs({ address: core.pool, event: swapEvent, fromBlock: a, toBlock: b }) as Promise<any[]>);
      const abs = (v: bigint) => (v < 0n ? -v : v);
      const fresh: TradeRecord[] = logs.map((log) => {
        const a0 = log.args.amount0 as bigint, a1 = log.args.amount1 as bigint;
        // V3 deltas are the pool's: positive came in, negative went out.
        const quoteDelta = core.tokenIsToken0 ? a1 : a0;
        const tokenDelta = core.tokenIsToken0 ? a0 : a1;
        const quoteWei = abs(quoteDelta) * NATIVE_PER_QUOTE;
        return {
          id: `${log.transactionHash}-${log.logIndex}`, token: core.address, trader: String(log.args.recipient).toLowerCase() as Address,
          isBuy: tokenDelta < 0n, nativeAmountWei: quoteWei.toString(), tokenAmount: abs(tokenDelta).toString(),
          feeWei: ((quoteWei * BigInt(FEES.taxPct * 100)) / 10_000n).toString(),
          priceWei: this.priceFromSqrt(log.args.sqrtPriceX96 as bigint, core.tokenIsToken0).toString(),
          blockNumber: Number(log.blockNumber), txHash: log.transactionHash, timestamp: 0,
        };
      }).sort((a, b) => a.blockNumber - b.blockNumber || a.id.localeCompare(b.id));
      // Real timestamps for the blocks that carry trades (bounded), the block-time estimate for the rest.
      const blocks = [...new Set(fresh.map((r) => r.blockNumber))].slice(-120);
      const stamps = new Map<number, number>();
      const got = await Promise.allSettled(blocks.map((b) => this.pc.getBlock({ blockNumber: BigInt(b) })));
      got.forEach((r, i) => { if (r.status === "fulfilled") stamps.set(blocks[i], Number(r.value.timestamp)); });
      for (const r of fresh) r.timestamp = stamps.get(r.blockNumber) ?? (await this.blockTs(BigInt(r.blockNumber), latest));
      // Buys land on the buyer directly; sells pay the router first, so attribute those to the sender.
      const router = ADDRESSES.router.toLowerCase();
      const viaRouter = fresh.filter((r) => r.trader === router);
      if (viaRouter.length) {
        const hashes = [...new Set(viaRouter.map((r) => r.txHash))].slice(-150);
        const txs = await Promise.allSettled(hashes.map((h) => this.pc.getTransaction({ hash: h as Hex })));
        const from = new Map<string, Address>();
        txs.forEach((r, i) => { if (r.status === "fulfilled" && r.value?.from) from.set(hashes[i], r.value.from.toLowerCase() as Address); });
        for (const r of viaRouter) r.trader = from.get(r.txHash) ?? r.trader;
      }
      let records = fresh;
      if (cached) {
        const seen = new Set(cached.records.map((r) => r.id));
        records = cached.records.concat(fresh.filter((r) => !seen.has(r.id)));
      }
      this.trades.set(key, { records, upTo: latest });
      store.set(`trades.${key}`, { upTo: latest.toString(), records: records.slice(-2000) });
      return records;
    } catch {
      return cached?.records ?? [];
    }
  }

  // -- summaries ----------------------------------------------------------

  private async summarize(core: Core): Promise<StockToken> {
    const [trades, sqrtP] = await Promise.all([this.loadTrades(core.address), this.slot0(core.pool)]);
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
    let holderCount = new Set(trades.filter((t) => t.isBuy).map((t) => t.trader)).size;
    try { holderCount = this.holderEntries(core, await this.loadBalances(core.address)).length; } catch { /* fallback above */ }

    // Liquidity: both legs of the launch position at the live price, in USDC wei
    // (the coin leg converted at spot, the way Dexscreener reports it).
    let liquidityWei = 0n;
    let reserves: StockToken["reserves"];
    try {
      const L = Number(await this.pc.readContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "positionLiquidity", args: [core.address] }));
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
    } catch { /* dash */ }

    const paid = this.scan.fees[core.address];
    const rewards = { holders: 0n, creator: paid ? BigInt(paid.c) * NATIVE_PER_QUOTE : 0n, platform: paid ? BigInt(paid.p) * NATIVE_PER_QUOTE : 0n };

    return {
      address: core.address, name: core.name, symbol: core.symbol, creator: core.creator, pool: core.pool, feeTier: FEES.taxPct * 100,
      createdAt: core.createdAt, featured: false, metadata: core.metadata as any, totalSupply: TOTAL_SUPPLY.toString(),
      priceWei: priceWei.toString(), priceUsd: String(priceUsd), marketCapUsd: String(mcap), liquidityWei: liquidityWei.toString(),
      volume24hWei: vol24.toString(), volumeTotalWei: volTotal.toString(), txCount24h: day.length, holderCount,
      limitsActive: false, remainingToGraduationUsd: "0", priceChange24hPct: change,
      pair, poolId: core.pool as Hex, launchBlock: Number(core.launchBlock), rewards, reserves,
    };
  }

  async getTokens(opts?: { sort?: string; limit?: number }): Promise<StockToken[]> {
    const cores = await this.loadCores();
    const settled = await Promise.allSettled(cores.map((c) => this.summarize(c)));
    const list = settled.filter((r): r is PromiseFulfilledResult<StockToken> => r.status === "fulfilled").map((r) => r.value);
    if (opts?.sort === "mcap") list.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else list.sort((a, b) => b.createdAt - a.createdAt);
    return list.slice(0, opts?.limit ?? 120);
  }

  async getToken(token: string): Promise<StockToken | null> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    return core ? this.summarize(core) : null;
  }

  async getTrades(token: string, opts?: { limit?: number }): Promise<TradeRecord[]> {
    const t = await this.loadTrades(token as Address);
    return [...t].reverse().slice(0, opts?.limit ?? 60);
  }

  async getCandles(token: string, interval: CandleInterval, opts?: { limit?: number }): Promise<Candle[]> {
    const trades = await this.loadTrades(token as Address);
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

  /** Wallet balances from Transfer logs (incremental, persisted). */
  private loadBalances(token: Address): Promise<Map<string, bigint>> {
    const key = token.toLowerCase();
    const inflight = this.balancesInflight.get(key);
    if (inflight) return inflight;
    const p = this.loadBalancesInner(token).finally(() => this.balancesInflight.delete(key));
    this.balancesInflight.set(key, p);
    return p;
  }

  private async loadBalancesInner(token: Address): Promise<Map<string, bigint>> {
    await this.loadCores();
    const key = token.toLowerCase();
    const core = this.cores.get(key);
    if (!core) return new Map();
    let cached = this.balances.get(key);
    if (!cached) {
      const saved = store.get<{ upTo: string; bal: Record<string, string> }>(`bal.${key}`);
      if (saved) { cached = { bal: new Map(Object.entries(saved.bal).map(([a, v]) => [a, BigInt(v)])), upTo: BigInt(saved.upTo) }; this.balances.set(key, cached); }
    }
    const bal = cached ? new Map(cached.bal) : new Map<string, bigint>();
    try {
      const latest = await this.pc.getBlockNumber();
      let fromBlock = cached ? cached.upTo + 1n : core.launchBlock;
      if (fromBlock < latest - RETAIN) fromBlock = latest - RETAIN;
      if (fromBlock > latest) return bal;
      const logs = await scanRange(fromBlock, latest, (a, b) => logClient.getLogs({ address: token, event: transferEvent, fromBlock: a, toBlock: b }) as Promise<any[]>);
      for (const l of logs) {
        const f = String(l.args.from).toLowerCase(), t = String(l.args.to).toLowerCase(), v = l.args.value as bigint;
        bal.set(f, (bal.get(f) ?? 0n) - v);
        bal.set(t, (bal.get(t) ?? 0n) + v);
      }
      this.balances.set(key, { bal, upTo: latest });
      store.set(`bal.${key}`, { upTo: latest.toString(), bal: Object.fromEntries([...bal.entries()].filter(([, v]) => v !== 0n).map(([a, v]) => [a, v.toString()])) });
    } catch { /* keep whatever we had */ }
    return bal;
  }

  private holderEntries(core: Core, bal: Map<string, bigint>): [string, bigint][] {
    const skip = new Set([core.pool, ADDRESSES.factory.toLowerCase(), ADDRESSES.router.toLowerCase(), ZERO]);
    return [...bal.entries()].filter(([a, b]) => b > 0n && !skip.has(a)).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  }

  async getHolders(token: string, opts?: { limit?: number }): Promise<HolderRecord[]> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    if (!core) return [];
    const [bal, supply] = await Promise.all([this.loadBalances(token as Address), this.pc.readContract({ address: token as Address, abi: tokenAbi, functionName: "totalSupply" }) as Promise<bigint>]);
    const total = Number(supply) / 1e18 || 1e9;
    return this.holderEntries(core, bal).slice(0, opts?.limit ?? 30)
      .map(([address, b]) => ({ address: address as Address, balance: b.toString(), pct: (Number(b) / 1e18 / total) * 100 }));
  }

  subscribeToTrades(token: string, cb: (t: TradeRecord) => void): () => void {
    const seen = new Set<string>();
    let seeded = false;
    const tick = () => this.loadTrades(token as Address).then((tr) => {
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
    const res = await this.pc.multicall({ allowFailure: true, contracts: tokens.map((t) => ({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "pendingFees" as const, args: [t] as const })) as any });
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
      account ? (this.pc.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [account] }) as Promise<bigint>).catch(() => 0n) : Promise.resolve(0n),
    ]);
    const s = split.get(token.toLowerCase()) ?? { creator: 0n, platform: 0n };
    const paid = this.scan.fees[token.toLowerCase()];
    return {
      pending: 0n, creatorFees: s.creator, platformFees: s.platform, totalHolder: 0n,
      totalCreator: paid ? BigInt(paid.c) * NATIVE_PER_QUOTE : 0n, totalPlatform: paid ? BigInt(paid.p) * NATIVE_PER_QUOTE : 0n,
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
    const [owner, feeRecipient, paused, creatorBps, feeTier, total] = (await this.pc.multicall({ allowFailure: false, contracts: [
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "owner" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "feeRecipient" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "launchesPaused" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "CREATOR_FEE_BPS" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "POOL_FEE_TIER" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "totalTokens" },
    ] })) as [Address, Address, boolean, number, number, bigint];
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
