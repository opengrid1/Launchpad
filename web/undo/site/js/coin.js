/* Coin page: head, undo figures, chart, trade card with the undo window, your open windows, activity. */
(function () {
  let x = null, side = 'buy', tab = 'trades', withUndo = true, timer = null;
  const U = () => window.UI;

  function head() {
    const { esc, usd, delta, ago, short, ic, pairGlyph, winLabel, $ } = U();
    const pairDesc = x.pair.kind === 'stock' ? `${esc(x.pair.name)} · ${usd(x.pair.usd)}` : `${esc(x.pair.name || x.pair.symbol)} · ${usd(x.pair.usd)}`;
    return `<nav class="crumbs"><a href="/">Explore</a><span>/</span><span>${esc(x.name)}</span></nav>
      <div class="coin-head">${pairGlyph(x, 'lg')}<div class="coin-title"><h1>${esc(x.name)}<small>$${esc(x.symbol)}</small></h1>
        <div class="coin-meta"><span class="tag">${x.pair.kind === 'stock' ? ic('globe') : ''}Paired with ${esc(x.pair.symbol)}</span><span class="tag key">${ic('undo')}${winLabel(x.windowH)} undo</span><span class="tag ${x.feeTo === 'burn' ? 'undone' : 'kept'}">Undo fees → ${x.feeTo === 'burn' ? 'burned' : 'holders'}</span><span>${ago(x.createdAt)} old</span><button class="addr" data-copy="${x.addr}" title="Copy contract">${short(x.addr)}${ic('copy')}</button></div>
        <div class="faint" style="font-size:12.5px;margin-top:6px">${pairDesc}</div></div>
        <div class="coin-price"><b>${usd(x.px)}</b><small>${delta(x.c24)} · ${usd(x.mc)} mcap</small></div></div>`;
  }
  function kpis() {
    const { usd, num, keptBar } = U(); const openN = x.trades.filter(t => t.state === 'open').length;
    return `<div class="panel undo-kpis"><div><span>Kept</span><b>${x.keptPct == null ? '—' : x.keptPct.toFixed(0) + '%'}</b><small>${x.windowBuys - x.undos} of ${x.windowBuys} window buys stayed</small></div>
      <div><span>Open windows</span><b>${usd(x.openUsd)}</b><small>${openN} buy${openN === 1 ? '' : 's'} that can still be undone</small></div>
      <div><span>Undo reserve</span><b class="c-reserve">${usd(x.reserveUsd)}</b><small>covers ${(x.coverage * 100).toFixed(0)}% of open windows</small></div>
      <div><span>${x.feeTo === 'burn' ? 'Burned by undos' : 'Paid to holders'}</span><b class="${x.feeTo === 'burn' ? 'c-undone' : 'c-kept'}">${usd(x.feeTo === 'burn' ? x.burnedUsd : x.holdersEarned)}</b><small>from ${x.undos} undo${x.undos === 1 ? '' : 's'}</small></div></div>`;
  }

  // ------------------------------------------------------------ trade card
  function trade() {
    const { esc, ic, pairIcon, curve } = U();
    return `<section class="panel trade"><div class="tk-tabs"><button data-side="buy" class="${side === 'buy' ? 'on' : ''}">Buy</button><button data-side="sell" class="${side === 'sell' ? 'on' : ''}">Sell</button></div>
      <div class="trade-b">
        <div class="field"><label for="amt">${side === 'buy' ? 'Spend' : 'Sell'}</label><div class="amt"><input id="amt" inputmode="decimal" placeholder="0" autocomplete="off"><span class="unit">${side === 'buy' ? `<img class="tok" src="/img/tokens/eth.webp" alt="">ETH` : `<span class="av" style="--h:${x.hue};width:22px;height:22px;font-size:10px">${esc(x.symbol[0])}</span>${esc(x.symbol)}`}</span></div>
          <div class="quick">${(side === 'buy' ? ['0.01', '0.05', '0.1', '0.5'] : ['25%', '50%', '75%', '100%']).map(q => `<button data-q="${q}">${q}</button>`).join('')}</div></div>
        ${side === 'buy' ? `<div class="undo-opt ${withUndo ? 'on' : ''}"><div class="row">${ic('undo')}<b>Buy with undo window</b><button class="switch" role="switch" aria-checked="${withUndo}" id="undoSw" aria-label="Undo window"></button></div>
          <p>${withUndo ? `For <b>${x.windowH} hours</b> you can take this buy back. You get <b>97%</b> right away, less the longer you wait, nothing once the window closes. Your coins unlock when it closes.` : 'A plain buy. The coins land in your wallet now and there is no taking it back.'}</p>
          ${withUndo ? curve(x.windowH, null) : ''}</div>` : `<div class="undo-opt"><div class="row">${ic('lock')}<b>Coins inside a window can't be sold</b></div><p>Undo them instead, or wait for the window to close. Everything else sells like a normal swap.</p></div>`}
        <div class="quote" id="quote"></div>
        <button class="btn ${side === 'buy' ? 'btn-key' : 'btn-ink'} btn-lg btn-block" id="tradeGo">${side === 'buy' ? (withUndo ? `Buy with ${x.windowH}h undo` : 'Buy') : 'Sell'}</button>
      </div></section>`;
  }
  function quote() {
    const { usd, num, $ } = U(); const v = parseFloat(($('#amt') || {}).value) || 0; const q = $('#quote'); if (!q) return;
    if (!v) { q.innerHTML = ''; return; }
    const tax = UD.cfg.taxBps / 10000;
    if (side === 'buy') { const ethUsd = UD.pairUsd('ETH'); const usdIn = v * ethUsd; const coins = usdIn * (1 - tax) / x.px * (1 - Math.min(.3, usdIn / (x.mc * .6)));
      q.innerHTML = `<div><span>You get</span><b>${num(coins, 0)} ${x.symbol}</b></div><div><span>Tax 1%</span><b>${usd(usdIn * tax)} · 0.5% creator, 0.3% platform, 0.2% reserve</b></div><div><span>Price impact</span><b>${(Math.min(30, usdIn / (x.mc * .6) * 100)).toFixed(2)}%</b></div>${withUndo ? `<div><span>Undo right away gets back</span><b>${(v * 0.97).toFixed(4)} ETH</b></div><div><span>Window closes</span><b>in ${x.windowH} hours</b></div>` : ''}`; }
    else { const pct = /%/.test(String(v)) ? v : 0; const coins = v; const out = coins * x.px * (1 - tax) / UD.pairUsd('ETH');
      q.innerHTML = `<div><span>You get</span><b>${out.toFixed(5)} ETH · ${usd(coins * x.px * (1 - tax))}</b></div><div><span>Tax 1%</span><b>${usd(coins * x.px * tax)}</b></div>`; }
  }

  // ------------------------------------------------------------ your windows on this coin (preview: the example wallet)
  function windows() {
    const { esc, usd, num, clock, refundShare, ic } = U();
    const mine = UD.myWindows().filter(w => w.x.addr === x.addr);
    if (!mine.length) return '';
    return `<section class="panel"><div class="panel-h"><h2>Your open windows</h2><span class="r tag key">${mine.length}</span></div>${mine.map(w => `<div class="win" data-w="${w.id}">
      <div class="row">${ic('clock')}<div class="t"><b>${usd(w.paidUsd)} · ${num(w.coins, 0)} ${esc(x.symbol)}</b><small>bought ${U().ago(w.openedAt)} ago</small></div><span class="clock" data-clock="${w.closes}">—</span></div>
      <div class="drain"><i data-drain="${w.id}"></i></div>
      <div class="row"><small class="muted">Undo now gets back</small><b style="margin-left:auto" data-refund="${w.id}">—</b></div>
      <div class="acts"><button class="btn btn-key" data-undo="${w.id}">${ic('undo')}Undo</button><button class="btn btn-line" data-keep="${w.id}">Keep now</button></div></div>`).join('')}</section>`;
  }
  function tickWindows() {
    const { clock, refundShare, usd, $$ } = U(); const now = UD.now();
    for (const w of UD.myWindows().filter(w => w.x.addr === x.addr)) { const W = x.windowH * 3600; const el = now - w.openedAt; const share = refundShare(el, W);
      const c = $$(`[data-clock="${w.closes}"]`)[0]; if (c) c.textContent = clock(w.closes - now);
      const d = $$(`[data-drain="${w.id}"]`)[0]; if (d) d.style.width = (share / UI.START * 100).toFixed(2) + '%';
      const r = $$(`[data-refund="${w.id}"]`)[0]; if (r) r.textContent = `${usd(w.paidUsd * share)} · ${(share * 100).toFixed(1)}%`; }
  }

  function about() {
    const { esc, usd, short, addrLink, ic, winLabel } = U(); const s = UD.cfg.split;
    const links = [x.links.web && ['Website', x.links.web, 'globe'], x.links.x && ['X', x.links.x, 'xlogo'], x.links.tg && ['Telegram', x.links.tg, 'send']].filter(Boolean);
    return `<section class="panel"><div class="panel-h"><h2>About</h2></div><div class="panel-b">
      <p style="margin-bottom:14px">${esc(x.desc)}</p>
      <div class="facts"><div><span>Contract</span><b><a class="link mono" href="${addrLink(x.addr)}" target="_blank" rel="noopener">${short(x.addr)}</a></b></div><div><span>Pair</span><b>${esc(x.pair.symbol)}${x.pair.kind === 'stock' ? ' (Ondo tokenized stock)' : ''}</b></div><div><span>Undo window</span><b>${winLabel(x.windowH)}</b></div><div><span>Undo fees go to</span><b>${x.feeTo === 'burn' ? 'Burned' : 'Holders'}</b></div><div><span>Tax</span><b>1% on every trade</b></div><div><span>Creator</span><b><a class="link mono" href="${addrLink(x.creator)}" target="_blank" rel="noopener">${short(x.creator)}</a></b></div><div><span>Supply</span><b>1,000,000,000 · all in the pool at launch</b></div></div>
      <div style="margin-top:14px"><small class="muted">Where the 1% tax goes</small><div class="split-bar"><i style="flex:${s.creator};background:var(--ink)" title="Creator"></i><i style="flex:${s.platform};background:var(--faint)" title="Platform"></i><i style="flex:${s.reserve};background:var(--reserve)" title="Undo reserve"></i></div><div class="facts" style="font-size:13px"><div><span>Creator</span><b>0.5%</b></div><div><span>Platform</span><b>0.3%</b></div><div><span>Undo reserve</span><b class="c-reserve">0.2%</b></div></div></div>
      ${links.length ? `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">${links.map(([l, h, i]) => `<a class="btn btn-line btn-sm" href="${esc(h)}" target="_blank" rel="noopener">${ic(i)}${l}</a>`).join('')}</div>` : ''}</div></section>`;
  }

  // ------------------------------------------------------------ activity
  function activity() {
    const n = { trades: x.trades.length, windows: x.trades.filter(t => t.state).length, holders: x.top.length };
    return `<section class="panel act"><div class="tabs" id="actTabs" role="tablist"><button data-t="trades">Trades</button><button data-t="windows">Windows<span class="n">${n.windows}</span></button><button data-t="holders">Holders<span class="n">${U().num(x.holders, 0)}</span></button></div><div class="table-wrap" style="border:0;border-radius:0 0 var(--r) var(--r)" id="act"></div></section>`;
  }
  function paintActivity() {
    const { usd, num, ago, short, esc, clock, $$ } = U(); const box = document.getElementById('act'); const now = UD.now();
    $$('#actTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    const label = t => t.side === 'buy' ? 'Buy' : t.side === 'sell' ? 'Sell' : 'Undo';
    if (tab === 'trades') box.innerHTML = `<table class="list"><thead><tr><th>Age</th><th class="l">Side</th><th>Value</th><th>$${esc(x.symbol)}</th><th>Wallet</th></tr></thead><tbody>${x.trades.slice(0, 20).map(t => `<tr><td class="l"><span class="num muted">${ago(t.ts)}</span></td><td class="l"><span class="ev ${t.side}"><i></i>${label(t)}${t.side === 'undo' ? ` <small class="faint">${(t.share * 100).toFixed(0)}% back</small>` : t.state === 'open' ? ' <small class="faint">window open</small>' : ''}</span></td><td><span class="num">${usd(t.usd)}</span></td><td><span class="num">${num(t.coins, 0)}</span></td><td><span class="addr muted mono">${short(t.who)}</span></td></tr>`).join('')}</tbody></table>`;
    else if (tab === 'windows') { const ws = x.trades.filter(t => t.state).slice(0, 20);
      box.innerHTML = `<table class="list"><thead><tr><th>Opened</th><th class="l">Buy</th><th class="l">State</th><th>Closes</th><th>Wallet</th></tr></thead><tbody>${ws.map(t => `<tr><td class="l"><span class="num muted">${ago(t.ts)} ago</span></td><td class="l"><span class="num">${usd(t.usd)}</span></td><td class="l"><span class="ev ${t.state === 'undone' ? 'undo' : t.state === 'kept' ? 'keep' : 'buy'}"><i></i>${t.state === 'open' ? 'Open' : t.state === 'kept' ? 'Kept' : `Undone · ${usd(t.refund)} back`}</span></td><td><span class="num">${t.state === 'open' ? clock(t.closes - now) : '—'}</span></td><td><span class="addr muted mono">${short(t.who)}</span></td></tr>`).join('')}</tbody></table>`; }
    else { const max = x.top[0] ? x.top[0].bal : 1; box.innerHTML = `<table class="list"><thead><tr><th>#</th><th class="l">Wallet</th><th>Balance</th><th class="l">Share of supply</th></tr></thead><tbody>${x.top.map((h, i) => `<tr><td class="l"><span class="num faint">${i + 1}</span></td><td class="l"><span class="addr mono">${short(h.addr)}</span></td><td><span class="num">${num(h.bal, 0)}</span></td><td class="l"><span class="hbar"><i style="width:${(h.bal / max * 100).toFixed(1)}%"></i></span><span class="num">${(h.bal / UD.SUPPLY * 100).toFixed(2)}%</span></td></tr>`).join('')}</tbody></table>`; }
  }

  function paint() {
    const { $, $$, notLive, copy } = U();
    $('#coinRoot').innerHTML = `${head()}<div class="coin-grid"><div class="coin-main">${kpis()}<div class="chart" id="chart"></div>${activity()}</div><div class="coin-side">${trade()}${windows()}${about()}</div></div>`;
    document.title = `${x.name} ($${x.symbol}) · undo.fun`;
    paintActivity();
    $$('#actTabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; paintActivity(); });
    $$('.tk-tabs button').forEach(b => b.onclick = () => { side = b.dataset.side; paint(); });
    const sw = $('#undoSw'); if (sw) sw.onclick = () => { withUndo = !withUndo; paint(); };
    $('#amt').oninput = quote; $$('.quick button').forEach(b => b.onclick = () => { $('#amt').value = b.dataset.q.replace('%', ''); quote(); });
    $('#tradeGo').onclick = notLive; $$('[data-undo],[data-keep]').forEach(b => b.onclick = notLive);
    $$('[data-copy]').forEach(b => b.onclick = () => copy(b.dataset.copy, 'Contract'));
    if (window.TradingView && window.udChart) udChart.init($('#chart'), x); else window.addEventListener('load', () => window.udChart && udChart.init($('#chart'), x), { once: true });
    tickWindows(); clearInterval(timer); timer = setInterval(tickWindows, 1000);
  }
  function start() {
    const key = decodeURIComponent(location.pathname.split('/coin/')[1] || '').toLowerCase(); x = UD.token(key);
    if (!x) { UI.$('#coinRoot').innerHTML = '<div class="empty"><h3>No coin at this address</h3><p>Check the link, or find it from Explore.</p><a class="btn btn-ink" href="/">Explore</a></div>'; return; }
    paint();
  }
  window.addEventListener('DOMContentLoaded', () => UD.ready.then(start));
})();
