/* Anypair shell: sidebar pairs, wallet button, search, theme, toasts, dialogs and formatting. Exposes window.UI. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const P = {
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    down: '<path d="m6 9 6 6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    plus: '<path d="M5 12h14M12 5v14"/>', check: '<path d="M20 6 9 17l-5-5"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    rows: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    xlogo: '<path fill="currentColor" stroke="none" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77zm-1.08 16.18h1.7L7.4 4.73H5.58z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    swap: '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
  };
  const ic = (n, cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
  const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="7" width="18" height="18" rx="6" fill="var(--accent)"/><rect x="12" y="7" width="18" height="18" rx="6" fill="none" stroke="var(--pair)" stroke-width="3"/></svg>';

  // ------------------------------------------------------------ formatting
  const usd = (v, opt = {}) => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v);
    if (opt.compact !== false && a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (opt.compact !== false && a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'; if (opt.compact !== false && a >= 1e4) return '$' + (v / 1e3).toFixed(1) + 'K'; if (opt.compact !== false && a >= 1e3) return '$' + (v / 1e3).toFixed(2) + 'K';
    if (a >= 1) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: a < 1000 ? 2 : 0 }); if (a === 0) return '$0';
    return '$' + tiny(v); };
  // small prices keep 4 significant digits, with the zero run written as a subscript: $0.0₅3421
  const tiny = v => { if (v >= 0.01) return v.toFixed(4); const s = v.toExponential(3); const [m, e] = s.split('e'); const zeros = -Number(e) - 1; const digits = m.replace('.', '').slice(0, 4);
    return zeros >= 4 ? '0.0' + String(zeros).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('') + digits : '0.' + '0'.repeat(zeros) + digits; };
  const num = (v, d = 2) => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K'; if (a >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: d }); if (a === 0) return '0'; return a >= 0.0001 ? v.toPrecision(3) : tiny(v); };
  const pct = v => { if (v == null || !isFinite(v)) return '—'; const s = (v >= 0 ? '+' : '') + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toFixed(Math.abs(v) >= 100 ? 0 : 1)) + '%'; return s; };
  const delta = v => `<span class="delta ${!isFinite(v) || Math.abs(v) < .05 ? 'flat' : v > 0 ? 'up' : 'down'}">${pct(v)}</span>`;
  const ago = ts => { const s = Math.max(1, (window.AP ? AP.nowTs() : Date.now() / 1000) - ts); if (s < 60) return Math.floor(s) + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  const letter = (sym, cls, style) => `<span class="tl ${cls || ''}" style="${style || ''}">${esc((sym || '?').replace(/^\$/, '').slice(0, 3).toUpperCase())}</span>`;
  const tokImg = (t, cls) => t && t.logo ? `<img class="${cls || ''}" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.outerHTML='${letter(t.symbol, cls).replace(/'/g, '&#39;').replace(/"/g, '&quot;')}'">` : letter(t && t.symbol, cls);
  const coinImg = (x, cls) => x.img ? `<img class="av ${cls || ''}" src="${esc(x.img)}" alt="">` : `<span class="av ${cls || ''}" style="display:grid;place-items:center;background:${hue(x.addr)};color:#fff;font:700 15px var(--f-display)">${esc(x.symbol.slice(0, 2).toUpperCase())}</span>`;
  const pairGlyph = (x, size) => `<span class="pg ${size || ''}" title="${esc(x.symbol)} / ${esc(x.pairSym)}">${coinImg(x)}${tokImg({ symbol: x.pairSym, logo: x.pairLogo }, 'pr')}</span>`;
  const hue = a => { let h = 0; for (const c of a || 'x') h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 62% 46%)`; };
  const ident = a => { const h1 = hue(a), h2 = hue((a || '').split('').reverse().join('')); return `linear-gradient(135deg, ${h1}, ${h2})`; };
  // sparkline as inline SVG; colour follows the 24h direction
  const spark = (pts, up) => { const v = pts.filter(p => p != null); if (v.length < 2) return '<svg class="spark"></svg>'; const lo = Math.min(...v), hi = Math.max(...v); const w = 112, h = 38;
    const xy = pts.map((p, i) => p == null ? null : [i / (pts.length - 1) * w, h - 3 - ((p - lo) / ((hi - lo) || 1)) * (h - 6)]).filter(Boolean);
    const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '); const col = up ? 'var(--up)' : 'var(--down)';
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d} L${w} ${h} L${xy[0][0]} ${h}Z" fill="${col}" opacity=".1"/><path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/></svg>`; };
  const coinHref = a => '/coin/' + a;
  const txLink = h => `${(window.AP && AP.explorer) || 'https://basescan.org'}/tx/${h}`;
  const addrLink = a => `${(window.AP && AP.explorer) || 'https://basescan.org'}/address/${a}`;
  const isAdmin = () => window.apWallet && apWallet.connected && (window.ANYPAIR || {}).admin && apWallet.address === ANYPAIR.admin.toLowerCase();

  // ------------------------------------------------------------ toasts, dialogs, menus
  function toast(msg, opt = {}) { let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const el = document.createElement('div'); el.className = 'toast' + (opt.err ? ' err' : ''); el.innerHTML = ic(opt.err ? 'alert' : 'check') + `<div>${esc(msg)}${opt.tx ? ` <a href="${txLink(opt.tx)}" target="_blank" rel="noopener">View</a>` : ''}</div>`;
    box.appendChild(el); setTimeout(() => el.remove(), opt.err ? 7000 : 4200); }
  function dialog(title, body, opt = {}) {
    const ov = document.createElement('div'); ov.className = 'overlay'; ov.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="${opt.wide ? 'max-width:640px' : ''}"><div class="dialog-h"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">${ic('x')}</button></div>${body}</div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', key); opt.onClose && opt.onClose(); };
    const key = e => { if (e.key === 'Escape') close(); };
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); }); ov.querySelector('[data-close]').onclick = close; document.addEventListener('keydown', key);
    document.body.appendChild(ov); ov.close = close; return ov; }
  function menu(anchor, html) { $$('.menu').forEach(m => m.remove()); const m = document.createElement('div'); m.className = 'menu'; m.innerHTML = html; document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + window.scrollY + 8) + 'px'; m.style.left = Math.max(12, Math.min(window.innerWidth - m.offsetWidth - 12, r.right - m.offsetWidth)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0); return m; }
  async function copy(text, label) { try { await navigator.clipboard.writeText(text); toast((label || 'Address') + ' copied'); } catch { toast('Copy failed', { err: true }); } }

  // ------------------------------------------------------------ theme
  const THEME_KEY = 'ap:theme';
  function applyTheme(t) { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
  function currentTheme() { const t = document.documentElement.dataset.theme; return t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
  function toggleTheme() { const next = currentTheme() === 'dark' ? 'light' : 'dark'; applyTheme(next); try { localStorage.setItem(THEME_KEY, next); } catch {} paintThemeBtn(); window.apWallet && apWallet.setTheme && apWallet.setTheme(next); window.dispatchEvent(new CustomEvent('ap:theme')); }
  function paintThemeBtn() { $$('[data-theme-btn]').forEach(b => { b.innerHTML = ic(currentTheme() === 'dark' ? 'sun' : 'moon'); b.setAttribute('aria-label', currentTheme() === 'dark' ? 'Light theme' : 'Dark theme'); }); }

  // ------------------------------------------------------------ shell
  function sidebarPairs() {
    const box = $('#pairsNav'); if (!box || !window.AP) return; const list = AP.tokens().filter(x => !x.hidden); const by = {};
    for (const x of list) { const k = x.pair; (by[k] = by[k] || { sym: x.pairSym, logo: x.pairLogo, addr: k, n: 0 }).n++; }
    const cur = new URLSearchParams(location.search).get('pair');
    const rows = Object.values(by).sort((a, b) => b.n - a.n).slice(0, 8);
    box.innerHTML = rows.length ? rows.map(p => `<a href="/?pair=${p.addr}" class="${cur === p.addr ? 'on' : ''}">${tokImg({ symbol: p.sym, logo: p.logo })}<span>${esc(p.sym)}</span><span class="n">${p.n}</span></a>`).join('') : '<span class="side-h" style="text-transform:none;letter-spacing:0">No coins yet</span>';
  }
  function paintWallet() {
    const w = window.apWallet; $$('[data-wallet-btn]').forEach(b => {
      if (w && w.connected) { const wrong = w.chainId && w.chainId !== ((window.ANYPAIR || {}).chainId || 8453); b.className = 'btn btn-line wallet-btn'; b.innerHTML = wrong ? `${ic('alert')}Switch to Base` : `<span class="dot"></span><span class="mono">${esc(w.short())}</span>${ic('down')}`; }
      else { b.className = 'btn btn-ink wallet-btn'; b.innerHTML = 'Connect'; }
    });
    $$('[data-admin-link]').forEach(a => a.classList.toggle('hidden', !isAdmin()));
  }
  function walletClick(e) {
    const w = window.apWallet; if (!w) return; const b = e.currentTarget;
    if (!w.connected) return w.open();
    if (w.chainId && w.chainId !== ((window.ANYPAIR || {}).chainId || 8453)) return w.switchChain().catch(err => toast(AP.errText(err), { err: true }));
    const m = menu(b, `<a href="/portfolio">${ic('wallet')}Portfolio</a><button data-copy>${ic('copy')}Copy address</button><a href="${addrLink(w.address)}" target="_blank" rel="noopener">${ic('ext')}View on Basescan</a>${isAdmin() ? `<a href="/admin">${ic('shield')}Admin</a>` : ''}<hr><button data-out>${ic('logout')}Disconnect</button>`);
    m.querySelector('[data-copy]').onclick = () => { copy(w.address); m.remove(); }; m.querySelector('[data-out]').onclick = () => { w.logout(); m.remove(); };
  }
  // search: coins by name, ticker or address; a pasted address of an unlisted token offers the launch form
  function openSearch() {
    const ov = dialog('Search', `<div class="dialog-search">${ic('search')}<input id="sq" placeholder="Coin name, ticker or address" autocomplete="off" spellcheck="false"><kbd>ESC</kbd></div><div class="dialog-b" id="sr"></div>`);
    const inp = $('#sq', ov), out = $('#sr', ov); let sel = 0;
    const render = () => { const q = inp.value.trim().toLowerCase(); const all = (window.AP ? AP.tokens() : []).filter(x => !x.hidden);
      const hits = (q ? all.filter(x => x.name.toLowerCase().includes(q) || x.symbol.toLowerCase().includes(q) || x.addr === q || x.pairSym.toLowerCase() === q) : [...all].sort((a, b) => b.vol24 - a.vol24)).slice(0, 12);
      out.innerHTML = (q ? '' : '<div class="opt-group">Most traded today</div>') + (hits.map((x, i) => `<a class="opt ${i === sel ? 'sel' : ''}" href="${coinHref(x.addr)}">${pairGlyph(x, 'sm')}<span class="t"><b>${esc(x.name)}</b><span>$${esc(x.symbol)} · ${esc(x.pairSym)} pair</span></span><span class="r"><b>${usd(x.mc)}</b>${delta(x.c24)}</span></a>`).join('')
        || (window.AP && AP.isAddress(q) ? `<a class="opt" href="/launch?pair=${q}">${letter('+')}<span class="t"><b>Launch a coin paired with this token</b><span class="mono">${esc(short(q))}</span></span></a>` : '<div class="empty" style="padding:36px 10px"><p>No coin matches.</p></div>')); };
    inp.oninput = () => { sel = 0; render(); };
    inp.onkeydown = e => { const items = $$('.opt', out); if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); } else if (e.key === 'Enter' && items[sel]) location.href = items[sel].getAttribute('href'); };
    render(); setTimeout(() => inp.focus(), 20);
  }

  function init() {
    try { applyTheme(localStorage.getItem(THEME_KEY)); } catch {}
    paintThemeBtn(); $$('[data-theme-btn]').forEach(b => b.onclick = toggleTheme);
    $$('[data-wallet-btn]').forEach(b => b.onclick = walletClick); paintWallet();
    $$('[data-search]').forEach(b => b.onclick = openSearch);
    document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); } });
    window.addEventListener('ap:wallet', paintWallet);
    window.addEventListener('ap:nowallet', () => toast('No wallet found. Install a browser wallet or open this page in your wallet app.', { err: true }));
    const top = $('.top'); const onScroll = () => top && top.classList.toggle('scrolled', window.scrollY > 4); window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    window.addEventListener('ap:ready', sidebarPairs); window.addEventListener('ap:update', sidebarPairs);
    window.addEventListener('ap:error', e => toast('Could not reach Base: ' + e.detail, { err: true }));
    if ((window.ANYPAIR || {}).prelaunch) { const pg = $('#page'); if (pg) pg.insertAdjacentHTML('afterbegin', `<div class="notice">${ic('info')}<span><b>Anypair isn't live yet.</b> The contracts launch on Base soon. Until then you can look around and try the launch form with real Base tokens.</span><a href="https://x.com/anypairfun" target="_blank" rel="noopener">Follow for launch</a></div>`); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.UI = { $, $$, esc, ic, LOGO, usd, num, pct, delta, ago, short, letter, tokImg, coinImg, pairGlyph, hue, ident, spark, coinHref, txLink, addrLink, isAdmin, toast, dialog, menu, copy, currentTheme, openSearch };
})();
