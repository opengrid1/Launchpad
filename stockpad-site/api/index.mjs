// The Equo indexer's API on Vercel, behind the /api/* rewrite in vercel.json. The indexer's code (indexer/ in the
// repo) is copied to api/_indexer when the site is deployed. DATABASE_URL and TICK=1 are set in the Vercel
// project's environment; with TICK=1, /api/tick indexes new blocks in short bursts (the site asks for one now
// and then while people are on it).
//
// /api/sol forwards Solana JSON-RPC calls from the site (sol.js). Public Solana RPCs refuse requests that carry a
// browser Origin, so the site reads Solana through here. Only the read methods the site uses and sendTransaction
// pass; SOLANA_RPC in the environment replaces the public endpoint.
import { loadChains } from "./_indexer/src/config.js";
import { makeHandler } from "./_indexer/src/api.js";

const SOL_RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const SOL_METHODS = new Set([
  "getAccountInfo", "getMultipleAccounts", "getProgramAccounts", "getSignaturesForAddress", "getTransaction",
  "getLatestBlockhash", "getBalance", "getTokenAccountsByOwner", "getTokenLargestAccounts", "getTokenAccountBalance",
  "getSignatureStatuses", "simulateTransaction", "sendTransaction", "getMinimumBalanceForRentExemption", "getSlot",
]);
// getProgramAccounts only for the Equo program (the one heavy call the site makes)
const SOL_PROGRAM = "6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR";

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  let s = "";
  for await (const c of req) s += c;
  return JSON.parse(s || "null");
}

async function sol(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") { res.statusCode = 405; return res.end(JSON.stringify({ error: "POST only" })); }
  let body;
  try { body = await readBody(req); } catch { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad json" })); }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 40) { res.statusCode = 400; return res.end(JSON.stringify({ error: "1 to 40 calls" })); }
  for (const c of calls) {
    const ok = c && SOL_METHODS.has(c.method) && (c.method !== "getProgramAccounts" || (Array.isArray(c.params) && c.params[0] === SOL_PROGRAM));
    if (!ok) { res.statusCode = 403; return res.end(JSON.stringify({ error: "method not allowed: " + (c && c.method) })); }
  }
  try {
    const r = await fetch(SOL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    res.statusCode = r.status;
    res.setHeader("content-type", "application/json");
    res.end(await r.text());
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: "solana rpc: " + e.message }));
  }
}

let h;
export default async function handler(req, res) {
  const path = new URL(req.url, "http://x").searchParams.get("__p") || "";
  if (path === "sol") return sol(req, res);
  h = h || makeHandler(loadChains());
  await h.handle(req, res, "/api/" + path);
}
