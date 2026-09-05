import { createPublicClient, fallback, http, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import type { Candle, CandleInterval, HolderRecord, TokenSummary, TradeRecord } from "@launchpad/sdk";
import { INTERVAL_SECONDS } from "@launchpad/sdk";

import { factoryAbi, hookAbi, routerAbi, tokenAbi } from "./abis";
import { ADDRESSES, chain, env } from "./env";
import { hasEthRoute, routeFor, stockByAddress, WETH } from "./stocks";

export const publicClient = createPublicClient({
  chain,
  transport: fallback(
    env.rpcUrls.map((url) => http(url, { retryCount: 1, retryDelay: 200, timeout: 8_000, batch: { wait: 16, batchSize: 20 } })),
    { rank: { interval: 30_000, sampleCount: 5 } },
  ),
  pollingInterval: 12_000,
  batch: { multicall: { wait: 24 } },
}) as PublicClient;

const Q96 = 2n ** 96n;
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const LOG_CHUNK = 5_000n;

const stateViewAbi = parseAbi(["function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);
const swapEvent = {
  type: "event", name: "Swap",
  inputs: [
    { name: "id", type: "bytes32", indexed: true }, { name: "sender", type: "address", indexed: true },
    { name: "amount0", type: "int128", indexed: false }, { name: "amount1", type: "int128", indexed: false },
    { name: "sqrtPriceX96", type: "uint160", indexed: false }, { name: "liquidity", type: "uint128", indexed: false },
    { name: "tick", type: "int24", indexed: false }, { name: "fee", type: "uint24", indexed: false },
  ],
} as const;

/** A coin's pair asset: ETH (native) or a tokenized stock. */
export interface PairInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  usd: number;
  isNative: boolean;
  /** ETH can be routed into and out of this pair on-chain. */
  ethRoute: boolean;
}

/** An approved pair on the factory, joined with the roster's liquidity data. */
export interface QuoteView extends PairInfo {
  approved: boolean;
  liqUsd: number;
  vol24Usd: number;
}

export type StockToken = TokenSummary & {
  pair: PairInfo;
  poolId: Hex;
  launchBlock: number;
  /** Lifetime pair-asset paid to holders / creator / platform. */
  rewards?: { holders: bigint; creator: bigint; platform: bigint };
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
  taxBps: number;
  poolId: Hex;
  launchBlock: bigint;
  createdAt: number;
  name: string;
  symbol: string;
  metadata: Record<string, unknown>;
  tokenIsCurrency0: boolean;
}

/** Backend-free client for the mainnet stockpad: reads coins, prices, trades
 *  and rewards straight from the factory, the V4 PoolManager and the coins;
 *  trades and launches go through the router and factory. */
export class StockPadClient {
  readonly pc: PublicClient;
  private wc?: WalletClient;
  private cores = new Map<string, Core>();
  private coresUpTo = 0n;
  private coresInflight: Promise<Core[]> | null = null;
  private trades = new Map<string, { records: TradeRecord[]; upTo: bigint }>();
  private tradesInflight = new Map<string, Promise<TradeRecord[]>>();
  private pairUsdCache = new Map<string, { v: number; at: number }>();
  private pairMeta = new Map<string, { symbol: string; name: string; decimals: number }>();
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
      // Launch blocks come from the Launched logs (one scan, chunked).
      const launchBlocks = new Map<string, bigint>();
      if (fresh.length) {
        try {
          for (let from = env.startBlock; from <= latest; from += LOG_CHUNK + 1n) {
            const to = from + LOG_CHUNK > latest ? latest : from + LOG_CHUNK;
            const logs = await this.pc.getLogs({ address: ADDRESSES.factory, event: factoryAbi.find((f) => f.type === "event" && f.name === "Launched") as any, fromBlock: from, toBlock: to });
            for (const l of logs as any[]) launchBlocks.set(String(l.args.token).toLowerCase(), l.blockNumber as bigint);
          }
        } catch { /* fall back to the deployment start block */ }
      }
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
          })) as [readonly [Address, Address, number, bigint, Hex], string, string, string];
          let metadata: Record<string, unknown> = {};
          try { metadata = JSON.parse(metaURI); } catch { metadata = { description: metaURI }; }
          const pair = listing[1].toLowerCase() as Address;
          this.cores.set(token, {
            address: token, creator: listing[0].toLowerCase() as Address, pair, taxBps: Number(listing[2]), poolId: listing[4],
            launchBlock: launchBlocks.get(token) ?? env.startBlock, createdAt: Number(listing[3]), name, symbol, metadata,
            tokenIsCurrency0: BigInt(token) < BigInt(pair),
          });
        } catch { /* picked up next refresh */ }
      }
    }
    this.coresUpTo = latest;
    return [...this.cores.values()];
  }

  private async blockTs(block: bigint, latest: bigint): Promise<number> {
    if (!this.blockAnchor || this.blockAnchor.block !== latest) {
      const b = await this.pc.getBlock({ blockNumber: latest }).catch(() => null);
      this.blockAnchor = { block: latest, ts: b ? Number(b.timestamp) : Math.floor(Date.now() / 1000) };
    }
    return this.blockAnchor.ts - Number(latest - block) * env.secondsPerBlock;
  }

  // -- pricing ------------------------------------------------------------

  /** Pair-wei per whole coin from a pool sqrtPriceX96. */
  private priceFromSqrt(sqrtP: bigint, tokenIsCurrency0: boolean): bigint {
    if (sqrtP === 0n) return 0n;
    return tokenIsCurrency0 ? (sqrtP * sqrtP * 10n ** 18n) / (Q96 * Q96) : (Q96 * Q96 * 10n ** 18n) / (sqrtP * sqrtP);
  }

  private async slot0(poolId: Hex): Promise<bigint> {
    try {
      const [sqrtP] = (await this.pc.readContract({ address: ADDRESSES.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [poolId] })) as readonly [bigint, number, number, number];
      return sqrtP;
    } catch {
      return 0n;
    }
  }

  /** USD per whole pair token from the factory (Chainlink feed or admin price). */
  async assetUsdPrice(asset: Address): Promise<number> {
    const key = (asset === ZERO ? WETH : asset).toLowerCase();
    const hit = this.pairUsdCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.v;
    let v = 0;
    try {
      v = Number(await this.pc.readContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "pairUsdPrice", args: [key as Address] })) / 1e8;
    } catch {
      v = stockByAddress(key)?.usd ?? 0;
    }
    if (v > 0) this.pairUsdCache.set(key, { v, at: Date.now() });
    return v;
  }

  ethUsd(): Promise<number> {
    return this.assetUsdPrice(WETH);
  }

  async pairInfo(pair: Address): Promise<PairInfo> {
    const key = pair.toLowerCase() as Address;
    const isNative = key === WETH;
    const usd = await this.assetUsdPrice(key);
    if (isNative) return { address: key, symbol: "ETH", name: "Ether", decimals: 18, usd, isNative: true, ethRoute: true };
    const s = stockByAddress(key);
    let meta = this.pairMeta.get(key);
    if (!meta) {
      if (s) meta = { symbol: s.ticker, name: s.name, decimals: 18 };
      else {
        try {
          const [symbol, name, decimals] = (await this.pc.multicall({ allowFailure: false, contracts: [
            { address: key, abi: erc20Abi, functionName: "symbol" }, { address: key, abi: erc20Abi, functionName: "name" }, { address: key, abi: erc20Abi, functionName: "decimals" },
          ] })) as [string, string, number];
          meta = { symbol, name, decimals: Number(decimals) };
        } catch { meta = { symbol: key.slice(0, 8), name: "", decimals: 18 }; }
      }
      this.pairMeta.set(key, meta);
    }
    return { address: key, ...meta, usd, isNative: false, ethRoute: hasEthRoute(key) };
  }

  /** A coin's pair asset. */
  async pairOf(token: Address): Promise<PairInfo> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    return this.pairInfo(core?.pair ?? WETH);
  }

  /** Every pair the factory knows, ETH first, then by real liquidity. */
  async quotes(): Promise<QuoteView[]> {
    const n = Number(await this.pc.readContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "quoteCount" }).catch(() => 0n));
    const addrs = n === 0 ? [WETH] : ((await this.pc.multicall({
      allowFailure: true,
      contracts: Array.from({ length: n }, (_, i) => ({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "quoteList", args: [BigInt(i)] })),
    })).filter((r) => r.status === "success").map((r) => (r.result as Address).toLowerCase() as Address));
    const rows = await this.pc.multicall({
      allowFailure: true,
      contracts: addrs.map((a) => ({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "quoteAssets", args: [a] })),
    });
    const out: QuoteView[] = [];
    for (let i = 0; i < addrs.length; i++) {
      const qa: readonly [boolean, bigint, Address] = rows[i].status === "success" ? (rows[i].result as unknown as readonly [boolean, bigint, Address]) : [false, 0n, ZERO];
      const approved: boolean = qa[0];
      const usd8: bigint = qa[1];
      const s = stockByAddress(addrs[i]);
      const info = await this.pairInfo(addrs[i]);
      if (!(info.usd > 0) && usd8 > 0n) info.usd = Number(usd8) / 1e8;
      out.push({ ...info, approved, liqUsd: s?.liqUsd ?? 0, vol24Usd: s?.vol24Usd ?? 0 });
    }
    return out.sort((a, b) => (a.isNative ? -1 : b.isNative ? 1 : b.liqUsd - a.liqUsd));
  }

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
    const cached = this.trades.get(key);
    try {
      const latest = await this.pc.getBlockNumber();
      const fromBlock = cached ? cached.upTo + 1n : core.launchBlock;
      if (cached && fromBlock > latest) return cached.records;
      const logs: any[] = [];
      for (let from = fromBlock; from <= latest; from += LOG_CHUNK + 1n) {
        const to = from + LOG_CHUNK > latest ? latest : from + LOG_CHUNK;
        const part = await this.pc.getLogs({ address: ADDRESSES.poolManager, event: swapEvent, args: { id: core.poolId }, fromBlock: from, toBlock: to });
        if (part.length) logs.push(...part);
      }
      const abs = (v: bigint) => (v < 0n ? -v : v);
      const fresh: TradeRecord[] = logs.map((log) => {
        const a0 = log.args.amount0 as bigint, a1 = log.args.amount1 as bigint;
        const pairDelta = core.tokenIsCurrency0 ? a1 : a0;
        const tokenDelta = core.tokenIsCurrency0 ? a0 : a1;
        return {
          id: `${log.transactionHash}-${log.logIndex}`, token: core.address, trader: String(log.args.sender).toLowerCase() as Address,
          isBuy: tokenDelta > 0n, nativeAmountWei: abs(pairDelta).toString(), tokenAmount: abs(tokenDelta).toString(),
          feeWei: ((abs(pairDelta) * BigInt(core.taxBps)) / 10_000n).toString(),
          priceWei: this.priceFromSqrt(log.args.sqrtPriceX96 as bigint, core.tokenIsCurrency0).toString(),
          blockNumber: Number(log.blockNumber), txHash: log.transactionHash, timestamp: 0,
        };
      });
      for (const r of fresh) r.timestamp = await this.blockTs(BigInt(r.blockNumber), latest);
      // The Swap sender is our router; attribute trades to the wallet that sent the tx.
      if (fresh.length) {
        const hashes = [...new Set(fresh.map((r) => r.txHash))].slice(-200);
        const txs = await Promise.allSettled(hashes.map((h) => this.pc.getTransaction({ hash: h as Hex })));
        const from = new Map<string, Address>();
        txs.forEach((r, i) => { if (r.status === "fulfilled" && r.value?.from) from.set(hashes[i], r.value.from.toLowerCase() as Address); });
        for (const r of fresh) r.trader = from.get(r.txHash) ?? r.trader;
      }
      let records = fresh;
      if (cached) {
        const seen = new Set(cached.records.map((r) => r.id));
        records = cached.records.concat(fresh.filter((r) => !seen.has(r.id)));
      }
      this.trades.set(key, { records, upTo: latest });
      return records;
    } catch {
      return cached?.records ?? [];
    }
  }

  // -- summaries ----------------------------------------------------------

  private async summarize(core: Core): Promise<StockToken> {
    const [trades, sqrtP, pair] = await Promise.all([this.loadTrades(core.address), this.slot0(core.poolId), this.pairInfo(core.pair)]);
    const priceWei = sqrtP > 0n ? this.priceFromSqrt(sqrtP, core.tokenIsCurrency0) : trades.length ? BigInt(trades[trades.length - 1].priceWei) : 0n;
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
    const holders = new Set(trades.filter((t) => t.isBuy).map((t) => t.trader));

    // Liquidity: value the factory's single position at the live price (x2 for both legs).
    let liquidityWei = 0n;
    try {
      const pos = (await this.pc.readContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: "positions", args: [core.address] })) as readonly [number, number, bigint];
      const L = Number(pos[2]);
      if (L > 0 && sqrtP > 0n) {
        const sp = Number(sqrtP) / 2 ** 96, sa = Math.sqrt(1.0001 ** pos[0]), sb = Math.sqrt(1.0001 ** pos[1]);
        let amount0 = 0, amount1 = 0;
        if (sp <= sa) amount0 = (L * (sb - sa)) / (sa * sb);
        else if (sp >= sb) amount1 = L * (sb - sa);
        else { amount0 = (L * (sb - sp)) / (sp * sb); amount1 = L * (sp - sa); }
        const pairUnits = core.tokenIsCurrency0 ? amount1 : amount0;
        liquidityWei = BigInt(Math.max(0, Math.round(2 * pairUnits)));
      }
    } catch { /* dash */ }

    let rewards: StockToken["rewards"];
    try {
      const [h, c, p] = (await this.pc.multicall({ allowFailure: false, contracts: [
        { address: core.address, abi: tokenAbi, functionName: "totalHolderRewards" },
        { address: core.address, abi: tokenAbi, functionName: "totalCreatorFees" },
        { address: core.address, abi: tokenAbi, functionName: "totalPlatformFees" },
      ] })) as [bigint, bigint, bigint];
      rewards = { holders: h, creator: c, platform: p };
    } catch { /* optional */ }

    return {
      address: core.address, name: core.name, symbol: core.symbol, creator: core.creator, pool: ADDRESSES.poolManager, feeTier: core.taxBps,
      createdAt: core.createdAt, featured: false, metadata: core.metadata as any, totalSupply: TOTAL_SUPPLY.toString(),
      priceWei: priceWei.toString(), priceUsd: String(priceUsd), marketCapUsd: String(mcap), liquidityWei: liquidityWei.toString(),
      volume24hWei: vol24.toString(), volumeTotalWei: volTotal.toString(), txCount24h: day.length, holderCount: holders.size,
      limitsActive: false, remainingToGraduationUsd: "0", priceChange24hPct: change,
      pair, poolId: core.poolId, launchBlock: Number(core.launchBlock), rewards,
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

  async getHolders(token: string, opts?: { limit?: number }): Promise<HolderRecord[]> {
    const trades = await this.loadTrades(token as Address);
    const bal = new Map<string, number>();
    for (const t of trades) { const amt = Number(t.tokenAmount) / 1e18; bal.set(t.trader, (bal.get(t.trader) ?? 0) + (t.isBuy ? amt : -amt)); }
    return [...bal.entries()].filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]).slice(0, opts?.limit ?? 30)
      .map(([address, b]) => ({ address: address as Address, balance: String(Math.round(b * 1e18)), pct: (b / 1e9) * 100 }));
  }

  subscribeToTrades(token: string, cb: (t: TradeRecord) => void): () => void {
    const seen = new Set<string>();
    let seeded = false;
    const tick = () => this.loadTrades(token as Address).then((tr) => {
      if (!seeded) { for (const r of tr) seen.add(r.id); seeded = true; return; }
      for (const r of tr) if (!seen.has(r.id)) { seen.add(r.id); cb(r); }
    }).catch(() => undefined);
    void tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }

  // -- rewards ------------------------------------------------------------

  async rewards(token: Address, account?: Address): Promise<RewardsView> {
    const who = account ?? ZERO;
    const [pending, creatorFees, platformFees, th, tc, tp, creator, balance] = (await this.pc.multicall({ allowFailure: false, contracts: [
      { address: token, abi: tokenAbi, functionName: "pendingRewards", args: [who] },
      { address: token, abi: tokenAbi, functionName: "creatorFees" },
      { address: token, abi: tokenAbi, functionName: "platformFees" },
      { address: token, abi: tokenAbi, functionName: "totalHolderRewards" },
      { address: token, abi: tokenAbi, functionName: "totalCreatorFees" },
      { address: token, abi: tokenAbi, functionName: "totalPlatformFees" },
      { address: token, abi: tokenAbi, functionName: "creator" },
      { address: token, abi: tokenAbi, functionName: "balanceOf", args: [who] },
    ] })) as [bigint, bigint, bigint, bigint, bigint, bigint, Address, bigint];
    return { pending, creatorFees, platformFees, totalHolder: th, totalCreator: tc, totalPlatform: tp, isCreator: !!account && creator.toLowerCase() === account.toLowerCase(), balance };
  }

  private async routeOf(token: Address): Promise<{ pair: Address; route: Hex | null }> {
    await this.loadCores();
    const pair = this.cores.get(token.toLowerCase())?.pair ?? WETH;
    return { pair, route: routeFor(pair) };
  }

  async claimRewards(token: Address, asEth: boolean): Promise<Hex> {
    const wc = this.wallet();
    const { route } = await this.routeOf(token);
    if (asEth && route === null) throw new Error("No ETH route for this pair; claim in the stock instead.");
    return asEth
      ? wc.writeContract({ address: token, abi: tokenAbi, functionName: "claimRewardsAsEth", args: [0n, route!], chain: wc.chain, account: wc.account! })
      : wc.writeContract({ address: token, abi: tokenAbi, functionName: "claimRewards", chain: wc.chain, account: wc.account! });
  }

  async claimCreatorFees(token: Address, asEth: boolean): Promise<Hex> {
    const wc = this.wallet();
    const { route } = await this.routeOf(token);
    if (asEth && route === null) throw new Error("No ETH route for this pair; claim in the stock instead.");
    return wc.writeContract({ address: token, abi: tokenAbi, functionName: "claimCreatorFees", args: [asEth, 0n, asEth ? route! : "0x"], chain: wc.chain, account: wc.account! });
  }

  async claimPlatformFees(token: Address): Promise<Hex> {
    const wc = this.wallet();
    return wc.writeContract({ address: token, abi: tokenAbi, functionName: "claimPlatformFees", chain: wc.chain, account: wc.account! });
  }

  // -- trading ------------------------------------------------------------

  private async ensureAllowance(erc: Address, spender: Address, amount: bigint) {
    const me = this.me();
    const have = (await this.pc.readContract({ address: erc, abi: erc20Abi, functionName: "allowance", args: [me, spender] })) as bigint;
    if (have >= amount) return;
    const wc = this.wallet();
    const h = await wc.writeContract({ address: erc, abi: erc20Abi, functionName: "approve", args: [spender, 2n ** 256n - 1n], chain: wc.chain, account: wc.account! });
    await this.pc.waitForTransactionReceipt({ hash: h });
  }

  /** Simulate a buy (ETH in) or sell (coins in), returning the exact fill.
   *  Pair-denominated when the pair has no ETH route. */
  async previewSwapOut(token: Address, side: "buy" | "sell", amountIn: bigint): Promise<bigint | null> {
    if (amountIn <= 0n) return 0n;
    const me = this.wc?.account?.address as Address | undefined;
    if (!me) return null;
    const { pair, route } = await this.routeOf(token);
    try {
      if (side === "buy") {
        if (route === null) {
          const { result } = await this.pc.simulateContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "buyWithPair", args: [token, amountIn, 0n], account: me });
          return result as bigint;
        }
        const { result } = await this.pc.simulateContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "buy", args: [token, route, 0n], value: amountIn, account: me });
        return result as bigint;
      }
      if (route === null) {
        const { result } = await this.pc.simulateContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "sellForPair", args: [token, amountIn, 0n], account: me });
        return result as bigint;
      }
      const { result } = await this.pc.simulateContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "sell", args: [token, amountIn, route, 0n], account: me });
      return result as bigint;
    } catch {
      pair;
      return null;
    }
  }

  /** Buy with ETH along the pair's route, or with the pair asset when it has none. */
  async buyToken(token: Address, amountIn: bigint, minOut: bigint): Promise<Hex> {
    const wc = this.wallet();
    const { pair, route } = await this.routeOf(token);
    if (route === null) {
      await this.ensureAllowance(pair, ADDRESSES.router, amountIn);
      return wc.writeContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "buyWithPair", args: [token, amountIn, minOut], chain: wc.chain, account: wc.account! });
    }
    return wc.writeContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "buy", args: [token, route, minOut], value: amountIn, chain: wc.chain, account: wc.account! });
  }

  /** Sell for ETH along the pair's route, or for the pair asset when it has none. */
  async sellToken(token: Address, amountIn: bigint, minOut: bigint): Promise<Hex> {
    const wc = this.wallet();
    const { route } = await this.routeOf(token);
    await this.ensureAllowance(token, ADDRESSES.router, amountIn);
    if (route === null) return wc.writeContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "sellForPair", args: [token, amountIn, minOut], chain: wc.chain, account: wc.account! });
    return wc.writeContract({ address: ADDRESSES.router, abi: routerAbi, functionName: "sell", args: [token, amountIn, route, minOut], chain: wc.chain, account: wc.account! });
  }

  // -- launch -------------------------------------------------------------

  async createToken(p: { name: string; symbol: string; metadataURI: string; pair: Address; devBuyWei?: bigint }): Promise<Hex> {
    const wc = this.wallet();
    const pair = p.pair.toLowerCase() as Address;
    const route = routeFor(pair);
    const dev = p.devBuyWei ?? 0n;
    if (dev > 0n && route === null) throw new Error("This pair has no ETH route, so a first buy is not possible. Launch without one.");
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const saltHex = `0x${Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
    return wc.writeContract({
      address: ADDRESSES.factory, abi: factoryAbi, functionName: "launch",
      args: [{ name: p.name, symbol: p.symbol, metadataURI: p.metadataURI, pair }, saltHex, route ?? "0x"],
      value: dev > 0n ? dev : undefined, chain: wc.chain, account: wc.account!,
    });
  }

  /** Gas estimate for a launch, so the form can warn before a wallet prompt. */
  async estimateLaunch(p: { name: string; symbol: string; metadataURI: string; pair: Address; devBuyWei?: bigint }, from: Address): Promise<bigint> {
    const pair = p.pair.toLowerCase() as Address;
    return this.pc.estimateContractGas({
      address: ADDRESSES.factory, abi: factoryAbi, functionName: "launch",
      args: [{ name: p.name, symbol: p.symbol, metadataURI: p.metadataURI, pair }, `0x${"11".repeat(32)}` as Hex, routeFor(pair) ?? "0x"],
      value: p.devBuyWei ?? 0n, account: from,
    });
  }

  // -- admin --------------------------------------------------------------

  async config(): Promise<ConfigView> {
    const [admin, owner, feeRecipient, paused, taxBps, creatorBps, holderBps, converter, total] = (await this.pc.multicall({ allowFailure: false, contracts: [
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "admin" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "owner" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "feeRecipient" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "launchesPaused" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "TAX_BPS" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "CREATOR_BPS" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "HOLDER_BPS" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "converter" },
      { address: ADDRESSES.factory, abi: factoryAbi, functionName: "totalTokens" },
    ] })) as [Address, Address, Address, boolean, number, number, number, Address, bigint];
    return { admin, owner, feeRecipient, paused, taxBps: Number(taxBps), creatorBps: Number(creatorBps), holderBps: Number(holderBps), ethUsd: await this.ethUsd(), converter, totalTokens: Number(total) };
  }

  async adminCall(fn: "pause" | "resume" | "setFeeRecipient" | "setQuoteAsset" | "recoverERC20", args: unknown[] = []): Promise<Hex> {
    const wc = this.wallet();
    return wc.writeContract({ address: ADDRESSES.factory, abi: factoryAbi, functionName: fn as any, args: args as any, chain: wc.chain, account: wc.account! });
  }

  /** Live fee bps for a coin right now (base plus any anti-snipe surcharge). */
  async feeNow(token: Address): Promise<{ total: number; base: number }> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    if (!core) return { total: 0, base: 0 };
    const [total, base] = (await this.pc.readContract({ address: ADDRESSES.hook, abi: hookAbi, functionName: "feeBpsNow", args: [core.poolId, ADDRESSES.router] })) as readonly [number, number];
    return { total: Number(total), base: Number(base) };
  }
}

export const client = new StockPadClient(publicClient);
