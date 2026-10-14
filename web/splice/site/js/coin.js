/* Coin page: header, key stats, a large chart, the coin's genes explained, and a trade panel
   (preview-only). The address comes from /coin/:addr. */
(function () {
  const { $, esc, usd, num, pct, delta, ago, short, avatar, sparkSvg, addrLink, copy, notLive, toast } = window.UI;

  function addrFromPath() {
    const m = location.pathname.match(/\/coin\/(0x[0-9a-fA-F]{40})/);
    if (m) return m[1];
    return new URLSearchParams(location.search).get('a');
  }

  function bigChart(c) {
    // reuse the spark generator at larger size; the coin carries 48 points
    return sparkSvg(c.spark, c.c24, 800, 300).replace('class="spark"', 'class="spark" style="height:100%"');
  }

  function geneBlock(c) {
    const items = c.genes.map(k => { const g = UD.gene(k); return `<div class="gi"><b><span class="gene ${g.cls}" style="padding:0;border:none;background:none"><span class="dot"></span></span>${esc(g.name)} <span class="tag">${esc(g.short)}</span></b><p>${esc(g.desc)}</p></div>`; }).join('');
    const core = UD.CONSTITUTION.map(x => `<div class="gi"><b>${esc(x.name)} <span class="tag">always on</span></b><p>${esc(x.desc)}</p></div>`).join('');
    return `<div class="panel"><div class="panel-h"><h2>Genes</h2><span class="hint">${c.genes.length} spliced in · constitution below</span></div><div class="panel-b"><div class="genelist">${items}</div><div class="lside-h" style="margin:18px 0 10px">Constitution — the immutable core</div><div class="genelist">${core}</div></div></div>`;
  }

  function trades(c) {
    const now = Math.floor(Date.now() / 1000);
    let rows = '';
    for (let i = 0; i < 12; i++) {
      const buy = Math.random() > 0.45; const e = +(0.02 + Math.random() * 2.6).toFixed(3);
      rows += `<tr><td class="l"><span class="ev ${buy ? 'buy' : 'sell'}"><i></i>${buy ? 'Buy' : 'Sell'}</span></td><td class="mono">${e} ETH</td><td>${usd(e * 3200)}</td><td class="l mono"><a href="${addrLink('0x' + Math.random().toString(16).slice(2, 10))}" target="_blank" rel="noopener">${short('0x' + Math.random().toString(16).slice(2, 42))}</a></td><td class="faint">${ago(now - Math.round(Math.random() * 7200))}</td></tr>`;
    }
    return `<div class="panel"><div class="panel-h"><h2>Trades</h2><span class="hint">preview</span></div><div class="panel-b"><div class="table-wrap"><table class="list"><thead><tr><th class="l">Type</th><th>ETH</th><th>USD</th><th class="l">Maker</th><th>Age</th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
  }

  function tradePanel(c) {
    return `<div class="panel lside"><div class="panel-h"><h2>Trade</h2><span class="hint">${esc(c.pair.symbol)}</span></div><div class="panel-b">
      <div class="seg" id="seg"><button class="on" data-side="buy">Buy</button><button data-side="sell">Sell</button></div>
      <div class="field" style="margin-top:14px"><label class="lbl">Amount (${esc(c.pair.symbol)})</label><input class="input mono" id="amt" placeholder="0.0" inputmode="decimal"></div>
      <button class="btn accent wide lg" id="trade-btn">Buy $${esc(c.symbol)}</button>
      <div class="facts" style="margin-top:16px"><div><span>Fee</span><b>${c.feeBps === 'dynamic' ? 'dynamic' : (c.feeBps / 100) + '%'}</b></div><div><span>Max slippage</span><b>1%</b></div></div>
    </div></div>`;
  }

  function render(c) {
    document.title = `${c.name} ($${c.symbol}) — Splice`;
    $('#coin-root').innerHTML = `
      <div class="coin-bar">
        ${avatar(c)}
        <h1>${esc(c.name)} <small>$${esc(c.symbol)}</small></h1>
        <div class="px"><b>${usd(c.price, { compact: false })}</b>${delta(c.c24)}</div>
      </div>
      <div style="margin:-8px 0 20px"><button class="btn ghost" id="copyaddr" style="font-size:12px;padding:5px 10px"><span class="mono">${short(c.addr)}</span></button>
        <a class="btn ghost" href="${addrLink(c.addr)}" target="_blank" rel="noopener" style="font-size:12px;padding:5px 10px">Basescan ↗</a></div>
      <div class="keyrow">
        <div class="stat-key"><span>Market cap</span><b>${usd(c.mc)}</b><small>FDV ${usd(c.fdv)}</small></div>
        <div class="stat-key"><span>Liquidity</span><b>${usd(c.liq)}</b><small>locked</small></div>
        <div class="stat-key"><span>Volume 24h</span><b>${usd(c.vol24)}</b></div>
        <div class="stat-key"><span>Holders</span><b>${num(c.holders, 0)}</b></div>
        <div class="stat-key"><span>Age</span><b>${ago(c.createdTs)}</b><small>on Base</small></div>
      </div>
      <div class="coin-cols">
        <div>
          <div class="bigchart">${bigChart(c)}</div>
          ${geneBlock(c)}
          ${trades(c)}
        </div>
        <div>${tradePanel(c)}</div>
      </div>`;

    $('#copyaddr').onclick = () => copy(c.addr, 'Contract');
    const seg = $('#seg'); let side = 'buy';
    seg.addEventListener('click', e => { const b = e.target.closest('[data-side]'); if (!b) return;
      side = b.dataset.side; [...seg.children].forEach(x => x.classList.toggle('on', x === b));
      $('#trade-btn').textContent = (side === 'buy' ? 'Buy $' : 'Sell $') + c.symbol; });
    $('#trade-btn').onclick = notLive;
  }

  function init() {
    const a = addrFromPath(); const c = a && UD.coin(a);
    if (!c) { $('#coin-root').innerHTML = '<div class="empty"><h3>Coin not found</h3><p>This address isn’t in the preview set. <a href="/" style="color:var(--accent)">Back to explore</a></p></div>'; return; }
    render(c);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
