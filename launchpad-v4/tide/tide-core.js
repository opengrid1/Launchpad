/* Kinex core: the APP object the data layer (chain.js) expects, plus helpers the views use. Wallet through
   EIP-6963 injected providers (switch or add the chain), the quote coin's USD price from Hyperliquid's info API,
   toasts and modals, formatting. No page logic here. */
(function () {
  const C = window.CFG;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n, d) => { n = Number(n) || 0; const a = Math.abs(n); if (d === undefined) d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 4; if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K'; return n.toLocaleString('en-US', { maximumFractionDigits: d }); };
  const fmtPrice = (p) => { p = Number(p) || 0; if (p === 0) return '0'; if (p >= 1) return p.toLocaleString('en-US', { maximumFractionDigits: 4 }); const z = -Math.floor(Math.log10(p)) - 1; if (z < 3) return p.toFixed(z + 4); return `0.0<sub>${z}</sub>${String(Math.round(p * 10 ** (z + 4))).padStart(4, '0')}`; };
  const fmtUsd = (n) => { n = Number(n) || 0; const a = Math.abs(n); if (a >= 1e4) return '$' + fmtNum(n); if (a >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }); if (a === 0) return '$0'; return '$' + fmtPrice(n); };
  const fmtPct = (v) => { v = Number(v) || 0; const s = (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 100 ? 0 : 1) + '%'; return `<span class="${v > 0 ? 'up' : v < 0 ? 'dn' : 'mute'}">${s}</span>`; };
  const shortAddr = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  const ago = (ts) => { const s = Math.max(0, Math.floor(Date.now() / 1000 - ts)); if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  const fmtDate = (ts) => new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const explorer = (kind, v) => `${C.chain.explorer}/${kind}/${v}`;

  const APP = window.APP = { $, $$, esc, fmtNum, fmtPrice, fmtUsd, fmtPct, shortAddr, ago, fmtDate, explorer, hypeUsd: C.chain.usd || 40, gasGwei: 0, listeners: [], onUpdate(fn) { APP.listeners.push(fn); }, emit() { for (const f of APP.listeners) try { f(); } catch (e) { console.error(e); } } };
  APP.usd = (q) => fmtUsd((Number(q) || 0) * APP.hypeUsd);
  APP.errMsg = (e) => { const m = (e && (e.shortMessage || e.message)) || String(e); if (/reject|denied|cancel/i.test(m)) return 'Transaction cancelled'; return m.length > 160 ? m.slice(0, 160) + '…' : m; };
  // a default mark: the ticker's first letter on a hue from the address
  APP.defaultImg = (sym, addr) => { const ch = ((sym || '?')[0] || '?').toUpperCase(); let h = 7; for (const c of String(addr || sym || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; const hue = h % 360; const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 60% 45%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 60% 28%)"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="32" dy=".36em" text-anchor="middle" font-family="Sora,Inter,sans-serif" font-weight="700" font-size="30" fill="#f2fffd">${ch}</text></svg>`; return 'data:image/svg+xml,' + encodeURIComponent(svg); };
  document.addEventListener('error', (e) => { const el = e.target; if (el && el.tagName === 'IMG' && el.dataset.sym !== undefined && !el.dataset.fb) { el.dataset.fb = '1'; el.src = APP.defaultImg(el.dataset.sym, el.dataset.addr); } }, true);
  APP.img = (t) => `<img src="${esc(t.img || APP.defaultImg(t.symbol, t.addr))}" alt="" data-sym="${esc(t.symbol)}" data-addr="${esc(t.addr || '')}" loading="lazy">`;
  APP.identicon = (addr) => APP.defaultImg((addr || '0x').slice(2, 3), addr);
  APP.copy = async (t, msg = 'Copied') => { try { await navigator.clipboard.writeText(t); APP.toast(msg, 'ok'); } catch { APP.toast('Copy failed', 'err'); } };
  APP.ofc = (t) => ((C.official || []).includes(String((t && t.addr) || t || '').toLowerCase()) ? '<span class="pill ofc">Official</span>' : '');

  // ---- toasts and modals
  APP.toast = (msg, kind = 'info', ms = 3400) => { const root = $('#toasts'); const t = document.createElement('div'); t.className = 'toast ' + kind; t.innerHTML = `<i></i><span>${esc(msg)}</span>`; root.appendChild(t); setTimeout(() => t.remove(), ms); return t; };
  APP.dialog = (title, body, wide = false) => { const ov = document.createElement('div'); ov.className = 'ov'; ov.innerHTML = `<div class="box${wide ? ' wide' : ''}"><div class="hd"><b>${esc(title)}</b><button class="ib" data-x aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div><div class="bd">${body}</div></div>`; ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) ov.remove(); }); $('#modal-root').appendChild(ov); return ov; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.ov').forEach((o) => o.remove()); });

  // ---- wallet: injected providers (EIP-6963), switch to or add the configured chain
  const W = APP.W = { connected: false, address: '', short: '', chainOk: false, provider: null, providers: [], name: '' };
  const wl = []; APP.onWallet = (fn) => wl.push(fn); const emitW = () => { renderWallet(); for (const f of wl) try { f(); } catch (e) { console.error(e); } };
  window.addEventListener('eip6963:announceProvider', (e) => { if (!W.providers.some((p) => p.info.uuid === e.detail.info.uuid)) W.providers.push(e.detail); });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  // Reown AppKit (C.walletConnect.projectId): the wallet modal for installed browser wallets, WalletConnect QR and mobile
  // wallets. Its bundle (wc/appkit.js and chunks) loads on the first hover or tap of Connect, or to restore a session.
  const WC_ID = (C.walletConnect || {}).projectId || '';
  const basicUi = () => { try { return localStorage.getItem('wallet-ui') === 'basic'; } catch { return false; } }; // test hook: the plain picker
  let kitP = null, kit = null;
  function appKit() {
    if (kitP) return kitP;
    kitP = (async () => {
      await import('/wc/appkit.js?v=1');
      const { createAppKit, EthersAdapter } = window.KinexAppKit;
      const nets = C.chains.filter((c) => c.evm !== false && c.id).map((c) => ({ id: c.id, name: c.name, nativeCurrency: { name: c.native || c.quote, symbol: c.native || c.quote, decimals: 18 }, rpcUrls: { default: { http: [c.rpc] } }, blockExplorers: { default: { name: c.name + ' explorer', url: String(c.explorer || '').replace(/\/#$/, '') } } }));
      const def = nets.find((n) => n.id === C.chain.id) || nets[0];
      kit = createAppKit({ adapters: [new EthersAdapter()], networks: [def, ...nets.filter((n) => n !== def)], defaultNetwork: def, projectId: WC_ID,
        metadata: { name: C.brand, description: C.tagline || C.brand, url: location.origin, icons: [location.origin + '/img/icon-192.png'] },
        features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false, history: false },
        themeMode: 'light', themeVariables: { '--w3m-accent': '#0d2522', '--w3m-font-family': 'Inter, system-ui, sans-serif', '--w3m-border-radius-master': '2px' } });
      let last = '';
      kit.subscribeAccount((a) => {
        const addr = a && a.isConnected && a.address ? String(a.address).toLowerCase() : '';
        if (addr && addr !== last) { last = addr; const prov = kit.getWalletProvider(); if (prov) useProvider(prov, 'Reown').catch((e) => APP.toast(APP.errMsg(e), 'err')); }
        if (!addr && last) { last = ''; if (W.name === 'Reown') W.disconnect(true); }
      });
      return kit;
    })();
    kitP.catch(() => { kitP = null; });
    return kitP;
  }
  async function useProvider(p, name) {
    W.provider = p; W.name = name;
    const accs = await p.request({ method: 'eth_requestAccounts' }); if (!accs || !accs[0]) throw new Error('No account');
    W.address = accs[0].toLowerCase(); W.short = shortAddr(W.address); W.connected = true;
    const cid = await p.request({ method: 'eth_chainId' }); W.chainOk = parseInt(cid, 16) === C.chain.id;
    try { localStorage.setItem('wallet', name); } catch {}
    p.on && p.on('accountsChanged', (a) => { if (!a || !a[0]) return W.disconnect(); W.address = a[0].toLowerCase(); W.short = shortAddr(W.address); emitW(); });
    p.on && p.on('chainChanged', (c) => { W.chainOk = parseInt(c, 16) === C.chain.id; emitW(); });
    emitW();
    if (!W.chainOk) W.switchChain().catch(() => {});
  }
  W.connect = () => {
    if (WC_ID && !basicUi()) { const t = kit ? null : APP.toast('Opening wallets…', 'info', 4000); appKit().then((k) => { if (t) t.remove(); k.open(); }).catch((e) => APP.toast('The wallet modal could not load: ' + APP.errMsg(e), 'err', 6000)); return; }
    const list = W.providers.length ? W.providers.map((p) => ({ name: p.info.name, icon: p.info.icon, p: p.provider })) : (window.ethereum ? [{ name: 'Browser wallet', icon: '', p: window.ethereum }] : []);
    if (!list.length) { APP.toast('No wallet found', 'err', 6000); return; }
    const ov = APP.dialog('Connect a wallet', `<div class="wl">${list.map((w, i) => `<button data-i="${i}">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : '<svg class="ico" viewBox="0 0 24 24"><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 3H6a2 2 0 0 0-2 2v2"/></svg>'}${esc(w.name)}</button>`).join('')}</div><p class="mute" style="margin-top:12px;font-size:12px">${esc(C.chain.name)} (chain ${C.chain.id}). The wallet is asked to switch to it, or to add it.</p>`);
    $$('[data-i]', ov).forEach((b) => b.onclick = async () => { const w = list[+b.dataset.i]; ov.remove(); try { await useProvider(w.p, w.name); } catch (e) { if (!/reject|closed|cancel/i.test(String(e && e.message))) APP.toast(APP.errMsg(e), 'err'); } });
  };
  W.disconnect = (fromKit) => { if (W.name === 'Reown' && kit && !fromKit) { W.name = ''; kit.disconnect().catch(() => {}); } W.connected = false; W.address = ''; W.short = ''; W.provider = null; try { localStorage.removeItem('wallet'); } catch {} emitW(); };
  W.switchChain = async () => {
    if (!W.provider) return; const ch = C.chain;
    try { await W.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ch.hex }] }); }
    catch (e) { if (e && (e.code === 4902 || /unrecognized|not added|4902/i.test(e.message || ''))) await W.provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: ch.hex, chainName: ch.name, nativeCurrency: { name: ch.native || ch.quote, symbol: ch.native || ch.quote, decimals: 18 }, rpcUrls: [ch.rpc], blockExplorerUrls: [ch.explorer.replace(/\/#$/, '')] }] }); else throw e; }
  };
  W.require = async () => { if (!W.connected) { W.connect(); throw new Error('Connect a wallet first'); } if (!W.chainOk) await W.switchChain(); };
  W.requireChain = async () => W.require();
  W.addressFor = () => (W.connected ? W.address : '');
  APP.setChain = async (k, remember = true) => { C.useChain(k, remember); if (W.provider) { try { W.chainOk = parseInt(await W.provider.request({ method: 'eth_chainId' }), 16) === C.chain.id; } catch {} } emitW(); APP.emit(); };
  APP.isAdmin = () => W.connected && W.address === String(C.admin || '').toLowerCase();
  async function autoConnect() {
    let n = ''; try { n = localStorage.getItem('wallet') || ''; } catch {} if (!n) return; await new Promise((r) => setTimeout(r, 250));
    if (n === 'Reown' || n === 'WalletConnect') { if (WC_ID) appKit().catch(() => {}); return; } // AppKit restores its own session and reports it through subscribeAccount
    const p = W.providers.find((x) => x.info.name === n); try { const prov = p ? p.provider : window.ethereum; if (!prov) return; const accs = await prov.request({ method: 'eth_accounts' }); if (accs && accs[0]) await useProvider(prov, n); } catch {}
  }
  function renderWallet() {
    const b = $('#n-wallet'); if (!b) return;
    if (!W.connected) { b.className = 'wallet'; b.textContent = 'Connect'; b.onclick = W.connect; if (WC_ID && !basicUi()) b.onpointerenter = b.ontouchstart = () => { appKit().catch(() => {}); }; return; }
    b.className = 'wallet on'; b.innerHTML = `<i style="background-image:url('${APP.identicon(W.address)}')"></i>${esc(W.short)}${W.chainOk ? '' : ' <span class="pill coral">wrong chain</span>'}`;
    b.onclick = () => { const ov = APP.dialog('Your wallet', `<div class="num" style="font-size:13px;word-break:break-all;color:var(--ink2)">${esc(W.address)}</div>${W.chainOk ? '' : `<p class="mute" style="margin-top:8px;font-size:13px">Not on ${esc(C.chain.name)}.</p>`}<a class="btn lg full pri" href="#/profile" id="w-fees" style="margin-top:16px">Your profile and fees</a><button class="btn lg full" id="w-out" style="margin-top:8px">Disconnect</button>`); $('#w-fees', ov).onclick = () => ov.remove(); $('#w-out', ov).onclick = () => { W.disconnect(); ov.remove(); }; };
  }

  // ---- prices
  async function loadPrices() {
    try { const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }), signal: AbortSignal.timeout(6000) }); const j = await r.json(); if (j && j[C.chain.quote]) APP.hypeUsd = Number(j[C.chain.quote]); if (j) APP.mids = j; (APP.priceHooks || []).forEach((f) => { try { f(); } catch {} }); } catch {}
    const px = $('#n-px span'); if (px) px.textContent = fmtUsd(APP.hypeUsd);
    APP.emit();
  }
  APP.boot = async (start) => { try { document.documentElement.style.setProperty('--chain-logo', `url('${C.chain.logo}')`); } catch {} renderWallet(); loadPrices(); setInterval(loadPrices, 30000); autoConnect(); const fx = $('#f-x'); if (fx) fx.href = C.x || '#'; await start(); };
})();
