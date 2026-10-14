/* Splice shell: formatting, gene chips, the DNA helix, sparklines, animated numbers, theme + mobile
   nav, search, wallet button, toasts, dialogs. Every page uses window.UI; data comes from window.UD. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CFG = window.SPLICE || {};
  const EXPLORER = CFG.explorer || 'https://basescan.org';

  const P = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  };
  const ic = (n, cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

  // ------------------------------------------------------------ formatting
  const tiny = v => { if (v >= 0.01) return v.toFixed(4); const [m, e] = v.toExponential(3).split('e'); const zeros = -Number(e) - 1; const digits = m.replace('.', '').slice(0, 4);
    return zeros >= 4 ? '0.0' + String(zeros).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('') + digits : '0.' + '0'.repeat(zeros) + digits; };
  const usd = (v, opt = {}) => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); const s = v < 0 ? '−$' : '$'; const c = opt.compact !== false;
    if (c && a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B'; if (c && a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M'; if (c && a >= 1e4) return s + (a / 1e3).toFixed(1) + 'K'; if (c && a >= 1e3) return s + (a / 1e3).toFixed(2) + 'K';
    if (a >= 1) return s + a.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: a < 1000 ? 2 : 0 }); if (a === 0) return '$0'; return s + tiny(a); };
  const num = (v, d = 2) => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
    if (a >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: d }); if (a === 0) return '0'; return a >= 0.0001 ? v.toPrecision(3) : tiny(a); };
  const eth = (v, d = 4) => v == null || !isFinite(v) ? '—' : (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toFixed(d)).replace(/\.?0+$/, '') + ' ETH';
  const pct = (v, d) => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); return (v > 0 ? '+' : v < 0 ? '−' : '') + (a >= 1000 ? (a / 1000).toFixed(1) + 'K' : a.toFixed(d != null ? d : a >= 100 ? 0 : 1)) + '%'; };
  const delta = (v, cls) => `<span class="delta ${cls || ''} ${!isFinite(v) || Math.abs(v) < .05 ? 'flat' : v > 0 ? 'up' : 'down'}">${pct(v)}</span>`;
  const ago = ts => { const s = Math.max(1, Date.now() / 1000 - ts); if (s < 60) return Math.floor(s) + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';

  // ------------------------------------------------------------ animated number (tween + flash)
  function tick(el, value, fmt) {
    if (!el) return; fmt = fmt || (v => num(v));
    const from = Number(el.dataset.v); const to = Number(value);
    el.dataset.v = to;
    if (!isFinite(from) || from === to || UD.reduceMotion) { el.textContent = fmt(to); if (isFinite(from) && to !== from) flash(el, to > from); return; }
    flash(el, to > from);
    const t0 = performance.now(), dur = 420;
    const run = t => { const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(run); };
    requestAnimationFrame(run);
  }
  function flash(el, up) { el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(up ? 'flash-up' : 'flash-down'); setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 650); }

  // ------------------------------------------------------------ gene chips & the DNA helix
  const GENES = () => (window.UD && UD.GENES) || {};
  const geneColor = { fee: 'var(--accent)', snipe: 'var(--warn)', buyback: 'var(--up)', div: 'var(--g-div)', maxw: 'var(--g-maxw)', agent: 'var(--accent)' };
  // two-letter base-pair codes: the genetic shorthand used everywhere a dot used to be
  const geneCode = { fee: 'FE', snipe: 'AS', buyback: 'BB', div: 'DV', maxw: 'MW', agent: 'AG' };
  const gc = k => `<b class="gc gc-${k}">${geneCode[k] || '??'}</b>`;
  function geneChip(key, withLabel) { const g = GENES()[key]; if (!g) return '';
    return withLabel === false ? gc(key)
      : `<span class="gene ${g.cls}" title="${esc(g.name)}: ${esc(g.short)}">${gc(key)}<span>${esc(g.name)}</span></span>`; }
  const geneChips = (keys, withLabel) => `<div class="genes">${(keys || []).map(k => geneChip(k, withLabel)).join('')}</div>`;
  const spec = c => `<span class="spec">${esc(c.spec || '')}</span>`;

  // a double-helix that lights a rung per active gene (the brand anchor)
  function helix(activeKeys, opt = {}) {
    const order = (window.UD && UD.GENE_ORDER) || ['fee', 'snipe', 'buyback', 'div', 'maxw', 'agent'];
    const active = new Set(activeKeys || []);
    const w = opt.w || 240, h = opt.h || 60, pad = 14, amp = (h - pad * 2) / 2, cy = h / 2;
    const turns = opt.turns || 1.6, N = 70;
    const ax = i => pad + (i / (N - 1)) * (w - pad * 2);
    const ay = (i, s) => cy + s * amp * Math.sin((i / (N - 1)) * Math.PI * 2 * turns + (s < 0 ? Math.PI : 0));
    const path = s => { let d = ''; for (let i = 0; i < N; i++) d += (i ? 'L' : 'M') + ax(i).toFixed(1) + ' ' + ay(i, s).toFixed(1) + ' '; return d; };
    const n = order.length; let rungs = '';
    for (let j = 0; j < n; j++) {
      const i = Math.round(((j + 0.5) / n) * (N - 1));
      const y1 = ay(i, 1), y2 = ay(i, -1), on = active.has(order[j]), col = geneColor[order[j]] || 'var(--accent)';
      rungs += `<line x1="${ax(i).toFixed(1)}" y1="${y1.toFixed(1)}" x2="${ax(i).toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${on ? col : 'var(--line-2)'}" stroke-width="${on ? 2.4 : 1.4}" stroke-linecap="round" opacity="${on ? 1 : .5}"/>`;
      rungs += `<circle cx="${ax(i).toFixed(1)}" cy="${y1.toFixed(1)}" r="${on ? 3.2 : 2}" fill="${on ? col : 'var(--line-2)'}"/><circle cx="${ax(i).toFixed(1)}" cy="${y2.toFixed(1)}" r="${on ? 3.2 : 2}" fill="${on ? col : 'var(--line-2)'}"/>`;
    }
    return `<svg class="helix" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d="${path(1)}" fill="none" stroke="var(--accent)" stroke-width="2" opacity=".85"/>
      <path d="${path(-1)}" fill="none" stroke="var(--ink)" stroke-width="2" opacity=".35"/>${rungs}</svg>`;
  }

  const avatar = (c, cls) => c.img
    ? `<span class="av ${cls || ''}"><img src="${esc(c.img)}" alt=""></span>`
    : `<span class="av ${cls || ''}" style="background:linear-gradient(135deg, ${esc(c.color || 'var(--accent)')}, color-mix(in srgb, ${esc(c.color || 'var(--accent)')} 50%, #000))">${esc((c.symbol || '?').slice(0, 2).toUpperCase())}</span>`;
  const coinHref = a => '/coin/' + a;
  const txLink = h => `${EXPLORER}/tx/${h}`;
  const addrLink = a => `${EXPLORER}/address/${a}`;
  const isAdmin = () => !!(window.spWallet && spWallet.connected && CFG.admin && spWallet.address === CFG.admin.toLowerCase());

  // ------------------------------------------------------------ sparkline
  function sparkSvg(pts, up, w = 300, h = 40) {
    if (!pts || !pts.length) return '';
    const min = Math.min(...pts), max = Math.max(...pts), rng = max - min || 1;
    const X = i => (i / (pts.length - 1)) * w, Y = v => h - 2 - ((v - min) / rng) * (h - 4);
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    const col = up == null ? 'var(--faint)' : up >= 0 ? 'var(--up)' : 'var(--down)';
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    const area = `M0 ${h} ` + pts.map((v, i) => `L${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ') + ` L${w} ${h} Z`;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  // sparkline derived from a coin's candles (shared across cards)
  function coinSpark(c, w, h) { const cd = UD.candles(c.addr, '1D'); return sparkSvg(cd.map(x => x.c), c.c24, w, h); }

  // ------------------------------------------------------------ toasts / dialogs / menu
  function toast(msg, opt = {}) { let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const el = document.createElement('div'); el.className = 'toast' + (opt.err ? ' err' : ''); el.innerHTML = `<div>${esc(msg)}${opt.tx ? ` <a href="${txLink(opt.tx)}" target="_blank" rel="noopener">View</a>` : ''}</div>`;
    box.appendChild(el); setTimeout(() => el.remove(), opt.err ? 7000 : 4200); }
  function dialog(title, body, opt = {}) {
    const ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="${opt.wide ? 'max-width:620px' : ''}"><div class="dialog-h"><h3>${esc(title)}</h3><button class="iconbtn" data-close aria-label="Close">${ic('x')}</button></div>${body}</div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', key); };
    const key = e => { if (e.key === 'Escape') close(); };
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); }); ov.querySelector('[data-close]').onclick = close; document.addEventListener('keydown', key);
    document.body.appendChild(ov); ov.close = close; return ov; }
  function menu(anchor, html) { $$('.menu').forEach(m => m.remove()); const m = document.createElement('div'); m.className = 'menu'; m.innerHTML = html; document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + scrollY + 8) + 'px'; m.style.left = Math.max(12, Math.min(innerWidth - m.offsetWidth - 12, r.right - m.offsetWidth)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0); return m; }
  async function copy(text, label) { try { await navigator.clipboard.writeText(text); toast((label || 'Address') + ' copied'); } catch { toast('Copy failed', { err: true }); } }
  const notLive = () => toast('Preview — launching and trading open when the Splice hook goes live on Base.', {});

  // ------------------------------------------------------------ theme
  function applyTheme(t) { const r = document.documentElement; if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
    try { t ? localStorage.setItem('sp-theme', t) : localStorage.removeItem('sp-theme'); } catch (e) {}
    $$('[data-theme-btn]').forEach(b => b.innerHTML = currentTheme() === 'dark' ? ic('sun') : ic('moon'));
    window.dispatchEvent(new Event('sp:theme')); }
  function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'dark'; } // the site is dark-first
  function initTheme() { let saved = null; try { saved = localStorage.getItem('sp-theme'); } catch (e) {} if (saved) applyTheme(saved); else applyTheme(null); }

  // ------------------------------------------------------------ wallet button
  function paintWallet() { const w = window.spWallet; $$('[data-connect]').forEach(b => {
    if (w && w.connected) { const wrong = w.chainId && w.chainId !== (CFG.chainId || 8453); b.classList.remove('accent');
      b.innerHTML = wrong ? 'Switch to Base' : `<span class="mono">${esc(short(w.address))}</span>`; }
    else { b.classList.add('accent'); b.textContent = 'Connect'; } }); }
  function walletClick(e) { const w = window.spWallet; const b = e.currentTarget;
    if (!w) return notLive();
    if (!w.connected) return w.open ? w.open() : notLive();
    if (w.chainId && w.chainId !== (CFG.chainId || 8453)) return w.switchChain && w.switchChain();
    const m = menu(b, `<a href="/portfolio">${ic('wallet')}Portfolio</a><button data-copy>${ic('copy')}Copy address</button><a href="${addrLink(w.address)}" target="_blank" rel="noopener">${ic('ext')}Basescan</a><hr><button data-out>${ic('logout')}Disconnect</button>`);
    m.querySelector('[data-copy]').onclick = () => { copy(w.address); m.remove(); };
    m.querySelector('[data-out]').onclick = () => { w.logout && w.logout(); m.remove(); }; }

  // ------------------------------------------------------------ search
  function openSearch() {
    const ov = dialog('Search coins', `<div class="dialog-search">${ic('search')}<input id="sq" placeholder="Name, ticker, gene or address" autocomplete="off" spellcheck="false"></div><div class="dialog-b" id="sr"></div>`);
    const inp = $('#sq', ov), out = $('#sr', ov);
    const render = () => { const q = inp.value.trim().toLowerCase(); const all = window.UD ? UD.tokens() : [];
      const hits = (q ? all.filter(x => x.name.toLowerCase().includes(q) || x.symbol.toLowerCase().includes(q) || x.addr === q || x.genes.some(g => g.includes(q) || (UD.gene(g) && UD.gene(g).name.toLowerCase().includes(q)))) : UD.trending()).slice(0, 10);
      out.innerHTML = (q ? '' : '<div class="opt-h">Trending</div>') + (hits.map(x => `<a class="opt" href="${coinHref(x.addr)}">${avatar(x, 'sm')}<span class="t"><b>${esc(x.name)}</b>${geneChips(x.genes, false)}</span><span class="r"><b>${usd(x.mc)}</b>${delta(x.c24)}</span></a>`).join('') || '<div class="empty" style="padding:30px"><p>No coin matches.</p></div>'); };
    inp.oninput = render; render(); setTimeout(() => inp.focus(), 20);
  }

  // ------------------------------------------------------------ mobile nav
  function openNav() { const links = $$('.nav .navlink').map(a => `<a href="${a.getAttribute('href')}">${a.textContent}</a>`).join('');
    const ov = dialog('Menu', `<div class="dialog-b navsheet">${links}<a href="/launch" class="btn accent wide" style="margin-top:8px">Splice a coin</a></div>`); return ov; }

  function init() {
    initTheme();
    $$('[data-connect]').forEach(b => b.onclick = walletClick); paintWallet();
    $$('[data-search]').forEach(b => b.onclick = openSearch);
    $$('[data-theme-btn]').forEach(b => b.onclick = () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
    $$('[data-nav-btn]').forEach(b => b.onclick = openNav);
    document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } });
    window.addEventListener('sp:wallet', paintWallet);
    if (CFG.prelaunch && !/^\/docs/.test(location.pathname)) { const pg = $('#page'); if (pg) pg.insertAdjacentHTML('afterbegin',
      `<div class="notice">${ic('info')}<span><b>Preview.</b> Coins, prices and trades here are a deterministic sample, not live chain data. Launching and trading open when the Splice hook goes live on Base.</span></div>`); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.UI = { $, $$, esc, ic, usd, num, eth, pct, delta, ago, short, tick, flash, geneChip, geneChips, geneCode, gc, spec, helix, geneColor, avatar, sparkSvg, coinSpark, coinHref, txLink, addrLink, isAdmin, toast, dialog, menu, copy, notLive, openSearch, applyTheme, currentTheme };
})();
