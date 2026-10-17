// Find every tokenized stock on HyperEVM that has real on-chain liquidity.
//
// Candidates = every Hyperliquid Core spot token that looks like a tokenized
// equity/ETF and has an EVM contract, plus the stored issuer lists (Ondo,
// dStock, xStock). For each one we probe HyperSwap V3 (all fee tiers) and
// HyperSwap V2 against the common base assets and value the pool in USD, and
// we also record the Core spot market (mid + 24h volume) so a launchpad can see
// where the liquidity actually lives.
//
//   node scripts/find-stock-onchain-liquidity.cjs
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC = "https://rpc.hyperliquid.xyz/evm";
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
const V2_FACTORY = "0x724412C00059bf7d6ee7d4a1d0D5cd4de3ea1C48";
const TIERS = [100, 500, 3000, 10000];
const BASES = {
  WHYPE: "0x5555555555555555555555555555555555555555",
  USDT0: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
  USDe:  "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
  USDHL: "0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5",
  USDC:  "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
  feUSD: "0x02c6a2fA58cC01A18B8D9E00eA48d65E4dF26c70",
  UBTC:  "0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463",
  UETH:  "0xBe6727B535545C67d5cAa73dEa54865B92CF7907",
};
const DSTOCK = new Set(["QQQ","GLD","HOOD","MU","SPY","META","CRCL","SLV","GOOGL","AAPL","BNB1","AMZN","MSFT","ORCL","AVGO","SPCX","DIME"]);
const STOCK_RE = /wagyu|xstock|eqx|tokenized|sp500|s&p|nasdaq|dstock|ondo/i;

const ERC20 = ["function symbol() view returns (string)","function name() view returns (string)","function decimals() view returns (uint8)","function balanceOf(address) view returns (uint256)"];
const V3F = ["function getPool(address,address,uint24) view returns (address)"];
const V2F = ["function getPair(address,address) view returns (address)"];

async function post(type, extra = {}) {
  const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, ...extra }) });
  return r.json();
}
const chunk = async (items, n, fn) => { const out = []; for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn))); return out; };

async function main() {
  const p = new ethers.JsonRpcProvider(RPC, 999, { batchMaxCount: 10 });
  const v3 = new ethers.Contract(V3_FACTORY, V3F, p), v2 = new ethers.Contract(V2_FACTORY, V2F, p);

  // 1. Core spot universe: stock-looking tokens, base asset USD mids.
  const [meta, ctxs] = await post("spotMetaAndAssetCtxs");
  const tokVol = new Map();
  meta.universe.forEach((u, i) => {
    const c = ctxs[i] || {}; const vol = Number(c.dayNtlVlm || 0), mid = c.midPx ? Number(c.midPx) : null;
    for (const ti of u.tokens) { const cur = tokVol.get(ti); if (!cur || vol > cur.vol) tokVol.set(ti, { vol, mid, pair: u.name }); }
  });
  const midOf = (name) => { const i = meta.tokens.findIndex((t) => t.name === name); return i >= 0 ? tokVol.get(i)?.mid ?? null : null; };
  const baseUsd = { WHYPE: midOf("HYPE") ?? 84, USDT0: 1, USDe: 1, USDHL: 1, USDC: 1, feUSD: 1, UBTC: midOf("UBTC") ?? 110000, UETH: midOf("UETH") ?? 4000 };

  const cands = new Map(); // evm address -> {ticker, issuer, coreMid, coreVol, corePair}
  const add = (addr, info) => { if (!addr) return; const k = addr.toLowerCase(); cands.set(k, { ...(cands.get(k) || {}), ...info, address: addr }); };
  meta.tokens.forEach((t, i) => {
    const full = t.fullName || "";
    const isStock = t.deployerTradingFeeShare === "1.0" && !t.isCanonical && (STOCK_RE.test(full) || DSTOCK.has(t.name) || /^[A-Z]{2,6}(X|d|on)$/.test(t.name) && full === "");
    if (!isStock || !t.evmContract) return;
    const v = tokVol.get(i) || {};
    add(t.evmContract.address, { ticker: t.name, issuer: /xstock/i.test(full) ? "xStock" : /wagyu/i.test(full) ? "Wagyu" : /eqx/i.test(full) ? "EQX" : /sp500|unit/i.test(full) ? "Unit" : DSTOCK.has(t.name) ? "dStock" : "other", fullName: full || null, coreMid: v.mid ?? null, coreVol: v.vol ?? 0, corePair: v.pair ?? null });
  });
  const dep = (f) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", f), "utf8")); } catch { return null; } };
  for (const t of dep("hyperevm-ondo-stocks.json")?.tokens ?? []) add(t.address, { ticker: t.symbol, issuer: "Ondo" });
  for (const list of ["liquid", "bridgeable", "spotOnly", "all"]) for (const t of dep("hyperevm-dstocks.json")?.[list] ?? []) if (t.evm) add(t.evm, { ticker: t.ticker, issuer: t.issuer || "dStock", coreMid: t.mid, coreVol: t.dayVol });
  for (const t of dep("hyperevm-stock-liquidity.json")?.allRwaMarked ?? []) if (t.evm && /^[A-Z]{2,6}(X|d|on)$/.test(t.ticker)) add(t.evm, { ticker: t.ticker, coreMid: t.mid, coreVol: t.dayVol });
  for (const [ticker, address] of [["NVDAX","0xa8ddb5cd96b5222afe198316e9a57caa642850d5"],["SPYX","0xe7e553cd128f0011777323a0b44a7b96ea1cb540"],["QQQX","0x4c1ae29c159838fc1b224636e28e086eb69101f7"],["MUX","0xe2047ee3bddb5c99ae428ab83df63f8730698e30"],["SKHYX","0x6215a58ed045d71f2561aaabe54f4c885c522998"],["SPCX","0xe8c8AFDf7E80bE51E91AFA28B6aC44404d270B5d"]]) add(address, { ticker, issuer: "xStock" });

  // 2. On-chain identity of each candidate.
  const list = [...cands.values()];
  await chunk(list, 5, async (c) => {
    const e = new ethers.Contract(c.address, ERC20, p);
    try { c.evmSymbol = await e.symbol(); c.evmName = await e.name(); c.decimals = Number(await e.decimals()); c.hasCode = true; }
    catch { c.hasCode = (await p.getCode(c.address)) !== "0x"; c.decimals = 18; }
  });
  const baseDec = {}; for (const [s, a] of Object.entries(BASES)) baseDec[s] = Number(await new ethers.Contract(a, ERC20, p).decimals().catch(() => 18));

  // 3. Probe DEX pools.
  for (const c of list) {
    c.pools = [];
    if (!c.hasCode) continue;
    const stock = new ethers.Contract(c.address, ERC20, p);
    const probes = [];
    for (const [sym, addr] of Object.entries(BASES)) {
      for (const tier of TIERS) probes.push({ dex: "HyperSwap V3", sym, addr, tier, get: () => v3.getPool(c.address, addr, tier) });
      probes.push({ dex: "HyperSwap V2", sym, addr, tier: null, get: () => v2.getPair(c.address, addr) });
    }
    const found = (await chunk(probes, 10, async (pr) => { const pool = await pr.get().catch(() => null); return pool && pool !== ethers.ZeroAddress ? { ...pr, pool } : null; })).filter(Boolean);
    await chunk(found, 5, async (f) => {
      const [bb, sb] = await Promise.all([new ethers.Contract(f.addr, ERC20, p).balanceOf(f.pool), stock.balanceOf(f.pool)]);
      const baseAmt = Number(ethers.formatUnits(bb, baseDec[f.sym])), stockAmt = Number(ethers.formatUnits(sb, c.decimals));
      const stockUsd = c.coreMid ?? (baseAmt > 0 && stockAmt > 0 ? (baseAmt * baseUsd[f.sym]) / stockAmt : 0);
      c.pools.push({ dex: f.dex, base: f.sym, tier: f.tier, pool: f.pool, baseAmt, stockAmt, tvlUsd: baseAmt * baseUsd[f.sym] + stockAmt * stockUsd });
    });
    c.pools.sort((a, b) => b.tvlUsd - a.tvlUsd);
    c.dexTvlUsd = c.pools.reduce((s, x) => s + x.tvlUsd, 0);
  }

  // 4. Report.
  const liquid = list.filter((c) => c.dexTvlUsd >= 100 || (c.coreVol ?? 0) >= 1000).sort((a, b) => b.dexTvlUsd - a.dexTvlUsd || b.coreVol - a.coreVol);
  const dry = list.filter((c) => !liquid.includes(c));
  console.log(`candidates: ${list.length} | with DEX or Core liquidity: ${liquid.length}\n`);
  console.log("ticker    issuer   evmSymbol   DEX TVL $     best pool                     Core 24h $vol   Core mid   evm");
  for (const c of liquid) {
    const b = c.pools[0];
    console.log(`${String(c.ticker).padEnd(9)} ${String(c.issuer||"?").padEnd(8)} ${String(c.evmSymbol||"?").padEnd(11)} ${Math.round(c.dexTvlUsd).toLocaleString().padStart(11)}   ${b ? `${b.dex} ${b.base}${b.tier ? " " + b.tier : ""}`.padEnd(28) : "-".padEnd(28)}   ${Math.round(c.coreVol||0).toLocaleString().padStart(13)}   ${c.coreMid ? ("$"+c.coreMid.toFixed(2)).padStart(8) : "       -"}   ${c.address}`);
  }
  console.log(`\nno liquidity anywhere (${dry.length}): ${dry.map((c) => c.ticker + (c.hasCode ? "" : "(no code)")).join(", ")}`);
  const out = path.join(__dirname, "..", "deployments", "hyperevm-stock-onchain-liquidity.json");
  fs.writeFileSync(out, JSON.stringify({ checkedAt: new Date().toISOString(), baseUsd, method: "Core spot universe (stock-looking tokens with evmContract) + stored Ondo/dStock/xStock lists; HyperSwap V3 (all tiers) and V2 pools against WHYPE/USDT0/USDe/USDHL/USDC/feUSD/UBTC/UETH valued in USD; Core spot mid + 24h volume.", liquid, dry: dry.map((c) => ({ ticker: c.ticker, issuer: c.issuer, address: c.address, hasCode: c.hasCode })) }, null, 2));
  console.log("saved", path.relative(process.cwd(), out));
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
