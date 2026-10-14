/* Splice shell: formatting, gene chips, sparklines, search, wallet button, toasts, dialogs.
   Every page uses window.UI; the data always comes from window.UD. */
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
  const pct = (v, d) => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); return (v > 0 ? '+' : v < 0 ? '−' : '') + (a >= 1000 ? (a / 1000).toFixed(1) + 'K' : a.toFixed(d != null ? d : a >= 100 ? 0 : 1)) + '%'; };
  const delta = v => `<span class="delta ${!isFinite(v) || Math.abs(v) < .05 ? 'flat' : v > 0 ? 'up' : 'down'}">${pct(v)}</span>`;
  const ago = ts => { const s = Math.max(1, Date.now() / 1000 - ts); if (s < 60) return Math.floor(s) + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';

  // ------------------------------------------------------------ gene chips & glyphs
  const GENES = () => (window.UD && UD.GENES) || {};
  function geneChip(key, withLabel) {
    const g = GENES()[key]; if (!g) return '';
    return `<span class="gene ${g.cls}" title="${esc(g.name)}: ${esc(g.short)}"><span class="dot"></span>${withLabel === false ? '' : esc(g.name)}</span>`;
  }
  const geneChips = (keys, withLabel) => `<div class="genes">${(keys || []).map(k => geneChip(k, withLabel)).join('')}</div>`;
  const avatar = (c, cls) => c.img
    ? `<span class="av ${cls || ''}"><img src="${esc(c.img)}" alt=""></span>`
    : `<span class="av ${cls || ''}" style="background:linear-gradient(135deg, ${esc(c.color || 'var(--accent)')}, color-mix(in srgb, ${esc(c.color || 'var(--accent)')} 55%, #000))">${esc((c.symbol || '?').slice(0, 2).toUpperCase())}</span>`;
  const coinHref = a => '/coin/' + a;
  const txLink = h => `${EXPLORER}/tx/${h}`;
  const addrLink = a => `${EXPLORER}/address/${a}`;
  const isAdmin = () => !!(window.spWallet && spWallet.connected && CFG.admin && spWallet.address === CFG.admin.toLowerCase());

  // ------------------------------------------------------------ sparkline (inline svg)
  function sparkSvg(pts, up, w = 300, h = 40) {
    if (!pts || !pts.length) return '';
    const min = Math.min(...pts), max = Math.max(...pts), rng = max - min || 1;
    const X = i => (i / (pts.length - 1)) * w;
    const Y = v => h - 2 - ((v - min) / rng) * (h - 4);
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    const col = up == null ? 'var(--faint)' : up >= 0 ? 'var(--up)' : 'var(--down)';
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    const area = `M0 ${h} ` + pts.map((v, i) => `L${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ') + ` L${w} ${h} Z`;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  // ------------------------------------------------------------ toasts / dialogs
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
  async function copy(text, label) { try { await navigator.clipboard.writeText(text); toast((label || 'Address') + ' copied'); } catch { toast('Copy failed', { err: true }); } }
  const notLive = () => toast('Preview — launching and trading open when the contracts go live on Base.', {});

  // ------------------------------------------------------------ wallet button
  function paintWallet() {
    const w = window.spWallet;
    $$('[data-connect]').forEach(b => {
      if (w && w.connected) { const wrong = w.chainId && w.chainId !== (CFG.chainId || 8453); b.classList.remove('accent');
        b.innerHTML = wrong ? 'Switch to Base' : `<span class="mono">${esc(short(w.address))}</span>`; }
      else { b.classList.add('accent'); b.textContent = 'Connect'; }
    });
  }
  function walletClick(e) {
    const w = window.spWallet; const b = e.currentTarget;
    if (!w) return notLive();
    if (!w.connected) return w.open ? w.open() : notLive();
    if (w.chainId && w.chainId !== (CFG.chainId || 8453)) return w.switchChain && w.switchChain();
    const m = document.createElement('div'); m.className = 'menu';
    m.innerHTML = `<a href="/portfolio">${ic('wallet')}Portfolio</a><button data-copy>${ic('copy')}Copy address</button><a href="${addrLink(w.address)}" target="_blank" rel="noopener">${ic('ext')}Basescan</a><hr><button data-out>${ic('logout')}Disconnect</button>`;
    document.body.appendChild(m); const r = b.getBoundingClientRect();
    m.style.top = (r.bottom + scrollY + 8) + 'px'; m.style.left = Math.max(12, r.right - m.offsetWidth) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
    m.querySelector('[data-copy]').onclick = () => { copy(w.address); m.remove(); };
    m.querySelector('[data-out]').onclick = () => { w.logout && w.logout(); m.remove(); };
  }

  // ------------------------------------------------------------ search
  function openSearch() {
    const ov = dialog('Search coins', `<div class="dialog-search">${ic('search')}<input id="sq" placeholder="Name, ticker, gene or address" autocomplete="off" spellcheck="false"></div><div class="dialog-b" id="sr"></div>`);
    const inp = $('#sq', ov), out = $('#sr', ov);
    const render = () => { const q = inp.value.trim().toLowerCase(); const all = window.UD ? UD.tokens() : [];
      const hits = (q ? all.filter(x => x.name.toLowerCase().includes(q) || x.symbol.toLowerCase().includes(q) || x.addr === q || x.genes.some(g => g.includes(q) || (UD.gene(g) && UD.gene(g).name.toLowerCase().includes(q)))) : [...all].sort((a, b) => b.vol24 - a.vol24)).slice(0, 10);
      out.innerHTML = (q ? '' : '<div class="opt-h">Most traded</div>') + (hits.map(x => `<a class="opt" href="${coinHref(x.addr)}">${avatar(x, 'sm')}<span class="t"><b>${esc(x.name)}</b><span>$${esc(x.symbol)} · ${x.genes.length} genes</span></span><span class="r"><b>${usd(x.mc)}</b>${delta(x.c24)}</span></a>`).join('') || '<div class="empty" style="padding:30px"><p>No coin matches.</p></div>'); };
    inp.oninput = render; render(); setTimeout(() => inp.focus(), 20);
  }

  function init() {
    $$('[data-connect]').forEach(b => b.onclick = walletClick); paintWallet();
    $$('[data-search]').forEach(b => b.onclick = openSearch);
    document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } });
    window.addEventListener('sp:wallet', paintWallet);
    if (CFG.prelaunch && !/^\/docs/.test(location.pathname)) { const pg = $('#page'); if (pg) pg.insertAdjacentHTML('afterbegin',
      `<div class="notice">${ic('info')}<span><b>Preview.</b> The coins shown are examples. Launching and trading open when the Splice hook goes live on Base.</span></div>`); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.UI = { $, $$, esc, ic, usd, num, pct, delta, ago, short, geneChip, geneChips, avatar, sparkSvg, coinHref, txLink, addrLink, isAdmin, toast, dialog, copy, notLive, openSearch };
})();
