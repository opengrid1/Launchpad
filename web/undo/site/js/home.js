/* Home: the receipt (one undo window ticking down), platform totals, and the coin list. */
(function () {
  let sort = 'trend';
  const SORTS = {
    trend: l => [...l].sort((a, b) => b.vol24 - a.vol24),
    kept: l => [...l].filter(x => x.keptPct != null).sort((a, b) => b.keptPct - a.keptPct || b.vol24 - a.vol24),
    new: l => [...l].sort((a, b) => b.createdAt - a.createdAt),
    stocks: l => [...l].filter(x => x.pair.kind === 'stock').sort((a, b) => b.vol24 - a.vol24),
  };

  // the receipt: a buy made a while ago in this session, so the clock really runs
  function receipt() {
    const { esc, usd, num, clock, refundShare, pairGlyph, coinHref, notLive, $ } = UI;
    const x = UD.tokens().find(t => t.symbol === 'CTRLZ') || UD.tokens()[0]; const W = x.windowH * 3600;
    let opened; try { opened = Number(sessionStorage.getItem('ud:rcpt')) || 0; } catch { opened = 0; }
    if (!opened || UD.now() - opened > W - 600) { opened = UD.now() - 41 * 60; try { sessionStorage.setItem('ud:rcpt', String(opened)); } catch {} }
    const paidEth = 0.25, ethUsd = x.pair.usd || 2450, paid = paidEth * ethUsd, coins = paid / x.px;
    $('#receipt').innerHTML = `
      <div class="rh">${pairGlyph(x)}<div class="t"><b>${esc(x.name)}</b><small>$${esc(x.symbol)} · paired with ${esc(x.pair.symbol)}</small></div><span class="tag key">${UI.ic('undo')}Undo window</span></div>
      <div class="rows"><div><span>You paid</span><b>${paidEth} ETH · ${usd(paid)}</b></div><div><span>You get</span><b>${num(coins, 0)} ${esc(x.symbol)}</b></div><div><span>Window</span><b>${x.windowH} hours</b></div></div>
      <div class="clock"><span>Undo closes in</span><b id="rcClock">—</b></div>
      <div class="drain"><i id="rcDrain"></i></div>
      <div class="refund"><span>Undo now and get back</span><b id="rcRefund">—</b></div>
      <div class="acts"><button class="btn btn-key" data-act>${UI.ic('undo')}Undo</button><a class="btn btn-line" href="${coinHref(x.addr)}">View coin</a></div>`;
    $('#receipt [data-act]').onclick = notLive;
    const tick = () => { const el = UD.now() - opened; const share = refundShare(el, W);
      $('#rcClock').textContent = clock(W - el); $('#rcDrain').style.width = (share / UI.START * 100).toFixed(2) + '%';
      $('#rcRefund').textContent = `${(paidEth * share).toFixed(4)} ETH · ${(share * 100).toFixed(1)}%`; };
    tick(); setInterval(tick, 1000);
  }

  function stats() {
    const { usd, $ } = UI; const s = UD.stats();
    $('#stats').innerHTML = `<div><span>Coins</span><b>${s.coins}</b><small>${s.openCount} undo windows open</small></div>
      <div><span>Volume 24h</span><b>${usd(s.vol24)}</b><small>${usd(s.openUsd)} inside open windows</small></div>
      <div><span>Kept rate</span><b class="c-kept">${s.kept == null ? '—' : s.kept.toFixed(1) + '%'}</b><small>of buys nobody undid</small></div>
      <div><span>Paid to holders by undos</span><b>${usd(s.holdersEarned)}</b><small>${usd(s.refundsUsd)} refunded to undoers</small></div>`;
  }

  function list() {
    const { esc, usd, delta, keptBar, pairGlyph, coinHref, winLabel, ago, $, $$ } = UI;
    const rows = SORTS[sort](UD.tokens());
    $('#list').innerHTML = `<table class="list"><thead><tr><th>Coin</th><th>Price</th><th>24h</th><th>Market cap</th><th>Volume 24h</th><th title="Share of buys with a window that nobody undid">Kept</th><th>Undo</th><th title="Backs refunds when the price falls">Reserve</th></tr></thead><tbody>
      ${rows.map(x => `<tr data-href="${coinHref(x.addr)}">
        <td><div class="coin-cell">${pairGlyph(x)}<div><b>${esc(x.name)}</b><small>$${esc(x.symbol)} · <em>${esc(x.pair.symbol)}</em> · ${ago(x.createdAt)} old</small></div></div></td>
        <td data-l="Price"><span class="num">${usd(x.px)}</span></td><td data-l="24h">${delta(x.c24)}</td>
        <td data-l="Market cap"><span class="num">${usd(x.mc)}</span></td><td data-l="Volume 24h"><span class="num">${usd(x.vol24)}</span></td>
        <td data-l="Kept">${keptBar(x.keptPct)}</td><td data-l="Undo"><span class="win-chip">${winLabel(x.windowH)}</span></td>
        <td data-l="Reserve"><span class="num c-reserve">${usd(x.reserveUsd)}</span></td></tr>`).join('')}
      </tbody></table>`;
    $$('#list tr[data-href]').forEach(tr => tr.onclick = () => location.href = tr.dataset.href);
  }

  function start() {
    receipt(); stats(); list();
    UI.$$('#sort button').forEach(b => b.onclick = () => { sort = b.dataset.s; UI.$$('#sort button').forEach(o => o.classList.toggle('on', o === b)); list(); });
  }
  window.addEventListener('DOMContentLoaded', () => UD.ready.then(start));
})();
