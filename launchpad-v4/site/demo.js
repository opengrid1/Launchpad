/* Demo data layer: the DATA interface on generated, deterministic coins so every page works before the contracts
   exist. chain.js will implement the same interface on the live contracts and programs.
   A coin has one pool per chain (hyper, sol), each 1B supply against HYPE, opened at the same price.
   DATA: ready(), tokens(), token(addr), trades(addr, chain?), candles(addr, stepSec, chain), holders(addr, chain?),
   positions(addr, chain), feeState(addr, chain), quoteBuy(addr, chain, hypeIn), quoteSell(addr, chain, tokensIn),
   balance(addr, chain, wallet), hypeBalance(chain), creator(wallet), buy(), sell(), launch(params), claim(), stats(). */
(function () {
  const C = window.CFG, E = C.econ, SUPPLY = E.supply, CH = C.chains.map((c) => c.key);
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const hex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(rnd() * 16)]; return s; };
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; const b58 = (n) => { let s = ''; for (let i = 0; i < n; i++) s += B58[Math.floor(rnd() * 58)]; return s; };
  const addrV = () => '0x' + hex(36) + '0000', addr = () => '0x' + hex(40), saddr = () => b58(44);
  const NAMES = [['Hyper Cat', 'HCAT', '🐱'], ['Purr', 'PURR', '😺'], ['Liquid Frog', 'LFROG', '🐸'], ['God Mode', 'GOD', '⚡'], ['Vapor', 'VAPOR', '🌫️'], ['Chad Whale', 'CHAD', '🐳'], ['Moon Boi', 'MOONB', '🌙'], ['Degen Ape', 'DAPE', '🦍'], ['Rekt', 'REKT', '💀'], ['Pepe HL', 'PEPEHL', '🐸'], ['Based', 'BASED', '🗿'], ['Giga', 'GIGA', '💪'], ['Wojak', 'WOJ', '😐'], ['Hype Dog', 'HDOG', '🐶'], ['Zoomer', 'ZOOM', '🛹'], ['Nuke', 'NUKE', '☢️'], ['Orbit', 'ORBIT', '🪐'], ['Shrimp', 'SHRMP', '🦐'], ['Lobster', 'LOBS', '🦞'], ['Turbo', 'TURBO', '🏎️'], ['Pixel', 'PIXL', '👾'], ['Sigma', 'SIGMA', '🐺'], ['Alpha Cat', 'ACAT', '🐈‍⬛'], ['Hodl', 'HODL', '🙌'], ['Yolo', 'YOLO', '🎲'], ['Fomo', 'FOMO', '😱'], ['Sunset', 'SUN', '🌅'], ['Nebula', 'NEB', '🌌']];
  const DESC = ['The first cat on HyperEVM and Solana at once. No roadmap, just vibes.', 'Community coin. Locked liquidity on both chains, 1% fee, creator pays it forward.', 'Built for the HYPE season. Fees go back to the people trading it.', 'A frog that never sells.', 'Trade it on either chain, hold it, meme it.', 'Launched by degens, for degens.', 'What if a coin was actually fair.', 'Every swap pays the creator. Every holder knows it.'];
  const COLORS = ['#34c759', '#ff9500', '#af52de', '#ffcc00', '#30b0c7', '#ff3b30', '#007aff', '#ff2d55', '#5ac8fa', '#a2845e'];
  const EMOJI_FONT = 'Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif';
  const logoFor = (sym, col, emoji) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="${col}" stop-opacity=".55"/></linearGradient><linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="120" height="120" rx="28" fill="#0c0f12"/><rect width="120" height="120" rx="28" fill="url(#g)"/><rect width="120" height="120" rx="28" fill="url(#h)"/>${emoji ? `<text x="60" y="80" font-family="${EMOJI_FONT}" font-size="60" text-anchor="middle">${emoji}</text>` : `<text x="60" y="72" font-family="-apple-system,Inter,sans-serif" font-weight="700" font-size="${sym.length > 4 ? 26 : 36}" fill="#fff" text-anchor="middle">${sym.slice(0, 5)}</text>`}</svg>`);
  const now = () => Math.floor(Date.now() / 1000);

  // one pool: constant product seeded at the opening market cap (the three bands approximate it)
  const priceAt = (net) => (E.openMcapHype + net) ** 2 / E.openMcapHype / SUPPLY; // HYPE per token after `net` HYPE of net buys
  const tokensFor = (net) => SUPPLY * (1 - E.openMcapHype / (E.openMcapHype + net)); // tokens out of the pool after `net`
  const snipeBps = (el) => (el >= E.snipeSeconds || el < 0) ? 0 : E.snipeStartBps >> Math.floor(el * E.snipeHalvings / E.snipeSeconds);
  const T = [], BY = {};
  function mkPool(chain) { return { chain, net: 0, trades: [], holders: null, vol24: 0, volAll: 0, feesAll: 0, buys24: 0, sells24: 0, lastVolSpike: 0, poolId: chain === 'sol' ? saddr() : '0x' + hex(64), lockedIds: [] }; }
  function addTrade(t, chain, { buy, hype, wallet, ts, snipe = 0, vol = 0 }) {
    const P = t.pools[chain], feeBps = E.feeBps + t.creatorTaxBps + vol, p0 = priceAt(P.net); let tokens, fee, tax = 0;
    if (buy) { tax = hype * snipe / 10000; fee = (hype - tax) * feeBps / 10000; const net = hype - tax - fee; const before = tokensFor(P.net); P.net += net; tokens = tokensFor(P.net) - before; }
    else { const before = tokensFor(P.net); const tokensIn = Math.min(before * 0.99, hype / p0); const netAfter = E.openMcapHype * SUPPLY / (SUPPLY - (before - tokensIn)) - E.openMcapHype; const gross = P.net - netAfter; P.net = netAfter; tokens = tokensIn; fee = gross * feeBps / 10000; hype = gross - fee; }
    const tr = { tx: chain === 'sol' ? b58(88) : '0x' + hex(64), chain, wallet, buy, hype, tokens, fee: fee + tax, feeBps, snipeBps: snipe, volBps: vol, px: priceAt(P.net), ts };
    P.trades.push(tr); P.volAll += hype; P.feesAll += fee + tax; if (ts > now() - 86400) { P.vol24 += hype; buy ? P.buys24++ : P.sells24++; } P.holders = null; return tr;
  }
  function mkToken(i, ageSec) {
    const [n, s, em] = NAMES[i % NAMES.length], col = COLORS[i % COLORS.length], created = now() - ageSec;
    const t = { addr: addrV(), mint: saddr(), name: n, symbol: s, emoji: em, img: logoFor(s, col, em), desc: pick(DESC), links: { x: rnd() > .4 ? 'https://x.com/' + s.toLowerCase() : '', tg: rnd() > .5 ? 'https://t.me/' + s.toLowerCase() : '', web: rnd() > .7 ? 'https://' + s.toLowerCase() + '.xyz' : '' },
      creator: addr(), creatorSol: saddr(), createdAt: created, creatorTaxBps: pick([0, 0, 0, 100, 200, 500]), buyback: rnd() > .6, chains: rnd() > .15 ? ['hyper', 'sol'] : ['hyper'], pools: {} };
    for (const c of t.chains) { t.pools[c] = mkPool(c); t.pools[c].lockedIds = c === 'sol' ? [saddr()] : [1 + i * 3, 2 + i * 3, 3 + i * 3]; }
    const wallets = { hyper: Array.from({ length: 8 + Math.floor(rnd() * 30) }, addr), sol: Array.from({ length: 6 + Math.floor(rnd() * 24) }, saddr) };
    addTrade(t, 'hyper', { buy: true, hype: 0.2 + rnd() * 2, wallet: t.creator, ts: created + 1 });
    if (t.pools.sol) addTrade(t, 'sol', { buy: true, hype: 0.05 + rnd() * 0.2, wallet: 'launch', ts: created + 40 });
    for (const c of t.chains) { const P = t.pools[c], nTr = Math.min(400, Math.max(5, Math.floor(ageSec / 60 * (0.25 + rnd() * 1.2) * (c === 'sol' ? 0.7 : 1)))); let ts = created + (c === 'sol' ? 45 : 2);
      for (let k = 1; k < nTr; k++) { ts += Math.max(1, Math.floor((ageSec - 2) / nTr * (0.3 + rnd() * 1.4))); if (ts > now()) break; const buy = rnd() < (0.52 + (k < nTr * 0.3 ? 0.12 : 0)); if (!buy && P.net < 0.5) continue; const size = Math.min(P.net * 0.6, (0.05 + rnd() ** 2.2 * 8) * (buy ? 1 : 0.8)); addTrade(t, c, { buy, hype: Math.max(0.01, size), wallet: pick(wallets[c]), ts, snipe: buy && ts - created < E.snipeSeconds ? snipeBps(ts - created) : 0 }); } }
    T.push(t); BY[t.addr] = t; return t;
  }
  const AGES = [90, 300, 900, 2400, 7200, 18000, 32400, 50400, 86400, 129600, 172800, 259200, 345600, 432000, 518400, 604800, 691200, 777600, 864000, 950400, 1036800, 1123200, 1209600, 1296000, 1382400, 1468800, 1555200, 1728000];
  for (let i = 0; i < 28; i++) mkToken(i, AGES[i]);
  // coins launched in this browser during the preview survive a reload
  const SAVED = (() => { try { return JSON.parse(localStorage.getItem('demoLaunches') || '[]'); } catch { return []; } })();
  function applyLaunch(t, p, i) { t.name = p.name; t.symbol = p.symbol; t.emoji = ''; t.img = p.image || logoFor(p.symbol, COLORS[i % COLORS.length]); t.desc = p.description; t.links = { x: p.x, tg: p.telegram, web: p.website }; t.creator = p.creator; t.creatorSol = p.creatorSol || ''; t.creatorTaxBps = p.creatorTaxBps; t.buyback = p.buyback; t.chains = p.chains; t.pools = {}; for (const c of t.chains) { t.pools[c] = mkPool(c); t.pools[c].lockedIds = c === 'sol' ? [saddr()] : [100 + i * 3, 101 + i * 3, 102 + i * 3]; } t.createdAt = p.createdAt; if (p.addr) { delete BY[t.addr]; t.addr = p.addr; BY[t.addr] = t; } if (p.devBuy > 0) addTrade(t, 'hyper', { buy: true, hype: p.devBuy, wallet: t.creator, ts: p.createdAt }); if (t.pools.sol && now() - p.createdAt > 20) addTrade(t, 'sol', { buy: true, hype: 0.1, wallet: 'launch', ts: p.createdAt + 20 }); }
  for (const p of SAVED) { try { const t = mkToken(T.length, Math.max(1, now() - p.createdAt)); applyLaunch(t, p, T.length - 1); } catch (e) { console.warn('saved launch', e); } }

  // views
  function feeState(a, chain) {
    const t = BY[a]; if (!t) return null; const P = t.pools[chain || 'hyper'] || t.pools.hyper; const n = now(), el = n - t.createdAt;
    if (el < E.snipeSeconds) return { kind: 'snipe', bps: E.feeBps + t.creatorTaxBps, snipeBps: snipeBps(el), left: E.snipeSeconds - el, total: E.feeBps + t.creatorTaxBps + snipeBps(el) };
    const since = n - P.lastVolSpike; let extra = 0; if (P.lastVolSpike && since < E.volDecaySec) extra = Math.round((E.volPeakBps - E.feeBps) * (1 - since / E.volDecaySec));
    return { kind: extra > 0 ? 'vol' : 'base', bps: E.feeBps + t.creatorTaxBps, extraBps: extra, left: extra > 0 ? E.volDecaySec - since : 0, total: E.feeBps + t.creatorTaxBps + extra };
  }
  function holders(a, chain) {
    const t = BY[a]; if (!t) return []; const cs = chain ? [chain] : t.chains; const bal = {};
    for (const c of cs) { const P = t.pools[c]; if (!P) continue; for (const tr of P.trades) { const k = tr.wallet; bal[k] = bal[k] || { wallet: k, chain: c, bal: 0 }; bal[k].bal += tr.buy ? tr.tokens : -tr.tokens; } }
    const rows = Object.values(bal).filter((r) => r.bal > 1 && r.wallet !== 'launch').map((r) => ({ ...r, share: r.bal / (SUPPLY * cs.length) * 100, creator: r.wallet === t.creator })).sort((x, y) => y.bal - x.bal);
    for (const c of cs) { const P = t.pools[c]; if (!P) continue; const inPool = SUPPLY - tokensFor(P.net); rows.unshift({ wallet: c === 'sol' ? 'Pool (Meteora DAMM v2)' : 'Pool (Uniswap v4)', chain: c, bal: inPool, share: inPool / (SUPPLY * cs.length) * 100, pool: true }); }
    return rows.sort((x, y) => y.bal - x.bal);
  }
  function poolView(t, c) { const P = t.pools[c]; const px = priceAt(P.net); const trs = P.trades; const pxAgo = (s) => { const cut = now() - s; for (let i = trs.length - 1; i >= 0; i--) if (trs[i].ts <= cut) return trs[i].px; return trs[0] ? trs[0].px : px; }; return { chain: c, px, pxUsd: px * APP.hypeUsd, mcap: px * SUPPLY, liqHype: P.net * 2 + 0.0001, vol24: P.vol24, volAll: P.volAll, feesAll: P.feesAll, trades: trs.length, buys24: P.buys24, sells24: P.sells24, c5: (px / pxAgo(300) - 1) * 100, c1: (px / pxAgo(3600) - 1) * 100, c24: (px / pxAgo(86400) - 1) * 100, inPool: SUPPLY - tokensFor(P.net), poolId: P.poolId, lockedIds: P.lockedIds, fee: feeState(t.addr, c), lastTs: trs.length ? trs[trs.length - 1].ts : t.createdAt }; }
  function view(t) {
    const by = {}; for (const c of t.chains) by[c] = poolView(t, c); const m = by.hyper; const sum = (k) => t.chains.reduce((s, c) => s + by[c][k], 0);
    const w = (k) => t.chains.reduce((s, c) => s + by[c][k] * by[c].mcap, 0) / (sum('mcap') || 1);
    return { addr: t.addr, mint: t.mint, name: t.name, symbol: t.symbol, emoji: t.emoji || '', img: t.img, desc: t.desc, links: t.links, creator: t.creator, creatorSol: t.creatorSol, createdAt: t.createdAt, age: APP.ago(t.createdAt), chains: t.chains, byChain: by,
      px: m.px, pxUsd: m.pxUsd, mcap: sum('mcap'), mcapUsd: sum('mcap') * APP.hypeUsd, liqHype: sum('liqHype'), vol24: sum('vol24'), volAll: sum('volAll'), feesAll: sum('feesAll'), trades: sum('trades'), buys24: sum('buys24'), sells24: sum('sells24'), holders: holders(t.addr).filter((h) => !h.pool).length, c5: w('c5'), c1: w('c1'), c24: w('c24'),
      creatorTaxBps: t.creatorTaxBps, buyback: t.buyback, feeBps: E.feeBps, creatorShareBps: E.creatorShareBps, lastTs: Math.max(...t.chains.map((c) => by[c].lastTs)), fee: m.fee };
  }
  function candles(a, step, chain) {
    const t = BY[a]; if (!t) return []; const P = t.pools[chain || 'hyper']; if (!P || !P.trades.length) return []; const out = []; let cur = null;
    for (const tr of P.trades) { const b = Math.floor(tr.ts / step) * step; if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { t: b, o: cur ? cur.c : tr.px, h: tr.px, l: tr.px, c: tr.px, v: 0 }; cur.h = Math.max(cur.h, cur.o); cur.l = Math.min(cur.l, cur.o); } cur.h = Math.max(cur.h, tr.px); cur.l = Math.min(cur.l, tr.px); cur.c = tr.px; cur.v += tr.hype; }
    if (cur) out.push(cur); return out;
  }
  const ME = (chain) => (chain === 'sol' ? (APP.W.sol.connected ? APP.W.sol.address : '') : (APP.W.connected ? APP.W.address : ''));
  const demoBal = { hyper: 12.5, sol: 4.2 };
  function quoteBuy(a, chain, hypeIn) { const t = BY[a]; const P = t && t.pools[chain]; if (!P || !(hypeIn > 0)) return { tokens: 0, fee: 0, snipe: 0, px: P ? priceAt(P.net) : 0, impact: 0, feeBps: 0 }; const fs = feeState(a, chain), snipe = fs.kind === 'snipe' ? fs.snipeBps : 0, feeBps = fs.total - snipe; const tax = hypeIn * snipe / 10000, fee = (hypeIn - tax) * feeBps / 10000, net = hypeIn - tax - fee; const tokens = tokensFor(P.net + net) - tokensFor(P.net); return { tokens, fee, snipe: tax, feeBps: fs.total, px: priceAt(P.net), impact: (priceAt(P.net + net) / priceAt(P.net) - 1) * 100 }; }
  function quoteSell(a, chain, tokensIn) { const t = BY[a]; const P = t && t.pools[chain]; if (!P || !(tokensIn > 0)) return { hype: 0, fee: 0, px: P ? priceAt(P.net) : 0, impact: 0, feeBps: 0 }; const before = tokensFor(P.net); if (tokensIn > before) tokensIn = before; const netAfter = E.openMcapHype * SUPPLY / (SUPPLY - (before - tokensIn)) - E.openMcapHype; const gross = P.net - netAfter, fs = feeState(a, chain), fee = gross * fs.total / 10000; return { hype: gross - fee, fee, feeBps: fs.total, px: priceAt(P.net), impact: (priceAt(netAfter) / priceAt(P.net) - 1) * 100 }; }
  const spike = (P, p0) => { if (Math.abs(priceAt(P.net) / p0 - 1) * 100 >= E.volThresholdBps / 100) P.lastVolSpike = now(); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const DATA = window.DATA = {
    mode: 'demo',
    async ready() { return true; },
    tokens() { return T.map(view).sort((a, b) => b.createdAt - a.createdAt); },
    token(a) { const t = BY[(a || '').toLowerCase()] || T.find((t) => t.mint === a); return t ? view(t) : null; },
    trades(a, chain) { const t = BY[a]; if (!t) return []; const cs = chain ? [chain] : t.chains; return cs.flatMap((c) => (t.pools[c] ? t.pools[c].trades : [])).sort((x, y) => y.ts - x.ts); },
    candles, holders, feeState, quoteBuy, quoteSell,
    positions(a, chain) { const t = BY[a]; const P = t && t.pools[chain || 'hyper']; if (!P) return []; const mc = priceAt(P.net) * SUPPLY; if (chain === 'sol') return [{ id: P.lockedIds[0], pct: 100, lo: E.openMcapHype, hi: Infinity, tokens: SUPPLY, active: true, filled: 0, kind: 'DAMM v2 position, locked' }]; return E.bands.map(([lo, hi, pct], i) => ({ id: P.lockedIds[i], pct, lo, hi, tokens: SUPPLY * pct / 100, active: mc >= lo && mc < hi, filled: Math.max(0, Math.min(1, (mc - lo) / ((hi === Infinity ? lo * 20 : hi) - lo))) })); },
    balance(a, chain, w) { const t = BY[a]; const P = t && t.pools[chain]; if (!P || !w) return 0; return P.trades.filter((x) => x.wallet === w).reduce((s, x) => s + (x.buy ? x.tokens : -x.tokens), 0); },
    hypeBalance(chain) { return demoBal[chain] || 0; },
    creator(w) { const mine = T.filter((t) => t.creator === w).map((t) => { const v = view(t); const fees = v.feesAll * E.creatorShareBps / 10000; return { ...v, creatorFees: fees, pending: fees * 0.18, byChainFees: Object.fromEntries(t.chains.map((c) => [c, t.pools[c].feesAll * E.creatorShareBps / 10000])), bbVested: t.buyback ? fees * 0.5 : 0 }; }); return { tokens: mine, lifetime: mine.reduce((s, x) => s + x.creatorFees, 0), pending: mine.reduce((s, x) => s + x.pending, 0) }; },
    stats() { const ts = T.map(view); return { launches: T.length, launches24: T.filter((t) => t.createdAt > now() - 86400).length, vol24: ts.reduce((s, x) => s + x.vol24, 0), feesAll: ts.reduce((s, x) => s + x.feesAll, 0), creatorsPaid: ts.reduce((s, x) => s + x.feesAll * 0.7, 0) }; },
    async buy(a, chain, hype, minOut) { await APP.W.requireChain(chain); const t = BY[a], P = t.pools[chain]; const q = quoteBuy(a, chain, hype); if (q.tokens < minOut) throw new Error('Slippage: fewer tokens than the minimum'); if (hype > demoBal[chain]) throw new Error('Not enough HYPE on ' + C.chainOf(chain).name); await wait(900); const p0 = priceAt(P.net); demoBal[chain] -= hype; const fs = feeState(a, chain); const tr = addTrade(t, chain, { buy: true, hype, wallet: ME(chain), ts: now(), snipe: fs.kind === 'snipe' ? fs.snipeBps : 0, vol: fs.extraBps || 0 }); spike(P, p0); APP.emit(); return tr; },
    async sell(a, chain, tokens, minOut) { await APP.W.requireChain(chain); const t = BY[a], P = t.pools[chain]; const q = quoteSell(a, chain, tokens); if (q.hype < minOut) throw new Error('Slippage: less HYPE than the minimum'); if (tokens > DATA.balance(a, chain, ME(chain)) + 1e-9) throw new Error('Not enough tokens'); await wait(900); const p0 = priceAt(P.net); const fs = feeState(a, chain); const tr = addTrade(t, chain, { buy: false, hype: tokens * priceAt(P.net), wallet: ME(chain), ts: now(), vol: fs.extraBps || 0 }); demoBal[chain] += tr.hype; spike(P, p0); APP.emit(); return tr; },
    async launch(p) { await APP.W.requireChain('hyper'); await wait(1400); const i = T.length; const t = mkToken(i, 0); const rec = { name: p.name, symbol: p.symbol, image: p.image && p.image.length < 200000 ? p.image : '', description: p.description, x: p.x, telegram: p.telegram, website: p.website, creator: ME('hyper'), creatorSol: p.creatorSol || '', creatorTaxBps: p.creatorTaxBps, buyback: p.buyback, chains: p.chains, createdAt: now(), devBuy: p.devBuy || 0, addr: t.addr }; applyLaunch(t, rec, i); demoBal.hyper -= (p.devBuy || 0) + E.launchFeeHype; try { localStorage.setItem('demoLaunches', JSON.stringify([...SAVED, rec].slice(-10))); SAVED.push(rec); } catch {} if (t.pools.sol) setTimeout(() => { addTrade(t, 'sol', { buy: true, hype: 0.1, wallet: 'launch', ts: now() }); APP.emit(); }, 20000); APP.emit(); return { addr: t.addr, tx: '0x' + hex(64) }; },
    async claim(chain) { await APP.W.requireChain(chain || 'hyper'); await wait(800); const c = DATA.creator(ME('hyper')); demoBal[chain || 'hyper'] += c.pending; APP.emit(); return c.pending; },
  };
  // live: a trade lands on some coin every few seconds, the newest coins most often
  setInterval(() => { const sorted = T.slice().sort((a, b) => b.createdAt - a.createdAt); const n = 1 + Math.floor(Math.random() * 2); for (let k = 0; k < n; k++) { const t = sorted[Math.floor(Math.random() ** 2 * Math.min(T.length, 12))]; if (!t) continue; const c = t.chains[Math.random() < 0.65 ? 0 : t.chains.length - 1], P = t.pools[c]; const buy = Math.random() < 0.55; if (!buy && P.net < 0.5) continue; const p0 = priceAt(P.net); const fs = feeState(t.addr, c); addTrade(t, c, { buy, hype: Math.max(0.02, Math.min(P.net * 0.4, Math.random() ** 2.5 * 6)), wallet: c === 'sol' ? saddr() : addr(), ts: now(), snipe: buy && fs.kind === 'snipe' ? fs.snipeBps : 0, vol: fs.extraBps || 0 }); if (Math.random() < 0.08) P.net *= buy ? 1.12 : 0.9; spike(P, p0); } APP.emit(); }, 3500);
})();
