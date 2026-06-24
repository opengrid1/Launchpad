export type Status = "bonding" | "graduated";

export type Launch = {
  id: string;
  name: string;
  symbol: string;
  status: Status;          // bonding = trading on the curve, graduated = on a DEX
  priceEth: number;        // current price per token
  marketCap: number;       // ETH
  liquidity: number;       // ETH held in the curve / pool
  graduateAt: number;      // market cap (ETH) at which it migrates to a DEX
  change24h: number;       // %
  holders: number;
  supply: number;          // total token supply
  createdAgo: string;
  about: string;
  roles: { mint: boolean; burn: boolean; pause: boolean; freeze: boolean };
  links?: { website?: string; x?: string; telegram?: string; discord?: string };
};

// Sample data. In production these come from on-chain curve state + the token's
// B20 / ERC-7572 metadata.
export const LAUNCHES: Launch[] = [
  {
    id: "veilcoin", name: "Veilcoin", symbol: "VEIL", status: "bonding",
    priceEth: 0.0000041, marketCap: 41, liquidity: 41, graduateAt: 80, change24h: 12.4,
    holders: 612, supply: 1_000_000_000, createdAgo: "2m ago",
    about: "Compliance-aware privacy credits, issued natively on Base via B20. Instant trade on a bonding curve.",
    roles: { mint: true, burn: true, pause: true, freeze: false },
    links: { website: "https://veil.cash", x: "x.com/veilcash", telegram: "t.me/veilcash" },
  },
  {
    id: "solace", name: "Solace", symbol: "SOL8", status: "bonding",
    priceEth: 0.0000002, marketCap: 2.1, liquidity: 2.1, graduateAt: 70, change24h: 31.8,
    holders: 23, supply: 1_000_000_000, createdAgo: "5m ago",
    about: "Treasury-backed utility token for a privacy relayer network.",
    roles: { mint: true, burn: true, pause: false, freeze: false },
  },
  {
    id: "ferro", name: "Ferro RWA", symbol: "FERRO", status: "bonding",
    priceEth: 0.0000061, marketCap: 6.1, liquidity: 6.1, graduateAt: 120, change24h: -4.2,
    holders: 88, supply: 10_000_000, createdAgo: "18m ago",
    about: "Tokenized industrial-metal inventory. RWA issuance with on-chain compliance roles.",
    roles: { mint: true, burn: true, pause: true, freeze: true },
  },
  {
    id: "meridian", name: "Meridian", symbol: "MRD", status: "bonding",
    priceEth: 0.0000009, marketCap: 9.0, liquidity: 9.0, graduateAt: 60, change24h: -8.1,
    holders: 140, supply: 25_000_000, createdAgo: "1h ago",
    about: "Community treasury token. Fair launch, no team allocation.",
    roles: { mint: true, burn: false, pause: true, freeze: false },
  },
  {
    id: "basis", name: "Basis Dollar", symbol: "bUSD", status: "graduated",
    priceEth: 0.0004, marketCap: 220, liquidity: 80, graduateAt: 80, change24h: 2.6,
    holders: 1843, supply: 50_000_000, createdAgo: "3d ago",
    about: "A fully-reserved stablecoin using B20 chain-level mint/burn and freeze controls. Graduated to a Base DEX.",
    roles: { mint: true, burn: true, pause: true, freeze: true },
    links: { website: "https://basis.example", x: "x.com/basisdollar", discord: "discord.gg/basis" },
  },
  {
    id: "pixl", name: "Pixl", symbol: "PIXL", status: "graduated",
    priceEth: 0.00002, marketCap: 140, liquidity: 35, graduateAt: 35, change24h: -6.8,
    holders: 2210, supply: 1_000_000_000, createdAgo: "5d ago",
    about: "Long-tail community token. Fair launch, LP burned, no team allocation.",
    roles: { mint: false, burn: true, pause: false, freeze: false },
  },
];

export const fmt = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { maximumFractionDigits: dp });
