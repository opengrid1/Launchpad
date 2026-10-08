/* Portfolio: the buys still inside their undo window (with live clocks), then the coins you hold and what undos have paid you. */
(function () {
  let timer = null;
  function paint() {
    const { esc, usd, num, ago, clock, refundShare, ic, pairGlyph, coinHref, notLive, $, $$ } = UI;
    const w = window.bsWallet, who = w && w.connected ? w.address : null;
    if (!who) { $('#pf').innerHTML = `<div class="pf-head"><h1>Portfolio</h1></div><div class="empty"><h3>Connect a wallet</h3><p>Your open undo windows, your coins and what undos have paid you show up here.</p><button class="btn btn-ink" id="pfConnect">Connect</button></div>`; $('#pfConnect').onclick = () => w && w.open(); return; }
    const wins = UD.myWindows(), hold = UD.myHoldings(); const earned = hold.reduce((s, h) => s + h.earned, 0), value = hold.reduce((s, h) => s + h.value, 0), inWin = wins.reduce((s, x) => s + x.paidUsd, 0);
    $('#pf').innerHTML = `<div class="pf-head"><div><h1>Portfolio</h1><div class="muted mono" style="margin-top:4px">${esc(UI.short(who))}</div></div></div>
      <div class="stats"><div><span>Holdings</span><b>${usd(value)}</b><small>at market</small></div><div><span>Inside undo windows</span><b>${usd(inWin)}</b><small>${wins.length} buy${wins.length === 1 ? '' : 's'} you can still take back</small></div><div><span>Paid to you by undos</span><b class="c-kept">${usd(earned)}</b><small>for holding through other people's exits</small></div><div><span>Coins</span><b>${hold.length}</b></div></div>
      <div class="pf-grid"><div>
        <section class="panel"><div class="panel-h"><h2>Open windows</h2><span class="r faint" style="font-size:12.5px">Undo before the clock runs out, or keep and unlock the coins</span></div>
          ${wins.length ? wins.map(x => `<div class="win"><div class="row">${pairGlyph(x.x, 'sm')}<div class="t"><b>${esc(x.x.name)} <span class="faint mono" style="font-size:12px">$${esc(x.x.symbol)}</span></b><small>${usd(x.paidUsd)} · ${num(x.coins, 0)} coins · bought ${ago(x.openedAt)} ago</small></div><span class="clock" data-clock="${x.id}">—</span></div>
            <div class="drain"><i data-drain="${x.id}"></i></div>
            <div class="row"><small class="muted">Undo now gets back</small><b style="margin-left:auto" data-refund="${x.id}">—</b></div>
            <div class="acts"><button class="btn btn-key" data-undo="${x.id}">${ic('undo')}Undo</button><button class="btn btn-line" data-keep="${x.id}">Keep now</button><a class="btn btn-line" href="${coinHref(x.x.addr)}">Coin</a></div></div>`).join('') : '<div class="empty"><p>No buys inside a window right now.</p></div>'}</section>
      </div><div>
        <section class="panel"><div class="panel-h"><h2>Coins</h2></div>${hold.length ? `<div class="table-wrap cards" style="border:0;border-radius:0 0 var(--r) var(--r)"><table class="list"><thead><tr><th>Coin</th><th>Balance</th><th>Value</th><th>From undos</th></tr></thead><tbody>
          ${hold.map(h => `<tr data-href="${coinHref(h.x.addr)}"><td><div class="coin-cell">${pairGlyph(h.x, 'sm')}<div><b>${esc(h.x.name)}</b><small>$${esc(h.x.symbol)} · <em>${esc(h.x.pair.symbol)}</em></small></div></div></td><td data-l="Balance"><span class="num">${num(h.bal, 0)}</span></td><td data-l="Value"><span class="num">${usd(h.value)}</span></td><td data-l="From undos"><span class="num ${h.earned ? 'c-kept' : 'faint'}">${h.earned ? usd(h.earned) : h.x.feeTo === 'burn' ? 'burns' : '—'}</span></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty"><p>No coins yet.</p><a class="btn btn-ink" href="/">Explore</a></div>'}</section>
      </div></div>`;
    $$('tr[data-href]').forEach(tr => tr.onclick = () => location.href = tr.dataset.href);
    $$('[data-undo],[data-keep]').forEach(b => b.onclick = notLive);
    const tick = () => { const now = UD.now(); for (const x of wins) { const W = x.x.windowH * 3600; const share = refundShare(now - x.openedAt, W);
      const c = $(`[data-clock="${x.id}"]`); if (c) c.textContent = clock(x.closes - now); const d = $(`[data-drain="${x.id}"]`); if (d) d.style.width = (share / UI.START * 100).toFixed(2) + '%'; const r = $(`[data-refund="${x.id}"]`); if (r) r.textContent = `${usd(x.paidUsd * share)} · ${(share * 100).toFixed(1)}%`; } };
    tick(); clearInterval(timer); timer = setInterval(tick, 1000);
  }
  window.addEventListener('DOMContentLoaded', () => UD.ready.then(paint));
  window.addEventListener('bs:wallet', () => UD.ready.then(paint));
})();
