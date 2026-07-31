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
const agent = new SocksProxyAgent(SOCKS);

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
}

const server = http.createServer((req, res) => {
  cors(res);
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") return res.writeHead(204).end();

  // Health check: GET / returns the current block over Tor so uptime monitors
  // see a real chain read, not just a static 200.
  if (req.method === "GET" && url.pathname === "/") {
    forward('{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}', res, 15_000);
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
    forward(body, res, 30_000);
  });
});

function forward(body, res, timeoutMs) {
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
      res.writeHead(up.statusCode ?? 502, { "content-type": "application/json" });
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
