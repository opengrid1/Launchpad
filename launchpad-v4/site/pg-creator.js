/* Profile: one wallet's holdings (with a portfolio chart), activity, launches and creator fees, laid out like the reference.
   /creator shows the signed-in wallet; /creator?a=0x… shows any wallet as a public profile. */
window.PAGE = async () => {
  const { $, $$, esc, ic, fmtNum, fmtUsd, shortAddr, toast, errMsg, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search);
  let tab = qs.get('tab') || 'holdings', range = '7d', busy = false, other = (qs.get('a') || '').toLowerCase();
  const RANGES = [['7d', '7D', 7, '7d'], ['30d', '30D', 30, '30d'], ['90d', '90D', 90, '90d'], ['all', 'All', 0, 'all time']];
  const who = () => other || (APP.W.connected ? APP.W.address : '');
  const mine = () => !!(APP.W.connected && who() === APP.W.address);
  const exp = (kind, v) => `${C.chain.explorer}/${kind}/${v}`;
  const usd = (hype) => fmtUsd((Number(hype) || 0) * APP.hypeUsd);
  const spark = (t, w = 120, h = 36) => { const cs = DATA.candles(t.addr, 900, 'hyper').slice(-40); if (cs.length < 2) return `<svg class="sp" viewBox="0 0 ${w} ${h}"></svg>`; const v = cs.map((b) => b.c), lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || hi || 1; const pts = v.map((y, i) => `${(i / (v.length - 1) * (w - 2) + 1).toFixed(1)},${((h - 2) - (y - lo) / rg * (h - 4) + 1).toFixed(1)}`).join(' '); const col = v[v.length - 1] >= v[0] ? '#16b364' : '#ef4444'; return `<svg class="sp" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`; };
  const tokenRow = (t) => `<a class="r" href="${tokenUrl(t)}"><span class="mk"><img src="${t.img}" alt="" data-sym="${esc(t.symbol)}" data-addr="${t.addr}" loading="lazy"></span><span class="id"><span class="nm"><b>${esc(t.name)}</b><em>${esc(t.symbol)}</em></span><span class="meta"><span class="cr">${APP.cmark(t.creator)}${shortAddr(t.creator)}</span><time>${t.age}</time></span></span><span class="pair hm"><img src="${C.chainOf(t.net).logo}" alt="">${esc(t.chainName || C.chain.name)}</span><span class="hm">${spark(t)}</span><span class="mc">${fmtUsd(t.mcapUsd)}</span></a>`;

  // portfolio value over the range, from the wallet's own trades and each token's candles
  function series(w, days) {
    const N = 80, end = Date.now() / 1000, start = days ? end - days * 86400 : Math.min(w.joined || end - 7 * 86400, end - 86400), step = (end - start) / (N - 1), cache = {};
    const px = (t, ts) => { let cs = cache[t.addr]; if (!cs) cs = cache[t.addr] = DATA.candles(t.addr, 3600, 'hyper'); if (!cs.length) return t.px; let p = cs[0].o; for (const b of cs) { if (b.t > ts) break; p = b.c; } return p; };
    const out = []; for (let i = 0; i < N; i++) { const ts = start + step * i; let v = 0; for (const h of w.holdings) { if (h.native) { v += h.bal * APP.hypeUsd; continue; } let bal = 0; for (const a of w.activity) if (a.token.addr === h.token.addr && a.kind !== 'launch' && a.ts <= ts) bal += a.kind === 'buy' ? a.tokens : -a.tokens; if (bal > 0) v += bal * px(h.token, ts) * APP.hypeUsd; } out.push(v); }
    return out;
  }
  function drawChart(cv, pts) {
    const dpr = devicePixelRatio || 1, W = cv.clientWidth || 600, H = 200; cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H); if (pts.length < 2) return;
    const col = getComputedStyle(document.documentElement).getPropertyValue('--up').trim() || '#16b364'; const lo = Math.min(...pts), hi = Math.max(...pts), rg = hi - lo || hi || 1;
    const X = (i) => i / (pts.length - 1) * (W - 4) + 2, Y = (v) => 10 + (1 - (v - lo) / rg) * (H - 20);
    g.save(); g.beginPath(); g.moveTo(X(0), H); pts.forEach((v, i) => g.lineTo(X(i), Y(v))); g.lineTo(X(pts.length - 1), H); g.closePath(); g.clip(); g.fillStyle = col;
    for (let y = 4; y < H; y += 6) { g.globalAlpha = 0.5 - 0.42 * (y / H); for (let x = 3; x < W; x += 6) { g.beginPath(); g.arc(x, y, 1.1, 0, 6.3); g.fill(); } }
    g.restore(); g.globalAlpha = 1; g.strokeStyle = col; g.lineWidth = 2.5; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); pts.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke();
  }

  function header(w) {
    const me = mine(), a = w.address, joined = w.joined ? new Date(w.joined * 1000).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : '';
    return `<header class="phd"><a class="back" href="/">${ic('chevl')}Launches</a>
      <div class="ptop"><span class="pav" style="background-image:url('${APP.identicon(a)}')"></span>${me ? `<button class="btn sec" id="p-out">${ic('logout')}Sign out</button>` : `<a class="btn sec" href="${exp('address', a)}" target="_blank" rel="noopener">${ic('ext')}View on explorer</a>`}</div>
      <div class="pid"><h1>${shortAddr(a)}</h1><p class="phandle"><span class="addr">${a}</span><span class="chips"><button class="chip" id="p-copy" aria-label="Copy address">${ic('copy')}</button><a class="chip" href="${exp('address', a)}" target="_blank" rel="noopener" aria-label="View on explorer">${ic('ext')}</a></span></p>
      <p class="pmeta">${ic('cal')}${joined ? `Joined ${joined}` : 'No activity yet'}</p></div></header>`;
  }
  function tabs(w) {
    const T = [['holdings', 'Holdings', w.holdings.length], ['activity', 'Activity', 0], ['launches', 'Launches', w.launches.length], ['fees', 'Creator fees', 0]];
    return `<div class="ptabs"><div class="tb" role="tablist">${T.map(([k, l, n]) => `<button role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}${n ? `<i>${n}</i>` : ''}</button>`).join('')}</div></div>`;
  }
  function holdings(w) {
    const pts = series(w, RANGES.find((r) => r[0] === range)[2]); const first = pts.find((v) => v > 0) || 0, last = pts[pts.length - 1] || 0, pct = first ? (last / first - 1) * 100 : 0;
    const rows = w.holdings.map((h) => { const t = h.token; const pnl = h.native ? null : h.usd - h.cost; return `<a class="r" href="${h.native ? exp('address', w.address) : tokenUrl(t)}"${h.native ? ' target="_blank" rel="noopener"' : ''}><span class="mk"><img src="${h.native ? C.chain.logo : t.img}" alt="" data-sym="${esc(h.native ? 'HYPE' : t.symbol)}" data-addr="${h.native ? '' : t.addr}"></span><span class="id"><span class="nm"><b>${esc(h.native ? 'Hyperliquid' : t.name)}</b><em>${esc(h.native ? 'HYPE' : t.symbol)}</em></span></span><span class="cell hm">${fmtNum(h.bal)}</span><span class="cell hm">${fmtUsd(h.pxUsd)}</span><span class="cell">${fmtUsd(h.usd)}</span><span class="cell ${pnl === null ? 'muted' : pnl >= 0 ? 'up' : 'dn'}">${pnl === null ? '—' : (pnl >= 0 ? '+' : '−') + fmtUsd(Math.abs(pnl))}</span></a>`; }).join('');
    return `<div class="hold"><section class="pchart"><div class="pch"><div class="pfig"><b>${fmtUsd(last)}</b><span class="${pct >= 0 ? 'up' : 'dn'}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% over ${RANGES.find((r) => r[0] === range)[3]}</span></div><div class="rng">${RANGES.map(([k, l]) => `<button data-r="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div></div><div class="pcv"><canvas id="p-cv"></canvas></div></section>
      <div class="rows hold">${rows ? `<div class="rh"><span>Token</span><span class="ra">Balance</span><span class="ra">Price</span><span class="ra">Value</span><span class="ra">PnL</span></div>${rows}` : `<div class="pempty">No holdings yet.</div>`}</div></div>`;
  }
  function activity(w) {
    if (!w.activity.length) return `<div class="pempty">No activity yet.</div>`;
    const side = { buy: ['Buy', 'aur'], sell: ['Sell', 'adr'], launch: ['Launched', ''] };
    return `<div class="rows act"><div class="rh"><span>Token</span><span>Action</span><span class="ra">Amount</span><span class="ra">Value</span><span class="ra">Age</span><span></span></div>${w.activity.slice(0, 60).map((a) => { const t = a.token, [lab, ico] = side[a.kind]; return `<div class="r"><a class="mk" href="${tokenUrl(t)}"><img src="${t.img}" alt="" data-sym="${esc(t.symbol)}" data-addr="${t.addr}" loading="lazy"></a><span class="id"><span class="nm"><a href="${tokenUrl(t)}"><b>${esc(t.name)}</b></a><em>${esc(t.symbol)}</em></span>${a.kind === 'launch' ? '' : `<span class="meta">For ${fmtNum(a.hype)} HYPE in the pool</span>`}</span><span class="side">${ico ? ic(ico) : ''}${lab}</span><span class="cell hm">${a.kind === 'launch' ? '' : fmtNum(a.tokens)}</span><span class="cell">${a.kind === 'launch' ? '' : fmtUsd(a.usd)}</span><span class="cell age">${APP.ago(a.ts)}</span><a class="txl hm" href="${a.tx ? exp('tx', a.tx) : exp('address', t.addr)}" target="_blank" rel="noopener" aria-label="View transaction">${ic('ext')}</a></div>`; }).join('')}</div>`;
  }
  function launches(w) {
    if (!w.launches.length) return `<div class="pempty">No launches yet.${mine() ? ` <a class="ac" href="/launch">Create a token</a>.` : ''}</div>`;
    const cap = w.launches.reduce((s, t) => s + t.mcapUsd, 0);
    return `<div class="rows"><div class="pstats"><span>${w.launches.length} launched</span><span>combined market cap ${fmtUsd(cap)}</span></div><div class="rh"><span>Token</span><span>Chain</span><span class="ra">Graph</span><span class="ra">Market cap</span></div>${w.launches.map(tokenRow).join('')}</div>`;
  }
  function fees(w) {
    const c = DATA.creator(w.address), me = mine();
    const rows = c.tokens.filter((t) => t.creatorFees > 0).map((t) => `<a class="r" href="${tokenUrl(t)}"><span class="mk"><img src="${t.img}" alt="" data-sym="${esc(t.symbol)}" data-addr="${t.addr}" loading="lazy"></span><span class="id"><span class="nm"><b>${esc(t.name)}</b><em>${esc(t.symbol)}</em></span><span class="meta">${t.creatorTaxBps ? `1% pool fee + ${t.creatorTaxBps / 100}% creator fee` : '1% pool fee'}${t.buyback ? ' · buyback & vest' : ''}</span></span><span class="cell hm">${usd(t.creatorFees)}</span><span class="cell">${usd(t.pending)}</span></a>`).join('');
    return `<div class="feesw"><section class="fcard"><div class="fcopy"><span class="lab">Claimable</span><b>${usd(c.pending)}</b></div>${me && c.pending > 0 ? `<button class="btn pri" id="p-claim" ${busy ? 'disabled' : ''}>${busy ? 'Confirm in your wallet…' : 'Claim'}</button>` : ''}</section>
      ${rows ? `<div class="rows fees"><div class="rh"><span>Token</span><span class="ra">Lifetime</span><span class="ra">Claimable</span></div>${rows}</div>` : `<div class="pempty">Nothing waiting for this wallet.</div>`}</div>`;
  }

  function render() {
    const el = $('#pg-creator'), a = who();
    if (!a) { el.innerHTML = `<header class="phd"><a class="back" href="/">${ic('chevl')}Launches</a></header><div class="pempty gate"><p>Sign in to see your holdings, activity, launches and creator fees.</p><div class="acts"><button class="btn pri" id="p-conn">Sign in</button>${C.mode === 'demo' ? `<button class="btn sec" id="p-demo">Preview with a demo profile</button>` : ''}</div></div>`; $('#p-conn').onclick = APP.W.connect; const d = $('#p-demo'); if (d) d.onclick = () => { other = DATA.demoWallet; history.replaceState(null, '', '?a=' + other); render(); }; return; }
    const w = DATA.wallet(a);
    el.innerHTML = header(w) + tabs(w) + `<div class="ppanel">${tab === 'activity' ? activity(w) : tab === 'launches' ? launches(w) : tab === 'fees' ? fees(w) : holdings(w)}</div>`;
    $('#p-copy').onclick = () => APP.copy(a, 'Address copied'); const out = $('#p-out'); if (out) out.onclick = () => { APP.W.disconnect(); other = ''; history.replaceState(null, '', '/creator'); render(); };
    $$('.ptabs [data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', '?' + new URLSearchParams({ ...(other ? { a: other } : {}), tab })); render(); });
    $$('.rng [data-r]').forEach((b) => b.onclick = () => { range = b.dataset.r; render(); });
    const cv = $('#p-cv'); if (cv) drawChart(cv, series(w, RANGES.find((r) => r[0] === range)[2]));
    const cl = $('#p-claim'); if (cl) cl.onclick = async () => { busy = true; render(); try { const got = await DATA.claim('hyper'); toast(`Claimed ${fmtNum(got, 4)} HYPE`, 'ok'); } catch (e) { toast(errMsg(e), 'err'); } busy = false; render(); };
  }
  render(); APP.onWallet(render); let lastR = 0; APP.onUpdate(() => { if (!busy && Date.now() - lastR > 5000) { lastR = Date.now(); render(); } }); addEventListener('resize', () => { const cv = $('#p-cv'); if (cv && who()) drawChart(cv, series(DATA.wallet(who()), RANGES.find((r) => r[0] === range)[2])); });
};
