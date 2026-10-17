/* Coin page: chart first, then the figures as keys, everyone's windows and trades on the left, the trade keyboard on the right.
   On phones the keyboard docks to the bottom and opens as a sheet. Quotes and transactions go through UD (chain layer or preview). */
(function () {
  let x = null, side = 'buy', tab = 'windows', withWin = true, hours = 6, amt = '', timer = null, busy = false;
  let myWins = [], bal = null, lastQ = null, qSeq = 0;
  const U = () => window.UI;
  const who = () => (window.bsWallet && bsWallet.connected ? bsWallet.address : null);

  function bar() {
    const { esc, usd, delta, ago, short, ic, pairGlyph } = U();
    return `<div class="coin-bar">${pairGlyph(x, 'lg')}<div class="t"><h1>${esc(x.name)}<small>$${esc(x.symbol)}</small></h1>
      <div class="chips"><span class="tag">${x.pair.kind === 'stock' ? ic('globe') : ''}${esc(x.pair.symbol)} pair</span><span class="tag key">${ic('undo')}cntrl-z 30m–7d</span><span>${ago(x.createdAt)} old</span><button class="addr" data-copy="${x.addr}" title="Copy contract">${short(x.addr)}${ic('copy')}</button></div></div>
      <div class="px"><b>${usd(x.px)}</b><small>${delta(x.c24)} · ${usd(x.mc)} mcap · ${usd(x.vol24)} today</small></div></div>`;
  }
  function keyrow() {
    const { usd, eth, num } = U(); const open = x.trades.filter(t => t.state === 'open').length;
    return `<div class="keyrow"><div class="stat-key"><span>Kept</span><b class="${x.keptPct == null ? 'faint' : x.keptPct >= 80 ? 'c-kept' : x.keptPct < 55 ? 'c-undone' : ''}">${x.keptPct == null ? '—' : x.keptPct.toFixed(0) + '%'}</b><small>${x.windowBuys - x.undos} of ${x.windowBuys} window buys stayed</small></div>
      <div class="stat-key"><span>Held in open windows</span><b>${eth(x.openEth)}</b><small>${open} buy${open === 1 ? '' : 's'} · ${usd(x.openUsd)} · refundable in full</small></div>
      <div class="stat-key"><span>Burned by windows</span><b class="c-undone">${num(x.burnedCoins, 0)}</b><small>${usd(x.burnedUsd)} · from ${eth(x.premiumsEth)} of premiums</small></div>
      <div class="stat-key"><span>Holders</span><b>${num(x.holders, 0)}</b><small>${x.top.length ? `top ${x.top.length} hold ${(x.top.reduce((s, h) => s + h.bal, 0) / UD.SUPPLY * 100).toFixed(0)}%` : 'from the explorer'}</small></div></div>`;
  }

  // ------------------------------------------------------------ the trade keyboard
  function buyEth() { return side === 'buy' ? parseFloat(amt) || 0 : 0; }
  function trade() {
    const { esc, ic, eth, num, timeKeys, winLabel, premiumFor, maxHoursFor } = U(); const v = buyEth(); const tooSmall = withWin && v > 0 && maxHoursFor(v) < hours;
    const balLine = bal ? `<small class="faint" style="margin-left:auto">${side === 'buy' ? eth(bal.eth) : num(bal.coin, 0) + ' ' + esc(x.symbol)} in wallet</small>` : '';
    return `<section class="panel trade"><div class="tk-tabs"><button class="key ${side === 'buy' ? 'down green' : ''}" data-side="buy">Buy</button><button class="key ${side === 'sell' ? 'down red' : ''}" data-side="sell">Sell</button></div>
      <div class="trade-b">
        <div class="field"><label for="amt" style="display:flex;align-items:baseline;gap:8px">${side === 'buy' ? 'You pay' : 'You sell'}${balLine}</label><div class="amt"><input id="amt" inputmode="decimal" placeholder="0" autocomplete="off" value="${esc(amt)}"><span class="unit">${side === 'buy' ? `<img class="tok" src="/img/tokens/eth.webp" alt="">ETH` : `<img class="tok" src="${esc(x.img || U().DEFAULT_COIN)}" alt="" style="border-radius:6px">${esc(x.symbol)}`}</span></div>
          <div class="quick">${(side === 'buy' ? ['0.05', '0.1', '0.25', '0.5', '1'] : ['25%', '50%', '75%', '100%']).map(q => `<button class="key sm" data-q="${q}">${q}</button>`).join('')}</div></div>
        ${side === 'buy' ? `<div class="undo-opt ${withWin ? 'on' : ''}"><div class="row">${ic('undo')}<b>cntrl-z window</b><span class="faint" style="font-size:12.5px">${withWin ? 'on' : 'off'}</span><button class="switch" role="switch" aria-checked="${withWin}" id="winSw" aria-label="cntrl-z window"></button></div>
          ${withWin ? `${timeKeys(hours, v || null)}<p>${tooSmall ? `<span class="c-undone">Too small for ${winLabel(hours)}. A window can cost at most 30% of the buy.</span>` : `<b>${winLabel(hours)}</b> costs <b>${eth(premiumFor(hours))}</b>, burned. Cancel before it closes and the whole buy comes back.`}</p>` : '<p>Coins land in your wallet now. No taking it back.</p>'}</div>`
        : `<div class="undo-opt"><div class="row">${ic('lock')}<b>Coins in a window can't be sold</b></div><p>Cancel the window or press Keep first.</p></div>`}
        <div class="quote" id="quote"></div>
        <button class="key lg wide ${side === 'buy' ? 'green' : 'red'}" id="tradeGo" ${tooSmall || busy ? 'disabled' : ''}>${busy ? 'Confirm in your wallet…' : side === 'buy' ? (withWin ? `Buy with ${winLabel(hours)} window` : 'Buy') : 'Sell'}</button>
      </div></section>`;
  }
  // ask the data layer for the numbers; the newest request wins
  async function quote(root) {
    const { usd, num, eth, pct, $ } = U(); const v = parseFloat(amt) || 0; const q = $('#quote', root); if (!q) return;
    if (!v) { q.innerHTML = ''; lastQ = null; return; }
    const seq = ++qSeq; if (!q.innerHTML) q.innerHTML = '<div><span class="faint">Quoting…</span><b></b></div>';
    try {
      if (side === 'buy') {
        const r = await UD.quoteBuy(x.addr, v, withWin ? hours : 0); if (seq !== qSeq) return; lastQ = r;
        const taxLabel = r.taxBps > 100 ? `Launch-minute tax ${(r.taxBps / 100).toFixed(0)}%` : 'Tax 1%';
        q.innerHTML = r.ok ? `<div><span>You get</span><b>${num(r.coins, 0)} ${x.symbol}</b></div><div><span>${taxLabel}</span><b>${eth(r.feeEth)}</b></div><div><span>Price impact</span><b class="${r.impact > 10 ? 'c-undone' : ''}">${pct(r.impact, 2)}</b></div>${withWin ? `<div><span>Window, burned</span><b>${eth(r.premiumEth)}</b></div>${r.refundEth > 0.000001 ? `<div><span>Unused, back to you</span><b>${eth(r.refundEth)}</b></div>` : ''}<div class="total"><span>Held in the window</span><b>${eth(r.costEth)}</b></div><div><span>If you cancel</span><b class="c-kept">${eth(r.costEth)} back</b></div>` : ''}`
          : `<div><span class="c-undone">${r.reason}</span><b></b></div>`;
      } else {
        const r = await UD.quoteSell(x.addr, v); if (seq !== qSeq) return; lastQ = r;
        q.innerHTML = `<div><span>You get</span><b>${eth(r.ethOut)} · ${usd(r.usd)}</b></div><div><span>Tax 1%</span><b>${usd(r.feeUsd)}</b></div>${x.pair.address !== UD.weth && UD.live ? `<div><span>Route</span><b>${x.pair.symbol} → ETH</b></div>` : ''}`;
      }
    } catch (e) { if (seq === qSeq) q.innerHTML = `<div><span class="c-undone">${U().esc(UD.errText ? UD.errText(e) : e.message)}</span><b></b></div>`; }
  }
  let qTimer = null;
  const quoteSoon = root => { clearTimeout(qTimer); qTimer = setTimeout(() => quote(root), 180); };
  async function go(root) {
    const { toast, $ } = U(); const v = parseFloat(amt) || 0; if (!v) { toast('Enter an amount', { err: true }); return; }
    if (!UD.live) { U().notLive(); return; }
    if (!who()) { window.bsWallet && bsWallet.open(); return; }
    if (!lastQ) await quote(root); if (!lastQ || (side === 'buy' && !lastQ.ok)) { toast(lastQ && lastQ.reason || 'No quote yet', { err: true }); return; }
    busy = true; redrawAll();
    try {
      let rc;
      if (side === 'buy') { const min = lastQ.coinsRaw * 97n / 100n; rc = await UD.buy(x.addr, v, withWin ? hours : 0, min); toast(withWin ? `Bought with a ${U().winLabel(hours)} window` : `Bought $${x.symbol}`, { tx: rc.hash }); }
      else { const min = lastQ.ethOutRaw * 96n / 100n; rc = await UD.sell(x.addr, v, min); toast(`Sold $${x.symbol}`, { tx: rc.hash }); }
      amt = ''; lastQ = null; await reload();
    } catch (e) { toast(e.message, { err: true }); }
    busy = false; redrawAll();
  }
  function bindTrade(root, redraw) {
    const { $, $$ } = U();
    $$('.tk-tabs .key', root).forEach(b => b.onclick = () => { side = b.dataset.side; amt = ''; lastQ = null; redraw(); });
    const sw = $('#winSw', root); if (sw) sw.onclick = () => { withWin = !withWin; lastQ = null; redraw(); };
    $$('.timekeys .key', root).forEach(b => b.onclick = () => { hours = +b.dataset.h; lastQ = null; redraw(); });
    const inp = $('#amt', root); inp.oninput = () => { amt = inp.value.replace(/[^0-9.]/g, ''); inp.value = amt; lastQ = null; redraw(true); };
    $$('.quick .key', root).forEach(b => b.onclick = () => { const q = b.dataset.q; if (q.endsWith('%')) { if (!bal) { U().toast(who() ? 'Loading your balance…' : 'Connect a wallet first', { icon: 'info' }); return; } amt = String(+(bal.coin * parseFloat(q) / 100).toFixed(6)); } else amt = q; lastQ = null; redraw(); });
    $('#tradeGo', root).onclick = () => go(root);
    quoteSoon(root);
  }
  // draw the keyboard into a container; keep the caret in the amount box when only the amount changed
  const mounts = [];
  function mountTrade(box) {
    const draw = fromInput => { const inp = box.querySelector('#amt'); const pos = inp && fromInput ? inp.selectionStart : null; box.innerHTML = trade(); bindTrade(box, draw); if (pos != null) { const n = box.querySelector('#amt'); n.focus(); n.setSelectionRange(pos, pos); } };
    mounts.push({ box, draw }); draw();
  }
  const redrawAll = () => mounts.filter(m => document.contains(m.box)).forEach(m => m.draw());

  // ------------------------------------------------------------ your windows on this coin
  function mine() {
    const { esc, eth, num, ic, winLabel, ago } = U();
    const ws = myWins; if (!ws.length) return '';
    return `<section class="panel" id="mine"><div class="panel-h"><h2>Your windows</h2><span class="r tag key">${ws.length}</span></div>${ws.map(w => `<div class="win" ${w.state === 'open' ? `data-closes="${w.closes}" data-opened="${w.openedAt}"` : ''}>
      <div class="row"><div class="t"><b>${eth(w.paidEth)} · ${num(w.coins, 0)} ${esc(x.symbol)}</b><small>${winLabel(w.hours)} window · ${eth(w.premium)} burned · ${ago(w.openedAt)} ago</small></div><span class="clock">${w.state === 'open' ? '<span data-c>—</span>' : '<span class="c-kept">Closed</span>'}</span></div>
      <div class="drain"><i data-d ${w.state === 'open' ? '' : 'style="width:0"'}></i></div>
      ${w.state === 'open' ? `<div class="row"><small class="muted">Cancel now and get back</small><b style="margin-left:auto">${x.pair.address === UD.weth || !UD.live ? eth(w.paidEth) : `${w.paidPair.toFixed(w.paidPair >= 1 ? 3 : 5)} ${esc(x.pair.symbol)}`}</b></div>
      <div class="acts"><button class="key yellow" data-undo="${w.id}">${ic('undo')}Cancel buy</button><button class="key" data-keep="${w.id}">Keep</button></div>` : `<div class="row"><small class="muted">The window closed. Press Keep to receive the coins.</small></div><div class="acts"><button class="key ink" data-keep="${w.id}">Keep</button></div>`}</div>`).join('')}</section>`;
  }
  function about() {
    const { esc, usd, short, addrLink, ic } = U(); const s = UD.cfg.split || { creator: 70, platform: 30 }; const me = who();
    const links = [x.links.web && ['Website', x.links.web, 'globe'], x.links.x && ['X', x.links.x, 'xlogo'], x.links.tg && ['Telegram', x.links.tg, 'send']].filter(Boolean);
    const isCreator = me && me === x.creator;
    return `<section class="panel"><div class="panel-h"><h2>About</h2></div><div class="panel-b">
      ${x.desc ? `<p style="margin-bottom:14px">${esc(x.desc)}</p>` : ''}
      <div class="facts"><div><span>Contract</span><b><a class="link mono" href="${addrLink(x.addr)}" target="_blank" rel="noopener">${short(x.addr)}</a></b></div><div><span>Pair</span><b>${esc(x.pair.symbol)}${x.pair.kind === 'stock' ? ' · Ondo tokenized stock' : ''}</b></div><div><span>Window</span><b>30 min to 7 days, 0.05 ETH per 6h</b></div><div><span>Premiums</span><b>Burned</b></div><div><span>Tax</span><b>1% on every trade</b></div><div><span>Creator</span><b><a class="link mono" href="${addrLink(x.creator)}" target="_blank" rel="noopener">${short(x.creator)}</a></b></div><div><span>Creator earned</span><b>${usd(x.creatorEarned)}</b></div><div><span>Supply</span><b>1,000,000,000 · all in the pool at launch</b></div></div>
      ${isCreator ? `<div class="arow" style="margin-top:12px"><div class="t"><b>Your creator fees</b><small>${usd(x.creatorClaimable)} waiting · paid in ${esc(x.pair.symbol === 'ETH' ? 'ETH' : x.pair.symbol)}</small></div><button class="key yellow sm" id="claimGo" ${x.creatorClaimable > 0 ? '' : 'disabled'}>Claim</button></div>` : ''}
      <div style="margin-top:14px"><small class="muted">Where the 1% tax goes</small><div class="split-bar"><i style="flex:${s.creator};background:var(--ink)" title="Creator"></i><i style="flex:${s.platform};background:var(--faint)" title="Platform"></i></div><div class="facts" style="font-size:13px"><div><span>Creator</span><b>${s.creator / 100}%</b></div><div><span>Platform</span><b>${s.platform / 100}%</b></div></div></div>
      ${links.length ? `<div class="keys" style="margin-top:14px">${links.map(([l, h, i]) => `<a class="key sm" href="${esc(h)}" target="_blank" rel="noopener">${ic(i)}${l}</a>`).join('')}</div>` : ''}</div></section>`;
  }

  // ------------------------------------------------------------ activity: windows, trades, holders
  function activity() {
    const n = { trades: x.trades.length, windows: x.trades.filter(t => t.state).length };
    return `<section class="panel act"><div class="tabs" id="actTabs" role="tablist"><button class="key sm" data-t="windows">Windows<span class="n">${n.windows}</span></button><button class="key sm" data-t="trades">Trades<span class="n">${n.trades}</span></button><button class="key sm" data-t="holders">Holders<span class="n">${U().num(x.holders, 0)}</span></button></div><div class="table-wrap" id="act"></div></section>`;
  }
  const whoCell = t => { const { short, addrLink } = U(); return t.who ? `<a class="muted mono" href="${addrLink(t.who)}" target="_blank" rel="noopener">${short(t.who)}</a>` : '<span class="faint">…</span>'; };
  const txCell = t => t.tx ? ` <a class="faint txl" href="${U().txLink(t.tx)}" target="_blank" rel="noopener" title="View transaction">${U().ic('ext', 'txi')}</a>` : '';
  function paintActivity() {
    const { usd, eth, num, ago, short, esc, clock, winLabel, $$ } = U(); const box = document.getElementById('act'); const now = UD.now();
    $$('#actTabs .key').forEach(b => b.classList.toggle('down', b.dataset.t === tab));
    const stateCell = t => t.state === 'open' ? 'Open' : t.state === 'expired' ? 'Closed, unclaimed' : t.state === 'kept' ? 'Kept' : 'Cancelled, refunded';
    if (tab === 'windows') { const ws = x.trades.filter(t => t.state).slice(0, 30);
      box.innerHTML = ws.length ? `<table class="list"><thead><tr><th class="l">Opened</th><th class="l">Buy</th><th class="l">Window</th><th class="l">State</th><th>Closes</th><th>Wallet</th></tr></thead><tbody>${ws.map(t => `<tr ${t.state === 'open' ? `data-closes="${t.closes}" data-opened="${t.ts}"` : ''}><td class="l"><span class="num muted">${ago(t.ts)} ago</span>${txCell(t)}</td><td class="l"><span class="num">${eth(t.eth)}</span></td><td class="l"><span class="mono">${winLabel(t.hours)}</span> <span class="faint">${eth(t.premium)}</span></td><td class="l"><span class="ev ${t.state === 'undone' ? 'undo' : t.state === 'kept' || t.state === 'expired' ? 'keep' : 'buy'}"><i></i>${stateCell(t)}</span></td><td><span class="num mono">${t.state === 'open' ? `<span data-c>${clock(t.closes - now)}</span>` : '—'}</span></td><td>${whoCell(t)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty" style="padding:36px 10px"><p>No window buys yet. Be the first: every buy here can be cancelled inside its window.</p></div>'; }
    else if (tab === 'trades') box.innerHTML = x.trades.length ? `<table class="list"><thead><tr><th class="l">Age</th><th class="l">Side</th><th>Value</th><th>$${esc(x.symbol)}</th><th>Wallet</th></tr></thead><tbody>${x.trades.slice(0, 30).map(t => `<tr><td class="l"><span class="num muted">${ago(t.ts)}</span>${txCell(t)}</td><td class="l"><span class="ev ${t.side}"><i></i>${t.side === 'buy' ? 'Buy' : t.side === 'sell' ? 'Sell' : 'Cancel'}${t.side === 'buy' && t.hours ? ` <small class="faint">${winLabel(t.hours)} window</small>` : ''}</span></td><td><span class="num">${usd(t.usd)}</span></td><td><span class="num">${num(t.coins, 0)}</span></td><td>${whoCell(t)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty" style="padding:36px 10px"><p>No trades yet.</p></div>';
    else { const max = x.top[0] ? x.top[0].bal : 1; box.innerHTML = x.top.length ? `<table class="list"><thead><tr><th class="l">#</th><th class="l">Wallet</th><th>Balance</th><th class="l">Share of supply</th></tr></thead><tbody>${x.top.map((h, i) => `<tr><td class="l"><span class="num faint">${i + 1}</span></td><td class="l"><a class="mono" href="${U().addrLink(h.addr)}" target="_blank" rel="noopener">${short(h.addr)}</a></td><td><span class="num">${num(h.bal, 0)}</span></td><td class="l"><span class="hbar"><i style="width:${(h.bal / max * 100).toFixed(1)}%"></i></span><span class="num">${(h.bal / UD.SUPPLY * 100).toFixed(2)}%</span></td></tr>`).join('')}</tbody></table>` : `<div class="empty" style="padding:36px 10px"><p>${x.holders ? 'The holder list is loading from the explorer.' : 'No holders yet, or the explorer has not indexed them.'}</p></div>`; }
  }
  function tick() {
    const now = UD.now();
    U().$$('[data-closes]').forEach(el => { const closes = +el.dataset.closes, opened = +el.dataset.opened; const left = closes - now; const c = el.querySelector('[data-c]'); if (c) c.textContent = U().clock(left); const d = el.querySelector('[data-d]'); if (d) d.style.width = (Math.max(0, left) / (closes - opened) * 100).toFixed(2) + '%'; });
  }

  // ------------------------------------------------------------ wallet-side state: my windows and balances
  async function loadMine() {
    const me = who(); if (!me) { myWins = []; bal = null; return; }
    try { const [p, b] = await Promise.all([UD.portfolio(me), UD.balances(x.addr, me)]); myWins = p.windows.filter(w => w.x.addr === x.addr); bal = b; } catch (e) { console.warn('mine', e); }
  }
  async function reload() { x = await UD.refresh(x.addr); await loadMine(); paint(); }
  async function act(fn, id, done) {
    const { toast } = U();
    try { const rc = await UD[fn](x.addr, Number(id)); toast(done, { tx: rc.hash }); await reload(); } catch (e) { toast(e.message, { err: true }); }
  }

  function paint() {
    const { $, $$, copy, dialog, toast } = U();
    const hadChart = !!$('#chart iframe');
    $('#coinRoot').innerHTML = `${bar()}<div class="chart" id="chart"></div>${keyrow()}<div class="coin-cols"><div class="coin-left">${activity()}</div><div class="coin-right"><div class="trade-slot"></div>${mine()}${about()}</div></div>
      <div class="dock"><button class="key lg green" data-dock="buy">Buy</button><button class="key lg red" data-dock="sell">Sell</button></div>`;
    document.title = `${x.name} ($${x.symbol}) · cntrl-z.fun`; $('#page').classList.add('has-dock');
    paintActivity();
    $$('#actTabs .key').forEach(b => b.onclick = () => { tab = b.dataset.t; paintActivity(); });
    mounts.length = 0; mountTrade($('.coin-right .trade-slot'));
    $$('[data-undo]').forEach(b => b.onclick = () => act('cancel', b.dataset.undo, 'Buy cancelled, refund sent'));
    $$('[data-keep]').forEach(b => b.onclick = () => act('keep', b.dataset.keep, `Kept your $${x.symbol}`));
    const cl = $('#claimGo'); if (cl) cl.onclick = async () => { try { const rc = await UD.payCreator(x.addr); toast('Creator fees paid out', { tx: rc.hash }); await reload(); } catch (e) { toast(e.message, { err: true }); } };
    $$('[data-copy]').forEach(b => b.onclick = () => copy(b.dataset.copy, 'Contract'));
    $$('[data-dock]').forEach(b => b.onclick = () => { side = b.dataset.dock; const ov = dialog(side === 'buy' ? 'Buy ' + x.symbol : 'Sell ' + x.symbol, `<div class="dialog-b sheet" id="sheet"></div>`, { onClose: () => { mounts.splice(0, mounts.length, ...mounts.filter(m => document.contains(m.box))); } }); mountTrade($('#sheet', ov)); });
    if (window.TradingView && window.udChart) udChart.init($('#chart'), x); else window.addEventListener('load', () => window.udChart && udChart.init($('#chart'), x), { once: true });
    tick(); clearInterval(timer); timer = setInterval(tick, 1000);
    // wallets behind trades that didn't go through our router come in a moment later
    if (UD.live && x.trades.some(t => !t.who)) UD.trades(x.addr).then(() => { if (tab !== 'holders') paintActivity(); }).catch(() => {});
    void hadChart;
  }
  async function start() {
    const key = decodeURIComponent(location.pathname.split('/coin/')[1] || '').toLowerCase(); x = UD.token(key);
    if (!x && UD.live && /^0x[0-9a-f]{40}$/.test(key)) { try { x = await UD.refresh(key); } catch {} } // a coin launched a moment ago, or hidden
    if (!x) { UI.$('#coinRoot').innerHTML = '<div class="empty"><h3>No coin at this address</h3><p>Check the link, or find it from Explore.</p><a class="key ink" href="/">Explore</a></div>'; return; }
    lastWho = who(); await loadMine(); paint();
  }
  window.addEventListener('DOMContentLoaded', () => UD.ready.then(start));
  let lastWho = null;
  window.addEventListener('bs:wallet', () => { if (!x || who() === lastWho) return; lastWho = who(); loadMine().then(paint); });
})();
