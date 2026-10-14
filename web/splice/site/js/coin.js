/* Coin page: a live terminal. Candlestick chart, an order ticket whose Gene Quote Breakdown shows
   how each spliced gene shapes the next trade, a live gene rail, holder distribution, trades, and
   the coin's real per-gene parameters. Everything ticks with window.UD (preview data). */
(function () {
  const { $, $$, esc, usd, num, eth, pct, delta, ago, short, avatar, helix, geneChip, addrLink, txLink, copy, notLive, toast, tick } = window.UI;

  function addrFromPath() { const m = location.pathname.match(/\/coin\/(0x[0-9a-fA-F]{40})/); return m ? m[1] : new URLSearchParams(location.search).get('a'); }

  // ---------- gene rail (live) ----------
  function railBadge(c, k) {
    const p = c.params; const g = UD.GENES[k];
    let body = '';
    if (k === 'fee') body = `${UD.FEE_MODES[p.fee.mode]} · ${(p.fee.baseBps / 100).toFixed(2)}%`;
    else if (k === 'snipe') { const rem = UD.snipeRemaining(c); body = rem > 0 ? `${UD.snipeBps(c) / 100}% · ${rem} blk left` : 'cleared'; }
    else if (k === 'buyback') body = `${p.buyback.poolEth.toFixed(3)}/${p.buyback.thresholdEth} ETH`;
    else if (k === 'div') body = `${p.div.paidEth} ETH paid`;
    else if (k === 'maxw') body = c.protected ? `${p.maxw.pct}% · lifts ${(p.maxw.liftHrs - c.ageHrs).toFixed(1)}h` : 'lifted';
    else if (k === 'agent') body = `${p.agent.scheme}`;
    return `<span class="rbadge ${g.cls}" title="${esc(g.name)}: ${esc(g.short)}">${window.UI.gc(k)}<b>${esc(g.name)}</b><span>${body}</span></span>`;
  }
  const geneRail = c => `<div class="generail live" id="rail">${c.genes.map(k => railBadge(c, k)).join('')}</div>`;

  // ---------- gene parameter detail ----------
  function geneParamBlock(c) {
    const items = c.genes.map(k => {
      const g = UD.GENES[k], p = c.params; let rows = '';
      if (k === 'fee') rows = row('Mode', UD.FEE_MODES[p.fee.mode]) + row('Base fee', (p.fee.baseBps / 100).toFixed(2) + '%') + (p.fee.dynBps ? row('Range', (p.fee.dynBps[0] / 100) + '%–' + (p.fee.dynBps[1] / 100) + '%') : '') + row('Ceiling', (p.fee.ceilBps / 100) + '%');
      else if (k === 'snipe') rows = row('Start tax', (p.snipe.startBps / 100) + '%') + row('Decays over', p.snipe.decayBlocks + ' blocks') + row('Now', UD.snipeRemaining(c) > 0 ? UD.snipeBps(c) / 100 + '% (' + UD.snipeRemaining(c) + ' blk left)' : 'cleared');
      else if (k === 'buyback') rows = row('Fee share', (p.buyback.feeShareBps / 100) + '%') + row('Threshold', p.buyback.thresholdEth + ' ETH') + row('Pool', p.buyback.poolEth.toFixed(4) + ' ETH', 'bpool') + row('Burned', p.buyback.burnedPct + '% of supply');
      else if (k === 'div') rows = row('Fee share', (p.div.feeShareBps / 100) + '%') + row('Paid to date', p.div.paidEth + ' ETH') + row('Unclaimed pool', p.div.poolEth.toFixed(4) + ' ETH');
      else if (k === 'maxw') rows = row('Cap', p.maxw.pct + '% of supply') + row('Lifts after', p.maxw.liftHrs + 'h') + row('Status', c.protected ? 'protecting' : 'lifted');
      else if (k === 'agent') rows = row('Scheme', p.agent.scheme + ' (post-quantum)') + row('Actions signed', num(p.agent.actions, 0)) + row('Status', 'phase 2');
      return `<div class="gi"><b>${window.UI.gc(k)}${esc(g.name)} <span class="tag">${esc(g.short)}</span></b><div class="params">${rows}</div><p>${esc(g.desc)}</p></div>`;
    }).join('');
    const core = UD.CONSTITUTION.map(x => `<div class="gi"><b>${esc(x.name)} <span class="tag">always on</span></b><p>${esc(x.desc)}</p></div>`).join('');
    return `<div class="panel"><div class="panel-h"><h2>Genes</h2><span class="hint">${c.genes.length} spliced in</span></div><div class="panel-b"><div class="genelist">${items}</div><div class="lside-h" style="margin:18px 0 10px">Constitution — the immutable core</div><div class="genelist">${core}</div></div></div>`;
  }
  const row = (k, v, id) => `<div class="prow"><span>${esc(k)}</span><b${id ? ` data-${id}` : ''}>${esc(v)}</b></div>`;

  // ---------- holders ----------
  function holderBlock(c) {
    const h = UD.holders(c.addr);
    const seg = (w, cls, label) => w > 0.3 ? `<span class="hseg ${cls}" style="width:${w}%" title="${label}"></span>` : '';
    return `<div class="panel"><div class="panel-h"><h2>Holders</h2><span class="hint">${num(h.total, 0)} · preview</span></div><div class="panel-b">
      <div class="hbar">${seg(h.top1, 's1', 'Top holder ' + h.top1 + '%')}${seg(h.top10 - h.top1, 's2', 'Next 9 ' + (h.top10 - h.top1).toFixed(1) + '%')}${seg(h.others, 's3', 'Everyone else ' + h.others + '%')}${seg(h.lp, 's4', 'Locked LP ' + h.lp + '%')}</div>
      <div class="hlegend"><span><i class="s1"></i>Top ${h.top1}%</span><span><i class="s2"></i>Top 10 ${h.top10}%</span><span><i class="s3"></i>Others ${h.others}%</span><span><i class="s4"></i>Locked LP ${h.lp}%</span></div>
      <div class="table-wrap"><table class="list"><thead><tr><th class="l">Wallet</th><th>Share</th></tr></thead><tbody>${h.list.map(x => `<tr><td class="l mono"><a href="${addrLink(x.addr)}" target="_blank" rel="noopener">${short(x.addr)}</a>${x.tag ? ` <span class="tag">${x.tag}</span>` : ''}</td><td class="num">${x.pct}%</td></tr>`).join('')}</tbody></table></div>
    </div></div>`;
  }

  // ---------- trades ----------
  function tradesBlock(c) {
    const t = UD.trades(c.addr, 16);
    const rows = t.map(x => `<tr><td class="l"><span class="ev ${x.buy ? 'buy' : 'sell'}"><i></i>${x.buy ? 'Buy' : 'Sell'}</span></td><td class="mono num">${x.eth} ETH</td><td class="num">${usd(x.usd)}</td><td class="num">${num(x.tokens, 0)}</td><td class="l mono"><a href="${addrLink(x.maker)}" target="_blank" rel="noopener">${short(x.maker)}</a></td><td class="faint">${ago(x.ts)}</td></tr>`).join('');
    return `<div class="panel"><div class="panel-h"><h2>Trades</h2><span class="hint">preview</span></div><div class="panel-b"><div class="table-wrap"><table class="list"><thead><tr><th class="l">Type</th><th>ETH</th><th>USD</th><th>Tokens</th><th class="l">Maker</th><th>Age</th></tr></thead><tbody id="tradesbody">${rows}</tbody></table></div></div></div>`;
  }

  // ---------- order ticket ----------
  let side = 'buy', amount = 0, slip = 1;
  function ticket(c) {
    const BUY = [0.05, 0.1, 0.5, 1], SELL = [25, 50, 75, 100];
    const presets = side === 'buy' ? BUY.map(v => `<button class="preset" data-amt="${v}">${v} ETH</button>`).join('') : SELL.map(v => `<button class="preset" data-pct="${v}">${v}%</button>`).join('');
    return `<div class="panel lside"><div class="panel-h"><h2>Trade</h2><span class="hint">${esc(c.pair.symbol)} · preview</span></div><div class="panel-b">
      <div class="seg" id="seg"><button class="${side === 'buy' ? 'on' : ''}" data-side="buy">Buy</button><button class="${side === 'sell' ? 'on' : ''}" data-side="sell">Sell</button></div>
      <div class="field" style="margin-top:14px"><label class="lbl">Amount (${side === 'buy' ? 'ETH' : '%'})</label><input class="input mono" id="amt" placeholder="0.0" inputmode="decimal" value="${amount || ''}"></div>
      <div class="presets">${presets}</div>
      <div class="slip"><span class="lbl" style="margin:0">Max slippage</span>${[0.5, 1, 3].map(s => `<button class="spill ${s === slip ? 'on' : ''}" data-slip="${s}">${s}%</button>`).join('')}</div>
      <div id="breakdown"></div>
      <button class="btn accent wide lg" id="trade-btn" style="margin-top:14px">${side === 'buy' ? 'Buy' : 'Sell'} $${esc(c.symbol)}</button>
    </div></div>`;
  }
  function breakdown(c) {
    const el = $('#breakdown'); if (!el) return;
    const amtEth = side === 'buy' ? amount : amount / 100 * 2; // sell % mapped to a nominal size for preview
    if (!amtEth) { el.innerHTML = `<div class="bd-empty faint">Enter an amount to see how this coin’s genes shape the trade.</div>`; return; }
    const q = UD.quote(c, side, amtEth);
    const line = (p) => `<div class="bd-row"><span>${esc(p.label)}${p.bps ? ` <span class="faint">${(p.bps / 100).toFixed(2)}%</span>` : ''}${p.note ? ` <span class="faint">${esc(p.note)}</span>` : ''}</span><b class="mono">${eth(p.eth)}</b></div>`;
    el.innerHTML = `<div class="bd">
      <div class="bd-top"><span>${side === 'buy' ? 'You get' : 'You receive'}</span><b class="mono">${side === 'buy' ? num(q.tokens, 0) + ' $' + esc(c.symbol) : eth(q.afterFee)}</b></div>
      ${q.clamped ? `<div class="bd-warn">Max-wallet caps this buy at ${num(q.clamped, 0)} $${esc(c.symbol)} (${c.params.maxw.pct}% of supply) while protection is on.</div>` : ''}
      <div class="bd-h">Fee this trade — total ${(q.totalBps / 100).toFixed(2)}%</div>
      ${q.parts.map(line).join('')}
    </div>`;
  }

  // ---------- render ----------
  // TradingView owns the chart; realtime bars stream via tv.js
  function render(c) {
    document.title = `${c.name} ($${c.symbol}) — Splice`;
    const soc = [
      `<a class="btn ghost sm" href="https://x.com/${esc(c.socials.x)}" target="_blank" rel="noopener">X ↗</a>`,
      c.socials.tg ? `<a class="btn ghost sm" href="https://t.me/${esc(c.socials.tg)}" target="_blank" rel="noopener">Telegram ↗</a>` : '',
      c.socials.web ? `<a class="btn ghost sm" href="https://${esc(c.socials.web)}" target="_blank" rel="noopener">${esc(c.socials.web)} ↗</a>` : '',
    ].join('');
    $('#coin-root').innerHTML = `
      <a class="backlink" href="/">← Explore</a>
      <div class="coin-bar">
        ${avatar(c)}
        <div class="cb-id"><h1>${esc(c.name)} <small>$${esc(c.symbol)}</small></h1>
          <div class="cb-meta"><span class="spec tagline">${esc(c.spec)} · seq. block ${c.launchBlock.toLocaleString('en-US')}</span><button class="btn ghost sm" id="copyaddr"><span class="mono">${short(c.addr)}</span></button><a class="btn ghost sm" href="${addrLink(c.addr)}" target="_blank" rel="noopener">Basescan ↗</a>${soc}</div>
        </div>
        <div class="cb-helix">${helix(c.genes, { w: 150, h: 48 })}</div>
        <div class="px"><b class="num" data-price>${usd(c.price, { compact: false })}</b><span data-pxdelta>${delta(c.c24)}</span></div>
      </div>
      ${geneRail(c)}
      <div class="keyrow">
        <div class="stat-key"><span>Market cap</span><b class="num" data-mc>${usd(c.mc)}</b><small>FDV ${usd(c.fdv)}</small></div>
        <div class="stat-key"><span>Liquidity</span><b>${usd(c.liq)}</b><small>locked</small></div>
        <div class="stat-key"><span>Volume 24h</span><b class="num" data-vol>${usd(c.vol24)}</b></div>
        <div class="stat-key"><span>Holders</span><b>${num(c.holders, 0)}</b></div>
        <div class="stat-key"><span>Age</span><b>${ago(c.createdTs)}</b><small>on Base</small></div>
      </div>
      <div class="coin-cols">
        <div class="cc-chart"><div class="bigchart" id="chart"></div></div>
        <div class="cc-side">${ticket(c)}</div>
        <div class="cc-rest">
          ${geneParamBlock(c)}
          ${holderBlock(c)}
          ${tradesBlock(c)}
        </div>
      </div>`;

    $('#copyaddr').onclick = () => copy(c.addr, 'Contract');
    // the real TradingView terminal; waits for the standalone library if it is still loading
    const mountTV = () => { if (window.TradingView && window.spTV) spTV.init($('#chart'), c); else setTimeout(mountTV, 120); };
    mountTV();
    bindTicket(c);
    UD.subscribe(ev => { if (ev.type === 'tick') onTick(c); });
  }

  function bindTicket(c) { bindTicketInner(c); }
  function bindTicketInner(c) {
    const seg = $('#seg');
    if (seg) seg.onclick = e => { const b = e.target.closest('[data-side]'); if (!b) return; side = b.dataset.side; amount = 0; redrawTicket(c); };
    const amt = $('#amt'); if (amt) amt.oninput = () => { amount = parseFloat(amt.value) || 0; breakdown(c); };
    $$('.preset').forEach(b => b.onclick = () => { amount = parseFloat(b.dataset.amt || b.dataset.pct) || 0; $('#amt').value = amount; breakdown(c); });
    $$('.spill').forEach(b => b.onclick = () => { slip = parseFloat(b.dataset.slip); $$('.spill').forEach(x => x.classList.toggle('on', x === b)); });
    const tb = $('#trade-btn'); if (tb) tb.onclick = notLive;
    breakdown(c);
  }
  function redrawTicket(c) { const host = $('.cc-side'); host.innerHTML = ticket(c); bindTicketInner(c); }

  function onTick(c) {
    tick($('[data-price]'), c.price, v => usd(v, { compact: false }));
    tick($('[data-mc]'), c.mc, v => usd(v));
    tick($('[data-vol]'), c.vol24, v => usd(v));
    const d = $('[data-pxdelta]'); if (d) d.innerHTML = delta(c.c24);
    const rail = $('#rail'); if (rail) rail.innerHTML = c.genes.map(k => railBadge(c, k)).join('');
    if (amount) breakdown(c);
  }

  function init() {
    const a = addrFromPath(); const c = a && UD.coin(a);
    if (!c) { $('#coin-root').innerHTML = '<div class="empty"><h3>Coin not found</h3><p>This address isn’t in the preview set. <a href="/" style="color:var(--accent)">Back to explore</a></p></div>'; return; }
    render(c);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
