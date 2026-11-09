/* Kinex views. Hash routes: #/ explore, #/token/<addr>, #/launch, #/bridge[/any|hyperevm|withdraw], #/airdrop,
   #/flywheel, #/fees, #/docs, #/profile[/<addr>]. Data from DATA (the launch pools, chain.js) and BRIDGE (bridge.js). */
(function () {
  const C = window.CFG, X = window.ethers, { $, $$, esc, fmtNum, fmtPrice, fmtUsd, fmtPct, shortAddr, ago, fmtDate } = APP;
  const Q = C.chain.quote, ST = C.stake || {}, AD = null /* the airdrop is off for now; its terms stay in C.airdrop */, BR = C.bridge || null, view = $('#view'), low = (a) => String(a || '').toLowerCase();
  const usd = (q) => APP.usd(q), hype = (n, d) => fmtNum(n, d ?? (Math.abs(n) >= 100 ? 1 : Math.abs(n) >= 1 ? 3 : 5)) + ' ' + Q, sym = () => ST.symbol || 'KINEX';
  const ICON = { x: '<svg class="ico" viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>', copy: '<svg class="ico" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', ext: '<svg class="ico" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>', chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' };
  const MI = {
    home: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
    create: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    bridge: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 18h18M5 18v-5M19 18v-5M3 13c3-5 6-7 9-7s6 2 9 7M9 18v-4M15 18v-4"/></svg>',
    gift: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9M12 8c-2-3-5-3-5-1s3 1 5 1zm0 0c2-3 5-3 5-1s-3 1-5 1z"/></svg>',
    fly: '<svg class="ico" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
    fees: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 2v20M17 6.5c0-1.9-2.2-3.5-5-3.5S7 4.6 7 6.5 9.2 10 12 10s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5"/></svg>',
    profile: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    docs: '<svg class="ico" viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/></svg>',
  };
  const state = { route: '', tf: 900, cmode: 'mcap', ckind: 'line', side: 'b', ttab: 'trades', busy: false, slip: Number((() => { try { return localStorage.getItem('slip'); } catch { return 0; } })() || 100) };
  const link = (t) => `#/token/${t.addr}`;
  const etch = (name) => `<picture><source media="(max-width:900px)" srcset="/img/etch-${name}-sm.webp"><img class="etch" src="/img/etch-${name}.webp" alt="" decoding="async"></picture>`;
  const pct = (shareBps) => String(+((C.econ.feeBps / 100) * shareBps / 10000).toFixed(2));
  const BURN_OF_PROTO = (ST.burnBps || 0) / 10000, SPL = { burn: pct(C.econ.protocolShareBps * BURN_OF_PROTO), plat: pct(C.econ.protocolShareBps * (1 - BURN_OF_PROTO)) }; // % of volume
  const chip = (v) => !Number.isFinite(v) ? '<span class="chg">—</span>' : `<span class="chg ${v > 0 ? 'up' : v < 0 ? 'dn' : ''}">${(v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%</span>`;
  const feeOf = (t) => ((t.feeBps || C.econ.feeBps) / 100).toFixed(1).replace(/\.0$/, '') + '%';
  const coinRow = (t, i) => `<tr class="link" data-go="${link(t)}"><td class="idx">${i + 1}</td><td><div class="who"><span class="av badge">${APP.img(t)}</span><div><b>${esc(t.name)} <span class="mute" style="font-weight:500">$${esc(t.symbol)}</span> ${APP.ofc(t)}</b><small>${esc(t.age)} · /${esc(t.pairSym || Q)}</small></div></div></td><td><canvas class="sp" data-spark="${t.addr}"></canvas></td><td class="r">${chip(t.c24)}</td><td class="r num"><b>${fmtUsd(t.mcapUsd)}</b></td><td class="r num">${fmtUsd(t.vol24 * APP.hypeUsd)}</td><td class="r num">${t.holders}</td><td class="r"><span class="feebar"><i style="--w:${t.creatorShareBps / 100}%"></i><span>${feeOf(t)}</span></span></td></tr>`;
  const ribbon = (t) => window.ART ? ART.ribbon(t) : '';
  const art = (seed, w, h) => window.ART ? ART.ripples({ seed, w, h }) : '';

  // ---- sparkline and chart
  function spark(cv, t, w, h) {
    const age = Date.now() / 1000 - (t.createdAt || 0), cs = DATA.candles(t.addr, age < 3 * 3600 ? 60 : age < 86400 ? 900 : 3600).slice(-48); const dpr = devicePixelRatio || 1; cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); if (cs.length < 2) return;
    const v = cs.map((b) => b.c), lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || hi || 1, up = v[v.length - 1] >= v[0], col = getComputedStyle(document.documentElement).getPropertyValue(up ? '--up' : '--dn').trim();
    g.strokeStyle = col; g.lineWidth = 1.6; g.lineJoin = 'round'; g.beginPath(); v.forEach((y, i) => { const x = i / (v.length - 1) * (w - 2) + 1, yy = h - 3 - (y - lo) / rg * (h - 6); i ? g.lineTo(x, yy) : g.moveTo(x, yy); }); g.stroke();
    g.lineTo(w - 1, h); g.lineTo(1, h); g.closePath(); g.fillStyle = col + '1a'; g.fill();
  }
  // the price chart: TradingView Lightweight Charts (Apache 2.0), loaded once from unpkg
  let lwLoad = null; const lw = () => lwLoad || (lwLoad = window.LightweightCharts ? Promise.resolve(window.LightweightCharts) : new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js'; sc.onload = () => ok(window.LightweightCharts); sc.onerror = () => { lwLoad = null; no(new Error('chart library')); }; document.head.appendChild(sc); }));
  async function drawChart(el, t) {
    if (!el) return; if (state.lw) { try { state.lw.remove(); } catch {} state.lw = null; } state.lwUpd = null;
    let all = DATA.candles(t.addr, state.tf); const oh = $('#ohlc'); if (!all.length) { if (oh) oh.innerHTML = '<span class="mute">No trades yet.</span>'; return; }
    const mul = (state.cmode === 'mcap' ? C.econ.supply : 1) * APP.hypeUsd, lab = (v) => (state.cmode === 'mcap' ? (v >= 1000 ? fmtUsd(v).replace(/\.\d\d$/, '') : fmtUsd(v)) : '$' + fmtPrice(v).replace(/<[^>]+>/g, ''));
    const scale = (a) => a.slice(-500).map((b) => ({ ...b, o: b.o * mul, h: b.h * mul, l: b.l * mul, c: b.c * mul })), line = state.ckind === 'line';
    let K = scale(all), athV = Math.max(...all.map((b) => b.h)) * mul;
    const strip = (b, i) => { const prev = i > 0 ? K[i - 1].c : b.o, trades = DATA.trades(t.addr).filter((x) => x.ts >= b.t && x.ts < b.t + state.tf).length; if (oh) oh.innerHTML = `<b>${lab(b.c)}</b><span class="${b.c >= prev ? 'up' : 'dn'}">${fmtPct(prev ? (b.c / prev - 1) * 100 : 0)}</span><span><i>H</i>${lab(b.h)}</span><span><i>L</i>${lab(b.l)}</span><span><i>Vol</i>${fmtUsd(b.v * APP.hypeUsd)}</span><span><i>Trades</i>${trades}</span><span><i>ATH</i>${lab(athV)}</span>`; };
    strip(K[K.length - 1], K.length - 1);
    let LW; try { LW = await lw(); } catch { el.innerHTML = '<div class="empty">The chart could not load.</div>'; return; }
    if (!document.body.contains(el)) return;
    const css = getComputedStyle(document.documentElement), mono = '"Geist Mono", ui-monospace, monospace', mute = '#95a8a3', up = '#128a5e', dn = '#c73a47', acc = '#17b595';
    const chart = LW.createChart(el, { width: el.clientWidth, height: el.clientHeight, localization: { locale: 'en-US', priceFormatter: lab }, layout: { background: { type: 'solid', color: 'transparent' }, textColor: mute, fontFamily: mono, fontSize: 11, attributionLogo: true }, grid: { vertLines: { color: 'rgba(13,37,34,.05)' }, horzLines: { color: 'rgba(13,37,34,.07)' } }, rightPriceScale: { borderVisible: false, scaleMargins: { top: .08, bottom: .22 } }, timeScale: { borderVisible: false, timeVisible: state.tf < 86400, secondsVisible: false, rightOffset: 3 }, crosshair: { mode: LW.CrosshairMode.Normal, vertLine: { color: 'rgba(13,37,34,.25)', labelBackgroundColor: '#0b2b2a' }, horzLine: { color: 'rgba(13,37,34,.25)', labelBackgroundColor: '#0b2b2a' } }, handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }, handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true } });
    void css;
    const priceFormat = { type: 'custom', formatter: lab, minMove: state.cmode === 'mcap' ? 0.01 : 1e-12 };
    const series = line
      ? chart.addAreaSeries({ lineColor: acc, lineWidth: 2, topColor: 'rgba(23,181,149,.28)', bottomColor: 'rgba(23,181,149,0)', priceFormat, lastValueVisible: true, priceLineVisible: true, priceLineStyle: LW.LineStyle.Dotted, priceLineColor: acc, crosshairMarkerRadius: 4 })
      : chart.addCandlestickSeries({ upColor: up, downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn, priceFormat, priceLineStyle: LW.LineStyle.Dotted });
    const sData = () => (line ? K.map((b) => ({ time: b.t, value: b.c })) : K.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })));
    series.setData(sData());
    const athLine = series.createPriceLine({ price: athV, color: 'rgba(13,37,34,.45)', lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: 'ATH' });
    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: .9, bottom: 0 }, borderVisible: false, visible: false });
    const vData = () => K.map((b) => ({ time: b.t, value: b.v * APP.hypeUsd, color: b.c >= b.o ? 'rgba(18,138,94,.22)' : 'rgba(199,58,71,.22)' }));
    vol.setData(vData());
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((pt) => { if (!pt || !pt.time) { strip(K[K.length - 1], K.length - 1); return; } const i = K.findIndex((b) => b.t === pt.time); if (i >= 0) strip(K[i], i); });
    const ro = new ResizeObserver(() => { if (document.body.contains(el)) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }); else { ro.disconnect(); } }); ro.observe(el);
    state.lw = chart;
    // new trades: replace the data, keep the user's zoom and scroll
    state.lwUpd = (t2) => { if (t2.addr !== t.addr) return false; all = DATA.candles(t.addr, state.tf); if (!all.length) return true; K = scale(all); athV = Math.max(...all.map((b) => b.h)) * mul; series.setData(sData()); vol.setData(vData()); athLine.applyOptions({ price: athV }); strip(K[K.length - 1], K.length - 1); return true; };
  }
  function chartUpdate(t) { if (!(state.lwUpd && state.lw && state.lwUpd(t))) drawChart($('#chart'), t); }
  function area(cv, s, color, { bars = false } = {}) {
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1, W = r.width || 300, H = r.height || 160; cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); if (!s.length) return;
    const mx = Math.max(...s) || 1, mn = bars ? 0 : Math.min(...s), rg = mx - mn || mx || 1;
    if (bars) { const bw = W / s.length; s.forEach((v, i) => { const h = v / mx * (H - 16); g.fillStyle = color; g.globalAlpha = .85; g.fillRect(i * bw + bw * .18, H - h - 2, Math.max(1, bw * .64), h); }); g.globalAlpha = 1; return; }
    const pts = s.map((y, i) => [i / Math.max(1, s.length - 1) * W, 12 + (1 - (y - mn) / rg) * (H - 18)]);
    const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; g.bezierCurveTo(cx, y0, cx, y1, x1, y1); } };
    path(); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, color + '33'); gr.addColorStop(1, color + '00'); g.fillStyle = gr; g.fill();
    path(); g.strokeStyle = color; g.lineWidth = 1.8; g.lineJoin = 'round'; g.stroke();
  }
  const drawSparks = (ts) => $$('[data-spark]').forEach((cv) => { const t = ts.find((x) => x.addr === cv.dataset.spark); if (t) spark(cv, t, cv.clientWidth || 90, cv.clientHeight || 30); });
  function ticker() {
    const el = $('#ticker'); if (!el) return; const preview = C.demo && !C.liveChains().length; const ts = [...DATA.tokens()].sort((a, b) => b.vol24 - a.vol24).slice(0, 14); if (!ts.length) { el.innerHTML = ''; el.style.display = 'none'; return; } el.style.display = '';
    const items = ts.map((t) => `<a class="it" href="${link(t)}"><span class="av">${APP.img(t)}</span><b>${esc(t.symbol)}</b><span class="num">${fmtUsd(t.mcapUsd)}</span>${chip(t.c24)}</a>`).join('');
    el.innerHTML = `${preview ? '<span class="pv">Preview · sample coins</span>' : ''}<div class="run">${items}${items}</div>`;
  }
  const allTrades = () => DATA.tokens().flatMap((t) => DATA.trades(t.addr).map((x) => ({ ...x, token: t })));

  // ---- home (explore)
  function home(live) {
    const ts = DATA.tokens(), sort = state.sort || 'trending', q = state.q || '', pf = state.pf || 'all', hasStocks = (C.chain.pairs || []).some((p) => p.kind === 'stock');
    const vol = ts.reduce((a, t) => a + t.vol24, 0), volAll = ts.reduce((a, t) => a + t.volAll, 0), traders = new Set(allTrades().map((x) => low(x.wallet))).size, trades24 = ts.reduce((a, t) => a + t.buys24 + t.sells24, 0);
    const lead = [...ts].sort((a, b) => b.mcapUsd - a.mcapUsd).slice(0, 4), tide = ST.token ? DATA.token(low(ST.token)) : null;
    const list = ts.filter((t) => !q || (t.name + t.symbol + t.addr).toLowerCase().includes(q)).filter((t) => pf === 'all' || (pf === 'stock' ? DATA.pairOf(t.addr) : !DATA.pairOf(t.addr))).sort((a, b) => sort === 'new' ? b.createdAt - a.createdAt : sort === 'top' ? b.mcapUsd - a.mcapUsd : b.vol24 - a.vol24);
    const tape = allTrades().sort((a, b) => b.ts - a.ts).slice(0, 12), byVol = [...ts].sort((a, b) => b.vol24 - a.vol24).slice(0, 6);
    const creatorPaid = ts.reduce((a, t) => a + t.feesAll * (t.creatorShareBps / 10000), 0), fly = (DATA.raw() || {}).flywheel, adPct = AD ? AD.pools.reduce((a, p) => a + p.pct, 0) : 0;
    const flies = tape.slice(0, 3).map((x, i) => `<a class="fly" href="${link(x.token)}" style="left:${[6, 54, 24][i]}%;top:${[18, 40, 72][i]}%"><span class="av">${APP.img(x.token)}</span><span class="${x.buy ? 'up' : 'dn'}">${x.buy ? 'Buy' : 'Sell'}</span> $${esc(x.token.symbol)} ${fmtUsd(x.hype * APP.hypeUsd)} · ${ago(x.ts)}</a>`).join('');
    const html = `<div class="page">
      <section class="hero"><div><span class="eyebrow">The launchpad on Elysium, on Uniswap v4</span>
          <h1 class="disp">Every launch<br>fills the <em>pool.</em></h1>
          <p>One transaction opens a token and its ${hasStocks ? esc(Q) + ' or stock' : esc(Q)} pool. Every trade pays a fixed ${(C.econ.feeBps / 100).toFixed(1)}%: ${pct(C.econ.creatorShareBps)}% to the creator, ${SPL.plat}% to the platform, ${SPL.burn}% buys $${esc(sym())} and burns it.</p>
          <div class="acts"><a class="btn pri arrow" href="#/launch">Launch a token</a><a class="btn" href="#/docs">How it works</a></div>
          ${tide ? `<a class="note" href="${link(tide)}"><span class="av">${APP.img(tide)}</span><span><b>$${esc(sym())}</b> Protocol fees buy it back and burn it.</span><span class="arrow">Trade $${esc(sym())}</span></a>` : ''}
          <div class="hstats"><div class="stat"><span>Volume</span><b>${fmtUsd(volAll * APP.hypeUsd)}</b><small>${fmtUsd(vol * APP.hypeUsd)} in 24h</small></div><div class="stat"><span>Tokens</span><b>${ts.length}</b><small>${trades24} trades, 24h</small></div><div class="stat"><span>Traders</span><b>${traders}</b><small>all time</small></div></div></div>
        <div class="heroart etched"><picture><source media="(max-width:900px)" srcset="/img/hero-arch-sm.webp"><img class="etch" src="/img/hero-arch.webp" alt="" decoding="async" fetchpriority="high"></picture>${flies}</div></section>
      ${lead.length ? `<div class="sec"><h2>Leading</h2><span class="ln"></span></div><div class="lead">${lead.map((t, i) => `<a class="lcard" href="${link(t)}">${ribbon(t.symbol)}<div class="body"><span class="av ring">${APP.img(t)}</span><div class="meta"><small><span>$${esc(t.symbol)}</span><i>№ ${i + 1}</i></small><b>${esc(t.name)}</b><div class="cap"><b>${fmtUsd(t.mcapUsd)}</b>${chip(t.c24)}</div><div class="sub"><span>${t.buys24 + t.sells24} trades, 24h</span><span>/${esc(t.pairSym || Q)}</span></div></div></div><div class="fee"><i style="--w:${t.creatorShareBps / 100}%"></i><span>${feeOf(t)}</span></div>${ribbon(t.symbol)}</a>`).join('')}</div>` : ''}
      <div class="sec"><h2>Markets</h2><span class="ln"></span></div>
      <div class="mk"><div>
        <div class="mkbar"><div class="filters">${[['trending', 'Trending'], ['new', 'New'], ['top', 'Top']].map(([k, l]) => `<button data-sort="${k}" class="${sort === k ? 'on' : ''}">${l}</button>`).join('')}</div>${hasStocks ? `<div class="filters pf">${[['all', 'All pairs'], ['hype', Q], ['stock', 'Stocks']].map(([k, l]) => `<button data-pf="${k}" class="${pf === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>` : ''}<input class="inp" id="h-q" placeholder="Search name, ticker or address" value="${esc(q)}"></div>
        <div class="board"><div class="tw"><table class="tb mkt"><thead><tr><th>#</th><th>Token</th><th>Last 24h</th><th class="r">24h</th><th class="r">Cap</th><th class="r">Vol</th><th class="r">Holders</th><th class="r">Fee</th></tr></thead><tbody>${list.length ? list.slice(0, 50).map(coinRow).join('') : `<tr><td colspan="8"><div class="empty">${ts.length ? 'Nothing matches.' : 'No launches yet.'}</div></td></tr>`}</tbody></table></div></div></div>
        <aside class="side">
          <div class="card"><h3>Last 24h <small>volume</small></h3><div class="vl">${byVol.map((t) => `<a href="${link(t)}"><span class="av">${APP.img(t)}</span>${esc(t.symbol)}<b>${fmtUsd(t.vol24 * APP.hypeUsd)}</b></a>`).join('') || '<div class="empty">No trades yet.</div>'}</div></div>
          <div class="card"><h3>The tape <small class="live">live</small></h3><div class="vl">${tape.map((x) => `<a href="${link(x.token)}"><span class="${x.buy ? 'side-b' : 'side-s'}">${x.buy ? 'Buy' : 'Sell'}</span>${esc(x.token.symbol)}<b class="v">${fmtUsd(x.hype * APP.hypeUsd)}</b><span class="t">${ago(x.ts)}</span></a>`).join('') || '<div class="empty">No trades yet.</div>'}</div></div>
        </aside></div>
      <div class="sec" style="margin-top:44px"><h2>One fee, ${AD ? 'four' : 'three'} roads.</h2><span class="ln"></span></div>
      <p class="mute" style="margin:-6px 0 16px;max-width:620px">Every trade pays a fixed ${(C.econ.feeBps / 100).toFixed(1)}% in ${esc(Q)}. The creator takes ${pct(C.econ.creatorShareBps)}% of volume. The protocol's ${pct(C.econ.protocolShareBps)}% splits in two: ${SPL.plat}% is platform revenue and ${SPL.burn}% buys $${esc(sym())} on its own pool and burns it.</p>
      <div class="roads">
        <div class="road"><h3>To the creator</h3><div class="amt">${fmtUsd(creatorPaid * APP.hypeUsd)}</div><small>paid so far · ${ts.length} tokens</small><p>Paid to the launcher, to claim whenever they like.${(C.econ.creatorTaxMaxBps / 100) > 0 ? ' A creator can add up to ' + (C.econ.creatorTaxMaxBps / 100) + '% on top.' : ''}</p><a class="arrow" href="#/fees">Your fees</a></div>
        <div class="road"><h3>To buybacks</h3><div class="amt">${fly ? fmtUsd(fly.burnedQuote * APP.hypeUsd) : '$0'}</div><small>spent so far · ${fly ? fmtNum(fly.burnedTokens) : 0} $${esc(sym())} burned</small><p>${SPL.burn}% of every trade buys $${esc(sym())} from its own pool and burns it, so its supply only falls.</p><a class="arrow" href="#/flywheel">The flywheel</a></div>
        <div class="road"><h3>To the platform</h3><div class="amt">${fly ? fmtUsd((fly.toTreasury || 0) * APP.hypeUsd) : '$0'}</div><small>revenue so far · ${SPL.plat}% of volume</small><p>Platform revenue. It runs the keeper that sweeps fees and buys back, the indexer and the site.</p></div>
        ${AD ? `<div class="road"><h3>To the airdrop</h3><div class="amt">${AD ? adPct + '%' : '—'}</div><small>of the supply · ${AD ? fmtNum(C.econ.supply * adPct / 100) : 0} $${esc(sym())}</small><p>Points for every ${esc(Q)} traded and every token launched, until ${AD ? new Date(AD.ends).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}.</p><a class="arrow" href="#/airdrop">Check eligibility</a></div>` : ''}
      </div>
      ${AD ? `<div class="dark banner">${art(5, 900, 300)}<div style="position:relative"><h3>The $${esc(sym())} airdrop</h3><p>${adPct}% of the supply, for everyone who trades on Elysium.</p></div><div class="amt" style="position:relative">${fmtNum(C.econ.supply * adPct / 100)} $${esc(sym())}</div><a class="btn cta arrow" href="#/airdrop" style="position:relative">Check eligibility</a></div>` : ''}
    </div>`;
    if (live && $('.page > .hero')) { // live update: swap the figures and lists in place; the search box, filters and scroll stay
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      for (const sel of ['.hstats', '.lead', '.board', '.mk .side', '.roads']) { const x = $(sel), y = tmp.querySelector(sel); if (x && y && x.innerHTML !== y.innerHTML) x.innerHTML = y.innerHTML; }
      drawSparks(ts); bindGo(); return;
    }
    view.innerHTML = html;
    drawSparks(ts); bindGo();
    $$('[data-sort]').forEach((b) => b.onclick = () => { state.sort = b.dataset.sort; home(); }); $$('[data-pf]').forEach((b) => b.onclick = () => { state.pf = b.dataset.pf; home(); });
    const qi = $('#h-q'); qi.oninput = () => { state.q = qi.value.trim().toLowerCase(); home(true); };
  }

  // ---- token
  function token(addr, live) {
    const t = DATA.token(addr); if (!t) { view.innerHTML = '<div class="page"><div class="empty">Unknown token.</div></div>'; return; }
    if (C.chain.key !== t.net) C.useChain(t.net, false);
    const pp = DATA.pairOf(t.addr), PQ = pp ? pp.sym : Q, PLOGO = pp ? pp.logo : C.chain.logo;
    const fs = DATA.feeState(t.addr) || { kind: 'base', bps: C.econ.feeBps, total: C.econ.feeBps }, me = APP.W.connected ? APP.W.address : '', isCreator = me && (me === t.creator || me === t.feeRecipient);
    if (state.tfFor !== t.addr) { state.tfFor = t.addr; const age = Date.now() / 1000 - (t.createdAt || 0); state.tf = age < 3 * 3600 ? 60 : age < 86400 ? 300 : 900; }
    const trades = DATA.trades(t.addr), holders = DATA.holders(t.addr), pos = DATA.positions(t.addr), cs = DATA.candles(t.addr, 900), ath = cs.length ? Math.max(...cs.map((b) => b.h)) * C.econ.supply * APP.hypeUsd : t.mcapUsd;
    const slipPct = (state.slip / 100).toFixed(state.slip % 100 ? 1 : 0), buys = t.buys24 || 0, sells = t.sells24 || 0, bshare = buys + sells ? buys / (buys + sells) * 100 : 50;
    const links = `<div class="lnks">${t.links.web ? `<a class="lnk" href="${esc(t.links.web)}" target="_blank" rel="noopener" aria-label="Website"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg></a>` : ''}${t.links.x ? `<a class="lnk" href="${esc(t.links.x)}" target="_blank" rel="noopener" aria-label="X">${ICON.x}</a>` : ''}${t.links.tg ? `<a class="lnk" href="${esc(t.links.tg)}" target="_blank" rel="noopener" aria-label="Telegram"><svg viewBox="0 0 24 24"><path d="M21 4 3 11l6 2 2 6 3-4 5 3z"/><path d="m9 13 10-9"/></svg></a>` : ''}<button class="lnk num" data-copy="${t.addr}">${esc(shortAddr(t.addr))} ${ICON.copy}</button><a class="lnk" href="${APP.explorer('address', t.addr)}" target="_blank" rel="noopener">Explorer ${ICON.ext}</a></div>`;
    const snipeRow = fs.kind === 'snipe' ? `<div class="trow warn"><span>Launch protection</span><b>+${(fs.snipeBps / 100).toFixed(1)}% on buys, fades in ${fs.left}s</b></div>` : '';
    const html = `<div class="page"><div class="tk">
      <div class="tk-top">
        <div class="tband">${ribbon(t.symbol)}
          <div class="hd"><span class="av badge">${APP.img(t)}</span><div class="tkwho"><span class="eyebrow">$${esc(t.symbol)} / ${esc(PQ)} · ${esc(t.age)} ${APP.ofc(t)}</span><h1>${esc(t.name)}</h1>${t.desc ? `<p>${esc(t.desc)}</p>` : ''}${links}</div><div class="mcap"><span>Market cap</span><b>${fmtUsd(t.mcapUsd)}</b><small class="${t.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(t.c24)} <i>24h</i></small></div></div>
          <div class="tstats"><div class="stat"><span>Price</span><b>$${fmtPrice(t.pxUsd)}</b><small>${fmtPrice(t.px)} ${esc(Q)}</small></div><div class="stat"><span>Liquidity</span><b>${fmtUsd(t.liqHype * APP.hypeUsd)}</b><small>${hype(t.liqHype, 2)}</small></div><div class="stat"><span>Volume 24h</span><b>${fmtUsd(t.vol24 * APP.hypeUsd)}</b><small>${fmtUsd(t.volAll * APP.hypeUsd)} all time</small></div><div class="stat"><span>Holders</span><b>${t.holders}</b><small>${fmtNum(C.econ.supply)} supply</small></div><div class="stat"><span>Buys, 24h</span><div class="ratio"><i style="width:${bshare.toFixed(1)}%"></i></div><small><em class="up">${buys} buys</em><em class="dn">${sells} sells</em></small></div><div class="stat"><span>Creator</span><b class="num" style="font-size:14px;margin-top:6px"><a href="#/profile/${t.creator}">${esc(shortAddr(t.creator))}</a></b><small>${isCreator ? 'you' : 'earns ' + pct(t.creatorShareBps) + '% of volume'}</small></div></div></div>
        <div class="chartcard">
          <div class="cbar"><div class="seg sm"><button data-cm="mcap" class="${state.cmode === 'mcap' ? 'on' : ''}">Market cap</button><button data-cm="price" class="${state.cmode === 'price' ? 'on' : ''}">Price</button></div><div class="cright"><div class="seg sm"><button data-ck="line" class="${state.ckind === 'line' ? 'on' : ''}">Line</button><button data-ck="candles" class="${state.ckind === 'candles' ? 'on' : ''}">Candles</button></div><div class="seg sm">${[[60, '1m'], [300, '5m'], [900, '15m'], [3600, '1h'], [14400, '4h'], [86400, '1d']].map(([s_, l]) => `<button data-tf="${s_}" class="${state.tf === s_ ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
          <div class="ohlc" id="ohlc"></div>
          <div class="chart" id="chart"></div>
        </div>
      </div>
      <aside class="tk-side">
        <div class="trade card pad">
          <h3>Trade</h3>
          <div class="seg side"><button data-side="b" class="${state.side === 'b' ? 'on buy' : ''}">Buy</button><button data-side="s" class="${state.side === 's' ? 'on sell' : ''}">Sell</button></div>
          <div class="in"><label><span>You pay</span><span id="t-bal"></span></label><div class="row"><input id="t-amt" inputmode="decimal" placeholder="0.0" autocomplete="off"><span class="tok"><span class="av">${state.side === 'b' ? `<img src="${esc(PLOGO)}" alt="">` : APP.img(t)}</span>${state.side === 'b' ? esc(PQ) : esc(t.symbol)}</span></div></div>
          <div class="chips">${state.side === 'b' ? (pp ? ['0.05', '0.1', '0.25', '1'] : ['0.1', '0.5', '1', '5']).map((v) => `<button data-v="${v}">${v}</button>`).join('') : ['25', '50', '75', '100'].map((v) => `<button data-p="${v}">${v}%</button>`).join('')}</div>
          <div class="trows">
            <div class="trow"><span>You receive</span><b><span id="t-recv">—</span> <small id="t-recv2">${state.side === 'b' ? esc(t.symbol) : esc(PQ)}</small></b></div>
            <div class="trow"><span>Minimum</span><b id="t-min">—</b></div>
            <div class="trow"><span>${state.side === 'b' ? 'Buy' : 'Sell'} fee now</span><b>${(fs.total / 100).toFixed(2)}% <small>creator ${pct(t.creatorShareBps)}% · protocol ${pct(10000 - t.creatorShareBps)}%</small></b></div>
            ${snipeRow}
            <div class="trow"><span>Slippage</span><b class="slipchips">${[100, 300, 500].map((v) => `<button data-s="${v}" class="${state.slip === v ? 'on' : ''}">${v / 100}%</button>`).join('')}<button id="t-slip" class="${[100, 300, 500].includes(state.slip) ? '' : 'on'}">${[100, 300, 500].includes(state.slip) ? 'Custom' : slipPct + '%'}</button></b></div>
          </div>
          <button class="btn lg full ${state.side === 'b' ? 'pri' : 'sell'}" id="t-go">${!APP.W.connected ? 'Connect' : state.side === 'b' ? 'Buy $' + esc(t.symbol) : 'Sell $' + esc(t.symbol)}</button>
          ${AD ? `<div class="adpts"><span class="av"><img src="/img/mark.svg?v=2" alt=""></span><span>Airdrop points</span><b>${AD.tradePts} per ${esc(Q)} traded</b></div>` : ''}
          ${isCreator ? `<div class="card pad" style="margin-top:12px;padding:14px"><h3 style="font:400 18px var(--serif)">Your creator fees</h3><div class="kv"><span>Claimable</span><b id="t-claimable">…</b></div><button class="btn sm full" id="t-claim" style="margin-top:8px">Claim</button></div>` : ''}
        </div>
        <div class="card rules"><h3>Rules of this market</h3><div class="big"><b>${feeOf(t)}</b><span>fee on every trade, fixed for life</span></div>
          <div class="rbar"><i style="width:${t.creatorShareBps / 100}%"></i></div>
          <div class="kv"><span>To the creator · ${t.creatorShareBps / 100}%</span><b>${fmtUsd(t.feesAll * (t.creatorShareBps / 10000) * APP.hypeUsd)}</b></div>
          <div class="kv"><span>Platform · ${+((100 - t.creatorShareBps / 100) * (1 - BURN_OF_PROTO)).toFixed(1)}%</span><b>${fmtUsd(t.feesAll * (1 - t.creatorShareBps / 10000) * (1 - BURN_OF_PROTO) * APP.hypeUsd)}</b></div>
          <div class="kv"><span>Buys and burns $${esc(sym())} · ${+((100 - t.creatorShareBps / 100) * BURN_OF_PROTO).toFixed(1)}%</span><b>${fmtUsd(t.feesAll * (1 - t.creatorShareBps / 10000) * BURN_OF_PROTO * APP.hypeUsd)}</b></div>
          <div class="kv"><span>All-time high</span><b>${fmtUsd(ath)}</b></div>
          <p>${pp ? `Paired with ${esc(PQ)}, the EQX tokenized ${esc(pp.name)} share: trades and fees are in ${esc(PQ)}, and the issuer can pause or freeze its transfers. ` : ''}Of each fee, paid in ${esc(PQ)}, ${t.creatorShareBps / 100}% goes to the creator and ${100 - t.creatorShareBps / 100}% to the protocol, which keeps ${(1 - BURN_OF_PROTO) * 100}% of it as platform revenue and spends ${BURN_OF_PROTO * 100}% buying $${esc(sym())} and burning it. Anti-snipe: buys in the first ${C.econ.snipeSeconds}s started at ${C.econ.snipeStartBps / 100}% and fell to ${feeOf(t)}. Creator ${esc(shortAddr(t.creator))}.</p></div>
      </aside>
      <div class="tk-bottom">
        <div class="ttabs">${[['trades', 'Trades'], ['holders', `Holders · ${t.holders}`], ['pool', 'Pool']].map(([k, l]) => `<button data-tt="${k}" class="${state.ttab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div id="tbody">${tokenTab(t, trades, holders, pos)}</div>
      </div></div></div>`;
    if (live && state.tokOn === t.addr && $('.tk')) return patchToken(html, t);
    view.innerHTML = html; state.tokOn = t.addr;
    drawChart($('#chart'), t);
    $$('[data-tf]').forEach((b) => b.onclick = () => { state.tf = Number(b.dataset.tf); token(addr); }); $$('[data-cm]').forEach((b) => b.onclick = () => { state.cmode = b.dataset.cm; token(addr); });
    $$('[data-ck]').forEach((b) => b.onclick = () => { state.ckind = b.dataset.ck; token(addr); }); $$('.slipchips [data-s]').forEach((b) => b.onclick = () => { state.slip = Number(b.dataset.s); try { localStorage.setItem('slip', state.slip); } catch {} token(addr); });
    bindTabs(t);
    $$('[data-side]').forEach((b) => b.onclick = () => { state.side = b.dataset.side; token(addr); });
    $('#t-slip').onclick = () => slipDialog(() => token(addr));
    tradePanel(t);
    if (isCreator) { const cr = DATA.creator(me); $('#t-claimable').textContent = hype(cr.pending, 5) + ' (' + usd(cr.pending) + ')'; $('#t-claim').disabled = !(cr.pending > 0); $('#t-claim').onclick = () => act(async () => { const sf = cr.stockFees || [], sh = sf.reduce((s, x) => s + x.hype, 0); const got = await DATA.claim(), h = got - sh; APP.toast('Claimed ' + ([h > 1e-9 ? hype(h, 5) : '', ...sf.map((x) => fmtNum(x.amount, 6) + ' ' + x.sym)].filter(Boolean).join(' and ') || 'your fees'), 'ok'); }, () => token(addr)); }
    bindGo();
  }
  function bindTabs(t) { $$('[data-tt]').forEach((b) => b.onclick = () => { state.ttab = b.dataset.tt; $$('[data-tt]').forEach((x) => x.classList.toggle('on', x === b)); $('#tbody').innerHTML = tokenTab(t, DATA.trades(t.addr), DATA.holders(t.addr), DATA.positions(t.addr)); bindGo(); }); }
  // a live update of the open token page: swap in the new figures, lists and chart data without rebuilding the page,
  // so the trade form, the chart's zoom and the scroll position stay where they are
  function patchToken(html, t) {
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    for (const sel of ['.tband .hd', '.tstats', '.rules', '.ttabs', '#tbody']) { const a = $(sel), b = tmp.querySelector(sel); if (a && b && a.innerHTML !== b.innerHTML) a.innerHTML = b.innerHTML; }
    bindTabs(t); bindGo(); chartUpdate(t);
    const amt = $('#t-amt'); if (amt && amt.value && amt.oninput) amt.oninput();
  }
  function tokenTab(t, trades, holders, pos) {
    if (state.ttab === 'holders') return `<div class="tw"><table class="tb keep"><thead><tr><th>#</th><th>Holder</th><th class="r">Balance</th><th class="r">Share</th></tr></thead><tbody>${holders.slice(0, 50).map((h, i) => `<tr><td class="mute">${i + 1}</td><td>${h.pool ? `<span class="mute">${esc(h.wallet)}</span>` : `<a href="#/profile/${h.wallet}" class="num">${esc(shortAddr(h.wallet))}</a>${h.creator ? ' <span class="pill teal">creator</span>' : ''}`}</td><td class="r num">${fmtNum(h.bal)}</td><td class="r"><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><span class="holdbar" style="width:80px"><i style="width:${Math.min(100, h.share)}%"></i></span><span class="num">${h.share.toFixed(2)}%</span></div></td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">No holders yet.</div></td></tr>'}</tbody></table></div>`;
    if (state.ttab === 'pool') return `<div class="card pad">${pos.map((p) => `<div class="kv"><span>${p.pct}% of supply · ${fmtNum(p.lo)} → ${p.hi === Infinity ? '∞' : fmtNum(p.hi)} ${esc(Q)} mcap</span><b>${p.active ? '<span class="pill teal">price is here</span>' : p.filled >= 1 ? 'passed' : 'ahead'}</b></div>`).join('')}<div class="kv txt"><span>Position IDs</span><b class="num mute">${esc(pos.map((p) => p.id).join(', '))}</b></div><div class="kv"><span>${esc(Q)} in the pool</span><b class="num">${hype(t.liqHype)}</b></div></div>`;
    return `<div class="tw"><table class="tb keep"><thead><tr><th>Side</th><th class="r">Value</th><th class="r">Tokens</th><th>Trader</th><th class="r">Age</th></tr></thead><tbody>${trades.slice(0, 60).map((x) => `<tr><td><span class="${x.buy ? 'up' : 'dn'}" style="font-weight:600">${x.buy ? 'Buy' : 'Sell'}</span>${x.snipeBps ? ' <span class="pill coral">snipe</span>' : x.volBps ? ' <span class="pill">vol</span>' : ''}</td><td class="r num">${fmtUsd(x.hype * APP.hypeUsd)}</td><td class="r num">${fmtNum(x.tokens)}</td><td><a href="#/profile/${x.wallet}" class="num">${esc(shortAddr(x.wallet))}</a> <a href="${APP.explorer('tx', x.tx)}" target="_blank" rel="noopener" class="mute num">↗</a></td><td class="r mute num">${ago(x.ts)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">No trades yet.</div></td></tr>'}</tbody></table></div>`;
  }
  let qseq = 0;
  function tradePanel(t) {
    const amt = $('#t-amt'), recv = $('#t-recv'), recv2 = $('#t-recv2'), bal = $('#t-bal'), go = $('#t-go'); const me = APP.W.connected ? APP.W.address : '';
    const pp = DATA.pairOf(t.addr), PQ = pp ? pp.sym : Q, pusd = (x) => (pp ? fmtUsd(x * pp.usd) : usd(x));
    const myTok = me ? DATA.balance(t.addr, 'hyper', me) : 0, myHype = DATA.hypeBalance();
    bal.textContent = me ? (state.side === 'b' ? `Balance ${fmtNum(myHype, 4)} ${Q}` : `Balance ${fmtNum(myTok)} ${t.symbol}`) : '';
    if (pp && me && state.side === 'b') { bal.textContent = `Balance … ${PQ}`; DATA.pairBalance(t.addr).then((b) => { bal.textContent = `Balance ${fmtNum(b, 4)} ${PQ}`; }).catch(() => { bal.textContent = ''; }); }
    const parse = () => parseFloat((amt.value || '').replace(/[^0-9.]/g, '')) || 0;
    const est = () => { const v = parse(), seq = ++qseq; if (!v) { recv.textContent = '—'; recv2.textContent = state.side === 'b' ? t.symbol : PQ; const mn0 = $('#t-min'); if (mn0) mn0.textContent = '—'; return; } if (state.side === 'b') { const q = DATA.quoteBuy(t.addr, t.net, v); if (seq !== qseq) return; recv.textContent = fmtNum(q.tokens); recv2.textContent = `${t.symbol} · impact ${fmtNum(q.impact, 2)}%`; const mn = $('#t-min'); if (mn) mn.textContent = `${fmtNum(q.tokens * (1 - state.slip / 10000))} ${t.symbol}`; } else { const q = DATA.quoteSell(t.addr, t.net, v); if (seq !== qseq) return; recv.textContent = fmtNum(q.hype, 5); recv2.textContent = `${PQ} · ${pusd(q.hype)}`; const mn = $('#t-min'); if (mn) mn.textContent = `${fmtNum(q.hype * (1 - state.slip / 10000), 5)} ${PQ}`; } };
    amt.oninput = est;
    $$('[data-v]').forEach((b) => b.onclick = () => { amt.value = b.dataset.v; est(); }); $$('[data-p]').forEach((b) => b.onclick = () => { amt.value = String(Math.floor(myTok * Number(b.dataset.p) / 100 * 1e6) / 1e6); est(); });
    go.onclick = () => { if (!APP.W.connected) return APP.W.connect(); const v = parse(); if (!v) return APP.toast('Enter an amount', 'err'); act(async () => { if (state.side === 'b') { const q = DATA.quoteBuy(t.addr, t.net, v); const r = await DATA.buy(t.addr, t.net, v, q.tokens * (1 - state.slip / 10000)); APP.toast(`Bought ${fmtNum(r.tokens)} ${t.symbol}`, 'ok', 5000); } else { const q = DATA.quoteSell(t.addr, t.net, v); const r = await DATA.sell(t.addr, t.net, v, q.hype * (1 - state.slip / 10000)); APP.toast(`Sold for ${fmtNum(r.hype, 5)} ${PQ}`, 'ok', 5000); } }, () => token(t.addr)); };
  }
  function slipDialog(after) { const ov = APP.dialog('Slippage', `<div class="slip">${[50, 100, 300, 500, 1000].map((b) => `<button data-s="${b}" class="${state.slip === b ? 'on' : ''}">${b / 100}%</button>`).join('')}</div><p class="mute" style="margin-top:12px;font-size:13px">Max price move before the trade reverts.</p>`); $$('[data-s]', ov).forEach((b) => b.onclick = () => { state.slip = Number(b.dataset.s); try { localStorage.setItem('slip', state.slip); } catch {} ov.remove(); after && after(); }); }
  async function act(fn, after) { if (state.busy) return; state.busy = true; const btns = $$('#t-go,#c-go,#t-claim,#f-claim,#b-go,.claimbtn'); btns.forEach((b) => { b.disabled = true; b.dataset.t = b.textContent; b.textContent = 'Confirm in your wallet…'; }); try { await fn(); } catch (e) { APP.toast(APP.errMsg(e), 'err', 7000); } state.busy = false; btns.forEach((b) => { b.disabled = false; b.textContent = b.dataset.t; }); if (after) after(); }
  const bindGo = () => { $$('[data-go]').forEach((r) => r.onclick = () => { location.hash = r.dataset.go; }); $$('[data-copy]').forEach((b) => b.onclick = (e) => { e.preventDefault(); APP.copy(b.dataset.copy, 'Address copied'); }); };

  // ---- launch
  const CF = { name: '', symbol: '', image: '', description: '', x: '', telegram: '', website: '', creatorTaxBps: 0, buyback: false, devBuy: '', pair: 'hype' };
  // what a coin pairs with: HYPE, or an EQX tokenized stock (config pairs); USD from Hyperliquid's book
  const PAIRS = () => C.chain.pairs || [{ key: 'hype', sym: Q, name: Q, addr: '0x0000000000000000000000000000000000000000', cfg: 0, decimals: 18, logo: C.chain.logo, kind: 'crypto' }];
  const curPair = () => PAIRS().find((p) => p.key === CF.pair) || PAIRS()[0];
  const pairUsd = (p) => (p.kind === 'stock' ? Number((APP.mids || {})[p.spot] || 0) : APP.hypeUsd);
  function create() {
    const E = C.econ, live = C.live(C.chain);
    const pv = () => { const dev = parseFloat(CF.devBuy) || 0, pp = curPair(), stock = pp.kind === 'stock';
      const send = stock ? `${E.launchFeeHype} ${esc(Q)}${dev ? ` + ${fmtNum(dev, 4)} ${esc(pp.sym)}` : ''}` : `${fmtNum(E.launchFeeHype + dev, 4)} ${esc(Q)}`;
      return `<div class="lsum"><div><span>You send</span><b class="num">${send}</b></div><small>${E.launchFeeHype} ${esc(Q)} launch fee${dev ? ` and your ${fmtNum(dev, 4)} ${esc(pp.sym)} dev buy` : ''}. Opens at ${fmtUsd(E.openMcapHype * APP.hypeUsd)} market cap, paired with ${esc(pp.sym)}.</small></div>
      <button class="btn lg full pri" id="c-go" ${live ? '' : 'disabled'}>${!live ? 'Opens with the Elysium launch' : !APP.W.connected ? 'Connect' : 'Launch'}</button>`; };
    view.innerHTML = `<div class="page"><section class="phero lhero"><div><span class="eyebrow">Launch in one transaction</span><h1 class="disp" style="font-size:52px;margin-top:10px">Mint your <em>token.</em></h1><p class="mute" style="margin-top:8px;max-width:560px;font-size:15px">It creates the token, its pool and the fee routing. Everything is fixed once it is live.</p></div><div class="pa etched">${etch('press')}</div></section>
      <div class="lform" style="margin-top:8px"><div class="card pad form">
        <div style="display:flex;gap:18px;align-items:center"><label class="logo-pick" id="c-pick">${CF.image ? `<img src="${CF.image}" alt="">` : 'Upload<br>image'}<input type="file" id="c-file" accept="image/*" hidden></label><div style="flex:1;display:grid;gap:12px"><div class="fld"><label>Name</label><input class="inp" id="c-name" maxlength="32" placeholder="Name" value="${esc(CF.name)}"></div><div class="fld"><label>Ticker</label><input class="inp" id="c-sym" maxlength="10" placeholder="TICKER" value="${esc(CF.symbol)}"></div></div></div>
        <div class="fld"><label>Description · optional</label><textarea class="inp" id="c-desc" maxlength="256" placeholder="What is it?">${esc(CF.description)}</textarea></div>
        <div class="row2"><div class="fld"><label>X</label><input class="inp" id="c-x" placeholder="https://x.com/…" value="${esc(CF.x)}"></div><div class="fld"><label>Telegram</label><input class="inp" id="c-tg" placeholder="https://t.me/…" value="${esc(CF.telegram)}"></div></div>
        <div class="fld"><label>Website</label><input class="inp" id="c-web" placeholder="https://" value="${esc(CF.website)}"></div>
        <div class="fld"><label>Paired with</label>
          <div class="pgroup"><span class="plab">Crypto</span><div class="pgrid">${PAIRS().filter((p) => p.kind !== 'stock').map((p) => `<button type="button" class="pchip ${CF.pair === p.key ? 'on' : ''}" data-pair="${p.key}"><span class="av"><img src="${esc(p.logo)}" alt=""></span><span><b>${esc(p.sym)}</b><small>Native, default</small></span></button>`).join('')}</div></div>
          ${PAIRS().some((p) => p.kind === 'stock') ? `<div class="pgroup"><span class="plab">Stocks · EQX</span><div class="pgrid">${PAIRS().filter((p) => p.kind === 'stock').map((p) => { const u = pairUsd(p); return `<button type="button" class="pchip ${CF.pair === p.key ? 'on' : ''}" data-pair="${p.key}"><span class="av"><img src="${esc(p.logo)}" alt=""></span><span><b>${esc(p.sym)}</b><small>${esc(p.name)}${u ? ' · ' + fmtUsd(u) : ''}</small></span></button>`; }).join('')}</div></div>` : ''}
          <div class="hint">${curPair().kind === 'stock' ? `Buyers pay in ${esc(curPair().sym)}, and the 2.5% fee is paid in it too: your share arrives as ${esc(curPair().sym)}. EQX tokenized stocks are backed 1:1 by shares; the issuer can pause or freeze transfers, which would stop trading in this pool.` : `Buyers pay in ${esc(Q)}, and fees are paid in ${esc(Q)} too.`}</div></div>
        <div class="row2"><div class="fld"><label>Your fee</label><div class="fixedfee"><b>${pct(E.creatorShareBps)}%</b> of every trade</div><div class="hint">The pool fee is a fixed ${(E.feeBps / 100).toFixed(1)}% on every buy and sell. ${E.creatorShareBps / 100}% of it is yours, ${pct(E.creatorShareBps)}% of every trade.</div></div><div class="fld"><label>Dev buy · ${esc(curPair().sym)}</label><input class="inp" id="c-dev" inputmode="decimal" placeholder="0" value="${esc(CF.devBuy)}"><div class="hint">Your own buy in the launch transaction, at the opening price, before anyone else. Up to ${E.maxDevBuyBps / 100}% of the supply.</div></div></div>
        <div id="c-pv">${pv()}</div>
      </div></div></div>`;
    const bind = (id, k, f) => { const el = $(id); el.oninput = () => { CF[k] = f ? f(el.value) : el.value; refreshPreview(); }; };
    bind('#c-name', 'name', (v) => v.trim()); bind('#c-sym', 'symbol', (v) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10)); bind('#c-desc', 'description'); bind('#c-x', 'x', (v) => v.trim()); bind('#c-tg', 'telegram', (v) => v.trim()); bind('#c-web', 'website', (v) => v.trim()); bind('#c-dev', 'devBuy', (v) => v.replace(/[^0-9.]/g, ''));
    $$('[data-pair]').forEach((b) => b.onclick = () => { CF.pair = b.dataset.pair; create(); }); 
    $('#c-file').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { const im = new Image(); im.onload = () => { const s = Math.min(im.width, im.height), size = Math.min(512, s), cv = document.createElement('canvas'); cv.width = cv.height = size; cv.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, size, size); CF.image = cv.toDataURL('image/webp', .9); create(); }; im.src = rd.result; }; rd.readAsDataURL(f); };
    function refreshPreview() { $('#c-pv').innerHTML = pv(); bindLaunch(); }
    function bindLaunch() { $('#c-go').onclick = () => { if (!APP.W.connected) return APP.W.connect(); if (!CF.name || !CF.symbol) return APP.toast('Name and ticker required', 'err'); if (!CF.image) return APP.toast('Add an image', 'err'); if (/https?:\/\/|www\.|\.[a-z]{2,}\//i.test(CF.description)) return APP.toast('No links in the description', 'err'); act(async () => { const r = await DATA.launch({ name: CF.name, symbol: CF.symbol, image: CF.image, description: CF.description, x: CF.x, telegram: CF.telegram, website: CF.website, creatorTaxBps: CF.creatorTaxBps, buyback: CF.buyback, devBuy: parseFloat(CF.devBuy) || 0, pair: CF.pair }); APP.toast('Launched', 'ok'); Object.assign(CF, { name: '', symbol: '', image: '', description: '', x: '', telegram: '', website: '', creatorTaxBps: 0, buyback: false, devBuy: '', pair: 'hype' }); if (r && r.addr) location.hash = '#/token/' + r.addr; else location.hash = '#/'; }); }; }
    bindLaunch();
  }

  // ---- bridge
  const BS = { amt: '' };
  function bridge(sub) {
    if (!BR) { view.innerHTML = '<div class="page"><div class="empty">No bridge configured.</div></div>'; return; }
    const P = BR.parent, me = APP.W.connected ? APP.W.address : '';
    const hero = `<section class="phero"><div><h1 class="disp">Bridge<span class="h-dot">.</span></h1><p>Bring ${esc(Q)} to Elysium, where Kinex launches and trades: from ${esc(P.name)}, or from almost any coin you hold.</p>${sub ? `<a class="btn sm" href="#/bridge" style="margin-top:14px">← All bridge options</a>` : ''}</div><div class="pa etched">${etch('bridge')}</div></section>`;
    if (!sub) {
      view.innerHTML = `<div class="page">${hero}
        <div class="bcards">
          <a class="bcard" href="#/bridge/any"><div class="route"><div><div class="stack">${[['BTC', 'bitcoin'], ['ETH', 'ethereum'], ['SOL', 'solana'], ['USDT', 'tron'], ['BNB', 'bsc']].map(([c, n]) => cicon(c, n)).join('')}<span class="more">+290</span></div><span class="lab">Any network</span></div><div class="mid"></div><div class="end"><span class="av"><img src="${esc(C.chain.logo)}" alt=""></span><span class="lab">Elysium</span></div></div>
            <span class="eyebrow">Any coin, any network</span><h2>Bridge from any chain</h2><p>Pay with BTC, ETH, SOL, USDT and more, from any wallet or exchange. It arrives as ${esc(Q)} on ${esc(P.name)}, one click from Elysium.</p>
            <div class="facts"><div><span>Coins</span><b>290+</b></div><div><span>Arrives</span><b>~5 min</b></div><div><span>Fee</span><b>in the rate</b></div></div><span class="go arrow">Choose a coin</span></a>
          <a class="bcard" href="#/bridge/hyperevm"><div class="route"><div><span class="av"><img src="${esc(C.chain.logo)}" alt=""></span><span class="lab">${esc(P.name)}</span></div><div class="mid"></div><div class="end"><span class="av"><img src="${esc(C.chain.logo)}" alt=""></span><span class="lab">Elysium</span></div></div>
            <span class="eyebrow">Canonical rollup bridge</span><h2>Bridge from ${esc(P.name)}</h2><p>Already hold ${esc(Q)} on ${esc(P.name)}? Move it through Elysium's own rollup inbox, to the same address.</p>
            <div class="facts"><div><span>Route</span><b>Canonical</b></div><div><span>Arrives</span><b>&lt; 1 min</b></div><div><span>Fee</span><b>None</b></div></div><span class="go arrow">Deposit ${esc(Q)}</span></a>
        </div>
        <div class="bwide"><span class="av"><img src="${esc(C.chain.logo)}" alt=""></span><div><b>Leaving Elysium?</b><p>Withdraw ${esc(Q)} back to ${esc(P.name)}. It is claimable there ${esc(BR.claimDays)} days later, once the rollup has confirmed it.</p></div><a class="btn arrow" href="#/bridge/withdraw">Withdraw</a></div></div>`;
      return;
    }
    if (sub === 'any') { bridgeAny(hero, me); return; }
    const dep = sub !== 'withdraw', from = dep ? P : C.chain, to = dep ? C.chain : P;
    view.innerHTML = `<div class="page">${hero}<div class="bflow"><div class="card pad"><div class="seg" style="margin-bottom:14px"><button class="${dep ? 'on' : ''}" data-bs="hyperevm">Deposit</button><button class="${dep ? '' : 'on'}" data-bs="withdraw">Withdraw</button></div><h2>${dep ? `Bridge from ${esc(P.name)}` : `Withdraw to ${esc(P.name)}`}</h2>
        <div class="bbox" style="margin-top:14px"><div class="lab"><span>From · ${esc(from.name)}</span><span id="b-bal1">Balance —</span></div><div class="row"><input id="b-amt" inputmode="decimal" placeholder="0" value="${esc(BS.amt)}" autocomplete="off"><span class="tok"><span class="av"><img src="${esc(C.chain.logo)}" alt=""></span>${esc(Q)}</span></div><div class="chips" style="margin-top:12px">${['0.5', '1', '10'].map((v) => `<button data-bv="${v}">${v}</button>`).join('')}<button data-bv="max">Max</button></div></div>
        <div class="bbox" style="margin-top:10px"><div class="lab"><span>To · ${esc(to.name)}</span><span id="b-bal2">Same wallet. Balance —</span></div><div class="big" id="b-out">0 ${esc(Q)}</div></div>
        <div class="kv" style="margin-top:12px"><span>You receive</span><b id="b-out2">0 ${esc(Q)}</b></div><div class="kv txt"><span>${dep ? 'Arrives' : 'Claimable'}</span><b>${dep ? 'When Elysium includes it, usually under a minute' : `In ${esc(BR.claimDays)} days`}</b></div><div class="kv txt"><span>${dep ? 'Network fee' : 'Steps'}</span><b>${dep ? 'Shown in your wallet' : 'Start on Elysium, claim on ' + esc(P.name)}</b></div>
        <button class="btn lg full pri" id="b-go" style="margin-top:14px">${!me ? 'Connect' : dep ? 'Deposit' : 'Start withdrawal'}</button>
        ${dep ? '' : `<div class="wlist" id="b-wl"><div class="empty" style="padding:20px">${me ? 'Reading your withdrawals…' : 'Connect to see your withdrawals.'}</div></div>`}</div>
      <aside><div class="card pad steps">${dep ? `<div><i>1</i><div><b>Canonical</b><small>Deposits go through Elysium's own rollup inbox on ${esc(P.name)}, not through a third-party bridge.</small></div></div><div><i>2</i><div><b>Same wallet</b><small>Your address on Elysium is the same as on ${esc(P.name)}, for regular wallets.</small></div></div><div><i>3</i><div><b>No fee</b><small>Only network gas, shown in your wallet.</small></div></div>` : `<div><i>1</i><div><b>Two steps</b><small>Start the withdrawal on Elysium, then claim it on ${esc(P.name)} once the challenge window has passed.</small></div></div><div><i>2</i><div><b>${esc(BR.claimDays)} days</b><small>The rollup confirms Elysium's state on ${esc(P.name)} about twice a day, then waits out the challenge window. Your withdrawal stays listed here until you claim it.</small></div></div>`}<div class="kv" style="margin-top:6px"><span>Inbox on ${esc(P.name)}</span><b><a class="num" href="${P.explorer}/address/${BR.inbox}" target="_blank" rel="noopener">${esc(shortAddr(BR.inbox))} ↗</a></b></div></div></aside></div></div>`;
    $$('[data-bs]').forEach((b) => b.onclick = () => { location.hash = '#/bridge/' + b.dataset.bs; });
    const inp = $('#b-amt'), out = () => { const v = parseFloat(inp.value) || 0; $('#b-out').textContent = `${fmtNum(v, 4)} ${Q}`; $('#b-out2').textContent = `${fmtNum(v, 4)} ${Q}`; BS.amt = inp.value; };
    inp.oninput = out; out(); let bals = null;
    $$('[data-bv]').forEach((b) => b.onclick = () => { const v = b.dataset.bv; inp.value = v === 'max' ? (bals ? String(Math.max(0, (dep ? bals.parent : bals.child) - 0.01)) : '') : v; out(); });
    if (me) { BRIDGE.balances(me).then((b) => { bals = b; const e1 = $('#b-bal1'), e2 = $('#b-bal2'); if (e1) e1.textContent = `Balance ${fmtNum(dep ? b.parent : b.child, 4)} ${Q}`; if (e2) e2.textContent = `Same wallet. Balance ${fmtNum(dep ? b.child : b.parent, 4)} ${Q}`; }).catch(() => {}); }
    $('#b-go').onclick = () => { if (!me) return APP.W.connect(); const v = parseFloat(inp.value) || 0; if (!(v > 0)) return APP.toast('Enter an amount', 'err'); act(async () => { if (dep) await BRIDGE.deposit(v); else await BRIDGE.withdraw(v, me); APP.toast(dep ? `Deposited ${v} ${Q}. It arrives on Elysium when the sequencer includes it.` : `Withdrawal started. Claim it on ${P.name} in ${BR.claimDays} days.`, 'ok', 8000); BS.amt = ''; }, () => bridge(sub)); };
    if (!dep && me) loadWithdrawals(me);
  }
  /* Bridge from any chain: pick a coin, get a deposit address, watch it settle as HYPE on HyperEVM (SideShift, via /api/bridge) */
  const AB = { step: 'pick', coin: null, coins: null, q: '', amount: '', settle: '', refund: '', refundMemo: '', pair: null, perm: null, shift: null, poll: 0, tick: 0 };
  const POPULAR = [['BTC', 'bitcoin', 'Bitcoin'], ['ETH', 'ethereum', 'Ethereum'], ['SOL', 'solana', 'Solana'], ['USDT', 'tron', 'Tron'], ['USDT', 'ethereum', 'Ethereum'], ['BNB', 'bsc', 'BNB Chain'], ['ETH', 'base', 'Base'], ['ETH', 'arbitrum', 'Arbitrum'], ['USDC', 'ethereum', 'Ethereum'], ['USDC', 'solana', 'Solana'], ['XRP', 'ripple', 'XRP Ledger']];
  const NETN = { bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana', tron: 'Tron', bsc: 'BNB Chain', base: 'Base', arbitrum: 'Arbitrum', optimism: 'Optimism', polygon: 'Polygon', avax: 'Avalanche', ripple: 'XRP Ledger', ton: 'TON', hyperevm: 'HyperEVM', zksyncera: 'zkSync', liquid: 'Liquid', litecoin: 'Litecoin', dogecoin: 'Dogecoin', monero: 'Monero', sui: 'Sui', aptos: 'Aptos', stellar: 'Stellar', algorand: 'Algorand', sonic: 'Sonic', arc: 'Arc', robinhood: 'Robinhood Chain', cardano: 'Cardano', polkadot: 'Polkadot', cosmos: 'Cosmos', near: 'NEAR', bch: 'Bitcoin Cash', zcash: 'Zcash', dash: 'Dash', tezos: 'Tezos', kaspa: 'Kaspa', sei: 'Sei', celo: 'Celo', linea: 'Linea', scroll: 'Scroll', blast: 'Blast', mantle: 'Mantle', gnosis: 'Gnosis', fantom: 'Fantom', cronos: 'Cronos', internal: 'Internal' };
  const netName = (n) => NETN[n] || (n ? n[0].toUpperCase() + n.slice(1) : '');
  const cicon = (coin, net) => `<span class="av"><img src="https://sideshift.ai/api/v2/coins/icon/${encodeURIComponent(String(coin).toLowerCase())}-${encodeURIComponent(net)}" alt="" data-sym="${esc(coin)}" data-addr="${esc(coin + net)}" loading="lazy"></span>`;
  const api = async (qs, body) => { const r = await fetch('/api/bridge' + (qs ? '?' + qs : ''), body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined); const j = await r.json().catch(() => ({ error: 'Bridge error' })); if (!r.ok) throw new Error(j.error || 'Bridge error'); return j; };
  const saved = () => { try { return JSON.parse(localStorage.getItem('tide.bridges') || '[]'); } catch { return []; } };
  const save = (sh) => { const l = saved().filter((x) => x.id !== sh.id); l.unshift({ id: sh.id, coin: sh.depositCoin, network: sh.depositNetwork, at: Date.now(), depositAddress: sh.depositAddress, settleAddress: sh.settleAddress, status: sh.status }); try { localStorage.setItem('tide.bridges', JSON.stringify(l.slice(0, 12))); } catch {} };
  const STAGES = [['waiting', 'Waiting for your deposit'], ['pending', 'Deposit seen, confirming'], ['settling', 'Swapping to ' + Q], ['settled', Q + ' sent to your address']];
  const stageIx = (st) => ({ waiting: 0, pending: 1, processing: 2, review: 2, settling: 2, multiple: 1, settled: 3 })[st] ?? -1;
  function bridgeAny(hero, me) {
    clearInterval(AB.poll); clearInterval(AB.tick); AB.poll = AB.tick = 0;
    if (me && !AB.settle) AB.settle = me;
    const P = BR.parent;
    const aside = `<aside><div class="card pad steps"><div><i>1</i><div><b>Nothing to sign</b><small>Send from any wallet or exchange to the address shown. Your Elysium wallet does not need to be connected on the other chain.</small></div></div><div><i>2</i><div><b>Refunded if it fails</b><small>If the swap cannot be completed, the exchange sends your coins back to the refund address you give.</small></div></div><div><i>3</i><div><b>One more click</b><small>${esc(Q)} lands on ${esc(P.name)}; the canonical deposit moves it to Elysium at the same address, with no fee.</small></div></div></div><div class="card pad" id="ab-saved"></div></aside>`;
    const shell = (inner) => { view.innerHTML = `<div class="page">${hero}<div class="bflow"><div class="card pad" id="ab-card">${inner}</div>${aside}</div></div>`; renderSaved(); };
    const head = (sub) => `<div class="abhead"><div class="stack">${POPULAR.slice(0, 3).map(([c, n]) => cicon(c, n)).join('')}</div><div><h2>Bridge from any chain</h2>${sub ? `<p class="mute">${sub}</p>` : ''}</div></div>`;
    if (AB.step === 'pick') {
      shell(`${head('What are you sending?')}
        <div class="cgrid" id="ab-pop">${POPULAR.map(([c, n, label]) => `<button class="ctile" data-pick="${c}|${n}">${cicon(c, n)}<div><b>${esc(c)}</b><small>${esc(label)}</small></div></button>`).join('')}<button class="ctile all" id="ab-all"><span class="av"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></span><div><b>All coins</b><small>200+ on every network</small></div></button></div>
        <div class="absearch" id="ab-search" hidden><input class="inp" id="ab-q" placeholder="Search a coin or network" autocomplete="off"><div class="clist" id="ab-list"><div class="empty" style="padding:18px">Loading the coin list…</div></div></div>
        <p class="mute" style="margin-top:14px;font-size:13px">Your coins are swapped by an exchange partner and settle as ${esc(Q)} to your address on ${esc(P.name)}. Then deposit to Elysium in one click.</p>`);
      $$('[data-pick]').forEach((b) => b.onclick = () => { const [c, n] = b.dataset.pick.split('|'); pickCoin({ coin: c, network: n, name: POPULAR.find((p) => p[0] === c && p[1] === n)?.[2] || netName(n), memo: false }); });
      $('#ab-all').onclick = async () => { const box = $('#ab-search'); box.hidden = false; $('#ab-q').focus(); try { AB.coins = AB.coins || await api('op=coins'); renderList(); } catch (e) { $('#ab-list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; } };
      $('#ab-q').oninput = (e) => { AB.q = e.target.value; renderList(); };
      return;
    }
    if (AB.step === 'form') {
      const c = AB.coin, pr = AB.pair, amt = parseFloat(AB.amount) || 0, out = pr && amt ? amt * Number(pr.rate) : 0;
      shell(`${head()}
        <div class="abcoin"><div class="who">${cicon(c.coin, c.network)}<div><b>${esc(c.coin)} <span class="mute">on ${esc(netName(c.network))}</span></b><small class="mute">${esc(c.name || '')}</small></div></div><button class="btn sm" id="ab-change">Change</button></div>
        <div class="bbox" style="margin-top:14px"><div class="lab"><span>You send · ${esc(netName(c.network))}</span><span id="ab-rate">${pr ? `1 ${esc(c.coin)} ≈ ${fmtNum(Number(pr.rate), 4)} ${esc(Q)}` : 'Fetching rate…'}</span></div><div class="row"><input id="ab-amt" inputmode="decimal" placeholder="0" value="${esc(AB.amount)}" autocomplete="off"><span class="tok">${cicon(c.coin, c.network)}${esc(c.coin)}</span></div><div class="sub"><span id="ab-min">${pr ? `Min ${esc(pr.min)} · Max ${esc(pr.max)} ${esc(c.coin)}` : ''}</span><span>Amount is optional: the rate is set when your deposit arrives</span></div></div>
        <div class="bbox" style="margin-top:10px"><div class="lab"><span>You receive · ${esc(P.name)}</span><span>≈ at today's rate</span></div><div class="big" id="ab-out">${out ? fmtNum(out, 4) : '—'} ${esc(Q)}</div></div>
        <div class="fld" style="margin-top:14px"><label>Receive at · your ${esc(P.name)} address</label><input class="inp mono" id="ab-settle" placeholder="0x…" value="${esc(AB.settle)}" autocomplete="off" spellcheck="false"><div class="hint">${me ? 'Your connected wallet. Elysium uses the same address.' : 'Connect a wallet or paste an EVM address. Elysium uses the same address.'}</div></div>
        <div class="fld" style="margin-top:12px"><label>Refund address on ${esc(netName(c.network))} · recommended</label><input class="inp mono" id="ab-refund" placeholder="Where to send your ${esc(c.coin)} back if the swap fails" value="${esc(AB.refund)}" autocomplete="off" spellcheck="false"></div>
        ${c.memo ? `<div class="fld" style="margin-top:12px"><label>Refund memo · optional</label><input class="inp mono" id="ab-rmemo" value="${esc(AB.refundMemo)}" autocomplete="off"></div>` : ''}
        <div id="ab-perm">${AB.perm && AB.perm.createShift === false ? '<div class="note warn">The exchange partner does not serve your region, so the any-chain bridge is unavailable here. You can still bridge from HyperEVM.</div>' : ''}</div>
        <button class="btn lg full pri" id="ab-go" style="margin-top:14px" ${AB.perm && AB.perm.createShift === false ? 'disabled' : ''}>Get a deposit address</button>
        <p class="terms">The rate includes network fees and the exchange partner's spread. Variable rate: it is fixed when your deposit is confirmed, within the min and max shown.</p>`);
      $('#ab-change').onclick = () => { AB.step = 'pick'; AB.pair = null; bridgeAny(hero, me); };
      const amtEl = $('#ab-amt'); amtEl.oninput = () => { AB.amount = amtEl.value; const a = parseFloat(AB.amount) || 0; $('#ab-out').textContent = `${AB.pair && a ? fmtNum(a * Number(AB.pair.rate), 4) : '—'} ${Q}`; clearTimeout(AB.rt); AB.rt = setTimeout(loadPair, 500); };
      $('#ab-settle').oninput = (e) => { AB.settle = e.target.value.trim(); }; $('#ab-refund').oninput = (e) => { AB.refund = e.target.value.trim(); }; if ($('#ab-rmemo')) $('#ab-rmemo').oninput = (e) => { AB.refundMemo = e.target.value.trim(); };
      $('#ab-go').onclick = async () => {
        if (!/^0x[0-9a-fA-F]{40}$/.test(AB.settle)) return APP.toast('Enter the EVM address that should receive ' + Q, 'err');
        if (!AB.refund && !confirm('No refund address. If the swap fails, the exchange will ask for one on its order page. Continue?')) return;
        const b = $('#ab-go'); b.disabled = true; b.textContent = 'Creating your deposit address…';
        try { const sh = await api('', { depositCoin: c.coin.toLowerCase(), depositNetwork: c.network, settleAddress: AB.settle, refundAddress: AB.refund || undefined, refundMemo: AB.refundMemo || undefined }); AB.shift = sh; save(sh); AB.step = 'deposit'; bridgeAny(hero, me); }
        catch (e) { APP.toast(e.message, 'err', 7000); b.disabled = false; b.textContent = 'Get a deposit address'; }
      };
      if (!AB.pair) loadPair(); if (!AB.perm) api('op=permissions').then((p) => { AB.perm = p; if (p.createShift === false && AB.step === 'form') bridgeAny(hero, me); }).catch(() => {});
      return;
    }
    // deposit: the address, the QR, the live status
    const sh = AB.shift, c = AB.coin || { coin: sh.depositCoin, network: sh.depositNetwork }, ix = stageIx(sh.status), bad = /refund|expired/.test(sh.status);
    shell(`${head()}
      <div class="abcoin"><div class="who">${cicon(c.coin, c.network)}<div><b>Send ${esc(c.coin)} <span class="mute">on ${esc(netName(c.network))}</span></b><small class="mute">Order ${esc(sh.id)} · ${bad ? '' : 'expires in '}<span id="ab-exp">${bad ? sh.status : '…'}</span></small></div></div><button class="btn sm" id="ab-new">New bridge</button></div>
      <div class="depbox"><div class="qr" id="ab-qr"></div><div class="dep"><span class="lab">Deposit address</span><div class="addr num" id="ab-addr">${esc(sh.depositAddress || '—')}</div><div class="acts"><button class="btn" data-copy="${esc(sh.depositAddress || '')}">${ICON.copy} Copy address</button></div>${sh.depositMemo ? `<span class="lab" style="margin-top:12px">Memo · required</span><div class="addr num">${esc(sh.depositMemo)}</div><div class="acts"><button class="btn" data-copy="${esc(sh.depositMemo)}">${ICON.copy} Copy memo</button></div>` : ''}<div class="kv txt" style="margin-top:12px"><span>Amount</span><b>Between ${esc(sh.depositMin || '?')} and ${esc(sh.depositMax || '?')} ${esc(c.coin)}, one deposit. Send only ${esc(c.coin)} on ${esc(netName(c.network))}.</b></div><div class="kv txt"><span>${esc(Q)} arrives at</span><b class="num">${esc(sh.settleAddress)}</b></div></div></div>
      <ol class="timeline" id="ab-tl">${STAGES.map(([k, label], i) => `<li class="${i < ix ? 'done' : i === ix ? 'now' : ''}"><i></i><span>${esc(label)}</span></li>`).join('')}</ol>
      <div id="ab-result">${resultHtml(sh)}</div>`);
    $('#ab-new').onclick = () => { AB.step = 'pick'; AB.shift = null; AB.pair = null; AB.amount = ''; bridgeAny(hero, me); };
    bindGo(); drawQr(sh.depositAddress);
    const exp = () => { const el = $('#ab-exp'); if (!el || !sh.expiresAt || bad) return; const ms = new Date(sh.expiresAt) - Date.now(); if (ms <= 0) { el.textContent = 'expired'; return; } const m = Math.floor(ms / 60000), s_ = Math.floor(ms % 60000 / 1000); el.textContent = `${m}:${String(s_).padStart(2, '0')}`; };
    exp(); AB.tick = setInterval(exp, 1000);
    const poll = async () => { try { const n = await api('op=status&id=' + encodeURIComponent(sh.id)); AB.shift = Object.assign(sh, n); save(sh); const nix = stageIx(sh.status), nb = /refund|expired/.test(sh.status); $$('#ab-tl li').forEach((li, i) => { li.className = i < nix ? 'done' : i === nix ? 'now' : ''; }); $('#ab-result').innerHTML = resultHtml(sh); if (nb) { $('#ab-exp').textContent = sh.status; } if (sh.status === 'settled' || nb) { clearInterval(AB.poll); clearInterval(AB.tick); } renderSaved(); } catch {} };
    AB.poll = setInterval(poll, 8000);
    function resultHtml(s) {
      if (s.status === 'settled') { const amt = s.settleAmount || ''; return `<div class="note ok"><b>${amt ? fmtNum(Number(amt), 4) + ' ' + esc(Q) : esc(Q)} arrived on ${esc(P.name)}.</b> ${s.settleHash ? `<a href="${esc(BRIDGE.explorerTx(P, s.settleHash))}" target="_blank" rel="noopener">View ↗</a>` : ''}<div class="acts" style="margin-top:12px"><a class="btn pri arrow" href="#/bridge/hyperevm" id="ab-toelys">Deposit it to Elysium</a></div></div>`; }
      if (/refund/.test(s.status)) return `<div class="note warn"><b>This bridge is being refunded.</b> ${s.issue ? esc(s.issue) + '. ' : ''}Your ${esc(c.coin)} goes back to the refund address${s.refundAddress ? '' : ', which the exchange will ask you for on its order page: <a href="https://sideshift.ai/orders/' + esc(s.id) + '" target="_blank" rel="noopener">open it ↗</a>'}.</div>`;
      if (s.status === 'expired') return `<div class="note warn"><b>This deposit address expired.</b> Nothing was sent to it. Start a new bridge to get a fresh address.</div>`;
      if (s.status === 'waiting') return `<div class="note">Waiting for your deposit. Keep this page open, or come back later: your bridges are listed on the right.</div>`;
      return `<div class="note">Deposit of ${esc(s.depositAmount || '')} ${esc(c.coin)} seen. Swapping to ${esc(Q)}, usually within a few minutes.</div>`;
    }
    function drawQr(text) { const el = $('#ab-qr'); if (!el || !text) return; const go = () => { try { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch { el.innerHTML = ''; } }; if (window.qrcode) return go(); const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; sc.onload = go; document.head.appendChild(sc); }
    async function loadPair() { const c = AB.coin; const el = $('#ab-rate'); if (el) el.textContent = 'Fetching rate…'; try { const a = parseFloat(AB.amount) || 0; const pr = await api(`op=pair&from=${encodeURIComponent(c.coin.toLowerCase() + '-' + c.network)}${a ? '&amount=' + a : ''}`); if (AB.coin !== c) return; AB.pair = pr; const r = $('#ab-rate'), m = $('#ab-min'), o = $('#ab-out'); if (r) r.textContent = `1 ${c.coin} ≈ ${fmtNum(Number(pr.rate), 4)} ${Q}`; if (m) m.textContent = `Min ${pr.min} · Max ${pr.max} ${c.coin}`; if (o) o.textContent = `${a ? fmtNum(a * Number(pr.rate), 4) : '—'} ${Q}`; } catch (e) { const r = $('#ab-rate'); if (r) r.textContent = e.message; } }
    function pickCoin(c) { AB.coin = c; AB.pair = null; AB.step = 'form'; bridgeAny(hero, me); }
    function renderList() { const el = $('#ab-list'); if (!el || !AB.coins) return; const q = AB.q.trim().toLowerCase(); const l = AB.coins.filter((c) => !q || c.coin.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q) || netName(c.network).toLowerCase().includes(q)).slice(0, 60); el.innerHTML = l.length ? l.map((c) => `<button class="crow" data-ci="${esc(c.coin)}|${esc(c.network)}">${cicon(c.coin, c.network)}<b>${esc(c.coin)}</b><span class="mute">${esc(c.name || '')}</span><small>${esc(netName(c.network))}</small></button>`).join('') : '<div class="empty" style="padding:18px">No coin matches.</div>'; $$('[data-ci]').forEach((b) => b.onclick = () => { const [coin, network] = b.dataset.ci.split('|'); pickCoin(AB.coins.find((c) => c.coin === coin && c.network === network)); }); }
    function renderSaved() { const el = $('#ab-saved'); if (!el) return; const l = saved(); if (!l.length) { el.innerHTML = `<h3>Your bridges</h3><p class="mute" style="font-size:13px;margin-top:6px">Bridges you start here are listed on this device, so you can come back to one.</p>`; return; } el.innerHTML = `<h3>Your bridges</h3><div class="wlist">${l.map((x) => `<button class="wrow" data-open="${esc(x.id)}">${cicon(x.coin, x.network)}<div><b>${esc(x.coin)} → ${esc(Q)}</b><small class="mute">${esc(ago(Math.floor(x.at / 1000)))} · ${esc(shortAddr(x.settleAddress || ''))}</small></div><span class="pill ${x.status === 'settled' ? 'teal' : /refund|expired/.test(x.status) ? 'coral' : ''}">${esc(x.status || 'waiting')}</span></button>`).join('')}</div>`; $$('[data-open]').forEach((b) => b.onclick = async () => { const x = saved().find((s) => s.id === b.dataset.open); if (!x) return; b.disabled = true; try { const sh = await api('op=status&id=' + encodeURIComponent(x.id)); AB.shift = Object.assign({ depositAddress: x.depositAddress, settleAddress: x.settleAddress }, sh); AB.coin = { coin: x.coin, network: x.network }; AB.step = 'deposit'; bridgeAny(hero, me); } catch (e) { APP.toast(e.message, 'err'); b.disabled = false; } }); }
  }
  async function loadWithdrawals(me) {
    const el = $('#b-wl'); if (!el) return;
    try {
      const { items, checkpoint } = await BRIDGE.withdrawals(me); const P = BR.parent;
      el.innerHTML = `<div class="kv txt"><span>Your withdrawals</span><b>${checkpoint ? `confirmed up to #${checkpoint.sendCount} · ${ago(checkpoint.ts)}` : 'confirmation state unavailable'}</b></div>${items.map((w, i) => `<div class="it"><div><b>${hype(w.hype, 4)}</b><br><small>${fmtDate(w.timestamp)} · #${w.position} · <a href="${APP.explorer('tx', w.tx)}" target="_blank" rel="noopener">tx ↗</a></small></div><div class="st">${w.stage === 'claimed' ? '<span class="pill teal">claimed</span>' : w.stage === 'ready' ? `<button class="btn sm pri claimbtn" data-cl="${i}">Claim on ${esc(P.name)}</button>` : '<span class="pill">waiting for confirmation</span>'}</div></div>`).join('') || '<div class="empty" style="padding:16px">No withdrawals from this wallet.</div>'}`;
      $$('[data-cl]', el).forEach((b) => b.onclick = () => act(async () => { await BRIDGE.claim(items[+b.dataset.cl]); APP.toast('Claimed on ' + P.name, 'ok', 6000); }, () => loadWithdrawals(me)));
    } catch (e) { el.innerHTML = `<div class="empty" style="padding:16px">Could not read withdrawals: ${esc(APP.errMsg(e))}</div>`; }
  }

  // ---- flywheel
  function flywheel() {
    const ts = DATA.tokens(), fly = (DATA.raw() || {}).flywheel, tide = ST.token ? DATA.token(low(ST.token)) : null, px = tide ? tide.pxUsd : 0, S = C.econ.supply, T = sym();
    const proto = ts.reduce((a, t) => a + t.feesAll * (1 - t.creatorShareBps / 10000), 0), own = tide ? tide.feesAll * (tide.creatorShareBps / 10000) : 0, bb = (ST.burnBps || 0) / 100;
    const spent = fly ? fly.burnedQuote : 0, burned = fly ? fly.burnedTokens : 0, queued = fly ? fly.toBuyback - fly.burnedQuote : 0, burns = fly ? fly.events.filter((e) => e.kind === 'burn') : [];
    const range = state.fwr || 'all', now = Math.floor(Date.now() / 1000), span = range === '1d' ? 86400 : range === '7d' ? 7 * 86400 : range === '30d' ? 30 * 86400 : Infinity, inRange = burns.filter((e) => now - e.ts <= span);
    view.innerHTML = `<div class="page"><section class="phero"><div><h1 class="disp">Flywheel<span class="h-dot">.</span></h1><p>Every trade pays a fixed ${(C.econ.feeBps / 100).toFixed(1)}% in ${esc(Q)}. ${pct(C.econ.creatorShareBps)}% of volume goes to the creator of the token that was traded; the protocol's ${pct(C.econ.protocolShareBps)}% splits in two: ${SPL.burn}% buys $${esc(T)} and burns it, ${SPL.plat}% is platform revenue.</p></div><div class="pa etched">${etch('wheel')}</div></section>
      <div class="sec"><h2>Fees into $${esc(T)}</h2><span class="ln"></span></div>
      <div class="fwgrid"><div><div class="fcard"><div class="lab"><span>Protocol fees</span><span class="pill teal">${bb}% to buybacks</span></div><div class="v"><b>${fmtNum(proto, 3)} ${esc(Q)}</b><span>${fmtUsd(proto * APP.hypeUsd)}</span></div><small>${C.econ.protocolShareBps / 100}% of every fee, from ${ts.length} launches</small></div><div class="fcard"><div class="lab"><span>$${esc(T)}'s own fees</span><span class="pill teal">creator side</span></div><div class="v"><b>${fmtNum(own, 3)} ${esc(Q)}</b><span>${fmtUsd(own * APP.hypeUsd)}</span></div><small>Its pool's whole creator side belongs to the protocol</small></div></div>
        <div class="mid">Buys $${esc(T)}</div>
        <div><div class="fcard"><div class="lab"><span>Spent buying $${esc(T)}</span></div><div class="v"><b>${fmtNum(spent, 3)} ${esc(Q)}</b><span>${fmtUsd(spent * APP.hypeUsd)}</span></div><small>${fmtNum(burned)} ${esc(T)} over ${burns.length} buybacks · ${hype(Math.max(0, queued), 4)} queued</small></div><div class="fcard"><div class="lab"><span>$${esc(T)} burned</span><span class="pill coral">all of it</span></div><div class="v"><b>${fmtNum(burned)} ${esc(T)}</b><span>${px ? fmtUsd(burned * px) : '—'}</span></div><small>${(burned / S * 100).toFixed(3)}% of the supply, at today's price</small></div></div></div>
      <div class="sec"><h2>Buybacks and burns</h2><span class="ln"></span><div class="r"><div class="seg sm">${['1d', '7d', '30d', 'all'].map((k) => `<button data-fwr="${k}" class="${range === k ? 'on' : ''}">${k.toUpperCase()}</button>`).join('')}</div></div></div>
      <div class="charts"><div class="chartc"><h3>$${esc(T)} burned</h3><small>Running total of the supply destroyed, every burn counted.</small><div class="v up">${fmtNum(burned)} ${esc(T)} <span class="mute">burned to date</span></div><canvas id="fw-burn"></canvas></div><div class="chartc"><h3>Buyback spend</h3><small>${esc(Q)} from the protocol's share, spent buying $${esc(T)} on the open market.</small><div class="v">${fmtNum(spent, 3)} ${esc(Q)} <span class="mute">since launch</span></div><canvas id="fw-spend"></canvas></div></div>
      <div class="lists"><div class="card"><h3 style="padding:14px 16px;font:400 20px var(--serif)">Latest buybacks</h3><div class="vl">${inRange.slice(0, 12).map((e) => `<a href="${APP.explorer('tx', e.tx)}" target="_blank" rel="noopener"><span>${fmtNum(e.quote, 4)} <span class="mute">${esc(Q)}</span> → ${fmtNum(e.tokens)} <span class="mute">${esc(T)}</span></span><span class="t">${ago(e.ts)} · tx ↗</span><b class="v up">${fmtUsd(e.quote * APP.hypeUsd)}</b></a>`).join('') || '<div class="empty">No buybacks yet.</div>'}</div></div>
        <div class="card"><h3 style="padding:14px 16px;font:400 20px var(--serif)">Burns</h3><div class="vl">${inRange.slice(0, 12).map((e) => `<a href="${APP.explorer('tx', e.tx)}" target="_blank" rel="noopener"><span>${fmtNum(e.tokens)} <span class="mute">${esc(T)}</span> <span class="pill">buyback</span></span><span class="t">${ago(e.ts)} · tx ↗</span></a>`).join('') || '<div class="empty">No burns yet.</div>'}</div></div></div>
      <div class="sec"><h2>Where the fee goes</h2><span class="ln"></span></div>
      <div class="card pad"><div class="adsplit two"><div><span>${pct(C.econ.creatorShareBps)}% <small>of every trade · creator side</small></span><div class="tiles two"><div class="tile"><b>Creator</b><small>Paid to the creator of the token, claimable any time on the Fees page.</small></div><div class="tile"><b>Every trade</b><small>The share is the same on every coin and never changes, whatever the price does.</small></div></div></div><div><span>${pct(C.econ.protocolShareBps)}% <small>of every trade · protocol</small></span><div class="tiles two"><div class="tile"><b>${bb}% buys $${esc(T)} and burns it</b><small>${bb === 50 ? 'Half' : bb + '%'} of the protocol's share, ${SPL.burn}% of every trade, goes back into the market of the platform token.</small></div><div class="tile"><b>${100 - bb}% platform revenue</b><small>${SPL.plat}% of every trade. Runs the keeper, the indexer and the site.</small></div></div></div></div></div>
      <div class="card calc"><h3>Run the numbers</h3><p class="mute" style="font-size:13px;margin-top:4px">Where 1,000 ${esc(Q)} of volume goes. The fee is fixed, so the split is the same on every token.</p><div class="out" id="fw-out"></div></div></div>`;
    const cum = []; let acc = 0; const sorted = [...burns].sort((a, b) => a.ts - b.ts); for (const e of sorted) { acc += e.tokens; cum.push(acc); }
    const buckets = 24, sp = new Array(buckets).fill(0); if (sorted.length) { const t0 = sorted[0].ts, step = Math.max(1, (now - t0) / buckets); for (const e of sorted) sp[Math.min(buckets - 1, Math.floor((e.ts - t0) / step))] += e.quote; }
    area($('#fw-burn'), cum.length ? cum : [0, 0], '#128a5e'); area($('#fw-spend'), sp, '#17b595', { bars: true });
    $$('[data-fwr]').forEach((b) => b.onclick = () => { state.fwr = b.dataset.fwr; flywheel(); });
    const calc = () => { const fee = C.econ.feeBps / 100, vol = 1000, total = vol * fee / 100, creator = total * C.econ.creatorShareBps / 10000, pro = total * C.econ.protocolShareBps / 10000; $('#fw-out').innerHTML = `<div><span>Fee</span><b>${fee.toFixed(1)}% · ${fmtNum(total, 2)} ${esc(Q)}</b></div><div><span>Creator · ${(fee * C.econ.creatorShareBps / 10000).toFixed(2)}% of volume</span><b>${fmtNum(creator, 2)} ${esc(Q)}</b></div><div><span>Buys and burns $${esc(T)} · ${SPL.burn}% of volume</span><b>${fmtNum(pro * BURN_OF_PROTO, 2)} ${esc(Q)}</b></div><div><span>Platform · ${SPL.plat}% of volume</span><b>${fmtNum(pro * (1 - BURN_OF_PROTO), 2)} ${esc(Q)}</b></div>`; }; calc();
  }

  // ---- fees (creators)
  // creator fees: the claim card and the per-token table, on the profile's Fees tab (and the old #/fees route)
  function feesPanel(cr, me) {
    const mine = cr.tokens || [], sf = me ? cr.stockFees || [] : [], can = me && (cr.pending > 0 || sf.length), hypeOnly = Math.max(0, cr.pending - sf.reduce((a, x) => a + x.hype, 0)), sfUsd = sf.reduce((a, x) => a + x.usd, 0);
    const head = hypeOnly > 1e-12 || !sf.length ? hype(hypeOnly, 5) : fmtUsd(sfUsd), approx = (t) => (DATA.pairOf(t.addr) ? '≈ ' : '');
    return `<div class="grid2" style="margin-top:10px"><div class="card pad"><span class="eyebrow">${me ? 'Claimable now' : 'Unclaimed'}</span><div class="adres" style="border:0;padding:0;margin-top:10px"><b>${head}</b><small>${hypeOnly > 1e-12 && sf.length ? 'plus the stock fees below · ' : ''}${usd(cr.pending)} in all, across ${mine.length} token${mine.length === 1 ? '' : 's'} · ${hype(cr.lifetime, 4)} earned all time</small></div>${sf.length ? `<div class="stkfees">${sf.map((x) => `<div><span>${esc(x.sym)}</span><b class="num">${fmtNum(x.amount, 6)} ${esc(x.sym)}</b><small>${x.usd ? fmtUsd(x.usd) : ''}</small></div>`).join('')}<p class="mute">Fees from stock-paired coins are paid in the stock itself.</p></div>` : ''}${me ? `<button class="btn lg full pri" id="f-claim" style="margin-top:18px" ${can ? '' : 'disabled'}>${can ? 'Claim to my wallet' : 'Nothing to claim yet'}</button>` : ''}<p class="mute" style="font-size:12.5px;margin-top:12px">${pct(C.econ.creatorShareBps)}% of every trade on a token goes to its creator, in ${esc(Q)} or in the pair stock.</p></div>
      <div class="card"><div class="tw"><table class="tb keep"><thead><tr><th>Token</th><th class="r">Earned</th><th class="r">Pending</th></tr></thead><tbody>${mine.map((t) => `<tr class="link" data-go="${link(t)}"><td><div class="who"><span class="av">${APP.img(t)}</span><div><b>${esc(t.name)}</b><small>$${esc(t.symbol)} · ${feeOf(t)} fee</small></div></div></td><td class="r num">${approx(t)}${hype(t.creatorFees || 0, 4)}</td><td class="r num">${approx(t)}${hype(t.pending || 0, 4)}</td></tr>`).join('') || `<tr><td colspan="3"><div class="empty">${me ? 'You have not launched a token yet.' : 'No launches yet.'}</div></td></tr>`}</tbody></table></div></div></div>`;
  }
  function bindFees(cr, again) {
    const b = $('#f-claim'); if (b) b.onclick = () => act(async () => { const sf = cr.stockFees || [], sh = sf.reduce((s, x) => s + x.hype, 0); const got = await DATA.claim(), h = got - sh; APP.toast('Claimed ' + ([h > 1e-9 ? hype(h, 5) : '', ...sf.map((x) => fmtNum(x.amount, 6) + ' ' + x.sym)].filter(Boolean).join(' and ') || 'your fees'), 'ok'); }, again);
    if (DATA.refreshStockFees && !bindFees.fresh) { bindFees.fresh = true; DATA.refreshStockFees().then((ch) => { if (ch && !state.busy && ['profile', 'fees'].includes(state.route)) again(); }).catch(() => {}).finally(() => { bindFees.fresh = false; }); }
  }
  function fees() { state.ptab = 'fees'; profile(); }


  // ---- profile
  function profile(addr) {
    const w = low(addr || (APP.W.connected ? APP.W.address : '')); if (!w) { view.innerHTML = `<div class="page prof"><h1>Profile</h1><div class="empty"><button class="btn pri" id="pf-conn">Connect a wallet</button></div></div>`; $('#pf-conn').onclick = APP.W.connect; return; }
    const wv = DATA.wallet(w), cr = DATA.creator(w), me = APP.W.connected && low(APP.W.address) === w, tab = state.ptab || ((cr.tokens || []).length ? 'fees' : 'holdings');
    const val = wv.holdings.reduce((s, h) => s + h.usd, 0);
    view.innerHTML = `<div class="page prof"><div class="head"><div><h1 title="${esc(w)}">${esc(shortAddr(w))}</h1><div class="mute" style="font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="num">${esc(w)}</span><button class="ib" style="width:26px;height:26px;border-radius:5px" data-copy="${w}">${ICON.copy}</button><a href="${APP.explorer('address', w)}" target="_blank" rel="noopener">${ICON.ext}</a>${wv.joined ? `<span>since ${new Date(wv.joined * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>` : ''}</div></div></div>
      <div class="grid4"><div class="stat"><span>Holdings</span><b>${fmtUsd(val)}</b><small>${wv.holdings.length} assets</small></div><div class="stat"><span>Launched</span><b>${wv.launches.length}</b><small>tokens created</small></div><div class="stat"><span>Creator fees</span><b>${usd(cr.lifetime)}</b><small>lifetime, ${usd(cr.pending)} claimable</small></div><div class="stat"><span>Trades</span><b>${wv.activity.filter((a) => a.kind !== 'launch').length}</b><small>all time</small></div></div>
      ${me && cr.pending > 0 && tab !== 'fees' ? `<div class="bwide"><div><b>Creator fees waiting</b><p>${hype(cr.pending, 5)} across your tokens</p></div><button class="btn pri arrow" data-pt="fees">See and claim</button></div>` : ''}
      <div class="ttabs">${[['fees', 'Fees'], ['holdings', 'Holdings'], ['activity', 'Activity'], ['launches', 'Launches']].map(([k, l]) => `<button data-pt="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${tab === 'fees' ? feesPanel(cr, me) : `<div class="card" style="margin-top:10px"><div class="tw">${tab === 'holdings' ? `<table class="tb keep"><thead><tr><th>Asset</th><th class="r">Balance</th><th class="r">Value</th></tr></thead><tbody>${wv.holdings.map((h) => `<tr class="${h.native ? '' : 'link'}" ${h.native ? '' : `data-go="${link(h.token)}"`}><td><div class="who"><span class="av">${h.native ? `<img src="${esc(C.chain.logo)}" alt="">` : APP.img(h.token)}</span><div><b>${h.native ? esc(Q) : esc(h.token.name)}</b><small>${h.native ? 'native' : esc(h.token.symbol)}</small></div></div></td><td class="r num">${fmtNum(h.bal, 4)}</td><td class="r num">${fmtUsd(h.usd)}</td></tr>`).join('') || '<tr><td colspan="3"><div class="empty">Nothing here yet.</div></td></tr>'}</tbody></table>`
        : tab === 'activity' ? `<table class="tb keep"><thead><tr><th>Age</th><th>Token</th><th>Action</th><th class="r">Amount</th></tr></thead><tbody>${wv.activity.slice(0, 80).map((a) => `<tr class="link" data-go="${link(a.token)}"><td class="mute num">${ago(a.ts)}</td><td><div class="who"><span class="av" style="width:28px;height:28px">${APP.img(a.token)}</span><b>${esc(a.token.symbol)}</b></div></td><td class="${a.kind === 'buy' ? 'up' : a.kind === 'sell' ? 'dn' : 'teal'}">${a.kind === 'launch' ? 'Launched' : a.kind === 'buy' ? 'Buy' : 'Sell'}</td><td class="r num">${a.kind === 'launch' ? '' : fmtNum(a.tokens) + ' · ' + fmtUsd(a.usd)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">No activity yet.</div></td></tr>'}</tbody></table>`
        : `<table class="tb mkt"><thead><tr><th>#</th><th>Token</th><th>Last 24h</th><th class="r">24h</th><th class="r">Cap</th><th class="r">Vol</th><th class="r">Holders</th><th class="r">Fee</th></tr></thead><tbody>${wv.launches.map(coinRow).join('') || '<tr><td colspan="8"><div class="empty">No launches yet.</div></td></tr>'}</tbody></table>`}</div></div>`}</div>`;
    $$('[data-pt]').forEach((b) => b.onclick = () => { state.ptab = b.dataset.pt; profile(addr); }); bindGo(); drawSparks(DATA.tokens());
    if (tab === 'fees') bindFees(cr, () => profile(addr));
  }

  // ---- airdrop: the mechanism, points from every trade and launch
  let adTimer = null;
  function adPoints() {
    const ts = DATA.tokens(), pts = new Map(), vol = new Map(), add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
    for (const t of ts) for (const x of DATA.trades(t.addr)) { const w = low(x.wallet); add(vol, w, x.hype); if (t.creator && low(t.creator) !== w) add(pts, low(t.creator), x.hype * AD.creatorPts); }
    for (const [w, h] of vol) if (h >= AD.minHype) add(pts, w, h * AD.tradePts);
    const rows = [...pts.entries()].map(([w, p]) => ({ w, p, h: vol.get(w) || 0 })).sort((a, b) => b.p - a.p);
    return { rows, total: rows.reduce((s, r) => s + r.p, 0), vol };
  }
  function airdrop() {
    if (!AD) { view.innerHTML = '<div class="page"><div class="empty">No airdrop configured.</div></div>'; return; }
    const S = sym(), tok = ST.token ? DATA.token(low(ST.token)) : null, px = tok ? tok.pxUsd : 0, supply = C.econ.supply;
    const totalPct = AD.pools.reduce((s, p) => s + p.pct, 0), totalTok = supply * totalPct / 100, main = AD.pools[0], mainTok = supply * main.pct / 100, pOther = AD.pools[1] || { pct: 0 }, pHold = AD.pools[2] || { pct: 0 };
    const { rows, total } = adPoints(), me = APP.W.connected ? low(APP.W.address) : '', ends = new Date(AD.ends).getTime(), live = Date.now() < ends;
    const tokOf = (p) => (total ? p / total * mainTok : 0), usdOf = (n) => (px ? fmtUsd(n * px) : fmtNum(n) + ' ' + S), perHype = total ? AD.tradePts / total * mainTok : mainTok / AD.tradePts;
    const dstr = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tstr = (iso) => new Date(iso).toISOString().slice(11, 16);
    const rank = (i) => `<div class="pod r${i + 1}"><span class="n">${i + 1}</span>${rows[i] ? `<b>${usdOf(tokOf(rows[i].p))}</b><small>${fmtNum(tokOf(rows[i].p))} ${esc(S)}</small><a class="num" href="#/profile/${rows[i].w}">${esc(shortAddr(rows[i].w))}</a>` : '<small>open</small>'}</div>`;
    const share = (w) => { const r = rows.find((x) => x.w === low(w)); if (!r) return `<div class="adres"><b class="dim">$—</b><small>No points yet for this address. Trade at least ${AD.minHype} ${esc(Q)} and they go live.</small></div>`; const i = rows.indexOf(r); return `<div class="adres"><b>${usdOf(tokOf(r.p))}</b><small>${fmtNum(tokOf(r.p))} ${esc(S)} · ${fmtNum(r.p)} points · rank ${i + 1} of ${rows.length} · ${hype(r.h, 2)} traded on Kinex</small></div>`; };
    const poolUsd = (p) => (px ? fmtUsd(supply * p.pct / 100 * px) : p.pct + '%');
    const words = ['', 'ten', 'twenty', 'thirty', 'forty', 'fifty'][Math.round(totalPct / 10)] || String(totalPct);
    view.innerHTML = `<div class="page ad">
      <section class="dark adhero">${art(8, 1200, 520)}${window.ART ? ART.ribbon(`Kinex airdrop · ${words} percent of supply`, 10).replace('class="ribbon"', 'class="ribbon dark" style="position:absolute;left:0;right:0;top:0"') : ''}
        <div class="in" style="position:relative"><span class="eyebrow" style="color:var(--mint)">The $${esc(S)} airdrop</span><h1>${px ? fmtUsd(totalTok * px) : fmtNum(totalTok)}</h1><p>In $${esc(S)}, for everyone who trades on Elysium. ${totalPct}% of the supply, ${fmtNum(totalTok)} tokens.</p>
          <div class="cd"><span>${live ? 'Ends' : 'Ended'} ${dstr(AD.ends)}, ${tstr(AD.ends)} UTC</span><b id="ad-cd">—</b></div><a class="btn cta arrow" href="#ad-check" id="ad-jump">Check eligibility</a></div>
        <div class="r" style="position:relative"><h2>The biggest airdrops</h2><small>Preliminary, and every trade can reorder them.</small><div class="podium">${rank(1)}${rank(0)}${rank(2)}</div></div></section>
      <div class="grid2 adg">
        <section class="card" id="ad-check"><h2>What's your share?</h2><p class="mute">Paste any address to see its airdrop. Nothing to connect, nothing to sign.</p>
          <div class="adin"><input class="inp" id="ad-addr" placeholder="Paste a wallet address" value="${esc(me)}" autocomplete="off"><span class="mute" style="align-self:center;font-size:12px">or</span><button class="btn pri" id="ad-conn">${me ? 'Connected' : 'Connect'}</button></div>
          <p class="mute" style="font-size:13px">At today's totals, 1 ${esc(Q)} traded on Kinex earns about <b class="num" style="color:var(--ink)">${fmtNum(perHype)} ${esc(S)}</b>${px ? ` (${fmtUsd(perHype * px)})` : ''}. It drops as more people trade.</p>
          <div id="ad-res">${me ? share(me) : '<div class="adres"><b class="dim">$—</b><small>Your preliminary estimate shows here.</small></div>'}</div></section>
        <section class="card"><h2>Where it goes</h2><div class="adsplit">${AD.pools.map((p) => `<div><span>${p.pct}%</span><small>${esc(p.title.replace('Kinex ', ''))}</small></div>`).join('')}</div><div class="wave">${AD.pools.map((p, i) => `<i style="width:${p.pct / totalPct * 100}%;background:${['var(--acc2)', 'var(--acc)', 'var(--mint)'][i] || 'var(--s3)'}"></i>`).join('')}</div>
          ${AD.pools.map((p) => `<div class="adpool"><div class="amt"><b>${poolUsd(p)}</b><small>${fmtNum(supply * p.pct / 100)} ${esc(S)}</small></div><div><b>${esc(p.title)}</b><small>${esc(p.note)}</small>${p.key === 'other' ? `<div class="chips">${(AD.venues || []).map((v) => `<span>${esc(v)}</span>`).join('')}</div>` : p.key === 'holders' ? `<div class="chips">${(AD.holderAssets || []).map((v) => `<span>${esc(v)}</span>`).join('')}</div>` : ''}</div></div>`).join('')}</section>
      </div>
      <h2 class="adh disp">How points work</h2>
      <div class="grid2 adg">
        <section class="card" style="position:relative;overflow:hidden"><span class="corner">×2 allocation</span><h2>Trade on Kinex</h2><p class="mute">Every trade since launch counts, until ${dstr(AD.ends)}.</p>
          <div class="big"><span class="av"><img src="${esc(C.chain.logo)}" alt=""></span>1 ${esc(Q)} <i>→</i> <b>${AD.tradePts}</b> <small>points</small></div>
          <div class="kv txt"><span>Launch a coin</span><b>Your coin earns you ${AD.creatorPts} points for every ${esc(Q)} other wallets trade on it</b></div><div class="kv txt"><span>Every trade counts</span><b>Buys and sells, at their value in ${esc(Q)}</b></div><div class="kv txt"><span>In from ${AD.minHype} ${esc(Q)}</span><b>Trade at least ${AD.minHype} ${esc(Q)} and your points go live</b></div></section>
        <section class="card"><h2>Trade on other Elysium platforms</h2>
          <div class="rate"><span>Before Kinex launched</span><b>${AD.otherBeforePts}<small>per ${esc(Q)}</small></b></div><div class="ratebar"><i style="width:100%"></i></div>
          <div class="rate"><span>Since then, until ${dstr(AD.ends)}</span><b>${AD.otherAfterPts}<small>per ${esc(Q)}</small></b></div><div class="ratebar"><i style="width:${AD.otherAfterPts / AD.otherBeforePts * 100}%"></i></div>
          <div class="chips" style="flex-wrap:wrap">${(AD.venues || []).map((v) => `<span class="pill">${esc(v)}</span>`).join('')}</div>
          <p class="mute" style="margin-top:14px;font-size:12.5px;font-weight:600;color:var(--ink2)">How this pool goes out</p><div class="halves"><div><b>Half by points.</b><small>Open to every wallet with 1 ${esc(Q)} swapped.</small></div><div><b>Half equally.</b><small>Shared by wallets with 1 ${esc(Q)} before Kinex.</small></div></div></section>
      </div>
      <section class="card" style="margin-top:14px"><div class="tw"><table class="tb keep"><thead><tr><th>Rank</th><th>Wallet</th><th class="r">Traded</th><th class="r">Points</th><th class="r">Estimate</th></tr></thead><tbody>${rows.slice(0, 25).map((r, i) => `<tr class="link" data-go="#/profile/${r.w}"><td class="mute num">${i + 1}</td><td><span class="num">${esc(shortAddr(r.w))}</span>${r.w === me ? ' <span class="pill teal">you</span>' : ''}</td><td class="r num">${hype(r.h, 2)}</td><td class="r num">${fmtNum(r.p)}</td><td class="r num"><b>${fmtNum(tokOf(r.p))} ${esc(S)}</b></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">No points yet.</div></td></tr>'}</tbody></table></div></section>
      <details class="terms"><summary>Terms and disclaimer</summary>
        <p>Points, ranks, percentages and dollar figures on this page are preliminary estimates, not a promise of any amount. They are worked out from current totals and the current price of $${esc(S)}, and they change as other wallets trade and as the price moves.</p>
        <p>The campaign closes on ${dstr(AD.ends)}, ${new Date(AD.ends).getUTCFullYear()} at ${tstr(AD.ends)} UTC. We keep the following days, until ${dstr(AD.review)}, ${new Date(AD.review).getUTCFullYear()}, for a general review of the results. During this review we may remove wallets we consider sybils, bots or wash traders, correct errors, and change points or allocations accordingly. Our decisions on eligibility are final.</p>
        <p>After the review the airdrop is released with vesting linked to the market cap of $${esc(S)}, to limit its impact on the market if the token moves sharply. The schedule is published before release.</p>
        <p>The estimate for traders on other platforms is calculated on the ${pOther.pct + pHold.pct}% of supply shared by that group and by ${(AD.holderAssets || []).join(' and ')} holders. The announced shares are ${pOther.pct}% each. What holders claim is taken from this ${pOther.pct + pHold.pct}%, so the final amount for traders on other platforms can be lower than the estimate shown.</p>
        <p>${(AD.holderAssets || []).join(' and ')} holders have to claim after the campaign, under conditions published later. Tokens nobody claims are not handed out and stay outside the airdrop, so the total distributed can be lower than ${totalPct}% of supply.</p>
        <p>Only swaps on the venues we track count. Volume on other platforms covers the venues we have chosen, and the list can change. Self-trades by a coin's creator earn nothing, and wallets operated by the protocol, such as its keeper and bots, are excluded.</p>
        <p>Rules can change at any time, including to stop abuse. Taking part does not create any right to tokens. Nothing here is financial advice or an offer of securities. Tokens on Kinex are created by their launchers and trading them carries risk, including the total loss of what you put in. You are responsible for complying with the laws that apply to you and for any taxes.</p></details></div>`;
    bindGo();
    $('#ad-jump').onclick = (e) => { e.preventDefault(); $('#ad-check').scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $('#ad-addr').focus(), 400); };
    const inp = $('#ad-addr'), res = $('#ad-res'); inp.oninput = () => { const v = inp.value.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(v)) res.innerHTML = share(v); };
    $('#ad-conn').onclick = () => { if (!APP.W.connected) return APP.W.connect(); inp.value = APP.W.address; res.innerHTML = share(APP.W.address); };
    clearInterval(adTimer); const tick = () => { const el = $('#ad-cd'); if (!el) return clearInterval(adTimer); const s = Math.max(0, Math.floor((ends - Date.now()) / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; el.textContent = s ? `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : 'Ended'; }; tick(); adTimer = setInterval(tick, 1000);
  }

  // ---- docs
  function docs() {
    const E = C.econ, S = sym(), K = C.chain.contracts;
    const addr = (a) => (a ? `<a class="num" href="${APP.explorer('address', a)}" target="_blank" rel="noopener">${esc(a)}</a>` : '<span class="mute">not deployed yet</span>');
    const STK = (C.chain.pairs || []).filter((p) => p.kind === 'stock');
    const toc = [['How it works', [['uniswap', 'Built on Uniswap'], ['launch', 'Launching a token'], ...(STK.length ? [['stocks', 'Stock pairs']] : []), ['fees', 'Fees'], ['flywheel', 'Buybacks'], ['tide', '$' + S]]], ['Using Kinex', [['trading', 'Trading'], ...(AD ? [['airdrop', 'Airdrop']] : []), ['network', 'Network and RPC']]], ['Reference', [['contracts', 'Contracts']]]];
    let n = 0; const adPct = AD ? AD.pools.reduce((a, p) => a + p.pct, 0) : 0, PN = BR ? BR.parent.name : 'HyperEVM';
    view.innerHTML = `<div class="page"><section class="phero" style="min-height:0;margin-bottom:10px"><div><h1 class="disp">Docs<span class="h-dot">.</span></h1><p>What happens when a token launches on Kinex, where every fee goes, and the address of every contract.</p></div><div class="pa etched" style="height:180px">${etch('library')}</div></section>
      <div class="docs"><nav class="toc">${toc.map(([g, items]) => `<span>${g}</span>${items.map(([id, l]) => `<a href="#/docs#${id}" data-doc="${id}"><i>${String(++n).padStart(2, '0')}</i>${l}</a>`).join('')}`).join('')}</nav>
      <article class="doc">
        <section id="d-uniswap"><h2>Built on Uniswap</h2><p>Kinex runs on the official Uniswap v4 deployment on Elysium. Every Kinex pool lives in the PoolManager that Uniswap deployed there, and trades go through Uniswap's own UniversalRouter. Kinex adds a hook to it, not a copy of it.</p></section>
        <section id="d-launch"><h2>Launching a token</h2><p>One transaction creates the token, its Uniswap v4 pool and its fee routing. The launch fee is ${E.launchFeeHype} ${Q}. Every token has a supply of ${fmtNum(E.supply)}, and all of it goes into the pool: nothing is held back for the team.</p><p>The pool opens at a ${fmtNum(E.openMcapHype)} ${Q} market cap. The whole supply sits in one single-sided range, from the opening market cap to the top: there are no bands.</p><ul><li>Swap fee: a fixed ${(E.feeBps / 100).toFixed(1)}% on every buy and sell, for the life of the pool. It does not rise or fall with the price.</li><li>Anti-snipe: for the first ${E.snipeSeconds} seconds, buys pay an extra tax that starts at ${E.snipeStartBps / 100}% and halves ${E.snipeHalvings} times to zero.</li><li>Dev buy: optional, up to ${E.maxDevBuyBps / 100}% of the supply, filled in the launch transaction at the opening price.</li></ul></section>
        ${STK.length ? `<section id="d-stocks"><h2>Stock pairs</h2><p>A token can be paired with ${esc(Q)} or with a tokenized stock. The stocks are EQX tokens: ${STK.map((p) => esc(p.sym) + ' (' + esc(p.name) + ')').join(', ')}. Pick one under Paired with on the Launch page.</p><ul><li>The pool trades against the stock. Buyers pay in it, sellers receive it, and the dev buy is paid in it too. The launch fee is still ${E.launchFeeHype} ${esc(Q)}.</li><li>Each stock pool opens at the same dollar market cap as a ${esc(Q)} pool, using the stock's price on Hyperliquid at deployment. The site converts prices to dollars with live Hyperliquid prices.</li><li>The ${(E.feeBps / 100).toFixed(1)}% fee is taken in the stock. The creator's ${E.creatorShareBps / 100}% is claimed in the stock on the Fees page, and the protocol's share goes to its splitter.</li><li>Paying with a stock for the first time takes two approvals, one for Permit2 and one for the router.</li></ul><p>EQX tokens are issued by EQX Labs and backed one to one by shares. The issuer can pause or freeze transfers. If it does, trading in that pool stops until transfers resume.</p></section>` : ''}
        <section id="d-fees"><h2>Fees</h2><p>Every trade pays the pool's swap fee in the pool's pair: ${Q}, or the stock for a stock pair. ${E.creatorShareBps / 100}% goes to the creator and ${E.protocolShareBps / 100}% to the protocol. Creators claim from the fee escrow at any time, on the Fees page.</p></section>
        <section id="d-flywheel"><h2>Buybacks</h2><p>The protocol's share lands in one splitter contract. ${(ST.burnBps || 0) / 100}% of it buys $${S} on its own pool and burns it; the rest funds the treasury. Anyone can trigger a distribution. The keeper runs the buybacks with a minimum output, so a buy cannot be sandwiched. Every buyback and burn is listed on the Flywheel page.</p></section>
        <section id="d-tide"><h2>$${S}</h2><p>$${S} is a token launched on Kinex like any other, under the same rules. Its whole creator side belongs to the protocol and flows into buybacks too. ${AD ? `${adPct}% of the supply is set aside for the airdrop.` : ''} ${ST.token ? `Address ${addr(ST.token)}.` : 'It launches with the Elysium deployment.'}</p></section>
        <section id="d-trading"><h2>Trading</h2><p>Every token page has a trade card. It quotes the trade with Uniswap's V4Quoter, which runs it against the pool and so counts the current fee, then sends it through the UniversalRouter with your slippage limit. Selling a token for the first time takes two approvals, one for Permit2 and one for the router; after that each sale is one transaction.</p></section>
        <section id="d-network"><h2>Network and RPC</h2><p>When your wallet is on another network, the site's switch button moves it to Elysium and adds the network if the wallet does not know it yet. To add it by hand:</p><div class="kvs"><div class="kv"><span>Network name</span><b>${esc(C.chain.name)}</b></div><div class="kv txt"><span>RPC URL</span><b>${esc(C.chain.rpc)}</b></div><div class="kv"><span>Chain ID</span><b>${C.chain.id}</b></div><div class="kv"><span>Currency symbol</span><b>${esc(Q)}</b></div><div class="kv txt"><span>Block explorer</span><b>${esc(String(C.chain.explorer).replace(/\/#$/, ''))}</b></div></div></section>
        <section id="d-contracts"><h2>Contracts</h2><p>All on ${esc(C.chain.name)}, chain id ${C.chain.id}.</p><div class="kvs">${[['Launch factory', K.factory], ['Hook', K.hook], ['Locker', K.locker], ['Fee escrow', K.escrow], ['Buyback vault', K.vault], ['Splitter', ST.splitter], ['PoolManager (Uniswap)', K.poolManager], ['UniversalRouter (Uniswap)', K.router], ['V4Quoter (Uniswap)', K.quoter], ...(BR ? [['Rollup Inbox (' + PN + ')', BR.inbox], ['Rollup Outbox (' + PN + ')', BR.outbox]] : [])].map(([k, v]) => `<div class="kv txt"><span>${k}</span><b>${addr(v)}</b></div>`).join('')}</div></section>
      </article></div></div>`;
    $$('[data-doc]').forEach((a) => a.onclick = (e) => { e.preventDefault(); const el = $('#d-' + a.dataset.doc); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    const frag = location.hash.split('#')[2]; if (frag) { const el = $('#d-' + frag); if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 50); }
  }

  // ---- router
  function route() {
    const h = location.hash.replace(/^#/, '') || '/', parts = h.split('#')[0].split('/').filter(Boolean), r = parts[0] || 'home';
    $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.r === (r === 'token' ? 'home' : r === 'create' ? 'launch' : r)));
    state.route = r; window.scrollTo(0, 0); ticker();
    if (r === 'home') home(); else if (r === 'token') token(parts[1] || ''); else if (r === 'launch' || r === 'create') create(); else if (r === 'bridge') { location.hash = '#/'; /* the Bridge page is off for now; bridge() is kept for later */ } else if (r === 'airdrop') { if (AD) airdrop(); else location.hash = '#/'; } else if (r === 'flywheel') flywheel(); else if (r === 'fees') fees(); else if (r === 'profile') profile(parts[1]); else if (r === 'docs') docs(); else if (['swap', 'pools', 'pool', 'stake'].includes(r)) { location.hash = '#/'; } else home();
  }
  function menuSheet() {
    const W = APP.W;
    const links = [['#/', 'Explore', MI.home], ['#/launch', 'Launch a token', MI.create], ...(AD ? [['#/airdrop', 'Airdrop', MI.gift]] : []), ['#/flywheel', 'Flywheel', MI.fly], ['#/fees', 'Your fees', MI.fees], ['#/profile', 'Profile', MI.profile], ['#/docs', 'Docs', MI.docs], ...(C.x ? [[C.x, 'X', ICON.x]] : [])];
    const ov = document.createElement('div'); ov.className = 'ov sheetov';
    ov.innerHTML = `<div class="sheet"><div class="grip"></div>
      <div class="mlist">${links.map(([h, l, i]) => `<a href="${h}" ${/^https?:/.test(h) ? 'target="_blank" rel="noopener"' : ''}>${i}<span>${l}</span>${ICON.chev}</a>`).join('')}</div>
      <div class="mfoot"><div class="mpx"><i></i><span>${esc(Q)}</span><b class="num">${fmtUsd(APP.hypeUsd)}</b></div>
        ${W.connected ? `<button class="wallet on" id="m-out"><i style="background-image:url('${APP.identicon(W.address)}')"></i>${esc(W.short)} · Disconnect</button>` : `<button class="wallet" id="m-in">Connect</button>`}</div></div>`;
    document.body.appendChild(ov); requestAnimationFrame(() => ov.classList.add('in'));
    const close = () => { ov.classList.remove('in'); setTimeout(() => ov.remove(), 180); };
    ov.onclick = (e) => { if (e.target === ov) close(); };
    $$('a', ov).forEach((a) => a.onclick = close);
    const i = $('#m-in', ov); if (i) i.onclick = () => { close(); W.connect(); };
    const o = $('#m-out', ov); if (o) o.onclick = () => { W.disconnect(); close(); };
  }
  function searchDialog() { const ov = APP.dialog('Search', `<div class="picker"><input class="inp" id="sq" placeholder="Name, ticker or address" autocomplete="off"><div class="list" id="sq-list"></div></div>`); const draw = (s) => { const ls = DATA.tokens().filter((t) => s && (t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.addr.includes(s))).slice(0, 8); $('#sq-list', ov).innerHTML = ls.map((t) => `<a class="row" href="${link(t)}"><span class="av">${APP.img(t)}</span><span><b>${esc(t.name)}</b><small>$${esc(t.symbol)} · ${fmtUsd(t.mcapUsd)}</small></span></a>`).join(''); $$('a', ov).forEach((a) => a.onclick = () => ov.remove()); }; $('#sq', ov).oninput = (e) => draw(e.target.value.trim().toLowerCase()); setTimeout(() => $('#sq', ov).focus(), 30); }
  function footer() { const f = $('#foot-art'); if (f) f.innerHTML = `<img class="pano" src="/img/etch-forum.webp" srcset="/img/etch-forum-sm.webp 900w, /img/etch-forum.webp 1800w" sizes="100vw" alt="" decoding="async">`; const y = $('#f-year'); if (y) y.textContent = new Date().getFullYear(); }
  APP.boot(async () => {
    $('#n-search').onclick = searchDialog; const nm = $('#n-menu'); if (nm) nm.onclick = menuSheet; footer();
    document.addEventListener('keydown', (e) => { if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); searchDialog(); } });
    try { await DATA.ready(); } catch (e) { APP.toast('Could not load the chain state: ' + APP.errMsg(e), 'err', 6000); }
    route(); addEventListener('hashchange', route);
    APP.onWallet(() => { if (['home', 'token', 'launch', 'create', 'bridge', 'profile', 'airdrop', 'fees', 'flywheel'].includes(state.route) && !state.busy) route(); });
    let priced = false; (APP.priceHooks || (APP.priceHooks = [])).push(() => { if (priced) return; priced = true; if (state.route === 'token') { const a = (location.hash.split('/')[2] || ''); if (a) token(a, true); return; } if (state.route === 'home') home(true); }); // stock coins need prices: redraw once when they first arrive
    let last = 0; if (APP.onUpdate) APP.onUpdate(() => { if (state.route === 'token' && !state.busy) { const a = (location.hash.split('/')[2] || ''); if (a) token(a, true); return; } if (state.route === 'home' && !state.busy) home(true); void last; });
  });
})();
