// GET /api/state?chain=hyperevm|elysium: every LiquidFi token on that chain with its pool state, trades, holders and fee
// accounting, built from event logs (factory, hook, escrow, vault, PoolManager filtered to our pools, the tokens'
// Transfers). A warm instance keeps the logs and only reads new blocks, in pages where the RPC caps the range
// (HyperEVM: 1,000 blocks); a snapshot in the Blob store lets a cold instance resume instead of rereading from the
// deploy block. The CDN caches the answer for a few seconds so visitors never hit the RPC.
const L = require('./_lib');
const { ethers, netOf } = L;

const ev = (s) => ethers.id(s);
const T = {
  launched: ev('TokenLaunched(address,address,bytes32,uint256,address,uint16,bool,uint256[3])'),
  launched2: ev('TokenLaunched(address,address,bytes32,uint256,address,address,uint16,uint256[3])'), // v2: adds the pair
  feesPaid: ev('FeesPaid(bytes32,address,uint256,address,uint256)'),
  metadata: ev('TokenMetadata(address,string,string,string,string,(string,string,string,string,string))'),
  recipient: ev('CreatorFeeRecipientUpdated(address,address,address)'),
  buyback: ev('BuybackEnabledUpdated(address,bool,address)'),
  init: ev('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'),
  modify: ev('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)'),
  swap: ev('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'),
  hookFee: ev('HookFeeCollected(bytes32,address,uint256,uint256)'),
  surcharge: ev('SurchargeApplied(bytes32,uint256,uint256)'),
  spike: ev('VolatilitySpike(bytes32,uint160,uint160)'),
  swept: ev('PoolFeesSwept(bytes32,uint256,uint256,uint256,uint256)'),
  transfer: ev('Transfer(address,address,uint256)'),
  credited: ev('Credited(address,address,uint256)'),
  claimed: ev('Claimed(address,uint256)'),
  locked: ev('Locked(address,address,uint256,uint256)'),
  released: ev('Released(address,uint256,uint256)'),
};
const AC = ethers.AbiCoder.defaultAbiCoder();
const addrOf = (topic) => ethers.getAddress('0x' + topic.slice(26));
const dec = (types, data) => AC.decode(types, data);
const HOOK_I = new ethers.Interface(['function poolTerms(bytes32) view returns (uint40 launchedAt, uint16 snipeStartBps, uint32 snipeSeconds, uint16 volThresholdBps, uint32 volWindow, uint16 volExtraBps, uint32 volDecay)', 'function launches(bytes32) view returns (bool registered, bool memecoinIsCurrency0, address memecoin, address quoteToken, address creator, address buybackCreatorRecipient, address protocolFeeRecipient, uint16 creatorTaxBps, uint16 protocolFeeShareBps, uint16 buybackBurnBps, uint16 hookFeeBps, uint16 maxInternalPriceImpactBps, bool buybackEnabled)']);
const HOOK2_I = new ethers.Interface(['function poolTerms(bytes32) view returns (uint40 launchedAt, uint16 snipeStartBps, uint32 snipeSeconds, uint16 volThresholdBps, uint32 volWindow, uint16 volExtraBps, uint32 volDecay)', 'function launches(bytes32) view returns (bool registered, address coin, address pair, address creator, uint16 creatorTaxBps, uint16 protocolFeeShareBps, uint16 hookFeeBps)', 'function pendingCreator(bytes32) view returns (uint256)', 'function pendingProtocol(bytes32) view returns (uint256)']);
const QUOTER_I = new ethers.Interface(['function quoteExactInputSingle(((address,address,uint24,int24,address) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData)) returns (uint256 amountOut, uint256 gasEstimate)']);
const V2PAIR_I = new ethers.Interface(['function getReserves() view returns (uint112, uint112, uint32)', 'function token0() view returns (address)']);
const Q96 = 2 ** 96, f18 = (v) => Number(ethers.formatEther(v));

function makeIndexer(NET) {
const rpc = (m, p) => L.rpc(NET, m, p), multicall = (c) => L.multicall(NET, c);
const LOGNET = NET.logRpc ? { ...NET, rpc: NET.logRpc, name: NET.name + ' logs' } : null;
let logFails = 0; // after repeated failures of the log RPC, read the main RPC in its capped pages
async function getLogs(f) {
  if (LOGNET && logFails < 3) { try { const r = await L.rpc(LOGNET, 'eth_getLogs', [f], 3); logFails = 0; return r; } catch (e) { logFails++; console.warn(NET.key, 'log rpc', e.message); } }
  const from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16), cap = NET.fallbackRange || 0;
  if (!cap || to - from < cap) return L.rpc(NET, 'eth_getLogs', [f]);
  const out = []; for (let a = from; a <= to; a += cap) out.push(...await L.rpc(NET, 'eth_getLogs', [{ ...f, fromBlock: '0x' + a.toString(16), toBlock: '0x' + Math.min(to, a + cap - 1).toString(16) }]));
  return out;
}
// the cache a warm instance keeps between requests
const V2 = NET.v2 || null;
const S = { skew: 0, last: NET.fromBlock - 1, factory: [], hook: [], escrow: [], vault: [], pm: [], transfers: [], tokens: new Map(), byPool: new Map(), terms: new Map(), pending: null, at: 0, loaded: false, savedAt: 0, savedLast: 0, pend2: {}, pairs: {} };

async function logsRange(filter, from, to) {
  try { return await getLogs({ ...filter, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }); }
  catch (e) { if (to - from < 50 || !/range|limit|too many|exceed|large/i.test(e.message)) throw e; const mid = Math.floor((from + to) / 2); return [...(await logsRange(filter, from, mid)), ...(await logsRange(filter, mid + 1, to))]; }
}
// Elysium's logs carry blockTimestamp; for RPCs without it, read each block's header once
const blockTs = new Map();
async function stamp(logs) {
  const need = [...new Set(logs.filter((l) => !l.blockTimestamp).map((l) => l.blockNumber))].filter((n) => !blockTs.has(n));
  for (const n of need) { const b = await rpc('eth_getBlockByNumber', [n, false]); blockTs.set(n, b.timestamp); }
  for (const l of logs) if (!l.blockTimestamp) l.blockTimestamp = blockTs.get(l.blockNumber);
  return logs;
}
const byOrder = (a, b) => (parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16)) || (parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16));

// snapshots: state/<chain>-<block>.json in the Blob store, the newest one wins
const SNAP_KEYS = ['last', 'skew', 'factory', 'hook', 'escrow', 'vault', 'pm', 'transfers'];
async function loadSnapshot() {
  S.loaded = true; if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { list } = require('@vercel/blob'); const { blobs } = await list({ prefix: `state/${NET.key}-` });
    const best = blobs.map((b) => ({ b, n: Number((b.pathname.match(/-(\d+)\.json$/) || [])[1] || 0) })).sort((x, y) => y.n - x.n)[0];
    if (!best || best.n <= S.last) return;
    const j = await (await fetch(best.b.url, { cache: 'no-store' })).json();
    if (j.v !== 2 || j.factory !== NET.factory) return;
    for (const k of SNAP_KEYS) S[k] = j.s[k];
    S.tokens = new Map(j.s.tokens.map((t) => [t.addr.toLowerCase(), t])); S.byPool = new Map([...S.tokens.values()].map((t) => [t.poolId, t])); S.terms = new Map(j.s.terms);
    S.savedLast = S.last;
  } catch (e) { console.warn('snapshot load', NET.key, e.message); }
}
async function saveSnapshot() {
  if (!process.env.BLOB_READ_WRITE_TOKEN || S.last <= S.savedLast || Date.now() - S.savedAt < 120000) return;
  S.savedAt = Date.now();
  try {
    const { put, list, del } = require('@vercel/blob');
    const body = JSON.stringify({ v: 2, factory: NET.factory, s: { ...Object.fromEntries(SNAP_KEYS.map((k) => [k, S[k]])), tokens: [...S.tokens.values()], terms: [...S.terms.entries()] } });
    await put(`state/${NET.key}-${S.last}.json`, body, { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
    S.savedLast = S.last;
    const { blobs } = await list({ prefix: `state/${NET.key}-` }); const old = blobs.filter((b) => !b.pathname.endsWith(`-${S.last}.json`)).map((b) => b.url); if (old.length) await del(old);
  } catch (e) { console.warn('snapshot save', NET.key, e.message); }
}

const within = (p, ms, what) => { let t; return Promise.race([p.finally(() => clearTimeout(t)), new Promise((r) => { t = setTimeout(() => { console.warn(NET.key, what, 'timed out'); r(); }, ms); })]); };
async function sync(deadline = Date.now() + 35000) {
  const t0 = Date.now();
  if (!S.loaded) { await within(loadSnapshot(), 8000, 'snapshot load'); console.log(NET.key, 'snapshot', S.last, Date.now() - t0 + 'ms'); }
  const hb = await rpc('eth_getBlockByNumber', ['latest', false]);
  const head = parseInt(hb.number, 16); S.skew = parseInt(hb.timestamp, 16) - Math.floor(Date.now() / 1000); // chain clock minus ours
  // pages of at most maxRange blocks (the whole range when the RPC has no cap), up to maxChunks per request
  let pages = 0;
  for (let n = 0; n < (NET.maxChunks || 1) && S.last < head && Date.now() < deadline; n++) {
    const from = S.last + 1, to = NET.maxRange ? Math.min(head, from + NET.maxRange - 1) : head;
    await syncRange(from, to); S.last = to; pages++;
  }
  if (V2 && Date.now() < deadline) await within(refreshV2(), 8000, 'v2 pending and pair prices');
  console.log(NET.key, 'synced', pages, 'pages to', S.last, 'head', head, Date.now() - t0 + 'ms');
  await within(saveSnapshot(), 8000, 'snapshot save');
}
// v2: what each pool owes its creator and the protocol right now, and the ERC-20 pairs' prices in ETH
async function refreshV2() {
  const v2pools = [...S.tokens.values()].filter((t) => t.v === 2).map((t) => t.poolId);
  const calls = v2pools.flatMap((p) => [[V2.hook, HOOK2_I, 'pendingCreator', [p]], [V2.hook, HOOK2_I, 'pendingProtocol', [p]]]);
  const pairs = Object.entries(NET.pairs || {});
  for (const [, P] of pairs) if (P.route === 'v4') calls.push([NET.quoter, QUOTER_I, 'quoteExactInputSingle', [[P.key, true, 10n ** 17n, '0x']]]); else calls.push([P.v2pair, V2PAIR_I, 'getReserves'], [P.v2pair, V2PAIR_I, 'token0']);
  const r = await multicall(calls); let i = 0;
  for (const p of v2pools) S.pend2[p] = { creator: f18(r[i++] || 0n), protocol: f18(r[i++] || 0n) };
  for (const [addr, P] of pairs) {
    if (P.route === 'v4') { const q = r[i++]; if (q) S.pairs[addr] = { sym: P.sym, route: 'v4', perEth: f18(q[0]) * 10, key: P.key }; }
    else { const rs = r[i++], t0 = r[i++]; if (rs && t0) { const pIs0 = t0.toLowerCase() === addr; const rp = f18(pIs0 ? rs[0] : rs[1]), re = f18(pIs0 ? rs[1] : rs[0]); S.pairs[addr] = { sym: P.sym, route: 'v2', perEth: rp / re, reservePair: rp, reserveEth: re, v2pair: P.v2pair, weth: P.weth }; } }
  }
}
async function syncRange(from, head) {
  // one call for the protocol contracts (both generations), split by address
  const core = await stamp(await logsRange({ address: [NET.factory, NET.hook, NET.escrow, NET.vault, ...(V2 ? [V2.factory, V2.hook] : [])] }, from, head));
  const of = (a) => core.filter((l) => l.address.toLowerCase() === a.toLowerCase());
  const fac = [...of(NET.factory), ...(V2 ? of(V2.factory) : [])].sort(byOrder), hook = [...of(NET.hook), ...(V2 ? of(V2.hook) : [])], esc = of(NET.escrow), vault = of(NET.vault);
  for (const l of fac) {
    if (l.topics[0] === T.launched || l.topics[0] === T.launched2) {
      const v2 = l.topics[0] === T.launched2;
      const [cfgId, pair, rec, tax, bb, ids] = v2 ? (([a, b, c, d, e]) => [a, b, c, d, false, e])(dec(['uint256', 'address', 'address', 'uint16', 'uint256[3]'], l.data)) : (([a, c, d, e, f]) => [a, ethers.ZeroAddress, c, d, e, f])(dec(['uint256', 'address', 'uint16', 'bool', 'uint256[3]'], l.data));
      const t = { addr: addrOf(l.topics[1]), creator: addrOf(l.topics[2]), poolId: l.topics[3], configId: Number(cfgId), feeRecipient: rec, taxBps: Number(tax), buyback: bb, posIds: ids.map(String), createdAt: parseInt(l.blockTimestamp, 16), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, v: v2 ? 2 : 1, pair: pair.toLowerCase() };
      S.tokens.set(t.addr.toLowerCase(), t); S.byPool.set(t.poolId, t);
    } else if (l.topics[0] === T.metadata) {
      const t = S.tokens.get(addrOf(l.topics[1]).toLowerCase()); if (!t) continue;
      const [name, symbol, logo, desc, so] = dec(['string', 'string', 'string', 'string', '(string,string,string,string,string)'], l.data);
      Object.assign(t, { name, symbol, logo, desc, socials: { x: so[0], tg: so[1], discord: so[2], web: so[3], farcaster: so[4] } });
    } else if (l.topics[0] === T.recipient && l.topics.length === 4) {
      const t = S.tokens.get(addrOf(l.topics[1]).toLowerCase()); if (t) t.feeRecipient = addrOf(l.topics[3]);
    } else if (l.topics[0] === T.buyback && l.topics.length === 3) {
      const t = S.tokens.get(addrOf(l.topics[1]).toLowerCase()); if (t) t.buyback = dec(['bool'], l.data)[0];
    }
  }
  S.factory.push(...fac); S.hook.push(...hook); S.escrow.push(...esc); S.vault.push(...vault);
  const pools = [...S.byPool.keys()], addrs = [...S.tokens.values()].map((t) => t.addr);
  if (pools.length) {
    for (let i = 0; i < pools.length; i += 100) S.pm.push(...await stamp(await logsRange({ address: NET.poolManager, topics: [[T.init, T.modify, T.swap], pools.slice(i, i + 100)] }, from, head)));
    for (let i = 0; i < addrs.length; i += 100) S.transfers.push(...await logsRange({ address: addrs.slice(i, i + 100), topics: [T.transfer] }, from, head));
    const fresh = pools.filter((p) => !S.terms.has(p));
    if (fresh.length) {
      const isV2 = (p) => (S.byPool.get(p) || {}).v === 2;
      const r = await multicall(fresh.flatMap((p) => (isV2(p) ? [[V2.hook, HOOK2_I, 'poolTerms', [p]], [V2.hook, HOOK2_I, 'launches', [p]]] : [[NET.hook, HOOK_I, 'poolTerms', [p]], [NET.hook, HOOK_I, 'launches', [p]]])));
      fresh.forEach((p, i) => {
        const pt = r[2 * i], li = r[2 * i + 1]; if (!pt) return;
        const base = { launchedAt: Number(pt[0]), snipeStartBps: Number(pt[1]), snipeSeconds: Number(pt[2]), volThresholdBps: Number(pt[3]), volWindow: Number(pt[4]), volExtraBps: Number(pt[5]), volDecay: Number(pt[6]) };
        S.terms.set(p, isV2(p) ? { ...base, hookFeeBps: li ? Number(li[6]) : 100, protocolShareBps: li ? Number(li[5]) : 3000, buybackBps: 0 } : { ...base, hookFeeBps: li ? Number(li[10]) : 100, protocolShareBps: li ? Number(li[8]) : 3000, buybackBps: li ? Number(li[9]) : 5000 });
      });
    }
  }
  for (const k of ['pm', 'transfers', 'hook']) S[k].sort(byOrder);
}

function build() {
  const pm = S.pm, PM = NET.poolManager.toLowerCase();
  const txTransfers = new Map(); // tx -> transfers in order
  const bal = {}; // token -> holder -> wei
  for (const l of S.transfers) {
    const tok = l.address.toLowerCase(), from = addrOf(l.topics[1]).toLowerCase(), to = addrOf(l.topics[2]).toLowerCase(), v = BigInt(l.data);
    (txTransfers.get(l.transactionHash) || txTransfers.set(l.transactionHash, []).get(l.transactionHash)).push({ tok, from, to, v });
    const b = bal[tok] || (bal[tok] = {}); if (from !== ethers.ZeroAddress) b[from] = (b[from] || 0n) - v; b[to] = (b[to] || 0n) + v;
  }
  const hookByTx = new Map(); for (const l of S.hook) (hookByTx.get(l.transactionHash) || hookByTx.set(l.transactionHash, []).get(l.transactionHash)).push(l);
  const pool = {}; // poolId -> { sqrt, tick, ranges, lastSpike }
  const trades = [];
  for (const l of pm) {
    const id = l.topics[1], P = pool[id] || (pool[id] = { sqrt: null, tick: 0, ranges: {}, lastSpike: 0 }), t = S.byPool.get(id); if (!t) continue;
    if (l.topics[0] === T.init) { const [, , , sq, tick] = dec(['uint24', 'int24', 'address', 'uint160', 'int24'], l.data); P.sqrt = sq; P.tick = Number(tick); }
    else if (l.topics[0] === T.modify) { const [lo, hi, d] = dec(['int24', 'int24', 'int256', 'bytes32'], l.data); const k = lo + ':' + hi; P.ranges[k] = (P.ranges[k] || 0n) + d; }
    else if (l.topics[0] === T.swap) {
      const [a0, a1, sq, , tick] = dec(['int128', 'int128', 'uint160', 'uint128', 'int24', 'uint24'], l.data); P.sqrt = sq; P.tick = Number(tick);
      const buy = a0 < 0n, li = parseInt(l.logIndex, 16), v2 = t.v === 2;
      // v1 takes its fee after the swap (logs follow it); v2 takes an exact-input buy's fee before it (logs precede it)
      const all = (hookByTx.get(l.transactionHash) || []).filter((h) => h.topics[1] === id);
      const before = all.filter((h) => parseInt(h.logIndex, 16) < li), after = all.filter((h) => parseInt(h.logIndex, 16) > li);
      const prevSwap = v2 && buy ? Math.max(-1, ...pm.filter((x) => x.transactionHash === l.transactionHash && x.topics[0] === T.swap && x.topics[1] === id && parseInt(x.logIndex, 16) < li).map((x) => parseInt(x.logIndex, 16))) : -1;
      const pre = before.filter((h) => parseInt(h.logIndex, 16) > prevSwap);
      const hk = v2 && buy && pre.some((h) => h.topics[0] === T.hookFee) ? pre.slice().reverse() : after;
      const fe = hk.find((h) => h.topics[0] === T.hookFee), su = hk.find((h) => h.topics[0] === T.surcharge);
      const [, feeAmt, taxAmt] = fe ? dec(['address', 'uint256', 'uint256'], fe.data) : [null, 0n, 0n];
      const [volBps, snipeBps] = su ? dec(['uint256', 'uint256'], su.data).map(Number) : [0, 0];
      const hypeGross = f18(buy ? -a0 : a0), tokGross = f18(buy ? a1 : -a1), cut = f18(feeAmt + taxAmt);
      const avg = tokGross > 0 ? hypeGross / tokGross : 0, sqf = Number(sq) / Q96, px = sqf > 0 ? 1 / (sqf * sqf) : 0;
      // the trader: who the pool's tokens went to (following one more hop), or who paid them in
      const tt = (txTransfers.get(l.transactionHash) || []).filter((x) => x.tok === t.addr.toLowerCase());
      let wallet = '';
      const HK = (v2 ? V2.hook : NET.hook).toLowerCase();
      if (buy) { const out = tt.filter((x) => x.from === PM && x.to !== HK).sort((x, y) => (y.v > x.v ? 1 : -1))[0]; wallet = out ? out.to : ''; const hop = out && tt.find((x) => x.from === out.to && x.to !== PM && x.to !== HK); if (hop) wallet = hop.to; }
      else { const inn = tt.find((x) => x.to === PM); wallet = inn ? inn.from : ''; }
      const gross = buy ? tokGross : hypeGross;
      if (v2) { // every fee in the pair: a buy paid the swapped amount plus the fee, a sell received the swapped amount less it
        const paid = buy ? hypeGross + cut : hypeGross;
        trades.push({ t: t.addr.toLowerCase(), tx: l.transactionHash, w: wallet, b: buy ? 1 : 0, h: buy ? paid : hypeGross - cut, k: tokGross, f: cut, ft: f18(feeAmt), fx: f18(taxAmt), fb: paid > 0 ? Math.round(cut / paid * 1e4) : 0, s: snipeBps, v: volBps, p: px, ts: parseInt(l.blockTimestamp, 16), blk: parseInt(l.blockNumber, 16) });
        continue;
      }
      trades.push({ t: t.addr.toLowerCase(), tx: l.transactionHash, w: wallet, b: buy ? 1 : 0, h: buy ? hypeGross : hypeGross - cut, k: buy ? tokGross - cut : tokGross, f: buy ? cut * avg : cut, ft: f18(feeAmt) * (buy ? avg : 1), fx: f18(taxAmt) * (buy ? avg : 1), fb: gross > 0 ? Math.round(cut / gross * 1e4) : 0, s: snipeBps, v: volBps, p: px, ts: parseInt(l.blockTimestamp, 16), blk: parseInt(l.blockNumber, 16) });
    }
  }
  for (const l of S.hook) if (l.topics[0] === T.spike) { const P = pool[l.topics[1]]; if (P) P.lastSpike = parseInt(l.blockTimestamp, 16); }
  // fee accounting per pool: accrued from HookFeeCollected (creator part valued in HYPE), swept from PoolFeesSwept
  const paid2 = {}; for (const l of S.hook) if (l.topics[0] === T.feesPaid) { const [c, p] = dec(['uint256', 'uint256'], l.data); const x = paid2[l.topics[1]] || (paid2[l.topics[1]] = { creator: 0, protocol: 0 }); x.creator += f18(c); x.protocol += f18(p); }
  const swept = {}; for (const l of S.hook) if (l.topics[0] === T.swept) { const [p, b, c] = dec(['uint256', 'uint256', 'uint256', 'uint256'], l.data); const s = swept[l.topics[1]] || (swept[l.topics[1]] = { protocol: 0, buyback: 0, creator: 0 }); s.protocol += f18(p); s.buyback += f18(b); s.creator += f18(c); }
  const credit = {}; for (const l of S.escrow) { if (l.topics[0] !== T.credited && l.topics[0] !== T.claimed) continue; const w = addrOf(l.topics[1]).toLowerCase(), c = credit[w] || (credit[w] = { credited: 0, claimed: 0 }); if (l.topics[0] === T.credited) c.credited += f18(dec(['uint256'], l.data)[0]); else if (l.topics[0] === T.claimed) c.claimed += f18(dec(['uint256'], l.data)[0]); }
  const vest = {}; for (const l of S.vault) { if (l.topics[0] !== T.locked && l.topics[0] !== T.released) continue; const tok = addrOf(l.topics[1]).toLowerCase(), v = vest[tok] || (vest[tok] = { locked: 0, released: 0 }); if (l.topics[0] === T.locked) v.locked += f18(dec(['uint256', 'uint256'], l.data)[0]); else if (l.topics[0] === T.released) { const [c, p] = dec(['uint256', 'uint256'], l.data); v.released += f18(c + p); } }

  const tokens = [...S.tokens.values()].filter((t) => t.name).map((t) => {
    const P = pool[t.poolId] || { sqrt: null, tick: 0, ranges: {}, lastSpike: 0 }, terms = S.terms.get(t.poolId) || null;
    const b = bal[t.addr.toLowerCase()] || {};
    const holders = Object.entries(b).filter(([, v]) => v > 0n).map(([w, v]) => [w, f18(v)]).sort((x, y) => y[1] - x[1]).slice(0, 500);
    return { addr: t.addr.toLowerCase(), creator: t.creator.toLowerCase(), feeRecipient: t.feeRecipient.toLowerCase(), poolId: t.poolId, configId: t.configId, taxBps: t.taxBps, buyback: t.buyback, posIds: t.posIds, createdAt: t.createdAt, block: t.block, tx: t.tx,
      name: t.name, symbol: t.symbol, logo: t.logo, desc: t.desc, socials: t.socials,
      sqrtP: P.sqrt != null ? P.sqrt.toString() : null, tick: P.tick, ranges: Object.entries(P.ranges).filter(([, v]) => v > 0n).map(([k, v]) => { const [lo, hi] = k.split(':').map(Number); return { lo, hi, liq: v.toString() }; }),
      lastSpike: P.lastSpike, terms, swept: swept[t.poolId] || { protocol: 0, buyback: 0, creator: 0 }, vest: vest[t.addr.toLowerCase()] || { locked: 0, released: 0 },
      v: t.v || 1, pair: t.pair || ethers.ZeroAddress, ...(t.v === 2 ? { pend: S.pend2[t.poolId] || { creator: 0, protocol: 0 }, paid: paid2[t.poolId] || { creator: 0, protocol: 0 } } : {}),
      holders, holderCount: Object.values(b).filter((v) => v > 0n).length };
  });
  return { chainId: NET.chainId, block: S.last, at: Math.floor(Date.now() / 1000), skew: S.skew, poolManager: NET.poolManager.toLowerCase(), tokens, trades, escrow: credit, pairs: S.pairs, v2: V2 ? { factory: V2.factory.toLowerCase(), hook: V2.hook.toLowerCase(), locker: V2.locker.toLowerCase() } : null };
}

  return { S, sync, build, NET };
}

const IDX = {};
const indexer = (key) => { const net = netOf(key); if (!net) return null; return IDX[key] || (IDX[key] = makeIndexer(net)); };

module.exports = async (req, res) => {
  try {
    const key = (req.query && req.query.chain) || new URL(req.url || '/', 'http://x').searchParams.get('chain') || L.defaultNet();
    const X = indexer(key); if (!X) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ error: 'unknown chain' })); }
    const S = X.S;
    if (!S.pending && Date.now() - S.at > 2500) S.pending = X.sync().then(() => { S.at = Date.now(); }).finally(() => { S.pending = null; });
    if (S.pending) await S.pending;
    const body = JSON.stringify({ chain: key, ...X.build() });
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'public, max-age=0, s-maxage=3, stale-while-revalidate=30');
    res.setHeader('access-control-allow-origin', '*');
    res.end(body);
  } catch (e) {
    res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: e.message }));
  }
};
module.exports.indexer = indexer;
