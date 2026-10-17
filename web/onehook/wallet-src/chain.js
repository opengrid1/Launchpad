/* OneHook chain layer: reads Ethereum directly from the browser (ethers v6) and sends
   transactions through the connected wallet (window.inkyWallet). Exposes window.CHAIN.
   OneHook has no Ledger/leaderboard/treasury (unlike the old inkypump layer); trade
   history is rebuilt from the router's Bought/Sold events, and the leaderboard/epoch
   surface is kept as graceful no-ops so the shared pages never crash. */
import { ethers } from 'ethers';
import ABI from './abi.json';

const CFG = (typeof window !== 'undefined' && window.INKY) || {};
const C = CFG.contracts || {};
const CHAIN_ID = Number(CFG.chainId || 1);
const RPC = CFG.rpc || 'https://ethereum-rpc.publicnode.com';
const EXPLORER = CFG.explorer || 'https://etherscan.io';
const WETH = (CFG.weth || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2').toLowerCase();
const SUPPLY = 1e9;
const BPS = 10000n;
const Q96 = 1n << 96n;
const DEPLOY_BLOCK = Number(CFG.deployBlock || 0);
const SYM = { [WETH]: 'ETH' };

// ---------------------------------------------------------------- rotating RPC
const capOf = () => 10;
const RPCS = [...new Set([RPC, ...(CFG.rpcs || [])].filter(Boolean))];
let rr = 0; const cool = {};
class RotatingProvider extends ethers.JsonRpcProvider {
  constructor(urls, opts) { super(urls[0], { chainId: CHAIN_ID, name: 'mainnet' }, { staticNetwork: true, ...opts }); this.urls = urls; }
  async _post(url, items) {
    const body = JSON.stringify(items.length === 1 ? items[0] : items);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (r.status === 429 || r.status >= 500) throw Object.assign(new Error('http ' + r.status), { limited: true });
    const j = await r.json(); const arr = Array.isArray(j) ? j : [j];
    if (arr.some(x => x && x.error && /limit|rate|too many|batch/i.test(String(x.error.message)))) throw Object.assign(new Error('rate limited'), { limited: true });
    return arr;
  }
  async _chunk(items) {
    let lastErr;
    for (let round = 0; round < 4; round++) {
      if (round) await new Promise(r => setTimeout(r, 400 * round));
      const now = Date.now(); const order = []; for (let i = 0; i < this.urls.length; i++) order.push(this.urls[(rr + i) % this.urls.length]); rr++;
      const live = order.filter(u => !(cool[u] > now));
      for (const url of (live.length ? live : order)) {
        try { return await this._post(url, items); } catch (e) { lastErr = e; if (e.limited) cool[url] = Date.now() + 15_000; }
      }
    }
    throw lastErr || new Error('all RPCs failed');
  }
  async _send(payload) {
    const items = Array.isArray(payload) ? payload : [payload];
    if (items.length <= 3) return this._chunk(items);
    const size = 10; const chunks = []; for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    const parts = await Promise.all(chunks.map(ch => this._chunk(ch)));
    return parts.flat();
  }
}
const provider = new RotatingProvider(RPCS, { batchMaxCount: 20, batchStallTime: 15 });

const ifaceFactory = new ethers.Interface(ABI.OneHookFactory);
const ifaceRouter = new ethers.Interface(ABI.OneRouter);
const factory = new ethers.Contract(C.factory, ABI.OneHookFactory, provider);
const hook = new ethers.Contract(C.hook, ABI.OneHookHook, provider);
const pm = new ethers.Contract(C.poolManager, ABI.PoolManager, provider);
const coinOf = (a, runner) => new ethers.Contract(a, ABI.OneToken, runner || provider);
const divOf = (a, runner) => new ethers.Contract(a, ABI.OneDivToken, runner || provider);

// ---------------------------------------------------------------- helpers
const lower = a => (a || '').toLowerCase();
const now = () => Math.floor(Date.now() / 1000);
const memo = {}; const cached = async (key, ttl, fn) => { const m = memo[key]; if (m && m.t + ttl > Date.now()) return m.v; const v = await fn(); memo[key] = { v, t: Date.now() }; return v; };
const retry = async (fn, n = 3) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (err) { e = err; await new Promise(r => setTimeout(r, 400 * (i + 1))); } } throw e; };
function parseMeta(s) { try { const j = JSON.parse(s || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
function ageStr(ts) { const s = Math.max(1, now() - ts); if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }
function poolSlot(poolId) { return ethers.keccak256(ethers.concat([poolId, ethers.zeroPadValue('0x06', 32)])); }
const N = v => Number(v || 0);
const FEEMODE = ['flat', 'dynamic', 'mev'];
const EVO_NAMES = ['Genesis', 'Training', 'Autonomous', 'Ascension', 'Singularity', 'Apex'];
const EVO_EMOJI = ['⚡', '🧠', '🤖', '🌌', '✨', '👑'];

// ---------------------------------------------------------------- prices (oracle 18dp)
async function ethUsd() { return cached('ethusd', 60_000, async () => Number(await factory.pairUsdPrice(WETH)) / 1e18); }
async function pairUsd(pair) { pair = lower(pair); if (pair === WETH) return ethUsd(); return cached('usd:' + pair, 300_000, async () => { try { return Number(await factory.pairUsdPrice(pair)) / 1e18; } catch { return 0; } }); }

// ---------------------------------------------------------------- pool state
async function poolState(poolId) {
  const base = BigInt(poolSlot(poolId));
  const [s0, liq] = await Promise.all([pm.extsload(ethers.toBeHex(base, 32)), pm.extsload(ethers.toBeHex(base + 3n, 32))]);
  const v = BigInt(s0); const sqrtPriceX96 = v & ((1n << 160n) - 1n); let tick = Number((v >> 160n) & 0xffffffn); if (tick >= 0x800000) tick -= 0x1000000;
  return { sqrtPriceX96, tick, liquidity: BigInt(liq) & ((1n << 128n) - 1n) };
}
// coin is always currency0 on OneHook: price = pair per coin = (sqrtP/2^96)^2
function pairPerToken(sqrtPriceX96) { const p = Number(sqrtPriceX96) / 2 ** 96; return p * p; }
function tickSqrt(tick) { if (tick >= 400000) return 1461446703485210103287273052203988822378723970341n; if (tick <= -400000) return 4295128739n; const r = Math.pow(1.0001, tick / 2); return BigInt(Math.floor(r * 2 ** 96)); }
function pairInRange(st, pos) { // pair (currency1) held by the single hook range at the current price
  const L = BigInt(pos.liquidity); if (L === 0n) return 0n;
  const sqrtP = BigInt(st.sqrtPriceX96); const sqrtLo = tickSqrt(Number(pos.tickLower)), sqrtHi = tickSqrt(Number(pos.tickUpper));
  const s = sqrtP < sqrtLo ? sqrtLo : sqrtP > sqrtHi ? sqrtHi : sqrtP; return L * (s - sqrtLo) / Q96;
}

// ---------------------------------------------------------------- genes / evolution
function genesObj(g) {
  return { feeMode: N(g.feeMode), feeBps: N(g.feeBps), snipeBps: N(g.snipeBps), snipeBlocks: N(g.snipeBlocks),
    buybackShareBps: N(g.buybackShareBps), divShareBps: N(g.divShareBps), maxWalletBps: N(g.maxWalletBps),
    maxWalletSecs: N(g.maxWalletSecs), buybackThreshold: (g.buybackThreshold != null ? BigInt(g.buybackThreshold) : 0n) };
}
function instinctsOf(genesList) { // union of active instincts across all stages, for the explore filter
  const s = new Set(['fee']);
  for (const g of genesList) { if (N(g.snipeBps) > 0) s.add('snipe'); if (N(g.buybackShareBps) > 0) s.add('buyback'); if (N(g.divShareBps) > 0) s.add('div'); if (N(g.maxWalletBps) > 0) s.add('max'); }
  return [...s];
}
function stageUnlocks(prev, g) { // what this stage turns on vs the one before it
  const u = [];
  if (!prev) { if (N(g.snipeBps) > 0) u.push('Anti-snipe'); if (N(g.maxWalletBps) > 0) u.push('Max-wallet'); u.push((N(g.feeBps) / 100).toFixed(2).replace(/\.?0+$/, '') + '% fee'); return u.length ? u : ['Trading opens']; }
  if (N(g.buybackShareBps) > N(prev.buybackShareBps)) u.push('Reflexive buyback');
  if (N(g.divShareBps) > N(prev.divShareBps)) u.push('ETH dividends');
  if (N(g.feeBps) < N(prev.feeBps)) u.push('Fee eases to ' + (N(g.feeBps) / 100).toFixed(2).replace(/\.?0+$/, '') + '%');
  if (N(g.snipeBps) < N(prev.snipeBps) || N(g.maxWalletBps) < N(prev.maxWalletBps)) u.push('Guards relax');
  return u.length ? u : ['Settles in'];
}
function evoFrom(stages, currentStage) { // -> { metric, stages:[{emoji,name,at,unlocks}], stage }
  if (!stages || stages.length <= 1) return null;
  const out = []; let prev = null;
  for (let i = 0; i < stages.length; i++) { const g = stages[i].genes; out.push({ emoji: EVO_EMOJI[i] || '🔹', name: EVO_NAMES[i] || ('Stage ' + (i + 1)), at: i === 0 ? 0 : Number(stages[i].mcapUsd8) / 1e8, unlocks: stageUnlocks(prev, g) }); prev = g; }
  return { metric: 'market cap', stages: out, stage: Number(currentStage || 0) };
}

// ---------------------------------------------------------------- trades (router Bought/Sold)
const BOUGHT = ifaceRouter.getEvent('Bought').topicHash;
const SOLD = ifaceRouter.getEvent('Sold').topicHash;
const tsCache = {};
async function blockTs(n) {
  if (tsCache[n] != null) return tsCache[n];
  try { const b = await provider.getBlock(n); tsCache[n] = b ? b.timestamp : now(); } catch { tsCache[n] = now(); }
  return tsCache[n];
}
async function getLogsChunked(address, topics, from, to) {
  const out = []; const CH = 90000;
  for (let a = from; a <= to; a += CH) {
    const b = Math.min(to, a + CH - 1);
    try { const ls = await provider.getLogs({ address, topics, fromBlock: a, toBlock: b }); out.push(...ls); } catch (e) { console.warn('getLogs', a, b, e && e.message); }
  }
  return out;
}
let tradeCache = null;
async function allTrades() {
  return cached('trades', 15_000, async () => {
    const saved = tradeCache || { last: DEPLOY_BLOCK - 1, items: [] };
    let head; try { head = await provider.getBlockNumber(); } catch { return saved.items; }
    if (head > saved.last) {
      const logs = await getLogsChunked(C.router, [[BOUGHT, SOLD]], saved.last + 1, head);
      const seen = new Set(saved.items.map(x => x.tx + ':' + x.index));
      for (const l of logs) {
        const k = l.transactionHash + ':' + l.index; if (seen.has(k)) continue;
        let d; try { d = ifaceRouter.parseLog(l); } catch { continue; } if (!d) continue;
        const buy = d.name === 'Bought';
        const coin = (buy ? d.args.coinOut : d.args.coinIn).toString();
        const pair = (buy ? (d.args.pairIn || d.args.ethIn) : (d.args.pairOut || d.args.ethOut)).toString();
        const wallet = lower(buy ? d.args.buyer : d.args.seller);
        saved.items.push({ token: lower(d.args.coin), wallet, buy, coin, pair, fee: '0', realized: '0', block: l.blockNumber, ts: 0, tx: l.transactionHash, index: l.index });
      }
      saved.items.sort((a, b) => a.block - b.block || a.index - b.index); saved.last = head; tradeCache = saved;
      await Promise.all([...new Set(saved.items.filter(t => !t.ts).map(t => t.block))].map(async bn => { const ts = await blockTs(bn); for (const t of saved.items) if (t.block === bn) t.ts = ts; }));
    }
    return saved.items;
  });
}
function tradePrice(t) { const coin = Number(t.coin) / 1e18, pair = Number(t.pair) / 1e18; return coin > 0 ? pair / coin : 0; }

// ---------------------------------------------------------------- tokens
let tokens = [], byAddr = {};
const statics = {};
const SKEY = 'onehook:static:' + lower(C.factory), TKEY = 'onehook:tokens:' + lower(C.factory);
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
try { Object.assign(statics, LS.get(SKEY) || {}); } catch {}

async function loadStatic(a) {
  const al = lower(a); if (statics[al]) return statics[al]; const c = coinOf(a);
  const [L, meta, name, symbol, stagesRaw] = await Promise.all([
    factory.listings(a), factory.metadataOf(a).catch(() => ''), c.name().catch(() => ''), c.symbol().catch(() => ''), factory.stagesOf(a).catch(() => [])]);
  const pair = lower(L.pair); const m = parseMeta(meta);
  const stages = (stagesRaw || []).map(s => ({ sqrtThreshold: s.sqrtThreshold.toString(), mcapUsd8: s.mcapUsd8.toString(), genes: genesObj(s.genes) }));
  const anyDiv = stages.some(s => s.genes.divShareBps > 0);
  const out = statics[al] = { addr: al, n: name, t: symbol, c: '#3fbcff', pair: SYM[pair] || 'ETH', pairAddr: pair,
    poolId: L.poolId, createdAt: Number(L.createdAt), creator: lower(L.creator), isDiv: anyDiv,
    stagesRaw: stages, instincts: instinctsOf(stages.length ? stages.map(s => s.genes) : []),
    img: m.image || '', desc: m.description || '', links: { web: m.website || m.web || '', x: m.x || m.twitter || '', tg: m.telegram || m.tg || '' } };
  LS.set(SKEY, statics); return out;
}
async function loadOne(a, trades) {
  const s = await loadStatic(a); const c = coinOf(a);
  const [cfg, hidden, st, pUsd, creatorOwed, platformOwed, divPot, bbPot, pos] = await Promise.all([
    hook.config(s.poolId).catch(() => null), factory.hidden(a).catch(() => false), poolState(s.poolId), pairUsd(s.pairAddr),
    hook.creatorOwed(a).catch(() => 0n), hook.platformOwed(a).catch(() => 0n), hook.dividendPot(a).catch(() => 0n), hook.buybackPot(a).catch(() => 0n), hook.positionOf(a).catch(() => null)]);
  const g = cfg ? genesObj(cfg.genes) : (s.stagesRaw[0] ? s.stagesRaw[0].genes : genesObj({}));
  const currentStage = cfg ? Number(cfg.currentStage) : 0;
  const pxPair = pairPerToken(st.sqrtPriceX96); const px = pxPair * pUsd;
  const tt = trades.filter(t => t.token === s.addr); const t0 = now();
  const vol = w => tt.filter(t => t.ts >= t0 - w).reduce((acc, t) => acc + Number(t.pair) / 1e18 * pUsd, 0);
  const chg = w => { const past = [...tt].reverse().find(t => t.ts <= t0 - w); const base = past ? tradePrice(past) * pUsd : px; return base > 0 ? (px / base - 1) * 100 : 0; };
  const posObj = pos ? { tickLower: Number(pos.tickLower), tickUpper: Number(pos.tickUpper), liquidity: pos.liquidity } : { tickLower: 0, tickUpper: 0, liquidity: st.liquidity };
  const liqP = Number(pairInRange(st, posObj)) / 1e18;
  const rewards = g.divShareBps > 0 || s.stagesRaw.some(x => x.genes.divShareBps > 0);
  const totalDiv = s.isDiv ? Number(await divOf(a).totalDividends().catch(() => 0n)) / 1e18 : 0;
  return { ...s, genes: g, currentStage, stageCount: cfg ? Number(cfg.stageCount) : (s.stagesRaw.length || 1),
    feeBps: g.feeBps, feeMode: FEEMODE[g.feeMode] || 'flat', feeLabel: FEEMODE[g.feeMode] || 'flat',
    mc: px * SUPPLY, px, pxPair, pairUsd: pUsd, hidden, age: ageStr(s.createdAt),
    vol: vol(86400), volAll: tt.reduce((acc, t) => acc + Number(t.pair) / 1e18 * pUsd, 0), feeUsd: 0,
    tx: tt.filter(t => t.ts >= t0 - 86400).length, trades: tt.length, c5: chg(300), c1: chg(3600), c24: chg(86400),
    liq: liqP * pUsd, liqPair: liqP, h: (byAddr[s.addr] ? byAddr[s.addr].h : 0), traders: new Set(tt.map(t => t.wallet)).size,
    rewards, basket: [], creator: s.creator, creatorBps: 6000, rew24: 0, cre24: 0,
    totalHolderRewards: totalDiv, totalCreatorFees: Number(creatorOwed) / 1e18,
    creatorOwed: Number(creatorOwed) / 1e18, platformOwed: Number(platformOwed) / 1e18, dividendPot: Number(divPot) / 1e18, buybackPot: Number(bbPot) / 1e18,
    evo: evoFrom(s.stagesRaw, currentStage), sqrtPriceX96: st.sqrtPriceX96.toString(), liquidity: st.liquidity.toString() };
}
async function loadTokens() {
  const n = Number(await factory.totalTokens());
  const [addrs, trades] = await Promise.all([Promise.all([...Array(n)].map((_, i) => factory.allTokens(i))), allTrades()]);
  const list = (await Promise.all(addrs.map(a => loadOne(a, trades).catch(e => { console.warn('loadOne', a, e && e.message); return null; })))).filter(Boolean);
  tokens = list; byAddr = Object.fromEntries(list.map(x => [x.addr, x]));
  LS.set(TKEY, { t: Date.now(), eth: memo.ethusd ? memo.ethusd.v : 0, list });
  return list;
}
function loadSnapshot() {
  const s = LS.get(TKEY); if (!s || !Array.isArray(s.list) || !s.list.length) return false;
  tokens = s.list.map(x => ({ ...x, age: ageStr(x.createdAt) })); byAddr = Object.fromEntries(tokens.map(x => [x.addr, x]));
  if (s.eth > 0 && !memo.ethusd) memo.ethusd = { v: s.eth, t: Date.now() - 50_000 };
  return true;
}
async function refreshOne(addr) { const trades = await allTrades(); const x = await loadOne(addr, trades); const i = tokens.findIndex(t => t.addr === x.addr); if (i >= 0) tokens[i] = x; else tokens.push(x); byAddr[x.addr] = x; return x; }

// ---------------------------------------------------------------- liquidity via positionOf (accurate pair-in-range)
async function liquidityUsd(x) {
  try { const pos = await hook.positionOf(x.addr); const st = await poolState(x.poolId); const inr = pairInRange(st, { tickLower: Number(pos.tickLower), tickUpper: Number(pos.tickUpper), liquidity: pos.liquidity }); return Number(inr) / 1e18; }
  catch { return 0; }
}

// ---------------------------------------------------------------- quotes
async function feeBps(x, isBuy = true) { try { return Number(await hook.feeBpsNow(x.addr, isBuy)); } catch { return x && x.feeBps ? x.feeBps : 100; } }
async function quoteBuy(addr, pairIn) {
  const x = byAddr[lower(addr)]; if (!x) throw new Error('unknown token'); const st = await poolState(x.poolId); const L = st.liquidity; if (L === 0n) return 0n;
  const fee = BigInt(await feeBps(x, true)); const inNet = pairIn - pairIn * fee / BPS; const sqrtP = st.sqrtPriceX96;
  const sqrtNew = sqrtP + inNet * Q96 / L; return L * Q96 * (sqrtNew - sqrtP) / (sqrtNew * sqrtP);
}
async function quoteSell(addr, coinIn) {
  const x = byAddr[lower(addr)]; if (!x) throw new Error('unknown token'); const st = await poolState(x.poolId); const L = st.liquidity; if (L === 0n) return 0n;
  const fee = BigInt(await feeBps(x, false)); const sqrtP = st.sqrtPriceX96;
  const sqrtNew = L * sqrtP * Q96 / (L * Q96 + coinIn * sqrtP); const out = L * (sqrtP - sqrtNew) / Q96;
  return out - out * fee / BPS;
}
async function quoteBuyEth(addr, ethIn) { return quoteBuy(addr, ethIn); }      // WETH pairs only on mainnet for now
async function quoteSellEth(addr, coinIn) { return quoteSell(addr, coinIn); }

// ---------------------------------------------------------------- wallet / tx
async function signer() {
  const w = window.inkyWallet; if (!w || !w.connected) throw new Error('Connect your wallet first');
  if (w.chainId && Number(w.chainId) !== CHAIN_ID) { if (w.switchChain) await w.switchChain(CHAIN_ID); else if (w.switchToInk) await w.switchToInk(); }
  const s = await w.getSigner(); if (!s) throw new Error('Wallet not ready'); return s;
}
async function send(fn) { const tx = await fn(); const rc = await tx.wait(); memo.trades = null; return rc; }

// ---------------------------------------------------------------- launch helpers
function buildStages(g, evo) {
  if (!evo || !evo.enabled) return [];
  const base = genesObj(g);
  const bbThr = base.buybackThreshold > 0n ? base.buybackThreshold : ethers.parseEther('0.05');
  const training = { feeMode: base.feeMode, feeBps: base.feeBps, snipeBps: 0, snipeBlocks: 0,
    buybackShareBps: Math.max(base.buybackShareBps, 2000), divShareBps: base.divShareBps, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: bbThr };
  const autonomous = { feeMode: base.feeMode, feeBps: Math.min(base.feeBps, 100), snipeBps: 0, snipeBlocks: 0,
    buybackShareBps: training.buybackShareBps, divShareBps: Math.max(base.divShareBps, 3000), maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: bbThr };
  const t1 = BigInt(Math.round(Number(evo.trainingMcapUsd || 10000))) * (10n ** 8n);
  const t2 = BigInt(Math.round(Number(evo.autonomousMcapUsd || 50000))) * (10n ** 8n);
  return [{ mcapUsd8: t1, genes: training }, { mcapUsd8: t2, genes: autonomous }];
}

const api = {
  ready: null, stale: false, tokens: () => tokens, token: a => byAddr[lower(a)],
  trades: async a => (await allTrades()).filter(t => !a || t.token === lower(a)), allTrades, tradePrice,
  ethUsd, pairUsd, explorer: EXPLORER, symbolOf: a => SYM[lower(a)] || '', stocks: [], weth: WETH,
  async load() {
    const full = () => retry(loadTokens, 3);
    if (loadSnapshot()) { api.stale = true; full().then(() => { api.stale = false; window.dispatchEvent(new CustomEvent('chain-update')); }).catch(e => console.warn('bg refresh', e)); }
    else await full();
    window.dispatchEvent(new CustomEvent('chain-ready')); return tokens;
  },
  async refresh(addr) { memo.trades = null; if (addr) return refreshOne(addr); const l = await loadTokens(); window.dispatchEvent(new CustomEvent('chain-update')); return l; },
  quoteBuy, quoteSell, quoteBuyEth, quoteSellEth, feeBps: a => feeBps(byAddr[lower(a)], true),
  // ---- trades / live ticks
  async buy(addr, ethIn, minOut) { const s = await signer(); const me = await s.getAddress(); const ro = new ethers.Contract(C.router, ABI.OneRouter, provider); let g; try { g = await ro.buy.estimateGas(addr, '0x', minOut, { from: me, value: ethIn }); } catch { g = 600000n; } const r = new ethers.Contract(C.router, ABI.OneRouter, s); return send(() => r.buy(addr, '0x', minOut, { value: ethIn, gasLimit: g * 13n / 10n })); },
  async sell(addr, amount, minEthOut) { const s = await signer(); const me = await s.getAddress(); const c = coinOf(addr, s); const al = await c.allowance(me, C.router); if (al < amount) await (await c.approve(C.router, ethers.MaxUint256)).wait(); const ro = new ethers.Contract(C.router, ABI.OneRouter, provider); let g; try { g = await ro.sell.estimateGas(addr, amount, '0x', minEthOut, { from: me }); } catch { g = 600000n; } const r = new ethers.Contract(C.router, ABI.OneRouter, s); return send(() => r.sell(addr, amount, '0x', minEthOut, { gasLimit: g * 13n / 10n })); },
  async launch(p, devBuyWei) {
    const s = await signer(); const me = await s.getAddress(); const f = new ethers.Contract(C.factory, ABI.OneHookFactory, s);
    const g = p.genes || {}; const genes = genesObj(g); const stages = buildStages(g, g.evolution);
    const pair = p.pair || WETH; const route = '0x';
    const ro = new ethers.Contract(C.factory, ABI.OneHookFactory, provider);
    let gas, salt;
    for (let i = 0; i < 16; i++) {
      salt = ethers.hexlify(ethers.randomBytes(32));
      const params = { name: p.name, symbol: p.symbol, metadataURI: p.metadataURI, pair, minPairOut: p.minPairOut || 0, genes, stages };
      try { gas = await ro.launch.estimateGas(params, salt, route, { from: me, value: devBuyWei || 0n }); break; }
      catch (e) { const m = String(e && (e.shortMessage || e.message) || e);
        if (/InvalidParams|token.*pair|0x7983c051|sort/i.test(m) && i < 15) continue; // CREATE2 address didn't sort below the pair; try another salt
        if (/insufficient funds/i.test(m)) throw new Error('Not enough ETH in the wallet for the launch');
        if (/BadGenes/i.test(m)) throw new Error('The chosen instincts/evolution are out of bounds; adjust the fee, shares, caps or milestones.');
        if (i >= 15) throw new Error('The launch would fail: ' + (m.length > 140 ? m.slice(0, 140) + '…' : m));
      }
    }
    if (!gas) throw new Error('Could not find a valid launch salt; try again');
    const params = { name: p.name, symbol: p.symbol, metadataURI: p.metadataURI, pair, minPairOut: p.minPairOut || 0, genes, stages };
    const rc = await send(() => f.launch(params, salt, route, { value: devBuyWei || 0n, gasLimit: gas * 12n / 10n }));
    let token = null; for (const l of rc.logs) { try { const d = ifaceFactory.parseLog(l); if (d && d.name === 'Launched') token = ethers.getAddress(d.args.token); } catch {} } return { rc, token };
  },
  // ---- per-user reads
  ethBalance: async user => provider.getBalance(user),
  balance: async (addr, user) => coinOf(addr).balanceOf(user),
  pending: async (addr, user) => { const x = byAddr[lower(addr)]; if (!x || !x.isDiv) return 0n; try { return await divOf(addr).withdrawableDividends(user); } catch { return 0n; } },
  position: async (addr, user) => { try { const bal = await coinOf(addr).balanceOf(user); return { avg: 0, units: Number(bal) / 1e18 }; } catch { return { avg: 0, units: 0 }; } },
  async holders() { return []; },           // no client-side holder index on mainnet without an API key
  async topTraders(addr) { const tt = (await allTrades()).filter(t => t.token === lower(addr)); const x = byAddr[lower(addr)]; const pUsd = x ? x.pairUsd : 0; const by = {};
    for (const t of tt) { const r = by[t.wallet] || (by[t.wallet] = { wallet: t.wallet, pnl: 0, volume: 0, trades: 0, bought: 0, sold: 0 }); r.volume += Number(t.pair) / 1e18 * pUsd; r.trades++; if (t.buy) r.bought += Number(t.coin) / 1e18; else r.sold += Number(t.coin) / 1e18; }
    return Object.values(by).map(r => ({ ...r, holding: r.bought - r.sold > 1 })).sort((a, b) => b.volume - a.volume); },
  // ---- claims / cranks
  async claim(addr) { const x = byAddr[lower(addr)]; if (!x || !x.isDiv) throw new Error('This coin has no dividends'); const s = await signer(); return send(() => divOf(addr, s).claimDividends()); },
  async payCreator(addr) { const s = await signer(); return send(() => new ethers.Contract(C.hook, ABI.OneHookHook, s).payCreator(addr)); },
  async pushDividends(addr) { const s = await signer(); return send(() => new ethers.Contract(C.hook, ABI.OneHookHook, s).pushDividends(addr)); },
  async buybackBurn(addr) { const s = await signer(); return send(() => new ethers.Contract(C.hook, ABI.OneHookHook, s).buybackBurn(addr)); },
  platformOwed: async addr => { try { return Number(await hook.platformOwed(addr)) / 1e18; } catch { return 0; } },
  // ---- admin (the connected wallet must be the admin; the contracts enforce it)
  async setHidden(addr, hidden) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.OneHookFactory, s).setHidden(addr, hidden)); },
  async setMetadata(addr, uri) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.OneHookFactory, s).setCoinMetadata(addr, uri)); },
  async collect(addr, bps, recipient) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.OneHookFactory, s).collect(addr, bps, recipient)); },
  async setFeeRecipient(a) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.OneHookFactory, s).setFeeRecipient(a)); },
  async pushPlatformFees(addrs) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.OneHookFactory, s).pushPlatformFees(addrs)); },
  async pause() { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.OneHookFactory, s).pause()); },
  async resume() { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.OneHookFactory, s).resume()); },
  async setTokenBlocked(a, b) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.OneHookFactory, s).setTokenBlocked(a, b)); },
  async setStartCap(usd8) { const s = await signer(); return send(() => new ethers.Contract(C.factory, ABI.OneHookFactory, s).setStartCap(usd8)); },
  feeRecipient: () => factory.feeRecipient(),
  // ---- profile (rebuilt from balances + dividends; no on-chain Ledger)
  async profile(user) { user = lower(user); const trades = (await allTrades()).filter(t => t.wallet === user);
    const held = await Promise.all(tokens.map(async x => { const [bal, pend] = await Promise.all([coinOf(x.addr).balanceOf(user).catch(() => 0n), api.pending(x.addr, user)]); return { x, bal: Number(bal) / 1e18, avg: 0, pend: Number(pend) / 1e18, pendUsd: Number(pend) / 1e18 * x.pairUsd }; }));
    const created = await Promise.all(tokens.filter(x => x.creator === user).map(async x => ({ x, fees: Number(await hook.creatorOwed(x.addr).catch(() => 0n)) / 1e18 })));
    return { trades, holdings: held.filter(h => h.bal > 0 || h.pend > 0), created, claims: [], payoutClaimable: 0, lifetimePnl: 0, epoch: { n: 0, pnl: 0, fees: 0, volume: 0, trades: 0 } }; },
  // ---- leaderboard / epochs: OneHook has none -> graceful no-ops so shared pages render empty
  async board() { return { epoch: 0, current: 0, pool: 0, ends: 0, settled: false, lastPaid: 0, rows: [], traders: 0, pnl: [], vol: [] }; },
  currentEpoch: async () => 0, settled: async () => false, async settle() { throw new Error('No leaderboard on OneHook'); }, payoutClaimable: async () => 0, async claimPayout() { throw new Error('No leaderboard on OneHook'); },
  treasuryWeth: async () => 0, treasuryRecipient: async () => '', async sweep() { throw new Error('No treasury on OneHook'); }, async setTreasuryRecipient() { throw new Error('No treasury on OneHook'); },
  quoteAsset: async () => ({ approved: false, usdPrice8: 0, feed: ethers.ZeroAddress }), async setQuoteAsset() { throw new Error('Pricing is oracle-driven on OneHook'); },
  // ---- utils
  checksum: a => { try { return ethers.getAddress(a); } catch { return a; } },
  isAddress: a => ethers.isAddress(a || ''),
  parseEther: v => ethers.parseEther(String(v)), formatEther: v => ethers.formatEther(v),
  routeFor: () => '0x',
  // ---- candles (from router trades)
  async bars(addr, res, from, to) { const x = byAddr[lower(addr)]; if (!x) return []; const all = (await allTrades()).filter(t => t.token === lower(addr)); const start = Math.floor(x.createdAt / res) * res; const end = Math.min(to, now() + 1);
    if (to <= start || !all.length) { // flat line at the current price until the first trade
      const out = []; const p = x.pxPair || 0; for (let b = Math.max(start, Math.floor(from / res) * res); b < end && p > 0; b += res) out.push({ time: b, open: p, high: p, low: p, close: p, volume: 0 }); return out; }
    let last = tradePrice(all[0]) || (x.pxPair || 0); const out = []; let i = 0;
    for (; i < all.length && all[i].ts < Math.max(from, start); i++) { const p = tradePrice(all[i]); if (p > 0) last = p; }
    for (let b = Math.max(start, Math.floor(from / res) * res); b < end; b += res) { const bar = { time: b, open: last, high: last, low: last, close: last, volume: 0 };
      for (; i < all.length && all[i].ts < b + res; i++) { if (all[i].ts < b) continue; const p = tradePrice(all[i]); if (!(p > 0)) continue; bar.high = Math.max(bar.high, p); bar.low = Math.min(bar.low, p); bar.close = p; bar.volume += Number(all[i].pair) / 1e18; last = p; }
      out.push(bar); } return out; },
  lastPrice(addr) { const x = byAddr[lower(addr)]; return x ? x.pxPair : 0; },
  liquidityUsd,
};
window.CHAIN = api;
if (C.factory) { api.ready = api.load().catch(e => { console.error('chain load failed', e); window.dispatchEvent(new CustomEvent('chain-error', { detail: String(e && e.message || e) })); }); }
