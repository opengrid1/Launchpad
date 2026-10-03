/* Inkypump chain layer: reads Ink directly from the browser (ethers v6) and sends
   transactions through the connected wallet (window.inkyWallet). Exposes window.CHAIN. */
import { ethers } from 'ethers';
import ABI from '../../chain/abi.json';

const CFG = (typeof window !== 'undefined' && window.INKY) || {};
const C = CFG.contracts || {};
const RPC = CFG.rpc || 'https://rpc-gel.inkonchain.com';
const EXPLORER = CFG.explorer || 'https://explorer.inkonchain.com';
const LOGS_RPC = CFG.logsRpc || 'https://rpc-qnd.inkonchain.com';
const WETH = (CFG.weth || '0x4200000000000000000000000000000000000006').toLowerCase();
const USDG = (CFG.usdg || '0xe343167631d89B6Ffc58B88d6b7fB0228795491D').toLowerCase();
const SUPPLY = 1e9;
const BPS = 10000n;
const Q96 = 1n << 96n;
const STOCKS = (CFG.stocks || []).map(s => ({ ...s, address: s.address.toLowerCase() }));
const SYM = Object.fromEntries(STOCKS.map(s => [s.address, s.symbol]));
SYM[WETH] = 'ETH';

// Public RPCs rate-limit per IP; rotate through several on 429 / network errors and remember the one that answered.
// rpc-gel takes big batches without a per-second cap; rpc-qnd allows 20 calls/s; drpc's free tier rejects batches over 3
const RPCS = [...new Set([RPC, ...(CFG.rpcs || []), LOGS_RPC])];
class RotatingProvider extends ethers.JsonRpcProvider {
  constructor(urls, opts) { super(urls[0], { chainId: 57073, name: 'ink' }, { staticNetwork: true, ...opts }); this.urls = urls; this.at = 0; }
  async _send(payload) {
    let lastErr; const body = JSON.stringify(payload);
    for (let round = 0; round < 3; round++) {
      if (round) await new Promise(r => setTimeout(r, 600 * round));
      for (let n = 0; n < this.urls.length; n++) {
        const url = this.urls[(this.at + n) % this.urls.length];
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
          if (r.status === 429 || r.status >= 500) throw new Error('http ' + r.status);
          const j = await r.json(); const arr = Array.isArray(j) ? j : [j];
          if (arr.some(x => x && x.error && /limit|rate|too many|batch/i.test(String(x.error.message)))) throw new Error('rate limited');
          this.at = (this.at + n) % this.urls.length; return arr;
        } catch (e) { lastErr = e; }
      }
    }
    throw lastErr || new Error('all RPCs failed');
  }
}
const provider = new RotatingProvider(RPCS, { batchMaxCount: 20, batchStallTime: 15 });
const logsProvider = new RotatingProvider(RPCS, { batchMaxCount: 20, batchStallTime: 15 });
const iface = Object.fromEntries(Object.entries(ABI).map(([k, v]) => [k, new ethers.Interface(v)]));
const factory = new ethers.Contract(C.factory, ABI.InkypumpFactory, provider);
const ledger = new ethers.Contract(C.ledger, ABI.InkypumpLedger, provider);
const payout = new ethers.Contract(C.payout, ABI.InkypumpPayout, provider);
const hook = new ethers.Contract(C.hook, ABI.InkypumpHook, provider);
const pm = new ethers.Contract(C.poolManager, ABI.PoolManager, provider);
const coinOf = (a, runner) => new ethers.Contract(a, ABI.InkypumpToken, runner || provider);
const erc20 = (a, runner) => new ethers.Contract(a, ABI.ERC20, runner || provider);

// --------------------------------------------------------------- helpers
const lower = a => (a || '').toLowerCase();
const now = () => Math.floor(Date.now() / 1000);
const memo = {}; const cached = async (key, ttl, fn) => { const m = memo[key]; if (m && m.t + ttl > Date.now()) return m.v; const v = await fn(); memo[key] = { v, t: Date.now() }; return v; };
const retry = async (fn, n = 4) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (err) { e = err; await new Promise(r => setTimeout(r, 400 * (i + 1))); } } throw e; };
function parseMeta(s) { try { const j = JSON.parse(s || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
function ageStr(ts) { const s = Math.max(1, now() - ts); if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }
function bsqrt(n) { if (n < 2n) return n; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x; }
function poolSlot(poolId) { return ethers.keccak256(ethers.concat([poolId, ethers.zeroPadValue('0x06', 32)])); }

// --------------------------------------------------------------- prices
// ETH/USD from the factory's Chainlink feed (the same price the contracts use)
async function ethUsd() { return cached('ethusd', 60_000, async () => Number(await factory.pairUsdPrice(WETH)) / 1e8); }
async function pairUsd(pair) { pair = lower(pair); if (pair === WETH) return ethUsd(); return cached('usd:' + pair, 300_000, async () => Number(await factory.pairUsdPrice(pair)) / 1e8); }

// --------------------------------------------------------------- pool state
async function poolState(poolId) {
  const base = BigInt(poolSlot(poolId));
  const [s0, liq] = await Promise.all([pm.extsload(ethers.toBeHex(base, 32)), pm.extsload(ethers.toBeHex(base + 3n, 32))]);
  const v = BigInt(s0); const sqrtPriceX96 = v & ((1n << 160n) - 1n); let tick = Number((v >> 160n) & 0xffffffn); if (tick >= 0x800000) tick -= 0x1000000;
  return { sqrtPriceX96, tick, liquidity: BigInt(liq) & ((1n << 128n) - 1n) };
}
// pair per token (float) from sqrtPriceX96
function pairPerToken(sqrtPriceX96, tokenIs0) { const p = Number(sqrtPriceX96) / 2 ** 96; const p1per0 = p * p; return tokenIs0 ? p1per0 : 1 / p1per0; }
// pair-side amount held by the single factory range at the current price
function pairInRange(st, pos, tokenIs0) {
  const L = BigInt(pos.liquidity); if (L === 0n) return 0n;
  const sqrtP = BigInt(st.sqrtPriceX96); const sqrtLo = tickSqrt(Number(pos.tickLower)), sqrtHi = tickSqrt(Number(pos.tickUpper));
  if (tokenIs0) { // pair is currency1: amount1 = L * (sqrtP - sqrtLo) / Q96
    const s = sqrtP < sqrtLo ? sqrtLo : sqrtP > sqrtHi ? sqrtHi : sqrtP; return L * (s - sqrtLo) / Q96;
  } else { // pair is currency0: amount0 = L * (sqrtHi - sqrtP) * Q96 / (sqrtHi * sqrtP)
    const s = sqrtP < sqrtLo ? sqrtLo : sqrtP > sqrtHi ? sqrtHi : sqrtP; return L * (sqrtHi - s) * Q96 / (sqrtHi * s);
  }
}
function tickSqrt(tick) { // sqrt(1.0001^tick) * 2^96, float-based (enough for display and quotes with a slippage guard)
  const r = Math.pow(1.0001, tick / 2); return BigInt(Math.floor(r * 2 ** 96));
}

// --------------------------------------------------------------- logs (Blockscout first, RPC fallback)
const TRADE_TOPIC = iface.InkypumpLedger.getEvent('Trade').topicHash;
const CLAIM_TOPIC = iface.InkypumpToken.getEvent('RewardsClaimed').topicHash;
const LAUNCH_TOPIC = iface.InkypumpFactory.getEvent('Launched').topicHash;
// Ink seals one block per second, so a timestamp is one reference block away: no per-block lookups.
let refBlock = null;
async function blockTs(n) { if (!refBlock || Date.now() - refBlock.at > 60_000) { const b = await logsProvider.getBlock('latest'); refBlock = { n: b.number, ts: b.timestamp, at: Date.now() }; } return refBlock.ts - (refBlock.n - n); }
async function rpcLogs(address, topics, fromBlock, toBlock) {
  const ls = await logsProvider.getLogs({ address: address || undefined, topics, fromBlock, toBlock });
  const out = ls.map(l => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: l.blockNumber, timeStamp: 0, txHash: l.transactionHash, index: l.index }));
  for (const l of out) l.timeStamp = await blockTs(l.blockNumber);
  return out;
}
async function fetchLogs(address, topics, fromBlock, toBlock) {
  // small ranges go straight to the RPC (one call, no explorer rate limit); big ranges try the explorer first
  if (toBlock !== 'latest' && toBlock - fromBlock <= 9000) { try { return await rpcLogs(address, topics, fromBlock, toBlock); } catch (e) { console.warn('rpc logs', e); } }
  if (toBlock !== 'latest' && toBlock - fromBlock <= 45000) { try { const out = []; for (let a = fromBlock; a <= toBlock; a += 9000) out.push(...await rpcLogs(address, topics, a, Math.min(toBlock, a + 8999))); return out; } catch (e) { console.warn('rpc logs chunked', e); } }
  const t = topics.map((x, i) => x ? `&topic${i}=${x}` : '').join('');
  const url = `${EXPLORER}/api?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=${toBlock}` + (address ? `&address=${address}` : '') + t + (topics.length > 1 ? '&topic0_1_opr=and' : '');
  try {
    const r = await fetch(url, { cache: 'no-store' }); const j = await r.json();
    if (j.status === '1' && Array.isArray(j.result)) return j.result.map(l => ({ address: l.address, topics: l.topics.filter(Boolean), data: l.data, blockNumber: Number(l.blockNumber), timeStamp: Number(l.timeStamp), txHash: l.transactionHash, index: Number(l.logIndex || 0) }));
    if (j.status === '0' && /No records/i.test(j.message || '')) return [];
  } catch {}
  // fallback: chunked eth_getLogs
  const out = []; const head = toBlock === 'latest' ? await logsProvider.getBlockNumber() : toBlock; const CH = 9000;
  for (let a = fromBlock; a <= head; a += CH) { const b = Math.min(head, a + CH - 1); const ls = await logsProvider.getLogs({ address: address || undefined, topics, fromBlock: a, toBlock: b }); for (const l of ls) out.push({ address: l.address, topics: l.topics, data: l.data, blockNumber: l.blockNumber, timeStamp: 0, txHash: l.transactionHash, index: l.index }); }
  for (const l of out) if (!l.timeStamp) l.timeStamp = await blockTs(l.blockNumber);
  return out;
}
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
let tradeCache = null;
async function allTrades() {
  return cached('trades', 10_000, async () => {
    const key = 'inky:trades:' + lower(C.ledger); const saved = tradeCache || LS.get(key) || { last: (CFG.deployBlock || 1) - 1, items: [] };
    const head = await provider.getBlockNumber();
    if (head > saved.last) {
      const logs = await fetchLogs(C.ledger, [TRADE_TOPIC], saved.last + 1, head);
      const seen = new Set(saved.items.map(x => x.tx + ':' + x.index));
      for (const l of logs) { const k = l.txHash + ':' + l.index; if (seen.has(k)) continue; const d = iface.InkypumpLedger.decodeEventLog('Trade', l.data, l.topics);
        saved.items.push({ wallet: lower(d.wallet), token: lower(d.token), epoch: Number(d.epoch), buy: d.isBuy, coin: d.coinAmount.toString(), pair: d.pairAmount.toString(), fee: d.fee.toString(), realized: d.realized.toString(), block: l.blockNumber, ts: l.timeStamp, tx: l.txHash, index: l.index }); }
      saved.items.sort((a, b) => a.block - b.block || a.index - b.index); saved.last = head; tradeCache = saved; LS.set(key, saved);
    }
    return saved.items;
  });
}
function tradePrice(t) { const coin = Number(t.coin) / 1e18, pair = Number(t.pair) / 1e18, fee = Number(t.fee) / 1e18; return coin > 0 ? (t.buy ? pair - fee : pair + fee) / coin : 0; }

// --------------------------------------------------------------- tokens
let tokens = [], byAddr = {};
const statics = {}; // per token: fields that never change after launch (also kept in localStorage)
const SKEY = 'inky:static:' + lower(C.factory), TKEY = 'inky:tokens:' + lower(C.factory);
try { Object.assign(statics, LS.get(SKEY) || {}); } catch {}
async function loadStatic(a) {
  const al = lower(a); if (statics[al]) return statics[al]; const c = coinOf(a);
  const [L, meta, name, symbol, basket, holderBps, creatorBps, pos] = await Promise.all([
    factory.listings(a), factory.metadataOf(a).catch(() => ''), c.name(), c.symbol(), c.basketAssets(), c.holderBps(), c.creatorBps(), factory.positions(a)]);
  const pair = lower(L.pair); const m = parseMeta(meta);
  const out = statics[al] = { addr: al, n: name, t: symbol, c: '#ff4fa3', pair: SYM[pair] || 'ETH', pairAddr: pair, tokenIs0: al < pair, poolId: L.poolId, createdAt: Number(L.createdAt), creator: lower(L.creator),
    basket: basket.map(b => SYM[lower(b)] || lower(b)), basketAddrs: basket.map(lower), holderBps: Number(holderBps), creatorBps: Number(creatorBps), rewards: Number(holderBps) > 0,
    img: m.image || '', desc: m.description || '', links: { web: m.website || m.web || '', x: m.x || m.twitter || '', tg: m.telegram || m.tg || '' },
    pos: { tickLower: Number(pos.tickLower), tickUpper: Number(pos.tickUpper), liquidity: pos.liquidity.toString() } };
  LS.set(SKEY, statics); return out;
}
async function loadOne(a, trades) {
  const s = await loadStatic(a); const c = coinOf(a);
  const [hidden, st, thr, tcf, pUsd] = await Promise.all([factory.hidden(a), poolState(s.poolId), c.totalHolderRewards(), c.totalCreatorFees(), pairUsd(s.pairAddr)]);
  const pxPair = pairPerToken(st.sqrtPriceX96, s.tokenIs0); const px = pxPair * pUsd;
  const tt = trades.filter(t => t.token === s.addr); const t0 = now();
  const vol = w => tt.filter(t => t.ts >= t0 - w).reduce((acc, t) => acc + Number(t.pair) / 1e18 * pUsd, 0);
  const chg = w => { const past = [...tt].reverse().find(t => t.ts <= t0 - w); const base = past ? tradePrice(past) * pUsd : (s.createdAt > t0 - w ? 3000 / SUPPLY : px); return base > 0 ? (px / base - 1) * 100 : 0; };
  const liqPair = Number(pairInRange(st, s.pos, s.tokenIs0)) / 1e18;
  const feeUsd = tt.reduce((acc, t) => acc + Number(t.fee) / 1e18 * pUsd, 0);
  const prev = byAddr[s.addr];
  return { ...s, mc: px * SUPPLY, px, pxPair, pairUsd: pUsd, hidden, age: ageStr(s.createdAt),
    vol: vol(86400), volAll: tt.reduce((acc, t) => acc + Number(t.pair) / 1e18 * pUsd, 0), feeUsd, tx: tt.filter(t => t.ts >= t0 - 86400).length, trades: tt.length, c5: chg(300), c1: chg(3600), c24: chg(86400),
    liq: liqPair * pUsd, liqPair, h: prev ? prev.h : 0, traders: new Set(tt.map(t => t.wallet)).size,
    rew24: s.holderBps > 0 ? vol(86400) * 0.02 * s.holderBps / 10000 : 0, cre24: vol(86400) * 0.02 * s.creatorBps / 10000,
    totalHolderRewards: Number(thr) / 1e18, totalCreatorFees: Number(tcf) / 1e18, sqrtPriceX96: st.sqrtPriceX96.toString(), liquidity: st.liquidity.toString() };
}
const hcAt = {}; // explorer counters at most once a minute per token (the explorer rate-limits hard)
async function holderCount(x) { const prev = byAddr[x.addr]; if (prev && prev.h && hcAt[x.addr] && Date.now() - hcAt[x.addr] < 60_000) { x.h = prev.h; return; } try { const r = await fetch(`${EXPLORER}/api/v2/tokens/${x.addr}/counters`, { cache: 'no-store' }); if (r.status === 429) { x.h = prev ? prev.h : x.h; return; } const j = await r.json(); x.h = Number(j.token_holders_count) || x.h || 0; hcAt[x.addr] = Date.now(); } catch { if (prev) x.h = prev.h; } }
async function loadTokens() {
  const n = Number(await factory.totalTokens());
  const [addrs, trades] = await Promise.all([Promise.all([...Array(n)].map((_, i) => factory.allTokens(i))), allTrades()]);
  const list = await Promise.all(addrs.map(a => loadOne(a, trades)));
  tokens = list; byAddr = Object.fromEntries(list.map(x => [x.addr, x]));
  await Promise.all(list.map(holderCount));
  LS.set(TKEY, { t: Date.now(), eth: memo.ethusd ? memo.ethusd.v : 0, list });
  return list;
}
// serve the last snapshot first (instant paint), then refresh from the chain in the background
function loadSnapshot() {
  const s = LS.get(TKEY); if (!s || !Array.isArray(s.list) || !s.list.length) return false;
  tokens = s.list.map(x => ({ ...x, age: ageStr(x.createdAt) })); byAddr = Object.fromEntries(tokens.map(x => [x.addr, x]));
  if (s.eth > 0 && !memo.ethusd) memo.ethusd = { v: s.eth, t: Date.now() - 50_000 };
  return true;
}
async function refreshOne(addr) {
  const trades = await allTrades(); const x = await loadOne(addr, trades); await holderCount(x);
  const i = tokens.findIndex(t => t.addr === x.addr); if (i >= 0) tokens[i] = x; else tokens.push(x); byAddr[x.addr] = x; return x;
}
// holders from the explorer: [{wallet, bal (coins), share}]
async function holders(addr, limit = 50) {
  try { const r = await fetch(`${EXPLORER}/api/v2/tokens/${lower(addr)}/holders`, { cache: 'no-store' }); const j = await r.json();
    return (j.items || []).slice(0, limit).map(h => ({ wallet: lower(h.address && h.address.hash || h.address), bal: Number(h.value) / 1e18, share: Number(h.value) / 1e18 / SUPPLY * 100, name: h.address && h.address.name || '' })); } catch { return []; }
}
// per-wallet aggregates for one token from the ledger events
async function topTraders(addr) {
  const tt = (await allTrades()).filter(t => t.token === lower(addr)); const x = byAddr[lower(addr)]; const pUsd = x ? x.pairUsd : 0; const by = {};
  for (const t of tt) { const r = by[t.wallet] || (by[t.wallet] = { wallet: t.wallet, pnl: 0, volume: 0, trades: 0, bought: 0, sold: 0 }); r.pnl += Number(t.realized) / 1e18 * pUsd; r.volume += Number(t.pair) / 1e18 * pUsd; r.trades++; if (t.buy) r.bought += Number(t.coin) / 1e18; else r.sold += Number(t.coin) / 1e18; }
  return Object.values(by).map(r => ({ ...r, holding: r.bought - r.sold > 1 })).sort((a, b) => b.pnl - a.pnl);
}

// --------------------------------------------------------------- quotes (single factory range)
async function feeBps(x) { try { const [total] = await hook.feeBpsNow(x.poolId, C.router); return Number(total); } catch { return 200; } }
async function quoteBuy(addr, pairIn) { // pairIn: bigint wei of the pair; returns bigint coins out
  const x = byAddr[lower(addr)]; if (!x) throw new Error('unknown token'); const st = await poolState(x.poolId); const L = BigInt(x.pos.liquidity); if (L === 0n) return 0n;
  const fee = BigInt(await feeBps(x)); const inNet = pairIn - pairIn * fee / BPS; const sqrtP = st.sqrtPriceX96;
  if (x.tokenIs0) { // pair is currency1 in: sqrtNew = sqrtP + in*Q96/L ; out0 = L*Q96*(sqrtNew - sqrtP)/(sqrtNew*sqrtP)
    const sqrtNew = sqrtP + inNet * Q96 / L; return L * Q96 * (sqrtNew - sqrtP) / (sqrtNew * sqrtP);
  } else { // pair is currency0 in: sqrtNew = L*sqrtP*Q96 / (L*Q96 + in*sqrtP); out1 = L*(sqrtP - sqrtNew)/Q96
    const sqrtNew = L * sqrtP * Q96 / (L * Q96 + inNet * sqrtP); return L * (sqrtP - sqrtNew) / Q96;
  }
}
async function quoteSell(addr, coinIn) { // returns bigint pair out after the fee
  const x = byAddr[lower(addr)]; if (!x) throw new Error('unknown token'); const st = await poolState(x.poolId); const L = BigInt(x.pos.liquidity); if (L === 0n) return 0n;
  const fee = BigInt(await feeBps(x)); const sqrtP = st.sqrtPriceX96; let out;
  if (x.tokenIs0) { // token0 in: sqrtNew = L*sqrtP*Q96/(L*Q96 + in*sqrtP); out1 = L*(sqrtP - sqrtNew)/Q96
    const sqrtNew = L * sqrtP * Q96 / (L * Q96 + coinIn * sqrtP); out = L * (sqrtP - sqrtNew) / Q96;
  } else { // token1 in: sqrtNew = sqrtP + in*Q96/L; out0 = L*Q96*(sqrtNew - sqrtP)/(sqrtNew*sqrtP)
    const sqrtNew = sqrtP + coinIn * Q96 / L; out = L * Q96 * (sqrtNew - sqrtP) / (sqrtNew * sqrtP);
  }
  return out - out * fee / BPS;
}

// --------------------------------------------------------------- routes (stock pairs)
function routeFor(pairAddr) {
  pairAddr = lower(pairAddr); if (pairAddr === WETH) return '0x';
  const s = STOCKS.find(z => z.address === pairAddr); const fee = s ? s.usdgPoolFee : 500;
  const path = ethers.solidityPacked(['address', 'uint24', 'address', 'uint24', 'address'], [WETH, 10000, USDG, fee, pairAddr]);
  const key = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
  return ethers.AbiCoder.defaultAbiCoder().encode(['bytes', 'tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)'], [path, key]);
}

// --------------------------------------------------------------- wallet / transactions
async function signer() {
  const w = window.inkyWallet; if (!w || !w.connected) throw new Error('Connect your wallet first');
  if (w.chainId && w.chainId !== 57073) { await w.switchToInk(); }
  const s = await w.getSigner(); if (!s) throw new Error('Wallet not ready'); return s;
}
async function send(fn) { const tx = await fn(); const rc = await tx.wait(); memo.trades = null; return rc; }
// ETH in -> coins out. For stock-paired coins the router swaps ETH to the pair first; the quote crosses at the feed prices.
async function quoteBuyEth(addr, ethIn) { const x = byAddr[lower(addr)]; if (!x) throw new Error('unknown token'); let pairIn = ethIn; if (x.pairAddr !== WETH) { const [e, p] = await Promise.all([ethUsd(), pairUsd(x.pairAddr)]); pairIn = ethIn * BigInt(Math.round(e * 1e6)) / BigInt(Math.round(p * 1e6)); pairIn -= pairIn * 3n / 1000n; } return quoteBuy(addr, pairIn); }
async function quoteSellEth(addr, coinIn) { const x = byAddr[lower(addr)]; if (!x) throw new Error('unknown token'); let out = await quoteSell(addr, coinIn); if (x.pairAddr !== WETH) { const [e, p] = await Promise.all([ethUsd(), pairUsd(x.pairAddr)]); out = out * BigInt(Math.round(p * 1e6)) / BigInt(Math.round(e * 1e6)); out -= out * 3n / 1000n; } return out; }
const api = {
  ready: null, tokens: () => tokens, token: a => byAddr[lower(a)], trades: async a => (await allTrades()).filter(t => !a || t.token === lower(a)), allTrades, tradePrice, ethUsd, pairUsd, routeFor, explorer: EXPLORER, symbolOf: a => SYM[lower(a)] || '', stocks: STOCKS, weth: WETH,
  stale: false,
  async load() {
    const full = () => retry(loadTokens, 3);
    if (loadSnapshot()) { api.stale = true; full().then(() => { api.stale = false; window.dispatchEvent(new CustomEvent('chain-update')); }).catch(e => console.warn('background refresh', e)); }
    else await full();
    window.dispatchEvent(new CustomEvent('chain-ready')); return tokens; },
  async refresh(addr) { memo.trades = null; return addr ? refreshOne(addr) : loadTokens(); },
  holders, topTraders, quoteBuy, quoteSell, quoteBuyEth, quoteSellEth, feeBps: a => feeBps(byAddr[lower(a)]),
  // admin (the connected wallet must be the admin; the contracts enforce it)
  async setHidden(addr, hidden) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.InkypumpFactory, s).setHidden(addr, hidden)); },
  async setMetadata(addr, uri) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.InkypumpFactory, s).setCoinMetadata(addr, uri)); },
  async settle(epoch, pnlWinners, volWinners) { const s = await signer(); const pad = a => [...a, ...Array(5).fill(ethers.ZeroAddress)].slice(0, 5); return send(() => new ethers.Contract(C.payout, ABI.InkypumpPayout, s).settle(epoch, pad(pnlWinners), pad(volWinners))); },
  async sweep(token) { const s = await signer(); return send(() => new ethers.Contract(C.treasury, ABI.InkypumpTreasury, s).sweep(token || WETH)); },
  async collect(addr, bps, recipient) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.InkypumpFactory, s).collect(addr, bps, recipient)); },
  async setFeeRecipient(a) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.InkypumpFactory, s).setFeeRecipient(a)); },
  async setTreasuryRecipient(a) { const s = await signer(); return send(() => new ethers.Contract(C.treasury, ABI.InkypumpTreasury, s).setRecipient(a)); },
  async setQuoteAsset(pair, approved, usdPrice8, feed) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.InkypumpFactory, s).setQuoteAsset(pair, approved, usdPrice8, feed || ethers.ZeroAddress)); },
  feeRecipient: () => factory.feeRecipient(), treasuryRecipient: async () => { try { return await new ethers.Contract(C.treasury, ABI.InkypumpTreasury, provider).recipient(); } catch { return ''; } },
  quoteAsset: async pair => { const q = await factory.quoteAssets(pair); return { approved: q.approved, usdPrice8: Number(q.usdPrice8), feed: q.feed }; },
  async pushPlatformFees(addrs) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.InkypumpFactory, s).pushPlatformFees(addrs)); },
  settled: epoch => payout.settled(epoch), paidInEpoch: async epoch => Number(await payout.paidInEpoch(epoch)) / 1e18, currentEpoch: async () => Number(await ledger.currentEpoch()),
  treasuryWeth: async () => Number(await erc20(WETH).balanceOf(C.treasury)) / 1e18, platformOwed: async addr => Number(await coinOf(addr).platformFees()) / 1e18,
  // gas limit from our own RPC (estimate + 30%), so the wallet does not have to guess on a chain it may not know well
  async buy(addr, ethIn, minOut) { const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); const route = routeFor(x.pairAddr); const ro = new ethers.Contract(C.router, ABI.InkypumpRouter, provider); const g = await ro.buy.estimateGas(addr, route, minOut, { from: me, value: ethIn }); const r = new ethers.Contract(C.router, ABI.InkypumpRouter, s); return send(() => r.buy(addr, route, minOut, { value: ethIn, gasLimit: g * 13n / 10n })); },
  async sell(addr, amount, minEthOut) { const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); const c = coinOf(addr, s); const al = await c.allowance(me, C.router); if (al < amount) await (await c.approve(C.router, ethers.MaxUint256)).wait(); const route = routeFor(x.pairAddr); const ro = new ethers.Contract(C.router, ABI.InkypumpRouter, provider); const g = await ro.sell.estimateGas(addr, amount, route, minEthOut, { from: me }); const r = new ethers.Contract(C.router, ABI.InkypumpRouter, s); return send(() => r.sell(addr, amount, route, minEthOut, { gasLimit: g * 13n / 10n })); },
  async launch(p, devBuyWei) { const s = await signer(); const me = await s.getAddress(); const f = new ethers.Contract(C.factory, ABI.InkypumpFactory, s); const salt = ethers.hexlify(ethers.randomBytes(32)); const route = routeFor(p.pair);
    const params = { name: p.name, symbol: p.symbol, metadataURI: p.metadataURI, pair: p.pair, minPairOut: p.minPairOut || 0, basket: p.basket || [], holderRewards: !!p.holderRewards };
    // estimate on our own RPC first: a wallet that cannot estimate shows a useless generic error
    let gas; try { gas = await new ethers.Contract(C.factory, ABI.InkypumpFactory, provider).launch.estimateGas(params, salt, route, { from: me, value: devBuyWei || 0n }); }
    catch (e) { const m = String(e && (e.shortMessage || e.message) || e); if (/insufficient funds/i.test(m)) throw new Error('Not enough ETH in the wallet for the launch');
      if (p.metadataURI.length > 6000) throw new Error('Logo too large to store on-chain (' + Math.round(p.metadataURI.length / 1024) + ' KB). Pick a smaller image.');
      throw new Error('The launch would fail: ' + (m.length > 120 ? m.slice(0, 120) + '…' : m)); }
    if (gas > 25_000_000n) throw new Error('Launch needs too much gas for one block; use a smaller logo');
    const rc = await send(() => f.launch(params, salt, route, { value: devBuyWei || 0n, gasLimit: gas * 12n / 10n }));
    let token = null; for (const l of rc.logs) { if (lower(l.address) === lower(C.factory) && l.topics[0] === LAUNCH_TOPIC) { token = ethers.getAddress('0x' + l.topics[1].slice(26)); } } return { rc, token }; },
  async claim(addr, mode) { const x = byAddr[lower(addr)]; const s = await signer(); const c = coinOf(addr, s);
    if (mode === 'eth') return send(() => c.claimRewardsAsEth(0, routeFor(x.pairAddr)));
    if (mode === 'basket') { const routes = x.basketAddrs.map(b => routeFor(b)); const mins = x.basketAddrs.map(() => 1n); return send(() => c.claimRewardsAsBasket(routeFor(x.pairAddr), routes, mins)); }
    return send(() => c.claimRewards()); },
  async payCreator(addr) { const s = await signer(); return send(() => coinOf(addr, s).payCreator()); },
  async claimPayout() { const s = await signer(); return send(() => new ethers.Contract(C.payout, ABI.InkypumpPayout, s).claim()); },
  pending: async (addr, user) => coinOf(addr).pendingRewards(user),
  position: async (addr, user) => { const p = await ledger.positions(user, addr); return { units: Number(p.units) / 1e18, basis: Number(p.basis) / 1e18, avg: Number(p.units) > 0 ? Number(p.basis) / Number(p.units) : 0 }; },
  checksum: a => { try { return ethers.getAddress(a); } catch { return a; } },
  isAddress: a => ethers.isAddress(a || ''),
  parseEther: v => ethers.parseEther(String(v)), formatEther: v => ethers.formatEther(v),
  balance: async (addr, user) => coinOf(addr).balanceOf(user),
  ethBalance: async user => provider.getBalance(user),
  creatorFees: async addr => coinOf(addr).creatorFees(),
  // leaderboard for an epoch (current by default)
  async board(epoch) { const cur = Number(await ledger.currentEpoch()); epoch = epoch == null ? cur : epoch; const trades = await allTrades(); const wallets = [...new Set(trades.filter(t => t.epoch === epoch).map(t => t.wallet))];
    const stats = await Promise.all(wallets.map(w => ledger.stats(epoch, w)));
    const rows = wallets.map((w, i) => ({ wallet: w, pnl: Number(stats[i].pnl) / 1e8, fees: Number(stats[i].fees) / 1e8, volume: Number(stats[i].volume) / 1e8, trades: Number(stats[i].trades), best: bestToken(trades, w, epoch) }));
    const [pool, end, isSettled, lastPaid] = await Promise.all([payout.available(), ledger.epochEnd(epoch), epoch < cur ? payout.settled(epoch) : false, cur > 0 ? payout.paidInEpoch(cur - 1) : 0n]);
    const q = rows.filter(r => r.volume >= 100);
    return { epoch, current: cur, pool: Number(pool) / 1e18, ends: Number(end), settled: !!isSettled, lastPaid: Number(lastPaid) / 1e18, rows, traders: wallets.length,
      pnl: [...q].sort((a, b) => b.pnl - a.pnl), vol: [...q].sort((a, b) => b.fees - a.fees) }; },
  async payoutClaimable(user) { return Number(await payout.claimable(user)) / 1e18; },
  async profile(user) { user = lower(user); const trades = await allTrades(); const mine = trades.filter(t => t.wallet === user);
    const held = await Promise.all(tokens.map(async x => { const [bal, pend] = await Promise.all([coinOf(x.addr).balanceOf(user), coinOf(x.addr).pendingRewards(user)]); return { x, bal: Number(bal) / 1e18, pend: Number(pend) / 1e18, pendUsd: Number(pend) / 1e18 * x.pairUsd }; }));
    const created = await Promise.all(tokens.filter(x => x.creator === user).map(async x => ({ x, fees: Number(await coinOf(x.addr).creatorFees()) / 1e18 })));
    const [pos, claims, payoutClaimable, cur, lpnl, lfees] = await Promise.all([Promise.all(tokens.map(x => ledger.positions(user, x.addr))), fetchLogs(null, [CLAIM_TOPIC, ethers.zeroPadValue(user, 32)], CFG.deployBlock || 1, 'latest').catch(() => []), payout.claimable(user), ledger.currentEpoch(), ledger.lifetimePnl(user), ledger.lifetimeFees(user)]);
    const st = await ledger.stats(cur, user);
    return { trades: mine, holdings: held.filter(h => h.bal > 0 || h.pend > 0).map(h => { const p = pos[tokens.indexOf(h.x)]; return { ...h, avg: Number(p.units) > 0 ? Number(p.basis) / Number(p.units) : 0 }; }), created, payoutClaimable: Number(payoutClaimable) / 1e18,
      epoch: { n: Number(cur), pnl: Number(st.pnl) / 1e8, fees: Number(st.fees) / 1e8, volume: Number(st.volume) / 1e8, trades: Number(st.trades) }, lifetimePnl: Number(lpnl) / 1e8, lifetimeFees: Number(lfees) / 1e8,
      claims: claims.map(l => { const d = iface.InkypumpToken.decodeEventLog('RewardsClaimed', l.data, l.topics); return { token: lower(l.address), amount: Number(d.amount) / 1e18, payout: Number(d.payout), ts: l.timeStamp, tx: l.txHash }; }) }; },
  // candles for the chart: resolution in seconds; prices in pair units
  // candles in pair units per coin, continuous from launch (flat bars carry the last price), volume in pair units
  async bars(addr, res, from, to) { const x = byAddr[lower(addr)]; if (!x) return []; const all = (await allTrades()).filter(t => t.token === lower(addr)); const start = Math.floor(x.createdAt / res) * res; const end = Math.min(to, now() + 1);
    if (to <= start) return []; let last = 3000 / SUPPLY / x.pairUsd; const by = {}; let i = 0;
    for (; i < all.length && all[i].ts < Math.max(from, start); i++) { const p = tradePrice(all[i]); if (p > 0) last = p; }
    const out = []; for (let b = Math.max(start, Math.floor(from / res) * res); b < end; b += res) { const bar = { time: b, open: last, high: last, low: last, close: last, volume: 0 };
      for (; i < all.length && all[i].ts < b + res; i++) { if (all[i].ts < b) continue; const p = tradePrice(all[i]); if (!(p > 0)) continue; bar.high = Math.max(bar.high, p); bar.low = Math.min(bar.low, p); bar.close = p; bar.volume += Number(all[i].pair) / 1e18; last = p; }
      out.push(bar); }
    return out; },
  lastPrice(addr) { const x = byAddr[lower(addr)]; return x ? x.pxPair : 0; },
};
window.CHAIN = api;
if (C.factory) { api.ready = api.load().catch(e => { console.error('chain load failed', e); window.dispatchEvent(new CustomEvent('chain-error', { detail: String(e && e.message || e) })); }); }
function bestToken(trades, w, epoch) { const by = {}; for (const t of trades) if (t.wallet === w && t.epoch === epoch) by[t.token] = (by[t.token] || 0) + Number(t.pair); let b = null; for (const k in by) if (!b || by[k] > by[b]) b = k; return b; }
