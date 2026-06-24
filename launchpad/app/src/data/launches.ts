export type Status = "live" | "upcoming" | "success" | "ended";

export type Launch = {
  id: string;
  name: string;
  symbol: string;
  status: Status;
  priceEth: number;        // ETH per token
  raised: number;          // ETH
  softCap: number;         // ETH
  hardCap: number;         // ETH
  supply: number;          // total token supply
  forSale: number;         // tokens offered
  holders: number;
  endsIn: string;
  about: string;
  roles: { mint: boolean; burn: boolean; pause: boolean; freeze: boolean };
  links?: { website?: string; x?: string; telegram?: string; discord?: string };
};

// Sample data for the UI. Replace with on-chain B20 reads when wiring.
export const LAUNCHES: Launch[] = [
  {
    id: "veilcoin",
    name: "Veilcoin",
    symbol: "VEIL",
    status: "live",
    priceEth: 0.00008,
    raised: 41.2,
    softCap: 10,
    hardCap: 80,
    supply: 100_000_000,
    forSale: 20_000_000,
    holders: 612,
    endsIn: "2d 4h",
    about: "Compliance-aware privacy credits, issued natively on Base via B20.",
    roles: { mint: true, burn: true, pause: true, freeze: false },
    links: { website: "https://veil.cash", x: "x.com/veilcash", telegram: "t.me/veilcash" },
  },
  {
    id: "basis",
    name: "Basis Dollar",
    symbol: "bUSD",
    status: "live",
    priceEth: 0.0004,
    raised: 122.5,
    softCap: 50,
    hardCap: 150,
    supply: 50_000_000,
    forSale: 12_000_000,
    holders: 1843,
    endsIn: "11h",
    about: "A fully-reserved stablecoin using B20 chain-level mint/burn and freeze controls.",
    roles: { mint: true, burn: true, pause: true, freeze: true },
    links: { website: "https://basis.example", x: "x.com/basisdollar", discord: "discord.gg/basis" },
  },
  {
    id: "ferro",
    name: "Ferro RWA",
    symbol: "FERRO",
    status: "upcoming",
    priceEth: 0.0012,
    raised: 0,
    softCap: 30,
    hardCap: 120,
    supply: 10_000_000,
    forSale: 3_000_000,
    holders: 0,
    endsIn: "starts 1d 6h",
    about: "Tokenized industrial-metal inventory. RWA issuance with on-chain compliance roles.",
    roles: { mint: true, burn: true, pause: true, freeze: true },
  },
  {
    id: "pixl",
    name: "Pixl",
    symbol: "PIXL",
    status: "success",
    priceEth: 0.00002,
    raised: 35,
    softCap: 5,
    hardCap: 35,
    supply: 1_000_000_000,
    forSale: 300_000_000,
    holders: 2210,
    endsIn: "closed",
    about: "Long-tail community token. Fair launch, LP burned, no team allocation.",
    roles: { mint: false, burn: true, pause: false, freeze: false },
  },
  {
    id: "meridian",
    name: "Meridian",
    symbol: "MRD",
    status: "ended",
    priceEth: 0.0003,
    raised: 8.4,
    softCap: 20,
    hardCap: 60,
    supply: 25_000_000,
    forSale: 8_000_000,
    holders: 0,
    endsIn: "refundable",
    about: "Soft cap missed. Contributions are fully refundable.",
    roles: { mint: true, burn: false, pause: true, freeze: false },
  },
  {
    id: "solace",
    name: "Solace",
    symbol: "SOL8",
    status: "upcoming",
    priceEth: 0.00015,
    raised: 0,
    softCap: 15,
    hardCap: 70,
    supply: 40_000_000,
    forSale: 9_000_000,
    holders: 0,
    endsIn: "starts 3d",
    about: "Treasury-backed utility token for a privacy relayer network.",
    roles: { mint: true, burn: true, pause: false, freeze: false },
  },
];

export const fmt = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { maximumFractionDigits: dp });
