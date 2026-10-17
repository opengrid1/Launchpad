// Find EVERY tokenized stock that has real spot liquidity on Hyperliquid, with
// no hard-coded address list.
//
// Method (fully self-contained):
//   1. Pull the whole spot universe (spotMetaAndAssetCtxs).
//   2. Keep tokens carrying the RWA issuer marker: deployerTradingFeeShare
//      == "1.0" and fullName == null (memes/crypto have a fullName + "0.0").
//   3. Join each to the max 24h USD volume across its pairs.
//   4. For the liquid ones, read the on-chain ERC20 name/symbol at the token's
//      HyperEVM contract address (the EVM representation, fungible with the
//      Core spot liquidity) — this is what a launchpad would pair against.
//
// Finding: the liquid tokenized stocks on HyperEVM are the "dStock" line
// (QQQd, GLDd, HOODd, MUd, SPYd), NOT the Ondo "…on" tokens, which have no
// spot or EVM-DEX liquidity at all.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const RPC = "https://rpc.hyperliquid.xyz/evm";
const ERC20 = ["function symbol() view returns (string)","function name() view returns (string)","function decimals() view returns (uint8)"];
async function post(type, extra = {}) {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, ...extra }) });
  return r.json();
}
async function main() {
  const [meta, ctxs] = await post("spotMetaAndAssetCtxs");
  const tokens = meta.tokens || [];
  const universe = meta.universe || [];
  const p = new ethers.JsonRpcProvider(RPC, 999);

  const tokVol = new Map();
  universe.forEach((u, i) => {
    const c = ctxs[i] || {};
    const vol = c.dayNtlVlm ? Number(c.dayNtlVlm) : 0;
    const mid = c.midPx ? Number(c.midPx) : null;
    for (const ti of u.tokens) {
      const cur = tokVol.get(ti);
      if (!cur || vol > cur.vol) tokVol.set(ti, { vol, mid, pair: u.name });
    }
  });

  const stocks = tokens.map((t, i) => ({ t, i }))
    .filter(({ t }) => t.deployerTradingFeeShare === "1.0" && t.fullName === null && !t.isCanonical)
    .map(({ t, i }) => {
      const v = tokVol.get(i) || { vol: 0, mid: null, pair: null };
      return { ticker: t.name, evm: t.evmContract && t.evmContract.address,
        pair: v.pair, mid: v.mid, dayVol: v.vol };
    })
    .sort((a, b) => b.dayVol - a.dayVol);

  const liquid = stocks.filter((s) => s.dayVol > 1000 && s.evm);
  for (const s of liquid) {
    try {
      const c = new ethers.Contract(s.evm, ERC20, p);
      s.evmSymbol = await c.symbol(); s.evmName = await c.name(); s.evmDecimals = Number(await c.decimals());
    } catch {}
  }

  console.log(`spot tokens: ${tokens.length} | RWA-marked: ${stocks.length} | liquid (>$1k/24h): ${liquid.length}\n`);
  console.log("ticker  evmSymbol  name                          mid          24h $vol      evm");
  for (const s of liquid)
    console.log(`${s.ticker.padEnd(6)}  ${String(s.evmSymbol||"?").padEnd(8)}  ${String(s.evmName||"").padEnd(28)}  ${("$"+(s.mid||0).toFixed(2)).padStart(11)}  ${("$"+Math.round(s.dayVol).toLocaleString()).padStart(13)}  ${s.evm}`);

  fs.writeFileSync(path.join(__dirname, "..", "deployments/hyperevm-stock-liquidity.json"),
    JSON.stringify({ checkedAt: new Date().toISOString(),
      method: "hyperliquid spotMeta: deployerTradingFeeShare=='1.0' && fullName==null, ranked by 24h dayNtlVlm; evm name/symbol read on-chain",
      note: "Liquidity is on Hyperliquid Core spot. The liquid line is dStock (…d) tokens; Ondo …on tokens have no spot or EVM-DEX liquidity.",
      liquidThresholdUsd: 1000, liquid, allRwaMarked: stocks }, null, 2));
  console.log("\nsaved deployments/hyperevm-stock-liquidity.json");
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
