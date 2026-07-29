/**
 * Single source of truth for brand identity. The app ships in flavors -
 * select one at build time with VITE_BRAND (default: stockprintr). Rename here
 * and it changes everywhere; header, footer, wallet metadata, docs, and
 * page meta.
 */
export interface Brand {
  /** Lowercase wordmark base, e.g. "stockprintr". */
  name: string;
  /** Accented wordmark suffix rendered after the name, e.g. ".fun". */
  tld: string;
  domain: string;
  url: string;
  twitter: string;
  twitterHandle: string;
  tagline: string;
  description: string;
  /** Browser tab title; applied at runtime in main.tsx. */
  title: string;
}

const FLAVORS: Record<string, Brand> = {
  stockprintr: {
    name: "stockprintr",
    tld: ".fun",
    domain: "stockprintr.fun",
    url: "https://stockprintr.fun",
    twitter: "https://x.com/stockprintr",
    twitterHandle: "stockprintr",
    tagline: "the printer that prints real stock",
    description:
      "stockprintr. print memecoins into real Uniswap markets on Robinhood Chain. Every trade pays holders real tokenized stock.",
    title: "stockprintr | the printer that prints real stock",
  },
  steadypads: {
    name: "steadypads",
    tld: ".fun",
    domain: "steadypads.vercel.app",
    url: "https://steadypads.vercel.app",
    twitter: "https://x.com/steadypads",
    twitterHandle: "steadypads",
    tagline: "the stable launchpad",
    description:
      "steadypads. launch tokens into real Uniswap markets. Every trade pays its creator, forever.",
    title: "steadypads | the stable launchpad",
  },
};

export const BRAND_FLAVOR = String(import.meta.env.VITE_BRAND ?? "stockprintr");

export const BRAND: Brand = FLAVORS[BRAND_FLAVOR] ?? FLAVORS.stockprintr;
