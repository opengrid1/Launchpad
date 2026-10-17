// GIWA mainnet RPC gateway: one stable URL for wallets and apps that forwards
// JSON-RPC to an upstream node. Set UPSTREAM_HTTP to your own GIWA node or the
// endpoint GIWA publishes at launch. Until then it answers the chain id, so the
// network can be added to a wallet, and says that mainnet is not live for the
// rest. No dependencies.
import { createServer } from "node:http";

const UPSTREAM = process.env.UPSTREAM_HTTP ?? "";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 9134);
const NAME = process.env.CHAIN_NAME ?? "GIWA";
const EXPLORER = process.env.EXPLORER ?? "";
const PORT = Number(process.env.PORT ?? 8545);
const MAX_BODY = 1_000_000;

const hex = (n) => "0x" + n.toString(16);
const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type" };

let upstreamHead = null, upstreamChain = null, checkedAt = 0;
async function probe() {
  if (Date.now() - checkedAt < 5000 || !UPSTREAM) return;
  checkedAt = Date.now();
  try {
    const r = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }, { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] }]), signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    upstreamChain = parseInt(j.find((x) => x.id === 1)?.result ?? "0", 16) || null;
    upstreamHead = parseInt(j.find((x) => x.id === 2)?.result ?? "0", 16) || null;
  } catch { upstreamHead = null; }
}

const page = () => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${NAME} RPC</title>
<style>body{font:16px/1.5 system-ui;background:#0b0b12;color:#e8e6f0;margin:0;padding:24px;max-width:640px}code{background:#1a1a26;padding:2px 6px;border-radius:6px}h1{font-size:22px;margin:0 0 8px}table{border-collapse:collapse;margin:16px 0}td{padding:6px 12px 6px 0;vertical-align:top}.ok{color:#7be0a5}.bad{color:#ff8a8a}</style>
<h1>${NAME} RPC</h1><p>Add this network to MetaMask or OKX Wallet with the values below.</p>
<table><tr><td>Network name</td><td><b>${NAME}</b></td></tr><tr><td>RPC URL</td><td><code id="u"></code></td></tr><tr><td>Chain ID</td><td><b>${CHAIN_ID}</b></td></tr><tr><td>Currency</td><td>ETH</td></tr><tr><td>Explorer</td><td>${EXPLORER ? `<a href="${EXPLORER}" style="color:#b9a6ff">${EXPLORER}</a>` : "to be announced"}</td></tr></table>
${UPSTREAM ? `<p>Upstream: <code>${UPSTREAM}</code> · chain <b class="${upstreamChain === CHAIN_ID ? "ok" : "bad"}">${upstreamChain ?? "?"}</b> · head <b class="${upstreamHead ? "ok" : "bad"}">${upstreamHead ?? "unreachable"}</b></p>` : `<p class="bad">GIWA mainnet has not launched. This URL is live and will serve blocks the moment the node behind it is connected.</p>`}
<script>document.getElementById("u").textContent=location.origin</script>`;

createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.method === "GET") {
    await probe();
    if (req.url === "/health") { res.writeHead(upstreamHead || !UPSTREAM ? 200 : 503, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ chainId: CHAIN_ID, upstreamChainId: upstreamChain, head: upstreamHead, upstream: UPSTREAM })); }
    res.writeHead(200, { ...cors, "content-type": "text/html; charset=utf-8" }); return res.end(page());
  }
  if (req.method !== "POST") { res.writeHead(405, cors); return res.end(); }
  let body = ""; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) { res.writeHead(413, cors); return res.end(); } body += chunk; }
  let parsed;
  try { parsed = JSON.parse(body); } catch { res.writeHead(400, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })); }
  // eth_chainId is answered here so wallets get a fast, consistent reply.
  const single = !Array.isArray(parsed) && parsed?.method === "eth_chainId";
  if (single) { res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? null, result: hex(CHAIN_ID) })); }
  if (!UPSTREAM) { res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map((p) => ({ jsonrpc: "2.0", id: p?.id ?? null, error: { code: -32000, message: "GIWA mainnet has not launched yet" } })) : { jsonrpc: "2.0", id: parsed?.id ?? null, error: { code: -32000, message: "GIWA mainnet has not launched yet" } })); }
  try {
    const r = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    res.writeHead(r.status, { ...cors, "content-type": "application/json" }); res.end(text);
  } catch (e) {
    res.writeHead(502, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: Array.isArray(parsed) ? null : parsed?.id ?? null, error: { code: -32603, message: `upstream unreachable: ${e?.message ?? e}` } }));
  }
}).listen(PORT, () => console.log(`giwa rpc gateway on :${PORT} -> ${UPSTREAM || "(no upstream yet)"} (chain ${CHAIN_ID})`));
