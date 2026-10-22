import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Chain settings from chains.json (or CHAINS_FILE), with per-chain overrides from the environment:
 *  RPC_<KEY> (comma separated), FACTORY_<KEY>, HOOK_<KEY>, START_BLOCK_<KEY>, MAX_RANGE_<KEY>. */
export function loadChains() {
  const file = process.env.CHAINS_FILE || join(here, "..", "chains.json");
  const all = JSON.parse(readFileSync(file, "utf8")).chains;
  return all.map((c) => {
    const K = c.key.toUpperCase();
    const env = (n) => process.env[`${n}_${K}`];
    const lc = (a) => String(a || "").toLowerCase();
    return {
      ...c,
      rpcs: env("RPC") ? env("RPC").split(",").map((s) => s.trim()).filter(Boolean) : c.rpcs,
      factory: lc(env("FACTORY") || c.factory),
      hook: lc(env("HOOK") || c.hook),
      poolManager: lc(c.poolManager),
      wrappedNative: lc(c.wrappedNative),
      startBlock: Number(env("START_BLOCK") || c.startBlock || 0),
      maxRange: Number(env("MAX_RANGE") || c.maxRange || 1000),
      confirmations: Number(c.confirmations ?? 2),
      pollMs: Number(process.env.POLL_MS || c.pollMs || 5000),
    };
  });
}

export const settings = {
  databaseUrl: process.env.DATABASE_URL || "postgres://equo@127.0.0.1:5433/equo",
  port: Number(process.env.PORT || 8080),
  mode: process.env.MODE || "all", // all | worker | api | migrate
  priceEveryMs: Number(process.env.PRICE_EVERY_MS || 60_000),
  // browsers allowed to call the API; "*" for any
  corsOrigin: process.env.CORS_ORIGIN || "*",
};
