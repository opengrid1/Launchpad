/* History from the Equo indexer (indexer/ in the repo): trades, holders and chart candles for a coin on every
   chain. On when config.js has `api` (the indexer's URL); each call falls back to reading the chain directly if
   the indexer does not answer. Live numbers (prices, balances, quotes) always come from the chains.
   Loaded after equo.js. */
(function () {
  const cfg = window.INKY || {}, C = window.CHAIN;
  if (!cfg.api || !C) return;
  // 'self': this site serves the API (the Vercel function in api/)
  const base = cfg.api === 'self' ? '' : String(cfg.api).replace(/\/$/, '');
  const RES = [60, 300, 900, 1800, 3600, 14400, 86400, 604800];

  async function get(path) {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('indexer ' + r.status);
    return r.json();
  }
  const wrap = (name, fn) => {
    const orig = C[name];
    C[name] = async function (...args) {
      try { return await fn(...args); } catch (e) { console.warn('indexer', name, e.message); return orig ? orig.apply(this, args) : undefined; }
    };
  };
  /** the pair's USD price the chart multiplies by; candles from the indexer are USD, so divide it back out */
  const pairUsd = (addr, chain) => {
    const x = C.token && C.token(addr);
    return (x && chain && x.byChain && x.byChain[chain] && x.byChain[chain].pairUsd) || (x && x.pairUsd) || 1;
  };

  // every chain's trades, oldest first like the chain reader
  wrap('trades', async (addr) => {
    const j = await get(`/api/trades?coin=${addr}&limit=500`);
    return j.trades.map((t) => ({ token: t.token, wallet: t.wallet, buy: t.buy, coin: t.coin, pair: t.pair, fee: t.fee, realized: '0', block: t.block, ts: t.ts, tx: t.tx, index: t.index, chain: t.chain })).reverse();
  });

  wrap('holders', async (addr) => {
    const j = await get(`/api/holders?coin=${addr}&limit=100`);
    return j.holders.map((h) => ({ wallet: h.wallet, bal: Number(h.balance) / 1e18, share: h.share, byChain: h.byChain }));
  });

  // candles in the chain reader's units (pair per coin); `chain` left out means every chain merged
  wrap('bars', async (addr, step, from, to, chain) => {
    const res = RES.includes(step) ? step : 3600;
    from = Math.max(from, to - res * 4900);
    const j = await get(`/api/candles?coin=${addr}&res=${res}&from=${Math.floor(from)}&to=${Math.ceil(to)}${chain ? '&chain=' + chain : ''}`);
    const p = pairUsd(addr, chain);
    return j.candles.map((c) => ({ time: c.t, open: c.o / p, high: c.h / p, low: c.l / p, close: c.c / p, volume: c.v / p }));
  });

  // holder count across chains (the chain reader only counts the chain it scans), and every chain's pool read live
  // by the indexer: `pools` per chain key and `liqAll`, both sides of every pool in USD. The coin call reads each
  // chain's RPC, so it is asked at most every 20 s per coin; refreshes in between reuse the last answer.
  const rf = C.refresh, coinAt = new Map();
  const coinInfo = async (addr) => {
    const c = coinAt.get(addr);
    if (c && Date.now() - c.at < 20000) return c.j;
    const j = await get(`/api/coin?coin=${addr}`);
    coinAt.set(addr, { at: Date.now(), j });
    return j;
  };
  const apply = (o, j) => {
    if (!o) return;
    if (j.holders != null) o.h = j.holders;
    if (j.chains) {
      o.pools = Object.fromEntries(Object.entries(j.chains).map(([k, v]) => [k, v.pool || null])); o.liqAll = j.liquidity; o.poolsLive = j.poolsLive;
      MULTI.set(lc(o.addr), j);
      enrich(o);
    }
  };

  /* One coin on many chains: the chain reader reads Ethereum, the indexer every chain the coin launched on (one
     address on all of them). A coin on more than one chain gets `chains`, `addrs` and `byChain` from it, and its
     market cap, volume and trades across all of them. */
  const lc = (a) => String(a || '').toLowerCase();
  const MULTI = new Map(); // address -> the indexer's coin
  const ORDER = (cfg.chains || []).map((c) => c.key);
  function enrich(o) {
    const j = o && o.addr && MULTI.get(lc(o.addr));
    if (!j || !j.chains) return o;
    const keys = ORDER.filter((k) => j.chains[k]);
    if (keys.length < 2) return o;
    o.chains = keys;
    o.addrs = Object.fromEntries(keys.map((k) => [k, j.chains[k].token]));
    o.byChain = { ...(o.byChain || {}) };
    for (const k of keys) {
      const c = j.chains[k], p = c.pool || {}, b = { ...(o.byChain[k] || {}) };
      if (c.price) b.px = c.price;
      if (c.supply) b.supply = Number(c.supply) / 1e18;
      b.vol = c.vol24 || 0; b.trades = c.trades24 || 0;
      if (p.priceUsd && p.priceInPair) b.pairUsd = p.priceUsd / p.priceInPair;
      if (p.liquidityUsd != null) b.liq = p.liquidityUsd;
      o.byChain[k] = b;
    }
    if (j.mc) o.mc = j.mc;
    if (j.vol24 != null) o.vol = j.vol24;
    if (j.trades != null) o.trades = j.trades;
    if (j.liquidity) o.liqAll = j.liquidity;
    if (j.poolsLive != null) o.poolsLive = j.poolsLive;
    return o;
  }
  const loadCoins = async () => {
    try {
      const j = await get('/api/coins?limit=200');
      for (const c of j.coins || []) if (Object.keys(c.chains || {}).length > 1) {
        const old = MULTI.get(lc(c.chains.eth ? c.chains.eth.token : Object.values(c.chains)[0].token));
        // the list has no pools; keep the ones a coin call already read
        if (old && old.chains) for (const k of Object.keys(c.chains)) if (old.chains[k] && old.chains[k].pool) c.chains[k].pool = old.chains[k].pool;
        if (old && old.liquidity) { c.liquidity = old.liquidity; c.poolsLive = old.poolsLive; }
        for (const v of Object.values(c.chains)) MULTI.set(lc(v.token), c);
      }
      dispatchEvent(new Event('chain-update'));
    } catch (e) { console.warn('indexer coins', e.message); }
  };
  const t0 = C.tokens, tk = C.token;
  if (t0) C.tokens = (...a) => t0(...a).map(enrich);
  if (tk) C.token = (...a) => enrich(tk(...a));
  setTimeout(loadCoins, 300);
  setInterval(() => { if (document.visibilityState !== 'hidden') loadCoins(); }, 30000);
  if (rf) C.refresh = async function (addr, ...rest) {
    const x = await rf.call(this, addr, ...rest);
    try { const j = await coinInfo(addr); if (j) { apply(x, j); apply(C.token && C.token(addr), j); } } catch (e) {}
    return x;
  };

  C.api = { base, get };

  // the indexer runs in short bursts: while someone has the site open, ask for one now and then
  // (the server runs at most one at a time and skips a request that comes too soon)
  const tick = () => { if (document.visibilityState !== 'hidden') fetch(base + '/api/tick', { keepalive: true }).catch(() => {}); };
  setTimeout(tick, 4000);
  setInterval(tick, 30000);
})();
