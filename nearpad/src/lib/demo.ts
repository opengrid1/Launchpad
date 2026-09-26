import type { Candle, Coin, Holder, Info, Pair, Trade } from "./types";

const NEAR = 10n ** 24n;
const ONE = 10n ** 18n;
const now = Date.now();

const mk = (id: number, name: string, symbol: string, pair: "NEAR" | "NVDAon", soldPct: number, phase: Info["phase"], taxes: [number, number], split: [number, number, number, number], creator: string, ageMin: number, holders: number, trades: number, extra?: Partial<Info>): Coin => {
  const isNear = pair === "NEAR";
  const vr = isNear ? 1000n * NEAR : 41n * ONE;
  const sold = (750_000_000n * ONE * BigInt(Math.round(soldPct * 1000))) / 1000n;
  const x = vr + (vr * BigInt(Math.round(soldPct * 2000))) / 1000n;
  const y = 1_125_000_000n * ONE - sold;
  const raised = phase === "Curve" ? x - vr : 2n * vr;
  const price = phase === "Pool" ? (2n * vr * ONE) / (250_000_000n * ONE) : (x * ONE) / y;
  const info: Info = {
    factory: "pad.near", treasury: "treasury.near", name, symbol, icon: null, description: `${name} is a sample coin for the preview.`,
    links: { website: null, x: null, telegram: null }, creator, fee_wallet: creator, created_at_ms: now - ageMin * 60_000,
    pair: isNear ? "Near" : { Token: { account_id: "bnb-0xa9ee28c80f960b889dfbd1902055218cba016f75.omdep.near", symbol: "NVDAon", decimals: 18 } },
    virtual_reserve: vr.toString(), buy_tax_bps: taxes[0] * 100, sell_tax_bps: taxes[1] * 100,
    split: { creator_bps: split[0] * 100, dividends_bps: split[1] * 100, burn_bps: split[2] * 100, liquidity_bps: split[3] * 100 },
    phase, total_supply: (1_000_000_000n * ONE).toString(), tokens_sold: (phase === "Curve" ? sold : 750_000_000n * ONE).toString(), raised: raised.toString(),
    pool_pair: phase === "Pool" ? (2n * vr).toString() : "0", pool_tokens: phase === "Pool" ? (250_000_000n * ONE).toString() : "0",
    price: price.toString(), market_cap: (price * 1_000_000_000n).toString(), graduation: (2n * vr).toString(), curve_supply: (750_000_000n * ONE).toString(),
    burned: "0", buyback_spent: "0", liquidity_added: "0", dividends_total: (raised / 20n).toString(), creator_fees_total: (raised / 40n).toString(), platform_fees_total: (raised / 50n).toString(),
    pending_buyback: "0", pending_liquidity: "0", platform_credit: "0", trades, holders, ...extra,
  };
  return { id, account_id: `c${id}.pad.near`, name, symbol, pair, creator, created_at_ms: info.created_at_ms, code_version: "0.1.0", hidden: false, info };
};

export function demoCoins(): Coin[] {
  return [
    mk(7, "Alicorn", "ALICORN", "NEAR", 1, "Pool", [1, 1], [0, 100, 0, 0], "alicorn.near", 4 * 1440, 541, 3120),
    mk(6, "Nearkat", "NEARKAT", "NEAR", 1, "Pool", [3, 3], [0, 100, 0, 0], "humpydumpy.near", 3 * 1440, 277, 1980),
    mk(5, "Ironclaw", "IRONCLAW", "NEAR", 0.68, "Curve", [3, 3], [40, 30, 20, 10], "claw.near", 600, 88, 412),
    mk(4, "Attention", "ATTN", "NEAR", 0.6, "Curve", [5, 5], [30, 50, 20, 0], "attn.near", 300, 64, 240),
    mk(3, "Nvidia Enjoyer", "NVJ", "NVDAon", 0.44, "Curve", [3, 5], [0, 80, 20, 0], "gpu.near", 120, 31, 96),
    mk(2, "Doomslug", "DOOM", "NEAR", 0.57, "Curve", [3, 3], [50, 50, 0, 0], "doom.near", 90, 47, 150),
    mk(1, "Batman", "BATMAN", "NEAR", 1, "Pool", [3, 3], [0, 100, 0, 0], "vastoasis.near", 5 * 1440, 68, 800),
  ];
}

export function demoPairs(): Pair[] {
  return [
    { key: "NEAR", asset: "Near", name: "NEAR", virtual_reserve: (1000n * NEAR).toString(), enabled: true },
    { key: "NVDAon", asset: { Token: { account_id: "bnb-0xa9ee28c80f960b889dfbd1902055218cba016f75.omdep.near", symbol: "NVDAon", decimals: 18 } }, name: "NVIDIA (Ondo)", virtual_reserve: (41n * ONE).toString(), enabled: true },
    { key: "TSLAon", asset: { Token: { account_id: "bnb-0x2494b603319d4d9f9715c9f4496d9e0364b59d93.omdep.near", symbol: "TSLAon", decimals: 18 } }, name: "Tesla (Ondo)", virtual_reserve: (24n * ONE).toString(), enabled: true },
  ];
}

export function demoHolder(): Holder {
  return { balance: (12_400_000n * ONE).toString(), claimable_dividends: (3n * NEAR / 10n).toString(), credit: (NEAR / 2n).toString() };
}

export function demoCandles(): Candle[] {
  const out: Candle[] = [];
  let p = 900_000_000_000_000_000n; // 0.0000009 NEAR
  const start = now - 48 * 60 * 60_000;
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 576; i++) {
    const o = p;
    const move = BigInt(Math.round((rnd() - 0.45) * 40_000_000_000_000_000));
    p = p + move > 100_000_000_000_000_000n ? p + move : p;
    const h = o > p ? o : p; const l = o > p ? p : o;
    out.push({ t: start + i * 5 * 60_000, o: o.toString(), h: (h + h / 50n).toString(), l: (l - l / 50n).toString(), c: p.toString(), v: (BigInt(Math.round(rnd() * 40)) * NEAR / 4n).toString() });
  }
  return out;
}

export function demoTrades(): Trade[] {
  const names = ["humpydumpy.near", "claw.near", "8f3a…c21b", "moon.near", "doge.near", "vastoasis.near"];
  return Array.from({ length: 40 }, (_, i) => ({
    t: now - i * 97_000, account: names[i % names.length], buy: i % 3 !== 0,
    pair: (BigInt(3 + (i * 7) % 40) * NEAR / 4n).toString(), tokens: (BigInt(200_000 + (i * 91_237) % 3_000_000) * ONE).toString(), price: (1_200_000_000_000_000_000n - BigInt(i) * 3_000_000_000_000_000n).toString(),
  }));
}
