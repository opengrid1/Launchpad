/* cntrl-z.fun shell: wallet button, search, theme, toasts, dialogs, menus, formatting and the window
   pieces every page shares (window pricing, clocks, kept ring). Exposes window.UI. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const P = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    xlogo: '<path fill="currentColor" stroke="none" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77zm-1.08 16.18h1.7L7.4 4.73H5.58z"/>',
  };
  const ic = (n, cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
  const CFG = window.UNDO || {};
  const EXPLORER = CFG.explorer || 'https://etherscan.io';

  // ------------------------------------------------------------ formatting
  const tiny = v => { if (v >= 0.01) return v.toFixed(4); const [m, e] = v.toExponential(3).split('e'); const zeros = -Number(e) - 1; const digits = m.replace('.', '').slice(0, 4);
    return zeros >= 4 ? '0.0' + String(zeros).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('') + digits : '0.' + '0'.repeat(zeros) + digits; };
  const usd = (v, opt = {}) => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); const s = v < 0 ? '−$' : '$'; const c = opt.compact !== false;
    if (c && a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B'; if (c && a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M'; if (c && a >= 1e4) return s + (a / 1e3).toFixed(1) + 'K'; if (c && a >= 1e3) return s + (a / 1e3).toFixed(2) + 'K';
    if (a >= 1) return s + a.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: a < 1000 ? 2 : 0 }); if (a === 0) return '$0'; return s + tiny(a); };
  const num = (v, d = 2) => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
    if (a >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: d }); if (a === 0) return '0'; return a >= 0.0001 ? v.toPrecision(3) : tiny(a); };
  const eth = (v, d) => v == null || !isFinite(v) ? '—' : (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(4) : v.toFixed(d || 5)).replace(/\.?0+$/, '') + ' ETH';
  const pct = (v, d) => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); return (v > 0 ? '+' : v < 0 ? '−' : '') + (a >= 1000 ? (a / 1000).toFixed(1) + 'K' : a.toFixed(d != null ? d : a >= 100 ? 0 : 1)) + '%'; };
  const delta = v => `<span class="delta ${!isFinite(v) || Math.abs(v) < .05 ? 'flat' : v > 0 ? 'up' : 'down'}">${pct(v)}</span>`;
  const ago = ts => { const s = Math.max(1, Date.now() / 1000 - ts); if (s < 60) return Math.floor(s) + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  const clock = secs => { secs = Math.max(0, Math.floor(secs)); const d = Math.floor(secs / 86400), h = Math.floor(secs % 86400 / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60; const p = n => String(n).padStart(2, '0');
    return d ? `${d}d ${p(h)}h ${p(m)}m` : h ? `${h}h ${p(m)}m ${p(s)}s` : m ? `${m}m ${p(s)}s` : `${p(s)}s`; };
  const winLabel = h => h >= 24 ? (h / 24) + 'd' : h >= 1 ? h + 'h' : Math.round(h * 60) + 'm';

  // ------------------------------------------------------------ the window rule every coin shares
  // a window costs a fixed amount of ETH per hour (0.05 ETH per 6 hours), 30 minutes to 7 days, at most 30% of the buy
  const PR = CFG.premium || { refEth: 0.05, baseH: 6, minH: 0.5, maxH: 168, maxBps: 3000 };
  const premiumFor = hours => PR.refEth * hours / PR.baseH;
  const hoursFor = premium => premium * PR.baseH / PR.refEth;
  // the contract caps the premium at 30% of what the buy actually costs (after the premium and the 1% tax come off)
  const maxHoursFor = buyEth => Math.max(0, Math.min(PR.maxH, hoursFor(buyEth * PR.maxBps / (10000 * (1 + (CFG.taxBps || 100) / 10000) + PR.maxBps))));
  const WINDOWS = [0.5, 1, 6, 24, 72, 168];
  // the six window lengths as keys, with their price; the ones the buy is too small for are disabled
  const timeKeys = (sel, buyEth) => `<div class="keys timekeys">${WINDOWS.map(h => { const ok = buyEth == null || h <= maxHoursFor(buyEth) + 1e-9; return `<button type="button" class="key sm ${h === sel ? 'down yellow' : ''}" data-h="${h}" ${ok ? '' : 'disabled title="The window can cost at most 30% of the buy"'}><span>${winLabel(h)}</span><kbd>${eth(premiumFor(h))}</kbd></button>`; }).join('')}</div>`;
  const ring = (p, size = 44, cls = '') => { const r = (size - 6) / 2, c = 2 * Math.PI * r; const v = p == null ? 0 : Math.max(0, Math.min(100, p)); const col = p == null ? 'var(--faint)' : v >= 80 ? 'var(--kept)' : v < 55 ? 'var(--undone)' : 'var(--key-strong)';
    return `<span class="ring ${cls}" title="${p == null ? 'No window buys yet' : v.toFixed(0) + '% of window buys were kept'}"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="5"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><b style="color:${col}">${p == null ? '—' : v.toFixed(0) + '%'}</b></span>`; };

  // ------------------------------------------------------------ coin and pair glyphs
  const DEFAULT_COIN = '/img/token-default.png' + ((CFG.ver || {})['/img/token-default.png'] ? '?v=' + CFG.ver['/img/token-default.png'] : '');
  const coinAv = (x, cls) => `<span class="av ${cls || ''}${x.img ? '' : ' av-def'}"><img src="${esc(x.img || DEFAULT_COIN)}" alt="" onerror="this.onerror=null;this.src='${DEFAULT_COIN}'"></span>`;
  const pairIcon = (p, cls) => p.logo ? `<img class="${cls || 'tok'}${p.kind === 'stock' ? ' stocklogo' : ''}" src="${esc(p.logo)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;${cls === 'pr' ? 'pr stock' : 'stock-chip'}&quot;>${esc((p.ticker || p.symbol || '').replace(/on$/, '').slice(0, 4))}</span>'">` : `<span class="${cls === 'pr' ? 'pr stock' : 'stock-chip'}">${esc((p.ticker || p.symbol || '').replace(/on$/, '').slice(0, 4))}</span>`;
  const pairGlyph = (x, size) => `<span class="pg ${size || ''}" title="${esc(x.symbol)} paired with ${esc(x.pair.symbol)}">${coinAv(x)}${pairIcon(x.pair, 'pr')}</span>`;
  const coinHref = a => '/coin/' + a;
  const txLink = h => `${EXPLORER}/tx/${h}`;
  const addrLink = a => `${EXPLORER}/address/${a}`;
  const isAdmin = () => !!(window.bsWallet && bsWallet.connected && CFG.admin && bsWallet.address === CFG.admin.toLowerCase());

  // ------------------------------------------------------------ toasts, dialogs, menus
  function toast(msg, opt = {}) { let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const el = document.createElement('div'); el.className = 'toast' + (opt.err ? ' err' : ''); el.innerHTML = ic(opt.err ? 'alert' : opt.icon || 'check') + `<div>${esc(msg)}${opt.tx ? ` <a href="${txLink(opt.tx)}" target="_blank" rel="noopener">View</a>` : ''}</div>`;
    box.appendChild(el); setTimeout(() => el.remove(), opt.err ? 7000 : 4600); }
  function dialog(title, body, opt = {}) {
    const ov = document.createElement('div'); ov.className = 'overlay'; ov.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="${opt.wide ? 'max-width:640px' : ''}"><div class="dialog-h"><h3>${esc(title)}</h3><button class="key sq sm" data-close aria-label="Close">${ic('x')}</button></div>${body}</div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', key); opt.onClose && opt.onClose(); };
    const key = e => { if (e.key === 'Escape') close(); };
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); }); ov.querySelector('[data-close]').onclick = close; document.addEventListener('keydown', key);
    document.body.appendChild(ov); ov.close = close; return ov; }
  function menu(anchor, html) { $$('.menu').forEach(m => m.remove()); const m = document.createElement('div'); m.className = 'menu'; m.innerHTML = html; document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + window.scrollY + 8) + 'px'; m.style.left = Math.max(12, Math.min(window.innerWidth - m.offsetWidth - 12, r.right - m.offsetWidth)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0); return m; }
  async function copy(text, label) { try { await navigator.clipboard.writeText(text); toast((label || 'Address') + ' copied'); } catch { toast('Copy failed', { err: true }); } }
  const notLive = () => toast('Preview: buying, cancelling and launching open when the contracts go live.', { icon: 'info' });

  const currentTheme = () => 'light';

  // ------------------------------------------------------------ wallet button
  function paintWallet() {
    const w = window.bsWallet; $$('[data-wallet-btn]').forEach(b => {
      if (w && w.connected) { const wrong = w.chainId && w.chainId !== (CFG.chainId || 1); b.className = 'key wallet-btn'; b.innerHTML = wrong ? `${ic('alert')}Switch to Ethereum` : `<span class="dot"></span><span class="mono">${esc(w.short())}</span>${ic('down')}`; }
      else { b.className = 'key ink wallet-btn'; b.innerHTML = 'Connect'; }
    });
    $$('[data-admin-link]').forEach(a => a.classList.toggle('hidden', !isAdmin()));
  }
  function walletClick(e) {
    const w = window.bsWallet; if (!w) return; const b = e.currentTarget;
    if (!w.connected) return w.open();
    if (w.chainId && w.chainId !== (CFG.chainId || 1)) return w.switchChain().catch(err => toast(String(err && err.message || err).slice(0, 120), { err: true }));
    const m = menu(b, `<a href="/portfolio">${ic('wallet')}Portfolio</a><button data-copy>${ic('copy')}Copy address</button><a href="${addrLink(w.address)}" target="_blank" rel="noopener">${ic('ext')}View on Etherscan</a>${isAdmin() ? `<a href="/admin">${ic('shield')}Admin</a>` : ''}<hr><button data-out>${ic('logout')}Disconnect</button>`);
    m.querySelector('[data-copy]').onclick = () => { copy(w.address); m.remove(); }; m.querySelector('[data-out]').onclick = () => { w.logout(); m.remove(); };
  }

  // ------------------------------------------------------------ search
  function openSearch() {
    const ov = dialog('Search', `<div class="dialog-search">${ic('search')}<input id="sq" placeholder="Coin, ticker, pair (ETH, TSLA, gold…) or address" autocomplete="off" spellcheck="false"><kbd>ESC</kbd></div><div class="dialog-b" id="sr"></div>`);
    const inp = $('#sq', ov), out = $('#sr', ov); let sel = 0;
    const render = () => { const q = inp.value.trim().toLowerCase(); const all = window.UD ? UD.tokens() : [];
      const hits = (q ? all.filter(x => x.name.toLowerCase().includes(q) || x.symbol.toLowerCase().includes(q) || x.addr === q || x.pair.symbol.toLowerCase().includes(q) || (x.pair.name || '').toLowerCase().includes(q)) : [...all].sort((a, b) => b.vol24 - a.vol24)).slice(0, 12);
      out.innerHTML = (q ? '' : '<div class="opt-group">Most traded today</div>') + (hits.map((x, i) => `<a class="opt ${i === sel ? 'sel' : ''}" href="${coinHref(x.addr)}">${pairGlyph(x, 'sm')}<span class="t"><b>${esc(x.name)}</b><span>$${esc(x.symbol)} · ${esc(x.pair.symbol)} · ${x.keptPct == null ? 'no windows yet' : x.keptPct.toFixed(0) + '% kept'}</span></span><span class="r"><b>${usd(x.mc)}</b>${delta(x.c24)}</span></a>`).join('')
        || '<div class="empty" style="padding:36px 10px"><p>No coin matches.</p></div>'); };
    inp.oninput = () => { sel = 0; render(); };
    inp.onkeydown = e => { const items = $$('.opt', out); if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); } else if (e.key === 'Enter' && items[sel]) location.href = items[sel].getAttribute('href'); };
    render(); setTimeout(() => inp.focus(), 20);
  }

  function init() {
    $$('[data-wallet-btn]').forEach(b => b.onclick = walletClick); paintWallet();
    $$('[data-search]').forEach(b => b.onclick = openSearch);
    document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); } });
    window.addEventListener('bs:wallet', paintWallet);
    window.addEventListener('bs:nowallet', () => toast('No wallet found. Install a browser wallet or open this page in your wallet app.', { err: true }));
    if (CFG.prelaunch && !/^\/(docs|admin)/.test(location.pathname)) { const pg = $('#page'); if (pg) pg.insertAdjacentHTML('afterbegin', `<div class="notice">${ic('info')}<span><b>Preview.</b> The coins here are examples. Buying, cancelling and launching open when the contracts go live.</span></div>`); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.UI = { $, $$, esc, ic, usd, num, eth, pct, delta, ago, short, clock, winLabel, PR, WINDOWS, premiumFor, hoursFor, maxHoursFor, timeKeys, ring, coinAv, DEFAULT_COIN, pairIcon, pairGlyph, coinHref, txLink, addrLink, isAdmin, toast, dialog, menu, copy, notLive, currentTheme, openSearch };
})();
