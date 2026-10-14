/* Portfolio: a clearly-labeled SAMPLE so the page demonstrates the product in preview instead of
   dead-ending on Connect. Holdings with P/L, claimable dividends, and coins you spliced. */
(function () {
  const { $, $$, esc, usd, num, eth, delta, avatar, coinHref, notLive } = window.UI;

  function sample() {
    const coins = UD.tokens();
    const holdings = [coins[0], coins[3], coins[5], coins[8]].filter(Boolean).map((c, i) => {
      const costMc = c.mc / (1 + [0.9, -0.3, 0.4, 1.6][i]);
      const valueEth = (c.mc / UD.ETH_USD) * [0.0009, 0.0021, 0.0014, 0.0006][i];
      const pnl = (c.mc - costMc) / costMc * 100;
      return { c, valueEth, pnl, tokens: Math.round(valueEth * UD.ETH_USD / c.price) };
    });
    const divCoins = coins.filter(c => c.params.div).slice(0, 3).map(c => ({ c, claim: +(c.params.div.poolEth * 0.2 + 0.002).toFixed(4) }));
    const spliced = [coins[1], coins[6]];
    return { holdings, divCoins, spliced };
  }

  function init() {
    const d = sample();
    const totalEth = d.holdings.reduce((a, h) => a + h.valueEth, 0);
    const claimEth = d.divCoins.reduce((a, x) => a + x.claim, 0);
    $('#pf-root').innerHTML = `
      <div class="pf-head">
        <div><h1>Portfolio</h1><p class="muted">A sample view. Connect a wallet to see your own once Splice is live.</p></div>
        <div class="pf-total"><span>Est. value</span><b>${eth(totalEth)}</b><small>${usd(totalEth * UD.ETH_USD)}</small></div>
      </div>

      <div class="panel"><div class="panel-h"><h2>Holdings</h2><span class="hint">sample</span></div><div class="panel-b"><div class="table-wrap"><table class="list">
        <thead><tr><th class="l">Coin</th><th>Balance</th><th>Value</th><th>P/L</th><th></th></tr></thead>
        <tbody>${d.holdings.map(h => `<tr><td class="l"><a class="pf-coin" href="${coinHref(h.c.addr)}">${avatar(h.c, 'sm')}<span><b>${esc(h.c.name)}</b><small class="muted">$${esc(h.c.symbol)}</small></span></a></td><td class="num mono">${num(h.tokens, 0)}</td><td class="num">${eth(h.valueEth)}</td><td>${delta(h.pnl)}</td><td class="l"><a class="btn ghost sm" href="${coinHref(h.c.addr)}">Trade</a></td></tr>`).join('')}</tbody>
      </table></div></div></div>

      <div class="panel"><div class="panel-h"><h2>Claimable dividends</h2><span class="hint">from the dividends gene</span></div><div class="panel-b">
        <div class="claimrow"><div><span class="lbl" style="margin:0">Total claimable</span><b class="mono" style="font-size:20px">${eth(claimEth)}</b></div><button class="btn accent" id="claimall">Claim all</button></div>
        <div class="table-wrap" style="margin-top:12px"><table class="list"><thead><tr><th class="l">Coin</th><th>Claimable</th></tr></thead>
        <tbody>${d.divCoins.map(x => `<tr><td class="l"><a class="pf-coin" href="${coinHref(x.c.addr)}">${avatar(x.c, 'sm')}<span><b>${esc(x.c.name)}</b></span></a></td><td class="num mono">${eth(x.claim)}</td></tr>`).join('')}</tbody></table></div>
      </div></div>

      <div class="panel"><div class="panel-h"><h2>Coins you spliced</h2><span class="hint">sample</span></div><div class="panel-b"><div class="grid">
        ${d.spliced.map(c => `<a class="card" href="${coinHref(c.addr)}"><div class="ct">${avatar(c)}<div class="t"><b>${esc(c.name)}</b><small>$${esc(c.symbol)} · creator fees ${eth(c.vol24 / UD.ETH_USD * 0.006)}</small></div></div><div class="genes">${c.genes.map(k => window.UI.geneChip(k)).join('')}</div></a>`).join('')}
      </div></div></div>`;
    $('#claimall').onclick = notLive;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
