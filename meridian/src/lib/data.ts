/* Deterministic demo data. A seeded PRNG keeps every render identical so the
   UI feels like a stable product, not a dice roll. */

export interface Token {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  color: string;
  colorB: string;
  series: number[];
  holding: number; // demo portfolio balance in units
}

export interface Tx {
  id: string;
  kind: "swap" | "send" | "receive" | "approve";
  title: string;
  detail: string;
  amountUsd: number;
  direction: "in" | "out" | "none";
  status: "confirmed" | "pending" | "failed";
  ts: number;
  hash: string;
  symbol: string;
}

export interface Chain {
  id: string;
  name: string;
  short: string;
  color: string;
  latency: string;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function series(seed: number, n: number, start: number, drift: number, vol: number): number[] {
  const rnd = mulberry32(seed);
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    v = Math.max(start * 0.4, v * (1 + drift + (rnd() - 0.5) * vol));
    out.push(v);
  }
  return out;
}

export const CHAINS: Chain[] = [
  { id: "meridian", name: "Meridian One", short: "MR1", color: "#3DE8B0", latency: "0.4s" },
  { id: "ethereum", name: "Ethereum", short: "ETH", color: "#8A9BF5", latency: "12s" },
  { id: "arbitrum", name: "Arbitrum One", short: "ARB", color: "#4DD6E8", latency: "0.3s" },
  { id: "base", name: "Base", short: "BASE", color: "#5B8DEF", latency: "2s" },
];

const defs: Array<
  [string, string, number, number, number, number, string, string, number, number]
> = [
  // symbol, name, price, change, mcap(B), vol(M), colorA, colorB, seed, holding
  ["MRD", "Meridian", 4.82, 6.34, 4.82, 312.4, "#3DE8B0", "#14B98C", 11, 1240],
  ["ETH", "Ether", 4318.2, 2.18, 519.6, 18240.0, "#8A9BF5", "#5B6BD6", 12, 2.4482],
  ["BTC", "Bitcoin", 118432.0, 1.42, 2334.1, 41520.0, "#F7B84B", "#E09B2D", 13, 0.0871],
  ["USDM", "Meridian Dollar", 1.0, 0.01, 8.91, 5230.0, "#4DD6E8", "#2BA8C9", 14, 5120.5],
  ["SOL", "Solana", 216.4, -1.86, 104.2, 6120.0, "#B98AF5", "#8A5BD6", 15, 18.2],
  ["LINK", "Chainlink", 24.61, 4.07, 15.7, 942.0, "#6B8DEF", "#4B6DD0", 16, 96.0],
  ["ARB", "Arbitrum", 1.28, -2.94, 5.4, 486.0, "#4DD6E8", "#3BAAC0", 17, 820.0],
  ["UNI", "Uniswap", 12.84, 3.12, 9.7, 512.0, "#F58AB9", "#D65B92", 18, 44.6],
  ["AAVE", "Aave", 302.7, 5.61, 4.6, 618.0, "#8AE8D6", "#5BC9B2", 19, 3.1],
  ["OP", "Optimism", 2.14, -0.73, 3.5, 271.0, "#FF8A9B", "#E06376", 20, 410.0],
];

export const TOKENS: Token[] = defs.map(
  ([symbol, name, price, change24h, mcapB, volM, color, colorB, seed, holding]) => ({
    symbol,
    name,
    price,
    change24h,
    marketCap: mcapB * 1e9,
    volume24h: volM * 1e6,
    color,
    colorB,
    series: series(seed, 48, price, change24h / 4800, 0.02),
    holding,
  })
);

export function tokenBySymbol(symbol: string): Token | undefined {
  return TOKENS.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
}

export function portfolioValue(): number {
  return TOKENS.reduce((sum, t) => sum + t.holding * t.price, 0);
}

/* Portfolio history for the dashboard chart, per range. */
export function portfolioSeries(range: string): number[] {
  const total = portfolioValue();
  const cfg: Record<string, [number, number, number]> = {
    "1D": [48, 0.0006, 0.006],
    "1W": [56, 0.001, 0.012],
    "1M": [60, 0.0016, 0.02],
    "1Y": [72, 0.003, 0.032],
  };
  const [n, drift, vol] = cfg[range] ?? cfg["1M"];
  const s = series(40 + range.charCodeAt(0), n, total * 0.86, drift, vol);
  // Anchor the last point at the live total so the number and chart agree.
  const scale = total / s[s.length - 1];
  return s.map((v) => v * scale);
}

const WALLETS = [
  "0x7A3f9c41E52b8D06a1F4C9e83B75D2a4C1e6F09B",
  "0x912dC08A4b6E37F1c25a9D80E4b3F6C7D2A1B845",
  "0x3E5a7B92C1d4F8060B9c2E71A5d3C4B6E8F90A12",
];

function makeTxs(): Tx[] {
  const rnd = mulberry32(777);
  const now = Date.now();
  const out: Tx[] = [];
  const templates: Array<() => Omit<Tx, "id" | "ts" | "hash">> = [
    () => {
      const a = TOKENS[Math.floor(rnd() * TOKENS.length)];
      let b = TOKENS[Math.floor(rnd() * TOKENS.length)];
      if (b.symbol === a.symbol) b = TOKENS[(TOKENS.indexOf(a) + 1) % TOKENS.length];
      const usd = 40 + rnd() * 5200;
      return {
        kind: "swap",
        title: `Swap ${a.symbol} → ${b.symbol}`,
        detail: `${(usd / a.price).toFixed(4)} ${a.symbol} for ${(usd / b.price).toFixed(4)} ${b.symbol}`,
        amountUsd: usd,
        direction: "none",
        status: "confirmed",
        symbol: b.symbol,
      };
    },
    () => {
      const a = TOKENS[Math.floor(rnd() * TOKENS.length)];
      const usd = 25 + rnd() * 3800;
      return {
        kind: "send",
        title: `Sent ${a.symbol}`,
        detail: `To ${WALLETS[Math.floor(rnd() * WALLETS.length)].slice(0, 6)}…`,
        amountUsd: usd,
        direction: "out",
        status: "confirmed",
        symbol: a.symbol,
      };
    },
    () => {
      const a = TOKENS[Math.floor(rnd() * TOKENS.length)];
      const usd = 25 + rnd() * 4600;
      return {
        kind: "receive",
        title: `Received ${a.symbol}`,
        detail: `From ${WALLETS[Math.floor(rnd() * WALLETS.length)].slice(0, 6)}…`,
        amountUsd: usd,
        direction: "in",
        status: "confirmed",
        symbol: a.symbol,
      };
    },
    () => {
      const a = TOKENS[Math.floor(rnd() * TOKENS.length)];
      return {
        kind: "approve",
        title: `Approved ${a.symbol}`,
        detail: "Meridian Router",
        amountUsd: 0,
        direction: "none",
        status: "confirmed",
        symbol: a.symbol,
      };
    },
  ];

  let ts = now - 4 * 60 * 1000;
  for (let i = 0; i < 32; i++) {
    const t = templates[Math.floor(rnd() * templates.length)]();
    const hash = `0x${Array.from({ length: 12 }, () =>
      Math.floor(rnd() * 16).toString(16)
    ).join("")}…`;
    out.push({ ...t, id: `tx-${i}`, ts, hash });
    ts -= (0.4 + rnd() * 16) * 60 * 60 * 1000;
  }
  out[0].status = "pending";
  out[5].status = "failed";
  return out;
}

export const TRANSACTIONS: Tx[] = makeTxs();

export const STATS = {
  totalValueSettled: 84.6e9,
  transactions: 412.8e6,
  networks: 24,
  medianFee: 0.0041,
};

export const FEATURES = [
  {
    icon: "zap",
    title: "Instant settlement",
    body: "Transactions finalize in under a second across every supported network. No waiting, no guessing — value moves the moment you send it.",
  },
  {
    icon: "shield",
    title: "Security first",
    body: "Every route is verified end-to-end, keys never leave your device, and every contract in the path is audited and open source.",
  },
  {
    icon: "layers",
    title: "One balance, every chain",
    body: "Meridian abstracts networks away. Hold one portfolio and spend it anywhere — routing, bridging and gas are handled for you.",
  },
  {
    icon: "chart",
    title: "Live market depth",
    body: "Institutional-grade pricing sourced from aggregated on-chain liquidity, streamed to your dashboard in real time.",
  },
  {
    icon: "droplet",
    title: "Deep native liquidity",
    body: "Orders route through concentrated liquidity pools with minimal slippage, even at size. Best execution is the default.",
  },
  {
    icon: "globe",
    title: "Borderless by design",
    body: "Send to any address, any network, any hour. Meridian settles globally with the same fee whether it's $5 or $5 million.",
  },
];
