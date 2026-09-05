import type { Candle, CandleInterval, HolderRecord, TradeRecord } from "@launchpad/sdk";
import { parseEther, type Address, type Hex } from "viem";

const INTERVAL_SECONDS: Record<CandleInterval, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };

import { StockPadClient, type ConfigView, type PairInfo, type QuoteView, type RewardsView, type StockToken } from "./client";
import { FEES } from "./env";
import { STOCKS, WETH, hasEthRoute } from "./stocks";

/** Preview build: sample coins so the design can be seen before the factory
 *  is on mainnet. Enabled with VITE_DEMO=1. Every write throws. */
const SUPPLY = 1e9;
const ETH_USD = 2453.14;
const NOW = Math.floor(Date.now() / 1000);
const ADMIN = "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b" as Address;

const ethPair: PairInfo = { address: WETH, symbol: "ETH", name: "Ether", decimals: 18, usd: ETH_USD, isNative: true, ethRoute: true };
const stockPair = (sym: string): PairInfo => {
  const s = STOCKS.find((x) => x.symbol === sym)!;
  return { address: s.address, symbol: s.symbol, name: s.name, decimals: 18, usd: s.usd, isNative: false, ethRoute: hasEthRoute(s.address) };
};

interface Seed { name: string; symbol: string; pair: PairInfo; mcap: number; chg: number; holders: number; ageH: number; vol: number; desc: string; logo?: string; seed: number }
const SEEDS: Seed[] = [
  { name: "Nvidia Enjoyer", symbol: "NVJ", pair: stockPair("NVDAon"), mcap: 48_200, chg: 38.4, holders: 212, ageH: 5, vol: 61_400, desc: "Jensen said the supercycle is not over. We agree. Paired with NVDAon so every fee lands in NVIDIA.", seed: 3 },
  { name: "Tesla Dad", symbol: "TDAD", pair: stockPair("TSLAon"), mcap: 21_900, chg: -12.1, holders: 88, ageH: 19, vol: 18_700, desc: "Buying the dip since 2019.", seed: 7 },
  { name: "Moon Cat", symbol: "MCAT", pair: ethPair, mcap: 9_400, chg: 6.8, holders: 41, ageH: 2, vol: 5_100, desc: "The cat that pays you to hold it.", seed: 11 },
  { name: "Index Fund Andy", symbol: "ANDY", pair: stockPair("SPYon"), mcap: 132_000, chg: 4.2, holders: 640, ageH: 72, vol: 44_000, desc: "Boring on purpose. Fees paid in SPY, forever.", seed: 5 },
  { name: "Apple Bottom", symbol: "APLB", pair: stockPair("AAPLon"), mcap: 3_100, chg: null as unknown as number, holders: 3, ageH: 0.2, vol: 300, desc: "Just launched.", seed: 9 },
  { name: "Silver Surfer", symbol: "SURF", pair: stockPair("SLVon"), mcap: 15_600, chg: 21.0, holders: 120, ageH: 30, vol: 12_200, desc: "Precious metal, precious memes.", seed: 13 },
];

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const addrOf = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Address;
const hexOf = (n: number, len = 64) => ("0x" + n.toString(16).padStart(len, "0")) as Hex;
/** Number to 18-decimal wei with full precision for tiny per-coin prices. */
const toWei = (v: number) => (isFinite(v) && v > 0 ? parseEther(v.toFixed(18) as `${number}`) : 0n);
const toWeiStr = (v: number) => toWei(v).toString();

function build(s: Seed, i: number): StockToken {
  const priceUsd = s.mcap / SUPPLY;
  const pricePair = priceUsd / s.pair.usd;
  const paid = (s.vol / s.pair.usd) * FEES.taxPct / 100;
  return {
    address: addrOf(0xd3a0 + i), name: s.name, symbol: s.symbol, creator: addrOf(0xc0ffee + i * 7919), pool: addrOf(0), feeTier: 0,
    createdAt: NOW - Math.round(s.ageH * 3600), featured: false, metadata: { description: s.desc, logo: s.logo, twitter: "https://x.com/stockpad" },
    totalSupply: toWeiStr(SUPPLY), priceWei: toWeiStr(pricePair), priceUsd: String(priceUsd), marketCapUsd: String(s.mcap),
    liquidityWei: toWeiStr((s.mcap * 0.42) / s.pair.usd), volume24hWei: toWeiStr(s.vol / s.pair.usd), volumeTotalWei: toWeiStr((s.vol * 1.8) / s.pair.usd),
    txCount24h: Math.round(s.vol / 140), holderCount: s.holders, limitsActive: s.ageH < 0.01, remainingToGraduationUsd: "0", priceChange24hPct: s.chg,
    pair: s.pair, poolId: hexOf(0xab12 + i), launchBlock: 25_910_000 + i * 40,
    rewards: { holders: toWei(paid * 0.3), creator: toWei(paid * 0.5), platform: toWei(paid * 0.2) },
  };
}
const TOKENS = SEEDS.map(build);
const seedOf = (t: StockToken) => SEEDS[TOKENS.indexOf(t)];

export class DemoClient extends StockPadClient {
  private find(a: string) { return TOKENS.find((t) => t.address.toLowerCase() === a.toLowerCase()) ?? null; }
  override async getTokens(): Promise<StockToken[]> { return TOKENS.slice(); }
  override async getToken(token: string): Promise<StockToken | null> { return this.find(token); }
  override async ethUsd(): Promise<number> { return ETH_USD; }
  override async assetUsdPrice(asset: Address): Promise<number> { return asset.toLowerCase() === WETH ? ETH_USD : STOCKS.find((s) => s.address.toLowerCase() === asset.toLowerCase())?.usd ?? 0; }
  override async pairInfo(pair: Address): Promise<PairInfo> { return pair.toLowerCase() === WETH ? ethPair : stockPair(STOCKS.find((s) => s.address.toLowerCase() === pair.toLowerCase())!.symbol); }
  override async pairOf(token: Address): Promise<PairInfo> { return this.find(token)?.pair ?? ethPair; }
  override async quotes(): Promise<QuoteView[]> {
    return [{ ...ethPair, approved: true, liqUsd: 1e9, vol24Usd: 1e9 }, ...STOCKS.map((s) => ({ ...stockPair(s.symbol), approved: true, liqUsd: s.liqUsd, vol24Usd: s.vol24Usd }))];
  }
  override async getCandles(token: string, interval: CandleInterval): Promise<Candle[]> {
    const t = this.find(token); if (!t) return [];
    const s = seedOf(t); const r = rng(s.seed);
    const step = INTERVAL_SECONDS[interval];
    const n = Math.min(160, Math.max(6, Math.floor((s.ageH * 3600) / step)));
    const last = Number(t.priceWei) / 1e18;
    const start = last / (1 + (s.chg ?? 0) / 100);
    const out: Candle[] = []; let p = start;
    for (let i = 0; i < n; i++) {
      const target = start + ((last - start) * (i + 1)) / n;
      const o = p; const c = i === n - 1 ? last : target * (1 + (r() - 0.5) * 0.12);
      const h = Math.max(o, c) * (1 + r() * 0.05), l = Math.min(o, c) * (1 - r() * 0.05);
      out.push({ time: NOW - (n - i) * step, open: String(o), high: String(h), low: String(l), close: String(c), volume: String(r() * 2) });
      p = c;
    }
    return out;
  }
  override async getTrades(token: string): Promise<TradeRecord[]> {
    const t = this.find(token); if (!t) return [];
    const s = seedOf(t); const r = rng(s.seed * 31);
    const n = Math.min(40, Math.max(1, Math.round(s.vol / 140)));
    const price = Number(t.priceWei) / 1e18;
    return Array.from({ length: n }, (_, i) => {
      const pairAmt = (0.02 + r() * 1.5) * (ETH_USD / t.pair.usd);
      const isBuy = i === n - 1 ? true : r() > 0.4;
      return { id: `${t.address}-${i}`, token: t.address, trader: i === n - 1 ? t.creator : addrOf(Math.floor(r() * 2 ** 40) + 1), isBuy, nativeAmountWei: toWeiStr(pairAmt), tokenAmount: toWeiStr(pairAmt / price), feeWei: toWeiStr(pairAmt * 0.04), priceWei: t.priceWei, blockNumber: t.launchBlock + n - i, txHash: hexOf(Math.floor(r() * 2 ** 48)), timestamp: NOW - Math.round((i / n) * s.ageH * 3600) - Math.round(r() * 60) };
    });
  }
  override async getHolders(token: string): Promise<HolderRecord[]> {
    const t = this.find(token); if (!t) return [];
    const s = seedOf(t); const r = rng(s.seed * 17);
    const n = Math.min(30, s.holders); let left = 62;
    return Array.from({ length: n }, (_, i) => { const pct = i === 0 ? 2.8 : Math.min(left / (n - i), 2.5) * (0.5 + r()); left -= pct; return { address: i === 0 ? t.creator : addrOf(Math.floor(r() * 2 ** 40) + 1), balance: toWeiStr((pct / 100) * SUPPLY), pct }; });
  }
  override subscribeToTrades(): () => void { return () => undefined; }
  override async rewards(token: Address): Promise<RewardsView> {
    const t = this.find(token); const rw = t?.rewards ?? { holders: 0n, creator: 0n, platform: 0n };
    return { pending: 0n, creatorFees: 0n, platformFees: rw.platform / 5n, totalHolder: rw.holders, totalCreator: rw.creator, totalPlatform: rw.platform, isCreator: false, balance: 0n };
  }
  override async feeNow(token: Address): Promise<{ total: number; base: number }> { const t = this.find(token); const fresh = !!t && NOW - t.createdAt < 20; return { total: fresh ? 6000 : FEES.taxPct * 100, base: FEES.taxPct * 100 }; }
  override async previewSwapOut(): Promise<bigint | null> { return null; }
  override async config(): Promise<ConfigView> {
    return { admin: ADMIN, owner: "0x0000000000000000000000000000000000000000", feeRecipient: ADMIN, paused: false, taxBps: FEES.taxPct * 100, creatorBps: FEES.creatorPct * 100, holderBps: FEES.holderPct * 100, ethUsd: ETH_USD, converter: addrOf(0x70), totalTokens: TOKENS.length };
  }
  private nope(): never { throw new Error("Preview build: the factory is not on Ethereum yet, so nothing can be sent."); }
  override async estimateLaunch(): Promise<bigint> { return this.nope(); }
  override async createToken(): Promise<Hex> { return this.nope(); }
  override async buyToken(): Promise<Hex> { return this.nope(); }
  override async sellToken(): Promise<Hex> { return this.nope(); }
  override async claimRewards(): Promise<Hex> { return this.nope(); }
  override async claimCreatorFees(): Promise<Hex> { return this.nope(); }
  override async claimPlatformFees(): Promise<Hex> { return this.nope(); }
  override async pushPlatformFees(): Promise<Hex> { return this.nope(); }
  override async platformWaiting(tokens: Address[]): Promise<Map<string, bigint>> { return new Map(tokens.map((t) => [t.toLowerCase(), this.find(t)?.rewards?.platform ?? 0n])); }
  override async adminCall(): Promise<Hex> { return this.nope(); }
}
