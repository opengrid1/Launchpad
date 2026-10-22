/* Preview: example multichain coins so the design can be seen before the multichain contracts exist.
   Off by default. /?preview=1 turns it on for this browser, /?preview=0 turns it off. The coins are made up:
   their trades, holders and chart are generated here, nothing is on chain, and a banner says so on every page.
   Loaded after chain.js and equo.js, before core.js. */
(function () {
  let on = false;
  try {
    const q = new URLSearchParams(location.search).get('preview');
    if (q === '1') localStorage.setItem('equo-preview', '1');
    if (q === '0') localStorage.removeItem('equo-preview');
    on = localStorage.getItem('equo-preview') === '1';
  } catch { on = false; }
  window.EQUO_PREVIEW = on;
  const C = window.CHAIN;
  if (!on || !C) return;
  // show every chain as live; `deployed` keeps the real state so launches and bridging stay blocked where nothing is deployed
  ((window.INKY && INKY.chains) || []).forEach((c) => { c.deployed = c.live; c.live = true; });

  const NOW = Math.floor(Date.now() / 1000), H = 3600, SUP = 1e9;
  const cfg = window.INKY || {};
  const stock = (sym) => (cfg.stocks || []).find((s) => s.symbol === sym) || {};
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const wallet = () => '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
  const logo = (txt, a, b) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" rx="32" fill="url(#g)"/><text x="32" y="${txt.length > 3 ? 37 : 39}" font-family="Arial,Helvetica,sans-serif" font-size="${txt.length > 3 ? 15 : 19}" font-weight="700" fill="#fff" text-anchor="middle">${txt}</text></svg>`);

  const SPECS = [
    { addr: '0xe900000000000000000000000000000000000001', n: 'Apple Pie', t: 'PIE', pair: 'AAPLon', chains: ['eth', 'hyper', 'bsc', 'base', 'arbitrum', 'robinhood', 'ink'], fee: 100, ageH: 70, trades: 220, p0: 5000, p1: 168000, pairUsd: 342, img: logo('PIE', '#ff6a3d', '#ffb347'), desc: 'The first coin live on all seven chains. Paired with Apple stock.', genes: { divShareBps: 2000 }, rewards: true },
    { addr: '0xe900000000000000000000000000000000000002', n: 'Tesla Coil', t: 'COIL', pair: 'TSLAon', chains: ['eth', 'hyper', 'base'], fee: 200, ageH: 20, trades: 120, p0: 5000, p1: 41000, pairUsd: 380, img: logo('COIL', '#3f7bff', '#97fce4'), desc: 'High voltage, three chains. Paired with Tesla stock.', genes: {}, rewards: false },
    { addr: '0xe900000000000000000000000000000000000003', n: 'Green Team', t: 'GPU', pair: 'NVDAon', chains: ['eth', 'bsc', 'arbitrum', 'ink'], fee: 100, ageH: 5, trades: 70, p0: 5000, p1: 23500, pairUsd: 238, img: logo('GPU', '#16a34a', '#9ef01a'), desc: 'Compute for the people. Paired with NVIDIA stock.', genes: { buybackShareBps: 2000 }, rewards: false },
  ];

  const TR = {}, MOCK = SPECS.map((s) => {
    const st = stock(s.pair), pairUsd = s.pairUsd;
    const created = NOW - s.ageH * H, n = s.chains.length;
    // price path per coin (USD per coin), market cap from p0 to p1 across all its chains
    const capPx = (cap) => cap / (SUP * n);
    const trades = [], wallets = Array.from({ length: Math.max(12, Math.round(s.trades / 4)) }, wallet);
    let px = capPx(s.p0);
    for (let i = 0; i < s.trades; i++) {
      const f = (i + 1) / s.trades, target = capPx(s.p0 * Math.pow(s.p1 / s.p0, f));
      const buy = rnd() < 0.62 + (target > px ? 0.1 : -0.1);
      px = Math.max(capPx(s.p0) * 0.6, target * (0.9 + rnd() * 0.2));
      const usd = 20 + Math.pow(rnd(), 2) * 1800, pairAmt = usd / pairUsd, coinAmt = usd / px;
      trades.push({ token: s.addr, wallet: wallets[Math.floor(rnd() * wallets.length)], buy, coin: String(BigInt(Math.round(coinAmt * 1e6)) * 10n ** 12n), pair: String(BigInt(Math.round(pairAmt * 1e9)) * 10n ** 9n), fee: String(BigInt(Math.round(pairAmt * s.fee / 1e4 * 1e9)) * 10n ** 9n), realized: '0', block: 0, ts: Math.round(created + f * (NOW - created) - rnd() * 60), tx: '0x' + s.addr.slice(2, 10) + i.toString(16).padStart(56, '0'), index: i, chain: s.chains[Math.floor(rnd() * n)] });
    }
    TR[s.addr] = trades;
    const last = trades[trades.length - 1], day = trades.filter((t) => t.ts >= NOW - 86400);
    const pxNow = Number(last.pair) / Number(last.coin) * pairUsd, first24 = day.length ? Number(day[0].pair) / Number(day[0].coin) * pairUsd : pxNow;
    const vol = day.reduce((a, t) => a + Number(t.pair) / 1e18 * pairUsd, 0);
    const byChain = {}; s.chains.forEach((k, i) => { byChain[k] = { px: pxNow * (1 + (i ? (rnd() - 0.5) * 0.012 : 0)), vol: vol / n * (0.6 + rnd() * 0.8) }; });
    const age = s.ageH >= 24 ? Math.round(s.ageH / 24) + 'd' : s.ageH + 'h';
    return {
      addr: s.addr, n: s.n, t: s.t, img: s.img, desc: s.desc, pair: s.pair, pairAddr: String(st.address || '').toLowerCase(), pairUsd,
      px: pxNow, pxPair: pxNow / pairUsd, mc: pxNow * SUP * n, c24: (pxNow / first24 - 1) * 100, vol, trades: trades.length, traders: wallets.length, h: wallets.length,
      createdAt: created, age, feeBps: s.fee, rewards: s.rewards, genes: s.genes, creator: wallets[0], links: { x: 'https://x.com/equofun' },
      liq: pxNow * SUP * n * 0.42, liqPair: pxNow * SUP * n * 0.42 / pairUsd, totalCreatorFees: vol * s.fee / 1e4 * 0.6 / pairUsd * 3, creatorOwed: 0, buybackPot: 0, dividendPot: 0,
      poolId: '0x' + s.addr.slice(2).padEnd(64, '0'), chains: s.chains, addrs: Object.fromEntries(s.chains.map((k) => [k, k === 'eth' ? s.addr : wallet()])), byChain, mock: true, hidden: false,
    };
  });
  const isMock = (a) => { a = String(a || '').toLowerCase(); return MOCK.find((x) => x.addr === a || Object.values(x.addrs || {}).includes(a)) || null; };

  // the chain layer answers for the example coins; everything else passes through
  const w = (name, fn) => { const orig = C[name]; C[name] = function (a, ...rest) { const m = isMock(a); return m ? fn(m, ...rest) : orig ? orig.apply(this, arguments) : undefined; }; };
  const t0 = C.tokens; C.tokens = () => (t0 ? t0() : []).concat(MOCK);
  const tk = C.token; C.token = (a) => isMock(a) || (tk ? tk(a) : null);
  const at = C.allTrades; C.allTrades = async (...a) => (at ? await at(...a).catch(() => []) : []).concat(...Object.values(TR));
  w('trades', async (m) => TR[m.addr].slice());
  w('refresh', async (m) => m);
  w('holders', async (m) => { const by = {}; TR[m.addr].forEach((t) => { by[t.wallet] = (by[t.wallet] || 0) + (t.buy ? 1 : -0.5) * Number(t.coin) / 1e18; }); const tot = SUP * m.chains.length; return Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([wallet, bal]) => ({ wallet, bal, share: bal / tot * 100 })); });
  w('topTraders', async (m) => []);
  w('position', async () => null);
  w('pending', async () => 0n);
  w('balance', async () => 0n);
  w('bars', async (m, step, from, to) => {
    const out = []; let o = null;
    TR[m.addr].filter((t) => t.ts >= from && t.ts < to).forEach((t) => { const p = Number(t.pair) / Number(t.coin), b = Math.floor(t.ts / step) * step;
      if (!o || o.time !== b) { if (o) out.push(o); o = { time: b, open: o ? o.close : p, high: p, low: p, close: p, volume: 0 }; }
      o.high = Math.max(o.high, p); o.low = Math.min(o.low, p); o.close = p; o.volume += Number(t.pair) / 1e18; });
    if (o) out.push(o); return out;
  });
  const quote = (m, amt, buy) => { const v = Number(amt) / 1e18, r = 1 - m.feeBps / 1e4; return BigInt(Math.floor((buy ? v / m.pxPair : v * m.pxPair) * r * 0.98 * 1e6)) * 10n ** 12n; };
  w('quoteBuy', async (m, amt) => quote(m, amt, true));
  w('quoteSell', async (m, amt) => quote(m, amt, false));
  w('quoteBuyEth', async (m, amt) => { const eth = (window.SP && SP.prices && SP.prices[String(cfg.weth || '').toLowerCase()]) || 2500; return quote(m, BigInt(Math.floor(Number(amt) * eth / m.pairUsd)), true); });
  w('quoteSellEth', async (m, amt) => { const eth = (window.SP && SP.prices && SP.prices[String(cfg.weth || '').toLowerCase()]) || 2500; const p = quote(m, amt, false); return BigInt(Math.floor(Number(p) * m.pairUsd / eth)); });
  const no = async () => { throw new Error('This is an example coin. Trading opens with multichain launches.'); };
  w('buy', no); w('sell', no); w('claim', no); w('payCreator', no);
  if (C.equo) {
    const E = C.equo, ci = E.creatorInfo, bo = E.balanceOf;
    E.creatorInfo = async (a) => { const m = isMock(a); return m ? { creator: m.creator, pending: null, activeAt: NOW - 2 * H, takeover: null, owed: 0 } : ci(a); };
    E.balanceOf = (a, who) => (isMock(a) ? Promise.resolve(0n) : bo(a, who));
  }

  // banner on every page
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div');
    b.className = 'pvbar';
    b.innerHTML = `<span><b>Preview</b> Example coins are shown (Apple Pie, Tesla Coil, Green Team). They are made up and cannot be traded.</span><a href="?preview=0">Hide examples</a>`;
    const top = document.getElementById('sp-top'); if (top) top.insertAdjacentElement('afterend', b); else document.body.prepend(b);
  });
})();
