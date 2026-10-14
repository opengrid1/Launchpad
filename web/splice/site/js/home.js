/* Explore: live tape + sortable coin grid. Preview data from window.UD. */
(function () {
  const { $, esc, usd, num, delta, ago, geneChips, avatar, sparkSvg, coinHref } = window.UI;

  function card(c) {
    return `<a class="card" href="${coinHref(c.addr)}">
      <div class="ct">${avatar(c)}<div class="t"><b>${esc(c.name)}</b><small>$${esc(c.symbol)} · ${esc(c.pair.symbol)} · ${ago(c.createdTs)} ago</small></div></div>
      <div class="cm"><span class="px">${usd(c.mc)}</span><div class="r">mcap<br>${delta(c.c24)}</div></div>
      ${sparkSvg(c.spark, c.c24)}
      ${geneChips(c.genes)}
      <div class="stat"><span>Vol <b>${usd(c.vol24)}</b></span><span>Liq <b>${usd(c.liq)}</b></span><span>Holders <b>${num(c.holders, 0)}</b></span></div>
    </a>`;
  }

  function tape() {
    const trades = UD.recentTrades(16);
    $('#tape').innerHTML = `<div class="tape-h"><i></i>Live trades</div><div class="tape">${trades.map(t =>
      `<a class="tchip" href="${coinHref(t.coin.addr)}"><span class="delta ${t.buy ? 'up' : 'down'}">${t.buy ? 'BUY' : 'SELL'}</span><b>$${esc(t.coin.symbol)}</b><span class="muted mono">${t.eth} ETH</span><span class="faint">${ago(t.ts)}</span></a>`).join('')}</div>`;
  }

  let sort = 'vol24';
  function grid() {
    const coins = [...UD.tokens()].sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
    $('#grid').innerHTML = coins.map(card).join('');
  }

  function init() {
    tape(); grid();
    $('#sorts').addEventListener('click', e => { const b = e.target.closest('[data-sort]'); if (!b) return;
      document.querySelectorAll('#sorts .sort').forEach(s => s.classList.toggle('on', s === b)); sort = b.dataset.sort; grid(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
