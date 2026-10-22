import http from "node:http";
import { q } from "./db.js";
import { settings } from "./config.js";

/* Read-only HTTP API over the indexed data. Every coin can be addressed by any of its contract addresses
   (on any chain) or by its coin id. Prices are USD per whole coin; volumes are USD. */

const lc = (a) => String(a || "").toLowerCase();
const isAddr = (a) => /^0x[0-9a-f]{40}$/.test(a);
const DAY = 86400;
const RES = new Set([60, 300, 900, 1800, 3600, 14400, 86400, 604800]);

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

/** Contracts that hold coins without being holders: per chain, plus the zero and dead addresses. */
function systemAddrs(chains) {
  const s = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
  for (const c of chains) for (const k of ["poolManager", "factory", "hook", "tokenDeployer", "router"]) if (c[k]) s.add(lc(c[k]));
  return [...s];
}

async function coinIdOf(v) {
  v = lc(v);
  if (v.includes(":")) return v;
  if (!isAddr(v)) throw new HttpError(400, "coin must be an address or a coin id");
  const r = await q("select coin_id from tokens where token = $1 limit 1", [v]);
  if (!r.rows.length) throw new HttpError(404, "unknown coin");
  return r.rows[0].coin_id;
}

async function coins(ids) {
  const now = Math.floor(Date.now() / 1000);
  const m = await q(`select coin_id, chain, token, creator, pair, pool_id, name, symbol, launch_ts, launch_block from tokens where coin_id = any($1) order by launch_ts`, [ids]);
  const last = await q(`select distinct on (coin_id, chain) coin_id, chain, price_usd, ts from trades where coin_id = any($1) and price_usd is not null order by coin_id, chain, ts desc, block desc, log_index desc`, [ids]);
  const day = await q(`select coin_id, chain, count(*)::int n, coalesce(sum(value_usd),0) vol, sum(case when buy then 1 else 0 end)::int buys from trades where coin_id = any($1) and ts >= $2 group by 1, 2`, [ids, now - DAY]);
  const open = await q(`select distinct on (coin_id) coin_id, price_usd from trades where coin_id = any($1) and ts >= $2 and price_usd is not null order by coin_id, ts, block, log_index`, [ids, now - DAY]);
  const tot = await q(`select coin_id, count(*)::int n from trades where coin_id = any($1) group by 1`, [ids]);
  const sup = await q(`select t.coin_id, b.chain, sum(b.balance)::text supply from balances b join tokens t on t.chain = b.chain and t.token = b.token where t.coin_id = any($1) group by 1, 2`, [ids]);
  const by = new Map();
  for (const r of m.rows) {
    if (!by.has(r.coin_id)) by.set(r.coin_id, { id: r.coin_id, name: r.name, symbol: r.symbol, creator: r.creator, createdAt: r.launch_ts, chains: {}, trades: 0, trades24: 0, buys24: 0, vol24: 0 });
    by.get(r.coin_id).chains[r.chain] = { token: r.token, pair: r.pair, poolId: r.pool_id, launchedAt: r.launch_ts, launchBlock: r.launch_block, price: null, vol24: 0, trades24: 0, supply: null };
  }
  for (const r of last.rows) { const x = by.get(r.coin_id); if (x && x.chains[r.chain]) { x.chains[r.chain].price = r.price_usd; x.chains[r.chain].lastTradeAt = r.ts; } }
  for (const r of day.rows) { const x = by.get(r.coin_id); if (!x || !x.chains[r.chain]) continue; x.chains[r.chain].vol24 = Number(r.vol); x.chains[r.chain].trades24 = r.n; x.vol24 += Number(r.vol); x.trades24 += r.n; x.buys24 += r.buys; }
  for (const r of tot.rows) { const x = by.get(r.coin_id); if (x) x.trades = r.n; }
  for (const r of sup.rows) { const x = by.get(r.coin_id); if (x && x.chains[r.chain]) x.chains[r.chain].supply = r.supply; }
  for (const r of open.rows) { const x = by.get(r.coin_id); if (x) x.open24 = r.price_usd; }
  for (const x of by.values()) {
    // market cap: each chain's supply at that chain's last price
    let mc = 0, coinsAll = 0;
    for (const ch of Object.values(x.chains)) { const s = ch.supply ? Number(ch.supply) / 1e18 : 0; coinsAll += s; if (ch.price) mc += s * ch.price; }
    x.supply = coinsAll;
    x.mc = mc || null;
    x.price = mc && coinsAll ? mc / coinsAll : null;
    x.change24 = x.price && x.open24 ? (x.price / x.open24 - 1) * 100 : null;
    delete x.open24;
  }
  return ids.map((i) => by.get(i)).filter(Boolean);
}

export function makeApi(chains) {
  const SYSTEM = systemAddrs(chains);
  const routes = {
    async "/api/health"() {
      const r = await q("select chain, last_block, head_block, updated_at from chain_state order by chain");
      return { ok: true, chains: r.rows.map((x) => ({ chain: x.chain, indexed: x.last_block, head: x.head_block, behind: x.head_block != null ? x.head_block - x.last_block : null, updatedAt: x.updated_at })) };
    },

    async "/api/coins"(p) {
      const limit = Math.min(200, Number(p.get("limit") || 100)), sort = p.get("sort") || "new", chain = p.get("chain");
      const now = Math.floor(Date.now() / 1000);
      let ids;
      if (sort === "vol") ids = (await q(`select t.coin_id from tokens t left join trades r on r.coin_id = t.coin_id and r.ts >= $1 where ($3::text is null or t.chain = $3) group by 1 order by coalesce(sum(r.value_usd),0) desc limit $2`, [now - DAY, limit, chain])).rows;
      else ids = (await q(`select coin_id from tokens where ($2::text is null or chain = $2) group by 1 order by min(launch_ts) desc limit $1`, [limit, chain])).rows;
      return { coins: await coins(ids.map((r) => r.coin_id)) };
    },

    async "/api/coin"(p) {
      const id = await coinIdOf(p.get("coin"));
      const [c] = await coins([id]);
      if (!c) throw new HttpError(404, "unknown coin");
      const h = await q(`select count(distinct b.wallet)::int n from balances b join tokens t on t.chain = b.chain and t.token = b.token where t.coin_id = $1 and b.balance > 0 and not (b.wallet = any($2))`, [id, SYSTEM]);
      c.holders = h.rows[0].n;
      return c;
    },

    async "/api/trades"(p) {
      const id = await coinIdOf(p.get("coin")), chain = p.get("chain") || null, limit = Math.min(500, Number(p.get("limit") || 100));
      const before = p.get("before") ? Number(p.get("before")) : null, wallet = p.get("wallet") ? lc(p.get("wallet")) : null;
      const r = await q(
        `select chain, tx, log_index, token, wallet, buy, coin_amt::text coin, pair_amt::text pair, fee::text fee, block, ts, price_usd, value_usd
         from trades where coin_id = $1 and ($2::text is null or chain = $2) and ($3::bigint is null or ts < $3) and ($5::text is null or wallet = $5)
         order by ts desc, block desc, log_index desc limit $4`, [id, chain, before, limit, wallet]);
      return { coin: id, trades: r.rows.map((t) => ({ chain: t.chain, tx: t.tx, index: t.log_index, token: t.token, wallet: t.wallet, buy: t.buy, coin: t.coin, pair: t.pair, fee: t.fee, block: t.block, ts: t.ts, priceUsd: t.price_usd, valueUsd: t.value_usd })) };
    },

    /** OHLCV candles. chain: a chain key for one pool, or none for every chain merged. unit=pair (one chain only)
     *  gives prices in the pair per coin instead of USD. */
    async "/api/candles"(p) {
      const id = await coinIdOf(p.get("coin")), chain = p.get("chain") && p.get("chain") !== "merged" ? p.get("chain") : null;
      const res = Number(p.get("res") || 300);
      if (!RES.has(res)) throw new HttpError(400, "res must be one of " + [...RES].join(", "));
      const now = Math.floor(Date.now() / 1000), to = Number(p.get("to") || now + 1), from = Number(p.get("from") || to - res * 500);
      if (to - from > res * 5000) throw new HttpError(400, "too many candles: narrow from/to or use a larger res");
      const pairUnit = p.get("unit") === "pair";
      if (pairUnit && !chain) throw new HttpError(400, "unit=pair needs one chain");
      const px = pairUnit ? "(pair_amt / nullif(coin_amt, 0))::float8" : "price_usd";
      const r = await q(
        `select (ts / $2) * $2 t,
                (array_agg(${px} order by ts, block, log_index))[1] o, max(${px}) h, min(${px}) l,
                (array_agg(${px} order by ts desc, block desc, log_index desc))[1] c,
                coalesce(sum(value_usd), 0) v, count(*)::int n
         from trades where coin_id = $1 and ($3::text is null or chain = $3) and ts >= $4 and ts < $5 and ${pairUnit ? "coin_amt > 0" : "price_usd is not null"}
         group by 1 order by 1`, [id, res, chain, from, to]);
      return { coin: id, chain: chain || "merged", res, unit: pairUnit ? "pair" : "usd", candles: r.rows };
    },

    async "/api/holders"(p) {
      const id = await coinIdOf(p.get("coin")), limit = Math.min(500, Number(p.get("limit") || 100));
      const r = await q(
        `select b.wallet, sum(b.balance)::text balance, json_object_agg(b.chain, b.balance::text) by_chain
         from balances b join tokens t on t.chain = b.chain and t.token = b.token
         where t.coin_id = $1 and b.balance > 0 and not (b.wallet = any($3))
         group by b.wallet order by sum(b.balance) desc limit $2`, [id, limit, SYSTEM]);
      const tot = await q(`select sum(b.balance)::text s from balances b join tokens t on t.chain = b.chain and t.token = b.token where t.coin_id = $1`, [id]);
      const supply = Number(tot.rows[0].s || 0);
      return { coin: id, supply: tot.rows[0].s || "0", holders: r.rows.map((h) => ({ wallet: h.wallet, balance: h.balance, share: supply ? (Number(h.balance) / supply) * 100 : 0, byChain: h.by_chain })) };
    },

    async "/api/bridges"(p) {
      const id = await coinIdOf(p.get("coin")), limit = Math.min(200, Number(p.get("limit") || 50));
      const r = await q(`select chain, tx, direction, guid, peer_eid, wallet, amount_sent::text sent, amount_received::text received, block, ts from bridges where coin_id = $1 order by ts desc, block desc limit $2`, [id, limit]);
      return { coin: id, bridges: r.rows };
    },
  };

  return http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    res.setHeader("access-control-allow-origin", settings.corsOrigin);
    res.setHeader("access-control-allow-methods", "GET, OPTIONS");
    res.setHeader("content-type", "application/json");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    if (req.method !== "GET") { res.writeHead(405).end(JSON.stringify({ error: "GET only" })); return; }
    const fn = routes[u.pathname.replace(/\/$/, "")];
    if (!fn) { res.writeHead(404).end(JSON.stringify({ error: "not found" })); return; }
    try {
      const body = await fn(u.searchParams);
      res.setHeader("cache-control", u.pathname === "/api/health" ? "no-store" : "public, max-age=2, s-maxage=2");
      res.writeHead(200).end(JSON.stringify(body));
    } catch (e) {
      const code = e instanceof HttpError ? e.code : 500;
      if (code === 500) console.error(u.pathname, e);
      res.writeHead(code).end(JSON.stringify({ error: code === 500 ? "internal error" : e.message }));
    }
  });
}
