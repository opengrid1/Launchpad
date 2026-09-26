// Query Hyperliquid Core spot meta to see which Ondo tokenized stocks actually
// have a spot market (order-book liquidity) on the L1, vs the EVM DEX.
const fs = require("fs");
const path = require("path");

async function post(type, extra = {}) {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, ...extra }),
  });
  return r.json();
}

async function main() {
  const meta = await post("spotMeta");
  const tokens = meta.tokens || [];
  const universe = meta.universe || [];
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments/hyperevm-ondo-stocks.json"), "utf8"));

  // Index spot tokens by name/symbol (upper) and by evm contract if present.
  const byName = new Map();
  const byEvm = new Map();
  for (const t of tokens) {
    if (t.name) byName.set(t.name.toUpperCase(), t);
    const evm = t.evmContract && t.evmContract.address;
    if (evm) byEvm.set(evm.toLowerCase(), t);
  }
  console.log("spot tokens total:", tokens.length, "| spot pairs:", universe.length);

  const onSpot = [];
  for (const s of data.tokens) {
    const sym = s.symbol.replace(/on$/, ""); // AAPLon -> AAPL
    const hit = byEvm.get(s.address.toLowerCase()) || byName.get(s.symbol.toUpperCase()) || byName.get(sym.toUpperCase());
    if (hit) {
      // find its spot pairs
      const idx = tokens.indexOf(hit);
      const pairs = universe.filter((u) => u.tokens && u.tokens.includes(idx)).map((u) => u.name);
      onSpot.push({ symbol: s.symbol, address: s.address, hlToken: hit.name, tokenIndex: idx, pairs });
      console.log(`SPOT   ${s.symbol.padEnd(8)} -> HL token '${hit.name}' idx ${idx}  pairs: ${pairs.join(",") || "(none)"}`);
    } else {
      console.log(`no spot ${s.symbol.padEnd(8)}`);
    }
  }
  console.log(`\n${onSpot.length} of ${data.tokens.length} Ondo stocks map to a Hyperliquid spot token.`);
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
