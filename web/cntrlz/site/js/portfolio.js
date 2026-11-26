/* Portfolio: your open windows as receipts with live clocks, then the coins you hold, the coins you launched,
   and pair-token refunds you can swap back to ETH. Everything comes from UD.portfolio (chain layer or preview). */
(function () {
  let timer = null, data = null, loadedFor = null;
  const who = () => (window.bsWallet && bsWallet.connected ? bsWallet.address : null);

  function paint() {
    const { esc, usd, eth, num, ago, ic, winLabel, pairGlyph, coinHref, short, $, $$ } = UI;
    const w = window.bsWallet, me = who();
    if (!me) { $('#pf').innerHTML = `<div class="pf-head"><h1>Portfolio</h1></div><div class="empty"><h3>Connect a wallet</h3><p>Your open cntrl-z windows and your coins show up here.</p><button class="key ink" id="pfConnect">Connect</button></div>`; $('#pfConnect').onclick = () => w && w.open(); return; }
    if (!data) { $('#pf').innerHTML = `<div class="pf-head"><div><h1>Portfolio</h1><div class="muted mono" style="margin-top:4px">${esc(short(me))}</div></div></div><div class="skel" style="height:300px"></div>`; return; }
    const wins = data.windows, hold = data.holdings, created = data.created || [], refunds = data.refunds || [];
    const value = hold.reduce((s, h) => s + h.value, 0), inWin = wins.reduce((s, x) => s + x.paidEth, 0), prem = wins.reduce((s, x) => s + x.premium, 0);
    $('#pf').innerHTML = `<div class="pf-head"><div><h1>Portfolio</h1><div class="muted mono" style="margin-top:4px">${esc(short(me))}</div></div></div>
      <div class="stats"><div class="stat-key"><span>Holdings</span><b>${usd(value)}</b><small>at market</small></div><div class="stat-key"><span>Inside windows</span><b>${eth(inWin)}</b><small>${wins.length} buy${wins.length === 1 ? '' : 's'}</small></div><div class="stat-key"><span>Window premiums</span><b>${eth(prem)}</b><small>paid and burned</small></div><div class="stat-key"><span>Coins</span><b>${hold.length}</b><small>in your wallet</small></div></div>
      <h2 style="font-size:20px;margin-bottom:12px">Windows</h2>
      <div class="receipts">${wins.length ? wins.map(x => `<div class="receipt" ${x.state === 'open' ? `data-closes="${x.closes}" data-opened="${x.openedAt}"` : ''}>
        <div class="rh">${pairGlyph(x.x, 'sm')}<div class="t"><b><a href="${coinHref(x.x.addr)}" style="color:inherit">${esc(x.x.name)}</a></b><small>$${esc(x.x.symbol)} · bought ${ago(x.openedAt)} ago</small></div><span class="tag key">${winLabel(x.hours)}</span></div>
        <div class="rows"><div><span>Paid</span><b>${eth(x.paidEth)}</b></div><div><span>Coins</span><b>${num(x.coins, 0)} ${esc(x.x.symbol)}</b></div><div><span>Window</span><b>${winLabel(x.hours)} for ${eth(x.premium)}, burned</b></div></div>
        ${x.state === 'open' ? `<div class="clock"><span>Closes in</span><b data-c>—</b></div><div class="drain"><i data-d></i></div>
        <div class="refund"><span>Cancel now, get back</span><b>${x.x.pair.address === UD.weth || !UD.live ? eth(x.paidEth) : `${x.paidPair.toFixed(x.paidPair >= 1 ? 3 : 5)} ${esc(x.x.pair.symbol)}`}</b></div>
        <div class="acts"><button class="key yellow" data-undo="${x.id}" data-coin="${x.x.addr}">${ic('undo')}Cancel buy</button><button class="key" data-keep="${x.id}" data-coin="${x.x.addr}">Keep</button></div>`
        : `<div class="clock"><span>Window closed</span><b class="c-kept">The coins are yours</b></div><div class="drain"><i style="width:0"></i></div><div class="refund"><span>Press Keep to receive them</span><b>${num(x.coins, 0)} ${esc(x.x.symbol)}</b></div><div class="acts"><button class="key ink" data-keep="${x.id}" data-coin="${x.x.addr}">Keep</button></div>`}</div>`).join('') : '<div class="empty" style="grid-column:1/-1"><p>No buys inside a window right now.</p><a class="key ink" href="/">Explore</a></div>'}</div>
      <section class="panel"><div class="panel-h"><h2>Coins</h2></div>${hold.length ? `<div class="table-wrap cards"><table class="list"><thead><tr><th>Coin</th><th>Balance</th><th>Value</th><th>Kept rate</th></tr></thead><tbody>
        ${hold.map(h => `<tr data-href="${coinHref(h.x.addr)}" style="cursor:pointer"><td><div class="coin-cell" style="display:flex;align-items:center;gap:11px">${pairGlyph(h.x, 'sm')}<div><b style="font-weight:600">${esc(h.x.name)}</b><small class="muted" style="display:block;font-size:12.5px">$${esc(h.x.symbol)} · ${esc(h.x.pair.symbol)}</small></div></div></td><td data-l="Balance"><span class="num">${num(h.bal, 0)}</span></td><td data-l="Value"><span class="num">${usd(h.value)}</span></td><td data-l="Kept rate"><span class="num c-kept">${h.x.keptPct == null ? '—' : h.x.keptPct.toFixed(0) + '%'}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><p>No coins yet.</p></div>'}</section>
      ${created.length ? `<section class="panel"><div class="panel-h"><h2>Coins you launched</h2><span class="r faint" style="font-size:12.5px">0.7% of every trade is yours</span></div><div class="table-wrap cards"><table class="list"><thead><tr><th>Coin</th><th>Earned</th><th>Waiting</th><th></th></tr></thead><tbody>
        ${created.map(c => `<tr><td><div class="coin-cell" style="display:flex;align-items:center;gap:11px">${pairGlyph(c.x, 'sm')}<div><b style="font-weight:600"><a href="${coinHref(c.x.addr)}" style="color:inherit">${esc(c.x.name)}</a></b><small class="muted" style="display:block;font-size:12.5px">$${esc(c.x.symbol)} · ${esc(c.x.pair.symbol)}</small></div></div></td><td data-l="Earned"><span class="num">${usd(c.earned)}</span></td><td data-l="Waiting"><span class="num">${usd(c.unclaimed)}</span></td><td><button class="key sm yellow" data-claim="${c.x.addr}" ${c.unclaimed > 0 ? '' : 'disabled'} style="margin-left:auto;display:block">Claim</button></td></tr>`).join('')}
      </tbody></table></div></section>` : ''}
      ${refunds.length ? `<section class="panel"><div class="panel-h"><h2>Pair tokens in your wallet</h2><span class="r faint" style="font-size:12.5px">Refunds and sells from coins not paired with ETH</span></div>
        ${refunds.map(r => `<div class="arow"><div class="t"><b>${r.amount >= 1 ? r.amount.toFixed(3) : r.amount.toFixed(5)} ${esc(r.symbol)}</b><small>${usd(r.usd)}</small></div><button class="key sm" data-swap="${r.address}">Swap to ETH</button></div>`).join('')}</section>` : ''}`;
    $$('tr[data-href]').forEach(tr => tr.onclick = e => { if (e.target.closest('a,button')) return; location.href = tr.dataset.href; });
    $$('[data-undo]').forEach(b => b.onclick = () => act(() => UD.cancel(b.dataset.coin, Number(b.dataset.undo)), 'Buy cancelled, refund sent'));
    $$('[data-keep]').forEach(b => b.onclick = () => act(() => UD.keep(b.dataset.coin, Number(b.dataset.keep)), 'Kept your coins'));
    $$('[data-claim]').forEach(b => b.onclick = () => act(() => UD.payCreator(b.dataset.claim), 'Creator fees paid out'));
    $$('[data-swap]').forEach(b => b.onclick = () => { const r = refunds.find(z => z.address === b.dataset.swap); act(() => UD.pairToEth(r.address, r.raw), `Swapped ${r.symbol} to ETH`); });
    const tick = () => { const now = UD.now(); $$('[data-closes]').forEach(el => { const closes = +el.dataset.closes, opened = +el.dataset.opened; const left = closes - now; const c = el.querySelector('[data-c]'); if (c) c.textContent = UI.clock(left); const d = el.querySelector('[data-d]'); if (d) d.style.width = (Math.max(0, left) / (closes - opened) * 100).toFixed(2) + '%'; }); };
    tick(); clearInterval(timer); timer = setInterval(tick, 1000);
  }
  async function act(fn, done) {
    const { toast } = UI;
    try { const rc = await fn(); toast(done, { tx: rc && rc.hash }); if (UD.live) await UD.load(); await load(true); } catch (e) { toast(e.message, { err: true }); }
  }
  async function load(force) {
    const me = who(); if (!me) { data = null; loadedFor = null; paint(); return; }
    if (!force && loadedFor === me && data) { paint(); return; }
    if (loadedFor !== me) { data = null; paint(); }
    try { data = await UD.portfolio(me); loadedFor = me; } catch (e) { console.warn('portfolio', e); data = { windows: [], holdings: [], created: [], refunds: [] }; }
    paint();
  }
  window.addEventListener('DOMContentLoaded', () => UD.ready.then(() => load()));
  window.addEventListener('bs:wallet', () => UD.ready.then(() => load()));
})();
