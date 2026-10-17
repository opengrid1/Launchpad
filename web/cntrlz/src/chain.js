/* cntrl-z.fun chain layer: reads Ethereum straight from the browser (ethers v6) and sends transactions
   through the connected wallet (window.bsWallet). Coins come from the factory; windows, trades and fees
   from the hook's, the router's and the PoolManager's logs (Blockscout for history, the RPC for the newest
   blocks). Exposes window.UD with the same shape the preview data layer has, so the pages don't care. */
import { ethers } from 'ethers';
import ABI from './abi.json';

const CFG = window.UNDO || {};
const C = CFG.contracts || {};
if (C.factory) main();

function main() {
  const CHAIN_ID = CFG.chainId || 1;
  const SCOUT = CFG.blockscout === undefined ? 'https://eth.blockscout.com' : CFG.blockscout; // '' on a local fork
  const WETH = lower(CFG.weth || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const PM = CFG.poolManager || '0x000000000004444c5dc75cB358380D2e3dE08A90';
  const STATE_VIEW = CFG.stateView || '0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227';
  // first hops out of WETH for stablecoin-anchored pairs: Uniswap V3 0.05% pools
  const ANCHOR_HOP = { [USDC]: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', [USDT]: '0x11b815efB8f581194ae79006d24E0d814B7697F6' };
  const SUPPLY = 1e9;
  const BPS = 10000n;
  const Q96 = 1n << 96n;
  const BLOCK_SECS = 12;
  const TAX = { bps: 100, creator: 70, platform: 30, snipeBps: 9000, snipeSecs: 60 };
  const PR = CFG.premium || { refEth: 0.05, baseH: 6, minH: 0.5, maxH: 168, maxBps: 3000 };
  const KEY_T = 'tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
  const HOP_T = `tuple(uint8 dex,address pool,${KEY_T} key)[]`;
  const ZERO_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };

  // ---------------------------------------------------------------- RPC: rotate public endpoints, cool down the ones that refuse
  const RPCS = [...new Set(CFG.rpcs || ['https://ethereum-rpc.publicnode.com'])];
  let rr = 0; const cool = {};
  const realError = x => x && x.error && (x.error.code === 3 || /revert/i.test(String(x.error.message)) || x.error.data);
  async function injected() { const e = window.ethereum; if (!e || !e.request) return null; try { return Number(await e.request({ method: 'eth_chainId' })) === CHAIN_ID ? e : null; } catch { return null; } }
  class RotatingProvider extends ethers.JsonRpcProvider {
    constructor(urls) { super(urls[0], { chainId: CHAIN_ID, name: 'mainnet' }, { staticNetwork: true, batchMaxCount: 5, batchStallTime: 10 }); this.urls = urls; }
    async _post(url, items) {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
      let r; try { r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(items.length === 1 ? items[0] : items), signal: ctl.signal }); } finally { clearTimeout(tm); }
      if (!r.ok) throw Object.assign(new Error('http ' + r.status), { limited: true });
      const j = await r.json(); const arr = Array.isArray(j) ? j : [j];
      if (!arr.length || arr.some(x => x && x.error && !realError(x))) throw Object.assign(new Error('provider refused: ' + String((arr.find(x => x && x.error) || { error: {} }).error.message || 'empty').slice(0, 80)), { limited: true });
      return arr;
    }
    async _send(payload) {
      const items = Array.isArray(payload) ? payload : [payload]; let last;
      for (let round = 0; round < 3; round++) {
        if (round) await new Promise(r => setTimeout(r, 500 * round));
        const order = this.urls.map((_, i) => this.urls[(rr + i) % this.urls.length]); rr++;
        const t = Date.now(); const live = order.filter(u => !(cool[u] > t));
        for (const u of (live.length ? live : order)) { try { return await this._post(u, items); } catch (e) { last = e; cool[u] = Date.now() + 20000; } }
      }
      const inj = await injected();
      if (inj) return Promise.all(items.map(async it => { try { return { jsonrpc: '2.0', id: it.id, result: await inj.request({ method: it.method, params: it.params }) }; } catch (e) { return { jsonrpc: '2.0', id: it.id, error: { code: e.code || -32000, message: String(e.message || e), data: e.data } }; } }));
      throw last || new Error('No Ethereum RPC answered');
    }
  }
  const provider = new RotatingProvider(RPCS);
  const I = Object.fromEntries(Object.entries(ABI).map(([k, v]) => [k, new ethers.Interface(v)]));
  const K = (addr, abi, runner) => new ethers.Contract(addr, ABI[abi], runner || provider);
  const factory = K(C.factory, 'Factory'), hook = K(C.hook, 'Hook'), oracle = K(C.oracle, 'Oracle'), router = K(C.router, 'Router'), stateView = K(STATE_VIEW, 'StateView');
  const coinOf = (a, r) => K(a, 'Token', r);
  const erc20 = (a, r) => K(a, 'ERC20', r);

  // ---------------------------------------------------------------- helpers
  const memo = {}; const cached = async (k, ttl, fn) => { const m = memo[k]; if (m && m.t + ttl > Date.now()) return m.v; const v = await fn(); memo[k] = { v, t: Date.now() }; return v; };
  const retry = async (fn, n = 3) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (err) { e = err; await new Promise(r => setTimeout(r, 400 * (i + 1))); } } throw e; };
  const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const NS = 'ud:' + lower(C.factory) + ':';
  function parseMeta(s) { try { const j = JSON.parse(s || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
  let head = { n: 0, ts: 0, at: 0 };
  async function headBlock(force) { if (force || !head.at || Date.now() - head.at > 15000) { const b = await provider.getBlock('latest'); head = { n: b.number, ts: b.timestamp, at: Date.now() }; } return head; }
  const nowTs = () => head.ts ? head.ts + Math.floor((Date.now() - head.at) / 1000) : Math.floor(Date.now() / 1000);
  const tsOf = n => head.ts - (head.n - n) * BLOCK_SECS;
  const topicAddr = a => ethers.zeroPadValue(a, 32);

  // ---------------------------------------------------------------- pair tokens: the configured list, the Ondo stock list, then the chain
  const KNOWN = {};
  for (const t of CFG.tokens || []) KNOWN[lower(t.address)] = { ...t, address: lower(t.address), kind: 'token' };
  KNOWN[WETH] = { ...(KNOWN[WETH] || {}), address: WETH, symbol: 'ETH', name: 'Ether', decimals: 18, kind: 'token' };
  let backing = null;
  async function loadBacking() {
    if (backing) return backing;
    try { const r = await fetch('/backing.json'); backing = r.ok ? await r.json() : { tokens: [] }; } catch { backing = { tokens: [] }; }
    for (const t of backing.tokens || []) { const a = lower(t.address); if (!KNOWN[a]) KNOWN[a] = { address: a, symbol: t.symbol, ticker: t.ticker, name: t.name.replace(/ \(Ondo.*$/, ''), decimals: 18, kind: 'stock', logo: '/img/stocks/' + t.ticker + '.webp', usd: t.usd, v4Id: t.v4Id, v4Key: t.v4Key, skip: !!t.skip }; }
    return backing;
  }
  const infoCache = LS.get('ud:info') || {};
  async function tokenInfo(addr) {
    const a = lower(addr); if (KNOWN[a] && KNOWN[a].decimals != null) return KNOWN[a];
    if (infoCache[a]) return infoCache[a];
    const t = erc20(a); const [symbol, name, decimals] = await Promise.all([t.symbol().catch(() => '?'), t.name().catch(() => ''), t.decimals().catch(() => 18)]);
    const info = { address: a, symbol, name, decimals: Number(decimals), kind: 'token', logo: '' };
    infoCache[a] = info; LS.set('ud:info', infoCache); return info;
  }

  // ---------------------------------------------------------------- prices: oracle.price is USD (18 dp) per 1e18 base units
  const prices = { ETH: 0 };
  async function usdOf(addr) {
    const a = lower(addr); const info = await tokenInfo(a);
    return cached('usd:' + a, a === WETH ? 60000 : 120000, async () => { const px = await oracle.price(a); return Number(px) / 1e18 * 10 ** info.decimals / 1e18; });
  }
  const ethUsd = async () => { const v = await usdOf(WETH); prices.ETH = v; return v; };

  // ---------------------------------------------------------------- pool math (coin is always currency0, 18 decimals)
  const pairPerCoin = (sqrtPriceX96, pairDec) => { const p = Number(sqrtPriceX96) / 2 ** 96; return p * p * 10 ** (18 - pairDec); };
  const pairPerCoinAtTick = (tick, pairDec) => Math.pow(1.0001, tick) * 10 ** (18 - pairDec);
  async function poolState(id) { const [s, L] = await Promise.all([stateView.getSlot0(id), stateView.getLiquidity(id)]); return { sqrtPriceX96: s.sqrtPriceX96, tick: Number(s.tick), liquidity: L }; }
  // exact for a swap that stays inside the active range
  function coinOutFor(st, net) { const L = st.liquidity; if (!L || net <= 0n) return 0n; const sp = st.sqrtPriceX96; const sn = sp + net * Q96 / L; return amount0Delta(L, sp, sn); } // pay pair in: price rises
  function pairOutFor(st, coinIn) { const L = st.liquidity; if (!L || coinIn <= 0n) return 0n; const sp = st.sqrtPriceX96; const sn = L * sp * Q96 / (L * Q96 + coinIn * sp); return amount1Delta(L, sn, sp); } // pay coin in: price falls
  function amount0Delta(L, a, b) { const lo = a < b ? a : b, hi = a < b ? b : a; return L * Q96 * (hi - lo) / hi / lo; }
  function amount1Delta(L, a, b) { const lo = a < b ? a : b, hi = a < b ? b : a; return L * (hi - lo) / Q96; }
  // what the hook's book holds right now: coins above the price, pair below it (floats, for display)
  function bookAmounts(book, sqrtPriceX96, pairDec) {
    const sp = Number(sqrtPriceX96) / 2 ** 96; let coins = 0, pair = 0;
    for (const s of book) { const L = Number(s.liquidity); const sa = Math.pow(1.0001, Number(s.lower) / 2), sb = Math.pow(1.0001, Number(s.upper) / 2);
      if (sp <= sa) coins += L * (sb - sa) / (sa * sb); else if (sp >= sb) pair += L * (sb - sa); else { coins += L * (sb - sp) / (sp * sb); pair += L * (sp - sa); } }
    return { coins: coins / 1e18, pair: pair / 10 ** pairDec };
  }
  // log timestamps for the newest blocks are estimates: snap a window's length to the key it was rented with
  const KEYS_H = [0.5, 1, 6, 24, 72, 168];
  const snapHours = h => { const k = KEYS_H.find(v => Math.abs(h - v) / v < 0.04); return k || Math.max(PR.minH, Math.round(h * 60) / 60); };
  const buyTaxBps = createdAt => { const e = nowTs() - createdAt; return e >= TAX.snipeSecs ? TAX.bps : Math.round(TAX.snipeBps - (TAX.snipeBps - TAX.bps) * Math.max(0, e) / TAX.snipeSecs); };

  // ---------------------------------------------------------------- logs: Blockscout for history, the RPC for the newest blocks
  const T = { swap: I.PoolManager.getEvent('Swap').topicHash, init: I.PoolManager.getEvent('Initialize').topicHash };
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

  // ---------------------------------------------------------------- routes: WETH -> pair hops, from the oracle's price source
  const v4Keys = {};
  async function v4KeyOf(id) {
    if (v4Keys[id]) return v4Keys[id];
    await loadBacking(); for (const t of Object.values(KNOWN)) if (t.v4Id === id && t.v4Key) return (v4Keys[id] = t.v4Key);
    if (!SCOUT) throw new Error('unknown V4 pool');
    const ls = await scoutLogs(PM, [T.init, id], 0, 'latest'); if (!ls[0]) throw new Error('unknown V4 pool');
    const d = I.PoolManager.decodeEventLog('Initialize', ls[0].data, ls[0].topics);
    return (v4Keys[id] = { currency0: d.currency0, currency1: d.currency1, fee: Number(d.fee), tickSpacing: Number(d.tickSpacing), hooks: d.hooks });
  }
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
  async function routeFor(pair) { const h = await hopsFor(pair); if (h === null) throw new Error('No ETH route for this pair token right now'); return encodeRoute(h); }

  // ---------------------------------------------------------------- coins: statics (cached for good) and history (synced incrementally)
  const statics = LS.get(NS + 'static') || {};
  let tokens = [], byAddr = {}, everyToken = [];
  async function loadStatic(a) {
    const al = lower(a); if (statics[al]) return statics[al];
    const c = coinOf(a); const L = await factory.listings(a);
    const [meta, name, symbol] = await Promise.all([factory.metadataOf(a).catch(() => ''), c.name(), c.symbol()]);
    const pair = lower(L.pair); const pinfo = await tokenInfo(pair); const m = parseMeta(meta);
    const st = statics[al] = { addr: al, name, symbol, pair, pairDec: pinfo.decimals, poolId: L.poolId, createdAt: Number(L.createdAt), creator: lower(L.creator), img: m.image || '', desc: m.description || '', links: { web: m.website || '', x: m.x || m.twitter || '', tg: m.telegram || '' }, metaRaw: meta };
    LS.set(NS + 'static', statics); return st;
  }
  // an admin description edit changes the override: refresh those on every load (cheap, one call per coin)
  async function refreshMeta(s) { const meta = await factory.metadataOf(s.addr).catch(() => null); if (meta == null || meta === s.metaRaw) return; const m = parseMeta(meta); Object.assign(s, { img: m.image || '', desc: m.description || '', links: { web: m.website || '', x: m.x || m.twitter || '', tg: m.telegram || '' }, metaRaw: meta }); LS.set(NS + 'static', statics); }

  // hist: per coin swaps and windows; the hook's, router's and factory's logs are synced for every coin at once
  const hist = LS.get(NS + 'hist2') || { g: { last: (CFG.deployBlock || 1) - 1, blocked: {} }, coins: {} };
  const H = a => hist.coins[a] || (hist.coins[a] = { last: (CFG.deployBlock || 1) - 1, swaps: [], w: {}, who: {}, paid: 0, collects: [] });
  async function syncGlobal() {
    const h = await headBlock(); const g = hist.g; if (h.n <= g.last) return;
    const [hl, rl, fl] = await Promise.all([getLogs(C.hook, [], g.last + 1, h.n), getLogs(C.router, [], g.last + 1, h.n), getLogs(C.factory, [], g.last + 1, h.n)]);
    for (const l of hl) {
      let d; try { d = I.Hook.parseLog({ topics: l.topics, data: l.data }); } catch { continue; } if (!d) continue;
      const a = d.args; const x = a.token ? H(lower(a.token)) : null; if (!x) continue;
      if (d.name === 'WindowOpened') x.w[Number(a.id)] = { id: Number(a.id), owner: lower(a.owner), cost: a.cost.toString(), coins: a.coins.toString(), premium: a.premium.toString(), expiry: Number(a.expiry), cutUpper: Number(a.cutUpper), ts: l.ts, tx: l.tx, open: true };
      else if (d.name === 'WindowClosed') { const w = x.w[Number(a.id)]; if (w) { w.open = false; w.kept = a.kept; w.burned = a.burned.toString(); w.closedTs = l.ts; w.closedTx = l.tx; } }
      else if (d.name === 'CreatorPaid') x.paid = (x.paid || 0) + Number(a.amount) / 1e18; // scaled to 18 dp whatever the pair; converted with pairDec in build
      else if (d.name === 'Collected') x.collects.push({ ts: l.ts, tx: l.tx, coins: a.coins.toString(), pair: a.pair.toString(), to: lower(a.to) });
    }
    for (const l of rl) {
      let d; try { d = I.Router.parseLog({ topics: l.topics, data: l.data }); } catch { continue; } if (!d) continue;
      const who = d.args.buyer || d.args.seller; if (d.args.coin && who) H(lower(d.args.coin)).who[l.tx] = lower(who);
    }
    for (const l of fl) {
      let d; try { d = I.Factory.parseLog({ topics: l.topics, data: l.data }); } catch { continue; } if (!d) continue;
      if (d.name === 'TokenBlocked') { if (d.args.blocked) hist.g.blocked[lower(d.args.token)] = 1; else delete hist.g.blocked[lower(d.args.token)]; }
    }
    g.last = h.n; LS.set(NS + 'hist2', hist);
  }
  async function syncSwaps(list) {
    const h = await headBlock();
    await Promise.all(list.map(async s => {
      const x = H(s.addr); if (h.n <= x.last) return;
      const sw = await getLogs(PM, [T.swap, s.poolId], x.last + 1, h.n);
      for (const l of sw) {
        const d = I.PoolManager.decodeEventLog('Swap', l.data, l.topics);
        // amounts are the swapper's deltas: a buy pays pair (amount1 negative) and receives coins (amount0 positive)
        x.swaps.push({ ts: l.ts, b: l.block, tx: l.tx, buy: d.amount0 > 0n, coin: Number(d.amount0 < 0n ? -d.amount0 : d.amount0) / 1e18, pair: Number(d.amount1 < 0n ? -d.amount1 : d.amount1) / 10 ** s.pairDec, sp: d.sqrtPriceX96.toString() });
      }
      x.last = h.n; if (x.swaps.length > 5000) x.swaps = x.swaps.slice(-5000);
    }));
    LS.set(NS + 'hist2', hist);
  }

  function build(s, d) {
    const x0 = H(s.addr); const pUsd = d.pUsd, eUsd = prices.ETH || 1; const dec = s.pairDec; const t0 = nowTs();
    const pxPair = pairPerCoin(d.st.sqrtPriceX96, dec); const px = pxPair * pUsd;
    const toEth = pairAmt => pairAmt * pUsd / eUsd; const amt = v => Number(v) / 10 ** dec;
    const pinfo = KNOWN[s.pair] || { address: s.pair, symbol: '?', name: '', decimals: dec, kind: 'token', logo: '' };
    const pair = { symbol: pinfo.symbol, ticker: pinfo.ticker || pinfo.symbol, name: pinfo.name, address: s.pair, usd: pUsd, kind: pinfo.kind, logo: pinfo.logo || '', decimals: dec };
    // windows: open, expired (closed but not yet kept), kept, undone
    const ws = Object.values(x0.w).sort((a, b) => a.ts - b.ts).map(w => { const cost = amt(w.cost), prem = amt(w.premium), coins = Number(w.coins) / 1e18; const state = w.open ? (w.expiry > t0 ? 'open' : 'expired') : (w.kept ? 'kept' : 'undone');
      return { ...w, costPair: cost, costEth: toEth(cost), usd: cost * pUsd, premiumPair: prem, premiumEth: toEth(prem), coinsN: coins, burnedN: Number(w.burned || 0) / 1e18, hours: snapHours((w.expiry - w.ts) / 3600), state }; });
    const openW = ws.filter(w => w.state === 'open' || w.state === 'expired');
    const windowBuys = ws.length, undos = ws.filter(w => w.state === 'undone').length;
    // the tape of prices: swaps (price after), and window buys (the price moves to the top of the slice taken)
    const series = [...x0.swaps.map(y => ({ t: y.ts, p: pairPerCoin(BigInt(y.sp), dec) * pUsd, v: y.pair * pUsd, buy: y.buy })), ...ws.map(w => ({ t: w.ts, p: pairPerCoinAtTick(w.cutUpper, dec) * pUsd, v: w.usd, buy: true }))].sort((a, b) => a.t - b.t);
    const startPx = (CFG.startCap || 5000) / SUPPLY;
    const chg = win => { const past = [...series].reverse().find(y => y.t <= t0 - win); const base = past ? past.p : s.createdAt > t0 - win ? startPx : px; return base > 0 ? (px / base - 1) * 100 : 0; };
    const vol = win => series.filter(y => y.t >= t0 - win).reduce((a, y) => a + y.v, 0);
    const pool = bookAmounts(d.book, d.st.sqrtPriceX96, dec);
    const whoOf = (tx, fallback) => x0.who[tx] || fallback || '';
    const trades = [
      ...x0.swaps.map(y => ({ ts: y.ts, side: y.buy ? 'buy' : 'sell', usd: y.pair * pUsd, eth: toEth(y.pair), coins: y.coin, who: whoOf(y.tx), tx: y.tx })),
      ...ws.map(w => ({ ts: w.ts, side: 'buy', usd: w.usd, eth: w.costEth, coins: w.coinsN, who: w.owner, tx: w.tx, id: w.id, hours: w.hours, premium: w.premiumEth, state: w.state, closes: w.expiry, undoAt: w.state === 'undone' ? w.closedTs : undefined })),
      ...ws.filter(w => w.state === 'undone').map(w => ({ ts: w.closedTs, side: 'undo', usd: w.usd, eth: w.costEth, coins: w.coinsN, who: w.owner, tx: w.closedTx, hours: w.hours, premium: w.premiumEth })),
    ].sort((a, b) => b.ts - a.ts);
    const burnedCoins = ws.reduce((a, w) => a + w.burnedN, 0);
    const creatorClaimable = amt(d.creatorOwed) * pUsd;
    return {
      ...s, pair, hidden: d.hidden, px, pxPair, pairUsd: pUsd, supply: SUPPLY, circ: Number(d.totalSupply) / 1e18, mc: px * Number(d.totalSupply) / 1e18,
      c24: chg(86400), vol24: vol(86400), volAll: series.reduce((a, y) => a + y.v, 0), lastTrade: series.length ? series[series.length - 1].t : s.createdAt,
      swaps: series, trades, holders: d.holders || 0, top: d.top || [], windows: ws,
      windowBuys, undos, keptPct: windowBuys ? (windowBuys - undos) / windowBuys * 100 : null,
      premiumsEth: ws.reduce((a, w) => a + w.premiumEth, 0), burnedCoins, burnedUsd: burnedCoins * px,
      openUsd: openW.reduce((a, w) => a + w.usd, 0), openEth: openW.reduce((a, w) => a + w.costEth, 0), refundedUsd: ws.filter(w => w.state === 'undone').reduce((a, w) => a + w.usd, 0),
      creatorEarned: creatorClaimable + (x0.paid || 0) * 1e18 / 10 ** dec * pUsd, creatorClaimable, creatorOwedRaw: d.creatorOwed, platformOwed: amt(d.platformOwed) * pUsd, platformOwedRaw: d.platformOwed,
      poolCoins: pool.coins, poolPair: pool.pair, get poolUsd() { return this.poolCoins * this.px + this.poolPair * this.pair.usd; },
      get poolPairDesc() { return `${this.poolPairFmt(1)} + ${(this.poolCoins / SUPPLY * 100).toFixed(0)}% of supply`; },
      poolPairFmt(f) { const v = this.poolPair * f; return (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toFixed(4)) + ' ' + this.pair.symbol; },
      sqrtPriceX96: d.st.sqrtPriceX96.toString(), liquidity: d.st.liquidity.toString(),
    };
  }

  async function holdersOf(a) {
    if (!SCOUT) return { count: 0, top: [] };
    return cached('holders:' + a, 60000, async () => {
      const skip = new Set([lower(PM), ethers.ZeroAddress, lower(C.factory), lower(C.hook), lower(C.router)]);
      const [cnt, list] = await Promise.all([fetch(`${SCOUT}/api/v2/tokens/${a}/counters`).then(r => r.json()).catch(() => ({})), fetch(`${SCOUT}/api/v2/tokens/${a}/holders`).then(r => r.json()).catch(() => ({}))]);
      const top = (list.items || []).map(h => ({ addr: lower(h.address && h.address.hash), bal: Number(h.value) / 1e18 })).filter(h => !skip.has(h.addr)).slice(0, 20);
      return { count: Math.max(0, Number(cnt.token_holders_count || top.length) - (list.items || []).filter(h => skip.has(lower(h.address && h.address.hash))).length), top };
    });
  }
  async function loadOne(s) {
    const [hidden, st, pUsd, totalSupply, book, creatorOwed, platformOwed, ho] = await Promise.all([
      factory.hidden(s.addr), poolState(s.poolId), usdOf(s.pair).catch(() => 0), coinOf(s.addr).totalSupply(), hook.book(s.addr), hook.creatorOwed(s.addr), hook.platformOwed(s.addr), holdersOf(s.addr).catch(() => ({ count: 0, top: [] })),
    ]);
    return build(s, { hidden, st, pUsd, totalSupply, book, creatorOwed, platformOwed, holders: ho.count, top: ho.top });
  }
  async function loadAll() {
    await headBlock(true); await Promise.all([loadBacking(), ethUsd()]);
    const n = Number(await factory.totalTokens());
    const addrs = await Promise.all([...Array(n)].map((_, i) => factory.allTokens(i)));
    const ss = await Promise.all(addrs.map(loadStatic));
    await Promise.all(ss.map(refreshMeta));
    await Promise.all([syncGlobal(), syncSwaps(ss)]).catch(e => console.warn('history', e));
    const out = await Promise.all(ss.map(s => loadOne(s).catch(e => { console.warn('coin', s.addr, e); return null; })));
    everyToken = out.filter(Boolean).reverse(); tokens = everyToken.filter(x => !x.hidden); byAddr = Object.fromEntries(everyToken.map(x => [x.addr, x]));
    return tokens;
  }
  function place(x) { byAddr[x.addr] = x; everyToken = everyToken.map(y => y.addr === x.addr ? x : y); if (!everyToken.find(y => y.addr === x.addr)) everyToken.unshift(x); tokens = everyToken.filter(y => !y.hidden); }

  // ---------------------------------------------------------------- quotes
  async function ethToPairEst(x, wei) {
    const pa = PA(x); if (pa === WETH) return wei;
    try { return await router.ethToPair.staticCall(pa, await routeFor(pa), WETH, 0, { from: WETH, value: wei }); } // WETH holds plenty of ETH: a free simulation
    catch { const p = await usdOf(pa); return BigInt(Math.floor(Number(wei) / 1e18 * prices.ETH / p * 0.99 * 10 ** x.pairDec)); }
  }
  const pairToEthEst = (x, pairAmt) => PA(x) === WETH ? Number(pairAmt) / 1e18 : Number(pairAmt) / 10 ** x.pairDec * x.pairUsd / prices.ETH * (0.995);

  // ---------------------------------------------------------------- wallet + transactions
  const ERRS = { BadWindow: 'A window is 30 minutes to 7 days', PremiumTooHigh: 'The window can cost at most 30% of the buy: buy more or pick a shorter window', NothingToBuy: 'Too small to buy anything after the window premium', TooFewCoins: 'Price moved more than your slippage', NoWindow: 'That window is already closed', NotOwner: 'Only the buyer can cancel this window', WindowExpired: 'The window has closed; the coins are yours, press Keep', WindowStillOpen: 'Only the buyer can keep before the window closes', BookFull: 'This pool has too many open slices right now; try again later', OneSwapPerBlock: 'One trade per wallet per block: try again next block', LaunchesPaused: 'Launches are paused', Blocked: 'This pair token is blocked', NotAdmin: 'Only the admin wallet can do this', InvalidParams: 'Those settings are not allowed', Slippage: 'Price moved more than your slippage', ZeroAmount: 'Enter an amount', BadRoute: 'No ETH route for this pair right now', NotListed: 'Not a cntrl-z coin', LaunchGuard: 'Only the creator can buy in the launch block', OtherPool: 'This coin only trades in its own pool', NoPrice: 'No price for this pair right now', PriceMoving: 'The pair price is moving fast; try again in a few minutes', TooShallow: 'The pair pool is too thin to price safely' };
  function errText(e) {
    const raw = String(e && (e.shortMessage || e.reason || e.message) || e);
    const data = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
    if (data && typeof data === 'string' && data.length >= 10) for (const k of ['Hook', 'Factory', 'Router', 'Token', 'Oracle']) { try { const p = I[k].parseError(data); if (p) return ERRS[p.name] || p.name; } catch {} }
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
  const E = v => ethers.parseEther(String(v));
  const PA = x => (typeof x.pair === 'string' ? x.pair : x.pair.address); // a coin's pair address (the built coin carries the pair as an object)
  const secsOf = hours => Math.round(hours * 3600);

  const api = {
    cfg: CFG, SUPPLY, live: true, preview: false, now: nowTs, ready: null, weth: WETH,
    tokens: () => tokens, allTokens: () => everyToken, token: a => byAddr[lower(a)] || everyToken.find(t => t.symbol.toLowerCase() === lower(a)),
    ethUsd: () => prices.ETH, pairUsd: sym => { const t = everyToken.find(x => x.pair.symbol === sym); return t ? t.pair.usd : (sym === 'ETH' ? prices.ETH : 0); },
    errText, routeFor,
    stats() {
      const sum = f => tokens.reduce((s, x) => s + (f(x) || 0), 0); const wb = sum(x => x.windowBuys), un = sum(x => x.undos);
      return { coins: tokens.length, vol24: sum(x => x.vol24), openUsd: sum(x => x.openUsd), openEth: sum(x => x.openEth), openCount: api.openWindows().length, kept: wb ? (wb - un) / wb * 100 : null, burnedUsd: sum(x => x.burnedUsd), premiumsEth: sum(x => x.premiumsEth), refundedUsd: sum(x => x.refundedUsd) };
    },
    openWindows: () => tokens.flatMap(x => x.trades.filter(t => t.state === 'open').map(t => ({ x, ...t }))).sort((a, b) => b.ts - a.ts),
    async pairsList() {
      await loadBacking();
      const popular = (CFG.tokens || []).map(t => ({ ...KNOWN[lower(t.address)], symbol: t.symbol, kind: 'token', usd: 0 }));
      await Promise.all(popular.map(async t => { try { t.usd = await usdOf(t.address); } catch {} }));
      const stocks = Object.values(KNOWN).filter(t => t.kind === 'stock' && !t.skip && t.usd && !hist.g.blocked[t.address]).map(t => ({ symbol: t.symbol, ticker: t.ticker, name: t.name, address: t.address, usd: t.usd, kind: 'stock', logo: t.logo })).sort((a, b) => a.ticker.localeCompare(b.ticker));
      return { popular: popular.filter(t => !hist.g.blocked[t.address]), stocks };
    },
    async load() { await retry(loadAll, 2); window.dispatchEvent(new CustomEvent('ud:update')); return tokens; },
    // reload one coin after a transaction
    async refresh(addr) {
      const s = statics[lower(addr)] || await loadStatic(addr); await headBlock(true); await ethUsd();
      await Promise.all([syncGlobal(), syncSwaps([s])]).catch(() => {}); delete memo['holders:' + s.addr];
      const x = await loadOne(s); place(x); window.dispatchEvent(new CustomEvent('ud:update', { detail: s.addr })); return x;
    },
    async trades(addr) { // fill in the wallet behind trades that didn't go through our router
      const x = byAddr[lower(addr)]; if (!x) return [];
      const need = [...new Set(x.trades.filter(t => !t.who && t.tx).map(t => t.tx))].slice(0, 30);
      const txs = await Promise.all(need.map(h => provider.getTransaction(h).catch(() => null))); const by = {}; need.forEach((h, i) => { if (txs[i]) by[h] = lower(txs[i].from); });
      for (const t of x.trades) if (!t.who && by[t.tx]) t.who = by[t.tx];
      return x.trades;
    },
    async balances(addr, user) { const x = byAddr[lower(addr)]; const [coin, pair, eth] = await Promise.all([coinOf(x.addr).balanceOf(user), PA(x) === WETH ? 0n : erc20(PA(x)).balanceOf(user), provider.getBalance(user)]); return { coin: Number(coin) / 1e18, coinRaw: coin, pair: Number(pair) / 10 ** x.pairDec, pairRaw: pair, eth: Number(eth) / 1e18 }; },
    // a buy of `ethAmt` ETH, with a window of `hours` (0: none). Amounts in ETH and coins (floats), raw for the transaction.
    async quoteBuy(addr, ethAmt, hours) {
      const x = byAddr[lower(addr)]; const wei = E(ethAmt); const pairIn = await ethToPairEst(x, wei); const taxBps = buyTaxBps(x.createdAt);
      if (hours) {
        const q = await hook.quote(x.addr, pairIn, secsOf(hours), C.router);
        const coins = Number(q.coins) / 1e18;
        const out = { coins, coinsRaw: q.coins, costEth: pairToEthEst(x, q.cost), premiumEth: pairToEthEst(x, q.premium), feeEth: pairToEthEst(x, q.fee), refundEth: pairToEthEst(x, q.refund), taxBps, ok: q.ok, reason: '' };
        if (!q.ok) out.reason = coins === 0 ? 'Too small to buy anything after the window premium' : 'The window can cost at most 30% of the buy';
        out.avgUsd = coins ? out.costEth * prices.ETH / coins : 0; out.impact = x.px && coins ? (out.avgUsd / x.px - 1) * 100 : 0;
        return out;
      }
      let coinsRaw;
      try { coinsRaw = await router.buy.staticCall(x.addr, await routeFor(PA(x)), 0, { from: WETH, value: wei }); }
      catch { const st = await poolState(x.poolId); const net = pairIn - pairIn * BigInt(taxBps) / BPS; coinsRaw = coinOutFor(st, net); }
      const coins = Number(coinsRaw) / 1e18; const feeEth = ethAmt * taxBps / 10000;
      const avgUsd = coins ? (ethAmt - feeEth) * prices.ETH / coins : 0;
      return { coins, coinsRaw, costEth: ethAmt - feeEth, premiumEth: 0, feeEth, refundEth: 0, taxBps, ok: coins > 0, reason: coins > 0 ? '' : 'Too small', avgUsd, impact: x.px && coins ? (avgUsd / x.px - 1) * 100 : 0 };
    },
    async quoteSell(addr, coins) {
      const x = byAddr[lower(addr)]; const coinIn = E(coins); const st = await poolState(x.poolId);
      const gross = pairOutFor(st, coinIn); const fee = gross * BigInt(TAX.bps) / BPS; const net = gross - fee;
      const pairOut = Number(net) / 10 ** x.pairDec; const ethOut = pairToEthEst(x, net);
      return { ethOut, ethOutRaw: BigInt(Math.floor(ethOut * 1e18)), pairOut, usd: pairOut * x.pairUsd, feeUsd: Number(fee) / 10 ** x.pairDec * x.pairUsd, taxBps: TAX.bps };
    },
    async buy(addr, ethAmt, hours, minCoinsRaw) {
      const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); const r = K(C.router, 'Router', s); const route = await routeFor(PA(x)); const value = E(ethAmt);
      let rc;
      if (hours) rc = await send(g => r.buyWithWindow(x.addr, route, secsOf(hours), minCoinsRaw, { value, gasLimit: g }), () => router.buyWithWindow.estimateGas(x.addr, route, secsOf(hours), minCoinsRaw, { from: me, value }));
      else rc = await send(g => r.buy(x.addr, route, minCoinsRaw, { value, gasLimit: g }), () => router.buy.estimateGas(x.addr, route, minCoinsRaw, { from: me, value }));
      return rc;
    },
    async sell(addr, coins, minEthRaw) {
      const x = byAddr[lower(addr)]; const s = await signer(); const me = await s.getAddress(); const r = K(C.router, 'Router', s); const route = await routeFor(PA(x)); const coinIn = E(coins);
      await approveIfNeeded(x.addr, s, me, C.router, coinIn);
      return send(g => r.sell(x.addr, coinIn, route, minEthRaw, { gasLimit: g }), () => router.sell.estimateGas(x.addr, coinIn, route, minEthRaw, { from: me }));
    },
    async cancel(addr, id) { const s = await signer(); const me = await s.getAddress(); const h = K(C.hook, 'Hook', s); return send(g => h.cancel(addr, id, { gasLimit: g }), () => hook.cancel.estimateGas(addr, id, { from: me })); },
    async keep(addr, id) { const s = await signer(); const me = await s.getAddress(); const h = K(C.hook, 'Hook', s); return send(g => h.keep(addr, id, { gasLimit: g }), () => hook.keep.estimateGas(addr, id, { from: me })); },
    async payCreator(addr) { const s = await signer(); const me = await s.getAddress(); const h = K(C.hook, 'Hook', s); return send(g => h.payCreator(addr, { gasLimit: g }), () => hook.payCreator.estimateGas(addr, { from: me })); },
    // turn a pair-token refund (gold, a stock) back into ETH
    async pairToEth(pair, amountRaw) { const s = await signer(); const me = await s.getAddress(); const r = K(C.router, 'Router', s); const route = await routeFor(pair); await approveIfNeeded(pair, s, me, C.router, amountRaw); return send(g => r.pairToEth(pair, amountRaw, me, 0, route, { gasLimit: g }), () => router.pairToEth.estimateGas(pair, amountRaw, me, 0, route, { from: me })); },
    async launch(p) { // {name, symbol, meta, pair, devEth}
      const s = await signer(); const me = await s.getAddress(); const f = K(C.factory, 'Factory', s); const salt = ethers.hexlify(ethers.randomBytes(32));
      const pair = lower(p.pair || WETH); const value = p.devEth ? E(p.devEth) : 0n;
      const params = { name: p.name, symbol: p.symbol, metadataURI: JSON.stringify(p.meta || {}), pair, minPairOut: 0 };
      const route = value && pair !== WETH ? await routeFor(pair) : '0x';
      const rc = await send(g => f.launch(params, salt, route, { value, gasLimit: g }), () => factory.launch.estimateGas(params, salt, route, { from: me, value }));
      const topic = I.Factory.getEvent('Launched').topicHash; let token = null;
      for (const l of rc.logs) if (lower(l.address) === lower(C.factory) && l.topics[0] === topic) token = lower(ethers.getAddress('0x' + l.topics[1].slice(26)));
      return { rc, token };
    },
    // the wallet's open (and expired-but-unkept) windows, the coins it holds, the coins it created
    async portfolio(user) {
      user = lower(user); const windows = [], holdings = [], created = [], pairs = {};
      await Promise.all(everyToken.map(async x => {
        for (const w of x.windows) if (w.owner === user && (w.state === 'open' || w.state === 'expired')) windows.push({ id: w.id, x, openedAt: w.ts, closes: w.expiry, hours: w.hours, paidEth: w.costEth, paidPair: w.costPair, premium: w.premiumEth, paidUsd: w.usd, coins: w.coinsN, state: w.state });
        const bal = Number(await coinOf(x.addr).balanceOf(user).catch(() => 0n)) / 1e18; if (bal > 0) holdings.push({ x, bal, value: bal * x.px });
        if (x.creator === user) created.push({ x, earned: x.creatorEarned, unclaimed: x.creatorClaimable });
        if (PA(x) !== WETH) pairs[PA(x)] = 1;
      }));
      // pair tokens sitting in the wallet (refunds from non-ETH coins), swappable back to ETH
      const refunds = (await Promise.all(Object.keys(pairs).map(async a => { const raw = await erc20(a).balanceOf(user).catch(() => 0n); if (!raw) return null; const info = await tokenInfo(a); const usd = await usdOf(a).catch(() => 0); return { address: a, symbol: info.symbol, logo: info.logo || '', raw, amount: Number(raw) / 10 ** info.decimals, usd: Number(raw) / 10 ** info.decimals * usd }; }))).filter(Boolean);
      windows.sort((a, b) => a.closes - b.closes);
      return { windows, holdings, created, refunds };
    },
    // admin reads and writes (the contracts enforce the admin wallet)
    admin: {
      state: async () => { const [paused, feeRecipient, startCap] = await Promise.all([factory.launchesPaused(), factory.feeRecipient(), factory.startCapUsd8()]); return { paused, feeRecipient: lower(feeRecipient), startCap: Number(startCap) / 1e8, blocked: Object.keys(hist.g.blocked) }; },
      async collectQuote(x, bps, to) {
        try { const [c, p] = await factory.collect.staticCall(x.addr, bps, to || CFG.admin, { from: CFG.admin }); const coin = Number(c) / 1e18, pair = Number(p) / 10 ** x.pairDec; return { coin, pair, usd: coin * x.px + pair * x.pairUsd, exact: true }; }
        catch { const f = bps / 10000; return { coin: x.poolCoins * f, pair: x.poolPair * f, usd: x.poolUsd * f, exact: false }; }
      },
      async call(fn, args) {
        const s = await signer(); const me = await s.getAddress(); let a = [...args];
        if (fn === 'setStartCap') a = [BigInt(Math.round(Number(a[0]) * 1e8))];
        if (fn === 'setCoinMetadata') { const x = byAddr[lower(a[0])]; const m = parseMeta((x && statics[x.addr] || {}).metaRaw); a = [a[0], a[1] ? JSON.stringify({ ...m, description: a[1] }) : '']; }
        const rc = await send(g => K(C.factory, 'Factory', s)[fn](...a, { gasLimit: g }), () => factory[fn].estimateGas(...a, { from: me }));
        if (fn === 'setTokenBlocked') { if (a[1]) hist.g.blocked[lower(a[0])] = 1; else delete hist.g.blocked[lower(a[0])]; LS.set(NS + 'hist2', hist); }
        return rc;
      },
    },
  };
  api.ready = api.load().catch(e => { console.error('chain load failed', e); window.dispatchEvent(new CustomEvent('ud:chainerror', { detail: String(e && e.message || e) })); return []; }).then(() => window.dispatchEvent(new CustomEvent('ud:ready')));
  window.UD = api;
}

function lower(a) { return (a || '').toLowerCase(); }
