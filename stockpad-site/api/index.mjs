// The Equo indexer's API on Vercel, behind the /api/* rewrite in vercel.json. The indexer's code (indexer/ in the
// repo) is copied to api/_indexer when the site is deployed. DATABASE_URL and TICK=1 are set in the Vercel
// project's environment; with TICK=1, /api/tick indexes new blocks in short bursts (the site asks for one now
// and then while people are on it).
import { loadChains } from "./_indexer/src/config.js";
import { makeHandler } from "./_indexer/src/api.js";

let h;
export default async function handler(req, res) {
  h = h || makeHandler(loadChains());
  const path = new URL(req.url, "http://x").searchParams.get("__p") || "";
  await h.handle(req, res, "/api/" + path);
}
