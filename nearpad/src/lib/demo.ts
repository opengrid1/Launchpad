import type { Candle, Coin, DexPool, Holder, Info, Pair, Trade } from "./types";

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
    pending_buyback: "0", pending_liquidity: "0", platform_credit: "0", trades, holders,
    dex: "v2.ref-finance.near", pool_id: phase === "Pool" ? 5000 + id : null, lp_shares: phase === "Pool" ? (1_000_000n * ONE).toString() : "0", lp_collected: "0",
    tax_tokens: phase === "Pool" ? (2_400n * ONE).toString() : "0",
    grad: { pool_created: phase === "Pool", wrapped: phase === "Pool", coin_deposited: phase === "Pool", pair_deposited: phase === "Pool", lock_until: 0 },
    harvest: { step: 0, total: "0", platform_tokens: "0", creator_tokens: "0", dividend_tokens: "0", liquidity_tokens: "0", swap_tokens: "0", out: "0", liquidity_pair: "0", lock_until: 0 },
    ...extra,
  };
  return { id, account_id: `c${id}.pad.near`, name, symbol, pair, creator, created_at_ms: info.created_at_ms, code_version: "0.2.0", hidden: false, info };
};

export function demoCoins(): Coin[] {
  return [
    mk(7, "Chipfi", "CHIP", "NEAR", 1, "Pool", [1, 1], [0, 100, 0, 0], "chipfi.near", 4 * 1440, 541, 3120),
    mk(6, "Nearkat", "NEARKAT", "NEAR", 1, "Pool", [3, 3], [0, 100, 0, 0], "humpydumpy.near", 3 * 1440, 277, 1980),
    mk(5, "Ironclaw", "IRONCLAW", "NEAR", 0.68, "Curve", [3, 3], [40, 30, 20, 10], "claw.near", 600, 88, 412),
    mk(4, "Attention", "ATTN", "NEAR", 0.6, "Curve", [5, 5], [30, 50, 20, 0], "attn.near", 300, 64, 240),
    mk(3, "Nvidia Enjoyer", "NVJ", "NVDAon", 0.44, "Curve", [3, 5], [0, 80, 20, 0], "gpu.near", 120, 31, 96),
    mk(2, "Doomslug", "DOOM", "NEAR", 0.57, "Curve", [3, 3], [50, 50, 0, 0], "doom.near", 90, 47, 150),
    mk(1, "Batman", "BATMAN", "NEAR", 1, "Pool", [3, 3], [0, 100, 0, 0], "vastoasis.near", 5 * 1440, 68, 800),
  ];
}

export function demoPairs(): Pair[] {
  // The live mainnet pair set, same reserves as alicorn.near.
  return [
    { key: "NEAR", asset: "Near", name: "NEAR", virtual_reserve: (1000n * NEAR).toString(), enabled: true },
    { key: "NVDAon", asset: { Token: { account_id: "bnb-0xa9ee28c80f960b889dfbd1902055218cba016f75.omdep.near", symbol: "NVDAon", decimals: 18 } }, name: "NVIDIA (Ondo)", virtual_reserve: (21770000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "TSLAon", asset: { Token: { account_id: "bnb-0x2494b603319d4d9f9715c9f4496d9e0364b59d93.omdep.near", symbol: "TSLAon", decimals: 18 } }, name: "Tesla (Ondo)", virtual_reserve: (13170000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "AAPLon", asset: { Token: { account_id: "bnb-0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4.omdep.near", symbol: "AAPLon", decimals: 18 } }, name: "Apple (Ondo)", virtual_reserve: (14370000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "GOOGLon", asset: { Token: { account_id: "bnb-0x091fc7778e6932d4009b087b191d1ee3bac5729a.omdep.near", symbol: "GOOGLon", decimals: 18 } }, name: "Alphabet Class A (Ondo)", virtual_reserve: (14250000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "METAon", asset: { Token: { account_id: "bnb-0xd7df5863a3e742f0c767768cdfcb63f09e0422f6.omdep.near", symbol: "METAon", decimals: 18 } }, name: "Meta Platforms (Ondo)", virtual_reserve: (6519000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "MSFTon", asset: { Token: { account_id: "bnb-0x6bfe75d1ad432050ea973c3a3dcd88f02e2444c3.omdep.near", symbol: "MSFTon", decimals: 18 } }, name: "Microsoft (Ondo)", virtual_reserve: (9493000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "AMZNon", asset: { Token: { account_id: "bnb-0x4553cfe1c09f37f38b12dc509f676964e392f8fc.omdep.near", symbol: "AMZNon", decimals: 18 } }, name: "Amazon (Ondo)", virtual_reserve: (19630000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "HOODon", asset: { Token: { account_id: "bnb-0x19601179a60f55ff6636f5d1a8b6671053bd60a8.omdep.near", symbol: "HOODon", decimals: 18 } }, name: "Robinhood Markets (Ondo)", virtual_reserve: (41040000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "INTCon", asset: { Token: { account_id: "bnb-0xa528caaa2f96090e379d43f90834c75df54d6e74.omdep.near", symbol: "INTCon", decimals: 18 } }, name: "Intel (Ondo)", virtual_reserve: (39840000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "MRVLon", asset: { Token: { account_id: "bnb-0x1501ec83ffef405b4331cc4f73277a40fb0c627d.omdep.near", symbol: "MRVLon", decimals: 18 } }, name: "Marvell Technology (Ondo)", virtual_reserve: (18710000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "CRCLon", asset: { Token: { account_id: "bnb-0x992879cd8ce0c312d98648875b5a8d6d042cbf34.omdep.near", symbol: "CRCLon", decimals: 18 } }, name: "Circle Internet Group (Ondo)", virtual_reserve: (55060000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "SPYon", asset: { Token: { account_id: "bnb-0x6a708ead771238919d85930b5a0f10454e1c331a.omdep.near", symbol: "SPYon", decimals: 18 } }, name: "SPDR S&P 500 ETF (Ondo)", virtual_reserve: (6352000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "QQQon", asset: { Token: { account_id: "bnb-0x0cde6936d305d5b34667fc46425e852efd73559a.omdep.near", symbol: "QQQon", decimals: 18 } }, name: "Invesco QQQ (Ondo)", virtual_reserve: (6582000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "GLDon", asset: { Token: { account_id: "bnb-0xfa9a1e901085e269f6d428f79cd5252d8b919344.omdep.near", symbol: "GLDon", decimals: 18 } }, name: "SPDR Gold Shares (Ondo)", virtual_reserve: (12460000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "IAUon", asset: { Token: { account_id: "bnb-0xcb2a0f46f67dc4c58a316f1c008edef5c2311795.omdep.near", symbol: "IAUon", decimals: 18 } }, name: "iShares Gold Trust (Ondo)", virtual_reserve: (60750000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "SLVon", asset: { Token: { account_id: "bnb-0x8b872732b07be325a8803cdb480d9d20b6f8d11b.omdep.near", symbol: "SLVon", decimals: 18 } }, name: "iShares Silver Trust (Ondo)", virtual_reserve: (84280000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "TLTon", asset: { Token: { account_id: "bnb-0xf69e40069ac227c11459e3f4e8a446b3401616b6.omdep.near", symbol: "TLTon", decimals: 18 } }, name: "iShares 20+ Year Treasury Bond ETF (Ondo)", virtual_reserve: (61780000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "SGOVon", asset: { Token: { account_id: "bnb-0xc008c5f579ec1450f20099c39f587547e27c7523.omdep.near", symbol: "SGOVon", decimals: 18 } }, name: "iShares 0-3 Month Treasury Bond ETF (Ondo)", virtual_reserve: (48680000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "TIPon", asset: { Token: { account_id: "bnb-0x2ac26ec236df5d1d2ad1a6dd4e448a90e45dc35d.omdep.near", symbol: "TIPon", decimals: 18 } }, name: "iShares TIPS Bond ETF (Ondo)", virtual_reserve: (46870000n * ONE / 1_000_000n).toString(), enabled: true },
    { key: "AGGon", asset: { Token: { account_id: "bnb-0x08ce97f3d5cf11e577d091ab048bc5e2eae3fabb.omdep.near", symbol: "AGGon", decimals: 18 } }, name: "iShares Core US Aggregate Bond ETF (Ondo)", virtual_reserve: (51510000n * ONE / 1_000_000n).toString(), enabled: true },
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

/** The Rhea pool of a graduated sample coin: a little above the opening price. */
export function demoPool(): DexPool {
  return { pool_kind: "SIMPLE_POOL", token_account_ids: ["c7.pad.near", "wrap.near"], amounts: [(236_000_000n * ONE).toString(), (2_120n * NEAR).toString()], total_fee: 30, shares_total_supply: (1_000_000n * ONE).toString() };
}
