import { Interface, AbiCoder, id as topicId } from "ethers";
import { Rpc } from "./rpc.js";
import { q, tx } from "./db.js";

/* One worker per chain. It walks blocks from the chain's start block to (head - confirmations) and writes,
   per batch and in one transaction: launches, swaps in launched pools (with the hook's fee), coin transfers
   (balances) and bridge sends/receipts. A trade's USD value uses the pair price the factory's oracle gave
   when the trade was indexed. */

const FACTORY = new Interface([
  "event Launched(address indexed token, address indexed creator, address indexed pair, bytes32 poolId, uint256 pairUsdPrice)",
  "function pairUsdPrice(address pair) view returns (uint256)",
  "function weth() view returns (address)",
]);
// Equo v2: the factory's launch event (one leg of a launch on several chains) and the hook's fee event
const FACTORY2 = new Interface([
  "event Launched(address indexed token, address indexed creator, bytes32 indexed launchId, bytes32 poolId, uint256 slice, uint16 feeBps, uint256 quoteUsd18)",
]);
const TOKEN = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function peers(uint32 eid) view returns (bytes32)",
  "function metadataURI() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event OFTSent(bytes32 indexed guid, uint32 dstEid, address indexed fromAddress, uint256 amountSentLD, uint256 amountReceivedLD)",
  "event OFTReceived(bytes32 indexed guid, uint32 srcEid, address indexed toAddress, uint256 amountReceivedLD)",
]);
const T = {
  launched: FACTORY.getEvent("Launched").topicHash,
  launched2: FACTORY2.getEvent("Launched").topicHash,
  feeTaken2: topicId("FeeTaken(address,uint256,uint256,uint256,uint256,uint256)"),
  swap: topicId("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"),
  feeTaken: topicId("FeeTaken(address,uint256,uint16)"),
  transfer: TOKEN.getEvent("Transfer").topicHash,
  oftSent: TOKEN.getEvent("OFTSent").topicHash,
  oftReceived: TOKEN.getEvent("OFTReceived").topicHash,
};
const abi = AbiCoder.defaultAbiCoder();
const ZERO = "0x0000000000000000000000000000000000000000";
// v2 coins have 9 decimals; their amounts are stored times this so every coin reads as 18 decimals
const V2_SCALE = 10n ** 9n;
const lc = (a) => String(a || "").toLowerCase();
const addrOf = (topic) => lc("0x" + topic.slice(26));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

async function pmap(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/** USD (18 dec per 1e18 base units) → USD per whole coin and USD value of the pair side. */
export function usdOf(coinAmt, pairAmt, usd18) {
  if (!usd18 || !coinAmt) return { price: null, value: null };
  const u = Number(usd18) / 1e18;
  return { price: (Number(pairAmt) / Number(coinAmt)) * u, value: (Number(pairAmt) / 1e18) * u };
}

export class ChainIndexer {
  constructor(chain, allChains, log = console) {
    this.c = chain;
    this.all = allChains;
    this.rpc = new Rpc(chain);
    this.log = log;
    this.pools = new Map(); // poolId -> { token, pair, coinId }
    this.tokens = new Map(); // token -> { coinId, pair, scale }
    this.prices = new Map(); // pair -> usd18 (string)
    this.blockTs = new Map();
    this.txFrom = new Map();
    this.stopped = false;
    this.batch = chain.maxRange * Number(chain.batchRanges || process.env.BATCH_RANGES || 10); // slow RPCs take smaller batches so one fits in a tick
  }

  async init() {
    const c = this.c;
    if (!c.wrappedNative) c.wrappedNative = lc(abi.decode(["address"], await this.rpc.ethCall(c.factory, FACTORY.encodeFunctionData("weth")))[0]);
    await q("insert into chain_state (chain, last_block, factory) values ($1, $2, $3) on conflict (chain) do nothing", [c.key, c.startBlock - 1, c.factory]);
    // a redeploy: the rows on this chain belong to the old factory's coins, so drop them and index the new one
    const st = (await q("select factory from chain_state where chain = $1", [c.key])).rows[0];
    if (st.factory !== c.factory) {
      this.log.info(`[${c.key}] factory changed (${st.factory || "unknown"} -> ${c.factory}): reindexing from block ${c.startBlock}`);
      for (const t of ["tokens", "trades", "balances", "bridges", "pair_prices"]) await q(`delete from ${t} where chain = $1`, [c.key]);
      await q("update chain_state set last_block = $2, head_block = null, factory = $3, updated_at = now() where chain = $1", [c.key, c.startBlock - 1, c.factory]);
    }
    // a later startBlock skips blocks the chain's RPCs no longer serve (nothing launched on the factory before it)
    await q("update chain_state set last_block = $2 where chain = $1 and last_block < $2", [c.key, c.startBlock - 1]);
    const r = await q("select token, coin_id, pair, pool_id, gen from tokens where chain = $1", [c.key]);
    for (const t of r.rows) {
      const scale = t.gen === 2 ? V2_SCALE : 1n;
      this.pools.set(t.pool_id, { token: t.token, pair: t.pair, coinId: t.coin_id, scale });
      this.tokens.set(t.token, { coinId: t.coin_id, pair: t.pair, scale });
    }
    const p = await q("select distinct on (pair) pair, usd18 from pair_prices where chain = $1 order by pair, ts desc", [c.key]);
    for (const x of p.rows) this.prices.set(x.pair, x.usd18);
    await this.refreshPrices();
  }

  // ---------------------------------------------------------------- prices

  async pairUsd(pair) {
    // the v2 factory keeps no prices: the first Equo factory on the chain (priceFrom) still reads its oracle
    const r = await this.rpc.ethCall(this.c.priceFrom || this.c.factory, FACTORY.encodeFunctionData("pairUsdPrice", [pair]));
    return abi.decode(["uint256"], r)[0].toString();
  }

  async refreshPrices() {
    const pairs = [...new Set([this.c.wrappedNative, ...[...this.tokens.values()].map((t) => t.pair)])].filter(Boolean);
    const now = Math.floor(Date.now() / 1000);
    for (const pair of pairs) {
      try {
        const usd18 = await this.pairUsd(pair);
        if (usd18 === "0") continue;
        this.prices.set(pair, usd18);
        await q("insert into pair_prices (chain, pair, ts, usd18) values ($1,$2,$3,$4) on conflict do nothing", [this.c.key, pair, now, usd18]);
      } catch (e) {
        this.log.warn(`[${this.c.key}] price ${pair}: ${e.message}`);
      }
    }
  }

  async priceFor(pair) {
    if (!this.prices.has(pair)) { try { this.prices.set(pair, await this.pairUsd(pair)); } catch { this.prices.set(pair, null); } }
    return this.prices.get(pair);
  }

  // ---------------------------------------------------------------- chain reads

  async ts(block) {
    if (!this.blockTs.has(block)) {
      const b = await this.rpc.block(block);
      this.blockTs.set(block, Number(b.timestamp));
      if (this.blockTs.size > 20_000) this.blockTs.clear();
    }
    return this.blockTs.get(block);
  }

  async from(hash) {
    if (!this.txFrom.has(hash)) {
      const t = await this.rpc.tx(hash);
      this.txFrom.set(hash, lc(t && t.from));
      if (this.txFrom.size > 20_000) this.txFrom.clear();
    }
    return this.txFrom.get(hash);
  }

  async str(token, fn, max = 64) {
    try { return abi.decode(["string"], await this.rpc.ethCall(token, TOKEN.encodeFunctionData(fn)))[0].slice(0, max); } catch { return null; }
  }

  /** The coin's id across chains: its Ethereum address when it has one there, else the smallest chain:address
   *  among itself and its peers. Every chain computes the same id from the same peer set. */
  async coinIdFor(token) {
    const members = [`${this.c.key}:${token}`];
    for (const o of this.all) {
      if (o.key === this.c.key || !o.lzEid) continue;
      try {
        const p = abi.decode(["bytes32"], await this.rpc.ethCall(token, TOKEN.encodeFunctionData("peers", [o.lzEid])))[0];
        if (BigInt(p) !== 0n) members.push(`${o.key}:${lc("0x" + p.slice(26))}`);
      } catch { break; } // not an omnichain coin: it has no peers()
    }
    const eth = members.find((m) => m.startsWith("eth:"));
    return eth || members.sort()[0];
  }

  // ---------------------------------------------------------------- one batch

  async process(from, to) {
    const c = this.c;
    // 1. launches
    const launches = [];
    const factories = [...new Set([c.factory, c.v2 && c.v2.factory].filter(Boolean))];
    for (const l of await this.rpc.logs({ address: factories, topics: [[T.launched, T.launched2]] }, from, to)) {
      const v2 = l.topics[0] === T.launched2 && c.v2 && lc(l.address) === c.v2.factory;
      if (!v2 && lc(l.address) !== c.factory) continue;
      const ev = (v2 ? FACTORY2 : FACTORY).parseLog(l);
      const token = lc(ev.args.token), pair = v2 ? c.wrappedNative : lc(ev.args.pair), poolId = lc(ev.args.poolId);
      const usd = v2 ? ev.args.quoteUsd18 : ev.args.pairUsdPrice;
      const coinId = await this.coinIdFor(token);
      const [name, symbol, ts, metadataUri] = await Promise.all([this.str(token, "name"), this.str(token, "symbol"), this.ts(Number(l.blockNumber)), v2 ? this.str(token, "metadataURI", 400) : null]);
      launches.push({ metadataUri, token, creator: lc(ev.args.creator), pair, poolId, coinId, name, symbol, block: Number(l.blockNumber), ts, tx: l.transactionHash, usd18: usd.toString(),
        gen: v2 ? 2 : 1, feeBps: v2 ? Number(ev.args.feeBps) : null, launchId: v2 ? lc(ev.args.launchId) : null });
      const scale = v2 ? V2_SCALE : 1n;
      this.pools.set(poolId, { token, pair, coinId, scale });
      this.tokens.set(token, { coinId, pair, scale });
      if (!this.prices.has(pair) && usd > 0n) this.prices.set(pair, usd.toString());
    }

    // 2. swaps in our pools, and the hook's fee for each
    const trades = [];
    if (this.pools.size) {
      const swaps = [];
      for (const ids of chunks([...this.pools.keys()], 100)) swaps.push(...(await this.rpc.logs({ address: c.poolManager, topics: [T.swap, ids] }, from, to)));
      const fees = {};
      const hooks = [...new Set([c.hook, c.v2 && c.v2.hook].filter(Boolean))];
      if (hooks.length && swaps.length) {
        // both hooks' fee events carry the coin as the first topic and the fee as the first word
        for (const l of await this.rpc.logs({ address: hooks, topics: [[T.feeTaken, T.feeTaken2]] }, from, to)) {
          const k = l.transactionHash + ":" + addrOf(l.topics[1]);
          (fees[k] = fees[k] || []).push({ index: Number(l.logIndex), fee: BigInt(l.data.slice(0, 66)).toString(), used: false });
        }
      }
      swaps.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex));
      for (const l of swaps) {
        const p = this.pools.get(lc(l.topics[1]));
        if (!p) continue;
        let d;
        try { d = abi.decode(["int128", "int128", "uint160", "uint128", "int24", "uint24"], l.data); } catch { continue; }
        const coinIs0 = p.token < p.pair, coinD = (coinIs0 ? d[0] : d[1]) * (p.scale || 1n), pairD = coinIs0 ? d[1] : d[0];
        const idx = Number(l.logIndex);
        const f = (fees[l.transactionHash + ":" + p.token] || []).find((x) => x.index > idx && !x.used);
        if (f) f.used = true;
        trades.push({ token: p.token, coinId: p.coinId, pair: p.pair, buy: coinD > 0n, coin: (coinD < 0n ? -coinD : coinD).toString(), pairAmt: (pairD < 0n ? -pairD : pairD).toString(), fee: f ? f.fee : "0", block: Number(l.blockNumber), tx: l.transactionHash, index: idx });
      }
      await pmap(trades, 8, async (t) => { t.ts = await this.ts(t.block); t.wallet = await this.from(t.tx); const u = usdOf(t.coin, t.pairAmt, await this.priceFor(t.pair)); t.price = u.price; t.value = u.value; });
    }

    // 3. transfers (balances) and bridge events of our coins
    const deltas = new Map(), bridges = [];
    const toks = [...this.tokens.keys()];
    for (const addrs of chunks(toks, 200)) {
      if (!addrs.length) break;
      for (const l of await this.rpc.logs({ address: addrs, topics: [[T.transfer, T.oftSent, T.oftReceived]] }, from, to)) {
        const token = lc(l.address);
        if (l.topics[0] === T.transfer) {
          const fromA = addrOf(l.topics[1]), toA = addrOf(l.topics[2]), v = BigInt(l.data) * (this.tokens.get(token).scale || 1n);
          if (fromA !== ZERO) deltas.set(token + "|" + fromA, (deltas.get(token + "|" + fromA) || 0n) - v);
          if (toA !== ZERO) deltas.set(token + "|" + toA, (deltas.get(token + "|" + toA) || 0n) + v);
        } else {
          const out = l.topics[0] === T.oftSent;
          const ev = TOKEN.parseLog(l);
          const sc = this.tokens.get(token).scale || 1n;
          bridges.push({ token, coinId: this.tokens.get(token).coinId, dir: out ? "out" : "in", guid: lc(ev.args.guid), eid: Number(out ? ev.args.dstEid : ev.args.srcEid), wallet: lc(out ? ev.args.fromAddress : ev.args.toAddress), sent: out ? (ev.args.amountSentLD * sc).toString() : null, received: (ev.args.amountReceivedLD * sc).toString(), block: Number(l.blockNumber), tx: l.transactionHash, index: Number(l.logIndex) });
        }
      }
    }
    await pmap(bridges, 8, async (b) => { b.ts = await this.ts(b.block); });

    // 4. write everything for this range at once
    await tx(async (db) => {
      for (const t of launches) {
        await db.query(
          `insert into tokens (chain, token, coin_id, creator, pair, pool_id, name, symbol, launch_block, launch_ts, launch_tx, launch_pair_usd, gen, fee_bps, launch_id, metadata_uri)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict (chain, token) do nothing`,
          [c.key, t.token, t.coinId, t.creator, t.pair, t.poolId, t.name, t.symbol, t.block, t.ts, t.tx, t.usd18, t.gen, t.feeBps, t.launchId, t.metadataUri]);
      }
      for (const part of chunks(trades, 500)) {
        const vals = [], params = [];
        part.forEach((t, i) => {
          const o = i * 14;
          vals.push(`(${Array.from({ length: 14 }, (_, k) => "$" + (o + k + 1)).join(",")})`);
          params.push(c.key, t.tx, t.index, t.token, t.coinId, t.wallet, t.buy, t.coin, t.pairAmt, t.fee, t.block, t.ts, t.price, t.value);
        });
        await db.query(`insert into trades (chain, tx, log_index, token, coin_id, wallet, buy, coin_amt, pair_amt, fee, block, ts, price_usd, value_usd) values ${vals.join(",")} on conflict do nothing`, params);
      }
      for (const [k, v] of deltas) {
        if (v === 0n) continue;
        const [token, wallet] = k.split("|");
        await db.query(`insert into balances (chain, token, wallet, balance) values ($1,$2,$3,$4) on conflict (chain, token, wallet) do update set balance = balances.balance + excluded.balance`, [c.key, token, wallet, v.toString()]);
      }
      for (const b of bridges) {
        await db.query(
          `insert into bridges (chain, tx, log_index, token, coin_id, direction, guid, peer_eid, wallet, amount_sent, amount_received, block, ts)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing`,
          [c.key, b.tx, b.index, b.token, b.coinId, b.dir, b.guid, b.eid, b.wallet, b.sent, b.received, b.block, b.ts]);
      }
      await db.query("update chain_state set last_block = $2, updated_at = now() where chain = $1", [c.key, to]);
    });
    return { launches: launches.length, trades: trades.length, transfers: deltas.size, bridges: bridges.length };
  }

  // ---------------------------------------------------------------- loop

  /** Index batches until the chain is caught up or `deadline` (ms) is near. Returns what was done. */
  async catchUp(deadline = Infinity) {
    const c = this.c, done = { from: null, to: null, launches: 0, trades: 0, bridges: 0, caughtUp: false };
    if (Date.now() - (this.lastPrice || 0) > (this.priceEveryMs || 60_000)) { await this.refreshPrices(); this.lastPrice = Date.now(); }
    const head = await this.rpc.blockNumber();
    const safe = head - c.confirmations;
    await q("update chain_state set head_block = $2 where chain = $1", [c.key, head]);
    let from = (await q("select last_block from chain_state where chain = $1", [c.key])).rows[0].last_block + 1;
    while (from <= safe && !this.stopped) {
      if (Date.now() > deadline - 8000) return done; // leave room to finish cleanly
      const to = Math.min(safe, from + this.batch - 1);
      const r = await this.process(from, to);
      if (r.launches || r.trades || r.bridges) this.log.info(`[${c.key}] ${from}-${to}: ${r.launches} launches, ${r.trades} trades, ${r.bridges} bridge events`);
      done.from ??= from; done.to = to; done.launches += r.launches; done.trades += r.trades; done.bridges += r.bridges;
      from = to + 1;
    }
    done.caughtUp = from > safe;
    return done;
  }

  async run() {
    const c = this.c;
    await this.init();
    this.lastPrice = Date.now();
    this.log.info(`[${c.key}] indexing ${c.factory} from block ${c.startBlock}`);
    while (!this.stopped) {
      try {
        const r = await this.catchUp();
        if (r.caughtUp) await sleep(c.pollMs);
      } catch (e) {
        this.log.warn(`[${c.key}] ${e.message}`);
        await sleep(Math.max(5000, c.pollMs));
      }
    }
  }

  stop() { this.stopped = true; }
}

