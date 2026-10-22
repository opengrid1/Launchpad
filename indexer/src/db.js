import pg from "pg";
import { Pool as NeonPool, neonConfig, types as neonTypes } from "@neondatabase/serverless";
import { settings } from "./config.js";
import { SCHEMA } from "./schema.js";

// numeric comes back as a string (no precision loss); bigint (int8) as a JS number, which is safe for blocks and timestamps
pg.types.setTypeParser(20, (v) => Number(v));
neonTypes.setTypeParser(20, (v) => Number(v));

const url = settings.databaseUrl;
// Neon speaks Postgres over a WebSocket on 443 too: used for Neon so it works where port 5432 is closed
// (serverless functions, locked-down networks); any other Postgres goes through `pg`
const isNeon = /neon\.tech/.test(url);
if (isNeon && typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
const needsSsl = /sslmode=require|supabase\.co|render\.com/.test(url);

export const pool = isNeon
  ? new NeonPool({ connectionString: url, max: Number(process.env.DB_POOL || 5) })
  : new pg.Pool({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : undefined, max: Number(process.env.DB_POOL || 10) });

export async function migrate() {
  await pool.query(SCHEMA);
}

export const q = (text, params) => pool.query(text, params);

/** Run `fn` inside one transaction; everything it writes lands together or not at all. */
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
