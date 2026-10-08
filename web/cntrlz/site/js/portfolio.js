/* Portfolio: your open windows as receipts with live clocks, then the coins you hold. */
(function () {
  let timer = null;
  function paint() {
    const { esc, usd, eth, num, ago, ic, winLabel, pairGlyph, coinHref, notLive, $, $$ } = UI;
    const w = window.bsWallet, who = w && w.connected ? w.address : null;
    if (!who) { $('#pf').innerHTML = `<div class="pf-head"><h1>Portfolio</h1></div><div class="empty"><h3>Connect a wallet</h3><p>Your open undo windows and your coins show up here.</p><button class="key ink" id="pfConnect">Connect</button></div>`; $('#pfConnect').onclick = () => w && w.open(); return; }
    const wins = UD.myWindows(), hold = UD.myHoldings(); const value = hold.reduce((s, h) => s + h.value, 0), inWin = wins.reduce((s, x) => s + x.paidEth, 0), prem = wins.reduce((s, x) => s + x.premium, 0);
    const tax = UD.cfg.taxBps / 10000;
    $('#pf').innerHTML = `<div class="pf-head"><div><h1>Portfolio</h1><div class="muted mono" style="margin-top:4px">${esc(UI.short(who))}</div></div></div>
      <div class="stats"><div class="stat-key"><span>Holdings</span><b>${usd(value)}</b><small>at market</small></div><div class="stat-key"><span>Inside open windows</span><b>${eth(inWin)}</b><small>${wins.length} buy${wins.length === 1 ? '' : 's'}, still cancellable</small></div><div class="stat-key"><span>Window premiums</span><b>${eth(prem)}</b><small>paid and burned</small></div><div class="stat-key"><span>Coins</span><b>${hold.length}</b><small>in your wallet</small></div></div>
      <h2 style="font-size:20px;margin-bottom:12px">Open windows</h2>
      <div class="receipts">${wins.length ? wins.map(x => `<div class="receipt" data-closes="${x.closes}" data-opened="${x.openedAt}">
        <div class="rh">${pairGlyph(x.x, 'sm')}<div class="t"><b>${esc(x.x.name)}</b><small>$${esc(x.x.symbol)} · bought ${ago(x.openedAt)} ago</small></div><span class="tag key">${winLabel(x.hours)}</span></div>
        <div class="rows"><div><span>Paid</span><b>${eth(x.paidEth)}</b></div><div><span>Coins</span><b>${num(x.coins, 0)} ${esc(x.x.symbol)}</b></div><div><span>Window</span><b>${winLabel(x.hours)} for ${eth(x.premium)}, burned</b></div></div>
        <div class="clock"><span>Closes in</span><b data-c>—</b></div><div class="drain"><i data-d></i></div>
        <div class="refund"><span>Cancel now, get back</span><b>${eth(x.paidEth * (1 - tax))}</b></div>
        <div class="acts"><button class="key yellow" data-undo>${ic('undo')}Cancel buy</button><button class="key" data-keep>Keep</button></div></div>`).join('') : '<div class="empty" style="grid-column:1/-1"><p>No buys inside a window right now.</p><a class="key ink" href="/">Explore</a></div>'}</div>
      <section class="panel"><div class="panel-h"><h2>Coins</h2></div>${hold.length ? `<div class="table-wrap cards"><table class="list"><thead><tr><th>Coin</th><th>Balance</th><th>Value</th><th>Kept rate</th></tr></thead><tbody>
        ${hold.map(h => `<tr data-href="${coinHref(h.x.addr)}" style="cursor:pointer"><td><div class="coin-cell" style="display:flex;align-items:center;gap:11px">${pairGlyph(h.x, 'sm')}<div><b style="font-weight:600">${esc(h.x.name)}</b><small class="muted" style="display:block;font-size:12.5px">$${esc(h.x.symbol)} · ${esc(h.x.pair.symbol)}</small></div></div></td><td data-l="Balance"><span class="num">${num(h.bal, 0)}</span></td><td data-l="Value"><span class="num">${usd(h.value)}</span></td><td data-l="Kept rate"><span class="num c-kept">${h.x.keptPct == null ? '—' : h.x.keptPct.toFixed(0) + '%'}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><p>No coins yet.</p></div>'}</section>`;
    $$('tr[data-href]').forEach(tr => tr.onclick = () => location.href = tr.dataset.href);
    $$('[data-undo],[data-keep]').forEach(b => b.onclick = notLive);
    const tick = () => { const now = UD.now(); $$('[data-closes]').forEach(el => { const closes = +el.dataset.closes, opened = +el.dataset.opened; const left = closes - now; const c = el.querySelector('[data-c]'); if (c) c.textContent = UI.clock(left); const d = el.querySelector('[data-d]'); if (d) d.style.width = (Math.max(0, left) / (closes - opened) * 100).toFixed(2) + '%'; }); };
    tick(); clearInterval(timer); timer = setInterval(tick, 1000);
  }
  window.addEventListener('DOMContentLoaded', () => UD.ready.then(paint));
  window.addEventListener('bs:wallet', () => UD.ready.then(paint));
})();
