/* cntrl-z.fun data for the pages. Until the contracts are deployed this is a preview: example coins,
   generated the same way on every load (seeded), with real pair tokens and their real prices
   (Chainlink for ETH, BTC and gold; the Ondo stock list for stocks). Exposes window.UD, fires 'ud:ready'. */
(function () {
  const CFG = window.UNDO || {};
  const lower = a => (a || '').toLowerCase();
  const NOW = Math.floor(Date.now() / 1000);
  const SUPPLY = 1e9;
  const PR = CFG.premium || { refEth: 0.05, baseH: 6, minH: 0.5, maxH: 168, maxBps: 3000 };
  const TAX = (CFG.taxBps || 100) / 10000;
  const TOKENS = Object.fromEntries((CFG.tokens || []).map(t => [t.symbol, { ...t, kind: 'token' }]));

  // ------------------------------------------------------------ pair tokens used by the examples (stocks from the Ondo list)
  const STOCKS = {
    TSLAon: ['Tesla', '0xf6b1117ec07684D3958caD8BEb1b302bfD21103f', 377.81], NVDAon: ['NVIDIA', '0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE', 237.47],
    SPYon: ['SPDR S&P 500 ETF', '0xFeDC5f4a6c38211c1338aa411018DFAf26612c08', 784.58], AAPLon: ['Apple', '0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c', 336.67],
    QQQon: ['Invesco QQQ', '0x0e397938C1Aa0680954093495B70A9F5e2249aBa', 760.82], HOODon: ['Robinhood', '0x998f02A9E343EF6E3E6f28700d5A20F839fD74E6', 109.51],
    MSTRon: ['Strategy', '0xCabD955322dfbf94C084929ac5E9Eca3fEB5556F', 153.37], COINon: ['Coinbase', '0xF042cfa86cf1D598a75Bdb55c3507a1F39f9493b', 178.45],
  };
  const stockLogo = t => '/img/stocks/' + t + '.webp';
  const stock = s => ({ symbol: s, ticker: s.replace(/on$/, ''), name: STOCKS[s][0] + ' (Ondo Tokenized)', address: STOCKS[s][1], usd: STOCKS[s][2], kind: 'stock', logo: stockLogo(s.replace(/on$/, '')) });
  const prices = { ETH: 2450, PAXG: 4000, XAUt: 4000 };
  const pairOf = s => STOCKS[s] ? stock(s) : { ...TOKENS[s], usd: prices[s] };

  // ------------------------------------------------------------ seeded randomness, so the examples are stable between loads
  function rng(seed) { let a = 0; for (const ch of seed) a = (a * 31 + ch.charCodeAt(0)) >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const hex = (r, n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
  const addr = r => '0x' + hex(r, 40);
  const WINDOWS = [0.5, 1, 6, 24, 72, 168];

  // name, ticker, pair, age (h), market cap now, hue, kept %, description
  const EXAMPLES = [
    ['Ctrl Z', 'CTRLZ', 'ETH', 30, 412000, 48, 88, 'Bought the top? Ctrl Z. The first coin where every buy comes with an undo key.'],
    ['Regret Nothing', 'NOREGRET', 'ETH', 74, 1210000, 152, 94, 'Rent a day to think about it. Most people keep it.'],
    ['Gold Hands', 'GOLDH', 'PAXG', 120, 286000, 40, 91, 'Paired with tokenized gold. Every window burns a little more.'],
    ['Green Candle', 'GREEN', 'NVDAon', 20, 198000, 140, 79, 'A coin that trades against NVIDIA stock.'],
    ['Index Maxi', 'IDXMAXI', 'SPYon', 146, 640000, 214, 96, 'Paired with the S&P 500. Slow, steady, and almost nobody cancels.'],
    ['Second Chance', 'CHANCE', 'HOODon', 9, 74000, 8, 66, 'Paired with Robinhood stock. Half the buyers rent the thirty-minute window.'],
    ['Moon Lease', 'LEASE', 'TSLAon', 50, 355000, 0, 72, 'Paired with Tesla stock. Lease the moon for six hours, keep it if you like the view.'],
    ['Cold Storage', 'COLD', 'MSTRon', 98, 520000, 196, 93, 'Paired with Strategy stock, the closest thing to bitcoin on the board. Buy, wait a day, freeze it.'],
    ['Cooling Off', 'COOL', 'AAPLon', 14, 61000, 186, 58, 'Paired with Apple stock. A lot of cooling off going on.'],
    ['Take Backsies', 'BACKSIES', 'ETH', 4, 23000, 330, 61, 'No take backsies? Yes take backsies.'],
    ['Tech Bag', 'TECHBAG', 'QQQon', 36, 147000, 262, 84, 'Paired with the Nasdaq 100.'],
    ['No Jeets', 'NOJEET', 'ETH', 2, 12400, 352, 90, 'Every cancelled buy burns the premium. That\'s the whole coin.'],
  ];

  function make([name, symbol, pairSym, ageH, mcNow, hue, keptPct, desc]) {
    const r = rng(symbol);
    const pair = pairOf(pairSym); const ethUsd = prices.ETH;
    const createdAt = NOW - Math.round(ageH * 3600);
    const p0 = (CFG.startCap || 5000) / SUPPLY, p1 = mcNow / SUPPLY;
    // price path: a noisy walk from the $5K start to today's price, with a hump so charts aren't straight lines
    const n = Math.min(900, Math.max(60, Math.round(ageH * 9))); const swaps = []; let noise = 0;
    for (let k = 1; k <= n; k++) {
      const f = k / n; noise = noise * .93 + (r() - .5) * .16; const bridge = noise * (1 - f) * 1.6;
      const hump = Math.sin(Math.PI * Math.min(1, f * 1.15)) * .35 * (r() < .5 ? 1 : .6);
      const lp = Math.log(p0) + (Math.log(p1) - Math.log(p0)) * Math.pow(f, .55) + bridge + hump * (1 - f);
      const t = createdAt + Math.round(f * (NOW - createdAt - 30)); const v = mcNow * (0.00015 + r() * 0.0012) * (r() < .08 ? 5 : 1);
      swaps.push({ t, p: Math.exp(lp), v });
    }
    swaps[swaps.length - 1].p = p1;
    const px = p1, day = NOW - 86400;
    const before = swaps.filter(s => s.t <= day); const p24 = before.length ? before[before.length - 1].p : p0;
    const vol24 = swaps.filter(s => s.t > day).reduce((s, x) => s + x.v, 0), volAll = swaps.reduce((s, x) => s + x.v, 0);
    // trades: the latest swaps as buys and sells; some buys rented a window (the premium is capped at 30% of the buy)
    const trades = []; let windowBuys = 0, undos = 0, premiumsEth = 0, openUsd = 0, openEth = 0, refundedUsd = 0;
    for (let k = swaps.length - 1; k >= 1; k--) {
      const s = swaps[k], prev = swaps[k - 1]; const side = s.p >= prev.p ? 'buy' : 'sell'; const usdV = s.v, ethV = usdV / ethUsd;
      const t = { ts: s.t, side, usd: usdV, eth: ethV, coins: usdV / s.p, who: addr(r) };
      if (side === 'buy' && r() < .72) {
        const maxH = Math.min(PR.maxH, ethV * PR.maxBps / 10000 * PR.baseH / PR.refEth); const ok = WINDOWS.filter(h => h <= maxH);
        if (ok.length) { const hours = ok[Math.min(ok.length - 1, Math.floor(r() * r() * ok.length * 1.4))]; const premium = PR.refEth * hours / PR.baseH; windowBuys++; premiumsEth += premium; t.hours = hours; t.premium = premium; const closes = s.t + hours * 3600;
          if (closes > NOW) { t.state = 'open'; t.closes = closes; openUsd += usdV; openEth += ethV; }
          else if (r() * 100 > keptPct) { undos++; const at = s.t + r() * hours * 3600 * .8; t.state = 'undone'; t.undoAt = at; refundedUsd += usdV; if (at < NOW && trades.length < 80) trades.push({ ts: Math.round(at), side: 'undo', usd: usdV, eth: ethV, coins: t.coins, who: t.who, hours, premium }); }
          else t.state = 'kept'; }
      }
      if (trades.length < 80) trades.push(t);
    }
    trades.sort((a, b) => b.ts - a.ts);
    const kept = windowBuys ? (windowBuys - undos) / windowBuys * 100 : null;
    const burnedUsd = premiumsEth * ethUsd * .85; // premiums buy the coin and burn it; what's burned is worth a little less than spent
    const holders = Math.round(40 + Math.sqrt(mcNow) * (1.2 + r())); const top = []; let left = 0.38 + r() * .12;
    for (let k = 0; k < 12; k++) { const share = left * (.18 + r() * .14); left -= share; top.push({ addr: addr(r), bal: share * SUPPLY }); }
    top.sort((a, b) => b.bal - a.bal);
    return {
      addr: '0x' + hex(r, 36) + 'd0e0', name, symbol, hue, desc, pair, createdAt, creator: addr(r),
      px, mc: px * SUPPLY, c24: (px / p24 - 1) * 100, vol24, volAll, swaps, trades, holders, top,
      windowBuys, undos, keptPct: kept, premiumsEth, burnedUsd, burnedCoins: burnedUsd / px, openUsd, openEth, refundedUsd,
      creatorEarned: volAll * TAX * (CFG.split ? CFG.split.creator / 100 : .7) ,
      links: { x: '', web: '', tg: '' },
    };
  }
  const tokens = EXAMPLES.map(make); const byAddr = Object.fromEntries(tokens.map(x => [x.addr, x]));

  // the example wallet on Portfolio: buys still inside their window, and coins already kept
  function myWindows() {
    const r = rng('me'); const out = [];
    for (const [sym, minsAgo, paidEth, hours] of [['CTRLZ', 38, 0.25, 6], ['GREEN', 214, 0.6, 24], ['NOREGRET', 600, 0.2, 72], ['LEASE', 300, 1.1, 6]]) {
      const x = tokens.find(t => t.symbol === sym); const openedAt = NOW - minsAgo * 60; const closes = openedAt + hours * 3600; const premium = PR.refEth * hours / PR.baseH;
      if (closes > NOW) out.push({ id: out.length + 1, x, openedAt, closes, hours, paidEth, premium, paidUsd: paidEth * prices.ETH, coins: paidEth * prices.ETH / x.px * (0.97 + r() * .06) });
    }
    return out;
  }
  function myHoldings() {
    return [['NOREGRET', 0.84e6], ['GOLDH', 2.1e6], ['IDXMAXI', 0.45e6]].map(([sym, bal]) => { const x = tokens.find(t => t.symbol === sym); return { x, bal, value: bal * x.px }; });
  }
  // every open window on the site, newest first, for the tape
  const openWindows = () => tokens.flatMap(x => x.trades.filter(t => t.state === 'open').map(t => ({ x, ...t }))).sort((a, b) => b.ts - a.ts);

  // ------------------------------------------------------------ every pair a coin can launch with: popular tokens and the Ondo stocks
  let stockList = null;
  const pairsList = async () => {
    if (!stockList) { try { const j = await fetch('/backing.json').then(r => r.json()); stockList = j.tokens.filter(t => !t.skip && t.usd).map(t => ({ symbol: t.symbol, ticker: t.ticker, name: t.name.replace(/ \(Ondo.*$/, ''), address: t.address, usd: t.usd, kind: 'stock', logo: stockLogo(t.ticker) })).sort((a, b) => a.ticker.localeCompare(b.ticker)); } catch { stockList = []; } }
    return { popular: (CFG.tokens || []).map(t => ({ ...t, kind: 'token', usd: prices[t.symbol] })), stocks: stockList };
  };

  // ------------------------------------------------------------ live prices for ETH, BTC and gold (Chainlink), best effort
  async function feeds() {
    const f = CFG.feeds || {}; const calls = Object.entries(f).map(([k, a], i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [{ to: a, data: '0x50d25bcd' }, 'latest'] }));
    for (const url of CFG.rpcs || []) {
      try { const ctl = new AbortController(); setTimeout(() => ctl.abort(), 6000);
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls), signal: ctl.signal }).then(r => r.json());
        const keys = Object.keys(f); for (const x of res) if (x.result && x.result.length > 2) { const v = Number(BigInt(x.result)) / 1e8; if (keys[x.id] === 'ETH') prices.ETH = v; if (keys[x.id] === 'XAU') { prices.PAXG = v; prices.XAUt = v; } }
        return;
      } catch {}
    }
  }

  function stats() {
    const sum = f => tokens.reduce((s, x) => s + (f(x) || 0), 0); const wb = sum(x => x.windowBuys), un = sum(x => x.undos);
    return { coins: tokens.length, vol24: sum(x => x.vol24), openUsd: sum(x => x.openUsd), openEth: sum(x => x.openEth), openCount: openWindows().length, kept: wb ? (wb - un) / wb * 100 : null, burnedUsd: sum(x => x.burnedUsd), premiumsEth: sum(x => x.premiumsEth), refundedUsd: sum(x => x.refundedUsd) };
  }

  const api = {
    cfg: CFG, SUPPLY, live: false, preview: true, now: () => Math.floor(Date.now() / 1000),
    tokens: () => tokens, token: a => byAddr[lower(a)] || tokens.find(t => t.symbol.toLowerCase() === lower(a)),
    stats, myWindows, myHoldings, openWindows, pairsList, pairUsd: s => (STOCKS[s] ? STOCKS[s][2] : prices[s]), ethUsd: () => prices.ETH,
    ready: null,
  };
  api.ready = feeds().catch(() => {}).then(() => { tokens.forEach(x => { if (x.pair.kind === 'token') x.pair.usd = prices[x.pair.symbol]; }); window.dispatchEvent(new CustomEvent('ud:ready')); });
  window.UD = api;
})();
