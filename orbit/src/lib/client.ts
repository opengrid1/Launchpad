import { createPublicClient, fallback, http, type Address, type PublicClient, type WalletClient, zeroAddress } from "viem";
import type { Candle, CandleInterval, PriceUpdate, TokenSummary, TradeRecord } from "@launchpad/sdk";

import { ADDRESSES, chain, env, LEGACY } from "./env";
import { OnairRouter, q96ToFdvWei, q96ToWei, type AuctionState, type Mode } from "./onair";
import { StableV3Client } from "./stableClient";

export const publicClient = createPublicClient({
  chain,
  transport: fallback(
    env.rpcUrls.map((url) => http(url, { retryCount: 1, retryDelay: 150, timeout: 6_000, batch: { wait: 16 } })),
    { rank: { interval: 30_000, sampleCount: 5 } },
  ),
  pollingInterval: 10_000,
  batch: { multicall: { wait: 24 } },
}) as PublicClient;

/** Auction-specific reads and writes (house + factory), routed per coin. */
export const onair = new OnairRouter(publicClient);

/** A coin's pair asset: HYPE (native) or a tokenized stock. */
export interface PairInfo {
  address: Address;
  symbol: string;
  decimals: number;
  /** USD per whole pair token, from the factory registry (0 when unknown). */
  usd: number;
  isNative: boolean;
}

export type OnairToken = TokenSummary & {
  sparkline?: number[];
  mode: Mode;
  /** Present for auction launches: live state while running, final flags after. */
  auction?: AuctionState | null;
  /** The coin's pair asset. Auctions always pair HYPE. */
  pair?: PairInfo;
  /** Which deployment lists the coin ("v2", "v1"). */
  home: string;
};


/** The generic V3 client (pools, trades, charts, swaps) with ONAIR's two
 *  launch models layered on, reading every deployment at once: the primary
 *  (v2, stock pairs) is where launches go; the legacy stacks keep serving the
 *  coins they list. Every token carries its mode, its pair asset and its home,
 *  and a coin still in auction prices off the house's clearing price. */
class OnairClient extends StableV3Client {
  private legacy: { name: string; client: StableV3Client }[];
  /** token -> legacy client, or null when the primary lists it. */
  private homes = new Map<string, StableV3Client | null>();

  constructor(pc: PublicClient) {
    super(pc, { factory: ADDRESSES.factory, swapRouter: ADDRESSES.swapRouter, quote: ADDRESSES.quote });
    this.legacy = LEGACY.map((d) => ({ name: d.name, client: new StableV3Client(pc, { factory: d.factory, swapRouter: ADDRESSES.swapRouter, quote: ADDRESSES.quote }) }));
  }

  connectWallet(wc: WalletClient) {
    super.connectWallet(wc);
    this.legacy.forEach((l) => l.client.connectWallet(wc));
    onair.connectWallet(wc);
  }

  // -- routing -----------------------------------------------------------

  private nameOf(c: StableV3Client | null): string {
    return c ? this.legacy.find((l) => l.client === c)?.name ?? "legacy" : "v2";
  }

  /** The client that lists `token`; null means this (primary). */
  private async home(token: string): Promise<StableV3Client | null> {
    const key = token.toLowerCase();
    if (this.homes.has(key)) return this.homes.get(key)!;
    const api = await onair.forToken(token as Address);
    const l = this.legacy.find((x) => x.client.addresses.factory.toLowerCase() === api.dep.factory.toLowerCase()) ?? null;
    this.homes.set(key, l ? l.client : null);
    return l ? l.client : null;
  }

  /** Same, without a lookup: the pages always load the coin before subscribing. */
  private homeSync(token: string): StableV3Client | null {
    return this.homes.get(token.toLowerCase()) ?? null;
  }

  // -- decoration --------------------------------------------------------

  private async decorate(list: (TokenSummary & { home?: string })[]): Promise<OnairToken[]> {
    if (list.length === 0) return [];
    const modes = await onair.modes(list.map((t) => t.address as Address)).catch(() => new Map());
    return Promise.all(
      list.map(async (t) => {
        const m = modes.get(t.address.toLowerCase());
        const mode: Mode = m?.mode ?? "instant";
        const home = t.home ?? this.nameOf(this.homeSync(t.address));
        const out: OnairToken = { ...t, mode, home };
        const c = this.homeSync(t.address) ?? this;
        out.pair = await (c === this ? super.pairOf(t.address as Address) : c.pairOf(t.address as Address)).catch(() => undefined);
        if (mode !== "auction") return out;
        const poolless = !t.pool || t.pool === zeroAddress;
        if (m?.finalized && !poolless) return out; // seeded: trades like an instant coin
        const a = await onair.auction(t.address as Address).catch(() => null);
        out.auction = a;
        if (m?.finalized && poolless) {
          // The pool appeared after this listing was cached (or the auction
          // failed); refresh the listing so the next read trades normally.
          await this.refreshListing(t.address as Address).catch(() => {});
        }
        if (a && !a.finalized) {
          const price = q96ToWei(a.clearingQ96);
          const hypeUsd = await this.hypeUsd();
          out.priceWei = price.toString();
          out.priceUsd = String((Number(price) / 1e18) * hypeUsd);
          out.marketCapUsd = String((Number(q96ToFdvWei(a.clearingQ96)) / 1e18) * hypeUsd);
          out.liquidityWei = a.committed.toString();
          out.volumeTotalWei = a.committed.toString();
          out.txCount24h = a.bidCount;
        }
        return out;
      }),
    );
  }

  // -- reads -------------------------------------------------------------

  async getTokens(opts?: { sort?: string; limit?: number }): Promise<OnairToken[]> {
    const [mine, ...others] = await Promise.all([
      super.getTokens(opts),
      ...this.legacy.map((l) => l.client.getTokens(opts).catch(() => [] as TokenSummary[])),
    ]);
    const tagged: (TokenSummary & { home: string })[] = mine.map((t) => { this.homes.set(t.address.toLowerCase(), null); return { ...t, home: "v2" }; });
    others.forEach((list, i) => {
      const l = this.legacy[i];
      for (const t of list) { this.homes.set(t.address.toLowerCase(), l.client); tagged.push({ ...t, home: l.name }); }
    });
    const sort = opts?.sort ?? "new";
    if (sort === "mcap" || sort === "marketCap") tagged.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else tagged.sort((a, b) => b.createdAt - a.createdAt);
    return this.decorate(tagged.slice(0, opts?.limit ?? 60));
  }

  async getToken(token: string): Promise<OnairToken | null> {
    const known = this.homeSync(token);
    let t: TokenSummary | null = null;
    if (known) t = await known.getToken(token);
    else {
      t = await super.getToken(token);
      if (t) this.homes.set(token.toLowerCase(), null);
      else {
        for (const l of this.legacy) {
          t = await l.client.getToken(token).catch(() => null);
          if (t) { this.homes.set(token.toLowerCase(), l.client); break; }
        }
      }
    }
    if (!t) return null;
    return (await this.decorate([{ ...t, home: this.nameOf(this.homeSync(token)) }]))[0];
  }

  async getTrades(token: string, opts?: { limit?: number }): Promise<TradeRecord[]> {
    const h = await this.home(token);
    return h ? h.getTrades(token, opts) : super.getTrades(token, opts);
  }
  async getCandles(token: string, interval: CandleInterval, opts?: { limit?: number }): Promise<Candle[]> {
    const h = await this.home(token);
    return h ? h.getCandles(token, interval, opts) : super.getCandles(token, interval, opts);
  }
  async getHolders(token: string, opts?: { limit?: number }) {
    const h = await this.home(token);
    return h ? h.getHolders(token, opts) : super.getHolders(token, opts);
  }
  subscribeToTrades(token: string, cb: (t: TradeRecord) => void): () => void {
    const h = this.homeSync(token);
    return h ? h.subscribeToTrades(token, cb) : super.subscribeToTrades(token, cb);
  }
  subscribeToPrice(token: string, cb: (u: PriceUpdate) => void): () => void {
    const h = this.homeSync(token);
    return h ? h.subscribeToPrice(token, cb) : super.subscribeToPrice(token, cb);
  }
  async refreshListing(token: Address): Promise<void> {
    const h = await this.home(token);
    return h ? h.refreshListing(token) : super.refreshListing(token);
  }
  async pairOf(token: Address): Promise<PairInfo> {
    const h = await this.home(token);
    return h ? h.pairOf(token) : super.pairOf(token);
  }
  async baseRewards(coin: Address, account: Address) {
    const h = await this.home(coin);
    return h ? h.baseRewards(coin, account) : super.baseRewards(coin, account);
  }

  // -- writes ------------------------------------------------------------

  async previewSwapOut(token: Address, side: "buy" | "sell", amountInWei: bigint): Promise<bigint | null> {
    const h = await this.home(token);
    return h ? h.previewSwapOut(token, side, amountInWei) : super.previewSwapOut(token, side, amountInWei);
  }
  async buyToken(token: Address, nativeWei: bigint, minOut: bigint): Promise<`0x${string}`> {
    const h = await this.home(token);
    return h ? h.buyToken(token, nativeWei, minOut) : super.buyToken(token, nativeWei, minOut);
  }
  async sellToken(token: Address, amountIn: bigint, minOut: bigint): Promise<`0x${string}`> {
    const h = await this.home(token);
    return h ? h.sellToken(token, amountIn, minOut) : super.sellToken(token, amountIn, minOut);
  }
  async claimCreatorFees(token: Address): Promise<`0x${string}`> {
    const h = await this.home(token);
    return h ? h.claimCreatorFees(token) : super.claimCreatorFees(token);
  }
  async claimBaseRewards(coin: Address, account: Address): Promise<`0x${string}`[]> {
    const h = await this.home(coin);
    return h ? h.claimBaseRewards(coin, account) : super.claimBaseRewards(coin, account);
  }

  private async hypeUsd(): Promise<number> {
    return this.assetUsdPrice(ADDRESSES.quote).catch(() => 0);
  }
}

/** One client for the whole app: reads over RPC, writes through the connected wallet. */
export const client = new OnairClient(publicClient);
