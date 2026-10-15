/* OneHook data layer + a deterministic market simulation.

   There are no contracts yet, so every coin here is a believable PREVIEW generated from a seed —
   not live chain data. A shared clock (UD.subscribe) walks prices, streams trades and accrues
   gene pools so the whole site breathes; it is seeded and reduced-motion aware. When the OneHook
   hook goes live this module is swapped for one that reads the chain and emits the same events,
   so nothing else on the site changes.

   A coin is spliced from genes. GENES describes each optional gene; CONSTITUTION is the always-on
   core. Every coin also carries real per-gene PARAMETERS (fee mode/bps, buyback threshold,
   dividend share, max-wallet %, anti-snipe decay) so "composable genes" reads as a lab, not a
   brochure. */
(function () {
  const CFG = window.SPLICE || {};
  const ETH_USD = 3200;                         // one shared ETH price for the whole preview

  // ---- seeded RNG (mulberry32) -------------------------------------------------------------
  function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const rngFor = s => mulberry(hash(s));

  // ---- the optional genes ------------------------------------------------------------------
  const GENES = {
    fee:     { key: 'fee',     name: 'Fee engine',     cls: 'g-fee',     short: 'flat / dynamic / MEV-tax',
               desc: 'Sets the swap fee. Flat (a fixed %), dynamic (widens with volatility, tightens when calm), or an MEV-tax that scales the fee with the transaction’s priority fee so snipers and sandwichers pay the pool, not the block builder. Clamped to the constitutional ceiling.' },
    snipe:   { key: 'snipe',   name: 'Anti-snipe',     cls: 'g-snipe',   short: 'decaying launch tax',
               desc: 'An extra tax on the first minutes of trading that decays block by block back to the base fee. Bots that pile into block zero pay it to every holder; by the time real buyers arrive it is gone.' },
    buyback: { key: 'buyback', name: 'Reflexive buyback', cls: 'g-buyback', short: 'fee-funded buy & burn',
               desc: 'A slice of every fee accumulates and, past a threshold, market-buys the coin from its own pool and burns it. Volume tightens supply with no team discretion; the hook does it in the swap path.' },
    div:     { key: 'div',     name: 'Dividends',      cls: 'g-div',     short: 'fees paid to holders',
               desc: 'Routes a share of fees back to holders pro-rata, claimable in ETH. No rebase and no transfer-tax games: the pool collects, the hook splits, holders claim.' },
    maxw:    { key: 'maxw',    name: 'Max-wallet',     cls: 'g-maxw',    short: 'anti-whale cap',
               desc: 'Caps how much any one wallet can buy from the pool for an opening window, then lifts. Keeps a single buyer from owning the launch before a community forms. Enforced by the pool, never the coin: sells and transfers are untouched.' },
    agent:   { key: 'agent',   name: 'AI agent',       cls: 'g-agent',   short: 'post-quantum signed', phase: 2,
               desc: 'An optional off-chain agent proposes fee and buyback parameters within the constitution; the hook reads them read-only and clamps them. Agent instructions are authorised by a hash-based, post-quantum signature scheme, so the coin keeps running even against a quantum adversary.' },
  };
  const GENE_ORDER = ['fee', 'snipe', 'buyback', 'div', 'maxw', 'agent'];

  const CONSTITUTION = [
    { name: 'Anti-sandwich', desc: 'Every pool taxes priority-fee bidding at the base: the harder a sandwich bot bids the block builder to bracket your trade, the more it pays the pool. Ordinary wallets pay nothing extra.' },
    { name: 'Fee ceiling',   desc: 'No instinct can push the total fee past the hard cap. Every fee result is clamped at the source.' },
    { name: 'Sells never block', desc: 'The hook can read a sell but can never revert one. No honeypots, no pausing, no blacklist.' },
    { name: 'Liquidity in the open', desc: 'All liquidity lives in the one hook and nobody can pull it on a whim: touching any of it takes a public on-chain notice 24 hours in advance, at most a fifth at a time, visible to every holder.' },
    { name: 'No owner, no mint', desc: 'The token is fixed-supply, ownerless, with no mint, no pause and no transfer tax. Mechanics live in the pool, not the coin.' },
  ];

  const FEE_MODES = { flat: 'Flat', dynamic: 'Dynamic', mev: 'MEV-tax' };
  const addrFrom = r => '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');

  // ---- per-coin gene parameters ------------------------------------------------------------
  function geneParams(r, genes, mc) {
    const p = {};
    const mode = genes.includes('agent') ? 'dynamic' : (r() < 0.2 ? 'mev' : r() < 0.3 ? 'dynamic' : 'flat');
    p.fee = { mode, baseBps: mode === 'flat' ? 100 : 80 + Math.round(r() * 40), ceilBps: 300,
              dynBps: mode === 'dynamic' ? [60, 220] : null };
    if (genes.includes('snipe')) p.snipe = { startBps: 1500 + Math.round(r() * 1500), decayBlocks: 60 + Math.round(r() * 240) };
    if (genes.includes('buyback')) { const thr = +(0.15 + r() * 0.7).toFixed(2); p.buyback = { feeShareBps: 2000 + Math.round(r() * 2000), thresholdEth: thr, poolEth: +(r() * thr).toFixed(4), burnedPct: +(r() * 4).toFixed(2) }; }
    if (genes.includes('div')) p.div = { feeShareBps: 2000 + Math.round(r() * 3000), paidEth: +(mc / ETH_USD * (0.01 + r() * 0.05)).toFixed(3), poolEth: +(r() * 0.4).toFixed(4) };
    if (genes.includes('maxw')) { const liftH = [2, 4, 6, 12, 24][Math.floor(r() * 5)]; p.maxw = { pct: +(0.5 + r() * 2.5).toFixed(1), liftHrs: liftH }; }
    if (genes.includes('agent')) p.agent = { scheme: 'HMS-1', model: ['sonnet', 'haiku', 'opus'][Math.floor(r() * 3)], actions: 40 + Math.round(r() * 900) };
    return p;
  }

  // ---- build the sample coins --------------------------------------------------------------
  // [name, symbol, dir, genes, color, freshMins?]  freshMins = minutes since launch (active anti-snipe / "just spliced")
  const SAMPLES = [
    ['Helix', 'HELIX', 3, ['fee', 'buyback', 'snipe'], '#49d7ff', 2],
    ['Splicer', 'SPLCR', 1, ['fee', 'div', 'maxw'], '#5aa9ff'],
    ['Codon', 'CODON', 2, ['fee', 'snipe', 'maxw'], '#f5b74b', 6],
    ['Allele', 'ALLE', 3, ['fee', 'buyback', 'agent'], '#b07cff'],
    ['Plasmid', 'PLSMD', -2, ['fee', 'maxw'], '#ff8bbf'],
    ['Ribo', 'RIBO', 1, ['fee', 'div', 'buyback'], '#49d7ff'],
    ['Enzyme', 'ENZ', 2, ['fee', 'snipe', 'maxw', 'buyback'], '#4ad7c6'],
    ['Vector', 'VECT', -1, ['fee', 'agent', 'buyback'], '#5aa9ff'],
    ['Mitosis', 'MITO', 4, ['fee', 'snipe', 'div'], '#f5b74b'],
    ['Strand', 'STRND', 1, ['fee', 'maxw'], '#b07cff'],
    ['Primer', 'PRIM', 1, ['fee', 'snipe', 'buyback'], '#ff5d6c', 9],
    ['Nucleo', 'NUCL', 2, ['fee', 'buyback', 'div', 'maxw'], '#49d7ff'],
    ['Operon', 'OPRN', 1, ['fee', 'div'], '#4ad7c6'],
    ['Telomere', 'TELO', 3, ['fee', 'buyback', 'snipe', 'agent'], '#b07cff', 4],
    ['Exon', 'EXON', -1, ['fee', 'maxw', 'snipe'], '#f5b74b'],
  ];

  const now0 = Math.floor(Date.now() / 1000);
  const GLOBAL_BLOCK0 = 26_350_000;             // a believable recent Ethereum block
  const COINS = SAMPLES.map(([name, symbol, dir, genes, color, freshMins], idx) => {
    const r = rngFor(symbol + name);
    const ageHrs = freshMins ? +(freshMins / 60).toFixed(3) : +(0.6 + r() * 220).toFixed(1);
    const createdTs = now0 - Math.round(ageHrs * 3600);
    const mc = freshMins ? Math.round((6 + r() * 26) * 1000) : Math.round((7 + r() * 260) * 1000) * (dir > 2 ? 3 : 1);
    const c24 = dir * (3 + r() * 20) * (r() > 0.5 ? 1 : 0.55);
    const price = mc / 1e9;
    const params = geneParams(r, genes, mc);
    const c = {
      id: idx + 1, spec: 'OH-' + String(idx + 1).padStart(3, '0'),
      addr: addrFrom(r), name, symbol, color, dir,
      pair: { symbol: 'ETH', logo: '/img/eth.svg' },
      price, price0: price, mc, fdv: mc, c24,
      vol24: Math.round(mc * (0.15 + r() * 1.5)),
      liq: Math.round(mc * (0.1 + r() * 0.22)),
      holders: Math.round(28 + r() * 2100),
      createdTs, ageHrs, genes, params,
      feeMode: params.fee.mode, feeBps: params.fee.baseBps,
      creator: addrFrom(r),
      launchBlock: GLOBAL_BLOCK0 - Math.round(ageHrs * 300),    // ~12s blocks on Ethereum
      socials: { x: 'splice_' + symbol.toLowerCase(), tg: r() > 0.4 ? 'splice_' + symbol.toLowerCase() : null, web: r() > 0.7 ? symbol.toLowerCase() + '.xyz' : null },
      _seed: hash(symbol + name),
    };
    // max-wallet protection progress (lifts after liftHrs)
    if (c.params.maxw) { c.protected = c.ageHrs < c.params.maxw.liftHrs; c.protectPct = Math.min(100, (c.ageHrs / c.params.maxw.liftHrs) * 100); }
    return c;
  });

  const byAddr = {}; COINS.forEach(c => byAddr[c.addr.toLowerCase()] = c);

  // ---- current block (advances with the clock) ---------------------------------------------
  let BLOCK = GLOBAL_BLOCK0;
  const snipeRemaining = c => { if (!c.params.snipe) return 0; const elapsed = BLOCK - c.launchBlock; return Math.max(0, c.params.snipe.decayBlocks - elapsed); };
  const snipeBps = c => { if (!c.params.snipe) return 0; const rem = snipeRemaining(c); return Math.round(c.params.snipe.startBps * rem / c.params.snipe.decayBlocks); };

  // ---- deterministic OHLC candles per timeframe --------------------------------------------
  const TF = { '1H': { n: 60, sec: 60 }, '1D': { n: 48, sec: 1800 }, '1W': { n: 56, sec: 10800 }, 'ALL': { n: 60, sec: null } };
  const candleCache = {};
  function candles(addr, tf) {
    const c = byAddr[addr.toLowerCase()]; if (!c) return [];
    const key = addr + tf; if (candleCache[key]) return syncLast(candleCache[key], c);
    const cfg = TF[tf]; const n = cfg.n;
    const sec = cfg.sec || Math.max(300, Math.floor((c.ageHrs * 3600) / n));
    const r = mulberry(c._seed ^ hash(tf));
    const closes = []; let v = 1;
    for (let i = 0; i <= n; i++) { v *= 1 + (r() - 0.48) * 0.06; closes.push(v); }
    // normalise so the last close == current price, with the window's drift roughly matching c24
    const span = tf === '1H' ? 0.04 : tf === '1D' ? 0.5 : 1;
    const driftTarget = 1 - (c.c24 / 100) * span;
    const lo = Math.min(...closes), hi = Math.max(...closes);
    const norm = closes.map(x => (x - lo) / (hi - lo || 1));              // 0..1
    const base = c.price * driftTarget, top = c.price;
    const mapped = norm.map(x => base + (top - base) * x);
    const out = [];
    const endT = c.createdTs + Math.min(c.ageHrs * 3600, n * sec);
    for (let i = 1; i <= n; i++) {
      const o = mapped[i - 1], cl = mapped[i];
      const wick = Math.abs(cl - o) * (0.6 + r() * 1.6) + c.price * 0.004;
      out.push({ t: Math.round(endT - (n - i) * sec), o, c: cl, h: Math.max(o, cl) + wick * r(), l: Math.min(o, cl) - wick * r(), v: Math.round(c.vol24 / n * (0.3 + r() * 1.8)) });
    }
    candleCache[key] = out; return syncLast(out, c);
  }
  function syncLast(series, c) {                 // keep the forming candle pinned to live price
    const last = series[series.length - 1]; if (last) { last.c = c.price; last.h = Math.max(last.h, c.price); last.l = Math.min(last.l, c.price); }
    return series;
  }

  // ---- TradingView bars: any resolution in seconds, continuous from launch, <=3000 candles ----
  const barCache = {};
  function bars(addr, sec) {
    const c = byAddr[(addr || '').toLowerCase()]; if (!c) return [];
    const key = addr + ':' + sec;
    if (!barCache[key]) {
      const nowS = Math.floor(Date.now() / 1000);
      const start = Math.floor(c.createdTs / sec) * sec;
      const end = Math.floor(nowS / sec) * sec;
      const first = Math.max(start, end - 2999 * sec);
      const n = Math.max(1, Math.round((end - first) / sec) + 1);
      const r = mulberry((c._seed ^ Math.imul(sec, 2654435761)) >>> 0);
      const vols = sec >= 86400 ? 0.1 : sec >= 3600 ? 0.05 : sec >= 300 ? 0.025 : 0.015;
      const closes = []; let w = 1;
      for (let i = 0; i < n; i++) { w *= 1 + (r() - 0.485) * vols; closes.push(w); }
      const windowDays = (end - first) / 86400;
      const drift = 1 - (c.c24 / 100) * Math.min(1.4, Math.max(0.05, windowDays));
      const lo = Math.min(...closes), hi = Math.max(...closes);
      const base = c.price * Math.max(0.05, drift), top = c.price;
      const norm = closes.map(x => (x - lo) / (hi - lo || 1));
      const mapped = norm.map(x => base + (top - base) * x);
      const out = []; const volBar = c.vol24 * sec / 86400;
      for (let i = 1; i < n; i++) {
        const o = mapped[i - 1], cl = mapped[i];
        const wick = Math.abs(cl - o) * (0.5 + r() * 1.4) + c.price * 0.002;
        out.push({ time: first + i * sec, open: o, close: cl, high: Math.max(o, cl) + wick * r(), low: Math.max(1e-12, Math.min(o, cl) - wick * r()), volume: Math.round(volBar * (0.2 + r() * 1.8)) });
      }
      if (!out.length) out.push({ time: end, open: c.price, close: c.price, high: c.price, low: c.price, volume: Math.round(volBar) });
      barCache[key] = out;
    }
    const s = barCache[key]; const last = s[s.length - 1];
    last.close = c.price; last.high = Math.max(last.high, c.price); last.low = Math.min(last.low, c.price);
    return s;
  }

  // ---- holder distribution (deterministic) -------------------------------------------------
  function holders(addr) {
    const c = byAddr[addr.toLowerCase()]; if (!c) return null;
    const r = mulberry(c._seed ^ 0x484f4c44);
    const capPct = c.params.maxw ? c.params.maxw.pct : 100;
    let remaining = 92;                          // ~8% sits in the locked LP position
    const top = [];
    const n = Math.min(40, Math.max(12, Math.round(c.holders / 40)));
    for (let i = 0; i < n; i++) {
      let pct = (c.params.maxw && c.protected) ? Math.min(capPct, 0.3 + r() * capPct)
        : i === 0 ? 1 + r() * 6 : i < 10 ? 0.3 + r() * 3 : 0.04 + r() * 0.5;
      pct = Math.min(pct, remaining * 0.5); remaining -= pct;
      top.push({ addr: addrFrom(r), pct: +pct.toFixed(2), tag: i === 0 ? 'creator' : '' });
    }
    top.sort((a, b) => b.pct - a.pct);
    const top10 = top.slice(0, 10).reduce((a, b) => a + b.pct, 0);
    return { lp: 8, top1: top[0].pct, top10: +top10.toFixed(1), others: +(100 - 8 - top10).toFixed(1), list: top, total: c.holders, capPct };
  }

  // ---- per-coin trades (deterministic, well-formed) ----------------------------------------
  function trades(addr, n = 16) {
    const c = byAddr[addr.toLowerCase()]; if (!c) return [];
    const r = mulberry(c._seed ^ 0x54524144);
    const out = []; let t = now0;
    for (let i = 0; i < n; i++) {
      const buy = r() > (c.dir < 0 ? 0.56 : 0.42); const eth = +(0.015 + r() * 3.4).toFixed(3);
      t -= Math.round(20 + r() * 900);
      out.push({ buy, eth, usd: eth * ETH_USD, tokens: Math.round(eth / c.price), maker: addrFrom(r), ts: t });
    }
    return out;
  }

  // ---- quote: how the next trade is shaped by this coin's genes ----------------------------
  function quote(c, side, amountEth) {
    amountEth = Math.max(0, +amountEth || 0);
    const baseBps = c.params.fee.mode === 'dynamic' ? c.params.fee.dynBps[0] + 40 : c.params.fee.baseBps;
    const snBps = side === 'buy' ? snipeBps(c) : Math.round(snipeBps(c) * 0.5);
    const totalBps = Math.min(c.params.fee.ceilBps + (c.params.snipe ? c.params.snipe.startBps : 0), baseBps + snBps);
    const feeEth = amountEth * totalBps / 10000;
    const parts = [];
    // fee splits: buyback & dividends skim first, creator/platform split the rest 60/40
    let bb = 0, dv = 0;
    if (c.params.buyback) { bb = feeEth * c.params.buyback.feeShareBps / 10000; }
    if (c.params.div) { dv = feeEth * c.params.div.feeShareBps / 10000; }
    const rest = Math.max(0, feeEth - bb - dv);
    const creator = rest * 0.6, platform = rest * 0.4;
    parts.push({ k: 'base', label: 'Base fee', bps: baseBps, eth: amountEth * baseBps / 10000 });
    if (snBps) parts.push({ k: 'snipe', label: 'Anti-snipe', bps: snBps, eth: amountEth * snBps / 10000, note: snipeRemaining(c) + ' blocks left' });
    if (bb) parts.push({ k: 'buyback', label: 'Buyback pool', eth: bb });
    if (dv) parts.push({ k: 'div', label: 'Dividends', eth: dv });
    parts.push({ k: 'creator', label: 'Creator', eth: creator });
    parts.push({ k: 'platform', label: 'Platform', eth: platform });
    const afterFee = Math.max(0, amountEth - feeEth);
    let tokens = afterFee / c.price;
    let clamped = null;
    if (side === 'buy' && c.params.maxw && c.protected) {
      const cap = 1e9 * c.params.maxw.pct / 100;
      if (tokens > cap) { clamped = cap; tokens = cap; }
    }
    return { totalBps, feeEth, parts, tokens, clamped, usd: amountEth * ETH_USD, afterFee };
  }

  // ---- global market stats -----------------------------------------------------------------
  function stats() {
    const vol = COINS.reduce((a, c) => a + c.vol24, 0);
    const feesEth = vol / ETH_USD * 0.01;
    return { coins: COINS.length, vol24: vol, feesCreatorsEth: feesEth * 0.6, feesUsd: feesEth * ETH_USD, ethUsd: ETH_USD,
             burnedEth: COINS.reduce((a, c) => a + (c.params.buyback ? c.params.buyback.poolEth : 0), 0),
             divEth: COINS.reduce((a, c) => a + (c.params.div ? c.params.div.paidEth : 0), 0) };
  }

  // ---- the shared market clock -------------------------------------------------------------
  const subs = new Set();
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tickN = 0, timer = null;
  const tapeFeed = [];
  function step() {
    tickN++;
    if (tickN % 8 === 0) BLOCK += 1;   // ~12s blocks
    const touched = [];
    COINS.forEach(c => {
      const r = mulberry(c._seed ^ (tickN * 2654435761));
      // bounded random walk, gently mean-reverting toward price0, biased by dir
      const drift = (c.dir / 100) * 0.015 + (c.price0 - c.price) / c.price0 * 0.02;
      const move = (r() - 0.5) * 0.012 + drift;
      if (r() < 0.6) { c.price = Math.max(c.price0 * 0.3, c.price * (1 + move)); c.mc = Math.round(c.price * 1e9); c.fdv = c.mc; c.c24 = c.c24 * 0.995 + move * 100 * 0.6; touched.push(c); }
      if (c.params.maxw) { c.protected = c.ageHrs + tickN / 2400 < c.params.maxw.liftHrs; }
      if (c.params.buyback && r() < 0.1) c.params.buyback.poolEth = +Math.min(c.params.buyback.thresholdEth, c.params.buyback.poolEth + r() * 0.01).toFixed(4);
    });
    // occasionally emit a trade onto the tape
    if (tickN % 2 === 0) {
      const c = COINS[Math.floor(mulberry(tickN * 40503)() * COINS.length)];
      const r = mulberry(c._seed ^ (tickN * 7919));
      const tr = { coin: c, buy: r() > 0.42, eth: +(0.02 + r() * 2.8).toFixed(3), ts: Math.floor(Date.now() / 1000), maker: addrFrom(r) };
      tapeFeed.unshift(tr); if (tapeFeed.length > 24) tapeFeed.pop();
      subs.forEach(fn => { try { fn({ type: 'trade', trade: tr }); } catch (e) {} });
    }
    subs.forEach(fn => { try { fn({ type: 'tick', touched, block: BLOCK, n: tickN }); } catch (e) {} });
  }
  function start() { if (timer || reduceMotion) return; timer = setInterval(step, 1500); }
  function subscribe(fn) { subs.add(fn); start(); return () => subs.delete(fn); }

  // initial tape seed
  (function seedTape() { const r = mulberry(0x74617065); for (let i = 0; i < 16; i++) { const c = COINS[Math.floor(r() * COINS.length)]; tapeFeed.push({ coin: c, buy: r() > 0.42, eth: +(0.02 + r() * 3).toFixed(3), ts: now0 - Math.round(r() * 5400), maker: addrFrom(r) }); } tapeFeed.sort((a, b) => b.ts - a.ts); })();

  window.UD = {
    cfg: CFG, ETH_USD, FEE_MODES,
    GENES, GENE_ORDER, CONSTITUTION,
    tokens: () => COINS,
    coin: a => byAddr[(a || '').toLowerCase()] || null,
    newest: () => [...COINS].sort((a, b) => b.createdTs - a.createdTs),
    trending: () => [...COINS].map(c => ({ c, s: c.vol24 / c.mc * (1 + Math.max(0, c.c24) / 50) })).sort((a, b) => b.s - a.s).map(x => x.c),
    gene: k => GENES[k],
    block: () => BLOCK,
    snipeRemaining, snipeBps,
    candles, bars, holders, trades, quote, stats,
    tape: () => tapeFeed.slice(),
    subscribe, reduceMotion,
  };
})();
