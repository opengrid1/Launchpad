/**
 * Single source of truth for brand identity. Rename here and it changes
 * everywhere — header, footer, wallet metadata, docs, and page meta.
 */
export const BRAND = {
  name: "Stockprintr",
  domain: "stockprintr.xyz",
  url: "https://stockprintr.xyz",
  twitter: "https://x.com/stockprintr",
  twitterHandle: "stockprintr",
  tagline: "The printer that prints real stock.",
  description:
    "Stockprintr. Print memecoins into real Uniswap V4 markets on Robinhood Chain. Every trade pays holders real tokenized stock, delivered straight to their wallets.",
} as const;
