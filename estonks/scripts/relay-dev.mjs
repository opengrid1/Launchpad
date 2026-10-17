// Runs api/relay.js locally (for the fork end-to-end test), with CORS so a
// preview build on another port can call it.
//   RELAYER_KEY=0x... VAULT=0x... RPC_URL=http://127.0.0.1:8546 PORT=4190 node scripts/relay-dev.mjs
import http from "node:http";

const { default: handler } = await import("../api/relay.js");
const port = Number(process.env.PORT ?? 4190);
http.createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (!req.url.startsWith("/api/relay")) { res.statusCode = 404; return res.end(); }
  await handler(req, res);
}).listen(port, () => console.log(`relay on http://127.0.0.1:${port}/api/relay`));
