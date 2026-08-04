/**
 * Single source of truth for brand identity. The app ships in flavors -
 * select one at build time with VITE_BRAND (default: copair). Rename here
 * and it changes everywhere; header, footer, wallet metadata, docs, and
 * page meta.
 */
export interface Brand {
  /** Lowercase wordmark base, e.g. "copair". */
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
  hammr: {
    name: "hammr",
    tld: ".fun",
    domain: "hammr.fun",
    url: "https://hammr.fun",
    twitter: "https://x.com/hammrfun",
    twitterHandle: "hammrfun",
    tagline: "every coin goes under the hammer",
    description:
      "hammr. dutch-auction launchpad on Robinhood Chain: coins start at 10x and fall for one hour, then the hammer drops, liquidity locks, and holders earn the pair token on every trade.",
    title: "hammr | every coin goes under the hammer",
  },
  // The flavor key stays "copair" (build wiring + CSS scope); the brand is toebeans.
  copair: {
    name: "toebeans",
    tld: ".fun",
    domain: "toebeans.fun",
    url: "https://toebeans.fun",
    twitter: "https://x.com/Toebeans_fun",
    twitterHandle: "Toebeans_fun",
    tagline: "every coin lands on its feet",
    description:
      "toebeans. launch a coin on Robinhood Chain and earn 80% of every trade fee in ETH. A real bid wall grows under your coin, so it always lands on its feet.",
    title: "toebeans | launch a coin, earn ETH on every trade",
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

export const BRAND_FLAVOR = String(import.meta.env.VITE_BRAND ?? "copair");

export const BRAND: Brand = FLAVORS[BRAND_FLAVOR] ?? FLAVORS.copair;
