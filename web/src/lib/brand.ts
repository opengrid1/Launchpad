/**
 * Single source of truth for brand identity. The app ships in flavors -
 * select one at build time with VITE_BRAND (default: wingman). Rename here
 * and it changes everywhere; header, footer, wallet metadata, docs, and
 * page meta.
 */
export interface Brand {
  /** Lowercase wordmark base, e.g. "wingman". */
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
  wingman: {
    name: "wingman",
    tld: ".fun",
    domain: "wingman.fun",
    url: "https://wingman.fun",
    twitter: "https://x.com/wingmandotfun",
    twitterHandle: "wingmandotfun",
    tagline: "every coin flies with a wingman",
    description:
      "wingman. launch a coin paired with any stock, meme, or ETH on Robinhood Chain. Every trade pays holders the token it flies with.",
    title: "wingman | every coin flies with a wingman",
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
  // Arc mainnet flavor: same product, USDC-blue theme for Circle's Arc chain.
  arc: {
    name: "arcx",
    tld: ".fun",
    domain: "arcx.fun",
    url: "https://arcx.fun",
    twitter: "https://x.com/steadypads",
    twitterHandle: "steadypads",
    tagline: "the stable launchpad on Arc",
    description:
      "arcx. launch tokens into real Uniswap markets on Arc. Every trade pays its creator in dollars, forever.",
    title: "arcx | the stable launchpad on Arc",
  },
};

export const BRAND_FLAVOR = String(import.meta.env.VITE_BRAND ?? "wingman");

export const BRAND: Brand = FLAVORS[BRAND_FLAVOR] ?? FLAVORS.wingman;
