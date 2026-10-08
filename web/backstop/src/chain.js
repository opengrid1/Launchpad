/* Etherhook chain layer: reads Ethereum straight from the browser (ethers v6) and sends transactions
   through the connected wallet (window.bsWallet). Coins come from the factory; history (trades, burns,
   fee splits) from Blockscout's log API with the newest blocks from the RPC. Exposes window.EH. */
import { ethers } from 'ethers';
import ABI from './abi.json';

const CFG = window.BACKSTOP || {};
const C = CFG.contracts || {};
const CHAIN_ID = CFG.chainId || 1;
const SCOUT = CFG.blockscout === undefined ? 'https://eth.blockscout.com' : CFG.blockscout; // '' on a local fork
const WETH = lower(CFG.weth || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
const USDC = lower(CFG.usdc || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const USDT = lower(CFG.usdt || '0xdAC17F958D2ee523a2206206994597C13D831ec7');
const PM = CFG.poolManager || '0x000000000004444c5dc75cB358380D2e3dE08A90';
const STATE_VIEW = CFG.stateView || '0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227';
// first hops out of WETH for stablecoin-anchored pairs: Uniswap V3 0.05% pools
const ANCHOR_HOP = { [USDC]: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', [USDT]: '0x11b815efB8f581194ae79006d24E0d814B7697F6' };
const SUPPLY = 1e9;
const BPS = 10000n;
const Q96 = 1n << 96n;
const BLOCK_SECS = 12;
const KEY_T = 'tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const HOP_T = `tuple(uint8 dex,address pool,${KEY_T} key)[]`;
const ZERO_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
function lower(a) { return (a || '').toLowerCase(); }

// ---------------------------------------------------------------- RPC: rotate public endpoints, cool down the ones that refuse
const RPCS = [...new Set(CFG.rpcs || ['https://ethereum-rpc.publicnode.com'])];
let rr = 0; const cool = {};
class RotatingProvider extends ethers.JsonRpcProvider {
  constructor(urls) { super(urls[0], { chainId: CHAIN_ID, name: 'mainnet' }, { staticNetwork: true, batchMaxCount: 10, batchStallTime: 10 }); this.urls = urls; }
  async _post(url, items) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(items.length === 1 ? items[0] : items) });
    if (!r.ok) throw Object.assign(new Error('http ' + r.status), { limited: true });
    const j = await r.json(); const arr = Array.isArray(j) ? j : [j];
    const bad = arr.find(x => x && x.error && /limit|rate|too many|batch|plan|not supported|exceed|unavailable|archive|token|payload/i.test(String(x.error.message)));
    if (bad) throw Object.assign(new Error('provider refused: ' + String(bad.error.message).slice(0, 80)), { limited: true });
    return arr;
  }
  async _send(payload) {
    const items = Array.isArray(payload) ? payload : [payload]; let last;
    for (let round = 0; round < 3; round++) {
      if (round) await new Promise(r => setTimeout(r, 400 * round));
      const order = this.urls.map((_, i) => this.urls[(rr + i) % this.urls.length]); rr++;
      const t = Date.now(); const live = order.filter(u => !(cool[u] > t));
      for (const u of (live.length ? live : order)) { try { return await this._post(u, items); } catch (e) { last = e; if (e.limited) cool[u] = Date.now() + 15000; } }
    }
    throw last || new Error('No Ethereum RPC answered');
  }
}
const provider = new RotatingProvider(RPCS);
const I = Object.fromEntries(Object.entries(ABI).map(([k, v]) => [k, new ethers.Interface(v)]));
const K = (addr, abi, runner) => new ethers.Contract(addr, ABI[abi], runner || provider);
const LIVE = !!C.factory;
const factory = LIVE ? K(C.factory, 'Factory') : null;
const oracle = LIVE ? K(C.oracle, 'Oracle') : null;
const hook = LIVE ? K(C.hook, 'Hook') : null;
const stateView = K(STATE_VIEW, 'StateView');
const coinOf = (a, r) => K(a, 'Token', r);
const stratOf = (a, r) => K(a, 'Strategy', r);
const erc20 = (a, r) => K(a, 'ERC20', r);

// ---------------------------------------------------------------- helpers
const memo = {}; const cached = async (k, ttl, fn) => { const m = memo[k]; if (m && m.t + ttl > Date.now()) return m.v; const v = await fn(); memo[k] = { v, t: Date.now() }; return v; };
const retry = async (fn, n = 3) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (err) { e = err; await new Promise(r => setTimeout(r, 400 * (i + 1))); } } throw e; };
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const NS = 'eh:' + lower(C.factory) + ':';
function parseMeta(s) { try { const j = JSON.parse(s || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
let head = { n: 0, ts: 0, at: 0 };
async function headBlock(force) { if (force || !head.at || Date.now() - head.at > 15000) { const b = await provider.getBlock('latest'); head = { n: b.number, ts: b.timestamp, at: Date.now() }; } return head; }
const nowTs = () => head.ts ? head.ts + Math.floor((Date.now() - head.at) / 1000) : Math.floor(Date.now() / 1000);
const tsOf = n => head.ts - (head.n - n) * BLOCK_SECS;

// ---------------------------------------------------------------- token info: the configured list, the Ondo stock list, then the chain
const KNOWN = {};
for (const t of CFG.tokens || []) KNOWN[lower(t.address)] = { ...t, address: lower(t.address) };
KNOWN[WETH] = { ...(KNOWN[WETH] || {}), address: WETH, symbol: 'ETH', name: 'Ether', decimals: 18 };
let backing = null; // site/backing.json: Ondo stocks, how each is priced, V4 keys for routes
async function loadBacking() {
  if (backing) return backing;
  try { const r = await fetch('/backing.json'); backing = r.ok ? await r.json() : { tokens: [] }; } catch { backing = { tokens: [] }; }
  for (const t of backing.tokens || []) { const a = lower(t.address); if (!KNOWN[a]) KNOWN[a] = { address: a, symbol: t.symbol, name: t.name, decimals: 18, group: 'Stocks (Ondo)', logo: '' }; }
  return backing;
}
const infoCache = LS.get('eh:info') || {};
async function tokenInfo(addr) {
  const a = lower(addr); if (KNOWN[a] && KNOWN[a].decimals != null) return KNOWN[a];
  if (infoCache[a]) return infoCache[a];
  const t = erc20(a); const [symbol, name, decimals] = await Promise.all([t.symbol().catch(() => '?'), t.name().catch(() => ''), t.decimals().catch(() => 18)]);
  const info = { address: a, symbol, name, decimals: Number(decimals), logo: (KNOWN[a] || {}).logo || '' };
  infoCache[a] = info; LS.set('eh:info', infoCache); return info;
}

// ---------------------------------------------------------------- prices: oracle.price is USD (18 dp) per 1e18 base units
async function usdOf(addr) {
  const a = lower(addr); const info = await tokenInfo(a);
  return cached('usd:' + a, a === WETH ? 60000 : 120000, async () => { const px = await oracle.price(a); return Number(px) / 1e18 * 10 ** info.decimals / 1e18; });
}
const ethUsd = () => (LIVE ? usdOf(WETH) : cached('ethfeed', 60000, async () => { const r = await new ethers.Contract(CFG.ethUsdFeed, ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'], provider).latestRoundData(); return Number(r[1]) / 1e8; }));

// ---------------------------------------------------------------- pool math (coin is 18 decimals)
function pairPerCoin(sqrtPriceX96, tokenIs0, pairDec) { const p = Number(sqrtPriceX96) / 2 ** 96; const raw1per0 = p * p; const raw = tokenIs0 ? raw1per0 : 1 / raw1per0; return raw * 10 ** (18 - pairDec); }
function pairPerCoinAtTick(tick, tokenIs0, pairDec) { const raw1per0 = Math.pow(1.0001, tick); return (tokenIs0 ? raw1per0 : 1 / raw1per0) * 10 ** (18 - pairDec); }
async function poolState(id) { const [s, L] = await Promise.all([stateView.getSlot0(id), stateView.getLiquidity(id)]); return { sqrtPriceX96: s.sqrtPriceX96, tick: Number(s.tick), liquidity: L }; }
// exact for a swap that stays inside the active range: coin out for net pair in, and pair out for coin in
function coinOutFor(st, tokenIs0, net) { const L = st.liquidity; if (!L || net <= 0n) return 0n; const sp = st.sqrtPriceX96;
  if (tokenIs0) { const sn = sp + net * Q96 / L; return amount0Delta(L, sp, sn); } // pay token1 (pair) in: price rises
  const sn = L * sp * Q96 / (L * Q96 + net * sp); return amount1Delta(L, sn, sp); } // pay token0 (pair) in: price falls
function pairOutFor(st, tokenIs0, coinIn) { const L = st.liquidity; if (!L || coinIn <= 0n) return 0n; const sp = st.sqrtPriceX96;
  if (tokenIs0) { const sn = L * sp * Q96 / (L * Q96 + coinIn * sp); return amount1Delta(L, sn, sp); }
  const sn = sp + coinIn * Q96 / L; return amount0Delta(L, sp, sn); }
function amount0Delta(L, a, b) { const lo = a < b ? a : b, hi = a < b ? b : a; return L * Q96 * (hi - lo) / hi / lo; }
function amount1Delta(L, a, b) { const lo = a < b ? a : b, hi = a < b ? b : a; return L * (hi - lo) / Q96; }

// ---------------------------------------------------------------- logs: Blockscout for history, the RPC for the newest blocks
const T = {
  swap: I.PoolManager.getEvent('Swap').topicHash, init: I.PoolManager.getEvent('Initialize').topicHash,
  burned: I.Strategy.getEvent('Burned').topicHash, split: I.Strategy.getEvent('Split').topicHash, lpAdded: I.Strategy.getEvent('LiquidityAdded').topicHash,
  redeemed: I.Strategy.getEvent('Redeemed').topicHash, claimed: I.Token.getEvent('RewardsClaimed').topicHash,
};
const RECENT = 120;
async function rpcLogs(address, topics, from, to) {
  const out = [];
  for (let a = from; a <= to; a += 500) {
    const b = Math.min(to, a + 499);
    const ls = await retry(() => provider.getLogs({ address, topics, fromBlock: a, toBlock: b }), 2);
    for (const l of ls) out.push({ address: lower(l.address), topics: l.topics, data: l.data, block: l.blockNumber, tx: l.transactionHash, index: l.index, ts: null });
  }
  return out;
}
async function scoutLogs(address, topics, from, to) {
  const tq = topics.map((x, i) => x ? `&topic${i}=${x}` : '').join('') + (topics.filter(Boolean).length > 1 ? topics.map((x, i) => x && i ? `&topic0_${i}_opr=and` : '').join('') : '');
  const r = await fetch(`${SCOUT}/api?module=logs&action=getLogs&fromBlock=${from}&toBlock=${to}&address=${address}${tq}`, { cache: 'no-store' });
  const j = await r.json();
  if (j.status === '0' && /no records/i.test(j.message || '')) return [];
  if (j.status !== '1' || !Array.isArray(j.result)) throw new Error('explorer logs unavailable');
  return j.result.map(l => ({ address: lower(l.address), topics: l.topics.filter(Boolean), data: l.data, block: Number(l.blockNumber), tx: l.transactionHash, index: Number(l.logIndex || 0), ts: Number(l.timeStamp) || null }));
}
async function scoutAll(address, topics, from, to) { const r = await scoutLogs(address, topics, from, to); if (r.length < 1000 || to - from < 2) return r; const m = (from + to) >> 1; return [...await scoutAll(address, topics, from, m), ...await scoutAll(address, topics, m + 1, to)]; }
async function getLogs(address, topics, from, to) {
  if (from > to) return [];
  if (!SCOUT || to - from <= RECENT) { const ls = await rpcLogs(address, topics, from, to); for (const l of ls) l.ts = tsOf(l.block); return ls; }
  const split = to - RECENT;
  const old = await scoutAll(address, topics, from, split).catch(() => rpcLogs(address, topics, from, split));
  const seen = new Set(); const all = [...old, ...await rpcLogs(address, topics, split + 1, to).catch(() => [])].filter(l => { const k = l.tx + ':' + l.index; if (seen.has(k)) return false; seen.add(k); return true; });
  for (const l of all) if (!l.ts) l.ts = tsOf(l.block);
  return all.sort((x, y) => x.block - y.block || x.index - y.index);
}

// ---------------------------------------------------------------- routes: WETH -> pair hops from the oracle's source
const v4Keys = {}; // poolId -> PoolKey, from backing.json and Blockscout
async function v4KeyOf(id) {
  if (v4Keys[id]) return v4Keys[id];
  const b = await loadBacking(); for (const t of b.tokens || []) if (t.v4Id === id && t.v4Key) return (v4Keys[id] = t.v4Key);
  if (!SCOUT) throw new Error('unknown V4 pool');
  const ls = await scoutLogs(PM, [T.init, id], 0, 'latest'); if (!ls[0]) throw new Error('unknown V4 pool');
  const d = I.PoolManager.decodeEventLog('Initialize', ls[0].data, ls[0].topics);
  return (v4Keys[id] = { currency0: d.currency0, currency1: d.currency1, fee: Number(d.fee), tickSpacing: Number(d.tickSpacing), hooks: d.hooks });
}
// null: no ETH route (a listed-price token with no pool): such coins trade in the pair token only
async function hopsFor(token) {
  const t = lower(token); if (t === WETH) return [];
  return cached('hops:' + t, 600000, async () => {
    if (ANCHOR_HOP[t]) return [{ dex: 2, pool: ANCHOR_HOP[t], key: ZERO_KEY }];
    const s = await oracle.sources(t); const dex = Number(s.dex); if (!dex) return null;
    const hop = dex === 3 ? { dex, pool: ethers.ZeroAddress, key: await v4KeyOf(s.v4Id) } : { dex, pool: s.pool, key: ZERO_KEY };
    const anchor = lower(s.anchor);
    if (anchor === WETH || anchor === ethers.ZeroAddress) return [hop];
    if (ANCHOR_HOP[anchor]) return [{ dex: 2, pool: ANCHOR_HOP[anchor], key: ZERO_KEY }, hop];
    return null;
  });
}
const encodeRoute = hops => (hops && hops.length ? ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [hops]) : '0x');
async function routeFor(token) { const h = await hopsFor(token); if (h === null) throw new Error('No ETH route for this backing token: trade it in the token itself'); return encodeRoute(h); }

// ---------------------------------------------------------------- coins
const statics = LS.get(NS + 'static') || {};
let tokens = [], byAddr = {}, everyToken = [];
async function loadStatic(a) {
  const al = lower(a); if (statics[al]) return statics[al];
  const c = coinOf(a);
  const L = await factory.listings(a); const s = stratOf(L.strategy);
  const [meta, name, symbol, payout, basket, cfg, bps] = await Promise.all([
    factory.metadataOf(a).catch(() => ''), c.name(), c.symbol(), c.payout(), c.basketAssets().catch(() => []), hook.config(L.poolId),
    Promise.all(['creatorBps', 'holderBps', 'vaultBps', 'buybackBps', 'lpBps', 'burnBps', 'tpBps', 'redeemable', 'vestSecs', 'tokenIsCurrency0'].map(k => s[k]())),
  ]);
  const pair = lower(L.pair); const m = parseMeta(meta); const pinfo = await tokenInfo(pair); const binfo = await Promise.all(basket.map(b => tokenInfo(b)));
  const r = cfg.rules; const [creator, holders, vault, buyback, lp, burn, tpBps, redeemable, vestSecs, tokenIs0] = bps;
  const st = statics[al] = {
    addr: al, name, symbol, pair, pairSym: pinfo.symbol, pairDec: pinfo.decimals, pairLogo: pinfo.logo || '', tokenIs0, poolId: L.poolId, strategy: lower(L.strategy),
    createdAt: Number(L.createdAt), creator: lower(L.creator), tax: Number(L.taxBps),
    split: { creator: Number(creator), holders: Number(holders), vault: Number(vault), buyback: Number(buyback), lp: Number(lp), burn: Number(burn), platform: 100 },
    prot: { mev: r.mev, snipeBps: Number(r.snipeBps), snipeSecs: Number(r.snipeSecs), maxTx: Number(r.maxTxBps), dynMax: Number(r.dynMaxBps), vestDays: Math.round(Number(vestSecs) / 86400) },
    tp: Number(tpBps) / 100, redeem: redeemable, rewards: ['pair', 'eth', 'basket'][Number(payout)] || 'pair',
    basket: binfo.map(b => ({ address: b.address, symbol: b.symbol, logo: b.logo, decimals: b.decimals })),
    img: m.image || '', desc: m.description || '', links: { web: m.website || '', x: m.x || m.twitter || '', tg: m.telegram || '' },
  };
  LS.set(NS + 'static', statics); return st;
}

// history per coin: swaps (trades, chart, volume) and the strategy's events, synced incrementally
const hist = LS.get(NS + 'hist') || {};
async function syncHistory(list) {
  const h = await headBlock(); const from0 = CFG.deployBlock || 1;
  await Promise.all(list.map(async s => {
    const H = hist[s.addr] || (hist[s.addr] = { last: from0 - 1, swaps: [], burns: [], splits: [0, 0, 0, 0, 0, 0, 0], lpAdds: 0 });
    if (h.n <= H.last) return;
    const [sw, ev] = await Promise.all([getLogs(PM, [T.swap, s.poolId], H.last + 1, h.n), getLogs(s.strategy, [], H.last + 1, h.n)]);
    for (const l of sw) {
      const d = I.PoolManager.decodeEventLog('Swap', l.data, l.topics);
      const coinD = s.tokenIs0 ? d.amount0 : d.amount1, pairD = s.tokenIs0 ? d.amount1 : d.amount0;
      // amounts are the swapper's deltas: a buy pays pair (negative) and receives coins (positive)
      H.swaps.push({ ts: l.ts, b: l.block, tx: l.tx, buy: coinD > 0n, coin: Number(coinD < 0n ? -coinD : coinD) / 1e18, pair: Number(pairD < 0n ? -pairD : pairD) / 10 ** s.pairDec, sp: d.sqrtPriceX96.toString() });
    }
    for (const l of ev) {
      let d; try { d = I.Strategy.parseLog({ topics: l.topics, data: l.data }); } catch { continue; }
      if (!d) continue;
      if (d.name === 'Burned') H.burns.push({ ts: l.ts, tx: l.tx, kind: Number(d.args.kind), pair: Number(d.args.pairSpent) / 10 ** s.pairDec, coins: Number(d.args.coinsBurned) / 1e18 });
      else if (d.name === 'Split') { const a = d.args; [a.platform, a.creator, a.holders, a.vault, a.buyback, a.lp, a.burn].forEach((v, i) => { H.splits[i] += Number(v) / 10 ** s.pairDec; }); }
      else if (d.name === 'LiquidityAdded') H.lpAdds++;
    }
    H.last = h.n;
    if (H.swaps.length > 5000) H.swaps = H.swaps.slice(-5000);
  }));
  LS.set(NS + 'hist', hist);
}

function build(s, d) {
  const H = hist[s.addr] || { swaps: [], burns: [], splits: [0, 0, 0, 0, 0, 0, 0], lpAdds: 0 };
  const pUsd = d.pUsd; const pxPair = pairPerCoin(d.st.sqrtPriceX96, s.tokenIs0, s.pairDec); const px = pxPair * pUsd; const t0 = nowTs();
  const supply = Number(d.totalSupply) / 1e18; const amt = (v, dec) => Number(v) / 10 ** dec;
  const sw = H.swaps; const priceAt = x => pairPerCoin(BigInt(x.sp), s.tokenIs0, s.pairDec) * pUsd;
  const vol = w => sw.filter(x => x.ts >= t0 - w).reduce((a, x) => a + x.pair * pUsd, 0);
  const startPx = (CFG.startCap || 5000) / SUPPLY;
  const chg = w => { const past = [...sw].reverse().find(x => x.ts <= t0 - w); const base = past ? priceAt(past) : s.createdAt > t0 - w ? startPx : px; return base > 0 ? (px / base - 1) * 100 : 0; };
  // in-range pair-side depth, both sides counted
  const L = d.st.liquidity; const sp = d.st.sqrtPriceX96; const pairVirt = L ? Number(s.tokenIs0 ? L * sp / Q96 : L * Q96 / sp) / 10 ** s.pairDec : 0;
  const x = { ...s, hidden: d.hidden, px, pxPair, pairUsd: pUsd, supply: SUPPLY, circ: supply, burned: SUPPLY - supply, mc: px * supply, liq: pairVirt * 2 * pUsd,
    c1: chg(3600), c24: chg(86400), vol24: vol(86400), volAll: sw.reduce((a, y) => a + y.pair * pUsd, 0), tx24: sw.filter(y => y.ts >= t0 - 86400).length, txAll: sw.length,
    lastTrade: sw.length ? sw[sw.length - 1].ts : s.createdAt, holders: d.holders || 0, sqrtPriceX96: sp.toString(), liquidity: L.toString() };
  const vaultAmt = amt(d.vault, s.pairDec);
  x.vault = s.split.vault ? { amount: vaultAmt, usd: vaultAmt * pUsd, cost: Number(d.costUsd) / 1e18 + amt(d.vaultUncosted, s.pairDec) * pUsd, perCoin: supply ? vaultAmt * pUsd / supply : 0, perCoinPair: supply ? vaultAmt / supply : 0 } : null;
  if (s.split.buyback) {
    const fundAmt = amt(d.fund, s.pairDec);
    const ref = d.highSet ? pairPerCoinAtTick(d.high, s.tokenIs0, s.pairDec) * pUsd : px;
    const trigger = d.dipArmed ? pairPerCoinAtTick(d.dipLine, s.tokenIs0, s.pairDec) * pUsd : ref * 0.8;
    x.fund = { amount: fundAmt, usd: fundAmt * pUsd, ref, trigger };
  } else x.fund = null;
  const kind1 = H.burns.filter(b => b.kind === 1);
  x.autoBurn = s.split.burn ? { usd: kind1.reduce((a, b) => a + b.pair, 0) * pUsd, coins: kind1.reduce((a, b) => a + b.coins, 0) } : null;
  x.lp = s.split.lp ? { usd: amt(d.totalLpAdded, s.pairDec) * pUsd * 2, adds: H.lpAdds, pending: amt(d.lpPending, s.pairDec) * pUsd } : null;
  const [pl, cr, ho, va, bb, lp, bu] = H.splits.map(v => v * pUsd);
  x.fees = { platform: pl, creator: cr, holders: ho, vault: va, buyback: bb, lp, burn: bu };
  x.creatorEarned = amt(d.creatorEarned, s.pairDec); x.creatorClaimable = amt(d.creatorClaimable, s.pairDec);
  x.events = H.burns.filter(b => b.kind !== 1).map(b => ({ kind: b.kind === 2 ? 'dip' : 'tp', ts: b.ts, usd: b.pair * pUsd, pairAmt: b.pair, burned: b.coins, tx: b.tx })).reverse();
  x.swaps = sw.map(y => ({ t: y.ts, p: priceAt(y), v: y.pair * pUsd, buy: y.buy }));
  x.trades = sw.slice(-60).reverse().map(y => ({ ts: y.ts, side: y.buy ? 'buy' : 'sell', who: '', tx: y.tx, usd: y.pair * pUsd, pairAmt: y.pair, coins: y.coin }));
  x.top = d.top || [];
  x.backedPct = x.vault && px ? x.vault.perCoin / px * 100 : 0;
  x.toTrigger = x.fund && px ? (x.fund.trigger / px - 1) * 100 : null;
  x.burnedUsd = H.burns.reduce((a, b) => a + b.pair, 0) * pUsd;
  return x;
}

async function holdersOf(a) {
  if (!SCOUT) return { count: 0, top: [] };
  return cached('holders:' + a, 60000, async () => {
    const skip = new Set([lower(PM), ethers.ZeroAddress, lower(C.factory), lower(C.hook), lower(C.router)]);
    const s = statics[a]; if (s) skip.add(s.strategy);
    const [cnt, list] = await Promise.all([
      fetch(`${SCOUT}/api/v2/tokens/${a}/counters`).then(r => r.json()).catch(() => ({})),
      fetch(`${SCOUT}/api/v2/tokens/${a}/holders`).then(r => r.json()).catch(() => ({})),
    ]);
    const top = (list.items || []).map(h => ({ addr: lower(h.address && h.address.hash), bal: Number(h.value) / 1e18 })).filter(h => !skip.has(h.addr)).slice(0, 20);
    return { count: Number(cnt.token_holders_count || top.length), top };
  });
}

async function loadOne(s) {
  const c = coinOf(s.addr), g = stratOf(s.strategy);
  const [hidden, st, pUsd, totalSupply, vals, dip, claimable, ho] = await Promise.all([
    factory.hidden(s.addr), poolState(s.poolId), usdOf(s.pair).catch(() => 0), c.totalSupply(),
    Promise.all(['vault', 'fund', 'lpPending', 'creatorEarned', 'costUsd', 'vaultUncosted', 'totalLpAdded', 'high', 'highSet'].map(k => g[k]())),
    g.dipLine().catch(() => [false, 0]), g.creatorClaimable().catch(() => 0n), holdersOf(s.addr).catch(() => ({ count: 0, top: [] })),
  ]);
  const [vault, fund, lpPending, creatorEarned, costUsd, vaultUncosted, totalLpAdded, high, highSet] = vals;
  return build(s, { hidden, st, pUsd, totalSupply, vault, fund, lpPending, creatorEarned, costUsd, vaultUncosted, totalLpAdded, high: Number(high), highSet, dipArmed: dip[0], dipLine: Number(dip[1]), creatorClaimable: claimable, holders: ho.count, top: ho.top });
}
async function loadAll() {
  await headBlock(true); await loadBacking();
  const n = Number(await factory.totalTokens());
  const addrs = await Promise.all([...Array(n)].map((_, i) => factory.allTokens(i)));
  const ss = await Promise.all(addrs.map(loadStatic));
  await syncHistory(ss).catch(e => console.warn('history', e));
  const out = await Promise.all(ss.map(s => loadOne(s).catch(e => { console.warn('coin', s.addr, e); return null; })));
  everyToken = out.filter(Boolean).reverse(); tokens = everyToken.filter(x => !x.hidden); byAddr = Object.fromEntries(everyToken.map(x => [x.addr, x]));
  return tokens;
}

// ---------------------------------------------------------------- quotes (wei / base units)
async function taxBps(x, isBuy, pairAmt) { try { return BigInt(await hook.taxBpsFor(x.poolId, C.router, isBuy, pairAmt)); } catch { return BigInt(x.tax); } }
async function quoteCoinsForPair(x, pairIn) { const st = await poolState(x.poolId); const t = await taxBps(x, true, pairIn); const net = pairIn - pairIn * t / BPS; return { out: coinOutFor(st, x.tokenIs0, net), taxBps: Number(t), fee: pairIn - net }; }
async function quotePairForCoins(x, coinIn) { const st = await poolState(x.poolId); const gross = pairOutFor(st, x.tokenIs0, coinIn); const t = await taxBps(x, false, gross); return { out: gross - gross * t / BPS, taxBps: Number(t), fee: gross * t / BPS }; }
async function ethToPairEst(x, wei) {
  if (x.pair === WETH) return wei;
  try { return await K(C.router, 'Router').ethToPair.staticCall(x.pair, await routeFor(x.pair), WETH, 0, { from: WETH, value: wei }); } // WETH holds plenty of ETH: a free simulation
  catch { const [e, p] = await Promise.all([ethUsd(), usdOf(x.pair)]); return BigInt(Math.floor(Number(wei) / 1e18 * e / p * 0.99 * 10 ** x.pairDec)); }
}
async function pairToEthEst(x, amt) { if (x.pair === WETH) return amt; const [e, p] = await Promise.all([ethUsd(), usdOf(x.pair)]); return BigInt(Math.floor(Number(amt) / 10 ** x.pairDec * p / e * 0.99 * 1e18)); }

// ---------------------------------------------------------------- wallet + transactions
const ERRS = { TooShallow: 'Its pool is too thin to price it safely', NoPrice: 'No price for this token yet', BadSource: 'Not a pool the launchpad can price from', PriceMoving: 'Its price is moving fast right now; try again in a few minutes', Blocked: 'This token is blocked', LaunchesPaused: 'Launches are paused', MaxTx: 'Over the max per trade', OneSwapPerBlock: 'One swap per wallet per block: try again next block', LaunchGuard: 'Only the creator can buy in the launch block', OtherPool: 'This coin only trades in its own pool', Slippage: 'Price moved more than your slippage', NotAdmin: 'Only the admin wallet can do this', InvalidParams: 'Those launch settings are not allowed' };
function errText(e) {
  const raw = String(e && (e.shortMessage || e.reason || e.message) || e);
  const data = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
  if (data && typeof data === 'string' && data.length >= 10) for (const k of ['Factory', 'Oracle', 'Router', 'Token', 'Hook', 'Strategy']) { try { const p = I[k].parseError(data); if (p) return ERRS[p.name] || p.name; } catch {} }
  for (const k of Object.keys(ERRS)) if (raw.includes(k)) return ERRS[k];
  if (/user rejected|denied|ACTION_REJECTED/i.test(raw)) return 'You rejected the transaction';
  if (/insufficient funds/i.test(raw)) return 'Not enough ETH for this transaction';
  return raw.length > 140 ? raw.slice(0, 140) + '…' : raw;
}
async function signer() {
  const w = window.bsWallet; if (!w || !w.connected) { if (w) w.open(); throw new Error('Connect a wallet first'); }
  if (w.chainId && w.chainId !== CHAIN_ID) await w.switchChain();
  const s = await w.getSigner(); if (!s) throw new Error('Wallet not ready'); return s;
}
async function send(build, est) {
  let gas; try { gas = await est(); } catch (e) { throw new Error(errText(e)); }
  try { const tx = await build(gas * 13n / 10n); const rc = await tx.wait(); for (const k of Object.keys(memo)) if (k.startsWith('holders:')) delete memo[k]; return rc; } catch (e) { throw new Error(errText(e)); }
}
async function approveIfNeeded(token, s, me, spender, amount) {
  if ((await erc20(token).allowance(me, spender)) >= amount) return;
  const tx = await erc20(token, s).approve(spender, amount); await tx.wait(); // exact amount, never unlimited
}

const api = {
  cfg: CFG, live: LIVE, weth: WETH, usdc: USDC, ready: null,
  tokens: () => tokens, allTokens: () => everyToken, token: a => byAddr[lower(a)], nowTs, tokenInfo, usdOf, ethUsd, hopsFor, routeFor, errText, known: a => KNOWN[lower(a)], knownList: () => Object.values(KNOWN),
  isAddress: a => ethers.isAddress(a || ''), parseUnits: (v, d) => ethers.parseUnits(String(v), d), formatUnits: (v, d) => ethers.formatUnits(v, d),
  async load() { if (!LIVE) return (tokens = []); await retry(loadAll, 2); window.dispatchEvent(new CustomEvent('bs:update')); return tokens; },
  async trades(addr) { // newest first, with the wallet that sent each
    const x = byAddr[lower(addr)]; if (!x) return [];
    const need = [...new Set(x.trades.filter(t => !t.who).map(t => t.tx))].slice(0, 40);
    const txs = await Promise.all(need.map(h => provider.getTransaction(h).catch(() => null))); const by = {}; need.forEach((h, i) => { if (txs[i]) by[h] = lower(txs[i].from); });
    for (const t of x.trades) if (!t.who && by[t.tx]) t.who = by[t.tx];
    return x.trades;
  },
  // what a pair token needs to back a coin: an oracle price; an ETH route lets buyers pay in ETH
  async pairStatus(addr) {
    const a = lower(addr); await loadBacking(); const info = await tokenInfo(a);
    if (!LIVE) return { ok: false, info, reason: 'The contracts are not live yet.' };
    const [listed, src, blocked] = await Promise.all([oracle.listed(a), oracle.sources(a), factory.blocked(a)]);
    if (blocked) return { ok: false, info, reason: 'This token is blocked.' };
    if (!listed.listed && !Number(src.dex) && a !== WETH) return { ok: false, info, reason: 'The oracle has no price for it. Tokens with a Uniswap pool holding $10,000 or more against ETH or USDC can be added.' };
    let priceUsd = null; try { priceUsd = await usdOf(a); } catch {}
    const hops = await hopsFor(a).catch(() => null);
    const how = a === WETH ? 'Chainlink ETH/USD' : listed.listed ? (listed.feed !== ethers.ZeroAddress ? 'a Chainlink feed' : 'a set price') : ['', 'its Uniswap V2 pool', 'its Uniswap V3 pool', 'its Uniswap V4 pool'][Number(src.dex)];
    return { ok: priceUsd != null, info, priceUsd, how, ethRoute: hops !== null, reason: priceUsd == null ? 'No price right now; try again shortly.' : '' };
  },
  async balances(addr, user) { const x = byAddr[lower(addr)]; const [coin, pair, eth] = await Promise.all([coinOf(x.addr).balanceOf(user), x.pair === WETH ? 0n : erc20(x.pair).balanceOf(user), provider.getBalance(user)]); return { coin, pair, eth }; },
  async quoteBuy(addr, amountIn, withEth) { const x = byAddr[lower(addr)]; const pairIn = withEth ? await ethToPairEst(x, amountIn) : amountIn; const q = await quoteCoinsForPair(x, pairIn); return { ...q, pairIn }; },
  async quoteSell(addr, coinIn, toEth) { const x = byAddr[lower(addr)]; const q = await quotePairForCoins(x, coinIn); return toEth ? { ...q, pairOut: q.out, out: await pairToEthEst(x, q.out) } : { ...q, pairOut: q.out }; },
  async buy(addr, amountIn, minOut, withEth) {
    const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); const r = K(C.router, 'Router', s), rv = K(C.router, 'Router');
    if (withEth) { const route = await routeFor(x.pair); return send(g => r.buy(x.addr, route, minOut, { value: amountIn, gasLimit: g }), () => rv.buy.estimateGas(x.addr, route, minOut, { from: me, value: amountIn })); }
    await approveIfNeeded(x.pair, s, me, C.router, amountIn);
    return send(g => r.buyWithPair(x.addr, amountIn, minOut, { gasLimit: g }), () => rv.buyWithPair.estimateGas(x.addr, amountIn, minOut, { from: me }));
  },
  async sell(addr, coinIn, minOut, toEth) {
    const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); const r = K(C.router, 'Router', s), rv = K(C.router, 'Router');
    await approveIfNeeded(x.addr, s, me, C.router, coinIn);
    if (toEth) { const route = await routeFor(x.pair); return send(g => r.sell(x.addr, coinIn, route, minOut, { gasLimit: g }), () => rv.sell.estimateGas(x.addr, coinIn, route, minOut, { from: me })); }
    return send(g => r.sellForPair(x.addr, coinIn, minOut, { gasLimit: g }), () => rv.sellForPair.estimateGas(x.addr, coinIn, minOut, { from: me }));
  },
  async redeem(addr, coinIn, minOut) {
    const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress();
    await approveIfNeeded(x.addr, s, me, x.strategy, coinIn);
    return send(g => stratOf(x.strategy, s).redeem(coinIn, minOut, me, { gasLimit: g }), () => stratOf(x.strategy).redeem.estimateGas(coinIn, minOut, me, { from: me }));
  },
  redeemQuote: async (addr, coinIn) => { const x = byAddr[lower(addr)]; const [v, sup] = await Promise.all([stratOf(x.strategy).vault(), coinOf(x.addr).totalSupply()]); return sup ? v * coinIn / sup : 0n; },
  pending: async (addr, user) => coinOf(addr).pendingRewards(user),
  async claim(addr) {
    const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); const c = coinOf(x.addr, s), cv = coinOf(x.addr);
    if (x.rewards === 'eth') { const route = await routeFor(x.pair); return send(g => c.claimRewardsAsEth(0, route, { gasLimit: g }), () => cv.claimRewardsAsEth.estimateGas(0, route, { from: me })); }
    return send(g => c.claimRewards({ gasLimit: g }), () => cv.claimRewards.estimateGas({ from: me }));
  },
  async payCreator(addr) { const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); return send(g => stratOf(x.strategy, s).payCreator({ gasLimit: g }), () => stratOf(x.strategy).payCreator.estimateGas({ from: me })); },
  async launch(p) { // {name, symbol, meta, pair, rules, split, options, basket, devBuyWei}
    const s = await signer(); const me = await s.getAddress(); const f = K(C.factory, 'Factory', s), fv = K(C.factory, 'Factory'); const salt = ethers.hexlify(ethers.randomBytes(32));
    const params = { name: p.name, symbol: p.symbol, metadataURI: JSON.stringify(p.meta), pair: p.pair, minPairOut: 0, rules: p.rules, split: p.split, options: p.options, basket: p.basket || [], sources: [] };
    const route = p.devBuyWei && p.pair !== WETH ? await routeFor(p.pair) : '0x';
    const rc = await send(g => f.launch(params, salt, route, { value: p.devBuyWei || 0n, gasLimit: g }), () => fv.launch.estimateGas(params, salt, route, { from: me, value: p.devBuyWei || 0n }));
    const topic = I.Factory.getEvent('Launched').topicHash; let token = null;
    for (const l of rc.logs) if (lower(l.address) === lower(C.factory) && l.topics[0] === topic) token = lower(ethers.getAddress('0x' + l.topics[1].slice(26)));
    LS.set(NS + 'static', statics); return { rc, token };
  },
  async portfolio(user) {
    user = lower(user); if (!LIVE) return { rows: [], created: [] };
    const rows = await Promise.all(tokens.map(async x => { const [bal, pend] = await Promise.all([coinOf(x.addr).balanceOf(user), coinOf(x.addr).pendingRewards(user).catch(() => 0n)]); const b = Number(bal) / 1e18; return { x, bal: b, value: b * x.px, floor: x.vault && x.redeem ? b * x.vault.perCoin : 0, pending: Number(pend) / 10 ** x.pairDec * x.pairUsd }; }));
    const created = tokens.filter(x => x.creator === user).map(x => ({ x, earned: x.creatorEarned * x.pairUsd, unclaimed: x.creatorClaimable * x.pairUsd }));
    return { rows: rows.filter(r => r.bal > 0 || r.pending > 0), created };
  },
  // admin reads and writes (the contracts enforce the admin wallet)
  admin: {
    state: async () => { const [paused, feeRecipient, startCap, lpThr] = await Promise.all([factory.launchesPaused(), factory.feeRecipient(), factory.startCapUsd8(), factory.lpThresholdUsd()]); return { paused, feeRecipient: lower(feeRecipient), startCap: Number(startCap) / 1e8, lpThreshold: Number(lpThr) / 1e18 }; },
    platformOwed: async () => { let total = 0; for (const x of tokens) { try { total += Number(await stratOf(x.strategy).platformOwed()) / 10 ** x.pairDec * x.pairUsd; } catch {} } return total; },
    owedOf: async x => Number(await stratOf(x.strategy).platformOwed()) / 10 ** x.pairDec * x.pairUsd,
    async call(fn, args) { const s = await signer(); const me = await s.getAddress(); return send(g => K(C.factory, 'Factory', s)[fn](...args, { gasLimit: g }), () => K(C.factory, 'Factory')[fn].estimateGas(...args, { from: me })); },
  },
};
api.ready = LIVE ? api.load().catch(e => { console.error('chain load failed', e); window.dispatchEvent(new CustomEvent('bs:chainerror', { detail: String(e && e.message || e) })); return []; }) : Promise.resolve([]);
window.EH = api;
