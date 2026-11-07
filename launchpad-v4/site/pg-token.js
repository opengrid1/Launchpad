/* Token page: header (back, identity, market cap figure), chart section with the price figure and controls, facts,
   contract row, about, Trades/Holders; a sticky trade panel and a fee card; a bottom dock on mobile. */
window.PAGE = async () => {
  const { $, $$, esc, ic, fmtNum, fmtUsd, fmtHype, fmtPrice, fmtPct, shortAddr, ago, fmtDate, toast, errMsg } = APP, C = CFG, E = C.econ;
  const addr = APP.pathAddr(); let x = DATA.token(addr);
  if (!x && /^0x[0-9a-fA-F]{40}$/.test(addr || '')) { $('#pg-token').innerHTML = '<div class="empty">Loading the coin…</div>'; x = await DATA.find(addr); }
  if (x && x.net && x.net !== C.chain.key) await APP.setChain(x.net, false); // the token's chain: wallet, explorer and gas follow it
  const root = $('#pg-token'); if (!x) { root.innerHTML = `<div class="empty">No coin at this address.<br><a class="ac" href="/">Back home</a></div>`; return; }
  document.title = `${x.name} ($${x.symbol}) | ${C.brand}`;
  const chain = 'hyper'; let side = 'buy', tab = 'trades', amt = '', slip = 1, busy = false;
  // leverage (chains with a margin contract): mode 'lev' swaps the panel for a long at 1.5x to 3x funded by the coin's pool
  const LEVON = DATA.lev && DATA.lev.on(x.net); let mode = DATA.demo && LEVON ? 'lev' : 'market', lev = 2, levInfo = null, myPos = [], levBusy = false;
  async function loadLev(fresh) {
    if (!LEVON) return; try { levInfo = await DATA.lev.info(addr); const me = APP.W.connected ? APP.W.address : DATA.demo ? 'preview' : ''; myPos = me ? (await DATA.lev.positions(me, fresh)).filter((p) => p.token === x.addr) : []; } catch (e) { console.warn('leverage', e.message); }
    if (mode === 'lev' && !(document.activeElement && document.activeElement.id === 't-amt')) renderTrade();
  }
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
  $('#t-img').src = x.img; $('#t-img').dataset.sym = x.symbol; $('#t-img').dataset.addr = x.addr; $('#t-name').textContent = x.name; $('#t-name').insertAdjacentHTML('beforeend', APP.ofc(x)); $('#t-sym').textContent = x.symbol;
  let host = null; // when set, the trade panel renders inside the mobile sheet
  function openSheet(s) { side = s; amt = ''; const ov = document.createElement('div'); ov.className = 'shov'; ov.innerHTML = `<div class="shc" role="dialog" aria-modal="true"><div class="shh"><p>${esc(x.symbol)}</p><h2 id="sh-h2"></h2></div><div class="shb"><p class="venue">Trades on the Uniswap v4 pool.</p><div id="sh-trade"></div></div></div>`; ov.onclick = (e) => { if (e.target === ov) closeSheet(); }; document.body.appendChild(ov); document.body.style.overflow = 'hidden'; host = $('#sh-trade', ov); renderTrade(); }
  function closeSheet() { const ov = $('.shov'); if (ov) ov.remove(); document.body.style.overflow = ''; host = null; renderTrade(); }
  $$('.dock [data-ms]').forEach((b) => b.onclick = () => openSheet(b.dataset.ms));
  CHART.mount($('#t-chart'), addr, chain, $('#t-ctl'));
  function renderHead() {
    const p = x.byChain[chain];
    $('#t-meta').innerHTML = `<span class="cr">by <a href="${ex('address', x.creator)}" target="_blank" rel="noopener">${APP.cmark(x.creator)}${shortAddr(x.creator)}</a></span><time>${x.age} ago</time><span>${esc(x.pairSym || C.chain.quote)} pair · ${esc(x.chainName || C.chain.name)}${x.v === 2 ? ' · v2' : ''}</span>${x.levMax ? `<span class="lvb" title="Long it up to ${x.levMax}x">Leverage ${x.levMax}x</span>` : ''}<button class="ia" id="t-copy" title="Copy address">${shortAddr(x.addr)}${ic('copy')}</button><a class="ia" href="${ex('address', x.addr)}" target="_blank" rel="noopener" title="Explorer">${ic('ext')}</a>${x.links.web ? `<a class="ia ic" href="${esc(x.links.web)}" target="_blank" rel="noopener" title="Website">${ic('globe')}</a>` : ''}${x.links.x ? `<a class="ia ic" href="${esc(x.links.x)}" target="_blank" rel="noopener" title="X">${ic('xl')}</a>` : ''}${x.links.tg ? `<a class="ia ic" href="${esc(x.links.tg)}" target="_blank" rel="noopener" title="Telegram">${ic('tg')}</a>` : ''}`;
    $('#t-copy').onclick = () => APP.copy(x.addr, 'Address copied');
    $('#t-mcb').textContent = fmtUsd(x.mcapUsd); $('#t-pxb').innerHTML = `${fmtUsd(p.pxUsd)} price`; $('#t-mpx').innerHTML = fmtUsd(p.pxUsd);
    $('#t-px').innerHTML = `<b>${fmtUsd(p.pxUsd)}</b><span><em class="${x.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(x.c24, false)} 24h</em> · ${fmtPrice(p.px)} ${C.chain.quote}</span>`;
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
    if (mode === 'lev') return renderLev(el, me, hbal);
    el.innerHTML = `<div class="seg bs" style="margin-top:0"><button class="on" data-m="market">Market</button>${LEVON ? '<button data-m="lev">Leverage</button>' : '<button data-m="limit">Limit</button>'}</div><div class="seg bs" style="margin-top:20px"><button class="${side === 'buy' ? 'on' : ''}" data-s="buy">Buy</button><button class="${side === 'sell' ? 'on' : ''}" data-s="sell">Sell</button></div>
      <div class="fld" style="margin-top:20px"><div class="fh"><label for="t-amt">${side === 'buy' ? 'Pay' : 'Sell'}</label><span>${me ? `${side === 'buy' ? fmtNum(hbal, 3) + ' ' + C.chain.quote : fmtNum(bal, 0) + ' ' + esc(x.symbol)}` : ''}</span></div><div class="fin"><input id="t-amt" inputmode="decimal" placeholder="0" value="${esc(amt)}" autocomplete="off"><b>${side === 'buy' ? C.chain.quote : esc(x.symbol)}</b></div><div class="frac">${quick.map(([l, v2]) => `<button data-q="${v2}" ${me ? '' : 'disabled'}>${l}</button>`).join('')}</div></div>
      <div class="out" style="margin-top:20px"><span>You receive</span><b>${v > 0 ? (side === 'buy' ? `${fmtNum(q.tokens * (1 - slip / 100), 0)}<small>${esc(x.symbol)}</small>` : `${fmtNum(q.hype * (1 - slip / 100), 4)}<small>${C.chain.quote}</small>`) : `0<small>${side === 'buy' ? esc(x.symbol) : C.chain.quote}</small>`}</b></div>
      <details style="margin-top:20px"><summary><span>Slippage ${slip.toFixed(1)} %</span>${ic('chevr').replace('<svg', '<svg style="transform:rotate(90deg)"')}</summary><div class="slp">${[0.5, 1, 3].map((s) => `<button class="${slip === s ? 'on' : ''}" data-sl="${s}">${s.toFixed(1)} %</button>`).join('')}</div>${v > 0 ? `<div class="q"><div class="kvl"><span>Fee ${(q.feeBps / 100).toFixed(2)}%${q.snipe ? ' incl. snipe tax' : ''}</span><b>${fmtHype(q.fee + (q.snipe || 0), 4)}</b></div><div class="kvl"><span>Price impact</span><b class="${Math.abs(q.impact) > 5 ? 'dn' : ''}">${q.impact > 0 ? '+' : ''}${q.impact.toFixed(2)}%</b></div></div>` : ''}</details>
      <button class="btn w pri go" id="t-go" style="margin-top:0"></button>`;
    $$('[data-s]', el).forEach((b) => b.onclick = () => { side = b.dataset.s; amt = ''; renderTrade(); }); $$('[data-m="limit"]', el).forEach((b) => b.onclick = () => toast('Limit orders are not available yet', 'info'));
    $$('[data-m="lev"]', el).forEach((b) => b.onclick = () => { mode = 'lev'; amt = ''; renderTrade(); loadLev(true); });
    $$('[data-q]', el).forEach((b) => b.onclick = () => { const k = +b.dataset.q; amt = k > 0 ? String(+k.toFixed(6)) : ''; renderTrade(); });
    $$('[data-sl]', el).forEach((b) => b.onclick = (e) => { e.preventDefault(); slip = +b.dataset.sl; const open = $('details', el).open; renderTrade(); $('details', host || $('#t-trade')).open = open; });
    const inp = $('#t-amt', el); inp.oninput = () => { amt = inp.value; const pos = inp.selectionStart; const d = $('details', el).open; renderTrade(); const h = host || $('#t-trade'); const n = $('#t-amt', h); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} $('details', h).open = d; };
    const go = $('#t-go', el);
    if (busy) { go.disabled = true; go.textContent = 'Confirm in your wallet…'; return; }
    if (!me) { go.textContent = 'Sign in'; go.onclick = () => APP.W.connect(); return; }
    if (!APP.W.chainOk) { go.textContent = 'Switch to ' + C.chain.name; go.onclick = () => APP.W.switchChain().catch((e) => toast(errMsg(e), 'err')); return; }
    go.textContent = side === 'buy' ? 'Buy' : 'Sell'; go.disabled = !(v > 0);
    go.onclick = async () => { busy = true; renderTrade(); try { const r = side === 'buy' ? await DATA.buy(addr, chain, v, q.tokens * (1 - slip / 100)) : await DATA.sell(addr, chain, v, q.hype * (1 - slip / 100)); toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${fmtNum(r.tokens, 0)} ${x.symbol} for ${fmtNum(r.hype, 4)} ${C.chain.quote}`, 'ok'); amt = ''; if (host) closeSheet(); } catch (e) { toast(errMsg(e), 'err'); } busy = false; renderAll(); };
  }
  // the leverage panel: pick 1.5x to 3x, put up ETH margin; the coin's pool lends the rest; below it, this coin's positions
  function renderLev(el, me, hbal) {
    const I = levInfo, levs = [1.5, 2, 3].filter((l) => !I || l <= I.maxLev), v = parseFloat(amt) || 0, size = v * lev, q = DATA.quoteBuy(addr, chain, size);
    const maxM = I ? Math.max(0, Math.min(I.max[lev] || 0, hbal || Infinity)) : 0, px = x.byChain[chain].px, fee = (x.feeBps + x.creatorTaxBps) / 1e4;
    const debt = v * (lev - 1), liqPx = q.tokens > 0 && I ? debt / (q.tokens * (1 - I.maint) * (1 - fee)) : 0, drop = px > 0 && liqPx > 0 ? (1 - liqPx / px) * 100 : 0;
    const posHtml = myPos.length ? `<div class="levpos"><div class="lh"><b>Your positions</b><span>${myPos.length}</span></div>${myPos.map((p) => `<div class="lp${p.liq ? ' warn' : ''}"><div class="l1"><b>${p.lev}x long</b><span class="${p.pnl >= 0 ? 'up' : 'dn'}">${p.pnl >= 0 ? '+' : ''}${fmtNum(p.pnl, 4)} ${C.chain.quote} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%)</span></div>
        <div class="l2"><span>Value ${fmtNum(p.value, 4)}</span><span>Debt ${fmtNum(p.debt, 4)}</span><span>Liq. ${fmtUsd(p.liqPx * APP.hypeUsd)}</span></div>
        <div class="bar ${p.health < 0.15 ? 'dn' : p.health < 0.3 ? 'warn' : ''}"><i style="width:${(p.health * 100).toFixed(0)}%"></i></div>${p.liq ? `<p class="lw">${p.flagged ? 'Flagged for liquidation. Add margin now to keep it.' : 'Past the liquidation level. Add margin or close.'}</p>` : ''}
        <div class="la"><button class="btn sm" data-add="${p.id}" ${levBusy ? 'disabled' : ''}>Add margin</button><button class="btn sm" data-close="${p.id}" ${levBusy ? 'disabled' : ''}>Close</button></div></div>`).join('')}</div>` : '';
    el.innerHTML = `<div class="seg bs" style="margin-top:0"><button data-m="market">Market</button><button class="on" data-m="lev">Leverage</button></div>
      ${!I ? '<p class="hint" style="margin-top:20px">Loading leverage terms…</p>' : !I.ok ? `<p class="hint" style="margin-top:20px">${esc(I.why)}</p>` : `
      <div class="seg bs" style="margin-top:20px">${levs.map((l) => `<button class="${lev === l ? 'on' : ''}" data-lev="${l}">${l}x</button>`).join('')}</div>
      <div class="fld" style="margin-top:20px"><div class="fh"><label for="t-amt">Margin</label><span>${me ? fmtNum(hbal, 3) + ' ' + C.chain.quote : ''}</span></div><div class="fin"><input id="t-amt" inputmode="decimal" placeholder="0" value="${esc(amt)}" autocomplete="off"><b>${C.chain.quote}</b></div><div class="frac">${[['25%', maxM * 0.25], ['50%', maxM * 0.5], ['Max', maxM]].map(([l, k]) => `<button data-q="${k}" ${me && maxM > 0 ? '' : 'disabled'}>${l}</button>`).join('')}</div></div>
      <div class="q" style="margin-top:16px"><div class="kvl"><span>Position size</span><b>${fmtNum(size, 4)} ${C.chain.quote}</b></div><div class="kvl"><span>Borrowed from the pool</span><b>${fmtNum(debt, 4)} ${C.chain.quote}</b></div><div class="kvl"><span>You hold</span><b>${fmtNum(q.tokens, 0)} ${esc(x.symbol)}</b></div>
        <div class="kvl"><span>Liquidation price</span><b class="${v > 0 && drop < 20 ? 'dn' : ''}">${v > 0 ? `${fmtUsd(liqPx * APP.hypeUsd)} (−${drop.toFixed(1)}%)` : '–'}</b></div><div class="kvl"><span>Borrow fee (one time)</span><b>${I.borrowFee}%${debt > 0 ? ` · ${fmtNum(debt * I.borrowFee / 100, 5)} ${C.chain.quote}` : ''}</b></div><div class="kvl"><span>Largest margin now</span><b>${fmtNum(I.max[lev] || 0, 4)} ${C.chain.quote}</b></div></div>
      <p class="hint" style="margin-top:12px">Liquidation sells the coins back into the pool if the price stays below that level for 15 seconds; the margin is lost.</p>
      <button class="btn w pri go" id="t-go" style="margin-top:16px"></button>`}${posHtml}`;
    $$('[data-m="market"]', el).forEach((b) => b.onclick = () => { mode = 'market'; amt = ''; renderTrade(); });
    $$('[data-lev]', el).forEach((b) => b.onclick = () => { lev = +b.dataset.lev; renderTrade(); });
    $$('[data-q]', el).forEach((b) => b.onclick = () => { const k = +b.dataset.q; amt = k > 0 ? String(Math.floor(k * 1e6) / 1e6) : ''; renderTrade(); });
    const inp = $('#t-amt', el); if (inp) inp.oninput = () => { amt = inp.value; const pos = inp.selectionStart; renderTrade(); const n = $('#t-amt', host || $('#t-trade')); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } };
    $$('[data-close]', el).forEach((b) => b.onclick = async () => { const p = myPos.find((y) => y.id === +b.dataset.close); if (!p) return; levBusy = true; renderTrade(); try { await DATA.lev.close(p.id, Math.max(0, p.equity * 0.9)); toast(`Closed the ${p.lev}x position`, 'ok'); } catch (e) { toast(errMsg(e), 'err'); } levBusy = false; await loadLev(true); renderAll(); });
    $$('[data-add]', el).forEach((b) => b.onclick = () => { const p = myPos.find((y) => y.id === +b.dataset.add); if (!p) return;
      const ov = APP.dialog('Add margin', `<div style="display:flex;flex-direction:column;gap:16px"><p style="font-size:15px;line-height:20px;color:var(--ink-80)">Pays down the position's ${fmtNum(p.debt, 4)} ${C.chain.quote} debt, which moves its liquidation price down.</p><div class="fin"><input id="am-v" inputmode="decimal" placeholder="0" autocomplete="off"><b>${C.chain.quote}</b></div><div class="row-end"><button class="btn sm" data-x>Cancel</button><button class="btn sm pri" id="am-go">Add</button></div></div>`);
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) ov.remove(); });
      $('#am-go', ov).onclick = async () => { const a = parseFloat($('#am-v', ov).value) || 0; if (!(a > 0)) return; ov.remove(); levBusy = true; renderTrade(); try { await DATA.lev.addMargin(p.id, a); toast('Margin added', 'ok'); } catch (e) { toast(errMsg(e), 'err'); } levBusy = false; loadLev(true); }; });
    const go = $('#t-go', el); if (!go) return;
    if (levBusy || busy) { go.disabled = true; go.textContent = 'Confirm in your wallet…'; return; }
    if (!me) { go.textContent = 'Sign in'; go.onclick = () => APP.W.connect(); return; }
    if (!APP.W.chainOk) { go.textContent = 'Switch to ' + C.chain.name; go.onclick = () => APP.W.switchChain().catch((e) => toast(errMsg(e), 'err')); return; }
    const tooBig = v > (I.max[lev] || 0) * 1.0001, tooSmall = v > 0 && v < I.minMargin;
    go.textContent = tooBig ? 'Above the largest margin now' : tooSmall ? `Minimum margin ${I.minMargin} ${C.chain.quote}` : `Open ${lev}x long`; go.disabled = !(v > 0) || tooBig || tooSmall;
    go.onclick = async () => { levBusy = true; renderTrade(); try { await DATA.lev.open(addr, lev, v, q.tokens * (1 - Math.max(slip, 3) / 100)); toast(`Opened a ${lev}x long on ${x.symbol}`, 'ok'); amt = ''; } catch (e) { toast(errMsg(e), 'err'); } levBusy = false; await loadLev(true); renderAll(); };
  }
  const arrow = (up) => `<svg viewBox="0 0 24 24" fill="none" stroke="${up ? '#16b364' : '#ef4444'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${up ? '<path d="M7 17L17 7M9 7h8v8"/>' : '<path d="M7 7l10 10M17 9v8H9"/>'}</svg>`;
  function renderTab() {
    const el = $('#t-tabp'); $$('#t-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'trades') { const trs = DATA.trades(addr, chain).slice(0, 50); el.innerHTML = `<div class="tscroll"><table class="tbl"><thead><tr><th>Side</th><th>Trader</th><th class="r">${C.chain.quote}</th><th class="r">${esc(x.symbol)}</th><th class="r hm">Price</th><th class="r">Age</th></tr></thead><tbody>${trs.map((t) => `<tr><td><span class="side">${arrow(t.buy)}${t.buy ? 'Buy' : 'Sell'}</span>${t.snipeBps ? ` <span class="badge dn sm">snipe</span>` : ''}${t.volBps ? ` <span class="badge warn sm">vol</span>` : ''}</td><td><a class="who" href="${ex('tx', t.tx)}" target="_blank" rel="noopener">${APP.cmark(t.wallet)}${t.wallet === x.creator ? 'creator' : shortAddr(t.wallet)}${ic('ext')}</a></td><td class="r">${fmtNum(t.hype, 3)}</td><td class="r">${fmtNum(t.tokens, 0)}</td><td class="r hm">${fmtUsd(t.px * APP.hypeUsd)}</td><td class="r">${ago(t.ts)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">No trades yet</td></tr>`}</tbody></table></div>`; }
    if (tab === 'holders') { const hs = DATA.holders(addr, chain).slice(0, 50); el.innerHTML = `<div class="tscroll"><table class="tbl"><thead><tr><th>#</th><th>Holder</th><th class="r">Balance</th><th class="r">Share</th></tr></thead><tbody>${hs.map((h, i) => `<tr><td class="muted">${i + 1}</td><td>${h.pool ? `<span class="badge ac sm">${esc(h.wallet)}</span>` : `<a class="who" href="${ex('address', h.wallet)}" target="_blank" rel="noopener">${APP.cmark(h.wallet)}${shortAddr(h.wallet)}</a>${h.creator ? ' <span class="badge ac sm">creator</span>' : ''}`}</td><td class="r">${fmtNum(h.bal, 0)}</td><td class="r">${h.share.toFixed(2)}%</td></tr>`).join('')}</tbody></table></div>`; }
  }
  $$('#t-tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.t; renderTab(); });
  function renderAll() { x = DATA.token(addr) || x; renderHead(); renderFee(); renderTrade(); renderTab(); CHART.update(); }
  renderAll(); if (LEVON) { loadLev(); setInterval(() => { if (!document.hidden && mode === 'lev') loadLev(); }, 8000); APP.onWallet(() => loadLev(true)); }
  APP.onUpdate(() => { x = DATA.token(addr) || x; renderHead(); renderFee(); if (!busy && !(document.activeElement && document.activeElement.id === 't-amt')) renderTrade(); renderTab(); CHART.update(); }); APP.onWallet(renderTrade);
  setInterval(renderFee, 1000);
};
