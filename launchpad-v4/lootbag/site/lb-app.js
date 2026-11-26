/* Lootbag front-end: hash routes #/ (board), #/coin/<addr>, #/create, #/rewards, #/airdrops, #/bags, #/mint,
   #/coins, #/loot, #/how. Reads window.LB_DATA, which lb-live.js builds from the contracts on Base, and sends every
   wallet action through window.LB_LIVE. Wallets connect through Reown. */
(function () {
  const D = window.LB_DATA, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const view = $('#view');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (v, d) => { v = Number(v) || 0; const a = Math.abs(v); if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'; if (a >= 1e4) return '$' + (v / 1e3).toFixed(1) + 'K'; if (a >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }); if (a >= 1) return '$' + v.toFixed(d ?? 2); if (a === 0) return '$0'; return '$' + v.toPrecision(3); };
  const num = (v, d = 2) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
  const pct = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
  const ago = (ts) => { const s = Math.max(1, Math.floor(Date.now() / 1000 - ts)); if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  const mmss = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const toast = (m) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), Math.min(9000, 2600 + String(m).length * 45)); };

  // ---------- marks: coin avatars and stock badges are drawn, not fetched
  // a coin's picture: its uploaded image when it has one, otherwise a pixel sack drawn from its address
  const av = (c, size = 44) => `<span class="av${c.official ? '' : ' art'}" style="width:${size}px;height:${size}px;${c.official ? 'background:var(--logo-bg)' : ''}">${c.official ? `<img src="/img/logo.svg?v=3" alt="" style="width:64%;height:64%">` : c.img ? `<img src="${esc(c.img)}" alt="">` : bagArt(2000 + parseInt(c.addr.slice(2, 9), 16) % 100000)}</span>`;
  const stkHue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const STK_LOGO = new Set(['AAOI', 'AAPL', 'ADBE', 'AMD', 'AMZN', 'ANT', 'ARM', 'AVGO', 'BE', 'BIDU', 'BILI', 'BRK.B', 'BUD', 'COIN', 'CRCL', 'CRWV', 'ETH', 'FGI', 'GME', 'GOOGL', 'GRND', 'HIMS', 'HOOD', 'HSAI', 'INFY', 'INTC', 'KO', 'LI', 'LITE', 'LLY', 'MCD', 'META', 'MRNA', 'MRVL', 'MSFT', 'MSTR', 'MU', 'NFLX', 'NIO', 'NKE', 'NOK', 'NOW', 'NVDA', 'NVO', 'ORCL', 'PDD', 'PLTR', 'SAN', 'SAP', 'SE', 'SGOV', 'SKHY', 'SNDK', 'SNOW', 'SONY', 'SPCX', 'SPYM', 'TSLA', 'TTWO', 'UBER', 'UL', 'USDC', 'VALE', 'VVV', 'WDC', 'WRD']), STK_LIGHT = new Set(['TTWO', 'VVV', 'SONY']);
  const tokenBadge = (s, size = 20) => {
    const z = `width:${size}px;height:${size}px`;
    if (s === 'LOOT') return `<img class="tkl" src="/img/logo.svg?v=3" alt="" style="${z};border-radius:50%;background:var(--logo-bg);padding:${Math.round(size * 0.14)}px">`;
    if (STK_LOGO.has(s)) return `<span class="stk lg${STK_LIGHT.has(s) ? ' lt' : ''}" style="${z}" title="${esc(s)}"><img src="/img/stk/${esc(s)}.png" alt="" loading="lazy"></span>`;
    return `<span class="stk" style="${z};background:hsl(${stkHue(s)} 55% 42%);font-size:${Math.max(7, Math.round(size * 0.3))}px">${esc(s.slice(0, 4))}</span>`;
  };
  const stack = (list, n = 4) => `<span class="stack">${list.slice(0, n).map((s) => tokenBadge(s)).join('')}</span>${list.length > n ? ` <span class="dim">+${list.length - n}</span>` : ''}`;
  const label = (s) => s;
  const pays = (c) => c.rewards.map(label).join(', ');
  const CRYPTO = ['ETH', 'USDC', 'VVV'], isStock = (s) => !CRYPTO.includes(s) && s !== 'LOOT';

  // ---------- nav
  // nav icons: one 24px grid, 1.75 stroke, round caps and joins
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    home: svg('<path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z"/>'),
    sack: svg('<path d="M9.2 3.6c.9.7 1.8 1 2.8 1s1.9-.3 2.8-1L13.7 7h-3.4z"/><path d="M10.1 7h3.8c3.2 1.8 5.4 4.7 5.4 8 0 3.4-2.9 5.5-7.3 5.5S4.7 18.4 4.7 15c0-3.3 2.2-6.2 5.4-8z"/><path d="M9.3 14.6c1.8 1.1 3.6 1.1 5.4 0"/>'),
    grid: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'),
    gift: svg('<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7M12 8v12.5"/><path d="M12 8C11 5 9.6 3.5 8 3.5a2.2 2.2 0 0 0 0 4.5zM12 8c1-3 2.4-4.5 4-4.5a2.2 2.2 0 0 1 0 4.5z"/>'),
    chute: svg('<path d="M3 11a9 9 0 0 1 18 0z"/><path d="M3 11l7 7M21 11l-7 7M12 11v7"/><rect x="9.5" y="18" width="5" height="3.5" rx="1"/>'),
    mint: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M12 8.5v7M8.5 12h7"/>'),
    book: svg('<path d="M12 6.8v13.7"/><path d="M3.5 5.2c2.9-.9 5.7-.6 8.5 1.6 2.8-2.2 5.6-2.5 8.5-1.6v13.3c-2.9-.9-5.7-.6-8.5 1.6-2.8-2.2-5.6-2.5-8.5-1.6z"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
  };
  const NAV = [['Trade', [['#/', 'Board', 'home'], ['#/coins', 'Lootbag coins', 'sack'], ['#/bags', 'Bags', 'grid']]], ['Earn', [['#/rewards', 'Rewards', 'gift'], ['#/airdrops', 'Airdrops', 'chute'], ['#/mint', 'Mint', 'mint']]], ['Learn', [['#/how', 'How it works', 'book']]]];
  $('#nav').innerHTML = NAV.map(([g, items]) => `<h6>${g}</h6>` + items.map(([h, l, i]) => `<a href="${h}" data-r="${h}">${I[i]}<span>${l}</span></a>`).join('')).join('');
  $('#tabbar').innerHTML = [['#/', 'Board', 'home'], ['#/create', 'Create', 'plus', 'plus'], ['#/coins', 'Lootbag coins', 'sack'], ['#/bags', 'Bags', 'grid'], ['#/rewards', 'Rewards', 'gift'], ['#/airdrops', 'Airdrops', 'chute'], ['#/mint', 'Mint', 'mint'], ['#/how', 'How it works', 'book']].map(([h, l, i, c]) => `<a href="${h}" data-r="${h}" class="${c || ''}" aria-label="${l}">${I[i]}</a>`).join('');
  // ---------- wallet: Reown AppKit (LB_CFG.walletConnect.projectId), loaded the first time someone connects.
  // The connected wallet's provider goes to LB_LIVE, which sends every transaction.
  const CFG = window.LB_CFG || {}, WC_ID = (CFG.walletConnect || {}).projectId || '', LIVE = window.LB_LIVE, K = CFG.contracts;
  // localStorage 'wallet-ui' = 'basic' (a test hook) uses the browser's own wallet instead of the Reown window
  const basicUi = () => { try { return localStorage.getItem('wallet-ui') === 'basic'; } catch (e) { return false; } };
  let kitP = null, wallet = '', acct = null, onWallet = null, onData = null;
  const paintWallet = () => {
    $$('[data-connect], [data-connect2]').forEach((b) => { b.textContent = wallet ? short(wallet) : 'Connect wallet'; });
    // buttons that need a wallet (trade, launch, mint): "Connect wallet" until one is connected, then what they do
    $$('[data-wallet]').forEach((b) => { b.textContent = wallet ? b.dataset.label : 'Connect wallet'; });
  };
  // the connected wallet's ETH, coins and unclaimed rewards; the page on screen repaints through onWallet
  async function loadAcct() {
    if (!wallet) acct = null; else { try { acct = await LIVE.account(wallet); } catch (e) { /* keep the last one */ } }
    if (onWallet) onWallet();
  }
  async function adopt(provider) {
    try { wallet = await LIVE.setProvider(provider); } catch (e) { wallet = ''; toast(LIVE.explain(e)); }
    paintWallet(); loadAcct();
  }
  function appKit() {
    if (kitP) return kitP;
    kitP = (async () => {
      await import('/wc/appkit.js?v=1');
      const { createAppKit, EthersAdapter } = window.KinexAppKit;
      const net = { id: CFG.chainId, name: CFG.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [CFG.rpc] } }, blockExplorers: { default: { name: 'BaseScan', url: CFG.explorer } } };
      const kit = createAppKit({
        adapters: [new EthersAdapter()], networks: [net], defaultNetwork: net, projectId: WC_ID,
        metadata: { name: 'Lootbag', description: 'Coins that pay their holders', url: location.origin, icons: [location.origin + '/img/apple-icon.png'] },
        features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false, history: false },
        themeMode: 'dark', themeVariables: { '--w3m-accent': '#f4b740', '--w3m-font-family': "'Space Grotesk', system-ui, sans-serif", '--w3m-border-radius-master': '2px' },
      });
      let last = '';
      kit.subscribeAccount((a) => {
        const addr = a && a.isConnected && a.address ? String(a.address).toLowerCase() : '';
        if (addr && addr !== last) { const prov = kit.getWalletProvider(); if (prov) { last = addr; adopt(prov); } }
        else if (!addr && last) { last = ''; adopt(null); }
      });
      return kit;
    })();
    kitP.catch(() => { kitP = null; });
    return kitP;
  }
  const openWallet = () => {
    if (basicUi() || !WC_ID) {
      if (!window.ethereum) return toast('No wallet found in this browser.');
      if (!wallet) window.ethereum.request({ method: 'eth_requestAccounts' }).then(() => adopt(window.ethereum)).catch((e) => toast(LIVE.explain(e)));
      return;
    }
    if (!kitP) toast('Opening wallets…');
    appKit().then((k) => k.open()).catch(() => toast('The wallet window could not load. Try again.'));
  };
  const bindConnect = () => { $$('[data-connect], [data-connect2]').forEach((b) => (b.onclick = openWallet)); paintWallet(); };
  // a button that needs a wallet: it opens the wallet window until one is connected, then does `act`
  const needsWallet = (b, label, act) => { b.dataset.wallet = '1'; b.dataset.label = label; b.onclick = () => (wallet ? act() : openWallet()); paintWallet(); };
  // one wallet action at a time: its progress shows on the button, its result or its reason for failing in a toast
  let working = false;
  async function run(b, fn, done) {
    if (working) return null;
    working = true; b.disabled = true;
    const was = b.textContent, note = (m) => { b.textContent = m; };
    try { const r = await fn(note); toast(typeof done === 'function' ? done(r) : done); loadAcct(); return r; }
    catch (e) { toast(LIVE.explain(e)); return null; }
    finally { working = false; b.disabled = false; b.textContent = was; paintWallet(); }
  }
  bindConnect();
  // AppKit restores an earlier session by itself and reports it through subscribeAccount
  try { if (WC_ID && !basicUi() && Object.keys(localStorage).some((k) => /^(@appkit|wc@2|@w3m)/.test(k))) appKit().catch(() => {}); } catch (e) { /* storage unavailable */ }

  // the strip under the header says what state Lootbag is in; the $LOOT chip shows its price once it exists
  const tkn = (v, d = 4) => { v = Number(v) || 0; const min = 10 ** -d; return v === 0 ? '0' : v >= 1000 ? num(v, 0) : v >= 1 ? num(v, 2) : v < min ? '<' + min.toFixed(d) : num(v, d); };
  const ex = (kind, a) => `${CFG.explorer}/${kind}/${a}`;
  function status() {
    const bar = $('.preview-bar');
    if (bar) { const m = D.error ? "Can't reach Base right now. Retrying…" : D.paused ? "Lootbag's contracts are live on Base. Launches are not open yet." : ''; bar.textContent = m; bar.hidden = !m; }
    const chip = $('.chip-price'), loot = D.coins.find((x) => x.official);
    if (chip) {
      chip.innerHTML = loot ? `<a href="#/loot"><b>$LOOT</b> <span class="px">${usd(loot.priceUsd)}</span></a><i class="sep"></i><button class="ca" data-copyloot>${short(loot.addr)}</button>` : `<a href="#/loot"><b>$LOOT</b> <span class="px mute">not launched yet</span></a>`;
      const b = $('[data-copyloot]'); if (b) b.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(loot.addr); toast('$LOOT address copied'); };
    }
  }

  const foot = () => `<footer class="foot"><div class="fr"><b>© ${new Date().getFullYear()} Lootbag</b><span><a href="#/how#contracts">Contracts</a><a href="#" data-pv>Terms</a><a href="#" data-pv>Privacy</a><a href="https://x.com/lootbag_fun" target="_blank" rel="noopener">X</a></span></div><p>Tokens on Lootbag are launched by their creators, not by Lootbag. They are highly risky and can lose all their value. Nothing here is financial advice.</p></footer>`;
  const hms = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm ' + (s % 60) + 's'; };
  let timers = [];
  const every = (ms, f) => timers.push(setInterval(f, ms));

  // ---------- board
  const state = { tab: 'trending', chip: '', q: '' };
  function board() {
    const cs = D.coins;
    view.innerHTML = `
      <section class="hero">
        <svg class="waves" viewBox="0 0 1200 150" preserveAspectRatio="none" fill="none" stroke="var(--blue)" stroke-opacity=".45" stroke-width="2"><path d="M0 95C150 20 250 20 400 95S650 170 800 95 1050 20 1200 95"/><path d="M0 125C150 50 250 50 400 125S650 200 800 125 1050 50 1200 125"/></svg>
        <div>
          <h1>Hold the bag.<br><span>Get paid in stocks.</span></h1>
          <p>Launch a coin on VVV, ETH, USDC or a stock. Every trade pays your holders in VVV or stocks, and traders earn VVV airdrops.</p>
          <div class="acts"><a class="btn blue pill" href="#/create">Launch a coin</a></div>
        </div>
      </section>
      <div class="bar">${[['trending', 'Trending'], ['new', 'New'], ['paying', 'Paying now'], ['top', 'Top']].map(([k, l]) => `<button class="tab ${state.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}<span class="live">${cs.length} live</span></div>
      <div class="chips">${[['pVVV', 'Paired with VVV'], ['pETH', 'Paired with ETH'], ['pSTK', 'Paired with a stock'], ['stocks', 'Pays stocks'], ['eth', 'Pays ETH']].map(([k, l]) => `<button class="fchip ${state.chip === k ? 'on' : ''}" data-chip="${k}">${l}</button>`).join('')}</div>
      <div class="grid" id="grid"></div>${foot()}`;
    $$('[data-tab]').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; board(); }));
    $$('[data-chip]').forEach((b) => (b.onclick = () => { state.chip = state.chip === b.dataset.chip ? '' : b.dataset.chip; board(); }));
    drawGrid();
    every(1000, tickCards);
    onData = () => { drawGrid(); const l = $('.bar .live'); if (l) l.textContent = D.coins.length + ' live'; };
  }
  function filtered() {
    let cs = D.coins.slice();
    const q = state.q.toLowerCase();
    if (q) cs = cs.filter((c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q) || c.addr.toLowerCase().includes(q));
    const f = { stocks: (c) => c.rewards.some(isStock), eth: (c) => c.rewards.includes('ETH'), pVVV: (c) => c.pair === 'VVV', pETH: (c) => c.pair === 'ETH', pUSDC: (c) => c.pair === 'USDC', pSTK: (c) => isStock(c.pair) }[state.chip];
    if (f) cs = cs.filter(f);
    const sort = { trending: (a, b) => b.vol24 - a.vol24, new: (a, b) => b.createdAt - a.createdAt, paying: (a, b) => b.paid24 - a.paid24, top: (a, b) => b.mcap - a.mcap }[state.tab];
    return cs.sort(sort);
  }
  function card(c) {
    return `<a class="card coin" href="#/coin/${c.addr}">
      <span class="ghost">${av(c, 170)}</span>${c.official ? '<span class="badge">Lootbag</span>' : ''}
      <span class="in">${av(c, 44)}
        <div class="tkl"><b>$${esc(c.ticker)}</b><span>${esc(c.name)}</span></div>
        <div class="mc">${usd(c.mcap)}</div>
        <div class="l1">${c.official ? 'Lootbag coin' : `Paired to ${tokenBadge(c.pair, 16)} <b>${esc(CRYPTO.includes(c.pair) ? c.pair : '$' + label(c.pair))}</b>`}</div>
        <div class="l2">Pays ${esc(c.rewards.slice(0, 2).map(payTok).join(' · '))}${c.rewards.length > 2 ? ' +' + (c.rewards.length - 2) : ''}</div>
      </span></a>`;
  }
  function drawGrid() { const g = $('#grid'); if (g) g.innerHTML = filtered().map(card).join('') || `<p class="mute">${D.coins.length ? 'No coins match.' : D.paused ? 'No coins yet. Launches are not open yet.' : 'No coins yet. Be the first to launch one.'}</p>`; }
  function tickCards() {
    for (const c of D.coins) c.nextPayout = c.nextPayout <= 1 ? 300 : c.nextPayout - 1;
    $$('[data-next]').forEach((el) => { const c = D.coins.find((x) => x.addr === el.dataset.next); if (c) el.textContent = 'Next drop ' + mmss(c.nextPayout); });
  }

  // ---------- coin page
  function coin(a) {
    const c = D.coins.find((x) => x.addr.toLowerCase() === String(a).toLowerCase());
    if (!c) { view.innerHTML = `<a class="back" href="#/">← Board</a><h1>${a ? 'Coin not found' : '$LOOT has not launched yet'}</h1><p class="mute">${a ? 'No Lootbag coin has this address.' : 'Its address will be shown here and in the header when it does.'}</p>`; return; }
    const pairL = CRYPTO.includes(c.pair) ? c.pair : '$' + label(c.pair), key = c.addr.toLowerCase();
    const routeTxt = c.pair === 'ETH' ? 'Trades straight against <b>ETH</b>' : `You pay and receive ETH. Route: ETH → ${c.pair === 'USDC' ? '' : 'USDC → '}${esc(pairL)} → $${esc(c.ticker)}`;
    const rewardsTxt = esc(c.rewards.map(payTok).join(', '));
    view.innerHTML = `<a class="back" href="#/">← Board</a>
      <div class="cp">
        <div>
      <div class="chead"><div class="lg">${av(c, 64)}<span class="pb">${tokenBadge(c.pair, 24)}</span></div>
        <div style="min-width:0"><h1>${esc(c.name)}<span>$${esc(c.ticker)}</span></h1><div class="sub">Paired to <b>${esc(pairL)}</b> · holders are paid in ${rewardsTxt} · ${ago(c.createdAt)} ago</div></div>
        <div class="links"><button class="btn sm" data-copy>Copy address <span class="mono">${short(c.addr)}</span></button>${c.x ? `<a class="btn sm" href="${esc(c.x)}" target="_blank" rel="noopener nofollow">X ↗</a>` : ''}${c.tg ? `<a class="btn sm" href="${esc(c.tg)}" target="_blank" rel="noopener nofollow">Telegram ↗</a>` : ''}${c.web ? `<a class="btn sm" href="${esc(c.web)}" target="_blank" rel="noopener nofollow">Website ↗</a>` : ''}<a class="btn sm" href="https://dexscreener.com/base/${c.addr}" target="_blank" rel="noopener">DexScreener ↗</a><a class="btn sm" href="${ex('token', c.addr)}" target="_blank" rel="noopener">Explorer ↗</a></div></div>
      ${c.desc ? `<p class="mute" style="margin:14px 0 0;font-size:14.5px;line-height:1.6">${esc(c.desc)}</p>` : ''}
      <div class="kpis"><div><span>Market cap</span><b class="up" id="k-mc"></b></div><div><span>Price</span><b id="k-px"></b></div><div><span>Price in ${esc(pairL)}</span><b id="k-pq"></b></div><div><span>Holders</span><b id="k-h"></b></div></div>
          <div class="card chart"><div class="tools">${['1m', '5m', '15m', '1h', '4h', '1d'].map((t) => `<button class="${t === '1m' ? 'on' : ''}" data-tf="${t}">${t}</button>`).join('')}<div class="mode"><button class="on" data-mode="mc">MCap</button><i></i><button data-mode="px">Price</button></div></div><div id="cv"></div></div>
          <div class="card" style="margin-top:16px;overflow:hidden"><div class="stabs">${[['trades', 'Trades'], ['holders', 'Holders'], ['payouts', 'Payouts']].map(([k, l]) => `<button class="tab" data-st="${k}">${l}</button>`).join('')}</div><div class="tw" id="st"></div></div>
          <div class="hr">
            <h3>Holder rewards</h3>
            <p>A quarter of every trading fee is kept for this coin's holders, by how much they hold. Payout rounds send it to their wallets as ${rewardsTxt}. Whatever you have earned can also be claimed at any time, in ${esc(pairL)}.</p>
            <div class="hrow" id="hround"></div>
            <div class="hrow" id="mine" style="margin-top:14px" hidden></div>
          </div>
        </div>
        <div class="sticky side-col">
          <div class="card panel">
            <div class="bs"><button class="on b" data-side="b">Buy</button><button class="s" data-side="s">Sell</button></div>
            <div class="field"><label><span id="amt-l">Amount (ETH)</span><span>Slippage 3%</span></label><div class="unit-in"><input class="inp" id="amt" placeholder="0.0" inputmode="decimal" autocomplete="off"><span id="amt-u">ETH</span></div><div class="presets" id="pre"></div></div>
            <div class="route">Balance: <b id="bal">—</b><br>${routeTxt}<br><span id="est">You get about —</span></div>
            <button class="btn green block" style="height:50px" id="go">Connect wallet</button>
          </div>
          <div class="rs"><div class="rh"><b>Waiting for holders</b><span class="blue" id="potv"></span></div><p>Fees kept for this coin's holders and not paid out yet. The coin trades in its own Uniswap v4 pool. Lootbag holds the pool's liquidity and can withdraw any share of it, up to all.</p></div>
          <div class="rs"><b class="rt">Details</b><div class="kv"><span>Address</span><b>${short(c.addr)}</b></div><div class="kv"><span>Creator</span><b>${short(c.creator)}</b></div><div class="kv"><span>Paired with</span><b>${esc(pairL)}</b></div><div class="kv"><span>Supply</span><b>1,000,000,000</b></div><div class="kv"><span>Trading fee</span><b>2%</b></div><div class="kv"><span>Liquidity</span><b>Held by Lootbag</b></div>
            <h4 class="rt2">Where every fee goes</h4><div class="kv"><span><i class="drop-dot" style="background:var(--buy)"></i>Holders</span><b>0.5%</b></div><div class="kv"><span><i class="drop-dot" style="background:var(--blue)"></i>Lootbag</span><b>1.5%</b></div></div>
        </div>
      </div>${foot()}`;
    $('[data-copy]').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(c.addr); toast('Address copied'); };

    // ----- numbers that move: price, holders, the round, what this wallet holds and has earned
    const mineOf = () => (acct && acct.coins[key]) || null;
    const kpis = () => {
      $('#k-mc').textContent = usd(c.mcap); $('#k-px').textContent = usd(c.priceUsd); $('#k-pq').textContent = c.priceQuote ? num(c.priceQuote, 9) : '—';
      $('#k-h').textContent = c.holders == null ? '…' : num(c.holders, 0); $('#potv').textContent = usd(c.pot);
      const cur = c.rewards[c.rewardIx];
      $('#hround').innerHTML = `${tokenBadge(cur, 32)}<b>${esc(payTok(cur))}</b>${c.rewards.length > 1 ? `<span class="dim">then ${esc(c.rewards.filter((r) => r !== cur).map(payTok).join(', '))}</span>` : ''}<span class="sp"></span><span class="mute">${c.rewards.length > 1 ? `This round's reward. Next round in <b id="cd">${mmss(c.nextPayout)}</b>` : 'Paid in every round'}</span>`;
    };
    let side = 'b';
    const wallets = () => {
      const m = mineOf();
      $('#bal').textContent = !wallet || !acct ? '—' : side === 'b' ? tkn(ethers.formatEther(acct.eth), 5) + ' ETH' : tkn(ethers.formatEther(m ? m.bal : 0n), 2) + ' $' + c.ticker;
      const box = $('#mine');
      if (m && m.earned > 0n) {
        box.hidden = false;
        box.innerHTML = `<span>You have earned <b>${tkn(m.earnedAmount, 6)} ${esc(payTok(m.earnedIn))}</b> <span class="mute">≈ ${usd(m.earnedUsd)}</span></span><span class="sp"></span><button class="btn sm blue" id="claim">Claim</button>`;
        $('#claim').onclick = () => run($('#claim'), (note) => LIVE.claim(c.addr, note), 'Claimed. It is in your wallet.');
      } else box.hidden = true;
    };

    // ----- the trade panel
    const amount = () => { const raw = $('#amt').value.trim().replace(',', '.'); if (!/^\d*\.?\d{0,18}$/.test(raw) || !Number(raw)) return 0n; try { return ethers.parseEther(raw); } catch (e) { return 0n; } };
    let estT = 0, estN = 0;
    const est = () => {
      const v = amount(), n = ++estN, el = $('#est');
      clearTimeout(estT);
      if (!v) { el.textContent = 'You get about —'; return; }
      // a first figure from the price, then the exact one from the router (fee, route and price impact included)
      const x = Number(ethers.formatEther(v));
      el.textContent = 'You get about ' + (side === 'b' ? tkn((x * D.ethUsd * 0.98) / (c.priceUsd || Infinity), 0) + ' $' + c.ticker : tkn((x * c.priceUsd * 0.98) / (D.ethUsd || Infinity), 6) + ' ETH');
      estT = setTimeout(async () => {
        try {
          const out = side === 'b' ? await LIVE.quoteBuy(c.addr, v) : await LIVE.quoteSell(c.addr, v);
          if (n === estN && $('#est')) $('#est').textContent = 'You get ' + (side === 'b' ? tkn(ethers.formatEther(out), 0) + ' $' + c.ticker : tkn(ethers.formatEther(out), 6) + ' ETH') + ' at the current price';
        } catch (e) { if (n === estN && $('#est')) $('#est').textContent = LIVE.explain(e); }
      }, 350);
    };
    const presets = () => {
      $('#pre').innerHTML = (side === 'b' ? ['0.01', '0.05', '0.1', '0.5'].map((v) => `<button data-v="${v}">${v} ETH</button>`) : ['25', '50', '75', '100'].map((v) => `<button data-v="${v}%">${v}%</button>`)).join('');
      $$('#pre button').forEach((b) => (b.onclick = () => {
        if (b.dataset.v.endsWith('%')) { const m = mineOf(); if (!wallet) return openWallet(); if (!m || m.bal === 0n) return toast("You don't hold $" + c.ticker + ' yet.'); $('#amt').value = ethers.formatEther((m.bal * BigInt(parseInt(b.dataset.v, 10))) / 100n); }
        else $('#amt').value = b.dataset.v;
        est();
      }));
    };
    const act = () => {
      const v = amount(); if (!v) return toast('Enter an amount.');
      const done = (r) => { if (!r) return; $('#amt').value = ''; est(); detail(); };
      if (side === 'b') run($('#go'), (note) => LIVE.buy(c.addr, v, 300, note), (r) => `Bought ${tkn(ethers.formatEther(r.coins), 0)} $${c.ticker}`).then(done);
      else run($('#go'), (note) => LIVE.sell(c.addr, v, 300, note), (r) => `Sold for ${tkn(ethers.formatEther(r.eth), 6)} ETH`).then(done);
    };
    $$('[data-side]').forEach((b) => (b.onclick = () => {
      side = b.dataset.side; $$('[data-side]').forEach((x) => x.classList.toggle('on', x === b));
      $('#amt-l').textContent = side === 'b' ? 'Amount (ETH)' : 'Amount ($' + c.ticker + ')'; $('#amt-u').textContent = side === 'b' ? 'ETH' : c.ticker; $('#amt').value = '';
      $('#go').className = 'btn block ' + (side === 'b' ? 'green' : 'red'); $('#go').style.height = '50px'; $('#go').dataset.label = (side === 'b' ? 'Buy $' : 'Sell $') + c.ticker;
      presets(); paintWallet(); wallets(); est();
    }));
    presets(); $('#amt').oninput = est; needsWallet($('#go'), 'Buy $' + c.ticker, act);

    // ----- trades, holders, payouts
    let tab = 'trades';
    const empty = (m) => `<p class="mute" style="padding:26px 16px;margin:0;text-align:center">${m}</p>`;
    const sub = () => {
      $$('[data-st]').forEach((b) => b.classList.toggle('on', b.dataset.st === tab));
      const wl = (w, tx) => `<a class="mono" href="${tx ? ex('tx', tx) : ex('address', w)}" target="_blank" rel="noopener">${short(w)}</a>`;
      $('#st').innerHTML = tab === 'trades' ? (c.trades.length ? `<table class="t"><tr><th>Wallet</th><th>Side</th><th class="r">USD</th><th class="r">$${esc(c.ticker)}</th><th class="r">Age</th></tr>${c.trades.slice(0, 100).map((t) => `<tr><td>${wl(t.wallet, t.tx)}</td><td class="${t.buy ? 'up' : 'dn'}">${t.dev ? 'Dev buy' : t.buy ? 'Buy' : 'Sell'}</td><td class="r">${usd(t.usd)}</td><td class="r">${num(t.tokens, 0)}</td><td class="r mute">${ago(t.ts)}</td></tr>`).join('')}</table>` : empty('No trades yet.'))
        : tab === 'holders' ? (c.holderList.length ? `<table class="t"><tr><th>#</th><th>Wallet</th><th class="r">Share</th><th class="r">Can claim now</th></tr>${c.holderList.map((h, i) => `<tr><td class="mute">${i + 1}</td><td>${wl(h.wallet)}${h.creator ? ' <span class="dim">creator</span>' : ''}</td><td class="r">${h.pct.toFixed(2)}%</td><td class="r ${h.creator ? 'mute' : 'up'}">${h.creator ? 'earns nothing' : usd(h.earnedUsd)}</td></tr>`).join('')}</table>` : empty(c.detail ? 'No holders yet.' : 'Loading holders…'))
        : (c.payouts.length ? `<table class="t"><tr><th>Paid</th><th>Paid in</th><th class="r">Amount</th><th class="r">Wallets</th></tr>${c.payouts.slice(0, 40).map((p) => `<tr><td class="mute"><a href="${ex('tx', p.tx)}" target="_blank" rel="noopener">${ago(p.ts)} ago</a></td><td>${tokenBadge(p.token, 18)} ${esc(payTok(p.token))}${p.claim ? ' <span class="dim">claimed</span>' : ''}</td><td class="r up">${usd(p.usd)}</td><td class="r">${num(p.wallets, 0)}</td></tr>`).join('')}</table>` : empty('No payouts yet.'));
    };
    $$('[data-st]').forEach((b) => (b.onclick = () => { tab = b.dataset.st; sub(); }));

    // ----- the chart: redrawn only when a new swap changes it
    let step = 60, mode = 'mc', drawn = '';
    const draw = (force) => {
      const last = c.candles[c.candles.length - 1], sig = c.candles.length + ':' + (last ? last.c + ':' + last.v : '') + ':' + step + mode;
      if (!force && sig === drawn) return;
      drawn = sig;
      if (chart) { chart.remove(); chart = null; }
      if (!c.candles.length) { $('#cv').innerHTML = `<p class="mute" style="padding:120px 16px;text-align:center;margin:0">${c.detail ? 'No trades yet.' : 'Loading the chart…'}</p>`; return; }
      $('#cv').innerHTML = ''; drawChart(c, step, mode);
    };
    $$('[data-tf]').forEach((b) => (b.onclick = () => { $$('[data-tf]').forEach((x) => x.classList.toggle('on', x === b)); step = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[b.dataset.tf]; draw(true); }));
    $$('[data-mode]').forEach((b) => (b.onclick = () => { $$('[data-mode]').forEach((x) => x.classList.toggle('on', x === b)); mode = b.dataset.mode; draw(true); }));

    const paint = () => { if (!$('#k-mc')) return; kpis(); sub(); draw(); wallets(); };
    const detail = () => LIVE.coinDetail(c.addr).then(paint).catch(() => {});
    paint(); detail();
    onData = () => { paint(); detail(); };
    onWallet = () => { if ($('#bal')) wallets(); };
    every(1000, () => { tickCards(); const el = $('#cd'); if (el) el.textContent = mmss(c.nextPayout); });
  }
  let chart = null;
  function drawChart(c, step, mode) {
    const f = mode === 'px' ? 1e-9 : 1;
    const el = $('#cv'); if (!el || !window.LightweightCharts) return;
    if (chart) { chart.remove(); chart = null; }
    const V = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim(), up = V('--buy'), dn = V('--sell'), ar = (c, o) => { const h = c.replace('#', ''); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${o})`; };
    chart = LightweightCharts.createChart(el, { layout: { background: { color: 'transparent' }, textColor: V('--mute'), fontFamily: 'Space Grotesk', fontSize: 11 }, grid: { vertLines: { color: ar(V('--line2'), 0.35) }, horzLines: { color: ar(V('--line2'), 0.35) } }, rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.2 } }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 6 }, crosshair: { mode: 1, vertLine: { color: V('--line3'), labelBackgroundColor: V('--chip') }, horzLine: { color: V('--line3'), labelBackgroundColor: V('--chip') } }, autoSize: true });
    const s = chart.addCandlestickSeries({ upColor: up, downColor: dn, borderVisible: false, wickUpColor: up, wickDownColor: dn, priceLineColor: V('--blue'), priceLineStyle: 2, priceFormat: { type: 'custom', minMove: mode === 'px' ? 1e-12 : 0.01, formatter: (v) => usd(v) } });
    const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    const out = [], vs = []; let cur = null, cv = 0;
    for (const k of c.candles) { const b = Math.floor(k.t / step) * step; if (!cur || cur.time !== b) { if (cur) { out.push(cur); vs.push({ time: cur.time, value: cv, color: cur.close >= cur.open ? ar(up, 0.45) : ar(dn, 0.45) }); } cur = { time: b, open: k.o * f, high: k.h * f, low: k.l * f, close: k.c * f }; cv = k.v; } else { cur.high = Math.max(cur.high, k.h * f); cur.low = Math.min(cur.low, k.l * f); cur.close = k.c * f; cv += k.v; } }
    if (cur) { out.push(cur); vs.push({ time: cur.time, value: cv, color: cur.close >= cur.open ? ar(up, 0.45) : ar(dn, 0.45) }); }
    s.setData(out); vol.setData(vs); chart.timeScale().fitContent();
  }


  // ---------- create: one form card, the launch button at its foot
  // A coin's picture is stored on-chain with the launch, so it is cut square and squeezed under the contract's limit.
  const IMG_MAX = 23500;
  function shrink(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const s = Math.min(im.naturalWidth, im.naturalHeight), sx = (im.naturalWidth - s) / 2, sy = (im.naturalHeight - s) / 2;
        for (const size of [256, 192, 144, 112, 96, 72]) for (const q of [0.82, 0.65, 0.5, 0.35]) for (const type of ['image/webp', 'image/jpeg']) {
          const cv = document.createElement('canvas'); cv.width = cv.height = Math.min(size, s);
          const g = cv.getContext('2d'); if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); }
          g.drawImage(im, sx, sy, s, s, 0, 0, cv.width, cv.height);
          const out = cv.toDataURL(type, q);
          if (out.startsWith('data:' + type) && out.length <= IMG_MAX) { URL.revokeObjectURL(url); return res(out); }
        }
        URL.revokeObjectURL(url); rej(new Error('That picture could not be made small enough.'));
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not a picture this browser can read.')); };
      im.src = url;
    });
  }
  function create() {
    const F = { pair: 'VVV', pairStock: 'NVDA', rewards: [], img: '', cat: 'all', dev: '0.01', taken: false };
    const stocks = D.stocks, crypto = [{ sym: 'ETH', name: 'Ether', usd: D.ethUsd }, { sym: 'USDC', name: 'USD Coin', usd: 1 }, { sym: 'VVV', name: 'Venice Token', usd: D.vvvUsd }], memes = D.memes || [];
    const pool = () => (F.cat === 'stocks' ? stocks : F.cat === 'crypto' ? crypto : F.cat === 'memes' ? memes : [...crypto, ...stocks, ...memes]);
    const ic = { x: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L2 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>', tg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 4 3 11l6 2 2 6 3-4 5 4z"/></svg>', web: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>', img: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="15" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m18.5 15-4-4-8 8M19 2v5M16.5 4.5h5"/></svg>' };
    view.innerHTML = `<div class="cg one"><div class="card cform">
        <div class="ch"><h1>Create a coin</h1><button class="btn sm" id="reset">↺ Reset</button></div>
        <div class="crow"><label class="imgbox" id="ph" for="img">${ic.img}<b>ADD IMAGE</b><small>PNG, JPG, WEBP, GIF</small></label><input type="file" id="img" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
          <div class="cfields"><div class="two"><div class="field"><label><span class="lbl">Name</span><span id="n-n">0/32</span></label><input class="inp t" id="f-name" maxlength="32" placeholder="Name"></div><div class="field"><label><span class="lbl">Ticker</span><span id="t-n">0/10</span></label><div class="pre-in"><span>$</span><input class="inp t" id="f-tk" maxlength="10" placeholder="TICKER" style="text-transform:uppercase"></div></div></div>
          <div class="field"><label><span class="lbl">Description</span><span id="d-n">0/280</span></label><textarea class="inp" id="f-desc" maxlength="280" placeholder="Tell people what your coin is about, in a line or two"></textarea></div></div></div>
        <div class="fs"><div class="fh"><span class="lbl">Links</span><span>Optional. They are saved with the coin and show on its page here</span></div>
          <div class="three"><div class="icon-in">${ic.x}<input class="inp t" id="f-x" maxlength="160" placeholder="X URL"></div><div class="icon-in">${ic.tg}<input class="inp t" id="f-tg" maxlength="160" placeholder="Telegram URL"></div><div class="icon-in">${ic.web}<input class="inp t" id="f-web" maxlength="160" placeholder="Website URL"></div></div></div>
        <div class="fs"><div class="fh"><span class="lbl">Paired with</span><span id="pair-h">Trades in its own Uniswap v4 pool against VVV</span></div>
          <div class="seg3 four" id="pair">${[['VVV', 'VVV'], ['ETH', 'Ethereum'], ['USDC', 'USDC'], ['STOCK', 'Stock']].map(([k, t]) => `<button data-pair="${k}" class="${k === 'VVV' ? 'on' : ''}">${tokenBadge(k === 'STOCK' ? 'NVDA' : k, 24)}${t}</button>`).join('')}</div>
          <div id="pair-stock" style="display:none"><div class="srch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="inp t" id="ps-q" placeholder="Search by ticker or name"></div><div class="tgrid" id="ps"></div></div></div>
        <div class="fs"><div class="fh"><span class="lbl">Rewarded with</span><span>What holders are paid in, in payout rounds</span></div>
          <p class="fp">Each round buys the reward with the fees the coin earned and pays holders in it. Pick nothing and they get ETH. Pick more and they take turns, one each five minutes.</p>
          <div class="cats" id="cats">${[['all', 'All', stocks.length + 3 + memes.length], ['stocks', 'Stocks', stocks.length], ['crypto', 'Crypto', 3], ...(memes.length ? [['memes', 'Memes', memes.length]] : [])].map(([k, l, n]) => `<button data-cat="${k}" class="${k === 'all' ? 'on' : ''}">${l} <i>${n}</i></button>`).join('')}</div>
          <div class="srch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="inp t" id="rw-q" placeholder="Search by ticker or name"></div>
          <div class="tgrid" id="rw"></div></div>
        <div class="fs" style="border:0;padding-bottom:0"><div class="fh"><span class="lbl">Dev buy</span></div>
          <p class="fp">Required: about 0.006 ETH or more, up to 2% of the supply (around 0.05 ETH at launch). Creators can't hold more than that at launch, on every coin on Lootbag, and the creator's wallet earns no holder rewards.</p>
          <div class="devrow"><div class="cats" id="devp">${['0.006', '0.01', '0.02', '0.05'].map((v) => `<button data-dev="${v}" class="${v === F.dev ? 'on' : ''}">${v} ETH</button>`).join('')}</div><div class="amt-in"><input class="inp t" id="f-dev" value="${F.dev}" inputmode="decimal"><span>ETH</span></div></div>
          <div class="note" style="text-align:right" id="dev-usd"></div></div>
        <div id="pv" style="margin-top:22px"></div>
      </div></div>${foot()}`;
    const listBtn = (s, on, n) => `<button data-t="${esc(s.sym)}" class="${on ? 'on' : ''}">${tokenBadge(s.sym, 32)}<span><b>${esc(s.sym)}</b><small>${usd(s.usd)}</small></span>${n ? `<em>${n}</em>` : ''}</button>`;
    const ps = () => { const q = ($('#ps-q').value || '').toLowerCase(); $('#ps').innerHTML = stocks.filter((s) => !q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).map((s) => listBtn(s, F.pairStock === s.sym)).join(''); $$('#ps [data-t]').forEach((b) => (b.onclick = () => { F.pairStock = b.dataset.t; ps(); pv(); })); };
    const rw = () => { const q = ($('#rw-q').value || '').toLowerCase(); $('#rw').innerHTML = pool().filter((s) => !q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).map((s) => { const i = F.rewards.indexOf(s.sym); return listBtn(s, i >= 0, i >= 0 ? i + 1 : 0); }).join(''); $$('#rw [data-t]').forEach((b) => (b.onclick = () => { const s = b.dataset.t, i = F.rewards.indexOf(s); if (i >= 0) F.rewards.splice(i, 1); else if (F.rewards.length < 10) F.rewards.push(s); else toast('Up to 10 rewards'); rw(); pv(); })); };
    const bytes = (s) => new TextEncoder().encode(s).length;
    const link = (id, what) => { const v = $(id).value.trim(); if (!v) return ''; const u = /^https?:\/\//i.test(v) ? v : 'https://' + v; if (/[\s"'<>]/.test(u) || bytes(u) > 160) throw new Error(`The ${what} link is not a web address, or is over 160 characters.`); return u; };
    const launch = () => {
      const name = $('#f-name').value.trim(), tk = $('#f-tk').value.trim().toUpperCase(), desc = $('#f-desc').value.trim(), dev = $('#f-dev').value.trim().replace(',', '.');
      let x, tg, web;
      try {
        if (!name || bytes(name) > 32) throw new Error('Give the coin a name of up to 32 characters.');
        if (!/^[A-Z0-9]{2,10}$/.test(tk)) throw new Error('The ticker must be 2 to 10 letters or digits.');
        if (bytes(desc) > 280) throw new Error('The description is too long.');
        if (!/^\d*\.?\d{1,18}$/.test(dev) || !(Number(dev) >= 0.005)) throw new Error('The dev buy must be about 0.006 ETH or more.');
        x = link('#f-x', 'X'); tg = link('#f-tg', 'Telegram'); web = link('#f-web', 'website');
      } catch (e) { return toast(e.message); }
      run($('#launch'), (note) => LIVE.launch({ name, symbol: tk, pair: F.pair === 'STOCK' ? F.pairStock : F.pair, rewards: F.rewards, devEth: dev, image: F.img, description: desc, x, telegram: tg, website: web }, note), `$${tk} is live.`)
        .then((r) => { if (r && r.coin) location.hash = '#/coin/' + r.coin; });
    };
    let feeT = 0;
    const pv = () => {
      const name = $('#f-name').value.trim(), tk = $('#f-tk').value.trim().toUpperCase(), pair = F.pair === 'STOCK' ? F.pairStock : F.pair, dev = Number($('#f-dev').value.replace(',', '.')) || 0;
      $('#n-n').textContent = $('#f-name').value.length + '/32'; $('#t-n').textContent = $('#f-tk').value.length + '/10'; $('#dev-usd').textContent = '≈ ' + usd(dev * D.ethUsd);
      $('#pair-h').textContent = 'Trades in its own Uniswap v4 pool against ' + label(pair);
      const taken = F.taken === tk || (tk && D.coins.some((c) => c.ticker.toUpperCase() === tk));
      $('#pv').innerHTML = `${taken ? `<p class="note warn" style="margin:0 0 12px">$${esc(tk)} is already on Lootbag: a copy costs 0.05 ETH on top, refunded if your coin reaches $70K within 48 hours.</p>` : ''}
        <button class="btn blue block" style="height:50px" id="launch">Connect wallet</button>`;
      if (D.paused) { const b = $('#launch'); b.textContent = 'Launches are not open yet'; b.disabled = true; }
      else needsWallet($('#launch'), 'Launch coin', launch);
      // the contract knows whether a ticker was used before (a copy costs more)
      clearTimeout(feeT);
      if (/^[A-Z0-9]{2,10}$/.test(tk) && F.asked !== tk) feeT = setTimeout(() => { F.asked = tk; LIVE.launchFee(tk).then((fee) => { const was = F.taken; F.taken = fee > 1000000000000000n ? tk : false; if (F.taken !== was && $('#pv')) pv(); }).catch(() => {}); }, 400);
    };
    $$('[data-pair]').forEach((b) => (b.onclick = () => { F.pair = b.dataset.pair; $$('[data-pair]').forEach((x) => x.classList.toggle('on', x === b)); $('#pair-stock').style.display = F.pair === 'STOCK' ? '' : 'none'; pv(); }));
    $$('[data-cat]').forEach((b) => (b.onclick = () => { F.cat = b.dataset.cat; $$('[data-cat]').forEach((x) => x.classList.toggle('on', x === b)); rw(); }));
    $$('[data-dev]').forEach((b) => (b.onclick = () => { $('#f-dev').value = b.dataset.dev; $$('[data-dev]').forEach((x) => x.classList.toggle('on', x === b)); pv(); }));
    $('#ps-q').oninput = ps; $('#rw-q').oninput = rw;
    ['#f-name', '#f-tk', '#f-dev'].forEach((s) => ($(s).oninput = pv));
    $('#f-desc').oninput = () => ($('#d-n').textContent = $('#f-desc').value.length + '/280');
    $('#reset').onclick = () => create();
    $('#img').onchange = () => { const f = $('#img').files[0]; if (!f) return; shrink(f).then((data) => { F.img = data; $('#ph').style.backgroundImage = `url('${F.img}')`; $('#ph').innerHTML = ''; pv(); }).catch((e) => toast(e.message)); };
    ps(); rw(); pv();
    onWallet = paintWallet;
    // if launches open (or close) while the form is on screen, the button follows
    let wasPaused = D.paused;
    onData = () => { if (D.paused !== wasPaused && $('#pv') && !working) { wasPaused = D.paused; pv(); } };
  }

  const statsRow = (items) => `<div class="srow">${items.map(([k, v, s]) => `<div><span>${k}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`).join('')}</div>`;
  const payTok = (r) => (CRYPTO.includes(r) ? r : '$' + label(r));

  // ---------- rewards
  function rewards() {
    const paying = D.coins.filter((c) => c.pot > 0 || c.paid24 > 0).sort((a, b) => b.paid24 + b.pot - (a.paid24 + a.pot)).slice(0, 8), total24 = D.coins.reduce((s, c) => s + c.paid24, 0), P = D.platform;
    view.innerHTML = `<div class="ph1"><h1>Rewards</h1><p>Hold a coin launched on Lootbag and you earn from every trade made in it. Payout rounds send rewards straight to holders' wallets, and whatever you have earned can be claimed here at any time.</p></div>
      ${statsRow([['All payouts', usd(P.paidHolders + D.bags.paidUsd), 'holders + Bag vaults'], ['Paid to holders', usd(P.paidHolders), num(P.payments, 0) + ' payments'], ['Last 24 hours', usd(total24), 'to holders'], ["You're earning on", '<span id="mine-n">–</span>', '']])}
      <div class="lookup"><button class="btn blue" data-connect2>Connect wallet</button><span class="mute">or</span><input class="inp t" id="rq" placeholder="Paste any wallet address"><button class="btn" id="rgo">Look up</button></div><div id="rres"></div>
      <div class="lh"><h3>Earning now</h3><span>Coins with fees kept for their holders</span></div>
      <div>${paying.map((c) => `<a class="prow" href="#/coin/${c.addr}">${av(c, 40)}<div class="grow"><b>$${esc(c.ticker)}</b><div class="mute">${usd(c.pot)} waiting for holders · ${usd(c.paid24)} paid in 24h · ${usd(c.mcap)} market cap</div></div><div class="pays"><span class="mute">Pays in</span>${tokenBadge(c.rewards[0], 20)}<b>${esc(payTok(c.rewards[0]))}</b>${c.rewards.length > 1 ? `<span class="dim">+${c.rewards.length - 1}</span>` : ''}</div></a>`).join('') || '<p class="mute">No coin has earned fees for its holders yet.</p>'}</div>
      <p class="fine">Every coin has a payout round every 5 minutes, counted from its launch. A round swaps the holders' share of the coin's trading fees into that round's reward token and sends it to holders by how much they hold. Rounds are run by Lootbag, when enough has built up to be worth the swap. Between rounds your share stays in the coin's own contract, and you can claim it yourself in the coin's pair token.</p>${foot()}`;
    bindConnect();
    // what a wallet holds and has earned, coin by coin; the connected wallet can claim
    const show = async (who, mine) => {
      const box = $('#rres'); if (!box) return;
      let a; try { a = mine && acct ? acct : await LIVE.account(who); } catch (e) { box.innerHTML = `<p class="note">${esc(LIVE.explain(e))}</p>`; return; }
      if (!$('#rres')) return;
      const rows = D.coins.map((c) => [c, a.coins[c.addr.toLowerCase()]]).filter(([, m]) => m && (m.bal > 0n || m.earned > 0n));
      if (mine) $('#mine-n').textContent = rows.length + (rows.length === 1 ? ' coin' : ' coins');
      box.innerHTML = rows.length ? `<div style="margin:-18px 0 30px">${rows.map(([c, m]) => `<div class="prow">${av(c, 40)}<div class="grow"><a href="#/coin/${c.addr}"><b>$${esc(c.ticker)}</b></a><div class="mute">Holding ${tkn(ethers.formatEther(m.bal), 2)} · earned ${tkn(m.earnedAmount, 6)} ${esc(payTok(m.earnedIn))} (≈ ${usd(m.earnedUsd)})</div></div>${mine && m.earned > 0n ? `<button class="btn blue" data-claim="${c.addr}">Claim</button>` : ''}</div>`).join('')}</div>` : `<p class="note" style="margin:-18px 0 30px">No Lootbag coins in ${mine ? 'your' : 'this'} wallet yet.</p>`;
      $$('[data-claim]').forEach((b) => (b.onclick = () => run(b, (note) => LIVE.claim(b.dataset.claim, note), 'Claimed. It is in your wallet.')));
    };
    $('#rgo').onclick = () => { const v = $('#rq').value.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(v)) show(v, false); else $('#rres').innerHTML = '<p class="note" style="margin:-18px 0 30px">Paste a full 0x address.</p>'; };
    onWallet = () => { if (wallet && acct) show(wallet, true); };
    onWallet();
  }

  // ---------- airdrops
  function airdrops() {
    const A = D.airdrop, b = A.board.slice(0, 50), top = A.board.slice(3, 20).reduce((s, y) => s + y.vol, 0) || 1, rest = A.board.slice(20, 500).reduce((s, y) => s + y.vol, 0) || 1;
    // #1 to #3 take fixed shares, #4 to #20 split 13% by volume, everyone after splits what is left
    const share = (x, i) => (i === 0 ? 5.3 : i === 1 ? 4 : i === 2 ? 3 : i < 20 ? (13 * x.vol) / top : (74.7 * x.vol) / rest);
    const last = A.rounds[0], when = (ts) => new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    view.innerHTML = `<div class="ph1"><h1>Airdrops</h1><p>Trade any coin launched on Lootbag. 10% of Lootbag's share of every fee goes into a VVV pot, and each round the pot is split between the top 500 traders by volume. #1, #2 and #3 get 5.3%, 4%, 3% of the pot, places 4–20 share 13%, and everyone else shares the rest. Places 4 and down go by volume: the more volume, the bigger the share. Rounds are posted by Lootbag, about every 10 hours.</p></div>
      <div class="srow big"><div><span>In the pot</span><b>${num(A.pot, A.pot >= 100 ? 1 : 4)} VVV</b><small>≈ ${usd(A.potUsd)}</small></div><div><span>Next airdrop</span><b id="acd">${A.endsAt ? hms(A.endsAt - Date.now() / 1000) : 'Not scheduled yet'}</b><small>${num(A.traders, 0)} traders · ${usd(A.volume)} volume this round</small></div><div><span>Last airdrop${last ? ' · round ' + (last.id + 1) : ''}</span><b>${last ? num(last.total, 2) + ' VVV' : 'None yet'}</b><small>${last ? when(last.ts) : 'The first round has not been posted'}</small></div></div>
      <div class="lookup" style="margin-top:28px"><span id="myrank">Connect your wallet to see your rank and payout.</span><button class="btn blue" data-connect2>Connect wallet</button></div>
      <div class="lh"><h3>Leaderboard</h3><span>Top 50 shown · volume traded through Lootbag this round</span></div>
      ${b.length ? `<div class="tw"><table class="t lb"><tr><th>#</th><th>Wallet</th><th class="r">Volume</th><th class="r">Share</th><th class="r">Payout</th></tr>${b.map((x, i) => `<tr><td class="dim">${i + 1}</td><td>${short(x.wallet)}</td><td class="r">${usd(x.vol)}</td><td class="r mute">${share(x, i).toFixed(2)}%</td><td class="r up">${num((A.pot * share(x, i)) / 100, 4)} VVV</td></tr>`).join('')}</table></div>` : '<p class="mute">No trades this round yet.</p>'}
      <div class="lh"><h3>Past airdrops</h3></div>${A.rounds.map((r) => `<div class="past"><span class="mute">Round ${r.id + 1}</span><span class="mute">${when(r.ts)}</span><b>${num(r.total, 2)} VVV</b><span class="sp"></span>${r.listUri ? `<a class="mute" href="${esc(r.listUri)}" target="_blank" rel="noopener">Every wallet</a>` : ''}<a class="mute" href="${ex('tx', r.tx)}" target="_blank" rel="noopener">Transaction</a></div>`).join('') || '<p class="mute">No airdrop has been paid yet.</p>'}
      <p class="fine">Payouts above are what the pot would pay right now; they grow as fees come in and change with every trade. The final list for a round is posted on-chain by Lootbag with the round.</p>${foot()}`;
    bindConnect();
    onWallet = () => { const el = $('#myrank'); if (!el) return; const i = wallet ? A.board.findIndex((x) => x.wallet === wallet.toLowerCase()) : -1; el.textContent = !wallet ? 'Connect your wallet to see your rank and payout.' : i < 0 ? 'You have no volume in this round yet.' : `You are #${i + 1} with ${usd(A.board[i].vol)} of volume: about ${num((A.pot * share(A.board[i], i)) / 100, 4)} VVV right now.`; };
    onWallet();
    if (A.endsAt) every(1000, () => { const e = $('#acd'); if (e) e.textContent = A.endsAt > Date.now() / 1000 ? hms(A.endsAt - Date.now() / 1000) : 'Due now'; });
  }

  // ---------- Bags (NFT vaults): pixel art, drawn from the Bag's number
  function bagArt(id) {
    let x = id * 2654435761 % 4294967296; const r = () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
    const bgs = ['#fde68a', '#ddd6fe', '#fdba74', '#1e3a8a', '#c4b5fd', '#a7f3d0', '#fecdd3', '#bae6fd', '#e9d5ff', '#fef3c7'];
    const bodies = [['#e8484f', '#b32d36'], ['#3d7bff', '#2456c7'], ['#f59e0b', '#b86f06'], ['#22c55e', '#15803d'], ['#e5e7eb', '#9ca3af'], ['#a855f7', '#7e22ce'], ['#ec4899', '#be185d'], ['#374151', '#1f2937']];
    const bg = bgs[Math.floor(r() * bgs.length)], [b1, b2] = bodies[Math.floor(r() * bodies.length)], tie = ['#fbbf24', '#f8fafc', '#34d399', '#f472b6'][Math.floor(r() * 4)];
    const eyes = Math.floor(r() * 4), hat = Math.floor(r() * 5), mouth = Math.floor(r() * 3), px = [];
    const P = (cx, cy, c, w = 1, h = 1) => px.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`);
    // the sack: neck, tie, round body (16x16 grid)
    P(6, 3, b1, 4, 1); P(5, 4, tie, 6, 1); P(6, 5, b1, 4, 1);
    [[4, 6, 8], [3, 7, 10], [2, 8, 12], [2, 9, 12], [2, 10, 12], [2, 11, 12], [3, 12, 10], [4, 13, 8]].forEach(([sx, y, w]) => P(sx, y, b1, w, 1));
    [[3, 12, 10], [4, 13, 8]].forEach(([sx, y, w]) => P(sx, y, b2, w, 1)); P(2, 8, b2, 1, 4); P(13, 8, b2, 1, 4);
    P(4, 14, 'rgba(0,0,0,.18)', 8, 1);
    if (eyes === 0) { P(5, 9, '#111'); P(10, 9, '#111'); } else if (eyes === 1) { P(5, 9, '#fff', 2, 2); P(6, 10, '#111'); P(9, 9, '#fff', 2, 2); P(10, 10, '#111'); } else if (eyes === 2) { P(4, 9, '#111', 3, 1); P(9, 9, '#111', 3, 1); } else { P(4, 9, '#111', 8, 1); P(4, 9, '#3d7bff', 3, 1); P(9, 9, '#3d7bff', 3, 1); }
    if (mouth === 0) P(7, 11, '#111', 2, 1); else if (mouth === 1) { P(6, 11, '#111'); P(7, 12, '#111', 2, 1); P(9, 11, '#111'); } else P(7, 11, '#7f1d1d', 2, 2);
    if (hat === 1) { P(5, 1, '#111827', 6, 2); P(4, 3, '#111827', 8, 1); } else if (hat === 2) { P(7, 0, '#ef4444', 2, 1); P(6, 1, '#f59e0b', 4, 1); P(5, 2, '#3b82f6', 6, 1); } else if (hat === 3) { P(6, 1, '#22c55e', 1, 2); P(9, 1, '#22c55e', 1, 2); P(7, 2, '#16a34a', 2, 1); } else if (hat === 4) { P(4, 2, '#fde047', 8, 1); P(5, 1, '#fde047'); P(8, 1, '#fde047'); P(10, 1, '#fde047'); }
    if (r() < 0.3) { P(13, 2, '#fff'); P(12, 3, '#fff', 3, 1); P(13, 4, '#fff'); }
    return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" fill="${bg}"/>${px.join('')}</svg>`;
  }
  const isMine = (x) => !!wallet && String(x.owner).toLowerCase() === wallet.toLowerCase();
  const bagCard = (x) => `<div class="nft"><div class="art">${bagArt(x.id)}</div><div class="nb"><b>Bag #${x.id}</b><span>${usd(x.earned)} <i>in its vault</i></span>${isMine(x) ? `<button class="btn blue block" data-wd="${x.id}" ${x.vault.length ? '' : 'disabled'}>${x.vault.length ? 'Withdraw' : 'Vault empty'}</button>` : `<a class="btn block" href="https://opensea.io/assets/base/${K.bags}/${x.id}" target="_blank" rel="noopener">OpenSea</a>`}</div></div>`;
  const bindWithdraw = (after) => $$('[data-wd]').forEach((b) => (b.onclick = () => run(b, (note) => LIVE.withdrawBag(Number(b.dataset.wd), note), 'Withdrawn to your wallet.').then((r) => { if (r) after(); })));
  function bags() {
    const B = D.bags; let only = false;
    const inVaults = B.list.reduce((s, x) => s + x.earned, 0), drop = B.pot * 0.05;
    view.innerHTML = `<div class="ph1"><h1>Bags</h1><p>Every Bag minted so far, and what each one holds in its vault.</p></div>
      <div class="card scard">${[['Minted', `${B.minted}<span> / ${num(B.total, 0)}</span>`, `<div class="meter thin"><i style="width:${(B.minted / B.total) * 100}%"></i></div>`], ['$LOOT burned', num(B.minted * B.perMintLoot, 0), num(B.perMintLoot, 0) + ' per mint'], ['Paid out so far', usd(B.paidUsd), B.drops + (B.drops === 1 ? ' round' : ' rounds')], ['In all vaults now', usd(inVaults), 'across ' + B.minted + ' Bags']].map(([k, v, s]) => `<div><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('')}</div>
      <div class="card nextp"><span class="mute">Next payout</span>${B.minted ? `<b id="bcd"></b><span class="mute">${B.today === 'VVV' ? 'sends' : 'buys'} ${tokenBadge(B.today, 20)} <b>${esc(payTok(B.today))}</b> with ≈ ${tkn(drop, 4)} VVV, 5% of the ${tkn(B.pot, 4)} VVV pot, split across ${B.minted} Bags (≈ ${tkn(drop / B.minted, 5)} VVV each)</span>` : `<b>After the first mint</b><span class="mute">The pot holds ${tkn(B.pot, 4)} VVV. Once Bags exist, 5% of it is paid into their vaults each hour a round is run.</span>`}</div>
      <div class="metal"><span>Collection and pot <a href="${ex('address', K.bags)}" target="_blank" rel="noopener">${short(K.bags)}</a></span><span>5% royalty on resales</span></div>
      <div class="card gridcard"><div class="gh"><div class="cats"><button class="on" data-f="all">All <i>${B.minted}</i></button><button data-f="mine">Yours <i id="mine-c">0</i></button></div><div class="srch" style="margin:0;max-width:290px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="inp t" id="bq" placeholder="Bag # or owner wallet"></div></div>
        <div class="nftgrid" id="bgrid"></div></div>${foot()}`;
    const draw = () => {
      if (!$('#bgrid')) return;
      const q = $('#bq').value.trim().toLowerCase().replace(/^#/, ''), list = B.list.filter((x) => (!only || isMine(x)) && (!q || String(x.id) === q || String(x.owner).toLowerCase().includes(q)));
      $('#mine-c').textContent = B.list.filter(isMine).length;
      $('#bgrid').innerHTML = list.map(bagCard).join('') || `<p class="mute" style="grid-column:1/-1;padding:30px 8px;text-align:center">${!B.minted ? 'No Bags have been minted yet.' : only && !wallet ? 'Connect your wallet to see your Bags.' : 'No Bags match.'}</p>`;
      bindWithdraw(draw);
    };
    $$('[data-f]').forEach((b) => (b.onclick = () => { only = b.dataset.f === 'mine'; $$('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); if (only && !wallet) openWallet(); draw(); }));
    $('#bq').oninput = draw; draw();
    onWallet = draw; onData = draw;
    if (B.minted) { const tick = () => { const e = $('#bcd'); if (e) { const s = B.lastDrop + 3600 - Date.now() / 1000; e.textContent = s > 0 ? 'in ' + mmss(s) : 'due now'; } }; tick(); every(1000, tick); }
  }
  function mint() {
    const B = D.bags, left = B.total - B.minted;
    view.innerHTML = `<div class="ph1"><h1>Mint a Bag</h1><p>A Bag is an NFT with its own vault that only the NFT controls. Minting burns $LOOT and gives you the next numbered Bag. Each payout round, the Bag pot spends 5% of what it holds on the day's token and splits it equally between all Bags, straight into their vaults. Sell or send the NFT and its whole vault goes with it.</p></div>
      <div class="mintgrid"><div class="card mintc">
          <div class="ms"><h4>You send</h4><div class="mrow"><span><b>$LOOT</b> <i>burned</i></span><b class="big">${num(B.perMintLoot, 0)}</b></div><div class="mrow" style="border:0"><span>${tokenBadge('VVV', 18)} <b>VVV</b> <i>2.7 VVV goes to the Bags already minted, 0.3 VVV to Lootbag</i></span><b class="big">${B.perMintVvv}</b></div></div>
          <div class="arrow">↓</div>
          <div class="mr"><h4>You receive</h4><div class="recv"><div class="art">${bagArt(B.minted + 1)}</div><div><b style="font-size:20px">Bag #${B.minted + 1}</b><p class="mute" style="margin:4px 0 8px;font-size:14px">The next Bag in line. It earns ${B.rotation.length || 'its'} tokens in rotation, one a day. ${num(left, 0)} of ${num(B.total, 0)} are left.</p><span class="stack">${B.rotation.map((t) => tokenBadge(t, 22)).join('')}</span></div></div>
          <p class="note">${B.lootSet ? 'Up to three approvals in your wallet: your $LOOT, your VVV, then the mint.' : 'Minting opens when $LOOT launches. $LOOT has not launched yet.'}</p><button class="btn blue block pillish" id="mintgo">Connect wallet</button></div></div>
        <div class="card yours"><h3>Your Bags</h3><div id="ybags"></div></div></div>
      <div class="card how3"><h3>How it works</h3><div class="cols">${[['Mint', 'Your $LOOT is burned and you get an NFT with a vault tied to it. Whoever holds the NFT owns everything in its vault.'], ['Earn', "Each round, the pot spends 5% of what it holds on the day's token and credits every Bag an equal share, straight into its vault."], ['Withdraw', 'Take what is in your Bag whenever you like. Sell or send the Bag and whatever is still in its vault goes with it.']].map(([t, d], i) => `<div><div class="ct"><span class="n">${i + 1}</span><b>${t}</b></div><p>${d}</p></div>`).join('')}</div></div>${foot()}`;
    const go = $('#mintgo');
    if (!B.lootSet) { go.textContent = 'Opens when $LOOT launches'; go.disabled = true; }
    else if (left <= 0) { go.textContent = 'All Bags are minted'; go.disabled = true; }
    else needsWallet(go, 'Mint a Bag', () => run(go, (note) => LIVE.mintBag(note), 'Your Bag is minted.').then((r) => { if (r) mint(); }));
    const yours = () => {
      const el = $('#ybags'); if (!el) return;
      const list = B.list.filter(isMine);
      el.innerHTML = !wallet ? '<div class="empty">Connect your wallet to see your Bags.</div>' : list.length ? `<div class="nftgrid" style="margin-top:14px">${list.map(bagCard).join('')}</div>` : '<div class="empty">This wallet holds no Bags.</div>';
      bindWithdraw(yours);
    };
    yours(); onWallet = yours; onData = yours;
  }

  // ---------- Lootbag coins: square tiles
  function lootCoins() {
    let sort = 'mcap';
    const draw = () => {
      if (!$('#tiles')) return;
      const q = ($('#lq') && $('#lq').value || '').toLowerCase();
      const cs = D.coins.filter((c) => !q || c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).sort((a, b) => (sort === 'mcap' ? b.mcap - a.mcap : b.vol24 - a.vol24));
      $('#tiles').innerHTML = cs.map((c) => `<div class="tile"><a href="#/coin/${c.addr}" class="sq">${av(c, 210)}${c.official ? '<span class="tb gr">Lootbag</span>' : c.pair === 'LOOT' || c.rewards.includes('LOOT') ? '<span class="tb">LOOT</span>' : ''}</a><div class="tt"><b>$${esc(c.ticker)}</b> <span>${esc(c.name)}</span></div><div class="tm"><span class="up">${usd(c.mcap)}</span> · 24h vol ${usd(c.vol24)}</div><a class="btn block" href="#/coin/${c.addr}">Trade $${esc(c.ticker)}</a></div>`).join('') || `<p class="mute">${D.coins.length ? 'No coins match.' : D.paused ? 'No coins yet. Launches are not open yet.' : 'No coins yet. Be the first to launch one.'}</p>`;
    };
    view.innerHTML = `<div class="ph1 row"><div><h1>Lootbag coins</h1><p>Coins launched on Lootbag, paired with VVV, ETH, USDC or a stock.</p></div><div class="ph1r"><div class="tog"><button class="on" data-s="mcap">Market cap</button><button data-s="vol">Volume</button></div><div class="srch" style="margin:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="inp t" id="lq" placeholder="Search Lootbag coins"></div></div></div><div class="tiles" id="tiles"></div>${foot()}`;
    $$('[data-s]').forEach((b) => (b.onclick = () => { sort = b.dataset.s; $$('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    $('#lq').oninput = draw; draw();
    onData = draw;
  }

  // ---------- how it works
  function how() {
    const row = (name, a, what) => `<tr><td>${name}</td><td><a class="mono" href="${ex('address', a)}" target="_blank" rel="noopener">${a}</a></td><td>${what}</td></tr>`;
    const S = [
      ['overview', 'Overview', `<p>Lootbag is a coin launchpad on Base, built on Uniswap v4. Every coin launched on Lootbag shares its trading fees with the wallets that hold it: part of the fee on each trade is kept for them by the coin's own contract.</p><p>A creator makes two choices when launching a coin. The first is the pair, the token the coin is priced in: VVV (the default), ETH, USDC or a tokenized stock. The second is the reward, the token its holders are paid in. After the launch, fees are collected on every trade. Payout rounds, run by Lootbag, buy the reward and send it to holders' wallets, and a holder can also claim what they have earned at any time.</p><p>Lootbag shares its own revenue as well. 10% of it goes to the traders of Lootbag coins as VVV airdrops, and 25% goes to Bags and is paid into vaults owned by their holders.</p>`],
      ['launch', 'Launching a coin', `<p>A launch takes one form and one transaction, paid in ETH.</p><ul><li><b>Pair.</b> VVV by default, or ETH, USDC or a stock. Buyers always pay in ETH: the route swaps it for them.</li><li><b>Reward.</b> The token holders are paid in. It defaults to ETH; pick up to 10 and they take turns.</li><li><b>Launch transaction.</b> Creates the coin and opens its own Uniswap v4 pool with all 1,000,000,000 coins in it. The pool's liquidity is held by Lootbag. It costs 0.001 ETH plus gas.</li><li><b>Dev buy.</b> Required, about 0.006 ETH or more, inside the launch transaction so nobody can buy before the creator. A creator can hold at most 2% at launch.</li><li><b>Picture and links.</b> Saved on-chain with the launch. They can't be changed afterwards.</li><li><b>Launch-block buyers earn nothing.</b> A wallet that receives the coin in its launch block never earns holder rewards from it, and neither does the creator's wallet.</li></ul>`],
      ['trading', 'How a coin trades', `<p>Every coin trades in its own Uniswap v4 pool from the first block. There is no bonding curve and no graduation: the pool is the market from launch. On Lootbag you buy and sell with ETH through Lootbag's router, which swaps ETH into the coin's pair and back for you.</p><p><b>Lootbag can withdraw a coin's liquidity.</b> Every coin's pool liquidity is held by Lootbag's factory contract, and Lootbag's admin can withdraw any share of it, up to all, at any time, including what buyers paid into the pool. A partial withdrawal leaves a thinner pool; after a full one the coin can no longer be traded in its pool. Holder rewards already earned are not part of the pool and stay claimable.</p>`],
      ['fees', 'Fees', `<p>Every buy and sell pays a fee of 2%.</p><table><tr><th>Holders</th><th>Lootbag</th></tr><tr><td>0.5%</td><td>1.5%</td></tr></table><p>Lootbag's share is split as it is paid: 25% to the Bag pot, 10% to the trader airdrop pot, and the rest to Lootbag. Holders never receive Lootbag's share, and Lootbag never takes theirs.</p>`],
      ['rewards', 'Holder rewards', `<p>The holders' share of each fee is booked to holders as the trade happens, by the size of their balances. Each holder's share is kept by the coin's own contract, which updates it on every transfer, so it is exact and on-chain. Pools, launch-block buyers and the creator's wallet are left out.</p><p>Every coin has a payout round every five minutes, counted from its launch, and its rewards take turns round by round. A round is run by Lootbag: it swaps the holders' share into that round's reward and sends it to the holders' wallets. Lootbag runs a coin's round when enough has built up to be worth the swap, so not every five-minute round pays. You never have to wait for one: the Rewards page lets you claim your share at any time, paid in the coin's pair token.</p>`],
      ['airdrops', 'Trader airdrops', `<p>10% of Lootbag's revenue goes into the airdrop pot, which is kept in VVV. About every 10 hours Lootbag posts a round that pays the pot to the 500 wallets that traded the most volume on Lootbag coins. #1, #2 and #3 get 5.3%, 4%, 3%; places 4–20 share 13%; everyone else up to #500 shares the rest by volume. Each round's list is posted on-chain and can be checked by anyone.</p>`],
      ['tickers', 'Tickers', `<p>A ticker is 2 to 10 letters or digits; capitalization doesn't matter. Each ticker can be launched once for free. Launching an existing ticker again costs 0.05 ETH, refunded if the new coin reaches $70K market cap within 48 hours.</p>`],
      ['bags', 'Bags', `<p>A Bag is an NFT with its own vault. The collection is limited to 1,000. Minting burns 100,000 $LOOT and costs 3 VVV, of which 2.7 VVV goes to the Bags already minted and 0.3 VVV to Lootbag. The Bag pot holds VVV. In a payout round, at most once an hour, the pot spends 5% of what it holds on the day's token and credits an equal amount to every Bag's vault. The holder of the Bag can withdraw its vault at any time; the vault moves with the Bag when it's sold.</p>`],
      ['loot', '$LOOT', `<p>$LOOT is Lootbag's own coin. ${D.loot ? `Its address is <a class="mono" href="${ex('token', D.loot)}" target="_blank" rel="noopener">${D.loot}</a>.` : '<b>It has not launched yet.</b> Until its address is shown here and in the header, any coin called $LOOT is not Lootbag\'s.'} Minting a Bag burns 100,000 $LOOT.</p>`],
      ['contracts', 'Contracts', `<p>Lootbag's contracts on Base.</p><div class="tw"><table>${[['Factory', K.factory, 'Launches coins, holds every pool\'s liquidity'], ['Fee hook', K.hook, 'Takes the 2% fee on every trade'], ['Payouts', K.payout, 'Holds and pays holder rewards'], ['Router', K.router, 'Buys and sells with ETH'], ['Swapper', K.swapper, 'Routes between pairs and rewards'], ['Bags', K.bags, 'The Bag collection and its pot'], ['Airdrop pot', K.airdrop, 'Pays trader airdrops']].map((r) => row(...r)).join('')}</table></div>`],
    ];
    view.innerHTML = `<div class="doc"><nav>${S.map(([id, t], i) => `<a href="#/how#${id}" data-to="${id}" class="${i ? '' : 'on'}">${t}</a>`).join('')}</nav><div><div class="ph1" style="margin-top:0"><h1>How it works</h1><p>How coins are launched and traded on Lootbag, how fees are divided, and how holders and traders are paid.</p></div>${S.map(([id, t, b]) => `<section id="d-${id}"><h2>${t}</h2>${b}</section>`).join('')}</div></div>${foot()}`;
    $$('[data-to]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); $$('[data-to]').forEach((x) => x.classList.toggle('on', x === a)); $('#d-' + a.dataset.to).scrollIntoView({ behavior: 'smooth' }); }));
    const frag = location.hash.split('#')[2]; if (frag) setTimeout(() => { const el = $('#d-' + frag); if (el) el.scrollIntoView(); }, 50);
  }

  // ---------- router
  function route() {
    timers.forEach(clearInterval); timers = []; onWallet = null; onData = null; if (chart) { chart.remove(); chart = null; }
    const h = location.hash.replace(/^#/, '') || '/', parts = h.split('#')[0].split('/').filter(Boolean), r = parts[0] || '';
    const key = '#/' + (r === 'coin' ? '' : r);
    $$('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === key));
    window.scrollTo(0, 0);
    if (!r) board(); else if (r === 'coin') coin(parts[1] || ''); else if (r === 'create') create(); else if (r === 'rewards') rewards(); else if (r === 'airdrops') airdrops(); else if (r === 'bags') bags(); else if (r === 'mint') mint(); else if (r === 'coins') lootCoins(); else if (r === 'loot') coin((D.coins.find((x) => x.official) || {}).addr || ''); else if (r === 'how') how(); else board();
  }
  // search: live results under the box; arrows to move, Enter to open, Esc to close, "/" to focus
  const S = { list: [], ix: 0 }, sres = $('#sres'), qi = $('#q'), top = $('.top');
  const shut = () => { sres.hidden = true; };
  const sFind = (q) => { q = q.trim().toLowerCase().replace(/^\$/, ''); if (!q) return []; return D.coins.filter((c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q) || c.addr.toLowerCase().includes(q)).map((c) => [c, (c.ticker.toLowerCase().startsWith(q) ? 3 : 0) + (c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) ? 2 : 0)]).sort((a, b) => b[1] - a[1] || b[0].mcap - a[0].mcap).map((x) => x[0]).slice(0, 7); };
  const sDraw = () => {
    const q = qi.value.trim();
    if (!q) { shut(); return; }
    S.list = sFind(q); S.ix = Math.min(S.ix, Math.max(0, S.list.length - 1));
    sres.innerHTML = S.list.length ? `<div class="sh">Coins</div>` + S.list.map((c, i) => `<a href="${c.official ? '#/loot' : '#/coin/' + c.addr}" class="${i === S.ix ? 'on' : ''}" data-i="${i}">${av(c, 34)}<span class="sn"><b>${esc(c.name)}</b><small>$${esc(c.ticker)} · ${short(c.addr)}</small></span><span class="sv"><b>${usd(c.mcap)}</b><small class="${c.ch24 >= 0 ? 'up' : 'dn'}">${c.ch24 >= 0 ? '+' : ''}${c.ch24.toFixed(1)}%</small></span></a>`).join('') : `<div class="sempty">No coins match "${esc(q)}"</div>`;
    sres.hidden = false;
    $$('#sres a').forEach((a) => { a.onmouseenter = () => { S.ix = +a.dataset.i; $$('#sres a').forEach((x) => x.classList.toggle('on', x === a)); }; a.onclick = () => { qi.value = ''; shut(); qi.blur(); top.classList.remove('searching'); }; });
  };
  qi.oninput = () => { S.ix = 0; sDraw(); state.q = ''; };
  qi.onfocus = () => { if (qi.value.trim()) sDraw(); };
  qi.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!S.list.length) return; S.ix = (S.ix + (e.key === 'ArrowDown' ? 1 : -1) + S.list.length) % S.list.length; $$('#sres a').forEach((x, i) => x.classList.toggle('on', i === S.ix)); }
    else if (e.key === 'Enter') { const c = S.list[S.ix]; if (c) { location.hash = c.official ? '#/loot' : '#/coin/' + c.addr; qi.value = ''; shut(); qi.blur(); top.classList.remove('searching'); } }
    else if (e.key === 'Escape') { qi.value = ''; shut(); qi.blur(); top.classList.remove('searching'); }
  };
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); qi.focus(); } });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#search')) shut(); });
  $('#msearch').onclick = () => { top.classList.add('searching'); qi.focus(); };
  $('#scancel').onclick = () => { qi.value = ''; shut(); top.classList.remove('searching'); };
  if (matchMedia('(max-width: 900px)').matches) qi.placeholder = 'Search coins or addresses';
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-pv]'); if (t) { e.preventDefault(); toast('That page is not up yet.'); } });
  D.ready.then(() => { status(); route(); addEventListener('hashchange', route); LIVE.onUpdate(() => { status(); if (onData) onData(); }); });
})();
