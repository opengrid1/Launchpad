/* Token page: header (back, identity, market cap figure), chart section with the price figure and controls, facts,
   contract row, about, Trades/Holders; a sticky trade panel and a fee card; a bottom dock on mobile. */
window.PAGE = async () => {
  const { $, $$, esc, ic, fmtNum, fmtUsd, fmtHype, fmtPrice, fmtPct, shortAddr, ago, fmtDate, toast, errMsg } = APP, C = CFG, E = C.econ;
  const addr = APP.pathAddr(); let x = DATA.token(addr);
  const root = $('#pg-token'); if (!x) { root.innerHTML = `<div class="empty">No coin at this address.<br><a class="ac" href="/">Back home</a></div>`; return; }
  document.title = `${x.name} ($${x.symbol}) | ${C.brand}`;
  const chain = 'hyper'; let side = 'buy', tab = 'trades', amt = '', slip = 1, busy = false;
  const ex = (kind, v) => `${C.chain.explorer}/${kind}/${v}`;
  root.innerHTML = `
    <header class="thd"><a class="back" href="/">${ic('chevr').replace('<svg', '<svg style="transform:rotate(180deg)"')}Launches</a>
      <div class="idn"><span class="mk"><img id="t-img" alt=""></span><div class="ttl"><div class="tr"><h1 id="t-name"></h1><span class="tk" id="t-sym"></span></div><p class="by" id="t-meta"></p></div></div>
      <div class="fig"><span>Market cap</span><b id="t-mcb"></b><span id="t-pxb"></span></div></header>
    <div class="tg">
      <div class="tmain">
        <section class="chs"><div class="chh"><div class="chf" id="t-px"></div><div class="chc" id="t-ctl"></div></div><div id="t-chart"></div></section>
        <section class="facts"><dl class="figs" id="t-stats"></dl><dl class="contract" id="t-stats2"></dl></section>
        <section class="tsec"><div class="sh"><h2>About</h2></div><p class="desc">${esc(x.desc)}</p></section>
        <section class="tsec trades"><div class="sh tabsh"><div class="tabs" id="t-tabs"><button data-t="trades" class="on">Trades</button><button data-t="holders">Holders</button></div><span class="cnt" id="t-cnt"></span></div><div id="t-tabp"></div></section>
      </div>
      <aside class="tside">
        <section class="tp" id="trade"><p class="venue">Trades on the Uniswap v4 pool.</p><div id="t-trade"></div></section>
        <div class="feec"><div class="hdr"><b>Fees</b><span id="t-feebadge"></span></div><div id="t-fee"></div></div>
      </aside>
    </div>
    <div class="dock"><div class="df"><small>${esc(x.symbol)}</small><b id="t-mpx"></b></div><div class="da"><button class="btn" data-ms="sell">Sell</button><button class="btn pri" data-ms="buy">Buy</button></div></div>`;
  $('#t-img').src = x.img; $('#t-name').textContent = x.name; $('#t-sym').textContent = x.symbol;
  let host = null; // when set, the trade panel renders inside the mobile sheet
  function openSheet(s) { side = s; amt = ''; const ov = document.createElement('div'); ov.className = 'shov'; ov.innerHTML = `<div class="shc" role="dialog" aria-modal="true"><div class="shh"><p>${esc(x.symbol)}</p><h2 id="sh-h2"></h2></div><div class="shb"><p class="venue">Trades on the Uniswap v4 pool.</p><div id="sh-trade"></div></div></div>`; ov.onclick = (e) => { if (e.target === ov) closeSheet(); }; document.body.appendChild(ov); document.body.style.overflow = 'hidden'; host = $('#sh-trade', ov); renderTrade(); }
  function closeSheet() { const ov = $('.shov'); if (ov) ov.remove(); document.body.style.overflow = ''; host = null; renderTrade(); }
  $$('.dock [data-ms]').forEach((b) => b.onclick = () => openSheet(b.dataset.ms));
  CHART.mount($('#t-chart'), addr, chain, $('#t-ctl'));
  function renderHead() {
    const p = x.byChain[chain];
    $('#t-meta').innerHTML = `<span class="cr">by <a href="${ex('address', x.creator)}" target="_blank" rel="noopener"><i class="cmark">${x.creator.slice(2, 4).toUpperCase()}</i>${shortAddr(x.creator)}</a></span><time>${x.age} ago</time><span>HYPE pair</span><button class="ia" id="t-copy" title="Copy address">${shortAddr(x.addr)}${ic('copy')}</button><a class="ia" href="${ex('address', x.addr)}" target="_blank" rel="noopener" title="Explorer">${ic('ext')}</a>${x.links.web ? `<a class="ia ic" href="${esc(x.links.web)}" target="_blank" rel="noopener" title="Website">${ic('globe')}</a>` : ''}${x.links.x ? `<a class="ia ic" href="${esc(x.links.x)}" target="_blank" rel="noopener" title="X">${ic('xl')}</a>` : ''}${x.links.tg ? `<a class="ia ic" href="${esc(x.links.tg)}" target="_blank" rel="noopener" title="Telegram">${ic('tg')}</a>` : ''}`;
    $('#t-copy').onclick = () => APP.copy(x.addr, 'Address copied');
    $('#t-mcb').textContent = fmtUsd(x.mcapUsd); $('#t-pxb').innerHTML = `${fmtUsd(p.pxUsd)} price`; $('#t-mpx').innerHTML = fmtUsd(p.pxUsd);
    $('#t-px').innerHTML = `<b>${fmtUsd(p.pxUsd)}</b><span><em class="${x.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(x.c24, false)} 24h</em> · ${fmtPrice(p.px)} HYPE</span>`;
    $('#t-stats').innerHTML = `<div><span>Market cap</span><b>${fmtUsd(x.mcapUsd)}</b></div><div><span>Holders</span><b>${fmtNum(x.holders, 0)}</b></div><div><span>Trades</span><b>${fmtNum(x.trades, 0)}</b></div><div><span>Supply</span><b>1B</b></div><div><span>Creator earned</span><b>${fmtUsd(x.feesAll * E.creatorShareBps / 10000 * APP.hypeUsd)}${ic('check').replace('<svg', '<svg style="width:16px;height:16px"')}</b></div>`;
    $('#t-stats2').innerHTML = `<div><span>Token</span><b><a href="${ex('address', x.addr)}" target="_blank" rel="noopener">${shortAddr(x.addr)}</a></b></div><div><span>Pool</span><b class="u">${shortAddr(p.poolId)}</b></div><div><span>Launched</span><b>${fmtDate(x.createdAt)}</b></div><div><span>Liquidity</span><b>${fmtUsd(x.liqHype * APP.hypeUsd)}</b></div>`;
    $('#t-cnt').textContent = `${fmtNum(x.trades, 0)} total`;
  }
  function renderFee() {
    const f = DATA.feeState(addr, chain), el = $('#t-fee'), bg = $('#t-feebadge'); if (!f) return;
    const base = E.feeBps / 100, cr = base * E.creatorShareBps / 10000, pr = base - cr, ct = x.creatorTaxBps / 100, tot = f.total / 100, extra = tot - base - ct;
    const seg = (v, col) => v > 0 ? `<i style="width:${(v / tot * 100).toFixed(1)}%;background:${col}"></i>` : '';
    bg.innerHTML = f.kind === 'snipe' ? `<span class="badge dn sm"><i class="live"></i>Launch protection</span>` : f.kind === 'vol' ? `<span class="badge warn sm"><i class="live"></i>Volatility fee</span>` : `<span class="badge up sm">Pool fee</span>`;
    el.innerHTML = `<div class="sb"><div><span class="lab">On each trade</span><div class="big ${f.kind === 'snipe' ? 'dn' : ''}">${tot.toFixed(tot % 1 ? 2 : 0)}%</div></div><div class="right"><span class="lab">Creator share</span><div class="big" style="color:var(--up-text);font-size:18px">${(cr + ct + extra * E.creatorShareBps / 10000).toFixed(2)}%</div></div></div>
      <div class="split">${seg(cr, 'var(--acid)')}${seg(ct, '#97fce4')}${seg(pr, 'rgba(128,128,128,.4)')}${seg(extra, f.kind === 'snipe' ? 'var(--dn)' : 'var(--warn)')}</div>
      <div class="leg"><div><em style="background:var(--acid)"></em>Creator, 70% of the ${base}% pool fee<b>${cr.toFixed(2)}%</b></div>${ct ? `<div><em style="background:#7ee37f"></em>Creator fee<b>${ct.toFixed(2)}%</b></div>` : ''}<div><em style="background:rgba(128,128,128,.4)"></em>Protocol<b>${pr.toFixed(2)}%</b></div>${extra > 0 ? `<div><em style="background:${f.kind === 'snipe' ? 'var(--dn)' : 'var(--warn)'}"></em>${f.kind === 'snipe' ? 'Snipe tax' : 'Volatility fee'} · 70/30<b>${extra.toFixed(2)}%</b></div>` : ''}</div>
      ${f.kind === 'snipe' ? `<div class="live"><span>${f.left}s left</span><div class="bar dn"><i style="width:${(f.left / E.snipeSeconds) * 100}%"></i></div></div>` : f.kind === 'vol' ? `<div class="live"><span>${f.left}s left</span><div class="bar warn"><i style="width:${(f.left / E.volDecaySec) * 100}%"></i></div><span>back to ${(f.bps / 100).toFixed(1)}%</span></div>` : `<div class="live">Rises to ${E.volPeakBps / 100}% for ${E.volDecaySec / 60} min after a ${E.volThresholdBps / 100}% move in ${E.volWindowSec}s. Fixed at launch.</div>`}`;
  }
  function renderTrade() {
    const el = host || $('#t-trade'), me = APP.W.connected ? APP.W.address : '', bal = DATA.balance(addr, chain, me), hbal = me ? DATA.hypeBalance(chain) : 0, p = x.byChain[chain];
    const h2 = $('#sh-h2'); if (h2) h2.textContent = `${side === 'buy' ? 'Buy' : 'Sell'} ${x.symbol}`;
    const v = parseFloat(amt) || 0; const q = side === 'buy' ? DATA.quoteBuy(addr, chain, v) : DATA.quoteSell(addr, chain, v);
    const have = side === 'buy' ? hbal : bal; const quick = [['25%', have * 0.25], ['50%', have * 0.5], ['75%', have * 0.75], ['Max', have]];
    el.innerHTML = `<div class="seg bs" style="margin-top:0"><button class="on" data-m="market">Market</button><button data-m="limit">Limit</button></div><div class="seg bs" style="margin-top:20px"><button class="${side === 'buy' ? 'on' : ''}" data-s="buy">Buy</button><button class="${side === 'sell' ? 'on' : ''}" data-s="sell">Sell</button></div>
      <div class="fld" style="margin-top:20px"><div class="fh"><label for="t-amt">${side === 'buy' ? 'Pay' : 'Sell'}</label><span>${me ? `${side === 'buy' ? fmtNum(hbal, 3) + ' HYPE' : fmtNum(bal, 0) + ' ' + esc(x.symbol)}` : ''}</span></div><div class="fin"><input id="t-amt" inputmode="decimal" placeholder="0" value="${esc(amt)}" autocomplete="off"><b>${side === 'buy' ? 'HYPE' : esc(x.symbol)}</b></div><div class="frac">${quick.map(([l, v2]) => `<button data-q="${v2}" ${me ? '' : 'disabled'}>${l}</button>`).join('')}</div></div>
      <div class="out" style="margin-top:20px"><span>You receive</span><b>${v > 0 ? (side === 'buy' ? `${fmtNum(q.tokens * (1 - slip / 100), 0)}<small>${esc(x.symbol)}</small>` : `${fmtNum(q.hype * (1 - slip / 100), 4)}<small>HYPE</small>`) : `0<small>${side === 'buy' ? esc(x.symbol) : 'HYPE'}</small>`}</b></div>
      <details style="margin-top:20px"><summary><span>Slippage ${slip.toFixed(1)} %</span>${ic('chevr').replace('<svg', '<svg style="transform:rotate(90deg)"')}</summary><div class="slp">${[0.5, 1, 3].map((s) => `<button class="${slip === s ? 'on' : ''}" data-sl="${s}">${s.toFixed(1)} %</button>`).join('')}</div>${v > 0 ? `<div class="q"><div class="kvl"><span>Fee ${(q.feeBps / 100).toFixed(2)}%${q.snipe ? ' incl. snipe tax' : ''}</span><b>${fmtHype(q.fee + (q.snipe || 0), 4)}</b></div><div class="kvl"><span>Price impact</span><b class="${Math.abs(q.impact) > 5 ? 'dn' : ''}">${q.impact > 0 ? '+' : ''}${q.impact.toFixed(2)}%</b></div></div>` : ''}</details>
      <button class="btn w pri go" id="t-go" style="margin-top:0"></button>`;
    $$('[data-s]', el).forEach((b) => b.onclick = () => { side = b.dataset.s; amt = ''; renderTrade(); }); $$('[data-m="limit"]', el).forEach((b) => b.onclick = () => toast('Limit orders are not available yet', 'info'));
    $$('[data-q]', el).forEach((b) => b.onclick = () => { const k = +b.dataset.q; amt = k > 0 ? String(+k.toFixed(6)) : ''; renderTrade(); });
    $$('[data-sl]', el).forEach((b) => b.onclick = (e) => { e.preventDefault(); slip = +b.dataset.sl; const open = $('details', el).open; renderTrade(); $('details', host || $('#t-trade')).open = open; });
    const inp = $('#t-amt', el); inp.oninput = () => { amt = inp.value; const pos = inp.selectionStart; const d = $('details', el).open; renderTrade(); const h = host || $('#t-trade'); const n = $('#t-amt', h); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} $('details', h).open = d; };
    const go = $('#t-go', el);
    if (busy) { go.disabled = true; go.textContent = 'Confirm in your wallet…'; return; }
    if (!me) { go.textContent = 'Sign in'; go.onclick = () => APP.W.connect(); return; }
    if (!APP.W.chainOk) { go.textContent = 'Switch to HyperEVM'; go.onclick = () => APP.W.switchChain().catch((e) => toast(errMsg(e), 'err')); return; }
    go.textContent = side === 'buy' ? 'Buy' : 'Sell'; go.disabled = !(v > 0);
    go.onclick = async () => { busy = true; renderTrade(); try { const r = side === 'buy' ? await DATA.buy(addr, chain, v, q.tokens * (1 - slip / 100)) : await DATA.sell(addr, chain, v, q.hype * (1 - slip / 100)); toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${fmtNum(r.tokens, 0)} ${x.symbol} for ${fmtNum(r.hype, 4)} HYPE`, 'ok'); amt = ''; if (host) closeSheet(); } catch (e) { toast(errMsg(e), 'err'); } busy = false; renderAll(); };
  }
  const arrow = (up) => `<svg viewBox="0 0 24 24" fill="none" stroke="${up ? '#16b364' : '#ef4444'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${up ? '<path d="M7 17L17 7M9 7h8v8"/>' : '<path d="M7 7l10 10M17 9v8H9"/>'}</svg>`;
  function renderTab() {
    const el = $('#t-tabp'); $$('#t-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'trades') { const trs = DATA.trades(addr, chain).slice(0, 50); el.innerHTML = `<div class="tscroll"><table class="tbl"><thead><tr><th>Side</th><th>Trader</th><th class="r">HYPE</th><th class="r">${esc(x.symbol)}</th><th class="r hm">Price</th><th class="r">Age</th></tr></thead><tbody>${trs.map((t) => `<tr><td><span class="side">${arrow(t.buy)}${t.buy ? 'Buy' : 'Sell'}</span>${t.snipeBps ? ` <span class="badge dn sm">snipe</span>` : ''}${t.volBps ? ` <span class="badge warn sm">vol</span>` : ''}</td><td><a class="who" href="${ex('tx', t.tx)}" target="_blank" rel="noopener"><i class="cmark">${t.wallet.slice(2, 4).toUpperCase()}</i>${t.wallet === x.creator ? 'creator' : shortAddr(t.wallet)}${ic('ext')}</a></td><td class="r">${fmtNum(t.hype, 3)}</td><td class="r">${fmtNum(t.tokens, 0)}</td><td class="r hm">${fmtUsd(t.px * APP.hypeUsd)}</td><td class="r">${ago(t.ts)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">No trades yet</td></tr>`}</tbody></table></div>`; }
    if (tab === 'holders') { const hs = DATA.holders(addr, chain).slice(0, 50); el.innerHTML = `<div class="tscroll"><table class="tbl"><thead><tr><th>#</th><th>Holder</th><th class="r">Balance</th><th class="r">Share</th></tr></thead><tbody>${hs.map((h, i) => `<tr><td class="muted">${i + 1}</td><td>${h.pool ? `<span class="badge ac sm">${esc(h.wallet)}</span>` : `<a class="who" href="${ex('address', h.wallet)}" target="_blank" rel="noopener"><i class="cmark">${h.wallet.slice(2, 4).toUpperCase()}</i>${shortAddr(h.wallet)}</a>${h.creator ? ' <span class="badge ac sm">creator</span>' : ''}`}</td><td class="r">${fmtNum(h.bal, 0)}</td><td class="r">${h.share.toFixed(2)}%</td></tr>`).join('')}</tbody></table></div>`; }
  }
  $$('#t-tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.t; renderTab(); });
  function renderAll() { x = DATA.token(addr) || x; renderHead(); renderFee(); renderTrade(); renderTab(); CHART.update(); }
  renderAll(); APP.onUpdate(() => { x = DATA.token(addr) || x; renderHead(); renderFee(); if (!busy && !(document.activeElement && document.activeElement.id === 't-amt')) renderTrade(); renderTab(); CHART.update(); }); APP.onWallet(renderTrade);
  setInterval(renderFee, 1000);
};
