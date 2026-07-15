import type { PublicClient } from "viem";

import { launchpadAbi, launchTokenAbi, feeDistributorAbi } from "./abi";
import {
  INTERVAL_SECONDS,
  type Address,
  type Candle,
  type CandleInterval,
  type HolderRecord,
  type LaunchpadAddresses,
  type TokenSummary,
  type TradeRecord,
  type WsServerMessage,
} from "./types";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Uniswap V3 pool Swap event, the source of truth for all trades. */
const SWAP_EVENT = {
  type: "event",
  name: "Swap",
  inputs: [
    { indexed: true, name: "sender", type: "address" },
    { indexed: true, name: "recipient", type: "address" },
    { indexed: false, name: "amount0", type: "int256" },
    { indexed: false, name: "amount1", type: "int256" },
    { indexed: false, name: "sqrtPriceX96", type: "uint160" },
    { indexed: false, name: "liquidity", type: "uint128" },
    { indexed: false, name: "tick", type: "int24" },
  ],
} as const;

interface TokenCore {
  address: Address;
  name: string;
  symbol: string;
  metadata: Record<string, unknown>;
  creator: Address;
  pool: Address;
  feeTier: number;
  createdAt: number;
  featured: boolean;
  totalSupply: bigint;
  launchBlock: bigint;
  maxTxAmount: bigint;
  maxWalletAmount: bigint;
}

type Listener = (msg: WsServerMessage) => void;

/**
 * Backend-free data source: reads tokens, trades, candles and holders
 * directly from the chain over RPC and streams live updates by watching
 * contract events. Used automatically when the client has no API URL, so
 * the app works end to end against nothing but a public RPC endpoint.
 */
export class ChainDataSource {
  private client: PublicClient;
  private addresses: LaunchpadAddresses;
  private startBlock: bigint;

  private cores = new Map<string, TokenCore>();
  private coresLoadedUpTo = 0n;
  private coresInflight: Promise<TokenCore[]> | null = null;
  private trades = new Map<string, TradeRecord[]>();
  private tradesLoaded = new Set<string>();
  private tradesInflight = new Map<string, Promise<TradeRecord[]>>();
  private blockTs = new Map<string, number>();
  private listeners = new Set<{ channel: string; token?: string; fn: Listener }>();
  private watching = false;
  private stopWatch: (() => void) | null = null;
  private poolWatchers = new Map<string, () => void>();

  constructor(client: PublicClient, addresses: LaunchpadAddresses, startBlock?: bigint) {
    this.client = client;
    this.addresses = addresses;
    this.startBlock = startBlock ?? 0n;
  }

  // ------------------------------------------------------------------
  // Token discovery
  // ------------------------------------------------------------------

  private async loadCores(): Promise<TokenCore[]> {
    // Dedupe concurrent callers (e.g. the two Explore feeds) onto one load.
    if (this.coresInflight) return this.coresInflight;
    this.coresInflight = this.loadCoresInner().finally(() => {
      this.coresInflight = null;
    });
    return this.coresInflight;
  }

  private async loadCoresInner(): Promise<TokenCore[]> {
    const latest = await this.client.getBlockNumber();
    if (this.coresLoadedUpTo === 0n || latest > this.coresLoadedUpTo) {
      const logs = await this.client.getLogs({
        address: this.addresses.launchpad,
        event: launchpadAbi.find((x: any) => x.type === "event" && x.name === "TokenLaunched") as any,
        fromBlock: this.coresLoadedUpTo === 0n ? this.startBlock : this.coresLoadedUpTo + 1n,
        toBlock: latest,
      });
      for (const log of logs as any[]) {
        const address = (log.args.token as string).toLowerCase() as Address;
        if (this.cores.has(address)) continue;
        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(log.args.metadataURI);
        } catch {
          metadata = { description: String(log.args.metadataURI ?? "") };
        }
        const block = await this.getBlockTs(log.blockNumber);
        this.cores.set(address, {
          address,
          name: log.args.name,
          symbol: log.args.symbol,
          metadata,
          creator: (log.args.creator as string).toLowerCase() as Address,
          pool: (log.args.pool as string).toLowerCase() as Address,
          feeTier: Number(log.args.feeTier),
          createdAt: block,
          featured: false,
          totalSupply: log.args.totalSupply as bigint,
          launchBlock: log.blockNumber as bigint,
          maxTxAmount: log.args.maxTxAmount as bigint,
          maxWalletAmount: log.args.maxWalletAmount as bigint,
        });
      }
      this.coresLoadedUpTo = latest;
    }
    return [...this.cores.values()];
  }

  private async getBlockTs(blockNumber: bigint): Promise<number> {
    const key = blockNumber.toString();
    const hit = this.blockTs.get(key);
    if (hit !== undefined) return hit;
    const block = await this.client.getBlock({ blockNumber });
    const ts = Number(block.timestamp);
    this.blockTs.set(key, ts);
    return ts;
  }

  // ------------------------------------------------------------------
  // Trades (the basis for candles, volume and price change)
  // ------------------------------------------------------------------

  private async loadTrades(token: Address): Promise<TradeRecord[]> {
    const key = token.toLowerCase();
    if (this.tradesLoaded.has(key)) return this.trades.get(key) ?? [];
    // Dedupe concurrent loads for the same token onto one request.
    const existing = this.tradesInflight.get(key);
    if (existing) return existing;
    const p = this.loadTradesInner(key).finally(() => this.tradesInflight.delete(key));
    this.tradesInflight.set(key, p);
    return p;
  }

  private async loadTradesInner(key: string): Promise<TradeRecord[]> {
    {
      await this.loadCores();
      const core = this.cores.get(key);
      if (!core) {
        this.trades.set(key, []);
        this.tradesLoaded.add(key);
        return [];
      }
      // Read the pool's Swap events, not just Launchpad trades: this captures
      // every trade against the market, including direct pool swaps from bots
      // and aggregators (which never emit a Launchpad Trade). Site buys route
      // through the same pool, so they are included too.
      const logs = await this.client.getLogs({
        address: core.pool as `0x${string}`,
        event: SWAP_EVENT,
        fromBlock: core.launchBlock ?? this.startBlock,
        toBlock: "latest",
      });
      // Prefetch block timestamps for all swaps in parallel (deduped), rather
      // than one getBlock per swap in sequence, which stalls the feed and can
      // trip public-RPC rate limits on mobile.
      const uniqueBlocks = [...new Set((logs as any[]).map((l) => l.blockNumber as bigint))];
      await Promise.all(uniqueBlocks.map((bn) => this.getBlockTs(bn)));
      const records = (logs as any[]).map((log) => this.tradeFromSwap(log, core));
      this.trades.set(key, records);
      this.tradesLoaded.add(key);
    }
    return this.trades.get(key) ?? [];
  }

  private priceWeiFromSqrt(sqrtP: bigint, tokenIsToken0: boolean): bigint {
    const Q96 = 2n ** 96n;
    if (sqrtP === 0n) return 0n;
    return tokenIsToken0
      ? (((sqrtP * sqrtP) / Q96) * 10n ** 18n) / Q96
      : (Q96 * Q96 * 10n ** 18n) / (sqrtP * sqrtP);
  }

  /** Build a TradeRecord from a Uniswap V3 pool Swap log. Timestamp must be
   *  cached already (via getBlockTs) so this stays synchronous. */
  private tradeFromSwap(log: any, core: TokenCore): TradeRecord {
    const tokenIsToken0 = core.address < this.addresses.weth.toLowerCase();
    const amount0 = log.args.amount0 as bigint;
    const amount1 = log.args.amount1 as bigint;
    const tokenDelta = tokenIsToken0 ? amount0 : amount1;
    const wethDelta = tokenIsToken0 ? amount1 : amount0;
    // Pool-perspective deltas: positive means the asset flowed into the pool.
    // WETH into the pool => the trader paid WETH => this is a buy.
    const isBuy = wethDelta > 0n;
    const abs = (v: bigint) => (v < 0n ? -v : v);
    const nativeAmount = abs(wethDelta);
    const feeWei = (nativeAmount * BigInt(core.feeTier)) / 1_000_000n;
    const sqrtP = log.args.sqrtPriceX96 as bigint;
    return {
      id: `${log.transactionHash}-${log.logIndex}`,
      token: core.address,
      trader: (log.args.recipient as string).toLowerCase() as Address,
      isBuy,
      nativeAmountWei: nativeAmount.toString(),
      tokenAmount: abs(tokenDelta).toString(),
      feeWei: feeWei.toString(),
      priceWei: this.priceWeiFromSqrt(sqrtP, tokenIsToken0).toString(),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      timestamp: this.blockTs.get(log.blockNumber.toString()) ?? 0,
    };
  }

  // ------------------------------------------------------------------
  // Public reads matching the REST API shapes
  // ------------------------------------------------------------------

  async getTokens(sort: "new" | "volume" | "marketCap" | "featured" = "new", limit = 50): Promise<TokenSummary[]> {
    const cores = await this.loadCores();
    // Never let one token's failed read blank the whole feed.
    const settled = await Promise.allSettled(cores.map((c) => this.summarize(c)));
    const summaries = settled
      .filter((r): r is PromiseFulfilledResult<TokenSummary> => r.status === "fulfilled")
      .map((r) => r.value);
    const bySort = [...summaries];
    if (sort === "volume") bySort.sort((a, b) => Number(b.volume24hWei) - Number(a.volume24hWei));
    else if (sort === "marketCap") bySort.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else bySort.sort((a, b) => b.createdAt - a.createdAt);
    return bySort.slice(0, limit);
  }

  async getToken(token: Address): Promise<TokenSummary> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    if (!core) throw new Error("token not found");
    return this.summarize(core);
  }

  private async summarize(core: TokenCore): Promise<TokenSummary> {
    const [limits, wethInPool, trades, pushedFees] = await Promise.all([
      this.client.readContract({
        address: this.addresses.launchpad,
        abi: launchpadAbi,
        functionName: "tradingLimits",
        args: [core.address],
      }),
      this.client.readContract({
        address: this.addresses.weth,
        abi: launchTokenAbi,
        functionName: "balanceOf",
        args: [core.pool],
      }),
      this.loadTrades(core.address),
      this.client.readContract({
        address: this.addresses.feeDistributor,
        abi: feeDistributorAbi,
        functionName: "tokenFees",
        args: [core.address],
      }),
    ]);
    const [active, , , , mcapUsd, remainingUsd] = limits as any;

    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    const dayTrades = trades.filter((t) => t.timestamp >= dayAgo);
    const volume24h = dayTrades.reduce((acc, t) => acc + BigInt(t.nativeAmountWei), 0n);
    const volumeTotal = trades.reduce((acc, t) => acc + BigInt(t.nativeAmountWei), 0n);

    // Total fees the market has generated: the 1% pool fee on every swap
    // (paid by bots and site trades alike) plus any site fee already pushed
    // to the creator. This matches ~1% of volume, unlike the push-only figure.
    const poolFees = trades.reduce((acc, t) => acc + BigInt(t.feeWei), 0n);
    const totalFees = poolFees + (pushedFees as bigint);

    const last = trades[trades.length - 1];
    const ref = [...trades].reverse().find((t) => t.timestamp <= dayAgo);
    const lastPrice = last ? Number(last.priceWei) : 0;
    const refPrice = ref ? Number(ref.priceWei) : trades[0] ? Number(trades[0].priceWei) : 0;
    const priceChange24hPct =
      lastPrice > 0 && refPrice > 0 && trades.length > 1 ? ((lastPrice - refPrice) / refPrice) * 100 : null;

    const holders = new Set(trades.map((t) => t.trader));
    const supplyNum = Number(core.totalSupply) / 1e18;
    const mcapUsdNum = Number(mcapUsd) / 1e8;

    return {
      address: core.address,
      name: core.name,
      symbol: core.symbol,
      creator: core.creator,
      pool: core.pool,
      feeTier: core.feeTier,
      createdAt: core.createdAt,
      featured: core.featured,
      metadata: core.metadata as any,
      totalSupply: core.totalSupply.toString(),
      priceWei: last ? last.priceWei : supplyNum > 0 ? String(Math.round((mcapUsdNum / supplyNum) * 1e18)) : "0",
      priceUsd: supplyNum > 0 ? String(mcapUsdNum / supplyNum) : "0",
      marketCapUsd: usd8(mcapUsd as bigint),
      liquidityWei: ((wethInPool as bigint) * 2n).toString(),
      volume24hWei: volume24h.toString(),
      volumeTotalWei: volumeTotal.toString(),
      txCount24h: dayTrades.length,
      holderCount: holders.size,
      limitsActive: Boolean(active),
      remainingToGraduationUsd: usd8(remainingUsd as bigint),
      priceChange24hPct,
      creatorFeesWei: totalFees.toString(),
    };
  }

  async getTrades(token: Address, limit = 50): Promise<TradeRecord[]> {
    const trades = await this.loadTrades(token);
    return [...trades].reverse().slice(0, limit);
  }

  async getCandles(token: Address, interval: CandleInterval, limit = 500): Promise<Candle[]> {
    const trades = await this.loadTrades(token);
    const seconds = INTERVAL_SECONDS[interval];
    const buckets = new Map<number, Candle>();
    for (const t of trades) {
      const time = t.timestamp - (t.timestamp % seconds);
      const price = Number(t.priceWei) / 1e18;
      const vol = Number(t.nativeAmountWei) / 1e18;
      const b = buckets.get(time);
      if (!b) {
        buckets.set(time, {
          time,
          open: String(price),
          high: String(price),
          low: String(price),
          close: String(price),
          volume: String(vol),
        });
      } else {
        b.high = String(Math.max(Number(b.high), price));
        b.low = String(Math.min(Number(b.low), price));
        b.close = String(price);
        b.volume = String(Number(b.volume) + vol);
      }
    }
    return [...buckets.values()].sort((a, b) => a.time - b.time).slice(-limit);
  }

  async getHolders(token: Address, limit = 50): Promise<HolderRecord[]> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    const logs = await this.client.getLogs({
      address: token as `0x${string}`,
      event: launchTokenAbi.find((x: any) => x.type === "event" && x.name === "Transfer") as any,
      fromBlock: core?.launchBlock ?? this.startBlock,
      toBlock: "latest",
    });
    const balances = new Map<string, bigint>();
    for (const log of logs as any[]) {
      const from = (log.args.from as string).toLowerCase();
      const to = (log.args.to as string).toLowerCase();
      const value = log.args.value as bigint;
      if (from !== ZERO) balances.set(from, (balances.get(from) ?? 0n) - value);
      if (to !== ZERO) balances.set(to, (balances.get(to) ?? 0n) + value);
    }
    const supply = core ? Number(core.totalSupply) / 1e18 : 0;
    return [...balances.entries()]
      .filter(([, v]) => v > 0n)
      .sort((a, b) => (b[1] > a[1] ? 1 : -1))
      .slice(0, limit)
      .map(([address, balance]) => ({
        address: address as Address,
        balance: balance.toString(),
        pct: supply > 0 ? (Number(balance) / 1e18 / supply) * 100 : 0,
      }));
  }

  // ------------------------------------------------------------------
  // Live updates via event watching (no reloads, no backend)
  // ------------------------------------------------------------------

  subscribe(channel: string, params: { token?: string; interval?: CandleInterval }, fn: Listener): () => void {
    const entry = { channel, token: params.token?.toLowerCase(), fn };
    this.listeners.add(entry);
    this.ensureWatching();
    if (params.token) void this.watchPool(params.token.toLowerCase() as Address);
    return () => {
      this.listeners.delete(entry);
    };
  }

  /** Watch a single token's pool for new swaps and stream chart/price updates. */
  private async watchPool(token: Address) {
    if (this.poolWatchers.has(token)) return;
    this.poolWatchers.set(token, () => {}); // reserve slot against races
    await this.loadCores();
    const core = this.cores.get(token);
    if (!core) {
      this.poolWatchers.delete(token);
      return;
    }
    const unwatch = this.client.watchContractEvent({
      address: core.pool as `0x${string}`,
      abi: [SWAP_EVENT],
      eventName: "Swap",
      pollingInterval: 4000,
      onLogs: async (logs) => {
        for (const log of logs as any[]) {
          try {
            await this.getBlockTs(log.blockNumber);
            const trade = this.tradeFromSwap(log, core);
            const list = this.trades.get(token);
            if (list && !list.some((t) => t.id === trade.id)) list.push(trade);

            this.emit("trade:update", token, trade);

            for (const interval of Object.keys(INTERVAL_SECONDS) as CandleInterval[]) {
              const candles = await this.getCandles(token, interval, 2);
              const candle = candles[candles.length - 1];
              if (candle) this.emit("candle:update", token, { token, interval, candle });
            }

            const summary = await this.summarize(core);
            this.emit("price:update", token, {
              token,
              priceWei: summary.priceWei,
              priceUsd: summary.priceUsd,
              marketCapUsd: summary.marketCapUsd,
              liquidityWei: summary.liquidityWei,
              limitsActive: summary.limitsActive,
              remainingToGraduationUsd: summary.remainingToGraduationUsd,
            });
          } catch {
            // Ignore individual log failures; the next poll retries.
          }
        }
      },
    });
    this.poolWatchers.set(token, unwatch);
  }

  private emit(channel: string, token: string, data: unknown) {
    for (const l of this.listeners) {
      if (l.channel !== channel) continue;
      if (l.token && l.token !== token) continue;
      l.fn({ channel, token, data } as any);
    }
  }

  private ensureWatching() {
    if (this.watching) return;
    this.watching = true;

    // Per-token trade streaming is handled by watchPool(); here we only watch
    // for brand-new token launches so the Explore feed updates live.
    const unwatchLaunches = this.client.watchContractEvent({
      address: this.addresses.launchpad,
      abi: launchpadAbi,
      eventName: "TokenLaunched",
      pollingInterval: 6000,
      onLogs: async (logs) => {
        try {
          this.coresLoadedUpTo = 0n; // force re-discovery
          await this.loadCores();
          for (const log of logs as any[]) {
            const key = (log.args.token as string).toLowerCase();
            const core = this.cores.get(key);
            if (core) this.emit("token:launched", key, await this.summarize(core));
          }
        } catch {
          // retried on next event
        }
      },
    });

    this.stopWatch = () => {
      unwatchLaunches();
    };
  }

  close() {
    this.stopWatch?.();
    for (const unwatch of this.poolWatchers.values()) unwatch();
    this.poolWatchers.clear();
    this.watching = false;
    this.listeners.clear();
  }
}

function usd8(value: bigint): string {
  const whole = value / 10n ** 8n;
  const frac = (value % 10n ** 8n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""}`;
}
