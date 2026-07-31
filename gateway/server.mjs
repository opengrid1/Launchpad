// Tor-to-clearnet JSON-RPC gateway for the Arc mainnet .onion endpoint.
// Browsers, wallets and bots cannot resolve .onion; this server runs alongside
// a Tor client and forwards clearnet HTTP(S) JSON-RPC requests to the onion
// over Tor's SOCKS5 proxy, adding CORS so any origin can call it.
import http from "node:http";
import { SocksProxyAgent } from "socks-proxy-agent";

const PORT = Number(process.env.PORT ?? 8080);
const SOCKS = process.env.TOR_SOCKS ?? "socks5h://127.0.0.1:9050";
// Onion RPC (http; Tor provides the transport encryption). Override via env.
const ONION =
  process.env.ONION_RPC ??
  "http://t6bmjag46e5l6tb25yojjqlabzmbpjylcffyyffa5d3ghmku6m7rcrad.onion/";
// Optional shared secret: when set, callers must include ?key=... so the
// endpoint is not an open proxy.
const ACCESS_KEY = process.env.ACCESS_KEY ?? "";

const onion = new URL(ONION);
// keepAlive reuses the Tor circuit/socket across calls instead of building a
// new one per request; the biggest single latency win over Tor.
const agent = new SocksProxyAgent(SOCKS, { keepAlive: true, maxSockets: 32, timeout: 60_000 });

// Tiny read-through cache: identical read calls (the token list, prices,
// receipts every visitor fetches) collapse into one Tor round trip within the
// TTL. Never caches writes or gas estimation.
const CACHE_TTL_MS = 2_500;
const cache = new Map(); // bodyKey -> { at, status, text }
const NO_CACHE = /"method"\s*:\s*"eth_(sendRawTransaction|sendTransaction|estimateGas)"/;
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  if (hit) cache.delete(key);
  return null;
}
function cacheSet(key, status, text) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), status, text });
}

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
}

const server = http.createServer((req, res) => {
  cors(res);
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") return res.writeHead(204).end();

  // Liveness: GET / returns 200 immediately (no Tor) so platform health checks
  // pass the moment the process binds, even while Tor is still bootstrapping.
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"status":"ok"}');
  }

  // Deep check: GET /health does a real chain read over Tor.
  if (req.method === "GET" && url.pathname === "/health") {
    forward('{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}', res, 20_000);
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    return res.end('{"error":"POST only"}');
  }
  if (ACCESS_KEY && url.searchParams.get("key") !== ACCESS_KEY) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end('{"error":"unauthorized"}');
  }

  let body = "";
  let tooBig = false;
  req.on("data", (c) => {
    body += c;
    if (body.length > 1_000_000) {
      tooBig = true;
      req.destroy();
    }
  });
  req.on("end", () => {
    if (tooBig) return;
    const cacheable = body.length < 64_000 && !NO_CACHE.test(body);
    if (cacheable) {
      const hit = cacheGet(body);
      if (hit) {
        res.writeHead(hit.status, { "content-type": "application/json", "x-cache": "hit" });
        return res.end(hit.text);
      }
    }
    forward(body, res, 30_000, cacheable ? body : null);
  });
});

function forward(body, res, timeoutMs, cacheKey) {
  const upstream = http.request(
    {
      protocol: onion.protocol,
      host: onion.hostname,
      port: onion.port || 80,
      path: onion.pathname,
      method: "POST",
      agent,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      timeout: timeoutMs,
    },
    (up) => {
      const status = up.statusCode ?? 502;
      if (cacheKey && status === 200) {
        // Buffer so the response can be cached, then send.
        let text = "";
        up.setEncoding("utf8");
        up.on("data", (c) => (text += c));
        up.on("end", () => {
          cacheSet(cacheKey, status, text);
          res.writeHead(status, { "content-type": "application/json" });
          res.end(text);
        });
        return;
      }
      res.writeHead(status, { "content-type": "application/json" });
      up.pipe(res);
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("tor upstream timeout")));
  upstream.on("error", (e) => {
    if (res.headersSent) return res.end();
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "tor upstream: " + e.message } }));
  });
  upstream.end(body);
}

server.listen(PORT, () => console.log(`arc tor gateway on :${PORT} -> ${onion.hostname} via ${SOCKS}`));
