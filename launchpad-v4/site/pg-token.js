/* Token page, laid out like clanker.world: back, header, chain row, stats, chart, fee strip, trade card, then
   uppercase-labelled sections (token info, pool & liquidity, about, tokenomics) and tabs for trades and holders. */
window.PAGE = async () => {
  const { $, $$, esc, ic, fmtNum, fmtUsd, fmtHype, fmtPrice, fmtPct, shortAddr, ago, fmtDate, toast, errMsg } = APP, C = CFG, E = C.econ;
  const addr = APP.pathAddr(); let x = DATA.token(addr);
  const root = $('#pg-token'); if (!x) { root.innerHTML = `<div class="empty">No coin at this address.<br><a class="ac" href="/">Back home</a></div>`; return; }
  document.title = `${x.name} ($${x.symbol}) | ${C.brand}`;
  let chain = 'hyper', side = 'buy', tab = 'trades', amt = '', slip = 3, busy = false;
  const ex = (c, kind, v) => `${C.chainOf(c).explorer}/${kind}/${v}`;
  root.innerHTML = `
    <a class="back" href="/">${ic('chevr').replace('<svg', '<svg style="transform:rotate(180deg)"')}Back</a>
    <div class="head"><img class="av" id="t-img" alt=""><div style="min-width:0;flex:1"><h1><span id="t-name"></span><small id="t-sym"></small></h1><div class="meta" id="t-meta"></div></div></div>
    <div class="chainrow" id="t-chainrow"></div>
    <div class="stats" id="t-stats"></div>
    <div class="grid">
      <div id="t-chart"></div>
      <div class="fee" id="t-fee"></div>
      <div class="trade" id="trade"><div class="bd" id="t-trade"></div></div>
      <div>
        <div class="sec-c"><div class="lbl">${ic('info')}Token info</div><div class="info" id="t-info"></div></div>
        <div class="sec-c"><div class="lbl">${ic('lock')}Pool &amp; liquidity</div><div id="t-pool"></div></div>
        <div class="sec-c"><div class="lbl">${ic('book')}About ${esc(x.name)}</div><p class="about">${esc(x.desc)}</p></div>
        <div class="sec-c"><div class="lbl">${ic('zap')}Tokenomics</div><div id="t-nomics"></div></div>
        <div class="tabwrap"><div class="tabs" id="t-tabs"><button data-t="trades" class="on">Trades</button><button data-t="holders">Holders</button></div><div class="tabp" id="t-tabp"></div></div>
      </div>
    </div>`;
  $('#t-img').src = x.img; $('#t-name').textContent = x.name; $('#t-sym').textContent = '$' + x.symbol;
  CHART.mount($('#t-chart'), addr, chain); CHART.onChain = (c) => { chain = c; renderAll(); };
  function renderHead() {
    const p = x.byChain[chain] || x.byChain.hyper;
    $('#t-meta').innerHTML = `<span class="addr">${shortAddr(chain === 'sol' ? x.mint : x.addr)}</span><button data-copy="${chain === 'sol' ? x.mint : x.addr}" title="Copy">${ic('copy')}</button><a href="${ex('hyper', 'address', x.creator)}" target="_blank" rel="noopener">by ${shortAddr(x.creator)}</a><span>· ${x.age} ago</span>${x.links.x ? `<a href="${esc(x.links.x)}" target="_blank" rel="noopener">X</a>` : ''}${x.links.tg ? `<a href="${esc(x.links.tg)}" target="_blank" rel="noopener">Telegram</a>` : ''}${x.links.web ? `<a href="${esc(x.links.web)}" target="_blank" rel="noopener">Website</a>` : ''}`;
    $$('#t-meta [data-copy]').forEach((b) => b.onclick = () => APP.copy(b.dataset.copy, 'Address copied'));
    $('#t-chainrow').innerHTML = x.chains.map((c) => `<button data-c="${c}" style="display:inline-flex;align-items:center;gap:6px;${c === chain ? '' : 'color:var(--fg-3)'}"><img src="${C.chainOf(c).logo}" alt="">${C.chainOf(c).name}</button>`).join('<span class="sep">|</span>') + `<span class="badge teal">${ic('lock')}LP locked</span>`;
    $$('#t-chainrow [data-c]').forEach((b) => b.onclick = () => { chain = b.dataset.c; CHART.mount($('#t-chart'), addr, chain); renderAll(); });
    $('#t-stats').innerHTML = `<div><b>${fmtUsd(x.mcapUsd)}</b> <span class="${x.c24 >= 0 ? 'up' : 'dn'}">(${fmtPct(x.c24, false)})</span> <span>mcap</span></div><div><b>${fmtUsd(x.vol24 * APP.hypeUsd)}</b> <span>24h vol</span></div><div><b>${fmtUsd(x.liqHype * APP.hypeUsd)}</b> <span>liquidity</span></div><div><b>${x.holders}</b> <span>holders</span></div>`;
    $('#t-info').innerHTML = `<div class="kv"><span>Platform</span><b>${esc(C.brand)}</b></div><div class="kv"><span>Chains</span><b>${x.chains.map((c) => C.chainOf(c).name).join(' · ')}</b></div><div class="kv"><span>Contract (HyperEVM)</span><b><a class="addr" href="${ex('hyper', 'address', x.addr)}" target="_blank" rel="noopener">${x.addr}</a></b></div>${x.chains.includes('sol') ? `<div class="kv"><span>Mint (Solana)</span><b><a class="addr" href="${ex('sol', 'token', x.mint)}" target="_blank" rel="noopener">${x.mint}</a></b></div>` : ''}<div class="kv"><span>Creator</span><b><a class="addr" href="${ex('hyper', 'address', x.creator)}" target="_blank" rel="noopener">${shortAddr(x.creator)}</a></b></div><div class="kv"><span>Deployed</span><b style="font-family:var(--sans);font-size:15px">${fmtDate(x.createdAt)}</b></div>`;
    $('#t-pool').innerHTML = x.chains.map((c) => { const q = x.byChain[c], ps = DATA.positions(addr, c); return `<div class="kv"><span>${C.chainOf(c).name} pool</span><b class="addr">${shortAddr(q.poolId)}</b></div><div class="kv"><span>DEX</span><b>${c === 'sol' ? 'Meteora DAMM v2' : 'Uniswap v4 · hook'}</b></div><div class="kv"><span>Liquidity</span><b>${fmtNum(q.liqHype, 2)} HYPE · ${fmtUsd(q.liqHype * APP.hypeUsd)}</b></div><div class="kv"><span>Volume (24h)</span><b>${fmtUsd(q.vol24 * APP.hypeUsd)}</b></div><div class="kv"><span>Positions</span><b>${ps.map((p) => p.kind ? 'full range, locked' : `#${p.id} ${p.pct}% · ${fmtNum(p.lo, 0)}→${p.hi === Infinity ? '∞' : fmtNum(p.hi, 0)} HYPE mcap`).join('<br>')}</b></div>`; }).join('');
    $('#t-nomics').innerHTML = `<div class="kv"><span>Supply</span><b>1B per chain, 100% in pool</b></div><div class="kv"><span>Opening</span><b>50 HYPE mcap per chain</b></div><div class="kv"><span>Fees</span><b>1% static · 70% creator</b></div><div class="kv"><span>Creator fee</span><b>${x.creatorTaxBps ? `+${x.creatorTaxBps / 100}%` : 'none'}</b></div><div class="kv"><span>Buyback</span><b>${x.buyback ? '50% of creator share, 5y vest' : 'off'}</b></div><div class="kv"><span>Sniper tax</span><b>99% → 0% over 10 s</b></div><div class="kv"><span>Volatility fee</span><b>3% for 2 min after a 10% move</b></div><div class="kv"><span>Top holder</span><b>${(DATA.holders(addr).find((h) => !h.pool)?.share || 0).toFixed(2)}%</b></div><div class="kv"><span>Warnings</span><b class="up">No issues</b></div>`;
  }
  function renderFee() {
    const f = DATA.feeState(addr, chain), el = $('#t-fee'); if (!f) return;
    if (f.kind === 'snipe') el.innerHTML = `<span class="badge dn"><i class="live"></i>Snipe window</span><span class="big dn">${(f.total / 100).toFixed(1)}%</span><div class="bar dn"><i style="width:${(f.left / E.snipeSeconds) * 100}%"></i></div><small>${f.left}s left · tax on buys starts at 99% and reaches 0 in ${E.snipeSeconds}s · creator exempt</small>`;
    else if (f.kind === 'vol') el.innerHTML = `<span class="badge warn"><i class="live"></i>Volatility fee</span><span class="big" style="color:var(--warn)">${(f.total / 100).toFixed(2)}%</span><div class="bar warn"><i style="width:${(f.left / E.volDecaySec) * 100}%"></i></div><small>price moved over ${E.volThresholdBps / 100}% in ${E.volWindowSec}s · back to ${(f.bps / 100).toFixed(1)}% in ${f.left}s</small>`;
    else el.innerHTML = `<span class="badge teal">Fee now</span><span class="big">${(f.total / 100).toFixed(1)}%</span><small>on the HYPE side of every buy and sell · 70% of the base 1% to the creator${x.creatorTaxBps ? ` · +${x.creatorTaxBps / 100}% creator fee` : ''} · 3% for 2 minutes after a 10% move</small>`;
  }
  function renderTrade() {
    const el = $('#t-trade'), me = APP.W.addressFor(chain), bal = DATA.balance(addr, chain, me), hbal = me ? DATA.hypeBalance(chain) : 0, p = x.byChain[chain];
    if (!p) { chain = x.chains[0]; return renderTrade(); }
    const v = parseFloat(amt) || 0; const q = side === 'buy' ? DATA.quoteBuy(addr, chain, v) : DATA.quoteSell(addr, chain, v);
    el.innerHTML = `${x.chains.length > 1 ? `<div class="chain">${x.chains.map((c) => `<button data-c="${c}" class="${c === chain ? 'on' : ''}"><img src="${C.chainOf(c).logo}" alt="">${C.chainOf(c).short}</button>`).join('')}</div>` : ''}
      <div class="bs"><button class="btn up ${side === 'buy' ? 'on' : ''}" data-s="buy">Buy</button><button class="btn dn ${side === 'sell' ? 'on' : ''}" data-s="sell">Sell</button></div>
      <label class="lab" style="display:flex;justify-content:space-between"><span>${side === 'buy' ? 'You pay' : 'You sell'}</span><span>${me ? (side === 'buy' ? `${fmtNum(hbal, 3)} HYPE` : `${fmtNum(bal, 0)} ${esc(x.symbol)}`) : 'not connected'}</span></label>
      <div class="ipw" style="margin-top:6px"><input class="inp" id="t-amt" inputmode="decimal" placeholder="0" value="${esc(amt)}" autocomplete="off"><span class="suf">${side === 'buy' ? 'HYPE' : esc(x.symbol)}</span></div>
      <div class="qs">${(side === 'buy' ? [['0.1', 0.1], ['0.5', 0.5], ['1', 1], ['5', 5]] : [['25%', 0.25], ['50%', 0.5], ['75%', 0.75], ['100%', 1]]).map(([l, v2]) => `<button data-q="${v2}">${l}</button>`).join('')}</div>
      <div class="q">${v > 0 ? `<div class="kvl"><span>You get (min)</span><b>${side === 'buy' ? `${fmtNum(q.tokens * (1 - slip / 100), 0)} ${esc(x.symbol)}` : fmtHype(q.hype * (1 - slip / 100), 4)}</b></div><div class="kvl"><span>Fee ${(q.feeBps / 100).toFixed(2)}%${q.snipe ? ' incl. snipe tax' : ''}</span><b>${fmtHype(q.fee + (q.snipe || 0), 4)}</b></div><div class="kvl"><span>Price impact</span><b class="${Math.abs(q.impact) > 5 ? 'dn' : ''}">${q.impact > 0 ? '+' : ''}${q.impact.toFixed(2)}%</b></div>` : `<div class="kvl"><span>Price</span><b>${fmtPrice(p.px)} HYPE</b></div>`}<div class="kvl"><span>Slippage</span><b><span class="seg" id="t-slip">${[1, 3, 10].map((s) => `<button class="${slip === s ? 'on' : ''}" data-sl="${s}">${s}%</button>`).join('')}</span></b></div></div>
      <button class="btn w go ${side === 'buy' ? 'up on' : 'dn on'}" id="t-go"></button><p class="hint" style="margin-top:8px">${chain === 'sol' ? 'Solana pool on Meteora DAMM v2, paired with HYPE on Solana. Phantom, Solflare or Backpack.' : 'HyperEVM pool on Uniswap v4 with the launchpad hook, paired with native HYPE.'}</p>`;
    $$('[data-c]', el).forEach((b) => b.onclick = () => { chain = b.dataset.c; CHART.mount($('#t-chart'), addr, chain); renderAll(); });
    $$('[data-s]', el).forEach((b) => b.onclick = () => { side = b.dataset.s; amt = ''; renderTrade(); });
    $$('[data-q]', el).forEach((b) => b.onclick = () => { const k = +b.dataset.q; amt = side === 'buy' ? String(k) : String(bal * k); renderTrade(); });
    $$('[data-sl]', el).forEach((b) => b.onclick = () => { slip = +b.dataset.sl; renderTrade(); });
    const inp = $('#t-amt', el); inp.oninput = () => { amt = inp.value; const pos = inp.selectionStart; renderTrade(); const n = $('#t-amt'); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} };
    const go = $('#t-go', el);
    if (busy) { go.disabled = true; go.textContent = 'Confirm in your wallet…'; return; }
    if (!me) { go.textContent = `Connect ${chain === 'sol' ? 'a Solana' : 'a HyperEVM'} wallet`; go.onclick = () => (chain === 'sol' ? APP.W.sol.connect() : APP.W.connect()); return; }
    if (chain !== 'sol' && !APP.W.chainOk) { go.textContent = 'Switch to HyperEVM'; go.onclick = () => APP.W.switchChain().catch((e) => toast(errMsg(e), 'err')); return; }
    go.textContent = v > 0 ? `${side === 'buy' ? 'Buy' : 'Sell'} ${esc(x.symbol)}` : 'Enter an amount'; go.disabled = !(v > 0);
    go.onclick = async () => { busy = true; renderTrade(); try { const r = side === 'buy' ? await DATA.buy(addr, chain, v, q.tokens * (1 - slip / 100)) : await DATA.sell(addr, chain, v, q.hype * (1 - slip / 100)); toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${fmtNum(r.tokens, 0)} ${x.symbol} for ${fmtNum(r.hype, 4)} HYPE`, 'ok'); amt = ''; } catch (e) { toast(errMsg(e), 'err'); } busy = false; renderAll(); };
  }
  function renderTab() {
    const el = $('#t-tabp'); $$('#t-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'trades') { const trs = DATA.trades(addr).slice(0, 50); el.innerHTML = `<div class="tblc tscroll"><table class="tbl"><thead><tr><th>Time</th><th>Side</th><th class="r">HYPE</th><th class="r">${esc(x.symbol)}</th><th class="r hm">Price</th><th class="hm">Wallet</th><th>Chain</th></tr></thead><tbody>${trs.map((t) => `<tr><td style="color:var(--fg-2)">${ago(t.ts)} ago</td><td class="${t.buy ? 'up' : 'dn'}" style="font-weight:600">${t.buy ? 'Buy' : 'Sell'}${t.snipeBps ? ` <span class="badge dn">snipe</span>` : ''}${t.volBps ? ` <span class="badge warn">vol</span>` : ''}</td><td class="r">${fmtNum(t.hype, 3)}</td><td class="r">${fmtNum(t.tokens, 0)}</td><td class="r hm">${fmtUsd(t.px * APP.hypeUsd)}</td><td class="hm"><a href="${t.chain === 'sol' ? ex('sol', 'account', t.wallet) : ex('hyper', 'address', t.wallet)}" target="_blank" rel="noopener" class="addr">${t.wallet === x.creator ? 'creator' : shortAddr(t.wallet)}</a></td><td><a href="${t.chain === 'sol' ? ex('sol', 'tx', t.tx) : ex('hyper', 'tx', t.tx)}" target="_blank" rel="noopener"><img src="${C.chainOf(t.chain).logo}" alt="${t.chain}" style="width:16px;height:16px;border-radius:50%"></a></td></tr>`).join('') || `<tr><td colspan="7" class="empty">No trades yet</td></tr>`}</tbody></table></div>`; }
    if (tab === 'holders') { const hs = DATA.holders(addr).slice(0, 50); el.innerHTML = `<div class="tblc tscroll"><table class="tbl"><thead><tr><th>#</th><th>Wallet</th><th>Chain</th><th class="r">Balance</th><th class="r">Share</th></tr></thead><tbody>${hs.map((h, i) => `<tr><td style="color:var(--fg-3)">${i + 1}</td><td>${h.pool ? `<span class="badge teal">${ic('lock')}${esc(h.wallet)}</span>` : `<a class="addr" href="${h.chain === 'sol' ? ex('sol', 'account', h.wallet) : ex('hyper', 'address', h.wallet)}" target="_blank" rel="noopener">${shortAddr(h.wallet)}</a>${h.creator ? ' <span class="badge ac">creator</span>' : ''}`}</td><td><img src="${C.chainOf(h.chain).logo}" alt="${h.chain}" style="width:16px;height:16px;border-radius:50%"></td><td class="r">${fmtNum(h.bal, 0)}</td><td class="r">${h.share.toFixed(2)}%</td></tr>`).join('')}</tbody></table></div>`; }
  }
  $$('#t-tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.t; renderTab(); });
  function renderAll() { x = DATA.token(addr) || x; renderHead(); renderFee(); renderTrade(); renderTab(); CHART.update(); }
  renderAll(); APP.onUpdate(() => { x = DATA.token(addr) || x; renderHead(); renderFee(); if (!busy && document.activeElement !== $('#t-amt')) renderTrade(); renderTab(); CHART.update(); }); APP.onWallet(renderTrade);
  setInterval(renderFee, 1000);
};
