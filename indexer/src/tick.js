import { loadChains } from "./config.js";
import { migrate, q } from "./db.js";
import { ChainIndexer } from "./indexer.js";
import { SolanaIndexer } from "./solana.js";

/* Indexing in short bursts, for hosts that run code per request (serverless functions): each tick takes a
   lease in tick_lock (one tick at a time, at most one every few seconds), then lets every chain catch up
   until the time budget runs out. The next tick continues where this one stopped. */

const workers = new Map(); // kept while the function instance stays warm
let migrated = null; // the schema is applied once per function instance (every statement is idempotent)

export async function tick(budgetMs = Number(process.env.TICK_BUDGET_MS || 45_000)) {
  const t0 = Date.now();
  const got = await q(
    `insert into tick_lock (id, until) values (1, now() + make_interval(secs => $1))
     on conflict (id) do update set until = excluded.until
     where tick_lock.until < now() and (tick_lock.last_done is null or tick_lock.last_done < now() - interval '8 seconds')
     returning id`, [Math.ceil(budgetMs / 1000) + 30]);
  if (!got.rows.length) return { skipped: true };
  migrated = migrated || migrate().catch((e) => { migrated = null; throw e; });
  await migrated;
  const chains = loadChains(), out = {};
  try {
    const sol = (async () => {
      try {
        let w = workers.get("sol");
        if (!w) { w = new SolanaIndexer(console); await w.init(); workers.set("sol", w); }
        out.sol = await w.catchUp(t0 + budgetMs);
      } catch (e) {
        workers.delete("sol");
        out.sol = { error: e.message };
      }
    })();
    await Promise.all(chains.filter((c) => c.factory).map(async (c) => {
      try {
        let w = workers.get(c.key);
        if (!w) { w = new ChainIndexer(c, chains, console); await w.init(); w.lastPrice = Date.now(); workers.set(c.key, w); }
        out[c.key] = await w.catchUp(t0 + budgetMs);
      } catch (e) {
        workers.delete(c.key);
        out[c.key] = { error: e.message };
      }
    }));
    await sol;
  } finally {
    await q("update tick_lock set until = now(), last_done = now() where id = 1");
  }
  return { ms: Date.now() - t0, chains: out };
}
