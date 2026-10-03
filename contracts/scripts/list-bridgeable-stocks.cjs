// Curated tokenized-stock survey on Hyperliquid. The raw feeShare==1.0 marker
// also catches HIP-1 memecoins, so a token counts as a tokenized stock only if:
//   - its fullName matches a real issuer pattern (Wagyu.xyz / Backed xStock /
//     EQX Tokenized / Unit SP500 / "Tokenized …"), OR
//   - it is a confirmed dStock (EVM token name ends "(dStock)"; the dStock line
//     uses fullName==null, so we whitelist its verified equity tickers).
// bridgeable = the spot token has an evmContract (buy on Core spot -> move to
// HyperEVM -> use as a launchpad pair). dayVol = real spot liquidity.
const fs = require("fs");
const path = require("path");
async function post(type, extra = {}) {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, ...extra }) });
  return r.json();
}
// dStock equity/ETF tickers confirmed on-chain ("(dStock)" name) in a prior run.
const DSTOCK = new Set(["QQQ","GLD","HOOD","MU","SPY","META","CRCL","SLV","GOOGL","AAPL","BNB1","AMZN","MSFT","ORCL","AVGO","SPCX","DIME"]);
const STOCK_FULLNAME = /wagyu\.xyz|xstock|eqx tokenized|tokenized|sp500|s&p|nasdaq/i;
function issuer(name, full) {
  if (/wagyu/i.test(full)) return "Wagyu";
  if (/xstock/i.test(full)) return "xStock";
  if (/eqx/i.test(full)) return "EQX";
  if (/sp500|unit/i.test(full)) return "Unit";
  if (DSTOCK.has(name)) return "dStock";
  return "other";
}
async function main() {
  const [meta, ctxs] = await post("spotMetaAndAssetCtxs");
  const tokens = meta.tokens || [];
  const universe = meta.universe || [];
  const tokVol = new Map();
  universe.forEach((u, i) => {
    const c = ctxs[i] || {};
    const vol = c.dayNtlVlm ? Number(c.dayNtlVlm) : 0;
    const mid = c.midPx ? Number(c.midPx) : null;
    for (const ti of u.tokens) { const cur = tokVol.get(ti); if (!cur || vol > cur.vol) tokVol.set(ti, { vol, mid, pair: u.name, hasPair: true }); }
  });
  const rows = [];
  tokens.forEach((t, i) => {
    if (t.deployerTradingFeeShare !== "1.0" || t.isCanonical) return;
    const full = t.fullName || "";
    const isStock = STOCK_FULLNAME.test(full) || DSTOCK.has(t.name);
    if (!isStock) return;
    const v = tokVol.get(i) || { vol: 0, mid: null, hasPair: false };
    const evm = t.evmContract && t.evmContract.address;
    rows.push({ ticker: t.name, issuer: issuer(t.name, full), fullName: full || null,
      bridgeable: !!evm, evm: evm || null, hasSpotMarket: v.hasPair, mid: v.mid, dayVol: v.vol });
  });
  rows.sort((a, b) => b.dayVol - a.dayVol || b.bridgeable - a.bridgeable);
  const liquid = rows.filter((r) => r.dayVol > 1000);
  const bridgeable = rows.filter((r) => r.bridgeable);
  const P = (n) => ("$"+Math.round(n).toLocaleString()).padStart(13);

  console.log("== tokenized stocks WITH spot liquidity (>$1k/24h) ==");
  console.log("ticker  issuer  bridge  24h $vol       evm");
  for (const r of liquid)
    console.log(`${String(r.ticker).padEnd(7)} ${r.issuer.padEnd(6)} ${(r.bridgeable?"YES":"no ")} ${P(r.dayVol)}  ${r.evm||"-"}`);
  console.log(`\n== bridgeable tokenized stocks (has EVM, incl. $0 vol) ==`);
  console.log("ticker  issuer  24h $vol       evm");
  for (const r of bridgeable)
    console.log(`${String(r.ticker).padEnd(7)} ${r.issuer.padEnd(6)} ${P(r.dayVol)}  ${r.evm}`);
  const spotOnly = rows.filter((r) => !r.bridgeable);
  console.log(`\n== NOT bridgeable (spot only, no EVM): ${spotOnly.length} ==`);
  console.log("  " + spotOnly.map((r)=>r.ticker).join(", "));

  fs.writeFileSync(path.join(__dirname, "..", "deployments/hyperevm-dstocks.json"),
    JSON.stringify({ checkedAt: new Date().toISOString(),
      method: "Hyperliquid spotMeta, feeShare==1.0 filtered to real equity issuers (Wagyu/xStock/EQX/Unit/dStock). bridgeable=has evmContract; dayVol=dayNtlVlm.",
      note: "Only the dStock line (QQQ/GLD/HOOD/MU/SPY) has real spot volume. xStock (wNVDAx/NVDAX, SPYX…), Wagyu (TSLA), EQX are bridgeable or spot-listed but ~$0 volume right now.",
      liquid, bridgeable, spotOnly, all: rows }, null, 2));
  console.log(`\nsaved deployments/hyperevm-dstocks.json (total: ${rows.length}, liquid: ${liquid.length}, bridgeable: ${bridgeable.length})`);
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
