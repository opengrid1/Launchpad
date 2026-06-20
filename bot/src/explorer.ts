import { EXPLORER_API } from "./config.js";

/**
 * Thin wrapper over the chain's Blockscout v2 REST API. This is the open,
 * unauthenticated way to "fetch all data" about a token — the project's own
 * chart API (api-chart.poptyedev.com) is session-gated, but Blockscout is not.
 */
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${EXPLORER_API}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Explorer ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export interface ExplorerToken {
  address_hash: string;
  name: string;
  symbol: string;
  decimals: string;
  total_supply: string;
  holders_count: string;
  type: string;
  exchange_rate: string | null;
  circulating_market_cap: string | null;
  volume_24h: string | null;
}

export const explorer = {
  token: (address: string) => get<ExplorerToken>(`/tokens/${address}`),
  counters: (address: string) =>
    get<{ token_holders_count: string; transfers_count: string }>(`/tokens/${address}/counters`),
  holders: (address: string) =>
    get<{ items: { address: { hash: string; name: string | null; is_contract: boolean }; value: string }[] }>(
      `/tokens/${address}/holders`,
    ),
  transfers: (address: string) =>
    get<{ items: { method: string; timestamp: string; from: { hash: string }; to: { hash: string }; total: { value: string; decimals: string }; transaction_hash: string }[] }>(
      `/tokens/${address}/transfers`,
    ),
  addressTokens: (address: string) =>
    get<{ items: { token: ExplorerToken; value: string }[] }>(`/addresses/${address}/tokens?type=ERC-20`),
  stats: () => get<Record<string, unknown>>(`/stats`),
};
