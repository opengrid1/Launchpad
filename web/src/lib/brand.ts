/**
 * Single source of truth for brand identity. The app ships in flavors —
 * select one at build time with VITE_BRAND (default: quiverpad). Rename here
 * and it changes everywhere — header, footer, wallet metadata, docs, and
 * page meta.
 */
export interface Brand {
  name: string;
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
  quiverpad: {
    name: "Quiverpad",
    domain: "quiverpad.xyz",
    url: "https://quiverpad.xyz",
    twitter: "https://x.com/quiverpad",
    twitterHandle: "quiverpad",
    tagline: "Launch real markets. Holders earn stocks.",
    description:
      "Quiverpad. Launch tokens into real Uniswap V4 markets on Robinhood Chain. Every trade rewards holders with real tokenized stocks.",
    title: "Quiverpad | Token Launchpad on Robinhood Chain",
  },
  steadypads: {
    name: "Steadypads",
    domain: "steadypads.vercel.app",
    url: "https://steadypads.vercel.app",
    twitter: "https://x.com/steadypads",
    twitterHandle: "steadypads",
    tagline: "The stable launchpad. Holders earn dollars.",
    description:
      "Steadypads. Launch tokens into real Uniswap V4 markets on Stable. Every trade rewards holders with real dollars.",
    title: "Steadypads | Token Launchpad on Stable",
  },
};

export const BRAND_FLAVOR = String(import.meta.env.VITE_BRAND ?? "quiverpad");

export const BRAND: Brand = FLAVORS[BRAND_FLAVOR] ?? FLAVORS.quiverpad;
