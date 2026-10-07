/* TradingView Advanced Charts on the coin page (library in /charting_library), the same setup as Inkypump.
   Candles in USD or the backing token, as price or market cap. Burns show as marks on the bars, and the
   next buyback line and the vault backing are drawn as fixed horizontal lines. */
(function () {
  const RES = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '1D': 86400, '1W': 604800 };
  const SUPPLY = 1e9;
  let X = null, unit = 'USD', mode = 'price', minutes = null;
  const symName = () => X ? `${X.symbol}/${X.pairSym}` : 'COIN/ETH';
  const factor = () => (mode === 'mcap' ? SUPPLY : 1) * (unit === 'USD' ? 1 : 1 / (X.pairUsd || 1));
  const scaleFor = () => { const p = (X ? X.px : 1e-9) * factor(); if (!(p > 0)) return 100; return Math.pow(10, Math.min(16, Math.max(2, Math.ceil(-Math.log10(p)) + 3))); };

  // sample coins carry hourly closes; fill each hour with a seeded random walk between its two closes,
  // so every resolution down to one minute has real-looking candles that end on the same prices
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function minuteSeries() {
    if (minutes) return minutes;
    const c = X.chart; const r = rng(parseInt(X.addr.slice(2, 10), 16)); const out = [];
    for (let i = 0; i < c.px.length - 1; i++) {
      const a = Math.log(c.px[i]), b = Math.log(c.px[i + 1]); const vol = c.vol[i + 1] || 0;
      let w = 0; const steps = []; for (let k = 0; k < 60; k++) { w += (r() - 0.5) * 0.012; steps.push(w); }
      const wN = steps[59]; const weights = steps.map(() => r() ** 3); const wSum = weights.reduce((s, v) => s + v, 0) || 1;
      for (let k = 0; k < 60; k++) { const t = (k + 1) / 60; const lp = a + (b - a) * t + steps[k] - wN * t; out.push({ t: c.t0 + i * c.step + k * 60, p: Math.exp(lp), v: vol * weights[k] / wSum }); }
    }
    return (minutes = out);
  }
  function bars(sec) {
    const m = minuteSeries(); const out = []; let cur = null; let prev = X.chart.px[0];
    for (const x of m) { const t = Math.floor(x.t / sec) * sec;
      if (!cur || cur.time !== t) { if (cur) out.push(cur); cur = { time: t, open: prev, high: Math.max(prev, x.p), low: Math.min(prev, x.p), close: x.p, volume: x.v }; }
      else { cur.high = Math.max(cur.high, x.p); cur.low = Math.min(cur.low, x.p); cur.close = x.p; cur.volume += x.v; }
      prev = x.p; }
    if (cur) out.push(cur); return out;
  }

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function palette() { return { bg: css('--surface'), grid: css('--line'), text: css('--muted'), up: css('--up'), down: css('--down'), accent: css('--vault'), ink: css('--ink'), bb: css('--bb'), vault: css('--vault') }; }

  const datafeed = {
    onReady(cb) { setTimeout(() => cb({ supported_resolutions: Object.keys(RES), supports_marks: true, supports_timescale_marks: false, supports_time: true, exchanges: [{ value: 'Etherhook', name: 'Etherhook', desc: 'Uniswap V4 on Ethereum' }], symbols_types: [{ name: 'crypto', value: 'crypto' }] }), 0); },
    searchSymbols(q, ex, type, cb) { cb([{ symbol: symName(), full_name: 'Etherhook:' + symName(), description: X ? X.name : '', exchange: 'Etherhook', ticker: symName(), type: 'crypto' }]); },
    resolveSymbol(name, ok) {
      mode = /·MCAP/.test(name) ? 'mcap' : 'price'; unit = /·PAIR/.test(name) ? 'PAIR' : 'USD';
      setTimeout(() => ok({ ticker: name, name: symName(), description: (mode === 'mcap' ? X.symbol + ' market cap' : symName()) + (unit === 'PAIR' ? ' in ' + X.pairSym : ''), type: 'crypto', session: '24x7', timezone: 'Etc/UTC', exchange: 'Etherhook', listed_exchange: 'Etherhook', format: 'price', minmov: 1, pricescale: scaleFor(), has_intraday: true, intraday_multipliers: ['1', '5', '15', '30', '60', '240'], has_daily: true, has_weekly_and_monthly: true, supported_resolutions: Object.keys(RES), volume_precision: 2, data_status: 'streaming', visible_plots_set: 'ohlcv', currency_code: unit === 'USD' ? 'USD' : X.pairSym }), 0);
    },
    getBars(info, res, params, ok, err) {
      try { if (!X || !params.firstDataRequest) { ok([], { noData: true }); return; }
        const b = bars(RES[res] || 3600); const f = factor();
        ok(b.map(x => ({ time: x.time * 1000, open: x.open * f, high: x.high * f, low: x.low * f, close: x.close * f, volume: x.volume })), { noData: !b.length });
      } catch (e) { err(String(e)); }
    },
    getMarks(info, from, to, cb, res) {
      const c = palette(); const sec = RES[res] || 3600;
      cb(X.events.filter(e => e.ts >= from && e.ts <= to).map((e, i) => ({ id: i, time: Math.floor(e.ts / sec) * sec, color: { border: e.kind === 'dip' ? c.bb : c.vault, background: e.kind === 'dip' ? c.bb : c.vault }, text: `${e.kind === 'dip' ? 'Dip buyback' : 'Take profit'}: ${UI.usd(e.usd)} spent, ${UI.num(e.burned, 0)} ${X.symbol} burned`, label: 'B', labelFontColor: '#ffffff', minSize: 16 })));
    },
    subscribeBars() {}, unsubscribeBars() {},
    getServerTime(cb) { cb(Math.floor(Date.now() / 1000)); },
  };
  const SUBS = '₀₁₂₃₄₅₆₇₈₉';
  function fmtPrice(v) { if (v == null || isNaN(v)) return ''; const sign = v < 0 ? '-' : ''; const a = Math.abs(v); if (a === 0) return '0';
    if (a >= 1000) return sign + a.toLocaleString('en-US', { maximumFractionDigits: 2 }); if (a >= 1) return sign + String(+a.toFixed(4)); if (a >= 0.001) return sign + String(+a.toFixed(8));
    const e = Math.floor(Math.log10(a)); const zeros = -e - 1; const d = String(Math.round(a * Math.pow(10, -e + 3))); return sign + '0.0' + String(zeros).replace(/\d/g, ch => SUBS[ch]) + d.replace(/0+$/, ''); }
  function overrides(c) { return { 'paneProperties.background': c.bg, 'paneProperties.backgroundType': 'solid', 'paneProperties.vertGridProperties.color': c.grid, 'paneProperties.horzGridProperties.color': c.grid, 'paneProperties.legendProperties.showSeriesTitle': true, 'symbolWatermarkProperties.transparency': 100, 'scalesProperties.textColor': c.text, 'scalesProperties.lineColor': c.grid, 'scalesProperties.backgroundColor': c.bg,
    'mainSeriesProperties.candleStyle.upColor': c.up, 'mainSeriesProperties.candleStyle.downColor': c.down, 'mainSeriesProperties.candleStyle.borderUpColor': c.up, 'mainSeriesProperties.candleStyle.borderDownColor': c.down, 'mainSeriesProperties.candleStyle.wickUpColor': c.up, 'mainSeriesProperties.candleStyle.wickDownColor': c.down }; }

  // the strategy lines, in whatever unit the chart shows
  let shapes = [];
  function drawLines(w) {
    const ch = w.activeChart(); const c = palette(); const f = factor();
    shapes.forEach(id => { try { ch.removeEntity(id); } catch (e) {} }); shapes = [];
    const line = (price, text, color, style) => { try { const id = ch.createShape({ price }, { shape: 'horizontal_line', lock: true, disableSelection: true, disableSave: true, disableUndo: true, showInObjectsTree: false, text, overrides: { linecolor: color, linestyle: style, linewidth: 2, showLabel: true, textcolor: color, horzLabelsAlign: 'left', vertLabelsAlign: 'bottom', fontsize: 11, bold: true } }); if (id && id.then) id.then(v => shapes.push(v)); else if (id) shapes.push(id); } catch (e) {} };
    if (X.fund) line(X.fund.trigger * f, 'Next buyback (−20%)', c.bb, 2);
    if (X.vault) line(X.vault.perCoin * f, 'Vault backing', c.vault, 0);
  }

  let widget = null, box = null;
  function build() {
    const c = palette(); const mobile = innerWidth < 768; const light = UI.currentTheme() !== 'dark';
    const w = widget = new TradingView.widget({ symbol: symName(), interval: '15', container: box, datafeed, library_path: '/charting_library/', locale: 'en', timezone: 'Etc/UTC', theme: light ? 'light' : 'dark', autosize: true, fullscreen: false, header_widget_buttons_mode: 'fullsize',
      custom_css_url: 'tv-theme.css', custom_font_family: "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      loading_screen: { backgroundColor: c.bg, foregroundColor: c.accent },
      disabled_features: ['use_localstorage_for_settings', 'header_symbol_search', 'symbol_search_hot_key', 'header_compare', 'display_market_status', 'popup_hints', 'header_saveload', 'header_quick_search', 'header_fullscreen_button', 'go_to_date'].concat(mobile ? ['left_toolbar', 'header_undo_redo', 'header_screenshot', 'header_settings'] : []),
      enabled_features: ['side_toolbar_in_fullscreen_mode'],
      time_frames: [{ text: '7d', resolution: '60', description: '7 days' }, { text: '1d', resolution: '15', description: '1 day' }, { text: '6h', resolution: '5', description: '6 hours' }, { text: '1h', resolution: '1', description: '1 hour' }],
      overrides: overrides(c), studies_overrides: { 'volume.volume.color.0': c.down, 'volume.volume.color.1': c.up, 'volume.volume.transparency': 65 },
      custom_formatters: { priceFormatterFactory: () => ({ format: fmtPrice }) } });
    w.headerReady().then(() => {
      const group = (pairs, get, set) => { const b = w.createButton(); b.style.cursor = 'default'; b.style.padding = '0 14px'; b.style.fontWeight = '500'; b.style.whiteSpace = 'nowrap';
        b.innerHTML = pairs.map((p, i) => (i ? `<span style="color:${c.text};padding:0 6px">/</span>` : '') + `<span data-v="${p[0]}" style="cursor:pointer">${p[1]}</span>`).join('');
        const paint = () => b.querySelectorAll('[data-v]').forEach(x => { x.style.color = x.dataset.v === get() ? c.accent : c.ink; }); paint();
        b.querySelectorAll('[data-v]').forEach(x => x.onclick = () => { set(x.dataset.v); w.setSymbol(symName() + (mode === 'mcap' ? '·MCAP' : '') + (unit === 'PAIR' ? '·PAIR' : ''), w.activeChart().resolution(), () => drawLines(w)); paint(); }); };
      group([['USD', 'USD'], ['PAIR', X.pairSym]], () => unit, v => { unit = v; }); group([['mcap', 'MarketCap'], ['price', 'Price']], () => mode, v => { mode = v; });
      const fs = w.createButton(); fs.setAttribute('title', 'Fullscreen'); fs.style.padding = '0 10px'; fs.style.cursor = 'pointer'; fs.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 6.5v-4h4M11.5 2.5h4v4M15.5 11.5v4h-4M6.5 15.5h-4v-4"/></svg>'; fs.onclick = () => { try { w.startFullscreen(); } catch (e) {} };
    });
    w.onChartReady(() => drawLines(w));
  }
  window.bsChart = {
    init(container, x) { X = x; box = container; minutes = null; build(); window.addEventListener('bs:theme', () => { try { widget.remove(); } catch (e) {} shapes = []; build(); }); },
  };
})();
