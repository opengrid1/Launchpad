/* Token page, laid out like nad.fun: header card, Market Cap + ATH, chart and Trades/Holders tabs on the left;
   Fee Overview, Trade, Information and Other Info cards in a sticky right column. */
window.PAGE = async () => {
  const { $, $$, esc, ic, fmtNum, fmtUsd, fmtHype, fmtPrice, fmtPct, shortAddr, ago, fmtDate, toast, errMsg } = APP, C = CFG, E = C.econ;
  const addr = APP.pathAddr(); let x = DATA.token(addr);
  const root = $('#pg-token'); if (!x) { root.innerHTML = `<div class="empty">No coin at this address.<br><a class="ac" href="/">Back home</a></div>`; return; }
  document.title = `${x.name} ($${x.symbol}) | ${C.brand}`;
  const chain = 'hyper'; let side = 'buy', tab = 'trades', amt = '', slip = 3, busy = false;
  const ex = (kind, v) => `${C.chain.explorer}/${kind}/${v}`;
  root.innerHTML = `
    <a class="back" href="/">${ic('chevr').replace('<svg', '<svg style="transform:rotate(180deg)"')}Coins</a>
    <div class="tg">
      <div class="thead"><img class="big" id="t-img" alt=""><div class="min"><div class="r1"><h1 id="t-name"></h1><span class="tkr" id="t-sym"></span><button class="addrp" id="t-copy">${shortAddr(x.addr)}${ic('copy')}</button></div><div class="r2" id="t-meta"></div></div><div class="r3" id="t-links"></div></div>
      <div class="mcrow" id="t-mc"></div>
      <div class="chartw" id="t-chart"></div>
      <div class="tabw"><div class="tabs" id="t-tabs"><button data-t="trades" class="on">Trades</button><button data-t="holders">Holders</button></div><div id="t-tabp"></div></div>
      <div class="side">
        <div class="card tradec"><div class="bd" id="t-trade"></div></div>
        <div class="sec feec"><div class="sh"><span>Fees</span><span id="t-feebadge"></span></div><div id="t-fee"></div></div>
        <div class="sec infoc"><div class="sh"><span>About</span></div><div id="t-info"></div></div>
        <div class="sec otherc"><div class="sh"><span>Details</span></div><div id="t-other"></div></div>
      </div>
    </div>`;
  $('#t-img').src = x.img; $('#t-name').textContent = x.name; $('#t-sym').textContent = '$' + x.symbol; $('#t-copy').onclick = () => APP.copy(x.addr, 'Address copied');
  CHART.mount($('#t-chart'), addr, chain);
  const ath = () => Math.max(x.mcapUsd, ...DATA.candles(addr, 3600, chain).map((b) => b.h * E.supply * APP.hypeUsd));
  function renderHead() {
    $('#t-meta').innerHTML = `<span>by</span><i>${x.creator.slice(2, 4).toUpperCase()}</i><a class="addr" href="${ex('address', x.creator)}" target="_blank" rel="noopener">${shortAddr(x.creator)}</a><span class="dot">·</span><span>${x.age} ago</span><span class="dot">·</span><img src="${C.chain.logo}" alt=""><span>${C.chain.name}</span>`;
    $('#t-links').innerHTML = `${x.links.x ? `<a href="${esc(x.links.x)}" target="_blank" rel="noopener">${ic('x')}X</a>` : ''}${x.links.tg ? `<a href="${esc(x.links.tg)}" target="_blank" rel="noopener">${ic('ext')}Telegram</a>` : ''}${x.links.web ? `<a href="${esc(x.links.web)}" target="_blank" rel="noopener">${ic('ext')}Website</a>` : ''}<a href="${ex('address', x.addr)}" target="_blank" rel="noopener">${ic('ext')}Explorer</a>`;
    const a = ath(), pct = Math.min(100, x.mcapUsd / a * 100);
    $('#t-mc').innerHTML = `<div class="px"><b>${fmtUsd(x.mcapUsd)}</b>${fmtPct(x.c24)}<small>market cap · ${fmtNum(x.mcap, 1)} HYPE</small></div><div class="st"><div><span>Price</span><b>${fmtUsd(x.byChain.hyper.pxUsd)}</b></div><div><span>Volume 24h</span><b>${fmtUsd(x.vol24 * APP.hypeUsd)}</b></div><div><span>Liquidity</span><b>${fmtUsd(x.liqHype * APP.hypeUsd)}</b></div><div><span>Holders</span><b>${x.holders}</b></div><div><span>ATH</span><b>${fmtUsd(a)}</b></div></div>`;
    const p = x.byChain[chain];
    $('#t-info').innerHTML = `<p class="desc">${esc(x.desc)}</p>
            <div class="strip"><div><span>5M</span><b class="${x.c5 >= 0 ? 'up' : 'dn'}">${fmtPct(x.c5, false)}</b></div><div><span>1H</span><b class="${x.c1 >= 0 ? 'up' : 'dn'}">${fmtPct(x.c1, false)}</b></div><div><span>24H</span><b class="${x.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(x.c24, false)}</b></div></div>
      <div class="tx"><div class="row"><span>TXNS <b>${x.buys24 + x.sells24}</b></span><span class="up">BUYS <b>${x.buys24}</b></span><span class="dn">SELLS <b>${x.sells24}</b></span></div><div class="bsb"><i style="width:${(x.buys24 / Math.max(1, x.buys24 + x.sells24) * 100).toFixed(0)}%;background:var(--up)"></i><i style="flex:1;background:var(--dn)"></i></div></div>
      <div class="tx"><div class="row"><span>VOLUME 24H <b>${fmtUsd(x.vol24 * APP.hypeUsd)}</b></span><span>ALL TIME <b>${fmtUsd(x.volAll * APP.hypeUsd)}</b></span></div></div>`;
    const ps = DATA.positions(addr, chain);
    $('#t-other').innerHTML = `<div class="kv"><span>Creator</span><b class="addr"><a href="${ex('address', x.creator)}" target="_blank" rel="noopener">${shortAddr(x.creator)}</a></b></div><div class="kv"><span>Contract</span><b class="addr"><a href="${ex('address', x.addr)}" target="_blank" rel="noopener">${x.addr}</a></b></div><div class="kv"><span>Pool</span><b class="addr">${shortAddr(p.poolId)}</b></div><div class="kv"><span>DEX</span><b>Uniswap v4 · ${C.brand} hook</b></div><div class="kv"><span>Liquidity positions</span><b>${ps.map((q) => `${q.pct}% · ${fmtNum(q.lo, 0)}→${q.hi === Infinity ? '∞' : fmtNum(q.hi, 0)} HYPE${q.active ? ' <span class="badge up">active</span>' : ''}`).join('<br>')}</b></div><div class="kv"><span>Created</span><b>${fmtDate(x.createdAt)}</b></div><div class="kv"><span>Supply</span><b>1B · 100% in pool · no mint</b></div><div class="kv"><span>Opening</span><b>${E.openMcapHype} HYPE market cap</b></div><div class="kv"><span>Buyback</span><b>${x.buyback ? '50% of creator share, 5y vest' : 'off'}</b></div><div class="kv"><span>Top holder</span><b>${(DATA.holders(addr).find((h) => !h.pool)?.share || 0).toFixed(2)}%</b></div>`;
  }
  function renderFee() {
    const f = DATA.feeState(addr, chain), el = $('#t-fee'), bg = $('#t-feebadge'); if (!f) return;
    const base = E.feeBps / 100, cr = base * E.creatorShareBps / 10000, pr = base - cr, ct = x.creatorTaxBps / 100, tot = f.total / 100, extra = tot - base - ct;
    const seg = (v, col) => v > 0 ? `<i style="width:${(v / tot * 100).toFixed(1)}%;background:${col}"></i>` : '';
    bg.innerHTML = f.kind === 'snipe' ? `<span class="badge dn"><i class="live"></i>Snipe window</span>` : f.kind === 'vol' ? `<span class="badge warn"><i class="live"></i>Volatility fee</span>` : `<span class="badge up">Base fee</span>`;
    el.innerHTML = `<div class="sb"><div><span class="lab">Fee on every swap</span><div class="big ${f.kind === 'snipe' ? 'dn' : ''}" ${f.kind === 'vol' ? 'style="color:var(--warn)"' : ''}>${tot.toFixed(tot % 1 ? 2 : 0)}%</div></div><div class="right"><span class="lab">Creator earns</span><div style="font-weight:700;font-size:16px" class="ac">${(cr + ct + extra * E.creatorShareBps / 10000).toFixed(2)}%</div></div></div>
      <div class="split">${seg(cr, 'var(--mint)')}${seg(ct, 'var(--mint-2)')}${seg(pr, '#35464c')}${seg(extra, f.kind === 'snipe' ? 'var(--dn)' : 'var(--warn)')}</div>
      <div class="leg"><div><em style="background:var(--mint)"></em>Creator · 70% of the ${base}% base<b>${cr.toFixed(2)}%</b></div>${ct ? `<div><em style="background:var(--mint-2)"></em>Creator fee · all to the creator<b>${ct.toFixed(2)}%</b></div>` : ''}<div><em style="background:#35464c"></em>Protocol · 30% of the base<b>${pr.toFixed(2)}%</b></div>${extra > 0 ? `<div><em style="background:${f.kind === 'snipe' ? 'var(--dn)' : 'var(--warn)'}"></em>${f.kind === 'snipe' ? 'Snipe tax · 70/30 split' : 'Volatility fee · 70/30 split'}<b>${extra.toFixed(2)}%</b></div>` : ''}</div>
      ${f.kind === 'snipe' ? `<div class="live"><span>${f.left}s left</span><div class="bar dn"><i style="width:${(f.left / E.snipeSeconds) * 100}%"></i></div><span>99% → 0 in ${E.snipeSeconds}s</span></div>` : f.kind === 'vol' ? `<div class="live"><span>${f.left}s left</span><div class="bar warn"><i style="width:${(f.left / E.volDecaySec) * 100}%"></i></div><span>back to ${(f.bps / 100).toFixed(1)}%</span></div>` : `<div class="live">Rises to ${E.volPeakBps / 100}% for ${E.volDecaySec / 60} minutes after a ${E.volThresholdBps / 100}% move in ${E.volWindowSec}s. Fixed at launch; nobody can change it.</div>`}`;
  }
  function renderTrade() {
    const el = $('#t-trade'), me = APP.W.connected ? APP.W.address : '', bal = DATA.balance(addr, chain, me), hbal = me ? DATA.hypeBalance(chain) : 0, p = x.byChain[chain];
    const v = parseFloat(amt) || 0; const q = side === 'buy' ? DATA.quoteBuy(addr, chain, v) : DATA.quoteSell(addr, chain, v);
    el.innerHTML = `<div class="bs"><button class="btn up ${side === 'buy' ? 'on' : ''}" data-s="buy">Buy</button><button class="btn dn ${side === 'sell' ? 'on' : ''}" data-s="sell">Sell</button></div>
      <label class="lab" style="display:flex;justify-content:space-between"><span>${side === 'buy' ? 'You pay' : 'You sell'}</span><span>${me ? `Balance ${side === 'buy' ? `${fmtNum(hbal, 3)} HYPE` : `${fmtNum(bal, 0)} ${esc(x.symbol)}`}` : 'Not connected'}</span></label>
      <div class="ipw" style="margin-top:6px"><input class="inp" id="t-amt" inputmode="decimal" placeholder="0" value="${esc(amt)}" autocomplete="off"><span class="suf">${side === 'buy' ? 'HYPE' : esc(x.symbol)}</span></div>
      <div class="qs">${(side === 'buy' ? [['0.1', 0.1], ['0.5', 0.5], ['1', 1], ['5', 5]] : [['25%', 0.25], ['50%', 0.5], ['75%', 0.75], ['100%', 1]]).map(([l, v2]) => `<button data-q="${v2}">${l}${side === 'buy' ? ' HYPE' : ''}</button>`).join('')}</div>
      <div class="q">${v > 0 ? `<div class="kvl"><span>You get (min)</span><b>${side === 'buy' ? `${fmtNum(q.tokens * (1 - slip / 100), 0)} ${esc(x.symbol)}` : fmtHype(q.hype * (1 - slip / 100), 4)}</b></div><div class="kvl"><span>Fee ${(q.feeBps / 100).toFixed(2)}%${q.snipe ? ' incl. snipe tax' : ''}</span><b>${fmtHype(q.fee + (q.snipe || 0), 4)}</b></div><div class="kvl"><span>Price impact</span><b class="${Math.abs(q.impact) > 5 ? 'dn' : ''}">${q.impact > 0 ? '+' : ''}${q.impact.toFixed(2)}%</b></div>` : `<div class="kvl"><span>Price</span><b>${fmtPrice(p.px)} HYPE · ${fmtUsd(p.pxUsd)}</b></div>`}<div class="kvl"><span>Slippage</span><b><span class="seg" id="t-slip">${[1, 3, 10].map((s) => `<button class="${slip === s ? 'on' : ''}" data-sl="${s}">${s}%</button>`).join('')}</span></b></div></div>
      <button class="btn w go ${side === 'buy' ? 'up on' : 'dn on'}" id="t-go"></button><p class="hint" style="margin-top:10px">Uniswap v4 pool on HyperEVM with the ${esc(C.brand)} hook, paired with native HYPE. Liquidity locked for good.</p>`;
    $$('[data-s]', el).forEach((b) => b.onclick = () => { side = b.dataset.s; amt = ''; renderTrade(); });
    $$('[data-q]', el).forEach((b) => b.onclick = () => { const k = +b.dataset.q; amt = side === 'buy' ? String(k) : String(bal * k); renderTrade(); });
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
    if (tab === 'trades') { const trs = DATA.trades(addr, chain).slice(0, 50); el.innerHTML = `<div class="tblc tscroll"><table class="tbl"><thead><tr><th>Time</th><th>Type</th><th class="r">HYPE</th><th class="r">${esc(x.symbol)}</th><th class="r hm">Price</th><th>Wallet</th><th class="r">Tx</th></tr></thead><tbody>${trs.map((t) => `<tr><td style="color:var(--fg-3)">${ago(t.ts)} ago</td><td class="${t.buy ? 'up' : 'dn'}" style="font-weight:600">${t.buy ? 'Buy' : 'Sell'}${t.snipeBps ? ` <span class="badge dn">snipe</span>` : ''}${t.volBps ? ` <span class="badge warn">vol</span>` : ''}</td><td class="r">${fmtNum(t.hype, 3)}</td><td class="r">${fmtNum(t.tokens, 0)}</td><td class="r hm">${fmtUsd(t.px * APP.hypeUsd)}</td><td><a href="${ex('address', t.wallet)}" target="_blank" rel="noopener" class="addr">${t.wallet === x.creator ? '<span class="badge ac">creator</span>' : shortAddr(t.wallet)}</a></td><td class="r"><a href="${ex('tx', t.tx)}" target="_blank" rel="noopener" class="addr">${t.tx.slice(0, 6)}…</a></td></tr>`).join('') || `<tr><td colspan="7" class="empty">No trades yet</td></tr>`}</tbody></table></div>`; }
    if (tab === 'holders') { const hs = DATA.holders(addr, chain).slice(0, 50); el.innerHTML = `<div class="tblc tscroll"><table class="tbl"><thead><tr><th>#</th><th>Wallet</th><th class="r">Balance</th><th class="r">Share</th></tr></thead><tbody>${hs.map((h, i) => `<tr><td style="color:var(--fg-3)">${i + 1}</td><td>${h.pool ? `<span class="badge ac">${ic('lock')}${esc(h.wallet)}</span>` : `<a class="addr" href="${ex('address', h.wallet)}" target="_blank" rel="noopener">${shortAddr(h.wallet)}</a>${h.creator ? ' <span class="badge ac">creator</span>' : ''}`}</td><td class="r">${fmtNum(h.bal, 0)}</td><td class="r">${h.share.toFixed(2)}%</td></tr>`).join('')}</tbody></table></div>`; }
  }
  $$('#t-tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.t; renderTab(); });
  function renderAll() { x = DATA.token(addr) || x; renderHead(); renderFee(); renderTrade(); renderTab(); CHART.update(); }
  renderAll(); APP.onUpdate(() => { x = DATA.token(addr) || x; renderHead(); renderFee(); if (!busy && document.activeElement !== $('#t-amt')) renderTrade(); renderTab(); CHART.update(); }); APP.onWallet(renderTrade);
  setInterval(renderFee, 1000);
};
