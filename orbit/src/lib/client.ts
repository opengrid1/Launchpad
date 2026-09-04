import { createPublicClient, fallback, http, type Address, type PublicClient, type WalletClient, zeroAddress } from "viem";
import type { TokenSummary } from "@launchpad/sdk";

import { ADDRESSES, chain, env } from "./env";
import { OnairApi, q96ToFdvWei, q96ToWei, type AuctionState, type Mode } from "./onair";
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

/** Auction-specific reads and writes (house + factory). */
export const onair = new OnairApi(publicClient);

export type OnairToken = TokenSummary & {
  sparkline?: number[];
  mode: Mode;
  /** Present for auction launches: live state while running, final flags after. */
  auction?: AuctionState | null;
};

/** The generic V3 client (pools, trades, charts, swaps) with ONAIR's two
 *  launch models layered on: every token carries its mode, and a coin still
 *  in auction prices off the house's clearing price instead of a pool. */
class OnairClient extends StableV3Client {
  connectWallet(wc: WalletClient) {
    super.connectWallet(wc);
    onair.connectWallet(wc);
  }

  private async decorate(list: TokenSummary[]): Promise<OnairToken[]> {
    if (list.length === 0) return [];
    const modes = await onair.modes(list.map((t) => t.address as Address)).catch(() => new Map());
    return Promise.all(
      list.map(async (t) => {
        const m = modes.get(t.address.toLowerCase());
        const mode: Mode = m?.mode ?? "instant";
        const out: OnairToken = { ...t, mode };
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

  async getTokens(opts?: { sort?: string; limit?: number }): Promise<OnairToken[]> {
    return this.decorate(await super.getTokens(opts));
  }

  async getToken(token: string): Promise<OnairToken | null> {
    const t = await super.getToken(token);
    if (!t) return null;
    return (await this.decorate([t]))[0];
  }

  private async hypeUsd(): Promise<number> {
    return this.assetUsdPrice(ADDRESSES.quote).catch(() => 0);
  }
}

/** One client for the whole app: reads over RPC, writes through the connected wallet. */
export const client = new OnairClient(publicClient, {
  factory: ADDRESSES.factory,
  swapRouter: ADDRESSES.swapRouter,
  quote: ADDRESSES.quote,
});
