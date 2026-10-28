import { decodeBase58, encodeBase58 } from "ethers";
import { q, tx } from "./db.js";
import { solUsd } from "./pools.js";

/* The Solana legs of Equo launches (tokens rows with chain 'sol', written by the launch service). Every Equo
   transaction on Solana touches the coin's mint: swaps in its Meteora DAMM v2 pool, transfers, and LayerZero
   bridge sends (burn) and receipts (mint). So per mint this walks the mint's signatures from where it stopped,
   oldest first, and writes from each transaction:
     - balances: each owner's change in the coin (pre/post token balances), scaled to 18 decimals like v2 coins,
     - a trade when the pool's coin vault and SOL vault move opposite ways (coins out and SOL in is a buy),
       with the transaction's fee payer as the wallet,
     - bridges: the OFT program's OFTSent / OFTReceived events (Anchor event CPIs).
   Trades take SOL's USD price when they are indexed. chain_state's 'sol' row holds the last slot indexed. */

const RPC = process.env.EQUO_SOL_RPC || process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const OFT_PROGRAM = "RuyLPEWoYG2b6mGb6nvKotoNhW2F9KdhrjRghaRdGkz";
export const WSOL = "So11111111111111111111111111111111111111112";
// the DAMM v2 pool authority owns every pool's vaults
export const DAMM_POOL_AUTHORITY = "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC";
const SCALE = 10n ** 9n; // 9-decimal amounts stored as 18
const EVENT_IX = "e445a52e51cb9a1d"; // Anchor's event-CPI tag
const EV_SENT = "6cabdb02bd156e6e", EV_RECEIVED = "908170439098c92a";

export async function rpc(method, params) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) });
      if (r.status === 429 && i < 3) { await new Promise((s) => setTimeout(s, 1500 * (i + 1))); continue; }
      const j = await r.json();
      if (j.error) throw new Error(`${method}: ${j.error.message}`);
      return j.result;
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
    }
  }
}

const hex = (b58) => { let h = decodeBase58(b58).toString(16); if (h.length % 2) h = "0" + h; return h; };
const u32le = (h, o) => Buffer.from(h.slice(o * 2, o * 2 + 8), "hex").readUInt32LE(0);
const u64le = (h, o) => Buffer.from(h.slice(o * 2, o * 2 + 16), "hex").readBigUInt64LE(0);
/** A 32-byte key as base58 (ethers drops leading zero bytes; base58 writes each as "1"). */
export const b58 = (bytes) => { const b = Buffer.from(bytes); let z = 0; while (z < b.length && b[z] === 0) z++; return "1".repeat(z) + (z < b.length ? encodeBase58(b.subarray(z)) : ""); };
const key = (h, o) => b58(Buffer.from(h.slice(o * 2, o * 2 + 64), "hex"));

/** OFTSent / OFTReceived from an OFT event CPI's data. decodeBase58 drops leading zero bytes, so the hex is
 *  padded back to the event's full length first. */
function oftEvent(data) {
  let h = hex(data);
  for (const [disc, len] of [[EV_SENT, 8 + 8 + 32 + 4 + 32 + 8 + 8], [EV_RECEIVED, 8 + 8 + 32 + 4 + 32 + 8]]) {
    const p = h.padStart(len * 2, "0");
    if (p.slice(0, 16) !== EVENT_IX || p.slice(16, 32) !== disc) continue;
    const g = "0x" + p.slice(32, 96), eid = u32le(p, 48), who = key(p, 52);
    if (disc === EV_SENT) return { dir: "out", guid: g, eid, wallet: who, sent: u64le(p, 84), received: u64le(p, 92) };
    return { dir: "in", guid: g, eid, wallet: who, sent: null, received: u64le(p, 84) };
  }
  return null;
}

/** What one transaction did to a Solana leg (`t`: its tokens row; `v`: its pool's vaults): each owner's change in
 *  the coin, a trade when the pool's two vaults move opposite ways, and LayerZero bridge events. */
export function parseTx(t, v, r, sig, usd18) {
  const keys = [...r.transaction.message.accountKeys, ...((r.meta.loadedAddresses || {}).writable || []), ...((r.meta.loadedAddresses || {}).readonly || [])];
  const ts = r.blockTime || Math.floor(Date.now() / 1000);
  // per token account: its owner and change, for the coin and for SOL
  const acct = new Map();
  for (const [list, sign] of [[r.meta.preTokenBalances || [], -1n], [r.meta.postTokenBalances || [], 1n]]) {
    for (const b of list) {
      if (b.mint !== t.token && b.mint !== WSOL) continue;
      const k = keys[b.accountIndex], e = acct.get(k) || { mint: b.mint, owner: b.owner, d: 0n };
      e.d += sign * BigInt(b.uiTokenAmount.amount);
      acct.set(k, e);
    }
  }
  const deltas = new Map();
  for (const e of acct.values()) if (e.mint === t.token && e.d !== 0n) deltas.set(e.owner, (deltas.get(e.owner) || 0n) + e.d * SCALE);
  let trade = null;
  const cv = v && acct.get(v.coin), sv = v && acct.get(v.sol);
  if (cv && sv && cv.d !== 0n && sv.d !== 0n && (cv.d < 0n) !== (sv.d < 0n)) {
    const buy = cv.d < 0n, coin = (buy ? -cv.d : cv.d) * SCALE, pair = (buy ? sv.d : -sv.d) * SCALE;
    const u = usd18 ? Number(usd18) / 1e18 : null;
    trade = { tx: sig, index: 0, wallet: keys[0], buy, coin: coin.toString(), pair: pair.toString(), fee: ((pair * BigInt(t.fee_bps || 100)) / 10000n).toString(), block: r.slot, ts,
      price: u ? (Number(pair) / Number(coin)) * u : null, value: u ? (Number(pair) / 1e18) * u : null };
  }
  const bridges = [];
  let i = 0;
  for (const g of r.meta.innerInstructions || []) {
    for (const ix of g.instructions) {
      if (keys[ix.programIdIndex] !== OFT_PROGRAM) continue;
      const ev = oftEvent(ix.data);
      if (!ev) continue;
      // OFTSent names the token account the coins left; the wallet is that account's owner
      if (ev.dir === "out") { const a = acct.get(ev.wallet); if (a) ev.wallet = a.owner; }
      bridges.push({ ...ev, tx: sig, index: i++, block: r.slot, ts });
    }
  }
  return { trade, bridges, deltas };
}

export class SolanaIndexer {
  constructor(log = console) { this.log = log; this.vaults = new Map(); }

  async init() {
    await q("create table if not exists sol_cursor (mint text primary key, last_sig text, last_slot bigint)");
    await q("insert into chain_state (chain, last_block, factory) values ('sol', 0, 'solana') on conflict (chain) do nothing");
  }

  /** The pool's coin vault and SOL vault (cp-amm Pool: token_a_vault at 232, token_b_vault at 264). */
  async vaultsOf(pool) {
    if (!this.vaults.has(pool)) {
      const a = await rpc("getAccountInfo", [pool, { encoding: "base64" }]);
      if (!a || !a.value) return null;
      const d = Buffer.from(a.value.data[0], "base64");
      this.vaults.set(pool, { coin: b58(d.subarray(232, 264)), sol: b58(d.subarray(264, 296)) });
    }
    return this.vaults.get(pool);
  }

  /** New signatures of `mint` since `until`, oldest first (at most `max`, the oldest ones when there are more). */
  async newSigs(mint, until, max = 300) {
    const all = [];
    let before;
    for (;;) {
      const page = await rpc("getSignaturesForAddress", [mint, { limit: 1000, commitment: "confirmed", ...(until ? { until } : {}), ...(before ? { before } : {}) }]);
      all.push(...page);
      if (page.length < 1000) break;
      before = page[page.length - 1].signature;
    }
    return all.reverse().filter((s) => !s.err).slice(0, max);
  }

  async process(t, sigs, usd18) {
    const v = await this.vaultsOf(t.pool_id);
    const trades = [], bridges = [], deltas = new Map();
    let lastSlot = 0;
    for (const s of sigs) {
      const r = await rpc("getTransaction", [s.signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
      if (!r || r.meta.err) continue;
      lastSlot = Math.max(lastSlot, r.slot);
      const x = parseTx(t, v, r, s.signature, usd18);
      if (x.trade) trades.push(x.trade);
      bridges.push(...x.bridges);
      for (const [w, d] of x.deltas) deltas.set(w, (deltas.get(w) || 0n) + d);
    }
    await tx(async (db) => {
      for (const x of trades) {
        await db.query(`insert into trades (chain, tx, log_index, token, coin_id, wallet, buy, coin_amt, pair_amt, fee, block, ts, price_usd, value_usd)
          values ('sol',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing`,
          [x.tx, x.index, t.token, t.coin_id, x.wallet, x.buy, x.coin, x.pair, x.fee, x.block, x.ts, x.price, x.value]);
      }
      for (const [wallet, d] of deltas) {
        if (d === 0n) continue;
        await db.query(`insert into balances (chain, token, wallet, balance) values ('sol',$1,$2,$3) on conflict (chain, token, wallet) do update set balance = balances.balance + excluded.balance`, [t.token, wallet, d.toString()]);
      }
      for (const b of bridges) {
        await db.query(`insert into bridges (chain, tx, log_index, token, coin_id, direction, guid, peer_eid, wallet, amount_sent, amount_received, block, ts)
          values ('sol',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict do nothing`,
          [b.tx, b.index, t.token, t.coin_id, b.dir, b.guid, b.eid, b.wallet, b.sent == null ? null : (b.sent * SCALE).toString(), (b.received * SCALE).toString(), b.block, b.ts]);
      }
      const last = sigs[sigs.length - 1];
      await db.query(`insert into sol_cursor (mint, last_sig, last_slot) values ($1,$2,$3) on conflict (mint) do update set last_sig = excluded.last_sig, last_slot = excluded.last_slot`, [t.token, last.signature, last.slot]);
      await db.query("update chain_state set last_block = greatest(last_block, $1), updated_at = now() where chain = 'sol'", [lastSlot || last.slot]);
    });
    return { trades: trades.length, bridges: bridges.length, transfers: deltas.size };
  }

  /** Every Solana leg, until each is caught up or `deadline` (ms) is near. */
  async catchUp(deadline = Infinity) {
    const done = { trades: 0, bridges: 0, caughtUp: true };
    const head = await rpc("getSlot", [{ commitment: "confirmed" }]);
    await q("update chain_state set head_block = $1 where chain = 'sol'", [head]);
    const usd = await solUsd();
    const usd18 = usd ? BigInt(Math.round(usd * 1e6)) * 10n ** 12n : null;
    if (usd18) await q("insert into pair_prices (chain, pair, ts, usd18) values ('sol', $1, $2, $3) on conflict do nothing", [WSOL, Math.floor(Date.now() / 60000) * 60, usd18.toString()]);
    const toks = (await q("select t.token, t.coin_id, t.pool_id, t.fee_bps, c.last_sig from tokens t left join sol_cursor c on c.mint = t.token where t.chain = 'sol' order by t.launch_ts")).rows;
    for (const t of toks) {
      for (;;) {
        if (Date.now() > deadline - 8000) { done.caughtUp = false; return done; }
        const sigs = await this.newSigs(t.token, t.last_sig, 25);
        if (!sigs.length) break;
        const r = await this.process(t, sigs, usd18 ? usd18.toString() : null);
        done.trades += r.trades; done.bridges += r.bridges;
        t.last_sig = sigs[sigs.length - 1].signature;
        if (sigs.length < 25) break;
      }
    }
    // with nothing new anywhere, the index is current up to the head
    if (done.caughtUp) await q("update chain_state set last_block = $1, updated_at = now() where chain = 'sol'", [head]);
    return done;
  }
}
