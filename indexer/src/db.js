import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { settings } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));

// numeric comes back as a string (no precision loss); bigint (int8) as a JS number, which is safe for blocks and timestamps
pg.types.setTypeParser(20, (v) => Number(v));

const needsSsl = (url) => /sslmode=require|neon\.tech|supabase\.co|render\.com/.test(url);

export const pool = new pg.Pool({
  connectionString: settings.databaseUrl,
  ssl: needsSsl(settings.databaseUrl) ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL || 10),
});

export async function migrate() {
  await pool.query(readFileSync(join(here, "..", "schema.sql"), "utf8"));
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
