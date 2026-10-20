/* StockPad demo data — a preview of the trading interface before the contracts go live.
   Active only when window.INKY.demo is on (prelaunch). Installs a read-only window.CHAIN
   backed by a small deterministic market simulator and seeds TOK with example coins.
   Nothing here touches a real chain; no real transaction is ever sent. */
(function () {
  if (!(window.INKY && window.INKY.demo && !window.INKY.live)) return;

  const NOW = Math.floor(Date.now() / 1000);
  const USD = (typeof ETH !== 'undefined' ? ETH : 2700);         // ETH price in USD
  const SUP = (typeof SUPPLY !== 'undefined' ? SUPPLY : 1e9);    // fixed supply per coin
  const PM = ((window.INKY.contracts && window.INKY.contracts.poolManager) || '0x000000000004444c5dc75cb358380d2e3de08a90').toLowerCase();

  // ---- deterministic helpers ----
  const fr = x => x - Math.floor(x);
  const h2 = (a, b) => fr(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);           // 0..1 hash
  function mul32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function addrFrom(seed) { let s = '', x = seed * 0.000173 + 0.123; for (let i = 0; i < 40; i++) { x = fr(Math.sin(x * 97.3 + i * 51.7) * 2655.17); s += '0123456789abcdef'[Math.floor(x * 16)]; } return '0x' + s; }
  function txFrom(seed, i) { let s = '', x = seed + i * 7.31; for (let k = 0; k < 64; k++) { x = fr(Math.sin(x * 61.7 + k * 13.3) * 9123.57); s += '0123456789abcdef'[Math.floor(x * 16)]; } return '0x' + s; }

  // ETH-per-coin at time t: smooth trend + swings + per-bucket noise (stable across calls)
  function priceAt(c, t) {
    const age = (t - c.t0) / 86400;
    const w = 0.55 * Math.sin(t / (3600 * c.p1) + c.ph1) + 0.30 * Math.sin(t / (3600 * c.p2) + c.ph2) + 0.16 * Math.sin(t / (3600 * c.p3) + c.ph3);
    const n = (h2(Math.floor(t / 300), c.seed) - 0.5) * c.volat;
    return Math.exp(Math.log(c.launchPx) + c.trend * age + c.amp * w + n);
  }

  // ---- the example coins ----
  // [sym, name, logo, launchPx(ETH/coin), ageHours, trend/day, amp, volat, feeBps, feeMode, {div,buy,snipe,max}, holders, poolEth, desc]
  const D = [
    ['GWEI', 'Gas Ghost', 't-GWEI.png', 9.2e-9, 61, 0.09, 0.26, 0.05, 100, 'dynamic', { div: 1, buy: 1, snipe: 1, max: 0 }, 1840, 92, 'A ghost that feeds on gas. Dynamic fee rides volatility; a fifth of every fee buys back and burns, a fifth pays ETH dividends.'],
    ['MOGCAT', 'Mogcat', 't-MOGCAT.png', 4.1e-9, 33, 0.16, 0.34, 0.07, 100, 'flat', { div: 1, buy: 0, snipe: 1, max: 1 }, 1220, 61, 'The cat that mogs. Flat 1% fee, anti-snipe on the opening blocks, max-wallet for the first hours, ETH dividends to holders.'],
    ['NORMIE', 'Normie', 't-NORMIE.png', 1.7e-8, 120, 0.04, 0.19, 0.04, 80, 'flat', { div: 0, buy: 1, snipe: 0, max: 0 }, 2610, 150, 'Just a normal coin. Low flat fee, reflexive buyback-and-burn, no dividends — the floor grinds up on its own.'],
    ['SIGMA', 'Sigma Grind', 't-SIGMA.png', 2.3e-9, 9, 0.5, 0.42, 0.11, 150, 'mev', { div: 1, buy: 1, snipe: 1, max: 1 }, 540, 22, 'Fresh grind. MEV-tax punishes sandwichers, anti-snipe + max-wallet guard the launch, buyback and dividends both on.'],
    ['WEN', 'Wen Lambo', 't-WEN.png', 6.0e-9, 47, -0.06, 0.30, 0.06, 100, 'dynamic', { div: 1, buy: 0, snipe: 0, max: 0 }, 980, 48, 'Wen. Dynamic fee, pure ETH dividends to holders — paid pro-rata on every trade, claim anytime.'],
    ['GORB', 'Gorbagana', 't-GORB.png', 3.4e-9, 78, 0.11, 0.28, 0.06, 100, 'flat', { div: 0, buy: 1, snipe: 1, max: 0 }, 1455, 73, 'Trash goblin. Flat fee, anti-snipe, and a reflexive buyback that eats the dip and burns it.'],
  ];

  const MODE_LABEL = { flat: 'Flat fee', dynamic: 'Dynamic fee', mev: 'MEV-tax' };
  const coins = [];
  const byAddr = {};
  const walletPool = [];
  for (let i = 0; i < 24; i++) walletPool.push(addrFrom(1000 + i * 7));

  D.forEach((d, idx) => {
    const [t, n, logo, launchPx, ageH, trend, amp, volat, feeBps, feeMode, inst, holders, poolEth, desc] = d;
    const seed = 100 + idx * 13.37;
    const t0 = NOW - ageH * 3600;
    const c = { seed, t0, launchPx, trend, amp, volat, p1: 7 + idx, p2: 19 + idx * 2, p3: 53 + idx * 3, ph1: idx * 1.3, ph2: idx * 2.1, ph3: idx * 0.7, feeMode };
    const pxPair = priceAt(c, NOW);
    const px = pxPair * USD;
    const prevH = priceAt(c, NOW - 3600);
    const prev24 = priceAt(c, NOW - 86400);
    const instincts = ['fee'];
    if (inst.snipe) instincts.push('snipe');
    if (inst.buy) instincts.push('buyback');
    if (inst.div) instincts.push('div');
    if (inst.max) instincts.push('max');
    const creator = addrFrom(500 + idx);
    const liqPair = poolEth;
    const liq = liqPair * USD * 2;
    const vol = liqPair * USD * (1.2 + h2(idx, 3) * 2.5);         // 24h volume USD
    const ageDays = Math.max(0.3, ageH / 24);
    const volAll = vol * Math.min(ageDays, 14) * (0.6 + h2(idx, 9));
    const feeUsd = volAll * feeBps / 10000;                       // lifetime fees USD
    const divShare = inst.div ? 0.2 : 0;
    const totalCreatorFees = feeUsd * (1 - divShare - (inst.buy ? 0.2 : 0)) * 0.6 / USD;  // ETH
    const totalHolderRewards = feeUsd * divShare / USD;           // ETH
    const rew24 = vol * feeBps / 10000 * divShare;                // USD/24h

    const x = {
      addr: addrFrom(seed), t, n, img: logo ? '/img/' + logo : null, pair: 'ETH', pairUsd: USD,
      pxPair, px, mc: px * SUP, vol, volAll, liq, liqPair, h: holders,
      c1: (pxPair / prevH - 1) * 100, c24: (pxPair / prev24 - 1) * 100,
      age: ago(NOW - t0), createdAt: t0, creator,
      desc, links: { web: '', x: 'https://x.com/stockpad', tg: '' },
      rewards: !!inst.div, basket: [], feeBps, feeMode, feeLabel: MODE_LABEL[feeMode],
      creatorBps: Math.round(feeBps * 0.6), holderBps: Math.round(feeBps * divShare),
      feeUsd, rew24, totalCreatorFees, totalHolderRewards, instincts, inst,
      _sim: c,
    };
    coins.push(x); byAddr[x.addr] = x;
  });

  function ago(s) { return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; }

  // evolution: pre-committed stages that activate at market-cap milestones, locked at launch (demo roadmap)
  const EVO_STAGES = [
    { name: 'Genesis', emoji: '⚡', at: 0, note: 'Boots and guards its launch', unlocks: ['Anti-snipe', 'Max-wallet', '3% opening fee'] },
    { name: 'Training', emoji: '🧠', at: 10000, note: 'Learns its market', unlocks: ['Reflexive buyback', 'Fee eases to 1.5%'] },
    { name: 'Autonomous', emoji: '🤖', at: 50000, note: 'Fully online', unlocks: ['ETH dividends', 'Fee settles at 1%'] },
  ];
  coins.forEach(x => { let s = 0; for (let i = 0; i < EVO_STAGES.length; i++) if (x.mc >= EVO_STAGES[i].at) s = i; x.evo = { metric: 'market cap', stages: EVO_STAGES, stage: s }; });

  // ---- generate a stable trade history per coin ----
  coins.forEach((x) => {
    const c = x._sim, rng = mul32(Math.floor(x.seed * 1000));
    const n = 44 + Math.floor(rng() * 20);
    const tr = [];
    for (let i = 0; i < n; i++) {
      const ts = Math.floor(x.createdAt + (NOW - x.createdAt) * (i + rng() * 0.6) / n);
      const buy = rng() > 0.46;
      const eth = +(0.02 + rng() * rng() * (x.liqPair * 0.06)).toFixed(6);
      const p = priceAt(c, ts);
      const coinAmt = eth / p;
      const w = walletPool[Math.floor(rng() * walletPool.length)];
      tr.push({ ts, buy, coin: coinAmt * 1e18, pair: eth * 1e18, fee: eth * x.feeBps / 10000 * 1e18, wallet: buy ? w : (rng() > 0.5 ? w : x.creator), tx: txFrom(x.seed, i), index: i, token: x.addr });
    }
    tr.sort((a, b) => a.ts - b.ts);
    x._tr = tr;
  });

  // ---- holders per coin ----
  function holdersOf(x) {
    const rng = mul32(Math.floor(x.seed * 777));
    const rows = [];
    rows.push({ wallet: PM, bal: SUP * 0.52, share: 52, name: '' });
    rows.push({ wallet: x.creator, bal: SUP * (0.02 + rng() * 0.02), share: 0, name: '' });
    let left = SUP * 0.44, k = Math.min(x.h, 40) - 2;
    for (let i = 0; i < k; i++) {
      const take = left * (0.04 + rng() * 0.12);
      left -= take;
      rows.push({ wallet: walletPool[i % walletPool.length] || addrFrom(2000 + i), bal: Math.max(SUP * 0.0004, take), share: 0, name: '' });
    }
    rows.forEach(r => r.share = r.bal / SUP * 100);
    return rows.sort((a, b) => b.bal - a.bal);
  }

  function topOf(x) {
    const rng = mul32(Math.floor(x.seed * 999));
    const out = [];
    for (let i = 0; i < 14; i++) {
      const vol = (x.vol * (0.25 - i * 0.015) * (0.6 + rng())) ;
      const pnl = (rng() - 0.38) * vol * 0.5;
      out.push({ wallet: i === 2 ? x.creator : walletPool[i % walletPool.length], pnl, volume: Math.abs(vol), trades: 3 + Math.floor(rng() * 40), holding: rng() > 0.4 });
    }
    return out.sort((a, b) => b.pnl - a.pnl);
  }

  // ---- candle bars from the price path ----
  function barsOf(x, step, from, to) {
    const c = x._sim, out = [];
    let t = Math.floor(from / step) * step;
    const first = Math.floor((x.createdAt) / step) * step;
    for (; t < to; t += step) {
      if (t < first) continue;
      const open = priceAt(c, t), close = priceAt(c, t + step);
      let hi = Math.max(open, close), lo = Math.min(open, close);
      for (let k = 1; k < 5; k++) { const p = priceAt(c, t + step * k / 5); if (p > hi) hi = p; if (p < lo) lo = p; }
      const wig = 1 + (h2(Math.floor(t / step), c.seed + 3)) * c.volat * 0.5;
      hi *= wig; lo /= wig;
      const volP = (0.3 + h2(Math.floor(t / step), c.seed + 9)) * x.liqPair * 0.08;
      out.push({ time: t, open, high: hi, low: lo, close, volume: volP });
    }
    return out;
  }

  // ---- the read-only CHAIN shim ----
  const CH = {
    ready: true,
    checksum: a => a,
    parseEther: s => { try { return BigInt(Math.round(parseFloat(s) * 1e18)); } catch { return 0n; } },
    token: a => byAddr[(a || '').toLowerCase()] || null,
    tokens: () => coins,
    lastPrice: a => { const x = byAddr[(a || '').toLowerCase()]; return x ? x.pxPair : 0; },
    tradePrice: t => Number(t.pair) / Number(t.coin),
    bars: (a, step, from, to) => { const x = byAddr[(a || '').toLowerCase()]; return x ? barsOf(x, step, from, to) : []; },
    trades: a => { const x = byAddr[(a || '').toLowerCase()]; return Promise.resolve(x ? x._tr.slice() : []); },
    allTrades: () => Promise.resolve(coins.flatMap(x => x._tr)),
    holders: (a) => { const x = byAddr[(a || '').toLowerCase()]; return Promise.resolve(x ? holdersOf(x) : []); },
    topTraders: a => { const x = byAddr[(a || '').toLowerCase()]; return Promise.resolve(x ? topOf(x) : []); },
    pending: () => Promise.resolve(0),
    refresh: (a) => { const x = byAddr[(a || '').toLowerCase()]; if (x) { const now = Math.floor(Date.now() / 1000); x.pxPair = priceAt(x._sim, now); x.px = x.pxPair * USD; x.mc = x.px * SUP; x.c1 = (x.pxPair / priceAt(x._sim, now - 3600) - 1) * 100; } return Promise.resolve(x); },
    buy: () => Promise.reject(new Error('demo')),
    sell: () => Promise.reject(new Error('demo')),
  };
  window.CHAIN = CH;
  TOK = coins;

  // ---- a clear "this is a preview" banner ----
  function banner() {
    if (document.getElementById('demoBar')) return;
    const b = document.createElement('div');
    b.id = 'demoBar';
    b.innerHTML = '<span><b>Preview</b> — these are example coins so you can try the StockPad interface. Nothing here is live; trading opens when the contracts deploy on Ethereum.</span><button aria-label="Dismiss">×</button>';
    b.querySelector('button').onclick = () => b.remove();
    // inside the 100dvh app column (before the header) so body never scrolls — keeps position:fixed bars pinned on iOS
    const host = document.getElementById('app') || document.body;
    host.insertBefore(b, host.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
})();
