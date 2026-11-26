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
  // The flavor key stays "copair" (build wiring + CSS scope); the brand is hoodheist.
  copair: {
    name: "hoodheist",
    tld: ".fun",
    domain: "hoodheist.fun",
    url: "https://hoodheist.fun",
    twitter: "https://x.com/hoodheistfun",
    twitterHandle: "hoodheistfun",
    tagline: "pull the heist, split the loot",
    description:
      "hoodheist. The launchpad heist on Robinhood Chain: every trade skims 1% into the loot. 25% burns the weekly top 3 coins, 30% pays the crew back in ETH, 20% pays the deployer for life.",
    title: "hoodheist | pull the heist, split the loot",
  },
  // Base stock launchpad: memecoins paired with tokenized stocks; holders
  // earn the stock. Working brand name, easy to rename here.
  base: {
    name: "basedstonk",
    tld: ".fun",
    domain: "basedstonk.fun",
    url: "https://basedstonk.fun",
    twitter: "https://x.com/",
    twitterHandle: "",
    tagline: "launch a coin, earn real stock",
    description:
      "basedstonk.fun. Launch a memecoin on Base paired with a tokenized stock. Every trade rewards holders in that stock: hold the coin, earn NVIDIA, Apple, Google and more.",
    title: "basedstonk | launch a coin, earn real stock",
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
  // HyperEVM flavor (stonkliquid): coins launch on HyperSwap V3, pairing WHYPE
  // or a tokenized stock; the pool's 1% fee splits 50% holders / 40% creator /
  // 10% platform, holder rewards claimed manually. Hyperliquid dark/teal theme.
  hyper: {
    name: "hyperstock",
    tld: ".fun",
    domain: "hyperstock.fun",
    url: "https://hyperstock.fun",
    twitter: "https://x.com/",
    twitterHandle: "",
    tagline: "launch a coin, earn the fees",
    description:
      "hyperstock.fun. Launch a coin on HyperEVM paired with HYPE or a tokenized stock. It opens a real HyperSwap market and every trade pays 1%: half to holders, 40% to the creator, forever.",
    title: "hyperstock | launch a coin, earn the fees",
  },
  // Ink chain flavor (squidpad): canonical Uniswap V3 on Ink, coins pair ETH;
  // the 1% pool fee splits 50/40/10 holders/creator/platform, manual claims.
  ink: {
    name: "squidpad",
    tld: ".fun",
    domain: "squidpad.fun",
    url: "https://squidpad.fun",
    twitter: "https://x.com/",
    twitterHandle: "",
    tagline: "launch in the deep",
    description:
      "squidpad. Launch a coin on Ink. One transaction opens a real Uniswap market and every trade pays 1%: half to holders, 40% to the creator, forever.",
    title: "squidpad | launch in the deep",
  },
  // Meowstock: the squidpad product/design (teal, chart-first) on HyperEVM,
  // rebranded with a cat mark. Same 50/40/10 stock-reward mechanics.
  meow: {
    name: "meowstock",
    tld: ".fun",
    domain: "meowstock.fun",
    url: "https://meowstock.fun",
    twitter: "https://x.com/",
    twitterHandle: "",
    tagline: "hold the coin, earn the stock",
    description:
      "meowstock. Launch a coin on HyperEVM paired with a tokenized stock. One transaction opens a real market and every trade pays 1%: half to holders, 40% to the creator, forever.",
    title: "meowstock | hold the coin, earn the stock",
  },
  // Robinhood Chain flavor: coins pair a tokenized stock and holders earn it,
  // paid out like dividends. Brand: Dividenz.
  robinhood: {
    name: "Dividenz",
    tld: ".fun",
    domain: "dividenz.fun",
    url: "https://dividenz.fun",
    twitter: "https://x.com/",
    twitterHandle: "",
    tagline: "hold the coin, earn the stock",
    description:
      "Dividenz. Launch a coin on Robinhood Chain paired with a tokenized stock. Every buy takes a 1% fee: 50% to holders, 40% to the creator, 10% to the platform. Holders are paid their share in the stock, like dividends.",
    title: "Dividenz | hold the coin, earn the stock",
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

/** The HyperEVM launchpad (stonkliquid): HyperSwap V3, coins pair WHYPE or a
 *  tokenized stock; fees split holders/creator/platform, manual claims. */
export const IS_HYPER = BRAND_FLAVOR === "hyper";

/** Meowstock: the squidpad design and mechanics on HyperEVM, cat-branded. */
export const IS_MEOW = BRAND_FLAVOR === "meow";

/** Robinhood Chain launchpad: the squidpad/meowstock design and mechanics on
 *  Robinhood Chain (chainId 4663), coins pair a tokenized stock via Uniswap V3.
 *  Placeholder brand pending a final name. */
export const IS_ROBIN = BRAND_FLAVOR === "robinhood";

/** The squidpad-style app (Ink squidpad + HyperEVM meowstock + Robinhood Chain):
 *  teal design, chart-first token view, amount-first desk, boot splash. These
 *  flavors reuse the whole ink presentation; chain-specific bits still key off
 *  BRAND_FLAVOR. */
export const IS_INK = BRAND_FLAVOR === "ink" || BRAND_FLAVOR === "meow" || BRAND_FLAVOR === "robinhood";

/** Flavors that render the pump.fun-style live market board (BoardHeader +
 *  ExploreBoard) instead of the default card grid: the Robinhood heist board,
 *  the Base stock launchpad, and the HyperEVM launchpad. */
export const IS_BOARD = BRAND_FLAVOR === "copair" || BRAND_FLAVOR === "base" || IS_HYPER || IS_INK;

/** The Base stock launchpad: coins pair a tokenized stock and holders earn it.
 *  Distinct from the heist board's weekly-flywheel loot model. */
export const IS_STOCK_BOARD = BRAND_FLAVOR === "base";
