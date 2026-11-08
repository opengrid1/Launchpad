// GET /api/state: every coin launched on Zappy (Ethereum) with its pool price, floor, holders and trades, built from
// event logs (the factory's launches, the hook's taxes and floor moves, the PoolManager's swaps on our pools, the
// tokens' transfers) plus a few live reads (slot0, floorOf, total supply, Chainlink ETH/USD). A warm instance keeps the
// logs and only reads new blocks; a snapshot in the Blob store lets a cold instance resume instead of rereading from the
// deploy block. The CDN caches the answer for a few seconds so visitors never hit the RPC.
const Z = require('./_zlib');
const { ethers, NET, rpc, multicall, keyOf, I } = Z;

const ev = (s) => ethers.id(s);
const T = {
  launched: ev('TokenLaunched(address,bytes32,address,address,int24,uint256,string,string,string)'),
  tax: ev('TaxPaid(bytes32,address,bool,uint256,uint256,uint256,uint256,uint256)'),
  raised: ev('FloorRaised(bytes32,int24,uint160,uint256,uint256)'),
  collected: ev('FloorCollected(bytes32,uint16,uint256,uint256,address,int24,uint256)'),
  bought: ev('BoughtBack(bytes32,uint256,uint160)'),
  swept: ev('FloorSwept(bytes32,uint256,bool)'),
  swap: ev('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'),
  init: ev('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'),
  transfer: ev('Transfer(address,address,uint256)'),
};
const AC = ethers.AbiCoder.defaultAbiCoder();
const dec = (types, data) => AC.decode(types, data);
const addrOf = (topic) => ethers.getAddress('0x' + topic.slice(26)).toLowerCase();
const f18 = (v) => Number(ethers.formatEther(v));
const Q96 = 2 ** 96;
const low = (a) => String(a || '').toLowerCase();
const byOrder = (a, b) => (parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16)) || (parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16));
const SYSTEM = new Set([NET.poolManager, NET.hook, NET.factory, NET.burner, NET.vesting].map(low));

// the cache a warm instance keeps between requests
const S = { last: NET.fromBlock - 1, skew: 0, fac: [], hook: [], pm: [], transfers: [], tokens: new Map(), byPool: new Map(), live: {}, ethUsd: 0, pending: null, at: 0, loaded: false, savedAt: 0, savedLast: 0 };
const SNAP_KEYS = ['last', 'skew', 'fac', 'hook', 'pm', 'transfers'];

async function logsRange(filter, from, to) {
  try { return await rpc('eth_getLogs', [{ ...filter, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]); }
  catch (e) { if (to - from < 200) throw e; const mid = Math.floor((from + to) / 2); return [...(await logsRange(filter, from, mid)), ...(await logsRange(filter, mid + 1, to))]; }
}
// log timestamps: one header read per block seen
const blockTs = new Map();
async function stamp(logs) {
  const need = [...new Set(logs.filter((l) => !l.blockTimestamp).map((l) => l.blockNumber))].filter((n) => !blockTs.has(n));
  await Promise.all(need.map(async (n) => { const b = await rpc('eth_getBlockByNumber', [n, false]); blockTs.set(n, b.timestamp); }));
  for (const l of logs) if (!l.blockTimestamp) l.blockTimestamp = blockTs.get(l.blockNumber);
  return logs;
}

async function loadSnapshot() {
  S.loaded = true; if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { list } = require('@vercel/blob'); const { blobs } = await list({ prefix: 'zappy-floor/state-' });
    const best = blobs.map((b) => ({ b, n: Number((b.pathname.match(/-(\d+)\.json$/) || [])[1] || 0) })).sort((x, y) => y.n - x.n)[0];
    if (!best || best.n <= S.last) return;
    const j = await (await fetch(best.b.url, { cache: 'no-store' })).json();
    if (j.v !== 1 || j.factory !== NET.factory) return;
    for (const k of SNAP_KEYS) S[k] = j.s[k];
    S.tokens = new Map(j.s.tokens.map((t) => [t.addr, t])); S.byPool = new Map([...S.tokens.values()].map((t) => [t.poolId, t]));
    S.savedLast = S.last;
  } catch (e) { console.warn('snapshot load', e.message); }
}
async function saveSnapshot() {
  if (!process.env.BLOB_READ_WRITE_TOKEN || S.last <= S.savedLast || Date.now() - S.savedAt < 120000) return;
  S.savedAt = Date.now();
  try {
    const { put, list, del } = require('@vercel/blob');
    const body = JSON.stringify({ v: 1, factory: NET.factory, s: { ...Object.fromEntries(SNAP_KEYS.map((k) => [k, S[k]])), tokens: [...S.tokens.values()] } });
    await put(`zappy-floor/state-${S.last}.json`, body, { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
    S.savedLast = S.last;
    const { blobs } = await list({ prefix: 'zappy-floor/state-' }); const old = blobs.filter((b) => !b.pathname.endsWith(`-${S.last}.json`)).map((b) => b.url); if (old.length) await del(old);
  } catch (e) { console.warn('snapshot save', e.message); }
}

const within = (p, ms, what) => { let t; return Promise.race([p.finally(() => clearTimeout(t)), new Promise((r) => { t = setTimeout(() => { console.warn(what, 'timed out'); r(); }, ms); })]); };
async function sync(deadline = Date.now() + 40000) {
  if (!S.loaded) await within(loadSnapshot(), 8000, 'snapshot load');
  const hb = await rpc('eth_getBlockByNumber', ['latest', false]);
  const head = parseInt(hb.number, 16); S.skew = parseInt(hb.timestamp, 16) - Math.floor(Date.now() / 1000);
  for (let n = 0; n < 12 && S.last < head && Date.now() < deadline; n++) {
    const from = S.last + 1, to = Math.min(head, from + 40000 - 1);
    await syncRange(from, to); S.last = to;
  }
  await refreshLive();
  await within(saveSnapshot(), 8000, 'snapshot save');
}
async function syncRange(from, to) {
  const core = await stamp(await logsRange({ address: [NET.factory, NET.hook] }, from, to));
  const fac = core.filter((l) => low(l.address) === low(NET.factory)).sort(byOrder), hook = core.filter((l) => low(l.address) === low(NET.hook));
  for (const l of fac) {
    if (l.topics[0] !== T.launched) continue;
    const [quote, tickStart, devBuy, name, ticker, uri] = dec(['address', 'int24', 'uint256', 'string', 'string', 'string'], l.data);
    const t = { addr: addrOf(l.topics[1]), poolId: l.topics[2], creator: addrOf(l.topics[3]), quote: low(quote), tickStart: Number(tickStart), devBuy: devBuy.toString(), name, ticker, uri, createdAt: parseInt(l.blockTimestamp, 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash };
    S.tokens.set(t.addr, t); S.byPool.set(t.poolId, t);
  }
  S.fac.push(...fac); S.hook.push(...hook);
  const pools = [...S.byPool.keys()], addrs = [...S.tokens.keys()];
  if (pools.length) {
    for (let i = 0; i < pools.length; i += 100) S.pm.push(...await stamp(await logsRange({ address: NET.poolManager, topics: [[T.init, T.swap], pools.slice(i, i + 100)] }, from, to)));
    for (let i = 0; i < addrs.length; i += 100) S.transfers.push(...await logsRange({ address: addrs.slice(i, i + 100), topics: [T.transfer] }, from, to));
  }
  for (const k of ['pm', 'transfers', 'hook']) S[k].sort(byOrder);
}
// live reads: each pool's slot0 and floor, each token's supply, the ETH price
async function refreshLive() {
  const toks = [...S.tokens.values()];
  const calls = [[NET.ethUsdFeed, I.feed, 'latestRoundData']];
  for (const t of toks) calls.push([NET.stateView, I.stateView, 'getSlot0', [t.poolId]], [NET.hook, I.hook, 'floorOf', [keyOf(t.addr)]], [t.addr, I.erc20, 'totalSupply']);
  const r = await multicall(calls);
  if (r[0]) S.ethUsd = Number(r[0][1]) / 1e8;
  let i = 1;
  for (const t of toks) {
    const s0 = r[i++], fl = r[i++], sup = r[i++];
    S.live[t.addr] = { sqrt: s0 ? s0[0].toString() : null, tick: s0 ? Number(s0[1]) : null, floorTick: fl ? Number(fl[0]) : null, floorSqrt: fl ? fl[1].toString() : null, circulating: fl ? f18(fl[2]) : null, supply: sup != null ? f18(sup) : 1e9 };
  }
  // the metadata behind each new coin's URI (a JSON from /api/meta, or a bare image URL), read once
  await Promise.all(toks.filter((t) => !t.meta && t.uri).map(async (t) => {
    try {
      const r = await fetch(t.uri, { signal: AbortSignal.timeout(6000) });
      const ct = r.headers.get('content-type') || '';
      if (ct.startsWith('image/')) { t.meta = { image: t.uri }; return; }
      const j = await r.json(); t.meta = { image: String(j.image || ''), description: String(j.description || '').slice(0, 500), x: String(j.x || ''), telegram: String(j.telegram || ''), website: String(j.website || '') };
    } catch { t.meta = { image: /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(t.uri) ? t.uri : '' }; }
  }));
}

const pxOf = (sqrt) => { const s = Number(sqrt) / Q96; return s > 0 ? 1 / (s * s) : 0; }; // ETH per token: the pool prices tokens per ETH
function build() {
  const PM = low(NET.poolManager), HK = low(NET.hook);
  const txT = new Map(); const bal = {};
  for (const l of S.transfers) {
    const tok = low(l.address), from = addrOf(l.topics[1]), to = addrOf(l.topics[2]), v = BigInt(l.data);
    (txT.get(l.transactionHash) || txT.set(l.transactionHash, []).get(l.transactionHash)).push({ tok, from, to, v });
    const b = bal[tok] || (bal[tok] = {}); if (from !== ethers.ZeroAddress) b[from] = (b[from] || 0n) - v; b[to] = (b[to] || 0n) + v;
  }
  // the hook's TaxPaid logs per tx and pool, in order: a buy's precedes its Swap, a sell's follows it; the hook's own
  // buyback swaps (sender = hook) carry none
  const taxes = new Map();
  for (const l of S.hook) if (l.topics[0] === T.tax) (taxes.get(l.transactionHash + l.topics[1]) || taxes.set(l.transactionHash + l.topics[1], []).get(l.transactionHash + l.topics[1])).push(l);
  const trades = [], raises = {}, events = {};
  for (const l of S.pm) {
    if (l.topics[0] !== T.swap) continue;
    const id = l.topics[1], t = S.byPool.get(id); if (!t) continue;
    const sender = addrOf(l.topics[2]);
    const [a0, a1, sq] = dec(['int128', 'int128', 'uint160', 'uint128', 'int24', 'uint24'], l.data);
    if (sender === HK) { trades.push({ t: t.addr, tx: l.transactionHash, w: HK, b: 1, bb: 1, eth: f18(a0 < 0n ? -a0 : a0), tok: f18(a1 > 0n ? a1 : -a1), tax: 0, p: pxOf(sq), ts: parseInt(l.blockTimestamp, 16), blk: parseInt(l.blockNumber, 16) }); continue; }
    const buy = a0 < 0n;
    const tx = taxes.get(l.transactionHash + id) || [], tl = tx.shift();
    const [, vol, toF, toC, toT, toB] = tl ? dec(['bool', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'], tl.data) : [0, 0n, 0n, 0n, 0n, 0n];
    const tax = f18(toF + toC + toT + toB), gross = tl ? f18(vol) : f18(buy ? -a0 : a0);
    const tt = (txT.get(l.transactionHash) || []).filter((x) => x.tok === t.addr);
    let w = '';
    if (buy) { const out = tt.filter((x) => x.from === PM && x.to !== HK).sort((x, y) => (y.v > x.v ? 1 : -1))[0]; w = out ? out.to : ''; const hop = out && tt.find((x) => x.from === out.to && x.to !== PM && x.to !== HK); if (hop) w = hop.to; }
    else { const inn = tt.find((x) => x.to === PM); w = inn ? inn.from : ''; }
    // eth: what the trader paid (buy, tax included) or received (sell, tax taken); tok: tokens moved
    trades.push({ t: t.addr, tx: l.transactionHash, w, b: buy ? 1 : 0, eth: buy ? gross : gross - tax, tok: f18(buy ? a1 : -a1), tax, p: pxOf(sq), ts: parseInt(l.blockTimestamp, 16), blk: parseInt(l.blockNumber, 16) });
  }
  for (const l of S.hook) {
    const t = S.byPool.get(l.topics[1]); if (!t) continue; const ts = parseInt(l.blockTimestamp, 16);
    if (l.topics[0] === T.raised) { const [tickF, sq, q, circ] = dec(['int24', 'uint160', 'uint256', 'uint256'], l.data); (raises[t.addr] || (raises[t.addr] = [])).push({ ts, tick: Number(tickF), p: pxOf(sq), eth: f18(q), circ: f18(circ) }); }
    else if (l.topics[0] === T.collected) { const [bps, q, , tickF, qIn] = dec(['uint16', 'uint256', 'uint256', 'int24', 'uint256'], l.data); (events[t.addr] || (events[t.addr] = [])).push({ kind: 'collect', ts, bps: Number(bps), eth: f18(q), tick: Number(tickF), floorEth: f18(qIn), tx: l.transactionHash }); }
    else if (l.topics[0] === T.bought) { const [burned] = dec(['uint256', 'uint160'], l.data); (events[t.addr] || (events[t.addr] = [])).push({ kind: 'buyback', ts, tok: f18(burned), tx: l.transactionHash }); }
  }
  const tokens = [...S.tokens.values()].map((t) => {
    const lv = S.live[t.addr] || {}, b = bal[t.addr] || {};
    const holders = Object.entries(b).filter(([w, v]) => v > 0n && !SYSTEM.has(w)).map(([w, v]) => [w, f18(v)]).sort((x, y) => y[1] - x[1]).slice(0, 300);
    const startSqrt = Math.pow(1.0001, t.tickStart / 2) * Q96;
    return { ...t, sqrt: lv.sqrt, tick: lv.tick, p: lv.sqrt ? pxOf(lv.sqrt) : pxOf(startSqrt), p0: pxOf(startSqrt), floorTick: lv.floorTick, floorP: lv.floorSqrt ? pxOf(lv.floorSqrt) : 0, circulating: lv.circulating, supply: lv.supply || 1e9,
      holders, holderCount: Object.entries(b).filter(([w, v]) => v > 0n && !SYSTEM.has(w)).length, vesting: f18(b[low(NET.vesting)] || 0n), raises: raises[t.addr] || [], events: events[t.addr] || [] };
  });
  return { chainId: 1, block: S.last, at: Math.floor(Date.now() / 1000), skew: S.skew, ethUsd: S.ethUsd, zappy: low(NET.zappy), contracts: { factory: low(NET.factory), hook: low(NET.hook), router: low(NET.router), quoter: low(NET.quoter), permit2: low(NET.permit2), poolManager: PM }, tokens, trades };
}

module.exports = async (req, res) => {
  try {
    if (!S.pending && Date.now() - S.at > 2500) S.pending = sync().then(() => { S.at = Date.now(); }).finally(() => { S.pending = null; });
    if (S.pending) await S.pending;
    Z.json(res, 200, build(), 'public, max-age=0, s-maxage=3, stale-while-revalidate=30');
  } catch (e) { Z.json(res, 503, { error: e.message }); }
};
module.exports.S = S; module.exports.sync = sync; module.exports.build = build;
