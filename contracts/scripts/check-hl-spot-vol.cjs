const fs = require("fs");
const path = require("path");
async function post(type, extra = {}) {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, ...extra }) });
  return r.json();
}
async function main() {
  const [meta, ctxs] = await post("spotMetaAndAssetCtxs");
  const tokens = meta.tokens || [];
  const universe = meta.universe || [];
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments/hyperevm-ondo-stocks.json"), "utf8"));
  const byName = new Map(); const byEvm = new Map();
  tokens.forEach((t) => { if (t.name) byName.set(t.name.toUpperCase(), t); const e = t.evmContract && t.evmContract.address; if (e) byEvm.set(e.toLowerCase(), t); });
  // map pair name -> ctx
  const ctxByName = new Map(); universe.forEach((u, i) => ctxByName.set(u.name, ctxs[i]));

  const rows = [];
  for (const s of data.tokens) {
    const sym = s.symbol.replace(/on$/, "");
    const hit = byEvm.get(s.address.toLowerCase()) || byName.get(s.symbol.toUpperCase()) || byName.get(sym.toUpperCase());
    if (!hit) continue;
    const idx = tokens.indexOf(hit);
    const pairs = universe.filter((u) => u.tokens && u.tokens.includes(idx));
    for (const pr of pairs) {
      const c = ctxByName.get(pr.name) || {};
      const quoteIdx = pr.tokens.find((x) => x !== idx);
      const quote = tokens[quoteIdx] ? tokens[quoteIdx].name : "?";
      rows.push({ symbol: s.symbol, address: s.address, hl: hit.name, pair: pr.name, quote,
        mid: c.midPx ? Number(c.midPx) : null, mark: c.markPx ? Number(c.markPx) : null,
        dayVol: c.dayNtlVlm ? Number(c.dayNtlVlm) : 0, circ: c.circulatingSupply ? Number(c.circulatingSupply) : null });
    }
  }
  rows.sort((a, b) => b.dayVol - a.dayVol);
  console.log("symbol   HLtoken  pair   quote   mid          24h $vol");
  for (const r of rows) console.log(`${r.symbol.padEnd(8)} ${String(r.hl).padEnd(7)} ${r.pair.padEnd(6)} ${String(r.quote).padEnd(6)} ${r.mid!=null?("$"+r.mid.toFixed(2)).padStart(11):"-".padStart(11)}  ${("$"+Math.round(r.dayVol).toLocaleString()).padStart(14)}`);
  const active = rows.filter((r) => r.dayVol > 0);
  console.log(`\n${active.length} Ondo stocks with live spot pairs (24h vol > 0).`);
  fs.writeFileSync(path.join(__dirname, "..", "deployments/hyperevm-ondo-spot.json"), JSON.stringify({ checkedAt: new Date().toISOString(), source: "hyperliquid spot", rows }, null, 2));
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
