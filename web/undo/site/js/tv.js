/* TradingView Advanced Charts on the coin page (library in /charting_library), the same setup as the other sites.
   Candles from the coin's swaps, in USD or the pair token, as price or market cap. Undos show as marks on the bars. */
(function () {
  const RES = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '1D': 86400, '1W': 604800 };
  const SUPPLY = 1e9;
  let X = null, unit = 'USD', mode = 'price';
  const symName = () => X ? `${X.symbol}/${X.pair.symbol}` : 'COIN/ETH';
  const factor = () => (mode === 'mcap' ? SUPPLY : 1) * (unit === 'USD' ? 1 : 1 / (X.pair.usd || 1));
  const scaleFor = () => { const p = (X ? X.px : 1e-9) * factor(); if (!(p > 0)) return 100; return Math.pow(10, Math.min(16, Math.max(2, Math.ceil(-Math.log10(p)) + 3))); };

  // candles from the coin's own swaps (x.swaps: time, USD price after the swap, USD volume), continuous from launch
  function bars(sec) {
    const sw = X.swaps || []; const start = Math.floor(X.createdAt / sec) * sec; const end = Math.floor(UD.now() / sec) * sec;
    const first = Math.max(start, end - 3000 * sec); // at most 3,000 candles
    let last = (UD.cfg.startCap || 5000) / SUPPLY; let i = 0;
    for (; i < sw.length && sw[i].t < first; i++) last = sw[i].p;
    const out = [];
    for (let t = first; t <= end; t += sec) {
      const bar = { time: t, open: last, high: last, low: last, close: last, volume: 0 };
      for (; i < sw.length && sw[i].t < t + sec; i++) { const p = sw[i].p; bar.high = Math.max(bar.high, p); bar.low = Math.min(bar.low, p); bar.close = p; bar.volume += sw[i].v; last = p; }
      out.push(bar);
    }
    return out;
  }

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function palette() { return { bg: css('--surface'), grid: css('--line'), text: css('--muted'), up: css('--up'), down: css('--down'), accent: css('--key-strong'), ink: css('--ink'), key: css('--key'), keyStrong: css('--key-strong') }; }

  const datafeed = {
    onReady(cb) { setTimeout(() => cb({ supported_resolutions: Object.keys(RES), supports_marks: true, supports_timescale_marks: false, supports_time: true, exchanges: [{ value: 'undo.fun', name: 'undo.fun', desc: 'Uniswap V4 on Ethereum' }], symbols_types: [{ name: 'crypto', value: 'crypto' }] }), 0); },
    searchSymbols(q, ex, type, cb) { cb([{ symbol: symName(), full_name: 'undo.fun:' + symName(), description: X ? X.name : '', exchange: 'undo.fun', ticker: symName(), type: 'crypto' }]); },
    resolveSymbol(name, ok) {
      mode = /·MCAP/.test(name) ? 'mcap' : 'price'; unit = /·PAIR/.test(name) ? 'PAIR' : 'USD';
      setTimeout(() => ok({ ticker: name, name: symName(), description: (mode === 'mcap' ? X.symbol + ' market cap' : symName()) + (unit === 'PAIR' ? ' in ' + X.pair.symbol : ''), type: 'crypto', session: '24x7', timezone: 'Etc/UTC', exchange: 'undo.fun', listed_exchange: 'undo.fun', format: 'price', minmov: 1, pricescale: scaleFor(), has_intraday: true, intraday_multipliers: ['1', '5', '15', '30', '60', '240'], has_daily: true, has_weekly_and_monthly: true, supported_resolutions: Object.keys(RES), volume_precision: 2, data_status: 'streaming', visible_plots_set: 'ohlcv', currency_code: unit === 'USD' ? 'USD' : X.pair.symbol }), 0);
    },
    getBars(info, res, params, ok, err) {
      try { if (!X || !params.firstDataRequest) { ok([], { noData: true }); return; }
        const b = bars(RES[res] || 3600); const f = factor();
        ok(b.map(x => ({ time: x.time * 1000, open: x.open * f, high: x.high * f, low: x.low * f, close: x.close * f, volume: x.volume })), { noData: !b.length });
      } catch (e) { err(String(e)); }
    },
    getMarks(info, from, to, cb, res) {
      const c = palette(); const sec = RES[res] || 3600;
      cb(X.trades.filter(e => e.side === 'undo' && e.ts >= from && e.ts <= to).slice(0, 60).map((e, i) => ({ id: i, time: Math.floor(e.ts / sec) * sec, color: { border: c.keyStrong, background: c.key }, text: `Undo: ${UI.usd(e.usd)} refunded (${(e.share * 100).toFixed(0)}%)`, label: 'U', labelFontColor: '#15171a', minSize: 15 })));
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

  let widget = null, box = null;
  function build() {
    const c = palette(); const mobile = innerWidth < 768; const light = UI.currentTheme() !== 'dark';
    const w = widget = new TradingView.widget({ symbol: symName(), interval: '15', container: box, datafeed, library_path: '/charting_library/', locale: 'en', timezone: 'Etc/UTC', theme: light ? 'light' : 'dark', autosize: true, fullscreen: false, header_widget_buttons_mode: 'fullsize',
      custom_css_url: 'tv-theme.css', custom_font_family: "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
        b.querySelectorAll('[data-v]').forEach(x => x.onclick = () => { set(x.dataset.v); w.setSymbol(symName() + (mode === 'mcap' ? '·MCAP' : '') + (unit === 'PAIR' ? '·PAIR' : ''), w.activeChart().resolution()); paint(); }); };
      group([['USD', 'USD'], ['PAIR', X.pair.symbol]], () => unit, v => { unit = v; }); group([['mcap', 'MarketCap'], ['price', 'Price']], () => mode, v => { mode = v; });
      const fs = w.createButton(); fs.setAttribute('title', 'Fullscreen'); fs.style.padding = '0 10px'; fs.style.cursor = 'pointer'; fs.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 6.5v-4h4M11.5 2.5h4v4M15.5 11.5v4h-4M6.5 15.5h-4v-4"/></svg>'; fs.onclick = () => { try { w.startFullscreen(); } catch (e) {} };
    });
  }
  window.udChart = {
    init(container, x) { X = x; box = container; build(); window.addEventListener('ud:theme', () => { try { widget.remove(); } catch (e) {} build(); }); },
  };
})();
