/* Anypair chain layer: reads Base straight from the browser (ethers v6) and sends
   transactions through the connected wallet (window.apWallet). Exposes window.AP. */
import { ethers } from 'ethers';
import ABI from './abi.json';

const CFG = window.ANYPAIR || {};
const C = CFG.contracts || {};
const CHAIN_ID = CFG.chainId || 8453;
const EXPLORER = CFG.explorer || 'https://basescan.org';
const SCOUT = CFG.blockscout === undefined ? 'https://base.blockscout.com' : CFG.blockscout; // logs + holders API ('' on a local fork)
const WETH = lower(CFG.weth || '0x4200000000000000000000000000000000000006');
const USDC = lower(CFG.usdc || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const PM = CFG.poolManager || '0x498581fF718922c3f8e6A244956aF099B2652b2b';
const STATE_VIEW = CFG.stateView || '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71';
const DEX = CFG.dexes || {};
const UNI_V3 = DEX.uniV3Factory || '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const PANCAKE = DEX.pancakeV3Factory || '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
const SLIP = [DEX.slipstreamFactory || '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A', DEX.slipstreamFactory2 || '0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a'];
const AERO_F = DEX.aeroFactory || '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const USDC_WETH_POOL = '0xd0b53D9277642d899DF5C87A3966A349A798F224'; // Uniswap V3 0.05%, the WETH -> USDC first hop
const SUPPLY = 1e9;
const BPS = 10000n;
const Q96 = 1n << 96n;
const BLOCK_SECS = 2;
export const DEX_NAMES = { 1: 'Uniswap V3', 2: 'PancakeSwap V3', 3: 'Aerodrome Slipstream', 4: 'Aerodrome', 5: 'Uniswap V4' };
const KEY_T = 'tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const HOP_T = `tuple(uint8 dex,address pool,${KEY_T} key)[]`;
const ZERO_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };

function lower(a) { return (a || '').toLowerCase(); }

// ---------------------------------------------------------------- RPC: round robin with per-node batch caps and cool-down
const RPCS = [...new Set([CFG.rpc || 'https://mainnet.base.org', ...(CFG.rpcs || [])])];
const CAP = { 'mainnet.base.org': 10, 'base-rpc.publicnode.com': 20, 'base.drpc.org': 3, '127.0.0.1:8545': 50, 'localhost:8545': 50 };
const capOf = u => { try { return CAP[new URL(u).host] || 10; } catch { return 10; } };
let rr = 0; const cool = {};
class RotatingProvider extends ethers.JsonRpcProvider {
  constructor(urls) { super(urls[0], { chainId: CHAIN_ID, name: 'base' }, { staticNetwork: true, batchMaxCount: 20, batchStallTime: 12 }); this.urls = urls; }
  async _post(url, items) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(items.length === 1 ? items[0] : items) });
    if (r.status === 429 || r.status >= 500) throw Object.assign(new Error('http ' + r.status), { limited: true });
    const j = await r.json(); const arr = Array.isArray(j) ? j : [j];
    if (arr.some(x => x && x.error && /limit|rate|too many|batch/i.test(String(x.error.message)))) throw Object.assign(new Error('rate limited'), { limited: true });
    return arr;
  }
  async _chunk(items) {
    let last;
    for (let round = 0; round < 4; round++) {
      if (round) await new Promise(r => setTimeout(r, 400 * round));
      const order = this.urls.map((_, i) => this.urls[(rr + i) % this.urls.length]); rr++;
      const t = Date.now(); const live = order.filter(u => !(cool[u] > t) && capOf(u) >= items.length);
      for (const u of (live.length ? live : order)) { if (capOf(u) < items.length) continue; try { return await this._post(u, items); } catch (e) { last = e; if (e.limited) cool[u] = Date.now() + 15000; } }
    }
    throw last || new Error('all RPCs failed');
  }
  async _send(payload) {
    const items = Array.isArray(payload) ? payload : [payload];
    if (items.length <= 3) return this._chunk(items);
    const parts = []; for (let i = 0; i < items.length; i += 10) parts.push(items.slice(i, i + 10));
    return (await Promise.all(parts.map(p => this._chunk(p)))).flat();
  }
}
const provider = new RotatingProvider(RPCS);
const I = Object.fromEntries(Object.entries(ABI).map(([k, v]) => [k, new ethers.Interface(v)]));
const K = (addr, abi, runner) => new ethers.Contract(addr, ABI[abi], runner || provider);
// before launch (no contracts yet) the site still reads real Base data: prices, pools
const PRELAUNCH = !C.factory;
const factory = PRELAUNCH ? null : K(C.factory, 'AnypairFactory');
const oracle = PRELAUNCH ? null : K(C.oracle, 'AnypairOracle');
const hook = PRELAUNCH ? null : K(C.hook, 'AnypairHook');
const ETH_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
const MIN_DEPTH_PRE = 2500;
const pm = K(PM, 'PoolManager');
const stateView = K(STATE_VIEW, 'StateView');
const coinOf = (a, r) => K(a, 'AnypairToken', r);
const erc20 = (a, r) => K(a, 'ERC20', r);

// ---------------------------------------------------------------- small helpers
const memo = {}; const cached = async (k, ttl, fn) => { const m = memo[k]; if (m && m.t + ttl > Date.now()) return m.v; const v = await fn(); memo[k] = { v, t: Date.now() }; return v; };
const retry = async (fn, n = 3) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (err) { e = err; await new Promise(r => setTimeout(r, 400 * (i + 1))); } } throw e; };
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
function parseMeta(s) { try { const j = JSON.parse(s || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
const bn = v => BigInt(v);
// chain time: a fork can run ahead of the wall clock, so "now" follows the head block
let head = { n: 0, ts: 0, at: 0 };
async function headBlock(force) { if (force || !head.at || Date.now() - head.at > 15000) { const b = await provider.getBlock('latest'); head = { n: b.number, ts: b.timestamp, at: Date.now() }; } return head; }
const nowTs = () => head.ts ? head.ts + Math.floor((Date.now() - head.at) / 1000) : Math.floor(Date.now() / 1000);
const tsOf = n => head.ts - (head.n - n) * BLOCK_SECS;

// ---------------------------------------------------------------- token info (pairs, basket assets)
const KNOWN = Object.fromEntries((CFG.tokens || []).map(t => [lower(t.address), t]));
KNOWN[WETH] = { ...(KNOWN[WETH] || {}), address: WETH, symbol: 'ETH', name: 'Ether', decimals: 18, logo: (KNOWN[WETH] || {}).logo || '/img/eth.svg' };
const infoCache = LS.get('ap:info') || {};
async function tokenInfo(addr) {
  const a = lower(addr); if (KNOWN[a] && KNOWN[a].decimals != null) return { ...KNOWN[a], address: a };
  if (infoCache[a]) return infoCache[a];
  const t = erc20(a); const [symbol, name, decimals] = await Promise.all([t.symbol().catch(() => '?'), t.name().catch(() => ''), t.decimals().catch(() => 18)]);
  const info = { address: a, symbol, name, decimals: Number(decimals), logo: (KNOWN[a] || {}).logo || twLogo(a) };
  infoCache[a] = info; LS.set('ap:info', infoCache); return info;
}
function twLogo(a) { try { return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${ethers.getAddress(a)}/logo.png`; } catch { return ''; } }

// ---------------------------------------------------------------- prices
// oracle.price: USD with 18 dp per 1e18 base units. usdOf -> USD per whole token.
async function usdOf(addr) {
  const a = lower(addr); const info = await tokenInfo(a);
  if (PRELAUNCH) return cached('usd:' + a, 60000, async () => { if (a === USDC) return 1; if (a !== WETH) throw new Error('No price before launch'); const r = await new ethers.Contract(ETH_FEED, ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'], provider).latestRoundData(); return Number(r[1]) / 1e8; });
  return cached('usd:' + a, a === WETH || a === USDC ? 60000 : 120000, async () => { const px = await oracle.price(a); return Number(px) / 1e18 * 10 ** info.decimals / 1e18; });
}
const ethUsd = () => usdOf(WETH);

// ---------------------------------------------------------------- pool state (V4 StateLibrary slot layout)
function poolSlot(id) { return ethers.keccak256(ethers.concat([id, ethers.zeroPadValue('0x06', 32)])); }
async function poolState(id) {
  const base = BigInt(poolSlot(id));
  const [s0, liq] = await Promise.all([pm.extsload(ethers.toBeHex(base, 32)), pm.extsload(ethers.toBeHex(base + 3n, 32))]);
  const v = BigInt(s0); const sqrtPriceX96 = v & ((1n << 160n) - 1n); let tick = Number((v >> 160n) & 0xffffffn); if (tick >= 0x800000) tick -= 0x1000000;
  return { sqrtPriceX96, tick, liquidity: BigInt(liq) & ((1n << 128n) - 1n) };
}
// whole pair tokens per whole coin
function pairPerCoin(sqrtPriceX96, tokenIs0, pairDec) { const p = Number(sqrtPriceX96) / 2 ** 96; const raw1per0 = p * p; const raw = tokenIs0 ? raw1per0 : 1 / raw1per0; return raw * 10 ** (18 - pairDec); }
function tickSqrt(t) { return BigInt(Math.floor(Math.pow(1.0001, t / 2) * 2 ** 96)); }
function pairInRange(st, pos, tokenIs0) {
  const L = BigInt(pos.liquidity); if (L === 0n) return 0n;
  const sp = st.sqrtPriceX96, lo = tickSqrt(pos.tickLower), hi = tickSqrt(pos.tickUpper); const s = sp < lo ? lo : sp > hi ? hi : sp;
  return tokenIs0 ? L * (s - lo) / Q96 : L * (hi - s) * Q96 / (hi * s);
}

// ---------------------------------------------------------------- logs: RPC for recent ranges, Blockscout for history
const SWAP_TOPIC = I.PoolManager.getEvent('Swap').topicHash;
const INIT_TOPIC = I.PoolManager.getEvent('Initialize').topicHash;
const CLAIM_TOPIC = I.AnypairToken.getEvent('RewardsClaimed').topicHash;
const TRANSFER_TOPIC = I.ERC20.getEvent('Transfer').topicHash;
const LOG_SPAN = CFG.logSpan || 9000;
async function rpcLogs(address, topics, from, to) {
  const out = [];
  for (let a = from; a <= to; a += LOG_SPAN) {
    const b = Math.min(to, a + LOG_SPAN - 1);
    const ls = await retry(() => provider.getLogs({ address, topics, fromBlock: a, toBlock: b }));
    for (const l of ls) out.push({ address: lower(l.address), topics: l.topics, data: l.data, block: l.blockNumber, tx: l.transactionHash, index: l.index });
  }
  return out;
}
async function scoutLogs(address, topics, from, to) {
  const t = topics.map((x, i) => x && !Array.isArray(x) ? `&topic${i}=${x}` : '').join('') + (topics.filter(Boolean).length > 1 ? '&topic0_1_opr=and&topic0_2_opr=and' : '');
  const r = await fetch(`${SCOUT}/api?module=logs&action=getLogs&fromBlock=${from}&toBlock=${to}&address=${address}${t}`, { cache: 'no-store' });
  const j = await r.json();
  if (j.status === '0' && /no records/i.test(j.message || '')) return [];
  if (j.status !== '1' || !Array.isArray(j.result)) throw new Error('explorer logs unavailable');
  return j.result.map(l => ({ address: lower(l.address), topics: l.topics.filter(Boolean), data: l.data, block: Number(l.blockNumber), tx: l.transactionHash, index: Number(l.logIndex || 0) }));
}
async function getLogs(address, topics, from, to) {
  if (to - from <= LOG_SPAN * 6 || !SCOUT) return rpcLogs(address, topics, from, to);
  // older history from the explorer, one topic set at a time; the last few hours from the RPC
  const split = to - LOG_SPAN * 3; const multi = topics.find(Array.isArray);
  const sets = multi ? multi.map(v => topics.map(x => x === multi ? v : x)) : [topics];
  const old = (await Promise.all(sets.map(ts => scoutLogs(address, ts, from, split).catch(() => rpcLogs(address, ts, from, split))))).flat();
  return [...old, ...await rpcLogs(address, topics, split + 1, to)];
}

// ---------------------------------------------------------------- trades from the PoolManager's Swap events
let trades = LS.get('ap:trades:' + lower(C.factory)) || { last: (CFG.deployBlock || 1) - 1, items: [] };
const tradersAt = {};
async function syncTrades(ids) {
  return cached('trades', 8000, async () => {
    const h = await headBlock(); if (!ids.length || h.n <= trades.last) return trades.items;
    const byId = Object.fromEntries(Object.values(statics).map(s => [s.poolId, s]));
    const logs = await getLogs(PM, [SWAP_TOPIC, ids], trades.last + 1, h.n);
    const seen = new Set(trades.items.map(x => x.tx + ':' + x.i));
    for (const l of logs) {
      const k = l.tx + ':' + l.index; if (seen.has(k)) continue; const s = byId[l.topics[1]]; if (!s) continue;
      const d = I.PoolManager.decodeEventLog('Swap', l.data, l.topics);
      const pairAmt = s.tokenIs0 ? d.amount1 : d.amount0, coinAmt = s.tokenIs0 ? d.amount0 : d.amount1;
      trades.items.push({ token: s.addr, buy: pairAmt < 0n, pair: (pairAmt < 0n ? -pairAmt : pairAmt).toString(), coin: (coinAmt < 0n ? -coinAmt : coinAmt).toString(), sqrt: d.sqrtPriceX96.toString(), block: l.block, ts: tsOf(l.block), tx: l.tx, i: l.index });
    }
    // a local fork jumps time between blocks: read real block times there
    if (CFG.exactTimes) { const need = [...new Set(trades.items.filter(t => !t.exact).map(t => t.block))]; const bs = await Promise.all(need.map(n => provider.getBlock(n))); const at = Object.fromEntries(bs.map(b => [b.number, b.timestamp])); for (const t of trades.items) if (!t.exact && at[t.block]) { t.ts = at[t.block]; t.exact = true; } }
    trades.items.sort((a, b) => a.block - b.block || a.i - b.i); trades.last = h.n;
    if (trades.items.length > 6000) trades.items = trades.items.slice(-6000);
    LS.set('ap:trades:' + lower(C.factory), trades); return trades.items;
  });
}
// the wallet behind a trade is the transaction's signer (a router or bot shows as the wallet that sent it)
async function tradersFor(list) {
  const need = [...new Set(list.map(t => t.tx).filter(tx => !tradersAt[tx]))].slice(0, 60);
  const txs = await Promise.all(need.map(h => provider.getTransaction(h).catch(() => null)));
  need.forEach((h, i) => { if (txs[i]) tradersAt[h] = lower(txs[i].from); });
  return list.map(t => ({ ...t, wallet: tradersAt[t.tx] || '' }));
}

// ---------------------------------------------------------------- coins
const statics = LS.get('ap:static:' + lower(C.factory)) || {};
let tokens = [], byAddr = {};
async function loadStatic(a) {
  const al = lower(a); if (statics[al]) return statics[al];
  const c = coinOf(a);
  const [L, meta, name, symbol, basket, holderBps, creatorBps, pos] = await Promise.all([factory.listings(a), factory.metadataOf(a).catch(() => ''), c.name(), c.symbol(), c.basketAssets(), c.holderBps(), c.creatorBps(), factory.positions(a)]);
  const pair = lower(L.pair); const m = parseMeta(meta); const pinfo = await tokenInfo(pair); const binfo = await Promise.all(basket.map(b => tokenInfo(b)));
  const s = statics[al] = {
    addr: al, name, symbol, pair, pairSym: pinfo.symbol, pairDec: pinfo.decimals, pairLogo: pinfo.logo, tokenIs0: al < pair, poolId: L.poolId, createdAt: Number(L.createdAt), creator: lower(L.creator),
    basket: binfo.map(b => ({ address: b.address, symbol: b.symbol, logo: b.logo, decimals: b.decimals })), holderBps: Number(holderBps), creatorBps: Number(creatorBps),
    img: m.image || '', desc: m.description || '', links: { web: m.website || '', x: m.x || m.twitter || '', tg: m.telegram || '' }, routes: m.routes || {},
    pos: { tickLower: Number(pos.tickLower), tickUpper: Number(pos.tickUpper), liquidity: pos.liquidity.toString() },
  };
  LS.set('ap:static:' + lower(C.factory), statics); return s;
}
function coinStats(s, st, pUsd, list) {
  const pxPair = pairPerCoin(st.sqrtPriceX96, s.tokenIs0, s.pairDec); const px = pxPair * pUsd; const t0 = nowTs();
  const tt = list.filter(t => t.token === s.addr);
  const amt = t => Number(t.pair) / 10 ** s.pairDec;
  const priceAt = t => pairPerCoin(BigInt(t.sqrt), s.tokenIs0, s.pairDec);
  const vol = w => tt.filter(t => t.ts >= t0 - w).reduce((x, t) => x + amt(t) * pUsd, 0);
  const chg = w => { const past = [...tt].reverse().find(t => t.ts <= t0 - w); const base = past ? priceAt(past) * pUsd : (s.createdAt > t0 - w ? 3000 / SUPPLY : px); return base > 0 ? (px / base - 1) * 100 : 0; };
  const spark = []; for (let k = 23; k >= 0; k--) { const at = t0 - k * 3600; const p = [...tt].reverse().find(t => t.ts <= at); spark.push(p ? priceAt(p) * pUsd : (s.createdAt <= at ? 3000 / SUPPLY : null)); }
  const liqPair = Number(pairInRange(st, s.pos, s.tokenIs0)) / 10 ** s.pairDec;
  return { px, pxPair, pairUsd: pUsd, mc: px * SUPPLY, vol24: vol(86400), volAll: tt.reduce((x, t) => x + amt(t) * pUsd, 0), tx24: tt.filter(t => t.ts >= t0 - 86400).length, trades: tt.length,
    c1: chg(3600), c24: chg(86400), liq: liqPair * pUsd, liqPair, spark, lastTrade: tt.length ? tt[tt.length - 1].ts : s.createdAt };
}
async function loadOne(a, list) {
  const s = await loadStatic(a);
  const [hidden, st, pUsd, thr, tcf] = await Promise.all([factory.hidden(a), poolState(s.poolId), usdOf(s.pair), coinOf(a).totalHolderRewards(), coinOf(a).totalCreatorFees()]);
  return { ...s, hidden, sqrtPriceX96: st.sqrtPriceX96.toString(), ...coinStats(s, st, pUsd, list), totalHolderRewards: Number(thr) / 10 ** s.pairDec, totalCreatorFees: Number(tcf) / 10 ** s.pairDec };
}
async function loadAll() {
  await headBlock(true);
  const n = Number(await factory.totalTokens());
  const addrs = await Promise.all([...Array(n)].map((_, i) => factory.allTokens(i)));
  await Promise.all(addrs.map(loadStatic));
  const list = await syncTrades(addrs.map(a => statics[lower(a)].poolId));
  const out = await Promise.all(addrs.map(a => loadOne(a, list)));
  tokens = out.reverse(); byAddr = Object.fromEntries(tokens.map(x => [x.addr, x]));
  LS.set('ap:snap:' + lower(C.factory), { at: Date.now(), head, tokens });
  return tokens;
}
function loadSnapshot() { const s = LS.get('ap:snap:' + lower(C.factory)); if (!s || !Array.isArray(s.tokens) || !s.tokens.length) return false; tokens = s.tokens; byAddr = Object.fromEntries(tokens.map(x => [x.addr, x])); if (s.head && !head.at) head = { ...s.head, at: Date.now() - (Date.now() - s.at) }; return true; }

// holders: the explorer when there is one, else balances rebuilt from Transfer events
async function holders(addr, limit = 40) {
  const a = lower(addr);
  if (SCOUT) { try { const r = await fetch(`${SCOUT}/api/v2/tokens/${a}/holders`, { cache: 'no-store' }); const j = await r.json(); return (j.items || []).slice(0, limit).map(h => ({ wallet: lower(h.address && h.address.hash), bal: Number(h.value) / 1e18 })); } catch {} }
  const x = byAddr[a]; const h = await headBlock(); const logs = await rpcLogs(a, [TRANSFER_TOPIC], (CFG.deployBlock || 1), h.n); const bal = {};
  for (const l of logs) { const d = I.ERC20.decodeEventLog('Transfer', l.data, l.topics); const v = Number(d.value) / 1e18; bal[lower(d.from)] = (bal[lower(d.from)] || 0) - v; bal[lower(d.to)] = (bal[lower(d.to)] || 0) + v; }
  delete bal[ethers.ZeroAddress]; delete bal[lower(PM)];
  return Object.entries(bal).filter(([, v]) => v > 1e-6).sort((p, q) => q[1] - p[1]).slice(0, limit).map(([wallet, b]) => ({ wallet, bal: b, pool: false, creator: x && wallet === x.creator }));
}

// ---------------------------------------------------------------- quotes
async function feeBps(x) { try { const [total] = await hook.feeBpsNow(x.poolId, C.router); return BigInt(total); } catch { return 200n; } }
async function quoteCoinOut(x, pairIn) { // pair base units in -> coin wei out (the factory's range)
  const st = await poolState(x.poolId); const L = BigInt(x.pos.liquidity); if (!L) return 0n; const net = pairIn - pairIn * await feeBps(x) / BPS; const sp = st.sqrtPriceX96;
  if (x.tokenIs0) { const sn = sp + net * Q96 / L; return L * Q96 * (sn - sp) / (sn * sp); }
  const sn = L * sp * Q96 / (L * Q96 + net * sp); return L * (sp - sn) / Q96;
}
async function quotePairOut(x, coinIn) {
  const st = await poolState(x.poolId); const L = BigInt(x.pos.liquidity); if (!L) return 0n; const sp = st.sqrtPriceX96; let out;
  if (x.tokenIs0) { const sn = L * sp * Q96 / (L * Q96 + coinIn * sp); out = L * (sp - sn) / Q96; } else { const sn = sp + coinIn * Q96 / L; out = L * Q96 * (sn - sp) / (sn * sp); }
  return out - out * await feeBps(x) / BPS;
}
// ETH <-> pair at oracle prices less the route's pool fees (a slippage guard covers the rest)
async function ethToPairEst(x, wei) { if (x.pair === WETH) return wei; const [e, p] = await Promise.all([ethUsd(), usdOf(x.pair)]); const f = await routeFeeBps(x.pair); const whole = Number(wei) / 1e18 * e / p * (1 - f / 1e4); return BigInt(Math.floor(whole * 10 ** x.pairDec)); }
async function pairToEthEst(x, amt) { if (x.pair === WETH) return amt; const [e, p] = await Promise.all([ethUsd(), usdOf(x.pair)]); const f = await routeFeeBps(x.pair); const eth = Number(amt) / 10 ** x.pairDec * p / e * (1 - f / 1e4); return BigInt(Math.floor(eth * 1e18)); }
async function routeFeeBps(t) { return cached('rfee:' + t, 600000, async () => { const hops = await hopsFor(t); let f = 0; for (const h of hops) { if (h.dex === 5) f += Number(h.key.fee) / 100; else if (h.dex === 4) f += 30; else { try { f += Number(await K(h.pool, 'V3Pool').fee()) / 100; } catch { f += 30; } } } return f; }); }

// ---------------------------------------------------------------- routes: WETH -> token hops from the oracle's source
const routeCache = LS.get('ap:routes') || {};
async function v4KeyOf(id) {
  for (const x of Object.values(statics)) { const r = Object.values(x.routes || {}).flat().find(h => h && h.dex === 5 && h.id === id); if (r) return r.key; }
  if (!SCOUT) throw new Error('unknown V4 pool');
  const r = await fetch(`${SCOUT}/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=${PM}&topic0=${INIT_TOPIC}&topic1=${id}&topic0_1_opr=and`); const j = await r.json(); const l = (j.result || [])[0]; if (!l) throw new Error('unknown V4 pool');
  const d = I.PoolManager.decodeEventLog('Initialize', l.data, l.topics.filter(Boolean)); return { currency0: d.currency0, currency1: d.currency1, fee: Number(d.fee), tickSpacing: Number(d.tickSpacing), hooks: d.hooks };
}
async function hopsFor(token) {
  const t = lower(token); if (t === WETH) return [];
  if (routeCache[t]) return routeCache[t];
  for (const x of Object.values(statics)) if (x.routes && x.routes[t]) return (routeCache[t] = x.routes[t].map(normHop));
  if (t === USDC) return (routeCache[t] = [{ dex: 1, pool: USDC_WETH_POOL, key: ZERO_KEY }]);
  const s = await oracle.sources(t); const dex = Number(s.dex); if (!dex) throw new Error('No route for ' + t);
  const hop = dex === 5 ? { dex, pool: ethers.ZeroAddress, key: await v4KeyOf(s.v4Id) } : { dex, pool: s.pool, key: ZERO_KEY };
  const hops = lower(s.anchor) === USDC ? [{ dex: 1, pool: USDC_WETH_POOL, key: ZERO_KEY }, hop] : [hop];
  routeCache[t] = hops; LS.set('ap:routes', routeCache); return hops;
}
function normHop(h) { return { dex: Number(h.dex), pool: h.pool || ethers.ZeroAddress, key: h.key ? { currency0: h.key.currency0, currency1: h.key.currency1, fee: Number(h.key.fee), tickSpacing: Number(h.key.tickSpacing), hooks: h.key.hooks } : ZERO_KEY }; }
async function routeFor(token) { const hops = await hopsFor(token); return hops.length ? ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [hops.map(normHop)]) : '0x'; }

// ---------------------------------------------------------------- pair discovery for the launch form
// Every canonical pool of `token` against WETH, native ETH (V4) or USDC, checked by the oracle itself.
const V3_TIERS = [100, 500, 3000, 10000], PCS_TIERS = [100, 500, 2500, 10000];
const V4_KEYS = [[100, 1], [500, 10], [3000, 60], [10000, 200], [30000, 200]];
async function discover(token, from) {
  const t = lower(token); const info = await tokenInfo(t);
  if (t === WETH) return { info, ready: true, listed: true, sources: [] };
  const [listed, src] = PRELAUNCH ? [{ listed: t === USDC }, { dex: 0 }] : await Promise.all([oracle.listed(t), oracle.sources(t)]);
  if (listed.listed || Number(src.dex)) { const hops = await hopsFor(t).catch(() => []); return { info, ready: true, listed: listed.listed, current: Number(src.dex) ? { dex: Number(src.dex), pool: src.pool } : null, hops, sources: [] }; }
  const anchors = [WETH, USDC]; const cands = [];
  const v3 = K(UNI_V3, 'V3Factory'), pcs = K(PANCAKE, 'V3Factory'), aero = K(AERO_F, 'AeroFactory');
  const jobs = [];
  for (const an of anchors) {
    for (const f of V3_TIERS) jobs.push(v3.getPool(t, an, f).then(p => ({ dex: 1, pool: p, anchor: an })));
    for (const f of PCS_TIERS) jobs.push(pcs.getPool(t, an, f).then(p => ({ dex: 2, pool: p, anchor: an })));
    for (const sf of SLIP) for (const ts of [1, 10, 50, 100, 200, 500, 2000]) jobs.push(K(sf, 'SlipFactory').getPool(t, an, ts).then(p => ({ dex: 3, pool: p, anchor: an })).catch(() => ({ pool: ethers.ZeroAddress })));
    jobs.push(aero.getPool(t, an, false).then(p => ({ dex: 4, pool: p, anchor: an })).catch(() => ({ pool: ethers.ZeroAddress })));
  }
  for (const [fee, ts] of V4_KEYS) for (const an of [ethers.ZeroAddress, USDC]) {
    const [c0, c1] = lower(an) < t ? [an, t] : [t, an]; const key = { currency0: c0, currency1: c1, fee, tickSpacing: ts, hooks: ethers.ZeroAddress };
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint24', 'int24', 'address'], [c0, c1, fee, ts, ethers.ZeroAddress]));
    jobs.push(stateView.getLiquidity(id).then(l => l > 0n ? { dex: 5, key, id, anchor: an === ethers.ZeroAddress ? WETH : USDC, v4liq: l } : { pool: ethers.ZeroAddress }).catch(() => ({ pool: ethers.ZeroAddress })));
  }
  for (const r of await Promise.all(jobs.map(j => j.catch(() => ({ pool: ethers.ZeroAddress }))))) if ((r.pool && r.pool !== ethers.ZeroAddress) || r.dex === 5) cands.push(r);
  // depth: the anchor balance the pool holds (V4: virtual reserve), in USD
  const usdAnchor = { [WETH]: await ethUsd(), [USDC]: 1 };
  await Promise.all(cands.map(async c => {
    if (c.dex === 5) { const st = await stateView.getSlot0(c.id); const anchorIs0 = lower(c.key.currency0) !== t; const v = anchorIs0 ? Number(c.v4liq * Q96 / st.sqrtPriceX96) : Number(c.v4liq * st.sqrtPriceX96 / Q96); c.depth = v / 10 ** (c.anchor === USDC ? 6 : 18) * usdAnchor[c.anchor]; c.pool = c.id; }
    else { const b = await erc20(c.anchor).balanceOf(c.pool); c.depth = Number(b) / 10 ** (c.anchor === USDC ? 6 : 18) * usdAnchor[c.anchor]; }
  }));
  cands.sort((a, b) => b.depth - a.depth);
  // the oracle's own checks (canonical pool, minimum depth, price history) decide what can be used
  const okList = [];
  for (const c of cands.slice(0, 6)) {
    const src = { dex: c.dex, pool: c.dex === 5 ? ethers.ZeroAddress : c.pool, key: c.dex === 5 ? c.key : ZERO_KEY };
    if (PRELAUNCH) { if (c.depth >= MIN_DEPTH_PRE) okList.push({ ...c, src }); else c.err = 'Its pools are too thin to price it safely'; continue; }
    try { await oracle.register.staticCall(src, { from: from || ethers.ZeroAddress }); okList.push({ ...c, src }); } catch (e) { c.err = errText(e); }
  }
  const best = okList[0];
  const hops = best ? [...(best.anchor === USDC ? [{ dex: 1, pool: USDC_WETH_POOL, key: ZERO_KEY }] : []), best.src] : [];
  return { info, ready: !!best, sources: best ? [best.src] : [], best, candidates: cands, hops };
}

// ---------------------------------------------------------------- wallet + transactions
function errText(e) {
  const raw = String(e && (e.shortMessage || e.reason || e.message) || e);
  const map = { TooShallow: 'Its pools are too thin to price it safely', NoPrice: 'No price for this token yet', BadSource: 'Not a pool the launchpad can price from', PriceMoving: 'Its price is moving fast right now; try again in a few minutes', Blocked: 'This token is blocked', LaunchesPaused: 'Launches are paused', BuyCap: 'Buys are capped at 3% of supply for the first blocks', HoldCap: 'Wallets are capped at 3% of supply for the first blocks', Slippage: 'Price moved more than your slippage', NotAdmin: 'Only the admin wallet can do this' };
  const data = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
  if (data && typeof data === 'string' && data.length >= 10) { for (const k of ['AnypairFactory', 'AnypairOracle', 'AnypairRouter', 'AnypairToken', 'AnypairHook']) { try { const p = I[k].parseError(data); if (p) return map[p.name] || p.name; } catch {} } }
  for (const k of Object.keys(map)) if (raw.includes(k)) return map[k];
  if (/user rejected|denied|ACTION_REJECTED/i.test(raw)) return 'You rejected the transaction';
  if (/insufficient funds/i.test(raw)) return 'Not enough ETH for this transaction';
  return raw.length > 140 ? raw.slice(0, 140) + '…' : raw;
}
async function signer() {
  const w = window.apWallet; if (!w || !w.connected) throw new Error('Connect a wallet first');
  if (w.chainId && w.chainId !== CHAIN_ID) await w.switchChain();
  const s = await w.getSigner(); if (!s) throw new Error('Wallet not ready'); return s;
}
async function send(build, est) {
  let gas; try { gas = await est(); } catch (e) { throw new Error(errText(e)); }
  try { const tx = await build(gas * 13n / 10n); const rc = await tx.wait(); memo.trades = null; return rc; } catch (e) { throw new Error(errText(e)); }
}
function salt() { return ethers.hexlify(ethers.randomBytes(32)); }

const api = {
  cfg: CFG, weth: WETH, usdc: USDC, explorer: EXPLORER, DEX_NAMES, ready: null, stale: false,
  tokens: () => tokens, token: a => byAddr[lower(a)], nowTs, tokenInfo, usdOf, ethUsd, discover, hopsFor, routeFor, errText,
  isAddress: a => ethers.isAddress(a || ''), checksum: a => { try { return ethers.getAddress(a); } catch { return a; } },
  parseUnits: (v, d) => ethers.parseUnits(String(v), d), formatUnits: (v, d) => ethers.formatUnits(v, d),
  async load() {
    const full = () => retry(loadAll, 2).then(t => { api.stale = false; window.dispatchEvent(new CustomEvent('ap:update')); return t; });
    if (loadSnapshot()) { api.stale = true; full().catch(e => console.warn('refresh', e)); } else await full();
    window.dispatchEvent(new CustomEvent('ap:ready')); return tokens;
  },
  refresh: () => { memo.trades = null; return loadAll().then(t => { window.dispatchEvent(new CustomEvent('ap:update')); return t; }); },
  async trades(addr, limit = 50) { const x = byAddr[lower(addr)]; const list = await syncTrades(tokens.map(t => t.poolId)); const mine = list.filter(t => !addr || t.token === lower(addr)).slice(-limit).reverse(); return tradersFor(mine.map(t => { const s = byAddr[t.token]; const p = pairPerCoin(BigInt(t.sqrt), s.tokenIs0, s.pairDec); return { ...t, pairAmt: Number(t.pair) / 10 ** s.pairDec, coinAmt: Number(t.coin) / 1e18, price: p, usd: Number(t.pair) / 10 ** s.pairDec * s.pairUsd }; })); },
  async bars(addr, res) { // candles in USD per coin, continuous from launch
    const x = byAddr[lower(addr)]; if (!x) return []; const list = (await syncTrades(tokens.map(t => t.poolId))).filter(t => t.token === x.addr);
    const start = Math.floor(x.createdAt / res) * res, end = nowTs(); let last = 3000 / SUPPLY; let i = 0; const out = [];
    for (let b = start; b <= end; b += res) { const bar = { time: b, open: last, high: last, low: last, close: last, value: 0 };
      for (; i < list.length && list[i].ts < b + res; i++) { const p = pairPerCoin(BigInt(list[i].sqrt), x.tokenIs0, x.pairDec) * x.pairUsd; bar.high = Math.max(bar.high, p); bar.low = Math.min(bar.low, p); bar.close = p; bar.value += Number(list[i].pair) / 10 ** x.pairDec * x.pairUsd; last = p; }
      out.push(bar); }
    return out; },
  holders,
  // quotes in wei
  async quoteBuy(addr, ethWei, from) { const x = byAddr[lower(addr)];
    if (from) { try { return await K(C.router, 'AnypairRouter').buy.staticCall(x.addr, await routeFor(x.pair), 0, { from, value: ethWei }); } catch {} }
    return quoteCoinOut(x, await ethToPairEst(x, ethWei)); },
  async quoteSell(addr, coinWei, from) { const x = byAddr[lower(addr)];
    if (from) { try { return await K(C.router, 'AnypairRouter').sell.staticCall(x.addr, coinWei, await routeFor(x.pair), 0, { from }); } catch {} }
    return pairToEthEst(x, await quotePairOut(x, coinWei)); },
  async buy(addr, ethWei, minOut) { const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); const r = K(C.router, 'AnypairRouter', s); const route = await routeFor(x.pair);
    return send(g => r.buy(x.addr, route, minOut, { value: ethWei, gasLimit: g }), () => K(C.router, 'AnypairRouter').buy.estimateGas(x.addr, route, minOut, { from: me, value: ethWei })); },
  async sell(addr, coinWei, minOut) { const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); const c = coinOf(x.addr, s);
    if ((await coinOf(x.addr).allowance(me, C.router)) < coinWei) { const tx = await c.approve(C.router, ethers.MaxUint256); await tx.wait(); }
    const r = K(C.router, 'AnypairRouter', s); const route = await routeFor(x.pair);
    return send(g => r.sell(x.addr, coinWei, route, minOut, { gasLimit: g }), () => K(C.router, 'AnypairRouter').sell.estimateGas(x.addr, coinWei, route, minOut, { from: me })); },
  async launch(p) { // p: {name, symbol, meta (object), pair, basket[], holderRewards, sources[], devBuyWei}
    const s = await signer(); const me = await s.getAddress(); const f = K(C.factory, 'AnypairFactory', s); const sl = salt();
    const params = { name: p.name, symbol: p.symbol, metadataURI: JSON.stringify(p.meta), pair: p.pair, minPairOut: 0, basket: p.basket, holderRewards: p.holderRewards, sources: p.sources.map(normHop) };
    const route = p.pair === WETH ? '0x' : ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [p.pairHops.map(normHop)]);
    const rc = await send(g => f.launch(params, sl, route, { value: p.devBuyWei || 0n, gasLimit: g }), () => K(C.factory, 'AnypairFactory').launch.estimateGas(params, sl, route, { from: me, value: p.devBuyWei || 0n }));
    const topic = I.AnypairFactory.getEvent('Launched').topicHash; let token = null;
    for (const l of rc.logs) if (lower(l.address) === lower(C.factory) && l.topics[0] === topic) token = lower(ethers.getAddress('0x' + l.topics[1].slice(26)));
    return { rc, token }; },
  async claim(addr, mode, minOuts) { const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); const c = coinOf(x.addr, s), cr = coinOf(x.addr);
    if (mode === 'eth') { const r = await routeFor(x.pair); return send(g => c.claimRewardsAsEth(0, r, { gasLimit: g }), () => cr.claimRewardsAsEth.estimateGas(0, r, { from: me })); }
    if (mode === 'basket') { const pr = await routeFor(x.pair); const rs = await Promise.all(x.basket.map(b => routeFor(b.address))); const mins = minOuts || x.basket.map(() => 1n);
      return send(g => c.claimRewardsAsBasket(pr, rs, mins, { gasLimit: g }), () => cr.claimRewardsAsBasket.estimateGas(pr, rs, mins, { from: me })); }
    return send(g => c.claimRewards({ gasLimit: g }), () => cr.claimRewards.estimateGas({ from: me })); },
  async payCreator(addr) { const s = await signer(); const me = await s.getAddress(); return send(g => coinOf(addr, s).payCreator({ gasLimit: g }), () => coinOf(addr).payCreator.estimateGas({ from: me })); },
  pending: async (addr, user) => coinOf(addr).pendingRewards(user),
  balanceOf: async (addr, user) => coinOf(addr).balanceOf(user),
  ethBalance: async user => provider.getBalance(user),
  creatorFees: async addr => coinOf(addr).creatorFees(),
  platformFees: async addr => coinOf(addr).platformFees(),
  async portfolio(user) { user = lower(user); if (PRELAUNCH) return { holdings: [], created: [], claims: [] };
    const rows = await Promise.all(tokens.map(async x => { const [bal, pend] = await Promise.all([coinOf(x.addr).balanceOf(user), coinOf(x.addr).pendingRewards(user)]); return { x, bal: Number(bal) / 1e18, pend: Number(pend) / 10 ** x.pairDec, pendUsd: Number(pend) / 10 ** x.pairDec * x.pairUsd }; }));
    const created = await Promise.all(tokens.filter(x => x.creator === user).map(async x => { const f = await coinOf(x.addr).creatorFees(); return { x, fees: Number(f) / 10 ** x.pairDec, feesUsd: Number(f) / 10 ** x.pairDec * x.pairUsd }; }));
    let claims = []; try { const h = await headBlock(); claims = (await rpcLogs(undefined, [CLAIM_TOPIC, ethers.zeroPadValue(user, 32)], Math.max(CFG.deployBlock || 1, h.n - LOG_SPAN * 20), h.n)).filter(l => byAddr[l.address]).map(l => { const x = byAddr[l.address]; const d = I.AnypairToken.decodeEventLog('RewardsClaimed', l.data, l.topics); return { x, amount: Number(d.amount) / 10 ** x.pairDec, mode: Number(d.payout), ts: tsOf(l.block), tx: l.tx }; }).reverse(); } catch {}
    return { holdings: rows.filter(r => r.bal > 0 || r.pend > 0), created, claims }; },
  // admin (the contracts enforce the admin wallet)
  admin: {
    state: async () => { const [paused, feeRecipient, admin, minDepth] = await Promise.all([factory.launchesPaused(), factory.feeRecipient(), factory.admin(), oracle.minDepthUsd()]); return { paused, feeRecipient, admin: lower(admin), minDepth: Number(minDepth) / 1e18 }; },
    blocked: a => factory.blocked(a), listed: a => oracle.listed(a), source: a => oracle.sources(a),
    async call(target, fn, args) { const s = await signer(); const me = await s.getAddress(); const addr = target === 'oracle' ? C.oracle : C.factory; const abi = target === 'oracle' ? 'AnypairOracle' : 'AnypairFactory';
      return send(g => K(addr, abi, s)[fn](...args, { gasLimit: g }), () => K(addr, abi)[fn].estimateGas(...args, { from: me })); },
  },
};
window.AP = api;
api.prelaunch = PRELAUNCH;
if (PRELAUNCH) { api.ready = Promise.resolve([]); setTimeout(() => window.dispatchEvent(new CustomEvent('ap:ready')), 0); }
else api.ready = api.load().catch(e => { console.error('chain load failed', e); window.dispatchEvent(new CustomEvent('ap:error', { detail: String(e && e.message || e) })); });
