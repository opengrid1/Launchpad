/* Shell, wallet, helpers. Every page defines window.PAGE = async () => {} and app.js runs it after boot.
   Data comes from window.DATA (demo.js now, chain.js when the contracts are live), same interface either way. */
(function () {
  const C = window.CFG, E = C.econ;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICONS = {
    rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8a2 2 0 0 0-3 0z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.9 12.9 0 0 1 22 2c0 2.72-.78 7.5-6 11a22 22 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    home: '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    wallet: '<path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 3H6a2 2 0 0 0-2 2v2"/><circle cx="16" cy="14" r="1.5"/>', copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>', check: '<path d="M20 6L9 17l-5-5"/>', search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', swap: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>', chevr: '<path d="M9 18l6-6-6-6"/>', up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>', clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', plus: '<path d="M12 5v14M5 12h14"/>', today: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>', tbToday: '<path fill="currentColor" stroke="none" d="M6 2.5h12A2.5 2.5 0 0 1 20.5 5v14a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 19V5A2.5 2.5 0 0 1 6 2.5zm1.5 5a1 1 0 0 0 0 2h9a1 1 0 1 0 0-2zm0 4a1 1 0 0 0 0 2h9a1 1 0 1 0 0-2zm0 4a1 1 0 0 0 0 2h5a1 1 0 1 0 0-2z"/>', tbLaunch: '<path fill="currentColor" stroke="none" d="M20.6 3.4c-3.6-.6-7.4.9-9.8 3.9l-1.3 1.6-3.1.2a1 1 0 0 0-.7.4L3.9 12a.8.8 0 0 0 .5 1.3l2.9.5 3 3 .5 2.9a.8.8 0 0 0 1.3.5l2.5-1.8a1 1 0 0 0 .4-.7l.2-3.1 1.6-1.3c3-2.4 4.5-6.2 3.9-9.8zM15 10.3a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6zM6.3 16.2c-.9.9-1.3 3.7-1.3 3.7s2.8-.4 3.7-1.3a1.7 1.7 0 0 0-2.4-2.4z"/>', tbUser: '<path fill="currentColor" stroke="none" d="M12 12.5a4.75 4.75 0 1 0 0-9.5 4.75 4.75 0 0 0 0 9.5zm0 2c-4.4 0-8 2.5-8 5.2 0 .7.6 1.3 1.3 1.3h13.4c.7 0 1.3-.6 1.3-1.3 0-2.7-3.6-5.2-8-5.2z"/>', tbBook: '<path fill="currentColor" stroke="none" d="M4.5 4A2.5 2.5 0 0 1 7 1.5h12A1.5 1.5 0 0 1 20.5 3v15.5a1 1 0 0 1-1 1H7a1 1 0 1 0 0 2h12.5a1 1 0 1 1 0 2H7A2.5 2.5 0 0 1 4.5 21zm4 3a1 1 0 0 0 0 2h7a1 1 0 1 0 0-2z"/>', tbSearch: '<path fill="currentColor" stroke="none" d="M10.5 2.5a8 8 0 1 0 4.9 14.3l4.4 4.4a1.25 1.25 0 0 0 1.8-1.8l-4.4-4.4A8 8 0 0 0 10.5 2.5zm0 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z"/>', info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>', flame: '<path d="M12 22c4.4 0 8-3.6 8-8 0-5-4-7-4-11-2 1-3 3-3 5-1-1-2-3-2-5-3 2-7 6-7 11 0 4.4 3.6 8 8 8z"/>',
  };
  const ic = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  // ---- formatting
  const fmtNum = (n, d) => { n = Number(n) || 0; const a = Math.abs(n); if (d === undefined) d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 4; if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K'; return n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: a < 1 && a > 0 ? Math.min(d, 2) : 0 }); };
  const fmtUsd = (n) => { n = Number(n) || 0; const a = Math.abs(n); if (a >= 1e4) return '$' + fmtNum(n); if (a >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }); if (a === 0) return '$0'; return '$' + fmtPrice(n); };
  const fmtHype = (n, d) => fmtNum(n, d ?? (Math.abs(n) >= 100 ? 1 : Math.abs(n) >= 1 ? 3 : 5)) + ' HYPE';
  const fmtPrice = (p) => { p = Number(p) || 0; if (p === 0) return '0'; if (p >= 1) return p.toLocaleString('en-US', { maximumFractionDigits: 4 }); const z = -Math.floor(Math.log10(p)) - 1; if (z < 3) return p.toFixed(z + 4); return `0.0<sub>${z}</sub>${String(Math.round(p * 10 ** (z + 4))).padStart(4, '0')}`; };
  const fmtAmt = (n) => fmtNum(n, 0);
  const fmtPct = (v, cls = true) => { v = Number(v) || 0; const s = (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 100 ? 0 : 1) + '%'; return cls ? `<span class="${v > 0 ? 'up' : v < 0 ? 'dn' : 'muted'}">${s}</span>` : s; };
  const shortAddr = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  const ago = (ts) => { const s = Math.max(0, Math.floor(Date.now() / 1000 - ts)); if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  const fmtDate = (ts) => new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const tokenUrl = (x) => '/token/' + (x.addr || x);
  const explorer = (kind, v) => `${C.chain.explorer}/${kind}/${v}`;

  // ---- state and events
  const APP = window.APP = { $, $$, esc, ic, fmtNum, fmtUsd, fmtHype, fmtPrice, fmtAmt, fmtPct, shortAddr, ago, fmtDate, tokenUrl, explorer, hypeUsd: 96, gasGwei: 0, listeners: [], onUpdate(fn) { APP.listeners.push(fn); }, emit() { for (const f of APP.listeners) try { f(); } catch (e) { console.error(e); } } };
  APP.usd = (hype) => fmtUsd((Number(hype) || 0) * APP.hypeUsd);
  APP.pathAddr = () => { const m = location.pathname.match(/\/token\/(0x[0-9a-fA-F]{40})/); return m ? m[1].toLowerCase() : (new URLSearchParams(location.search).get('a') || '').toLowerCase(); };

  // ---- toast, dialog, menu
  const toasts = document.createElement('div'); toasts.id = 'toasts'; document.body.appendChild(toasts);
  APP.toast = (msg, kind = 'info', ms = 3200) => { const t = document.createElement('div'); t.className = 'toast ' + kind; t.innerHTML = `<i></i><span>${esc(msg)}</span>`; toasts.appendChild(t); setTimeout(() => t.remove(), ms); return t; };
  APP.dialog = (title, body) => { const ov = document.createElement('div'); ov.className = 'ov'; ov.innerHTML = `<div class="box"><div class="hd"><span>${esc(title)}</span><button class="btn sm ic line" data-x>${ic('x')}</button></div><div class="bd">${body}</div></div>`; ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) ov.remove(); }); document.body.appendChild(ov); return ov; };
  APP.menu = (anchor, html) => { $$('.menu').forEach((m) => m.remove()); const m = document.createElement('div'); m.className = 'menu'; m.innerHTML = html; document.body.appendChild(m); const r = anchor.getBoundingClientRect(); m.style.top = r.bottom + 6 + 'px'; m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 10) + 'px'; setTimeout(() => document.addEventListener('click', function h(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', h); } }), 0); return m; };
  APP.copy = async (t, msg = 'Copied') => { try { await navigator.clipboard.writeText(t); APP.toast(msg, 'ok'); } catch { APP.toast('Copy failed', 'err'); } };
  APP.errMsg = (e) => { const m = (e && (e.shortMessage || e.message)) || String(e); if (/reject|denied|cancel/i.test(m)) return 'Transaction cancelled'; return m.length > 140 ? m.slice(0, 140) + '…' : m; };

  // ---- wallet: injected providers (EIP-6963), HyperEVM switch or add
  const W = APP.W = { connected: false, address: '', short: '', chainOk: false, provider: null, providers: [], name: '' };
  const wl = []; APP.onWallet = (fn) => wl.push(fn); const emitW = () => { renderWallet(); for (const f of wl) try { f(); } catch (e) { console.error(e); } };
  window.addEventListener('eip6963:announceProvider', (e) => { if (!W.providers.some((p) => p.info.uuid === e.detail.info.uuid)) W.providers.push(e.detail); });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  async function useProvider(p, name) {
    W.provider = p; W.name = name;
    const accs = await p.request({ method: 'eth_requestAccounts' }); if (!accs || !accs[0]) throw new Error('No account');
    W.address = accs[0].toLowerCase(); W.short = shortAddr(W.address); W.connected = true;
    const cid = await p.request({ method: 'eth_chainId' }); W.chainOk = parseInt(cid, 16) === C.chain.id;
    localStorage.setItem('wallet', name);
    p.on && p.on('accountsChanged', (a) => { if (!a || !a[0]) return W.disconnect(); W.address = a[0].toLowerCase(); W.short = shortAddr(W.address); emitW(); });
    p.on && p.on('chainChanged', (c) => { W.chainOk = parseInt(c, 16) === C.chain.id; emitW(); });
    emitW();
    if (!W.chainOk) W.switchChain().catch(() => {});
  }
  W.connect = () => {
    if (C.mode === 'demo' && !W.providers.length && !window.ethereum) { // no wallet installed: a demo wallet so the flows can be tried
      W.connected = true; W.address = '0xd3m0' + 'a'.repeat(36); W.address = '0xd3a0' + '1b2c'.repeat(9); W.short = shortAddr(W.address); W.chainOk = true; W.name = 'Demo wallet'; emitW(); APP.toast('Demo wallet connected (no wallet extension found)', 'info'); return;
    }
    const list = W.providers.length ? W.providers.map((p) => ({ name: p.info.name, icon: p.info.icon, p: p.provider })) : [{ name: 'Browser wallet', icon: '', p: window.ethereum }];
    const ov = APP.dialog('Connect a wallet', `<div class="wl">${list.map((w, i) => `<button data-i="${i}">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ic('wallet')}${esc(w.name)}</button>`).join('')}</div><p class="hint" style="margin-top:12px">HyperEVM (chain 999). The wallet is asked to switch or add the chain.</p>`);
    $$('[data-i]', ov).forEach((b) => b.onclick = async () => { const w = list[+b.dataset.i]; ov.remove(); try { await useProvider(w.p, w.name); } catch (e) { APP.toast(APP.errMsg(e), 'err'); } });
  };
  W.disconnect = () => { W.connected = false; W.address = ''; W.short = ''; W.provider = null; localStorage.removeItem('wallet'); emitW(); };
  W.switchChain = async () => {
    if (!W.provider) return; const ch = C.chain;
    try { await W.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ch.hex }] }); }
    catch (e) { if (e && (e.code === 4902 || /unrecognized|not added|4902/i.test(e.message || ''))) await W.provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: ch.hex, chainName: ch.name, nativeCurrency: { name: ch.native, symbol: ch.native, decimals: 18 }, rpcUrls: [ch.rpc], blockExplorerUrls: [ch.explorer] }] }); else throw e; }
  };
  W.require = async () => { if (!W.connected) { W.connect(); throw new Error('Connect a wallet first'); } if (!W.chainOk) { await W.switchChain(); } };
  // Solana wallet (Phantom, Solflare, Backpack: the window.solana standard); a demo wallet when none is installed
  const S = W.sol = { connected: false, address: '', short: '', provider: null, name: '' };
  const solProviders = () => { const out = []; if (window.phantom && window.phantom.solana) out.push({ name: 'Phantom', p: window.phantom.solana }); if (window.solflare && window.solflare.isSolflare) out.push({ name: 'Solflare', p: window.solflare }); if (window.backpack && window.backpack.solana) out.push({ name: 'Backpack', p: window.backpack.solana }); if (!out.length && window.solana) out.push({ name: 'Solana wallet', p: window.solana }); return out; };
  S.connect = async () => {
    const list = solProviders();
    if (!list.length) { if (C.mode === 'demo') { S.connected = true; S.address = 'DEMo' + 'HyPe1'.repeat(8); S.short = shortAddr(S.address); S.name = 'Demo wallet'; emitW(); APP.toast('Demo Solana wallet connected (no wallet extension found)', 'info'); return; } APP.toast('No Solana wallet found. Install Phantom or Solflare.', 'err'); return; }
    const w = list[0]; try { const r = await w.p.connect(); const pk = (r && r.publicKey) || w.p.publicKey; S.address = pk.toString(); S.short = shortAddr(S.address); S.connected = true; S.provider = w.p; S.name = w.name; localStorage.setItem('solwallet', w.name); w.p.on && w.p.on('disconnect', () => S.disconnect()); emitW(); } catch (e) { APP.toast(APP.errMsg(e), 'err'); }
  };
  S.disconnect = () => { try { S.provider && S.provider.disconnect && S.provider.disconnect(); } catch {} S.connected = false; S.address = ''; S.short = ''; S.provider = null; localStorage.removeItem('solwallet'); emitW(); };
  W.requireChain = async (chain) => { if (chain === 'sol') { if (!S.connected) { await S.connect(); if (!S.connected) throw new Error('Connect a Solana wallet first'); } return; } return W.require(); };
  W.addressFor = (chain) => (chain === 'sol' ? (S.connected ? S.address : '') : (W.connected ? W.address : ''));
  async function autoConnect() {
    const n = localStorage.getItem('wallet'); await new Promise((r) => setTimeout(r, 250));
    if (n) { const p = W.providers.find((p) => p.info.name === n); try { if (p) { const accs = await p.provider.request({ method: 'eth_accounts' }); if (accs && accs[0]) await useProvider(p.provider, n); } else if (n === 'Demo wallet' && C.mode === 'demo') W.connect(); } catch {} }
    const sn = localStorage.getItem('solwallet'); if (sn) { if (sn === 'Demo wallet' && C.mode === 'demo') S.connect(); else { const w = solProviders().find((x) => x.name === sn); if (w) try { await w.p.connect({ onlyIfTrusted: true }); S.address = w.p.publicKey.toString(); S.short = shortAddr(S.address); S.connected = true; S.provider = w.p; S.name = sn; emitW(); } catch {} } }
  }
  APP.isAdmin = () => W.connected && W.address === C.admin.toLowerCase();

  // ---- shell
  const page = document.body.dataset.page || '';
  const NAV = [['/', 'Today', 'home'], ['/launch', 'Launch', 'rocket'], ['/creator', 'Creator', 'user'], ['/docs', 'How it works', 'book']];
  const CATS = [['/?sort=new', 'New'], ['/?sort=trend', 'Trending'], ['/?sort=vol', 'Top volume'], ['/?sort=mcap', 'Market cap'], ['/?sort=fees', 'Creator payouts']];
  function renderShell() {
    const side = $('#side'); if (side) side.remove();
    const top = $('#top'); if (top) top.innerHTML = `<div class="wrap"><a class="brand" href="/"><img src="/img/logo.svg" alt=""><span>${esc(C.brand)}</span></a><nav><a href="/docs" class="${page === 'docs' ? 'on' : ''}">${ic('book')}Docs</a><a href="/creator" class="${page === 'creator' ? 'on' : ''}">${ic('user')}Creator</a><a href="/launch" class="create">Create</a></nav><div class="sp"><span id="wallet-btn"></span></div></div>`;
    const tape = $('#tape'); if (tape) { const s = (window.DATA && DATA.stats) ? DATA.stats() : null; const items = s ? [`${ic('trend')}Volume <b>${fmtNum(s.vol24, 0)} HYPE</b> 24h`, `Launches <b>${s.launches}</b>`, `Paid to creators <b>${fmtNum(s.creatorsPaid, 0)} HYPE</b>`, `HYPE <b id="hype-px"><span>…</span></b>`, `Gas <b id="gas-px"><span>…</span></b> gwei`, `Fee <b>1%</b> · 70% to creators`, `Chains <b>HyperEVM · Solana</b>`] : []; const one = items.map((x) => `<span>${x}<i>|</i></span>`).join(''); tape.innerHTML = `<div class="belt">${one}${one.replace(/id="[^"]*"/g, '')}</div>`; }
    const tb = $('#tabbar'); if (tb) tb.innerHTML = `<a href="/" class="${page === 'home' ? 'on' : ''}">${ic('home')}Home</a><a href="/?sort=new#list">${ic('list')}Coins</a><a href="/launch" class="create ${page === 'launch' ? 'on' : ''}"><span>${ic('plus')}</span>Create</a><a href="/creator" class="${page === 'creator' ? 'on' : ''}">${ic('user')}Account</a><a href="/docs" class="${page === 'docs' ? 'on' : ''}">${ic('book')}Docs</a>`;
    const f = $('#foot'); if (f) f.innerHTML = `<div class="wrap"><a href="/docs">Docs</a><a href="${C.x}" target="_blank" rel="noopener">X</a><a href="/creator">Creator</a>${C.chain.contracts.factory ? `<a href="${explorer('address', C.chain.contracts.factory)}" target="_blank" rel="noopener">Factory ${shortAddr(C.chain.contracts.factory)}</a><a href="${explorer('address', C.chain.contracts.hook)}" target="_blank" rel="noopener">Hook ${shortAddr(C.chain.contracts.hook)}</a>` : `<span class="badge warn">${C.mode === 'demo' ? 'Preview on demo data. Contracts not deployed yet.' : ''}</span>`}<span>${esc(C.brand)} on HyperEVM and Solana</span></div>`;
    renderWallet();
  }
  function walletMenu(a) { const S = W.sol; const m = APP.menu(a, `${W.connected ? `<button data-a="copy">${ic('copy')}<span>HyperEVM ${esc(W.short)}</span></button>` : `<button data-a="cevm">${ic('wallet')}Connect HyperEVM wallet</button>`}${S.connected ? `<button data-a="scopy">${ic('copy')}<span>Solana ${esc(S.short)}</span></button>` : `<button data-a="csol">${ic('wallet')}Connect Solana wallet</button>`}<div class="d"></div><button data-a="cr">${ic('user')}Creator page</button>${W.connected ? `<button data-a="ex">${ic('ext')}View on HyperEVMscan</button>` : ''}${W.connected && !W.chainOk ? `<button data-a="sw">${ic('swap')}Switch to HyperEVM</button>` : ''}<div class="d"></div>${W.connected ? `<button data-a="out">${ic('logout')}Disconnect HyperEVM</button>` : ''}${S.connected ? `<button data-a="sout">${ic('logout')}Disconnect Solana</button>` : ''}`); $$('[data-a]', m).forEach((b) => b.onclick = () => { const k = b.dataset.a; m.remove(); if (k === 'copy') APP.copy(W.address, 'Address copied'); if (k === 'scopy') APP.copy(S.address, 'Address copied'); if (k === 'cevm') W.connect(); if (k === 'csol') S.connect(); if (k === 'cr') location.href = '/creator'; if (k === 'ex') open(explorer('address', W.address), '_blank'); if (k === 'sw') W.switchChain().catch((e) => APP.toast(APP.errMsg(e), 'err')); if (k === 'out') W.disconnect(); if (k === 'sout') S.disconnect(); }); }
  // the avatar circle on every page title: initials of the connected address, or a wallet glyph when not connected
  function renderWallet() { const S = W.sol; for (const el of [$('#wallet-btn'), $('#wallet-btn-m')].filter(Boolean)) { if (!W.connected && !S.connected) { el.innerHTML = `<button class="avatar off">${ic('wallet')}<span class="hm2">Connect</span></button>`; el.firstChild.onclick = W.connect; continue; } el.innerHTML = `<button class="avatar">${W.connected ? `<img src="${C.chains[0].logo}" alt="" style="width:16px;height:16px;border-radius:50%">` : `<img src="${C.chains[1].logo}" alt="" style="width:16px;height:16px;border-radius:50%">`}<span>${esc(W.connected ? W.short : S.short)}</span>${W.connected && !W.chainOk ? '<span class="badge warn">chain</span>' : ''}${ic('chevr')}</button>`; el.firstChild.onclick = (e) => walletMenu(e.currentTarget); } }

  // ---- prices: HYPE/USD from Hyperliquid's public info API, gas from the RPC
  async function loadPrices() {
    try { const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }), signal: AbortSignal.timeout(6000) }); const j = await r.json(); if (j && j.HYPE) APP.hypeUsd = Number(j.HYPE); } catch {}
    try { const r = await fetch(C.chain.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }), signal: AbortSignal.timeout(6000) }); const j = await r.json(); if (j && j.result) APP.gasGwei = parseInt(j.result, 16) / 1e9; } catch {}
    for (const p of $$('#hype-px, #hype-px b')) { const s = p.querySelector('span') || p; s.textContent = fmtUsd(APP.hypeUsd); } for (const g of $$('#gas-px, #gas-px b')) { const s = g.querySelector('span') || g; s.textContent = APP.gasGwei ? APP.gasGwei.toFixed(APP.gasGwei < 10 ? 1 : 0) : '…'; }
    APP.emit();
  }

  // ---- boot
  document.addEventListener('DOMContentLoaded', async () => {
    renderShell(); loadPrices(); setInterval(loadPrices, 30000); autoConnect();
    if (window.DATA && DATA.ready) await DATA.ready();
    if (typeof window.PAGE === 'function') { try { await window.PAGE(); } catch (e) { console.error(e); APP.toast('Page failed to load: ' + APP.errMsg(e), 'err'); } }
  });
})();
