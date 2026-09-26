/** Environment. Secrets live in tgbot/.env (gitignored) or the host's secret
 *  store; nothing here is ever logged. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..");

// A minimal .env loader so the bot runs the same locally and on a host.
try {
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env: rely on the environment */ }

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const config = {
  botToken: need("TG_BOT_TOKEN"),
  /** Encrypts every user's key at rest. Losing it loses the wallets. */
  secret: need("BOT_SECRET"),
  dataDir: process.env.DATA_DIR ?? join(ROOT, "data"),
  factory: process.env.NEAR_FACTORY ?? "chipfi.near",
  rpcUrls: (process.env.NEAR_RPC ?? "https://free.rpc.fastnear.com,https://rpc.mainnet.near.org").split(","),
  siteUrl: process.env.SITE_URL ?? "https://www.chipfi.fun",
  dex: "v2.ref-finance.near",
  dcl: "dclv2.ref-labs.near",
  wnear: "wrap.near",
  /** Telegram user ids allowed to use admin commands, comma separated. */
  admins: (process.env.ADMIN_IDS ?? "").split(",").filter(Boolean).map(Number),
};
