/* Token page: header with name, creator line and market cap; price with the chart controls beside it, chart on the
   page background, stats rows, about, Trades/Holders tabs; sticky trade card and fee card; mobile Buy/Sell bar. */
window.PAGE = async () => {
  const { $, $$, esc, ic, fmtNum, fmtUsd, fmtHype, fmtPrice, fmtPct, shortAddr, ago, fmtDate, toast, errMsg } = APP, C = CFG, E = C.econ;
  const addr = APP.pathAddr(); let x = DATA.token(addr);
  const root = $('#pg-token'); if (!x) { root.innerHTML = `<div class="empty">No coin at this address.<br><a class="ac" href="/">Back home</a></div>`; return; }
  document.title = `${x.name} ($${x.symbol}) | ${C.brand}`;
  const chain = 'hyper'; let side = 'buy', tab = 'trades', amt = '', slip = 3, busy = false;
  const ex = (kind, v) => `${C.chain.explorer}/${kind}/${v}`;
  root.innerHTML = `
    <a class="back" href="/">${ic('chevr').replace('<svg', '<svg style="transform:rotate(180deg)"')}Coins</a>
    <div class="th2"><img class="big" id="t-img" alt=""><div class="min"><h1><span id="t-name"></span><small id="t-sym"></small></h1><div class="meta" id="t-meta"></div></div><div class="mcbox"><span>Market cap</span><b id="t-mcb"></b><small id="t-pxb"></small></div></div>
    <div class="tg">
      <div>
        <div class="pxrow"><div class="pxl" id="t-px"></div><div class="ctl" id="t-ctl"></div></div>
        <div id="t-chart"></div>
        <div class="stats" id="t-stats"></div>
        <div class="stats2" id="t-stats2"></div>
        <div class="about"><h3>About</h3><p>${esc(x.desc)}</p></div>
        <div class="tabw"><div class="tabs" id="t-tabs"><button data-t="trades" class="on">Trades</button><button data-t="holders">Holders</button><span style="margin-left:auto;align-self:center;font-size:12px;color:var(--ink-2)" id="t-cnt"></span></div><div id="t-tabp"></div></div>
      </div>
      <div class="side">
        <div class="tradec" id="trade"><div class="cap">Trades on the Uniswap v4 pool, paired with HYPE.</div><div id="t-trade"></div></div>
        <div class="feec"><div class="hdr"><b>Fees</b><span id="t-feebadge"></span></div><div id="t-fee"></div></div>
      </div>
    </div>
    <div class="mbar"><div class="p"><small>${esc(x.symbol)}</small><b id="t-mpx"></b></div><button class="btn" data-ms="sell">Sell</button><button class="btn pri" data-ms="buy">Buy</button></div>`;
  $('#t-img').src = x.img; $('#t-name').textContent = x.name; $('#t-sym').textContent = x.symbol;
  $$('.mbar [data-ms]').forEach((b) => b.onclick = () => { side = b.dataset.ms; renderTrade(); $('#trade').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  CHART.mount($('#t-chart'), addr, chain, $('#t-ctl'));
  function renderHead() {
    const p = x.byChain[chain];
    $('#t-meta').innerHTML = `<span>by</span><i>${x.creator.slice(2, 4).toUpperCase()}</i><a href="${ex('address', x.creator)}" target="_blank" rel="noopener">${shortAddr(x.creator)}</a><span>${x.age} ago</span><span>HYPE pair</span><span class="addr">${shortAddr(x.addr)}</span><button class="ib" id="t-copy" title="Copy address">${ic('copy')}</button><a class="ib" href="${ex('address', x.addr)}" target="_blank" rel="noopener" title="Explorer">${ic('ext')}</a>${x.links.web ? `<a class="ib" href="${esc(x.links.web)}" target="_blank" rel="noopener" title="Website">${ic('globe')}</a>` : ''}${x.links.x ? `<a class="ib" href="${esc(x.links.x)}" target="_blank" rel="noopener" title="X">${ic('xl')}</a>` : ''}${x.links.tg ? `<a class="ib" href="${esc(x.links.tg)}" target="_blank" rel="noopener" title="Telegram">${ic('tg')}</a>` : ''}`;
    $('#t-copy').onclick = () => APP.copy(x.addr, 'Address copied');
    $('#t-mcb').textContent = fmtUsd(x.mcapUsd); $('#t-pxb').innerHTML = `${fmtUsd(p.pxUsd)} price`; $('#t-mpx').innerHTML = fmtUsd(p.pxUsd);
    $('#t-px').innerHTML = `<b>${fmtUsd(p.pxUsd)}</b><span class="${x.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(x.c24, false)} 24h<small>${fmtPrice(p.px)} HYPE</small></span>`;
    $('#t-stats').innerHTML = `<div><span>Market cap</span><b>${fmtUsd(x.mcapUsd)}</b></div><div><span>Holders</span><b>${fmtNum(x.holders, 0)}</b></div><div><span>Trades</span><b>${fmtNum(x.trades, 0)}</b></div><div><span>Supply</span><b>1B</b></div><div><span>Creator earned</span><b style="color:var(--up-text)">${fmtUsd(x.feesAll * E.creatorShareBps / 10000 * APP.hypeUsd)}</b></div>`;
    $('#t-stats2').innerHTML = `<div><span>Token</span><b><a href="${ex('address', x.addr)}" target="_blank" rel="noopener">${shortAddr(x.addr)}</a></b></div><div><span>Pool</span><b class="u">${shortAddr(p.poolId)}</b></div><div><span>Launched</span><b>${fmtDate(x.createdAt)}</b></div><div><span>Liquidity</span><b>${fmtUsd(x.liqHype * APP.hypeUsd)} · locked</b></div>`;
    $('#t-cnt').textContent = `${fmtNum(x.trades, 0)} total`;
  }
  function renderFee() {
    const f = DATA.feeState(addr, chain), el = $('#t-fee'), bg = $('#t-feebadge'); if (!f) return;
    const base = E.feeBps / 100, cr = base * E.creatorShareBps / 10000, pr = base - cr, ct = x.creatorTaxBps / 100, tot = f.total / 100, extra = tot - base - ct;
    const seg = (v, col) => v > 0 ? `<i style="width:${(v / tot * 100).toFixed(1)}%;background:${col}"></i>` : '';
    bg.innerHTML = f.kind === 'snipe' ? `<span class="badge dn"><i class="live"></i>Snipe window</span>` : f.kind === 'vol' ? `<span class="badge warn"><i class="live"></i>Volatility fee</span>` : `<span class="badge up">Base fee</span>`;
    el.innerHTML = `<div class="sb"><div><span class="lab">On every swap</span><div class="big ${f.kind === 'snipe' ? 'dn' : ''}">${tot.toFixed(tot % 1 ? 2 : 0)}%</div></div><div class="right"><span class="lab">Creator keeps</span><div style="font-weight:800;font-size:17px;color:var(--up-text)">${(cr + ct + extra * E.creatorShareBps / 10000).toFixed(2)}%</div></div></div>
      <div class="split">${seg(cr, 'var(--acid)')}${seg(ct, '#7ee37f')}${seg(pr, 'rgba(128,128,128,.4)')}${seg(extra, f.kind === 'snipe' ? 'var(--dn)' : 'var(--warn)')}</div>
      <div class="leg"><div><em style="background:var(--acid)"></em>Creator · 70% of the ${base}% base<b>${cr.toFixed(2)}%</b></div>${ct ? `<div><em style="background:#7ee37f"></em>Creator fee<b>${ct.toFixed(2)}%</b></div>` : ''}<div><em style="background:rgba(128,128,128,.4)"></em>Protocol<b>${pr.toFixed(2)}%</b></div>${extra > 0 ? `<div><em style="background:${f.kind === 'snipe' ? 'var(--dn)' : 'var(--warn)'}"></em>${f.kind === 'snipe' ? 'Snipe tax' : 'Volatility fee'} · 70/30<b>${extra.toFixed(2)}%</b></div>` : ''}</div>
      ${f.kind === 'snipe' ? `<div class="live"><span>${f.left}s left</span><div class="bar dn"><i style="width:${(f.left / E.snipeSeconds) * 100}%"></i></div></div>` : f.kind === 'vol' ? `<div class="live"><span>${f.left}s left</span><div class="bar warn"><i style="width:${(f.left / E.volDecaySec) * 100}%"></i></div><span>back to ${(f.bps / 100).toFixed(1)}%</span></div>` : `<div class="live">Rises to ${E.volPeakBps / 100}% for ${E.volDecaySec / 60} min after a ${E.volThresholdBps / 100}% move in ${E.volWindowSec}s. Fixed at launch.</div>`}`;
  }
  function renderTrade() {
    const el = $('#t-trade'), me = APP.W.connected ? APP.W.address : '', bal = DATA.balance(addr, chain, me), hbal = me ? DATA.hypeBalance(chain) : 0, p = x.byChain[chain];
    const v = parseFloat(amt) || 0; const q = side === 'buy' ? DATA.quoteBuy(addr, chain, v) : DATA.quoteSell(addr, chain, v);
    const quick = side === 'buy' ? (me ? [['25%', hbal * 0.25], ['50%', hbal * 0.5], ['75%', hbal * 0.75], ['Max', hbal]] : [['0.1', 0.1], ['0.5', 0.5], ['1', 1], ['5', 5]]) : [['25%', bal * 0.25], ['50%', bal * 0.5], ['75%', bal * 0.75], ['Max', bal]];
    el.innerHTML = `<div class="seg bs"><button class="${side === 'buy' ? 'on' : ''}" data-s="buy">Buy</button><button class="${side === 'sell' ? 'on' : ''}" data-s="sell">Sell</button></div>
      <div class="pay"><div class="lab"><span>${side === 'buy' ? 'Pay' : 'Sell'}</span><span>${me ? `${side === 'buy' ? fmtNum(hbal, 3) + ' HYPE' : fmtNum(bal, 0) + ' ' + esc(x.symbol)}` : ''}</span></div><div class="amt"><input id="t-amt" inputmode="decimal" placeholder="0" value="${esc(amt)}" autocomplete="off"><b>${side === 'buy' ? 'HYPE' : esc(x.symbol)}</b></div><div class="qs">${quick.map(([l, v2]) => `<button data-q="${v2}">${l}</button>`).join('')}</div></div>
      <div class="recv"><span>You receive</span><b>${v > 0 ? (side === 'buy' ? `${fmtNum(q.tokens * (1 - slip / 100), 0)}<small>${esc(x.symbol)}</small>` : `${fmtNum(q.hype * (1 - slip / 100), 4)}<small>HYPE</small>`) : `0<small>${side === 'buy' ? esc(x.symbol) : 'HYPE'}</small>`}</b></div>
      <div class="q">${v > 0 ? `<div class="kvl"><span>Fee ${(q.feeBps / 100).toFixed(2)}%${q.snipe ? ' incl. snipe tax' : ''}</span><b>${fmtHype(q.fee + (q.snipe || 0), 4)}</b></div><div class="kvl"><span>Price impact</span><b class="${Math.abs(q.impact) > 5 ? 'dn' : ''}">${q.impact > 0 ? '+' : ''}${q.impact.toFixed(2)}%</b></div>` : ''}<div class="kvl"><span>Slippage</span><b><span class="seg" id="t-slip" style="display:inline-flex;width:auto">${[1, 3, 10].map((s) => `<button class="${slip === s ? 'on' : ''}" data-sl="${s}" style="flex:none;height:24px;padding:0 9px;font-size:12px">${s}%</button>`).join('')}</span></b></div></div>
      <button class="btn w go ${side === 'buy' ? 'up on' : 'dn on'}" id="t-go"></button>`;
    $$('[data-s]', el).forEach((b) => b.onclick = () => { side = b.dataset.s; amt = ''; renderTrade(); });
    $$('[data-q]', el).forEach((b) => b.onclick = () => { const k = +b.dataset.q; amt = k > 0 ? String(+k.toFixed(6)) : ''; renderTrade(); });
    $$('[data-sl]', el).forEach((b) => b.onclick = () => { slip = +b.dataset.sl; renderTrade(); });
    const inp = $('#t-amt', el); inp.oninput = () => { amt = inp.value; const pos = inp.selectionStart; renderTrade(); const n = $('#t-amt'); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} };
    const go = $('#t-go', el);
    if (busy) { go.disabled = true; go.textContent = 'Confirm in your wallet…'; return; }
    if (!me) { go.textContent = 'Connect wallet'; go.onclick = () => APP.W.connect(); return; }
    if (!APP.W.chainOk) { go.textContent = 'Switch to HyperEVM'; go.onclick = () => APP.W.switchChain().catch((e) => toast(errMsg(e), 'err')); return; }
    go.textContent = v > 0 ? `${side === 'buy' ? 'Buy' : 'Sell'} ${esc(x.symbol)}` : 'Enter an amount'; go.disabled = !(v > 0);
    go.onclick = async () => { busy = true; renderTrade(); try { const r = side === 'buy' ? await DATA.buy(addr, chain, v, q.tokens * (1 - slip / 100)) : await DATA.sell(addr, chain, v, q.hype * (1 - slip / 100)); toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${fmtNum(r.tokens, 0)} ${x.symbol} for ${fmtNum(r.hype, 4)} HYPE`, 'ok'); amt = ''; } catch (e) { toast(errMsg(e), 'err'); } busy = false; renderAll(); };
  }
  function renderTab() {
    const el = $('#t-tabp'); $$('#t-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'trades') { const trs = DATA.trades(addr, chain).slice(0, 50); el.innerHTML = `<div class="tscroll"><table class="tbl"><thead><tr><th>Side</th><th>Trader</th><th class="r">HYPE</th><th class="r">${esc(x.symbol)}</th><th class="r hm">Price</th><th class="r">Age</th></tr></thead><tbody>${trs.map((t) => `<tr><td class="${t.buy ? 'up' : 'dn'}" style="font-weight:700">${t.buy ? '↗ Buy' : '↘ Sell'}${t.snipeBps ? ` <span class="badge dn">snipe</span>` : ''}${t.volBps ? ` <span class="badge warn">vol</span>` : ''}</td><td><a href="${ex('address', t.wallet)}" target="_blank" rel="noopener" class="addr">${t.wallet === x.creator ? '<span class="badge ac">creator</span>' : shortAddr(t.wallet)} ${ic('ext').replace('<svg', '<svg style="display:inline;width:11px;height:11px;vertical-align:-1px;opacity:.6"')}</a></td><td class="r">${fmtNum(t.hype, 3)}</td><td class="r">${fmtNum(t.tokens, 0)}</td><td class="r hm">${fmtUsd(t.px * APP.hypeUsd)}</td><td class="r muted">${ago(t.ts)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">No trades yet</td></tr>`}</tbody></table></div>`; }
    if (tab === 'holders') { const hs = DATA.holders(addr, chain).slice(0, 50); el.innerHTML = `<div class="tscroll"><table class="tbl"><thead><tr><th>#</th><th>Holder</th><th class="r">Balance</th><th class="r">Share</th></tr></thead><tbody>${hs.map((h, i) => `<tr><td class="muted">${i + 1}</td><td>${h.pool ? `<span class="badge ac">${ic('lock')}${esc(h.wallet)}</span>` : `<a class="addr" href="${ex('address', h.wallet)}" target="_blank" rel="noopener">${shortAddr(h.wallet)}</a>${h.creator ? ' <span class="badge ac">creator</span>' : ''}`}</td><td class="r">${fmtNum(h.bal, 0)}</td><td class="r">${h.share.toFixed(2)}%</td></tr>`).join('')}</tbody></table></div>`; }
  }
  $$('#t-tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.t; renderTab(); });
  function renderAll() { x = DATA.token(addr) || x; renderHead(); renderFee(); renderTrade(); renderTab(); CHART.update(); }
  renderAll(); APP.onUpdate(() => { x = DATA.token(addr) || x; renderHead(); renderFee(); if (!busy && document.activeElement !== $('#t-amt')) renderTrade(); renderTab(); CHART.update(); }); APP.onWallet(renderTrade);
  setInterval(renderFee, 1000);
};
