/* Swap: the quote coin for any launched coin, any coin back to the quote coin, or coin for coin through the quote coin,
   all on the launchpad's own pools. Quotes come from the pools' liquidity bands (DATA.quoteBuy / quoteSell), so a
   coin-to-coin quote is a sell quote fed into a buy quote. Execution goes through the Universal Router in one
   transaction: DATA.buy, DATA.sell, or DATA.swapCoins for the two-hop route. Slippage is the user's; the pool fee is
   the hook's (1% on each pool a route crosses). */
window.PAGE = async () => {
  const { $, $$, esc, ic, fmtNum, fmtUsd, toast, errMsg } = APP, C = CFG, Q = C.chain.quote;
  const root = $('#pg-swap'), qs = new URLSearchParams(location.search);
  const NATIVE = { addr: 'native', symbol: Q, name: C.chain.quoteName || Q, img: C.chain.logo, native: true };
  const coins = () => DATA.tokens().filter((t) => !t.net || t.net === C.chain.key);
  const byAddr = (a) => (a === 'native' ? NATIVE : coins().find((t) => t.addr === String(a).toLowerCase()) || null);
  let from = byAddr(qs.get('from') || 'native') || NATIVE, to = byAddr(qs.get('to')) || (coins()[0] || null);
  let amount = '', slipBps = Number(localStorage.getItem('slip') || 100), busy = false, balFrom = 0, balTo = 0;
  const lc = (a) => String(a || '').toLowerCase();

  const quote = () => {
    const v = Number(amount) || 0; if (!(v > 0) || !to || !from || from.addr === to.addr) return null;
    if (from.native) { const q = DATA.quoteBuy(to.addr, C.chain.key, v); return { out: q.tokens, fee: q.fee, impact: q.impact, feeBps: q.feeBps, hops: 1, mid: 0 }; }
    if (to.native) { const q = DATA.quoteSell(from.addr, C.chain.key, v); return { out: q.hype, fee: q.fee, impact: q.impact, feeBps: q.feeBps, hops: 1, mid: 0 }; }
    const s = DATA.quoteSell(from.addr, C.chain.key, v); if (!(s.hype > 0)) return { out: 0, fee: 0, impact: 0, feeBps: 0, hops: 2, mid: 0 };
    const b = DATA.quoteBuy(to.addr, C.chain.key, s.hype);
    return { out: b.tokens, fee: s.fee + b.fee * (b.px || 0), impact: Math.max(s.impact || 0, b.impact || 0), feeBps: (s.feeBps || 0) + (b.feeBps || 0), hops: 2, mid: s.hype };
  };
  const usdOf = (t, n) => (t.native ? APP.usd(n) : APP.usd(n * (t.px || 0)));
  async function loadBalances() {
    if (!APP.W.connected) { balFrom = balTo = 0; return; }
    const w = APP.W.address;
    const get = async (t) => (!t ? 0 : t.native ? await DATA.hypeBalance() : await DATA.balance(t.addr, C.chain.key, w));
    [balFrom, balTo] = await Promise.all([get(from), get(to)]);
  }
  const tsel = (t, side) => `<button class="tsel" data-pick="${side}">${t ? `<img src="${esc(t.img)}" alt="" data-sym="${esc(t.symbol)}" data-addr="${t.native ? '' : t.addr}">${esc(t.symbol)}` : 'Select a coin'}${ic('chevr')}</button>`;
  function render() {
    const q = quote(), v = Number(amount) || 0, minOut = q ? q.out * (1 - slipBps / 10000) : 0;
    const same = from && to && from.addr === to.addr, noLiq = q && v > 0 && !(q.out > 0);
    const btn = !APP.W.connected ? `<button class="btn pri full" id="w-conn">${ic('wallet')}Sign in</button>`
      : !to ? '<button class="btn pri full" disabled>Select a coin</button>' : same ? '<button class="btn pri full" disabled>Pick two different coins</button>'
      : !(v > 0) ? '<button class="btn pri full" disabled>Enter an amount</button>' : v > balFrom + 1e-12 ? `<button class="btn pri full" disabled>Not enough ${esc(from.symbol)}</button>`
      : noLiq ? '<button class="btn pri full" disabled>No liquidity for that size</button>' : `<button class="btn pri full" id="w-go" ${busy ? 'disabled' : ''}>${busy ? 'Confirm in your wallet…' : 'Swap'}</button>`;
    root.innerHTML = `<div class="swh"><h1>Swap</h1><p>${esc(Q)} for any coin on ${esc(C.brand)}, any coin back, or one coin for another in a single transaction on their own pools.</p></div>
      <div class="swc">
        <div class="box"><div class="lab"><span>You pay</span><span>${APP.W.connected && from ? `Balance ${fmtNum(balFrom, 4)} ${APP.W.connected ? '<button id="w-max">Max</button>' : ''}` : ''}</span></div><div class="in"><input id="w-amt" inputmode="decimal" placeholder="0" value="${esc(amount)}" autocomplete="off">${tsel(from, 'from')}</div><div class="usd">${from && v > 0 ? usdOf(from, v) : ''}</div></div>
        <div class="flip"><button id="w-flip" aria-label="Flip">${ic('swap')}</button></div>
        <div class="box"><div class="lab"><span>You receive</span><span>${APP.W.connected && to ? `Balance ${fmtNum(balTo, 4)}` : ''}</span></div><div class="in"><input id="w-out" value="${q && q.out > 0 ? fmtNum(q.out, q.out < 1 ? 6 : 4) : ''}" placeholder="0" readonly>${tsel(to, 'to')}</div><div class="usd">${to && q && q.out > 0 ? usdOf(to, q.out) : ''}</div></div>
        ${q && q.out > 0 ? `<div class="det"><div><span>Rate</span><b>1 ${esc(from.symbol)} = ${fmtNum(q.out / v, 6)} ${esc(to.symbol)}</b></div>${q.hops === 2 ? `<div><span>Route</span><b>${esc(from.symbol)} → ${esc(Q)} (${fmtNum(q.mid, 5)}) → ${esc(to.symbol)}</b></div>` : ''}<div><span>Pool fee</span><b>${(q.feeBps / 100).toFixed(2)}%${q.hops === 2 ? ' across two pools' : ''}</b></div><div><span>Price impact</span><b class="${q.impact > 5 ? 'dn' : ''}">${fmtNum(q.impact || 0, 2)}%</b></div><div><span>Minimum received</span><b>${fmtNum(minOut, 6)} ${esc(to.symbol)}</b></div><div><span>Slippage</span><span class="slip">${[50, 100, 300, 500].map((b) => `<button data-slip="${b}" class="${slipBps === b ? 'on' : ''}">${b / 100}%</button>`).join('')}</span></div></div>` : ''}
        ${btn}
      </div>`;
    const conn = $('#w-conn'); if (conn) conn.onclick = APP.W.connect;
    const inp = $('#w-amt'); inp.oninput = () => { amount = inp.value.replace(/[^0-9.]/g, ''); const pos = inp.selectionStart; render(); const n = $('#w-amt'); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} };
    const mx = $('#w-max'); if (mx) mx.onclick = () => { amount = String(from.native ? Math.max(0, balFrom - 0.002) : balFrom); render(); };
    $('#w-flip').onclick = () => { [from, to] = [to || NATIVE, from]; amount = ''; loadBalances().then(render); render(); };
    $$('[data-pick]', root).forEach((b) => b.onclick = () => picker(b.dataset.pick));
    $$('[data-slip]', root).forEach((b) => b.onclick = () => { slipBps = Number(b.dataset.slip); localStorage.setItem('slip', slipBps); render(); });
    const go = $('#w-go'); if (go) go.onclick = swap;
  }
  function picker(side) {
    const other = side === 'from' ? to : from;
    const list = [NATIVE, ...coins().sort((a, b) => b.mcapUsd - a.mcapUsd)].filter((t) => !other || t.addr !== other.addr);
    const ov = APP.dialog('Select a coin', `<div class="pick"><input id="pk-q" placeholder="Search by name, ticker or address" autocomplete="off"><div id="pk-list">${rows(list)}</div></div>`);
    function rows(ls) { return ls.map((t) => `<button class="tk" data-a="${t.addr}"><img src="${esc(t.img)}" alt="" data-sym="${esc(t.symbol)}" data-addr="${t.native ? '' : t.addr}"><span><b>${esc(t.symbol)}${APP.ofc(t)}</b><small>${esc(t.name)}</small></span>${t.native ? '' : `<span class="bal">${fmtUsd(t.mcapUsd)}</span>`}</button>`).join('') || '<div class="empty">No coins yet.</div>'; }
    const bind = () => $$('.tk', ov).forEach((b) => b.onclick = () => { const t = byAddr(b.dataset.a); if (side === 'from') from = t; else to = t; ov.remove(); history.replaceState(null, '', '?' + new URLSearchParams({ from: from.addr, ...(to ? { to: to.addr } : {}) })); loadBalances().then(render); render(); });
    bind();
    $('#pk-q', ov).oninput = (e) => { const s = e.target.value.trim().toLowerCase(); $('#pk-list', ov).innerHTML = rows(list.filter((t) => !s || t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || (t.addr || '').includes(s))); bind(); };
    setTimeout(() => $('#pk-q', ov).focus(), 30);
  }
  async function swap() {
    if (busy) return; const q = quote(); if (!q || !(q.out > 0)) return;
    busy = true; render();
    try {
      await APP.W.require(); const v = Number(amount), minOut = q.out * (1 - slipBps / 10000);
      let r;
      if (from.native) r = await DATA.buy(to.addr, C.chain.key, v, minOut);
      else if (to.native) r = await DATA.sell(from.addr, C.chain.key, v, minOut);
      else r = await DATA.swapCoins(from.addr, to.addr, C.chain.key, v, minOut);
      toast(`Swapped ${fmtNum(v, 4)} ${from.symbol} for about ${fmtNum(q.out, 4)} ${to.symbol}`, 'ok', 6000);
      amount = '';
    } catch (e) { toast(errMsg(e), 'err', 7000); }
    busy = false; await loadBalances().catch(() => {}); render();
  }
  render();
  await loadBalances().catch(() => {}); render();
  APP.onWallet(() => loadBalances().then(render).catch(() => {}));
  let last = 0; APP.onUpdate(() => { if (!busy && Date.now() - last > 4000 && document.activeElement !== $('#w-amt')) { last = Date.now(); render(); } });
};
