import { createPublicClient, fallback, http, type PublicClient } from "viem";

import { ADDRESSES, chain, env } from "./env";
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

/** One client for the whole app: reads over RPC, writes through the connected wallet. */
export const client = new StableV3Client(publicClient, {
  factory: ADDRESSES.factory,
  swapRouter: ADDRESSES.swapRouter,
  quote: ADDRESSES.quote,
});
