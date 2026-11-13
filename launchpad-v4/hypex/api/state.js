// GET /api/state?chain=elysium|hyperevm: every Hypex coin on that chain with its pool price, floor, holders and trades,
// the trader airdrops and the bridge transfers, built from event logs (the factory's launches; the hook's taxes, floor
// moves and bridged floor money; the PoolManager's swaps on our pools; the tokens' transfers; HypexRevenue's airdrops
// and claims; HypexBridge's sends and deliveries) plus a few live reads (each pool's price and floor, each coin's
// supply here). A warm instance keeps the logs per chain and only reads new blocks. The CDN caches the answer for a few
// seconds so visitors never hit the RPC.
const X = require('./_hx');
const { ethers, NETS, rpc, multicall, keyOf, I } = X;

const ev = (s) => ethers.id(s);
const T = {
  launched: ev('TokenLaunched(address,bytes32,address,address,int24,uint256,string,string,string)'),
  remote: ev('RemoteRecorded(address,uint16,address)'),
  tax: ev('TaxPaid(bytes32,address,bool,uint256,uint256,uint256,uint256,uint256)'),
  raised: ev('FloorRaised(bytes32,int24,uint160,uint256,uint256)'),
  bought: ev('BoughtBack(bytes32,uint256,uint160)'),
  swept: ev('FloorSwept(bytes32,uint256,bool)'),
  collected: ev('LiquidityCollected(bytes32,uint256,uint256,address)'),
  floorBridged: ev('FloorBridged(bytes32,uint256,uint256,bool)'),
  swap: ev('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'),
  transfer: ev('Transfer(address,address,uint256)'),
  airdropped: ev('Airdropped(address,address,uint256)'),
  claimed: ev('RevenueClaimed(address,address,uint256)'),
  sent: ev('Sent(address,address,address,uint16,uint256,uint256,uint64)'),
  received: ev('Received(address,address,uint16,uint256,uint256,bytes32)'),
};
const AC = ethers.AbiCoder.defaultAbiCoder();
const dec = (types, data) => AC.decode(types, data);
const addrOf = (topic) => ethers.getAddress('0x' + topic.slice(26)).toLowerCase();
const f18 = (v) => Number(ethers.formatEther(v));
const Q96 = 2 ** 96;
const low = (a) => String(a || '').toLowerCase();
const byOrder = (a, b) => (parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16)) || (parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16));
const pxOf = (sqrt) => { const s = Number(sqrt) / Q96; return s > 0 ? 1 / (s * s) : 0; }; // HYPE per token: the pool prices tokens per HYPE

// the cache a warm instance keeps between requests, per chain
const SS = {};
const stateOf = (N) => SS[N.key] || (SS[N.key] = { last: (N.fromBlock || 1) - 1, skew: 0, fac: [], hook: [], pm: [], transfers: [], rev: [], br: [], tokens: new Map(), byPool: new Map(), live: {}, pending: null, at: 0, blockTs: new Map() });

// one chunk at a time, never wider than the chain's RPC allows (N.logRange); a chunk that still fails is retried as
// two halves at once instead of the same request again and again
async function logsRange(N, filter, from, to) {
  const span = N.logRange || 10000;
  if (to - from + 1 > span) { const out = []; for (let a = from; a <= to; a += span) out.push(...await logsRange(N, filter, a, Math.min(to, a + span - 1))); return out; }
  try { return await rpc(N, 'eth_getLogs', [{ ...filter, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }], to - from < 200 ? 8 : 3); }
  catch (e) { if (to - from < 200) throw e; const mid = Math.floor((from + to) / 2); return [...(await logsRange(N, filter, from, mid)), ...(await logsRange(N, filter, mid + 1, to))]; }
}

// the index survives cold starts: a snapshot per chain in the site's public Blob store (the same data the API serves),
// read once by a fresh instance and written after a sync moves it forward, so no instance rescans from the deploy block
const SNAP = (N) => `hypex/state/${N.key}-${low(N.factory).slice(2, 10)}.json`;
async function loadSnap(N, S) {
  if (S.loaded || !process.env.BLOB_READ_WRITE_TOKEN) { S.loaded = true; return; }
  S.loaded = true;
  try {
    const { head } = require('@vercel/blob'); const h = await head(SNAP(N));
    const j = await (await fetch(h.url + '?t=' + Date.now(), { signal: AbortSignal.timeout(8000) })).json();
    if (!j || !(j.last > S.last)) return;
    for (const k of ['fac', 'hook', 'pm', 'transfers', 'rev', 'br']) S[k] = j[k] || [];
    S.remotes = j.remotes || {}; S.blockTs = new Map(j.blockTs || []); S.tokens = new Map((j.tokens || []).map((t) => [t.addr, t])); S.byPool = new Map([...S.tokens.values()].map((t) => [t.poolId, t]));
    S.last = j.last; S.saved = j.last;
  } catch {} // none yet (or unreadable): index from the deploy block
}
async function saveSnap(N, S) {
  if (!process.env.BLOB_READ_WRITE_TOKEN || S.last <= (S.saved || 0) || Date.now() - (S.savedAt || 0) < 20000) return;
  S.savedAt = Date.now();
  try {
    const { put } = require('@vercel/blob'), last = S.last;
    const body = JSON.stringify({ last, fac: S.fac, hook: S.hook, pm: S.pm, transfers: S.transfers, rev: S.rev, br: S.br, remotes: S.remotes || {}, blockTs: [...S.blockTs].slice(-5000), tokens: [...S.tokens.values()] });
    await put(SNAP(N), body, { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
    S.saved = last;
  } catch {}
}
async function stamp(N, S, logs) {
  const need = [...new Set(logs.filter((l) => !l.blockTimestamp).map((l) => l.blockNumber))].filter((n) => !S.blockTs.has(n));
  await Promise.all(need.map(async (n) => { const b = await rpc(N, 'eth_getBlockByNumber', [n, false]); S.blockTs.set(n, b.timestamp); }));
  for (const l of logs) if (!l.blockTimestamp) l.blockTimestamp = S.blockTs.get(l.blockNumber);
  return logs;
}

async function sync(N, S, deadline = Date.now() + 20000) {
  await loadSnap(N, S);
  const hb = await rpc(N, 'eth_getBlockByNumber', ['latest', false]);
  const head = parseInt(hb.number, 16); S.skew = parseInt(hb.timestamp, 16) - Math.floor(Date.now() / 1000);
  if (S.last < 0) S.last = Math.max(0, head - 1); // no deploy block configured: from now on
  // a catch-up runs in steps until the deadline; the next request (the site polls every few seconds) carries on
  const step = (N.logRange || 10000) * 4;
  for (let n = 0; n < 40 && S.last < head && Date.now() < deadline; n++) {
    const from = S.last + 1, to = Math.min(head, from + step - 1);
    await syncRange(N, S, from, to); S.last = to;
  }
  await refreshLive(N, S);
  await saveSnap(N, S);
}
async function syncRange(N, S, from, to) {
  const core = await stamp(N, S, await logsRange(N, { address: [N.factory, N.hook, N.revenue, N.bridge] }, from, to));
  const by = (a) => core.filter((l) => low(l.address) === low(a)).sort(byOrder);
  const fac = by(N.factory), hook = by(N.hook);
  for (const l of fac) {
    if (l.topics[0] === T.remote) { (S.remotes || (S.remotes = {}))[addrOf(l.topics[1])] = { ...((S.remotes || {})[addrOf(l.topics[1])] || {}), [Number(l.topics[2])]: low(dec(['address'], l.data)[0]) }; continue; }
    if (l.topics[0] !== T.launched) continue;
    const [, tickStart, devBuy, name, ticker, uri] = dec(['address', 'int24', 'uint256', 'string', 'string', 'string'], l.data);
    const t = { addr: addrOf(l.topics[1]), poolId: l.topics[2], creator: addrOf(l.topics[3]), tickStart: Number(tickStart), devBuy: f18(devBuy), name, ticker, uri, createdAt: parseInt(l.blockTimestamp, 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash };
    S.tokens.set(t.addr, t); S.byPool.set(t.poolId, t);
  }
  S.fac.push(...fac); S.hook.push(...hook); S.rev.push(...by(N.revenue)); S.br.push(...by(N.bridge));
  const pools = [...S.byPool.keys()], addrs = [...S.tokens.keys()];
  if (pools.length) {
    for (let i = 0; i < pools.length; i += 100) S.pm.push(...await stamp(N, S, await logsRange(N, { address: N.poolManager, topics: [[T.swap], pools.slice(i, i + 100)] }, from, to)));
    for (let i = 0; i < addrs.length; i += 100) S.transfers.push(...await logsRange(N, { address: addrs.slice(i, i + 100), topics: [T.transfer] }, from, to));
  }
  for (const k of ['pm', 'transfers', 'hook', 'rev', 'br']) S[k].sort(byOrder);
}
// live reads: each pool's slot0 (PoolManager.extsload of its Pool.State slot) and floor, each coin's supply here
async function refreshLive(N, S) {
  const toks = [...S.tokens.values()], calls = [];
  for (const t of toks) {
    const slot = ethers.keccak256(AC.encode(['bytes32', 'uint256'], [t.poolId, 6n])); // StateLibrary: pools mapping at slot 6
    calls.push([N.poolManager, I.pm, 'extsload', [slot]], [N.hook, I.hook, 'floorOf', [keyOf(N.key, t.addr)]], [t.addr, I.erc20, 'totalSupply']);
  }
  const r = calls.length ? await multicall(N, calls) : [];
  let i = 0;
  for (const t of toks) {
    const s0 = r[i++], fl = r[i++], sup = r[i++];
    const word = s0 ? BigInt(s0) : 0n, sqrt = word & ((1n << 160n) - 1n);
    let tick = Number((word >> 160n) & 0xffffffn); if (tick >= 0x800000) tick -= 0x1000000;
    S.live[t.addr] = { sqrt: sqrt ? sqrt.toString() : null, tick: sqrt ? tick : null, floorTick: fl ? Number(fl[0]) : null, floorSqrt: fl ? fl[1].toString() : null, circulating: fl ? f18(fl[2]) : null, supply: sup != null ? f18(sup) : 1e9 };
  }
  // the metadata behind each new coin's URI (a JSON from /api/meta, or a bare image URL), read once
  await Promise.all(toks.filter((t) => !t.meta && t.uri).map(async (t) => {
    try {
      const res = await fetch(t.uri, { signal: AbortSignal.timeout(6000) });
      if ((res.headers.get('content-type') || '').startsWith('image/')) { t.meta = { image: t.uri }; return; }
      const j = await res.json(); t.meta = { image: String(j.image || ''), description: String(j.description || '').slice(0, 500), x: String(j.x || ''), telegram: String(j.telegram || ''), website: String(j.website || '') };
    } catch { t.meta = { image: /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(t.uri) ? t.uri : '' }; }
  }));
}

function build(N, S) {
  const PM = low(N.poolManager), HK = low(N.hook), SYSTEM = new Set([N.poolManager, N.hook, N.factory, N.burner, N.vesting, N.bridge, ethers.ZeroAddress].map(low));
  const txT = new Map(), bal = {};
  for (const l of S.transfers) {
    const tok = low(l.address), from = addrOf(l.topics[1]), to = addrOf(l.topics[2]), v = BigInt(l.data);
    (txT.get(l.transactionHash) || txT.set(l.transactionHash, []).get(l.transactionHash)).push({ tok, from, to, v });
    const b = bal[tok] || (bal[tok] = {}); if (from !== ethers.ZeroAddress) b[from] = (b[from] || 0n) - v; if (to !== ethers.ZeroAddress) b[to] = (b[to] || 0n) + v;
  }
  // a buy's TaxPaid precedes its Swap, a sell's follows it; the hook's own buyback swaps carry none
  const taxes = new Map();
  for (const l of S.hook) if (l.topics[0] === T.tax) { const k = l.transactionHash + l.topics[1]; (taxes.get(k) || taxes.set(k, []).get(k)).push(l); }
  const trades = [], raises = {}, events = {};
  for (const l of S.pm) {
    if (l.topics[0] !== T.swap) continue;
    const id = l.topics[1], t = S.byPool.get(id); if (!t) continue;
    const sender = addrOf(l.topics[2]);
    const [a0, a1, sq] = dec(['int128', 'int128', 'uint160', 'uint128', 'int24', 'uint24'], l.data);
    const ts = parseInt(l.blockTimestamp, 16), blk = parseInt(l.blockNumber, 16);
    if (sender === HK) { trades.push({ t: t.addr, tx: l.transactionHash, w: HK, b: 1, bb: 1, h: f18(a0 < 0n ? -a0 : a0), k: f18(a1 > 0n ? a1 : -a1), tax: 0, p: pxOf(sq), ts, blk }); continue; }
    const buy = a0 < 0n, tx = taxes.get(l.transactionHash + id) || [], tl = tx.shift();
    const [, vol, toF, toC, toT, toB] = tl ? dec(['bool', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'], tl.data) : [0, 0n, 0n, 0n, 0n, 0n];
    const tax = f18(toF + toC + toT + toB), gross = tl ? f18(vol) : f18(buy ? -a0 : a0);
    const tt = (txT.get(l.transactionHash) || []).filter((x) => x.tok === t.addr);
    let w = '';
    if (buy) { const out = tt.filter((x) => x.from === PM && x.to !== HK).sort((x, y) => (y.v > x.v ? 1 : -1))[0]; w = out ? out.to : ''; const hop = out && tt.find((x) => x.from === out.to && x.to !== PM && x.to !== HK); if (hop) w = hop.to; }
    else { const inn = tt.find((x) => x.to === PM); w = inn ? inn.from : ''; }
    // h: what the trader paid (buy, tax included) or received (sell, tax taken); k: tokens moved
    trades.push({ t: t.addr, tx: l.transactionHash, w, b: buy ? 1 : 0, h: buy ? gross : gross - tax, k: f18(buy ? a1 : -a1), tax, toFloor: f18(toF), toCreator: f18(toC), p: pxOf(sq), ts, blk });
  }
  for (const l of S.hook) {
    const t = S.byPool.get(l.topics[1]); if (!t) continue; const ts = parseInt(l.blockTimestamp, 16);
    const push = (e) => (events[t.addr] || (events[t.addr] = [])).push({ ...e, ts, tx: l.transactionHash });
    if (l.topics[0] === T.raised) { const [tickF, sq, q, circ] = dec(['int24', 'uint160', 'uint256', 'uint256'], l.data); (raises[t.addr] || (raises[t.addr] = [])).push({ ts, tick: Number(tickF), p: pxOf(sq), h: f18(q), circ: f18(circ) }); }
    else if (l.topics[0] === T.bought) { const [burned] = dec(['uint256', 'uint160'], l.data); push({ kind: 'buyback', k: f18(burned) }); }
    else if (l.topics[0] === T.collected) { const [q, k] = dec(['uint256', 'uint256', 'address'], l.data); push({ kind: 'collect', h: f18(q), k: f18(k) }); }
    else if (l.topics[0] === T.floorBridged) { const [k, q, incoming] = dec(['uint256', 'uint256', 'bool'], l.data); push({ kind: incoming ? 'floorIn' : 'floorOut', h: f18(q), k: f18(k) }); }
  }
  // trader airdrops (native HYPE only: every Hypex pool is HYPE-paired) and their claims
  const air = {};
  for (const l of S.rev) {
    if (l.topics[0] === T.airdropped && addrOf(l.topics[2]) === ethers.ZeroAddress) { const w = addrOf(l.topics[1]), a = air[w] || (air[w] = { earned: 0, claimed: 0, n: 0 }); a.earned += f18(BigInt(l.data)); a.n++; }
    else if (l.topics[0] === T.claimed && addrOf(l.topics[2]) === ethers.ZeroAddress) { const w = addrOf(l.topics[1]); if (air[w]) air[w].claimed += f18(BigInt(l.data)); }
  }
  // bridge transfers: sent from here (with their Wormhole sequence) and delivered here
  const bridges = [];
  for (const l of S.br) {
    const ts = parseInt(l.blockTimestamp || '0x0', 16);
    if (l.topics[0] === T.sent) { const [to, amount, hype, seq] = dec(['address', 'uint256', 'uint256', 'uint64'], l.data); bridges.push({ dir: 'out', t: addrOf(l.topics[1]), from: addrOf(l.topics[2]), to: low(to), toChain: Number(l.topics[3]), k: f18(amount), h: f18(hype), seq: seq.toString(), tx: l.transactionHash, ts }); }
    else if (l.topics[0] === T.received) { const [amount, hype, hash] = dec(['uint256', 'uint256', 'bytes32'], l.data); bridges.push({ dir: 'in', t: addrOf(l.topics[1]), to: addrOf(l.topics[2]), fromChain: Number(l.topics[3]), k: f18(amount), h: f18(hype), hash, tx: l.transactionHash, ts }); }
  }
  const tokens = [...S.tokens.values()].map((t) => {
    const lv = S.live[t.addr] || {}, b = bal[t.addr] || {};
    const held = Object.entries(b).filter(([w, v]) => v > 0n && !SYSTEM.has(w));
    const startSqrt = Math.pow(1.0001, t.tickStart / 2) * Q96;
    return { addr: t.addr, remotes: (S.remotes || {})[t.addr] || {}, poolId: t.poolId, creator: t.creator, name: t.name, ticker: t.ticker, uri: t.uri, meta: t.meta || null, createdAt: t.createdAt, tx: t.tx, devBuy: t.devBuy,
      p: lv.sqrt ? pxOf(lv.sqrt) : pxOf(startSqrt), p0: pxOf(startSqrt), tick: lv.tick, floorTick: lv.floorTick, floorP: lv.floorSqrt ? pxOf(lv.floorSqrt) : 0, circulating: lv.circulating, supply: lv.supply || 1e9,
      holders: held.map(([w, v]) => [w, f18(v)]).sort((x, y) => y[1] - x[1]).slice(0, 300), holderCount: held.length, vesting: f18(b[low(N.vesting)] || 0n), raises: raises[t.addr] || [], events: events[t.addr] || [] };
  });
  return { chain: N.key, chainId: N.chainId, block: S.last, at: Math.floor(Date.now() / 1000), skew: S.skew, live: true,
    contracts: { factory: low(N.factory), hook: low(N.hook), revenue: low(N.revenue), bridge: low(N.bridge), router: low(N.router), quoter: low(N.quoter), permit2: low(N.permit2), poolManager: PM, hypex: low(N.hypex) },
    tokens, trades, airdrops: air, bridges };
}

module.exports = async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams, N = NETS[q.get('chain') || 'hyperevm'];
  if (!N) return X.json(res, 400, { error: 'chain: elysium or hyperevm' });
  if (!N.live) return X.json(res, 200, { chain: N.key, chainId: N.chainId, live: false, tokens: [], trades: [], airdrops: {}, bridges: [] }, 'public, max-age=0, s-maxage=30');
  try {
    const S = stateOf(N);
    if (!S.pending && Date.now() - S.at > 2500) S.pending = sync(N, S).then(() => { S.at = Date.now(); S.err = ''; }).finally(() => { S.pending = null; saveSnap(N, S); });
    // a sync that fails part way (a public RPC rate-limiting) keeps what it indexed: serve that, and the next request carries on
    if (S.pending) await S.pending.catch((e) => { S.err = e.message; });
    if (S.last < (N.fromBlock || 1) && S.err) return X.json(res, 503, { error: S.err });
    X.json(res, 200, build(N, S), 'public, max-age=0, s-maxage=3, stale-while-revalidate=30');
  } catch (e) { X.json(res, 503, { error: e.message }); }
};
module.exports.SS = SS; module.exports.sync = sync; module.exports.build = build; module.exports.stateOf = stateOf;
