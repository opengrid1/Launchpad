import {
  type Address,
  type PublicClient,
  type WalletClient,
  parseAbi,
  zeroAddress,
} from "viem";
import type { Candle, CandleInterval, TokenSummary, TradeRecord } from "@launchpad/sdk";
import { INTERVAL_SECONDS } from "@launchpad/sdk";

/**
 * Backend-free client for the StableLaunchpadFactory (Uniswap V3 on Stable
 * Mainnet). Reads tokens and prices straight from the factory and pools over
 * RPC; launches go through the factory and trades through the official
 * SwapRouter02. Shaped to match the V4 client surface so the existing pages
 * work unchanged; V4-only mechanics (dividends, stock rewards) return null.
 *
 * Decimals: the quote asset (ERC-20 USDT0) has 6 decimals while the UI works
 * in 18-decimal native units (USDT0 native gas is 18-dec — same balance).
 * This client converts at the router boundary.
 */

const FACTORY_ABI = parseAbi([
  "struct CreateParams { string name; string symbol; string metadataURI; address quote; uint256 marketCapUsd8; }",
  "function createToken(CreateParams p) returns (address token, address pool, uint256 positionId)",
  "function harvestFees(address token) returns (uint256, uint256, uint256, uint256)",
  "function tokenCount() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
  "function listings(address) view returns (address creator, address quote, address pool, uint256 positionId, uint64 createdAt, bool tokenIsToken0)",
]);

const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function metadataURI() view returns (string)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
]);

const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function liquidity() view returns (uint128)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);

const ROUTER_ABI = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

const Q96 = 2n ** 96n;
/** 6-dec quote-wei → 18-dec native-wei. */
const DEC_GAP = 10n ** 12n;
/** Max 500-block getLogs windows scanned for recent trades. */
const TRADE_SCAN_WINDOWS = 20;

export interface StableAddresses {
  factory: Address;
  swapRouter: Address;
  quote: Address; // ERC-20 USDT0 (6 decimals)
}

interface Core {
  address: Address;
  creator: Address;
  pool: Address;
  positionId: bigint;
  createdAt: number;
  tokenIsToken0: boolean;
  name: string;
  symbol: string;
  metadataURI: string;
}

export class StableV3Client {
  readonly publicClient: PublicClient;
  readonly addresses: StableAddresses;
  private walletClient?: WalletClient;
  private cores = new Map<string, Core>();
  private coreCount = 0;
  private coresInflight: Promise<Core[]> | null = null;
  private priceCache = new Map<string, { at: number; price: bigint }>();
  private tradesCache = new Map<string, { at: number; trades: TradeRecord[] }>();
  private tradesInflight = new Map<string, Promise<TradeRecord[]>>();

  constructor(publicClient: PublicClient, addresses: StableAddresses) {
    this.publicClient = publicClient;
    this.addresses = addresses;
  }

  connectWallet(wc: WalletClient) {
    this.walletClient = wc;
  }
  private wallet(): WalletClient {
    if (!this.walletClient?.account) throw new Error("No wallet connected.");
    return this.walletClient;
  }

  // -- reads ------------------------------------------------------------

  private loadCores(): Promise<Core[]> {
    // Single-flight: Explore fires two token queries at mount; share one scan.
    if (!this.coresInflight) {
      this.coresInflight = this._loadCores().finally(() => {
        this.coresInflight = null;
      });
    }
    return this.coresInflight;
  }

  private async _loadCores(): Promise<Core[]> {
    const count = Number(
      await this.publicClient.readContract({
        address: this.addresses.factory,
        abi: FACTORY_ABI,
        functionName: "tokenCount",
      }),
    );
    if (count > this.coreCount) {
      const idxs = Array.from({ length: count - this.coreCount }, (_, i) => this.coreCount + i);
      const addrs = await Promise.all(
        idxs.map((i) =>
          this.publicClient.readContract({
            address: this.addresses.factory,
            abi: FACTORY_ABI,
            functionName: "allTokens",
            args: [BigInt(i)],
          }),
        ),
      );
      await Promise.all(
        addrs.map(async (addr) => {
          const a = addr as Address;
          const [listing, name, symbol, metadataURI] = await Promise.all([
            this.publicClient.readContract({ address: this.addresses.factory, abi: FACTORY_ABI, functionName: "listings", args: [a] }),
            this.publicClient.readContract({ address: a, abi: ERC20_ABI, functionName: "name" }),
            this.publicClient.readContract({ address: a, abi: ERC20_ABI, functionName: "symbol" }),
            this.publicClient.readContract({ address: a, abi: ERC20_ABI, functionName: "metadataURI" }).catch(() => ""),
          ]);
          const [creator, , pool, positionId, createdAt, tokenIsToken0] = listing as unknown as [
            Address, Address, Address, bigint, bigint, boolean,
          ];
          this.cores.set(a.toLowerCase(), {
            address: a, creator, pool, positionId,
            createdAt: Number(createdAt), tokenIsToken0,
            name: name as string, symbol: symbol as string, metadataURI: metadataURI as string,
          });
        }),
      );
      this.coreCount = count;
    }
    return [...this.cores.values()];
  }

  /** Price in native wei (18d) per whole token, from the live pool. Cached
   *  briefly so list + detail views don't refetch slot0 per render. */
  private async priceWei(core: Core): Promise<bigint> {
    const key = core.address.toLowerCase();
    const hit = this.priceCache.get(key);
    if (hit && Date.now() - hit.at < 8_000) return hit.price;
    const price = await this.readPriceWei(core);
    this.priceCache.set(key, { at: Date.now(), price });
    return price;
  }

  private async readPriceWei(core: Core): Promise<bigint> {
    const [sqrtPriceX96] = (await this.publicClient.readContract({
      address: core.pool, abi: POOL_ABI, functionName: "slot0",
    })) as unknown as [bigint];
    // token0 case: quote6-per-tokenWei ratio = (sqrtP/2^96)^2 → per whole
    // token ×1e18, to 18d ×1e12.
    if (core.tokenIsToken0) {
      return (((sqrtPriceX96 * sqrtPriceX96) / Q96) * 10n ** 18n * DEC_GAP) / Q96;
    }
    const num = Q96 * Q96 * 10n ** 18n * DEC_GAP;
    return num / (sqrtPriceX96 * sqrtPriceX96);
  }

  private async summary(core: Core): Promise<TokenSummary> {
    const price = await this.priceWei(core).catch(() => 0n);
    const supply = 1_000_000_000n * 10n ** 18n;
    const mcapWei = (price * supply) / 10n ** 18n;
    const usd = Number(mcapWei) / 1e18; // USDT0 = $1
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(core.metadataURI || "{}"); } catch { /* opaque URI */ }
    return {
      address: core.address,
      name: core.name,
      symbol: core.symbol,
      creator: core.creator,
      pool: core.pool,
      // Fee expressed in trade-tax bps for the UI (1% pool tier).
      feeTier: 100,
      createdAt: core.createdAt,
      featured: false,
      metadata: metadata as TokenSummary["metadata"],
      totalSupply: supply.toString(),
      priceWei: price.toString(),
      priceUsd: String(Number(price) / 1e18),
      marketCapUsd: String(usd),
      liquidityWei: "0",
      volume24hWei: "0",
      volumeTotalWei: "0",
      txCount24h: 0,
      holderCount: 0,
      limitsActive: false,
      remainingToGraduationUsd: "0",
      priceChange24hPct: null,
      creatorFeesWei: "0",
    } as unknown as TokenSummary;
  }

  async getTokens(opts?: { sort?: string; limit?: number }): Promise<TokenSummary[]> {
    const cores = await this.loadCores();
    const list = await Promise.all(cores.map((c) => this.summary(c)));
    const sort = opts?.sort ?? "new";
    if (sort === "mcap" || sort === "marketCap") list.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else list.sort((a, b) => b.createdAt - a.createdAt);
    return list.slice(0, opts?.limit ?? 60);
  }

  async getToken(token: string): Promise<TokenSummary | null> {
    await this.loadCores();
    const core = this.cores.get(token.toLowerCase());
    if (!core) return null;
    // Warm the trade scan now — the trades list and chart mount right after
    // this resolves, and by then the scan is in flight or already cached.
    this.getTrades(token, { limit: 50 }).catch(() => {});
    return this.summary(core);
  }

  /** Recent trades from pool Swap events. The public RPC caps getLogs at 500
   *  blocks, so a bounded window of recent history is scanned — all windows in
   *  parallel, results cached briefly and shared with the candle builder.
   *  Timestamps are estimated from the head block and Stable's ~0.7s block
   *  time instead of a per-block lookup. */
  async getTrades(token: string, opts?: { limit?: number }): Promise<TradeRecord[]> {
    const key = token.toLowerCase();
    const hit = this.tradesCache.get(key) ?? this.loadPersistedTrades(key);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit && age < 15_000) return hit.trades.slice(0, opts?.limit ?? 50);
    let inflight = this.tradesInflight.get(key);
    if (!inflight) {
      inflight = this.scanTrades(key).finally(() => this.tradesInflight.delete(key));
      this.tradesInflight.set(key, inflight);
    }
    // Stale-while-revalidate: a recent-enough cached list renders instantly
    // while the fresh scan replaces it for the next read.
    if (hit && age < 120_000) return hit.trades.slice(0, opts?.limit ?? 50);
    const trades = await inflight;
    return trades.slice(0, opts?.limit ?? 50);
  }

  private loadPersistedTrades(key: string): { at: number; trades: TradeRecord[] } | null {
    try {
      const raw = sessionStorage.getItem(`steady:trades:${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { at: number; trades: TradeRecord[] };
      this.tradesCache.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  private async scanTrades(key: string): Promise<TradeRecord[]> {
    await this.loadCores();
    const core = this.cores.get(key);
    if (!core) return [];
    const [head, headBlock] = await Promise.all([
      this.publicClient.getBlockNumber(),
      this.publicClient.getBlock().catch(() => null),
    ]);
    const headTs = headBlock ? Number(headBlock.timestamp) : Math.floor(Date.now() / 1000);

    const windows = Array.from({ length: TRADE_SCAN_WINDOWS }, (_, w) => {
      const to = head - BigInt(w * 500);
      if (to <= 0n) return null;
      const from = to - 499n > 0n ? to - 499n : 0n;
      return { from, to };
    }).filter(Boolean) as Array<{ from: bigint; to: bigint }>;

    const results = await Promise.all(
      windows.map((w) =>
        this.publicClient
          .getLogs({ address: core.pool, event: POOL_ABI[2], fromBlock: w.from, toBlock: w.to })
          .catch(() => []),
      ),
    );

    const out: TradeRecord[] = [];
    for (const logs of results) {
      for (const log of logs) {
        const { amount0, amount1, sqrtPriceX96 } = log.args as { amount0: bigint; amount1: bigint; sqrtPriceX96: bigint };
        const tokenDelta = core.tokenIsToken0 ? amount0 : amount1;
        const quoteDelta = core.tokenIsToken0 ? amount1 : amount0;
        const isBuy = tokenDelta < 0n; // pool pays tokens out on a buy
        const price = core.tokenIsToken0
          ? (((sqrtPriceX96 * sqrtPriceX96) / Q96) * 10n ** 18n * DEC_GAP) / Q96
          : (Q96 * Q96 * 10n ** 18n * DEC_GAP) / (sqrtPriceX96 * sqrtPriceX96);
        const blockNumber = Number(log.blockNumber);
        out.push({
          id: `${log.transactionHash}-${log.logIndex}`,
          token: core.address,
          trader: zeroAddress,
          isBuy,
          nativeAmountWei: ((quoteDelta < 0n ? -quoteDelta : quoteDelta) * DEC_GAP).toString(),
          tokenAmount: (tokenDelta < 0n ? -tokenDelta : tokenDelta).toString(),
          feeWei: "0",
          priceWei: price.toString(),
          blockNumber,
          txHash: log.transactionHash!,
          // ~0.7s block time on Stable — estimate, no per-block lookups.
          timestamp: Math.max(0, headTs - Math.round(Number(head - log.blockNumber!) * 0.7)),
        });
      }
    }
    out.sort((a, b) => b.blockNumber - a.blockNumber);
    const entry = { at: Date.now(), trades: out };
    this.tradesCache.set(key, entry);
    try {
      sessionStorage.setItem(`steady:trades:${key}`, JSON.stringify({ ...entry, trades: out.slice(0, 100) }));
    } catch { /* storage full — in-memory cache still works */ }
    return out;
  }

  /** Candles from the recent-trade window plus a live closing candle. */
  async getCandles(token: string, interval: CandleInterval, opts?: { limit?: number }): Promise<Candle[]> {
    const secs = INTERVAL_SECONDS[interval] ?? 60;
    // Shares the cached trade scan with the trades list — no duplicate work.
    const trades = await this.getTrades(token, { limit: 500 });
    const core = this.cores.get(token.toLowerCase());
    const live = core ? await this.priceWei(core).catch(() => 0n) : 0n;
    const buckets = new Map<number, Candle>();
    for (const t of [...trades].sort((a, b) => a.timestamp - b.timestamp)) {
      const bucket = Math.floor(t.timestamp / secs) * secs;
      const c = buckets.get(bucket);
      if (!c) {
        buckets.set(bucket, { time: bucket, open: t.priceWei, high: t.priceWei, low: t.priceWei, close: t.priceWei, volume: t.nativeAmountWei });
      } else {
        if (BigInt(t.priceWei) > BigInt(c.high)) c.high = t.priceWei;
        if (BigInt(t.priceWei) < BigInt(c.low)) c.low = t.priceWei;
        c.close = t.priceWei;
        c.volume = (BigInt(c.volume) + BigInt(t.nativeAmountWei)).toString();
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const nowBucket = Math.floor(now / secs) * secs;
    if (live > 0n && !buckets.has(nowBucket)) {
      const p = live.toString();
      buckets.set(nowBucket, { time: nowBucket, open: p, high: p, low: p, close: p, volume: "0" });
    }
    return [...buckets.values()].sort((a, b) => a.time - b.time).slice(-(opts?.limit ?? 500));
  }

  // -- writes -----------------------------------------------------------

  /** Launch a token on the Stable factory (default $3,000 market cap). */
  async createToken(p: { name: string; symbol: string; metadataURI: string }): Promise<`0x${string}`> {
    const wc = this.wallet();
    return wc.writeContract({
      address: this.addresses.factory,
      abi: FACTORY_ABI,
      functionName: "createToken",
      args: [{ name: p.name, symbol: p.symbol, metadataURI: p.metadataURI, quote: this.addresses.quote, marketCapUsd8: 0n }],
      chain: wc.chain,
      account: wc.account!,
    });
  }

  private async ensureAllowance(owner: Address, tokenAddr: Address, amount: bigint) {
    const wc = this.wallet();
    const allowance = (await this.publicClient.readContract({
      address: tokenAddr, abi: ERC20_ABI, functionName: "allowance", args: [owner, this.addresses.swapRouter],
    })) as bigint;
    if (allowance < amount) {
      const hash = await wc.writeContract({
        address: tokenAddr, abi: ERC20_ABI, functionName: "approve",
        args: [this.addresses.swapRouter, amount], chain: wc.chain, account: wc.account!,
      });
      await this.publicClient.waitForTransactionReceipt({ hash });
    }
  }

  /** Buy `token` spending `nativeWei` (18d) of USDT0 on the official router. */
  async buyToken(token: Address, nativeWei: bigint, minOut: bigint): Promise<`0x${string}`> {
    const wc = this.wallet();
    const me = wc.account!.address as Address;
    const amountIn6 = nativeWei / DEC_GAP;
    if (amountIn6 === 0n) throw new Error("Amount too small.");
    await this.ensureAllowance(me, this.addresses.quote, amountIn6);
    return wc.writeContract({
      address: this.addresses.swapRouter, abi: ROUTER_ABI, functionName: "exactInputSingle",
      args: [{ tokenIn: this.addresses.quote, tokenOut: token, fee: 10_000, recipient: me, amountIn: amountIn6, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
      chain: wc.chain, account: wc.account!,
    });
  }

  /** Sell `amountIn` token wei for USDT0; `minOut` is native wei (18d). */
  async sellToken(token: Address, amountIn: bigint, minOut: bigint): Promise<`0x${string}`> {
    const wc = this.wallet();
    const me = wc.account!.address as Address;
    await this.ensureAllowance(me, token, amountIn);
    return wc.writeContract({
      address: this.addresses.swapRouter, abi: ROUTER_ABI, functionName: "exactInputSingle",
      args: [{ tokenIn: token, tokenOut: this.addresses.quote, fee: 10_000, recipient: me, amountIn, amountOutMinimum: minOut / DEC_GAP, sqrtPriceLimitX96: 0n }],
      chain: wc.chain, account: wc.account!,
    });
  }

  /** Distribute accrued pool fees 80/20 creator/platform (permissionless). */
  async claimCreatorFees(token: Address): Promise<`0x${string}`> {
    const wc = this.wallet();
    return wc.writeContract({
      address: this.addresses.factory, abi: FACTORY_ABI, functionName: "harvestFees",
      args: [token], chain: wc.chain, account: wc.account!,
    });
  }

  // -- V4-only surface, degraded gracefully -----------------------------

  async tokenExtra(): Promise<null> { return null; }
  /** Chart scale: candle prices are native wei per whole token (18d) and the
   *  chart plots market cap in USD. mcap = priceWei/1e18 × 1e9 supply × $1. */
  async mcapScale(): Promise<number> { return 1e-9; }
  async harvest(): Promise<never> { throw new Error("Not available on Stable."); }
  async claimDividends(): Promise<never> { throw new Error("Not available on Stable."); }

  subscribeToCandles(): () => void { return () => {}; }
  subscribeToTrades(): () => void { return () => {}; }
  subscribeToPrice(): () => void { return () => {}; }
  subscribeToLaunches(): () => void { return () => {}; }
}
