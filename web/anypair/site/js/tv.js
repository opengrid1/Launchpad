/* TradingView Advanced Charts on the coin page (library in /charting_library), same setup as Inkypump.
   Candles come from the coin's pool swaps through chain.js; shown in USD or the pair, as price or market cap. */
(function () {
  const RES = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '1D': 86400, '1W': 604800 };
  const SUPPLY = 1e9;
  let X = null, unit = 'USD', mode = 'price';
  const symName = () => X ? `${X.symbol}/${X.pairSym}` : 'COIN/ETH';
  const factor = () => (mode === 'mcap' ? SUPPLY : 1) * (unit === 'USD' ? 1 : 1 / (X.pairUsd || 1));
  const scaleFor = () => { const p = (X ? X.px : 1e-9) * factor(); if (!(p > 0)) return 100; return Math.pow(10, Math.min(16, Math.max(2, Math.ceil(-Math.log10(p)) + 3))); };
  const subs = {};
  const datafeed = {
    onReady(cb) { setTimeout(() => cb({ supported_resolutions: Object.keys(RES), supports_marks: false, supports_timescale_marks: false, supports_time: true, exchanges: [{ value: 'Anypair', name: 'Anypair', desc: 'Uniswap V4 on Base' }], symbols_types: [{ name: 'crypto', value: 'crypto' }] }), 0); },
    searchSymbols(q, ex, type, cb) { cb([{ symbol: symName(), full_name: 'Anypair:' + symName(), description: X ? X.name : '', exchange: 'Anypair', ticker: symName(), type: 'crypto' }]); },
    resolveSymbol(name, ok) {
      mode = /·MCAP/.test(name) ? 'mcap' : 'price'; unit = /·PAIR/.test(name) ? 'PAIR' : 'USD';
      setTimeout(() => ok({ ticker: name, name: symName(), description: (mode === 'mcap' ? X.symbol + ' market cap' : symName()) + (unit === 'PAIR' ? ' in ' + X.pairSym : ''), type: 'crypto', session: '24x7', timezone: 'Etc/UTC', exchange: 'Anypair', listed_exchange: 'Anypair', format: 'price', minmov: 1, pricescale: scaleFor(), has_intraday: true, intraday_multipliers: ['1', '5', '15', '30', '60', '240'], has_daily: true, has_weekly_and_monthly: true, supported_resolutions: Object.keys(RES), volume_precision: 2, data_status: 'streaming', visible_plots_set: 'ohlcv', currency_code: unit === 'USD' ? 'USD' : X.pairSym }), 0);
    },
    async getBars(info, res, params, ok, err) {
      try { if (!X || !params.firstDataRequest) { ok([], { noData: true }); return; }
        const bars = await AP.bars(X.addr, RES[res] || 3600); const f = factor(); if (!bars.length) { ok([], { noData: true }); return; }
        ok(bars.map(b => ({ time: b.time * 1000, open: b.open * f, high: b.high * f, low: b.low * f, close: b.close * f, volume: b.value })), { noData: false });
      } catch (e) { err(String(e)); }
    },
    subscribeBars(info, res, cb, uid) { subs[uid] = { res: RES[res] || 3600, cb }; },
    unsubscribeBars(uid) { delete subs[uid]; },
    getServerTime(cb) { cb(Math.floor(AP.nowTs())); },
  };
  const SUBS = '₀₁₂₃₄₅₆₇₈₉';
  function fmtPrice(v) { if (v == null || isNaN(v)) return ''; const sign = v < 0 ? '-' : ''; const a = Math.abs(v); if (a === 0) return '0';
    if (a >= 1000) return sign + a.toLocaleString('en-US', { maximumFractionDigits: 2 }); if (a >= 1) return sign + String(+a.toFixed(4)); if (a >= 0.001) return sign + String(+a.toFixed(8));
    const e = Math.floor(Math.log10(a)); const zeros = -e - 1; const d = String(Math.round(a * Math.pow(10, -e + 3))); return sign + '0.0' + String(zeros).replace(/\d/g, c => SUBS[c]) + d.replace(/0+$/, ''); }
  function palette() { const light = document.documentElement.dataset.theme !== 'dark';
    return light ? { bg: '#ffffff', grid: '#f1f1ed', text: '#66686f', up: '#039e74', down: '#e0324e', accent: '#0052ff', ink: '#0d0e12' } : { bg: '#18181b', grid: '#222226', text: '#918f96', up: '#1fd396', down: '#ff4f6a', accent: '#6a9bff', ink: '#f2f1ee' }; }
  function overrides(c) { return { 'paneProperties.background': c.bg, 'paneProperties.backgroundType': 'solid', 'paneProperties.vertGridProperties.color': c.grid, 'paneProperties.horzGridProperties.color': c.grid, 'paneProperties.legendProperties.showSeriesTitle': true, 'symbolWatermarkProperties.transparency': 100, 'scalesProperties.textColor': c.text, 'scalesProperties.lineColor': c.grid, 'scalesProperties.backgroundColor': c.bg,
    'mainSeriesProperties.candleStyle.upColor': c.up, 'mainSeriesProperties.candleStyle.downColor': c.down, 'mainSeriesProperties.candleStyle.borderUpColor': c.up, 'mainSeriesProperties.candleStyle.borderDownColor': c.down, 'mainSeriesProperties.candleStyle.wickUpColor': c.up, 'mainSeriesProperties.candleStyle.wickDownColor': c.down }; }
  let widget = null, box = null;
  function build() {
    const c = palette(); const mobile = innerWidth < 768; const light = document.documentElement.dataset.theme !== 'dark';
    const w = widget = new TradingView.widget({ symbol: symName(), interval: '5', container: box, datafeed, library_path: '/charting_library/', locale: 'en', timezone: 'Etc/UTC', theme: light ? 'light' : 'dark', autosize: true, fullscreen: false, header_widget_buttons_mode: 'fullsize',
      custom_css_url: 'tv-theme.css', custom_font_family: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      loading_screen: { backgroundColor: c.bg, foregroundColor: c.accent },
      disabled_features: ['use_localstorage_for_settings', 'header_symbol_search', 'symbol_search_hot_key', 'header_compare', 'display_market_status', 'popup_hints', 'header_saveload', 'header_quick_search', 'header_fullscreen_button', 'go_to_date'].concat(mobile ? ['left_toolbar', 'header_undo_redo', 'header_screenshot', 'header_settings'] : []),
      enabled_features: ['side_toolbar_in_fullscreen_mode'],
      time_frames: [{ text: '1m', resolution: '60', description: '1 month' }, { text: '5d', resolution: '15', description: '5 days' }, { text: '1d', resolution: '5', description: '1 day' }, { text: '6h', resolution: '1', description: '6 hours' }],
      overrides: overrides(c), studies_overrides: { 'volume.volume.color.0': c.down, 'volume.volume.color.1': c.up, 'volume.volume.transparency': 65 },
      custom_formatters: { priceFormatterFactory: () => ({ format: fmtPrice }) } });
    w.headerReady().then(() => {
      const group = (pairs, get, set) => { const b = w.createButton(); b.style.cursor = 'default'; b.style.padding = '0 14px'; b.style.fontWeight = '500'; b.style.whiteSpace = 'nowrap';
        b.innerHTML = pairs.map((p, i) => (i ? `<span style="color:${c.text};padding:0 6px">/</span>` : '') + `<span data-v="${p[0]}" style="cursor:pointer">${p[1]}</span>`).join('');
        const paint = () => b.querySelectorAll('[data-v]').forEach(x => { x.style.color = x.dataset.v === get() ? c.accent : c.ink; }); paint();
        b.querySelectorAll('[data-v]').forEach(x => x.onclick = () => { set(x.dataset.v); w.setSymbol(symName() + (mode === 'mcap' ? '·MCAP' : '') + (unit === 'PAIR' ? '·PAIR' : ''), w.activeChart().resolution(), () => {}); paint(); }); };
      group([['USD', 'USD'], ['PAIR', X.pairSym]], () => unit, v => { unit = v; }); group([['mcap', 'MarketCap'], ['price', 'Price']], () => mode, v => { mode = v; });
      const fs = w.createButton(); fs.setAttribute('title', 'Fullscreen'); fs.style.padding = '0 10px'; fs.style.cursor = 'pointer'; fs.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 6.5v-4h4M11.5 2.5h4v4M15.5 11.5v4h-4M6.5 15.5h-4v-4"/></svg>'; fs.onclick = () => { try { w.startFullscreen(); } catch (e) {} };
    });
  }
  window.apChart = {
    init(container, x) { X = x; box = container; build(); window.addEventListener('ap:theme', () => { try { widget.remove(); } catch (e) {} build(); }); },
    // after a refresh: reload the bars so new trades show
    reload(x) { X = x || X; try { widget.activeChart().resetData(); } catch (e) {} },
  };
})();
