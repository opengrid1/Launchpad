import type { Address } from "viem";

/** Tokenized stocks holders can earn, curated on the factory. */
export interface Stock {
  symbol: string;
  name: string;
  address: Address;
}

export const STOCKS: Stock[] = [
  { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
  { symbol: "GOOGL", name: "Alphabet", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
  { symbol: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" },
  { symbol: "AMD", name: "AMD", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC" },
  { symbol: "SNDK", name: "Sandisk", address: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400" },
  { symbol: "USO", name: "US Oil Fund", address: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344" },
];

// MU and SPCX are listed on the factory but their registered reward pools
// have no in-range liquidity on chain, so harvests for them cannot buy stock
// (the factory is renounced, so the pool routes cannot be repointed). Kept
// out of the picker until their pools are seeded.
export const BROKEN_STOCKS: Stock[] = [
  { symbol: "MU", name: "Micron", address: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD" },
  { symbol: "SPCX", name: "SpaceX", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa" },
];

export function stockOf(address: string): Stock | undefined {
  // Existing tokens may reward a stock no longer offered in the picker, so
  // resolve against both lists.
  return [...STOCKS, ...BROKEN_STOCKS].find((s) => s.address.toLowerCase() === address.toLowerCase());
}

/** Official Robinhood on-chain logo for a stock token, by its contract address. */
export function stockLogo(address: string): string {
  return `https://cdn.robinhood.com/ncw_assets/logos/${address.toLowerCase()}.png`;
}
