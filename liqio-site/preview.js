/* Preview: example coins so the site can be seen before the Liqio contracts are on HyperEVM.
   On when config.preview is true (or /?preview=1 for this browser); /?preview=0 hides the examples in this browser.
   The coins are made up: their trades, holders and chart are generated here, nothing is on chain, and a banner says so
   on every page. While no factory is configured the chain layer never loads, so this also stands in for its ready
   promise. Loaded after chain.js, equo.js and hl.js, before core.js. */
(function () {
  const cfg = window.INKY || {};
  let on = !!cfg.preview;
  try {
    const q = new URLSearchParams(location.search).get('preview');
    if (q === '1') localStorage.setItem('liqio-preview', '1');
    if (q === '0') localStorage.setItem('liqio-preview', '0');
    const v = localStorage.getItem('liqio-preview');
    if (v === '1') on = true; if (v === '0') on = false;
  } catch {}
  window.EQUO_PREVIEW = on;
  const C = window.CHAIN;
  if (!C) return;
  // no factory yet: the chain layer has nothing to load, the pages still boot
  if (!C.ready) C.ready = Promise.resolve(true);
  if (!on) return;

  const NOW = Math.floor(Date.now() / 1000), H = 3600, SUP = 1e9;
  const NATIVE = cfg.native || 'HYPE';
  const WETH = String(cfg.weth || '').toLowerCase();
  const MAIN = ((cfg.chains || []).find((c) => c.main) || (cfg.chains || [])[0] || { key: 'hyper' }).key;
  const pairOf = (sym) => sym === NATIVE ? { address: WETH } : ((cfg.cryptoPairs || []).concat(cfg.stocks || []).find((s) => s.symbol === sym) || {});
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const wallet = () => '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
  const logo = (txt, a, b) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" rx="32" fill="url(#g)"/><text x="32" y="${txt.length > 3 ? 37 : 39}" font-family="Arial,Helvetica,sans-serif" font-size="${txt.length > 3 ? 15 : 19}" font-weight="700" fill="#fff" text-anchor="middle">${txt}</text></svg>`);

  const SPECS = [
    { addr: '0x1100000000000000000000000000000000000001', n: 'Hyperion', t: 'HYPR', pair: NATIVE, fee: 100, ageH: 36, trades: 260, p0: 3000, p1: 92000, pairUsd: 77, img: logo('HYPR', '#0f766e', '#33e5c2'), desc: 'The first example coin on Liqio, paired with HYPE. Fees settle in HYPE.', genes: { divShareBps: 2000 }, rewards: true },
    { addr: '0x1100000000000000000000000000000000000002', n: 'Green Chips', t: 'CHIP', pair: 'wNVDAx', fee: 200, ageH: 9, trades: 130, p0: 3000, p1: 28000, pairUsd: 212, img: logo('CHIP', '#16a34a', '#9ef01a'), desc: 'Paired with NVIDIA stock (wNVDAx). The fee is paid in the stock.', genes: {}, rewards: false },
    { addr: '0x1100000000000000000000000000000000000003', n: 'Index Fund Coin', t: 'SPX', pair: 'wSPYx', fee: 100, ageH: 2, trades: 45, p0: 3000, p1: 9000, pairUsd: 765, img: logo('SPX', '#1d4ed8', '#60a5fa'), desc: 'Paired with the S&P 500 ETF (wSPYx), with buyback and burn.', genes: { buybackShareBps: 2000 }, rewards: false },
  ];

  const TR = {}, MOCK = SPECS.map((s) => {
    const st = pairOf(s.pair), pairUsd = s.pairUsd, chains = [MAIN];
    const created = NOW - s.ageH * H;
    const capPx = (cap) => cap / SUP;
    const trades = [], wallets = Array.from({ length: Math.max(12, Math.round(s.trades / 4)) }, wallet);
    let px = capPx(s.p0);
    for (let i = 0; i < s.trades; i++) {
      const f = (i + 1) / s.trades, target = capPx(s.p0 * Math.pow(s.p1 / s.p0, f));
      const buy = rnd() < 0.62 + (target > px ? 0.1 : -0.1);
      px = Math.max(capPx(s.p0) * 0.6, target * (0.9 + rnd() * 0.2));
      const usd = 20 + Math.pow(rnd(), 2) * 1800, pairAmt = usd / pairUsd, coinAmt = usd / px;
      trades.push({ token: s.addr, wallet: wallets[Math.floor(rnd() * wallets.length)], buy, coin: String(BigInt(Math.round(coinAmt * 1e6)) * 10n ** 12n), pair: String(BigInt(Math.round(pairAmt * 1e9)) * 10n ** 9n), fee: String(BigInt(Math.round(pairAmt * s.fee / 1e4 * 1e9)) * 10n ** 9n), realized: '0', block: 0, ts: Math.round(created + f * (NOW - created) - rnd() * 60), tx: '0x' + s.addr.slice(2, 10) + i.toString(16).padStart(56, '0'), index: i, chain: MAIN });
    }
    TR[s.addr] = trades;
    const last = trades[trades.length - 1], day = trades.filter((t) => t.ts >= NOW - 86400);
    const pxNow = Number(last.pair) / Number(last.coin) * pairUsd, first24 = day.length ? Number(day[0].pair) / Number(day[0].coin) * pairUsd : pxNow;
    const vol = day.reduce((a, t) => a + Number(t.pair) / 1e18 * pairUsd, 0);
    const byChain = { [MAIN]: { px: pxNow, vol, trades: trades.length, supply: SUP, pairUsd } };
    const age = s.ageH >= 24 ? Math.round(s.ageH / 24) + 'd' : s.ageH + 'h';
    return {
      addr: s.addr, n: s.n, t: s.t, img: s.img, desc: s.desc, pair: s.pair, pairAddr: String(st.address || '').toLowerCase(), pairUsd,
      px: pxNow, pxPair: pxNow / pairUsd, mc: pxNow * SUP, c24: (pxNow / first24 - 1) * 100, vol, trades: trades.length, traders: wallets.length, h: wallets.length,
      createdAt: created, age, feeBps: s.fee, rewards: s.rewards, genes: s.genes, creator: wallets[0], links: { x: 'https://x.com/' + (cfg.x || 'liqiofun') },
      liq: pxNow * SUP * 0.42, liqPair: pxNow * SUP * 0.42 / pairUsd, totalCreatorFees: vol * s.fee / 1e4 * 0.6 / pairUsd * 3, creatorOwed: 0, buybackPot: 0, dividendPot: 0,
      poolId: '0x' + s.addr.slice(2).padEnd(64, '0'), chains, addrs: { [MAIN]: s.addr }, byChain, mock: true, hidden: false,
    };
  });
  const isMock = (a) => { a = String(a || '').toLowerCase(); return MOCK.find((x) => x.addr === a) || null; };

  // the chain layer answers for the example coins; everything else passes through
  const w = (name, fn) => { const orig = C[name]; C[name] = function (a, ...rest) { const m = isMock(a); return m ? fn(m, ...rest) : orig ? orig.apply(this, arguments) : undefined; }; };
  const t0 = C.tokens; C.tokens = () => (t0 ? t0() : []).concat(MOCK);
  const tk = C.token; C.token = (a) => isMock(a) || (tk ? tk(a) : null);
  const at = C.allTrades; C.allTrades = async (...a) => (at ? await at(...a).catch(() => []) : []).concat(...Object.values(TR));
  w('trades', async (m) => TR[m.addr].slice());
  w('refresh', async (m) => m);
  w('holders', async (m) => { const by = {}; TR[m.addr].forEach((t) => { by[t.wallet] = (by[t.wallet] || 0) + (t.buy ? 1 : -0.5) * Number(t.coin) / 1e18; }); return Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([wallet, bal]) => ({ wallet, bal, share: bal / SUP * 100 })); });
  w('topTraders', async (m) => { const by = {}; TR[m.addr].forEach((t) => { const r = by[t.wallet] || (by[t.wallet] = { wallet: t.wallet, volume: 0, trades: 0, bought: 0, sold: 0 }); r.volume += Number(t.pair) / 1e18 * m.pairUsd; r.trades++; if (t.buy) r.bought += Number(t.coin) / 1e18; else r.sold += Number(t.coin) / 1e18; }); return Object.values(by).map((r) => ({ ...r, pnl: 0, holding: r.bought > r.sold })).sort((a, b) => b.volume - a.volume); });
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
  const natUsd = () => (window.SP && SP.prices && SP.prices[WETH]) || (window.HL && HL.usd(WETH)) || 77;
  w('quoteBuy', async (m, amt) => quote(m, amt, true));
  w('quoteSell', async (m, amt) => quote(m, amt, false));
  w('quoteBuyEth', async (m, amt) => quote(m, BigInt(Math.floor(Number(amt) * natUsd() / m.pairUsd)), true));
  w('quoteSellEth', async (m, amt) => { const p = quote(m, amt, false); return BigInt(Math.floor(Number(p) * m.pairUsd / natUsd())); });
  const no = async () => { throw new Error('This is an example coin. Trading opens when Liqio goes live on HyperEVM.'); };
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
    b.innerHTML = `<span><b>Preview</b> Example coins are shown (Hyperion, Green Chips, Index Fund Coin). They are made up and cannot be traded; launches open when Liqio goes live on HyperEVM.</span><a href="?preview=0">Hide examples</a>`;
    const top = document.getElementById('sp-top'); if (top) top.insertAdjacentElement('afterend', b); else document.body.prepend(b);
  });
})();
