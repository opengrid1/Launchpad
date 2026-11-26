/* Portfolio: the connected wallet's coins, what they're worth at market and at backing, rewards to claim, and fees from coins it launched. */
(function () {
  const U = () => window.UI;
  let pf = null, who = null;
  async function load() {
    const w = window.bsWallet; who = w && w.connected ? w.address : null;
    pf = who ? await EH.portfolio(who).catch(() => ({ rows: [], created: [] })) : null;
  }
  function paint() {
    const { esc, usd, num, pairGlyph, coinHref, short, $, $$, toast } = U();
    if (!who) { $('#pf').innerHTML = `<div class="pf-head"><div><h1>Portfolio</h1></div></div><div class="empty"><h3>Connect a wallet</h3><p>Your coins, their backing and the rewards you can claim show up here.</p><button class="btn btn-ink" id="pfConnect">Connect</button></div>`; $('#pfConnect').onclick = () => window.bsWallet && bsWallet.open(); return; }
    if (!pf) { $('#pf').innerHTML = '<div class="skel" style="height:300px"></div>'; return; }
    const sum = f => pf.rows.reduce((s, r) => s + f(r), 0);
    const value = sum(r => r.value), floor = sum(r => r.floor), pending = sum(r => r.pending), fees = pf.created.reduce((s, c) => s + c.unclaimed, 0);
    $('#pf').innerHTML = `
      <div class="pf-head"><div><h1>Portfolio</h1><div class="who"><span class="mono">${esc(short(who))}</span></div></div></div>
      <div class="kpis" style="margin-bottom:18px">
        <div><span>Holdings</span><b>${usd(value)}</b><small>at market</small></div>
        <div class="v"><span>Redeemable at backing</span><b>${usd(floor)}</b><small>the floor under coins with redeem on</small></div>
        <div><span>Holder rewards</span><b style="color:var(--holders)">${usd(pending)}</b><small>ready to claim</small></div>
        <div><span>Creator fees</span><b>${usd(fees)}</b><small>from ${pf.created.length} coin${pf.created.length === 1 ? '' : 's'} you launched</small></div>
      </div>
      <section class="panel" style="margin-bottom:18px"><div class="panel-h"><h2>Coins</h2></div>${pf.rows.length ? `<div class="table-wrap cards" style="border:0;border-radius:0 0 var(--r) var(--r)"><table class="list"><thead><tr><th>Coin</th><th>Balance</th><th>Value</th><th>At backing</th><th>Rewards</th><th></th></tr></thead><tbody>
        ${pf.rows.map(r => `<tr data-href="${coinHref(r.x.addr)}"><td><div class="coin-cell">${pairGlyph(r.x, 'sm')}<div><b>${esc(r.x.name)}</b><small>$${esc(r.x.symbol)} · <em>${esc(r.x.pairSym)}</em></small></div></div></td>
          <td data-l="Balance"><span class="num">${num(r.bal, 0)}</span></td><td data-l="Value"><span class="num">${usd(r.value)}</span></td>
          <td data-l="At backing"><span class="num ${r.floor ? 'c-vault' : 'faint'}">${r.floor ? usd(r.floor) : r.x.vault ? 'No redeem' : 'No vault'}</span></td>
          <td data-l="Rewards"><span class="num" style="${r.pending ? 'color:var(--holders)' : ''}">${r.pending ? usd(r.pending) : '<span class="faint">—</span>'}</span></td>
          <td class="m-hide">${r.pending ? `<button class="btn btn-line" data-claim="${r.x.addr}">Claim</button>` : `<a class="btn btn-line" href="${coinHref(r.x.addr)}">Trade</a>`}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><p>No coins in this wallet yet.</p><a class="btn btn-ink" href="/">Explore coins</a></div>'}</section>
      ${pf.created.length ? `<section class="panel"><div class="panel-h"><h2>Coins you launched</h2></div><div class="table-wrap cards" style="border:0;border-radius:0 0 var(--r) var(--r)"><table class="list"><thead><tr><th>Coin</th><th>Your share</th><th>Earned</th><th>To claim</th><th>Volume 24h</th><th></th></tr></thead><tbody>
        ${pf.created.map(c => `<tr data-href="${coinHref(c.x.addr)}"><td><div class="coin-cell">${pairGlyph(c.x, 'sm')}<div><b>${esc(c.x.name)}</b><small>$${esc(c.x.symbol)}</small></div></div></td><td data-l="Your share"><span class="num">${U().bps(c.x.split.creator)}</span></td><td data-l="Earned"><span class="num">${usd(c.earned)}</span></td><td data-l="To claim"><span class="num">${usd(c.unclaimed)}</span></td><td data-l="Volume 24h"><span class="num">${usd(c.x.vol24)}</span></td><td class="m-hide"><button class="btn btn-line" data-pay="${c.x.addr}" ${c.unclaimed > 0 ? '' : 'disabled'}>Claim</button></td></tr>`).join('')}
      </tbody></table></div></section>` : ''}`;
    $$('tr[data-href]').forEach(tr => tr.onclick = e => { if (!e.target.closest('button,a')) location.href = tr.dataset.href; });
    const act = (sel, fn, done) => $$(sel).forEach(b => b.onclick = async () => { b.disabled = true; const t = b.textContent; b.textContent = 'Confirm…'; try { await fn(b); toast(done); await load(); paint(); } catch (e) { toast(e.message, { err: true }); b.disabled = false; b.textContent = t; } });
    act('[data-claim]', b => EH.claim(b.dataset.claim), 'Rewards claimed');
    act('[data-pay]', b => EH.payCreator(b.dataset.pay), 'Creator fees sent to your wallet');
  }
  async function start() { paint(); await load(); paint(); }
  window.addEventListener('DOMContentLoaded', () => BS.ready.then(start));
  window.addEventListener('bs:wallet', () => BS.ready.then(start));
})();
