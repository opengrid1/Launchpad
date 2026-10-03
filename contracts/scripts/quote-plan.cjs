const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const RPC = "https://rpc.hyperliquid.xyz/evm";
const FACTORY = "0xd078ef6FB94AEcd8959212c5E8498bEa26f2c628";
const WHYPE = "0x5555555555555555555555555555555555555555";
async function post(type, extra = {}) {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, ...extra }) });
  return r.json();
}
const FAC_ABI = [
  "function owner() view returns (address)",
  "function quoteAssets(address) view returns (bool approved, uint64 usdPrice8, uint8 decimals)",
];
async function main() {
  const p = new ethers.JsonRpcProvider(RPC, 999);
  const fac = new ethers.Contract(FACTORY, FAC_ABI, p);
  const owner = await fac.owner();
  console.log("factory:", FACTORY, "\nowner:", owner, "\n");

  // best USD price per stock from spot ctx: mid || mark || prevDay
  const [meta, ctxs] = await post("spotMetaAndAssetCtxs");
  const tokens = meta.tokens || [], universe = meta.universe || [];
  const priceByTok = new Map();
  universe.forEach((u, i) => {
    const c = ctxs[i] || {};
    const px = Number(c.midPx || c.markPx || c.prevDayPx || 0);
    for (const ti of u.tokens) { if (px > 0 && !priceByTok.has(ti)) priceByTok.set(ti, px); }
  });
  const priceByEvm = new Map();
  tokens.forEach((t, i) => { const e = t.evmContract && t.evmContract.address; if (e && priceByTok.get(i)) priceByEvm.set(e.toLowerCase(), priceByTok.get(i)); });

  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments/hyperevm-dstocks.json"), "utf8"));
  const bridgeable = d.bridgeable;

  // check WHYPE quote
  const wq = await fac.quoteAssets(WHYPE);
  console.log(`WHYPE (default pair): approved=${wq.approved} usd8=${wq.usdPrice8} ($${Number(wq.usdPrice8)/1e8})\n`);

  console.log("stock   px(USD)   usd8            already?   evm");
  const plan = [];
  for (const s of bridgeable) {
    const px = priceByEvm.get(s.evm.toLowerCase()) || null;
    const q = await fac.quoteAssets(s.evm);
    const usd8 = px ? BigInt(Math.round(px * 1e8)) : null;
    plan.push({ ticker: s.ticker, evm: s.evm, px, usd8: usd8 ? usd8.toString() : null, approved: q.approved });
    console.log(`${String(s.ticker).padEnd(7)} ${px!=null?("$"+px.toFixed(2)).padStart(9):"   (none)"}  ${(usd8?usd8.toString():"-").padStart(14)}   ${q.approved?"YES":"no "}       ${s.evm}`);
  }
  fs.writeFileSync(path.join(__dirname, "..", "deployments/meow-quote-plan.json"),
    JSON.stringify({ factory: FACTORY, owner, whype: { address: WHYPE, approved: wq.approved, usd8: wq.usdPrice8.toString() }, plan }, null, 2));
  console.log("\nsaved deployments/meow-quote-plan.json");
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
