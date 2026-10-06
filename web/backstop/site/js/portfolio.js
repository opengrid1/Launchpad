/* Portfolio: coins held, what they're worth at market and at backing, rewards to claim, and fees from coins you launched. */
(function () {
  const U = () => window.UI;
  function paint() {
    const { esc, usd, num, pct, pairGlyph, coinHref, short, $, $$ } = U();
    const w = window.bsWallet; const me = w && w.connected ? w.address : null;
    const pf = BS.samplePortfolio(); // nothing can be bought until launch, so every wallet sees the sample
    const sum = f => pf.rows.reduce((s, r) => s + f(r), 0);
    const value = sum(r => r.value), cost = sum(r => r.cost), floor = sum(r => r.floor), pending = sum(r => r.pending), fees = pf.created.reduce((s, c) => s + c.unclaimed, 0);
    $('#pf').innerHTML = `
      <div class="pf-head"><div><h1>Portfolio</h1><div class="who">${me ? `<span class="mono">${esc(short(me))}</span> · ` : ''}<span class="tag sample">Sample wallet</span><span>${me ? 'Your coins appear here once launches open.' : 'Connect a wallet to see your own coins once launches open.'}</span></div></div></div>
      <div class="kpis" style="margin-bottom:18px">
        <div><span>Holdings</span><b>${usd(value)}</b><small><span class="${value >= cost ? 'up' : 'down'}">${pct((value / cost - 1) * 100)}</span> on ${usd(cost)} spent</small></div>
        <div class="v"><span>Redeemable at backing</span><b>${usd(floor)}</b><small>the floor under coins with redeem on</small></div>
        <div><span>Holder rewards</span><b style="color:var(--holders)">${usd(pending)}</b><small>ready to claim</small></div>
        <div><span>Creator fees</span><b>${usd(fees)}</b><small>from ${pf.created.length} coin${pf.created.length === 1 ? '' : 's'} you launched</small></div>
      </div>
      <section class="panel" style="margin-bottom:18px"><div class="panel-h"><h2>Coins</h2></div><div class="table-wrap cards" style="border:0;border-radius:0 0 var(--r) var(--r)"><table class="list"><thead><tr><th>Coin</th><th>Balance</th><th>Value</th><th>Profit</th><th>At backing</th><th>Rewards</th><th></th></tr></thead><tbody>
        ${pf.rows.map(r => { const pl = r.value - r.cost; return `<tr data-href="${coinHref(r.x.addr)}"><td><div class="coin-cell">${pairGlyph(r.x, 'sm')}<div><b>${esc(r.x.name)}</b><small>$${esc(r.x.symbol)} · <em>${esc(r.x.pairSym)}</em></small></div></div></td>
          <td data-l="Balance"><span class="num">${num(r.bal, 0)}</span></td><td data-l="Value"><span class="num">${usd(r.value)}</span></td>
          <td data-l="Profit"><span class="num ${pl >= 0 ? 'up' : 'down'}">${pl >= 0 ? '+' : ''}${usd(pl)}</span></td>
          <td data-l="At backing"><span class="num ${r.floor ? 'c-vault' : 'faint'}">${r.floor ? usd(r.floor) : r.x.vault ? 'No redeem' : 'No vault'}</span></td>
          <td data-l="Rewards"><span class="num" style="${r.pending ? 'color:var(--holders)' : ''}">${r.pending ? usd(r.pending) : '<span class="faint">—</span>'}</span></td>
          <td class="m-hide"><button class="btn btn-line" disabled>${r.pending ? 'Claim' : 'Trade'}</button></td></tr>`; }).join('')}
      </tbody></table></div></section>
      <section class="panel"><div class="panel-h"><h2>Coins you launched</h2></div><div class="table-wrap cards" style="border:0;border-radius:0 0 var(--r) var(--r)"><table class="list"><thead><tr><th>Coin</th><th>Your share</th><th>Earned</th><th>To claim</th><th>Volume 24h</th><th></th></tr></thead><tbody>
        ${pf.created.map(c => `<tr data-href="${coinHref(c.x.addr)}"><td><div class="coin-cell">${pairGlyph(c.x, 'sm')}<div><b>${esc(c.x.name)}</b><small>$${esc(c.x.symbol)}</small></div></div></td><td data-l="Your share"><span class="num">${U().bps(c.x.split.creator)}</span></td><td data-l="Earned"><span class="num">${usd(c.earned)}</span></td><td data-l="To claim"><span class="num">${usd(c.unclaimed)}</span></td><td data-l="Volume 24h"><span class="num">${usd(c.x.vol24)}</span></td><td class="m-hide"><button class="btn btn-line" disabled>Claim</button></td></tr>`).join('')}
      </tbody></table></div></section>`;
    $$('tr[data-href]').forEach(tr => tr.onclick = e => { if (!e.target.closest('button')) location.href = tr.dataset.href; });
  }
  window.addEventListener('DOMContentLoaded', () => BS.ready.then(paint));
  window.addEventListener('bs:wallet', () => BS.ready.then(paint));
})();
