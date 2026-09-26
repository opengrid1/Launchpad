/** Mirrors of the contract views. Amounts are raw unit strings. */

export type PairAsset = "Near" | { Token: { account_id: string; symbol: string; decimals: number } };

export interface Pair {
  key: string;
  asset: PairAsset;
  name: string;
  virtual_reserve: string;
  enabled: boolean;
}

export interface CoinRow {
  id: number;
  account_id: string;
  name: string;
  symbol: string;
  pair: string;
  creator: string;
  created_at_ms: number;
  code_version: string;
  hidden: boolean;
}

export interface Split {
  creator_bps: number;
  dividends_bps: number;
  burn_bps: number;
  liquidity_bps: number;
}

export interface Links {
  website: string | null;
  x: string | null;
  telegram: string | null;
}

export type Phase = "Curve" | "Graduating" | "Pool";

export interface Info {
  factory: string;
  treasury: string;
  name: string;
  symbol: string;
  icon: string | null;
  description: string;
  links: Links;
  creator: string;
  fee_wallet: string;
  created_at_ms: number;
  pair: PairAsset;
  virtual_reserve: string;
  buy_tax_bps: number;
  sell_tax_bps: number;
  split: Split;
  phase: Phase;
  total_supply: string;
  tokens_sold: string;
  raised: string;
  pool_pair: string;
  pool_tokens: string;
  price: string;
  market_cap: string;
  graduation: string;
  curve_supply: string;
  burned: string;
  buyback_spent: string;
  liquidity_added: string;
  dividends_total: string;
  creator_fees_total: string;
  platform_fees_total: string;
  pending_buyback: string;
  pending_liquidity: string;
  platform_credit: string;
  trades: number;
  holders: number;
}

export interface Holder {
  balance: string;
  claimable_dividends: string;
  credit: string;
}

export interface Candle { t: number; o: string; h: string; l: string; c: string; v: string }
export interface Trade { t: number; account: string; buy: boolean; pair: string; tokens: string; price: string }

export interface Config {
  owner: string;
  treasury: string;
  launch_fee: string;
  coin_state_deposit: string;
  paused: boolean;
  current_version: { version: string; code_hash: string; published_at_block: number } | null;
  count: number;
}

/** A coin with its live state, as the site uses it. */
export interface Coin extends CoinRow {
  info: Info;
}

export const pairSymbol = (p: PairAsset) => (p === "Near" ? "NEAR" : p.Token.symbol);
export const pairDecimals = (p: PairAsset) => (p === "Near" ? 24 : p.Token.decimals);
export const pairAccount = (p: PairAsset) => (p === "Near" ? null : p.Token.account_id);
export const isNearPair = (p: PairAsset) => p === "Near";
