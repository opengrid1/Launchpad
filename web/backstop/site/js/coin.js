/* Coin page: price against its buyback line and vault backing, each strategy the coin runs, trading and activity. */
(function () {
  const U = () => window.UI;
  const addr = (location.pathname.split('/coin/')[1] || new URLSearchParams(location.search).get('a') || '').toLowerCase().replace(/[^0-9a-fx]/g, '');
  let x = null, tab = 'trades', side = 'buy', slip = 5;
  const pairAmt = (v) => U().num(v, v >= 100 ? 0 : 4) + ' ' + x.pairSym;

  // ------------------------------------------------------------ head
  function head() {
    const { esc, usd, delta, pairGlyph, tokImg, short, ago, ic } = U();
    return `<nav class="crumbs"><a href="/">Explore</a><span>/</span><span>${esc(x.name)}</span></nav>
    <div class="coin-head">${pairGlyph(x, 'lg')}
      <div class="coin-title"><h1>${esc(x.name)} <span class="sym">$${esc(x.symbol)}</span>${x.demo ? '<span class="tag sample">Sample</span>' : ''}</h1>
        <div class="coin-meta"><span class="pairwith">${tokImg({ logo: x.pairLogo })}Backed by <b>${esc(x.pairSym)}</b></span><span>${ago(x.createdAt)} old</span>
        <button data-copy="${x.addr}" title="Copy contract address">${ic('copy')}<span class="mono">${short(x.addr)}</span></button></div></div>
      <div class="coin-price"><b>${usd(x.px)}</b><span>${delta(x.c24)} · ${usd(x.mc)} mcap</span></div>
    </div>`;
  }
  function kpis() {
    const { usd, num } = U(); const v = x.vault, f = x.fund;
    return `<div class="kpis">
      <div class="v"><span>Vault</span><b>${v ? usd(v.usd) : '—'}</b></div>
      <div class="o"><span>Buyback fund</span><b>${f ? usd(f.usd) : '—'}</b></div>
      <div><span>Burned</span><b>${x.burned ? (x.burned / BS.SUPPLY * 100).toFixed(2) + '%' : '0%'}</b></div>
      <div><span>Holders</span><b>${num(x.holders, 0)}</b></div>
    </div>`;
  }

  // ------------------------------------------------------------ chart: TradingView Advanced Charts (tv.js)
  function chartPanel() {
    return `<section class="panel chart-panel"><div class="tv" id="tv"></div>
      <div class="legend">${x.fund ? '<span><i class="bb"></i>Next buyback</span>' : ''}${x.vault ? '<span><i class="v"></i>Vault backing</span>' : ''}${x.events.length ? '<span><i class="dot"></i>Burn (B on the bars)</span>' : ''}</div></section>`;
  }

  // ------------------------------------------------------------ strategy: one row per strategy the coin runs
  function strategies() {
    const { usd, pct, esc, bps, payoutLabel } = U(); const v = x.vault, f = x.fund; const rows = [];
    const row = (k, name, share, main, sub, extra) => `<div class="srow"><span class="strat"><i class="${k} on">${k.toUpperCase()}</i></span><div class="sname"><b>${name}</b>${share ? `<small>${share}</small>` : ''}</div><div class="sval"><b>${main}</b>${sub ? `<small>${sub}</small>` : ''}</div>${extra || ''}</div>`;
    if (v) rows.push(row('v', 'Vault', bps(x.split.vault) + ' of trades', usd(v.usd), `${usd(v.perCoin)} per coin`));
    if (f) rows.push(row('d', 'Dip buyback', bps(x.split.buyback) + ' of trades', usd(f.usd), `fires at ${usd(f.trigger)} <span class="c-bb">${pct(x.toTrigger)}</span>`));
    if (x.tp && v) { const gain = (v.usd / v.cost - 1) * 100; const at = Math.max(0, Math.min(100, gain / x.tp * 100));
      rows.push(row('t', 'Take profit', 'at +' + x.tp + '%', pct(gain), `<span class="progress mini"><i style="width:${at.toFixed(0)}%"></i></span>`)); }
    if (x.redeem && v) rows.push(row('r', 'Redeem', 'burn for backing', usd(v.perCoin), 'per coin', '<button class="btn btn-line" id="rdBtn">Redeem</button>'));
    if (x.split.holders) rows.push(row('h', 'Holder rewards', bps(x.split.holders) + ' of trades', usd(x.fees.holders), 'paid in ' + esc(payoutLabel(x))));
    return `<section class="panel strat-panel"><div class="panel-h"><h2>Strategy</h2><a class="r link" href="/docs#split" style="font-size:13px">How it works</a></div><div class="slist">${rows.join('')}</div></section>`;
  }
  function openRedeem() {
    const { usd, esc, dialog, $ } = U();
    const ov = dialog('Redeem at backing', `<div class="panel-b redeem-box"><div class="field"><label for="rdIn">Coins to burn</label><div class="input-wrap"><input class="input num with-post" id="rdIn" inputmode="decimal" value="1000000"><span class="post">$${esc(x.symbol)}</span></div></div>
      <div class="redeem-out"><span>You receive</span><b id="rdOut"></b></div><button class="btn btn-ink btn-block" disabled>Redeem</button>
      <p class="faint" style="font-size:12.5px">Opens when the contracts are live.</p></div>`);
    const rd = $('#rdIn', ov); const go = () => { const n = Number(rd.value) || 0; $('#rdOut', ov).textContent = `${pairAmt(n * x.vault.perCoinPair)} · ${usd(n * x.vault.perCoin)}`; }; rd.oninput = go; go();
  }

  // ------------------------------------------------------------ activity
  function activity() {
    const n = { trades: x.trades.length, events: x.events.length, holders: x.top.length };
    return `<section class="panel act"><div class="tabs" id="actTabs" role="tablist"><button data-t="trades">Trades</button><button data-t="events">Buybacks &amp; burns<span class="n">${n.events}</span></button><button data-t="holders">Holders<span class="n">${U().num(x.holders, 0)}</span></button></div><div class="table-wrap" style="border:0;border-radius:0 0 var(--r) var(--r)" id="act"></div></section>`;
  }
  function paintActivity() {
    const { usd, num, ago, short, esc } = U(); const box = document.getElementById('act');
    U().$$('#actTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'trades') box.innerHTML = `<table class="list"><thead><tr><th>Age</th><th class="l">Side</th><th>Value</th><th>$${esc(x.symbol)}</th><th>Wallet</th></tr></thead><tbody>${x.trades.slice(0, 15).map(t => `<tr><td class="l"><span class="num muted">${ago(t.ts)}</span></td><td class="l"><span class="ev ${t.side}"><i></i>${t.side === 'buy' ? 'Buy' : 'Sell'}</span></td><td><span class="num">${usd(t.usd)}</span></td><td><span class="num">${num(t.coins, 0)}</span></td><td><span class="addr muted">${short(t.who)}</span></td></tr>`).join('')}</tbody></table>`;
    else if (tab === 'events') box.innerHTML = x.events.length ? `<table class="list"><thead><tr><th>Age</th><th class="l">What</th><th>Spent</th><th>Burned</th></tr></thead><tbody>${x.events.map(e => `<tr><td class="l"><span class="num muted">${ago(e.ts)}</span></td><td class="l"><span class="ev ${e.kind}"><i></i>${e.kind === 'dip' ? 'Dip buyback' : 'Take profit'}</span></td><td><span class="num">${usd(e.usd)}</span></td><td><span class="num">${num(e.burned, 0)}</span></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty"><p>No buybacks or burns yet.${x.fund ? ` The next one fires at ${usd(x.fund.trigger)}.` : ''}</p></div>`;
    else { const max = x.top[0] ? x.top[0].bal : 1; box.innerHTML = `<table class="list"><thead><tr><th>#</th><th class="l">Wallet</th><th>Balance</th><th class="l">Share of supply</th></tr></thead><tbody>${x.top.map((h, i) => `<tr><td class="l"><span class="num faint">${i + 1}</span></td><td class="l"><span class="addr">${short(h.addr)}</span>${h.addr === x.creator ? ' <span class="tag">Creator</span>' : ''}</td><td><span class="num">${num(h.bal, 0)}</span></td><td class="l"><span class="hbar"><i style="width:${(h.bal / max * 100).toFixed(1)}%"></i></span><span class="num">${(h.bal / BS.SUPPLY * 100).toFixed(2)}%</span></td></tr>`).join('')}</tbody></table>`; }
  }

  // ------------------------------------------------------------ side: trade, fee split, about
  function tradePanel() {
    return `<section class="panel trade"><div class="tabs2" role="tablist"><button data-side="buy" class="buy">Buy</button><button data-side="sell" class="sell">Sell</button></div><div class="body" id="tradeBody"></div></section>`;
  }
  const sampleBal = () => { const r = BS.samplePortfolio().rows.find(r => r.x.addr === x.addr); return r ? r.bal : 0; };
  function paintTrade() {
    const { esc, usd, num, pct, tokImg, coinImg, $, $$, ic } = U(); const body = document.getElementById('tradeBody'); if (!body) return;
    $$('.tabs2 button').forEach(b => b.classList.toggle('on', b.dataset.side === side));
    const buy = side === 'buy'; const eth = { logo: BS.known(BS.weth).logo }; const w = window.bsWallet; const connected = w && w.connected;
    const bal = buy ? null : sampleBal();
    const pill = isCoin => isCoin ? `<span class="tpill">${coinImg(x, 'ti')}${esc(x.symbol)}</span>` : `<span class="tpill">${tokImg(eth, 'ti')}ETH</span>`;
    const quick = buy ? [['0.01', '0.01'], ['0.05', '0.05'], ['0.1', '0.1'], ['0.5', '0.5']] : [['25', '25%'], ['50', '50%'], ['75', '75%'], ['100', 'Max']];
    const route = x.pair === BS.weth ? `ETH → ${esc(x.symbol)}` : buy ? `ETH → ${esc(x.pairSym)} → ${esc(x.symbol)}` : `${esc(x.symbol)} → ${esc(x.pairSym)} → ETH`;
    body.innerHTML = `
      <div class="tbox"><div class="tbox-h"><span>You pay</span><span>${buy ? '' : `Balance <b class="mono">${num(bal, 0)}</b> <span class="faint">sample</span>`}</span></div>
        <div class="tbox-r"><input class="tin num" id="amt" inputmode="decimal" autocomplete="off" placeholder="0.0" value="${buy ? '0.1' : Math.round(bal / 2)}">${pill(!buy)}</div>
        <div class="tbox-f" id="inUsd"></div></div>
      <div class="quick q4">${quick.map(([v, l]) => `<button type="button" data-q="${v}">${l}</button>`).join('')}</div>
      <div class="tbox recv"><div class="tbox-h"><span>You receive about</span></div>
        <div class="tbox-r"><b class="tout num" id="out">—</b>${pill(buy)}</div>
        <div class="tbox-f" id="outUsd"></div></div>
      <div class="kv tdet" id="quote"></div>
      <button class="btn btn-lg btn-block tbtn ${buy ? 'buy' : 'sell'}" id="tradeGo" ${connected ? 'disabled' : ''}>${connected ? 'Trading opens at launch' : 'Connect wallet'}</button>
      <div class="tfoot"><span>${route}</span><button type="button" id="slipBtn">Slippage <b>${slip}%</b></button></div>`;
    const inp = $('#amt');
    const q = async () => { const e = await BS.ethUsd(); const v = Number(inp.value) || 0; const fee = 0.02;
      const inUsd = buy ? v * e : v * x.px; const impact = Math.min(0.5, inUsd / (x.liq / 2)); const outUsd = inUsd * (1 - fee) * (1 - impact);
      const out = buy ? outUsd / x.px : outUsd / e;
      $('#inUsd').textContent = v ? usd(inUsd) : ''; $('#out').textContent = v ? num(out, buy ? 0 : 4) : '—'; $('#outUsd').textContent = v ? usd(outUsd) : '';
      $('#quote').innerHTML = `<div><span>Price impact</span><b class="${impact > 0.05 ? 'down' : ''}">${v ? (impact * 100).toFixed(2) + '%' : '—'}</b></div><div><span>Trade fee (2%)</span><b>${v ? usd(inUsd * fee) : '—'}</b></div><div><span>Minimum received</span><b>${v ? num(out * (1 - slip / 100), buy ? 0 : 4) + ' ' + (buy ? esc(x.symbol) : 'ETH') : '—'}</b></div>`; };
    inp.oninput = () => { inp.value = inp.value.replace(/[^0-9.]/g, ''); q(); };
    $$('[data-q]', body).forEach(b => b.onclick = () => { inp.value = buy ? b.dataset.q : String(Math.floor(bal * Number(b.dataset.q) / 100)); q(); });
    $('#tradeGo').onclick = () => { if (!(window.bsWallet && bsWallet.connected)) bsWallet.open(); };
    $('#slipBtn').onclick = e => { const m = U().menu(e.currentTarget, [1, 3, 5, 10].map(n => `<button data-s="${n}">${n}%${n === slip ? ' ✓' : ''}</button>`).join('')); U().$$('[data-s]', m).forEach(b => b.onclick = () => { slip = Number(b.dataset.s); m.remove(); paintTrade(); }); };
    q();
  }
  function about() {
    const { esc, short, addrLink, ic } = U();
    return `<section class="panel about"><div class="panel-h"><h3>About</h3></div><div class="panel-b" style="display:grid;gap:14px">
      <p>${esc(x.desc)}</p>
      <div class="kv"><div><span>Contract</span><b><span class="addr">${short(x.addr)}</span></b></div><div><span>Backing token</span><b><a class="addr" href="${addrLink(x.pair)}" target="_blank" rel="noopener">${esc(x.pairSym)} ${short(x.pair)}</a></b></div></div>
    </div></section>`;
  }
  function feeSplit() {
    const s = x.split; const parts = [['creator', 'Creator', s.creator], ['holders', 'Holders', s.holders], ['vault', 'Vault', s.vault], ['bb', 'Buyback', s.buyback], ['platform', 'Platform', s.platform]].filter(p => p[2] > 0);
    return `<section class="panel fs"><div class="panel-h"><h3>Trade fee: 2%</h3></div><div class="panel-b">
      <div class="split" role="img" aria-label="${parts.map(p => p[1] + ' ' + U().bps(p[2])).join(', ')}">${parts.map(p => `<i class="s-${p[0]}" style="flex:${p[2]}"></i>`).join('')}</div>
      <div class="split-key">${parts.map(p => `<span><i class="s-${p[0]}"></i>${p[1]}<b>${U().bps(p[2])}</b></span>`).join('')}</div>
</div></section>`;
  }

  function render() {
    const { $, esc } = U(); const root = $('#coinRoot');
    if (!x) { root.innerHTML = `<div class="empty"><h3>Coin not found</h3><p>No Backstop coin at <span class="mono">${esc(addr || 'this address')}</span>.</p><a class="btn btn-ink" href="/">Back to explore</a></div>`; return; }
    document.title = `${x.name} ($${x.symbol}) · Backstop`;
    root.innerHTML = head() + `<div class="coin-grid"><div class="coin-main">${kpis()}${chartPanel()}${strategies()}${activity()}</div><div class="coin-side">${tradePanel()}${feeSplit()}${about()}</div></div>`;
    if (window.bsChart && window.TradingView) bsChart.init($('#tv'), x); paintActivity(); paintTrade();
    U().$$('#actTabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; paintActivity(); });
    U().$$('.tabs2 button').forEach(b => b.onclick = () => { side = b.dataset.side; paintTrade(); });
    U().$$('[data-copy]').forEach(b => b.onclick = () => U().copy(b.dataset.copy, 'Contract address'));
    const rb = $('#rdBtn'); if (rb) rb.onclick = openRedeem;
  }
  window.addEventListener('DOMContentLoaded', () => BS.ready.then(() => { x = BS.token(addr); render(); }));
  window.addEventListener('bs:wallet', () => { if (x) paintTrade(); });
})();
