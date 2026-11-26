import { loadChains, settings } from "./config.js";
import { migrate, pool } from "./db.js";
import { ChainIndexer } from "./indexer.js";
import { makeApi } from "./api.js";

const log = {
  info: (...a) => console.log(new Date().toISOString(), ...a),
  warn: (...a) => console.warn(new Date().toISOString(), ...a),
};

async function main() {
  const chains = loadChains();
  await migrate();
  if (settings.mode === "migrate") { log.info("schema ready"); await pool.end(); return; }

  const workers = [];
  if (settings.mode === "all" || settings.mode === "worker") {
    for (const c of chains) {
      if (!c.factory) { log.info(`[${c.key}] no factory configured yet, skipped`); continue; }
      const w = new ChainIndexer(c, chains, log);
      w.priceEveryMs = settings.priceEveryMs;
      workers.push(w);
      w.run().catch((e) => log.warn(`[${c.key}] stopped: ${e.message}`));
    }
  }
  let server;
  if (settings.mode === "all" || settings.mode === "api") {
    server = makeApi(chains);
    server.listen(settings.port, () => log.info(`api on :${settings.port}`));
  }
  const stop = async () => { workers.forEach((w) => w.stop()); if (server) server.close(); setTimeout(() => process.exit(0), 1500); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
