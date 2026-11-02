/* Home, terminal style: a stats strip, compact coin tiles with a sparkline, and a live feed (trades, launches,
   top creators) in a sticky right column. */
window.PAGE = async () => {
  const { $, $$, esc, fmtNum, fmtUsd, fmtPct, shortAddr, ago, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search); let sort = qs.get('sort') || 'new', q = qs.get('q') || '', page = 0, feed = 'trades'; const PER = 24;
  const KEY = { new: (a, b) => b.createdAt - a.createdAt, trend: (a, b) => (b.vol24 * (1 + Math.max(0, b.c1) / 100)) - (a.vol24 * (1 + Math.max(0, a.c1) / 100)), vol: (a, b) => b.vol24 - a.vol24, mcap: (a, b) => b.mcapUsd - a.mcapUsd, fees: (a, b) => b.feesAll - a.feesAll };
  const state = (t) => { const f = t.fee; if (!f) return ''; if (f.kind === 'snipe') return `<span class="badge dn"><i class="live"></i>snipe ${f.left}s</span>`; if (f.kind === 'vol') return `<span class="badge warn"><i class="live"></i>${(f.total / 100).toFixed(1)}% fee</span>`; return `<span>fee <b>${(f.total / 100).toFixed(0)}%</b></span>`; };
  const spark = (t) => { const cs = DATA.candles(t.addr, 900, 'hyper').slice(-40); if (cs.length < 2) return '<svg class="sp" viewBox="0 0 84 30"></svg>'; const v = cs.map((b) => b.c), lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || hi || 1; const pts = v.map((y, i) => `${(i / (v.length - 1) * 82 + 1).toFixed(1)},${(28 - (y - lo) / rg * 26 + 1).toFixed(1)}`).join(' '); const col = v[v.length - 1] >= v[0] ? 'var(--up)' : 'var(--dn)'; return `<svg class="sp" viewBox="0 0 84 30" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`; };
  const tile = (t) => `<a class="tile" href="${tokenUrl(t)}"><div class="t1"><img src="${t.img}" alt="" loading="lazy"><div class="nm"><b>${esc(t.name)}</b><small><em>$${esc(t.symbol)}</em> · ${t.age} ago</small></div>${spark(t)}<div class="mc"><b>${fmtUsd(t.mcapUsd)}</b>${fmtPct(t.c24)}</div></div><div class="t2"><span>vol <b>${fmtUsd(t.vol24 * APP.hypeUsd)}</b></span><span>holders <b>${t.holders}</b></span>${state(t)}<span class="by">${shortAddr(t.creator)}</span></div></a>`;
  function list() { let ts = DATA.tokens(); if (q) { const s = q.toLowerCase(); ts = ts.filter((t) => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.addr.includes(s)); } return ts.sort(KEY[sort] || KEY.new); }
  function renderFeed() {
    const el = $('#h-fb'); $$('#h-feed [data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === feed));
    if (feed === 'trades') { const trs = DATA.tokens().flatMap((t) => DATA.trades(t.addr).slice(0, 4).map((tr) => ({ ...tr, t }))).sort((a, b) => b.ts - a.ts).slice(0, 40); el.innerHTML = trs.map((x) => `<a class="fr" href="${tokenUrl(x.t)}"><img src="${x.t.img}" alt=""><div class="x"><b>$${esc(x.t.symbol)}</b><small>${shortAddr(x.wallet)} · ${ago(x.ts)} ago</small></div><div class="v ${x.buy ? 'up' : 'dn'}">${x.buy ? '+' : '−'}${fmtNum(x.hype, 3)} HYPE<small>${fmtNum(x.tokens, 0)} ${esc(x.t.symbol)}</small></div></a>`).join(''); }
    if (feed === 'launches') { const ts = DATA.tokens().slice().sort(KEY.new).slice(0, 30); el.innerHTML = ts.map((t) => `<a class="fr" href="${tokenUrl(t)}"><img src="${t.img}" alt=""><div class="x"><b>${esc(t.name)}</b><small>$${esc(t.symbol)} · ${t.age} ago</small></div><div class="v">${fmtUsd(t.mcapUsd)}<small>${t.holders} holders</small></div></a>`).join(''); }
    if (feed === 'creators') { const by = {}; for (const t of DATA.tokens()) { const k = t.creator; by[k] = by[k] || { w: k, fees: 0, n: 0, t }; by[k].fees += t.feesAll * C.econ.creatorShareBps / 10000 + 0; by[k].n++; if (t.feesAll > by[k].t.feesAll) by[k].t = t; } const rows = Object.values(by).sort((a, b) => b.fees - a.fees).slice(0, 20); el.innerHTML = rows.map((r, i) => `<a class="fr" href="${tokenUrl(r.t)}"><img src="${r.t.img}" alt=""><div class="x"><b>${shortAddr(r.w)}</b><small>${r.n} coin${r.n > 1 ? 's' : ''} · top $${esc(r.t.symbol)}</small></div><div class="v ac">${fmtNum(r.fees, 3)} HYPE<small>${APP.usd(r.fees)} earned</small></div></a>`).join(''); }
  }
  function render() {
    const s = DATA.stats();
    $('#h-strip').innerHTML = `<span><i></i>HYPE <b>${fmtUsd(APP.hypeUsd)}</b></span><span>gas <b>${APP.gasGwei ? APP.gasGwei.toFixed(APP.gasGwei < 10 ? 1 : 0) + ' gwei' : '…'}</b></span><span>24h volume <b>${fmtUsd(s.vol24 * APP.hypeUsd)}</b></span><span>coins <b>${s.launches}</b></span><span>launched today <b>${s.launches24}</b></span><span>paid to creators <b>${fmtUsd(s.creatorsPaid * APP.hypeUsd)}</b></span>`;
    const ts = list(), pages = Math.max(1, Math.ceil(ts.length / PER)); if (page >= pages) page = pages - 1;
    $('#h-grid').innerHTML = ts.slice(page * PER, page * PER + PER).map(tile).join('') || `<div class="empty" style="grid-column:1/-1">No coins match.</div>`;
    $('#h-pager').innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="btn sm ${i === page ? 'pri' : ''}" data-p="${i}">${i + 1}</button>`).join('') : '';
    $$('#h-pager [data-p]').forEach((b) => b.onclick = () => { page = +b.dataset.p; render(); scrollTo({ top: $('#h-tabs').offsetTop - 70, behavior: 'smooth' }); });
    $$('#h-tabs [data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === sort));
    renderFeed();
  }
  $$('#h-tabs [data-sort]').forEach((b) => b.onclick = () => { sort = b.dataset.sort; page = 0; history.replaceState(null, '', '?sort=' + sort + (q ? '&q=' + encodeURIComponent(q) : '')); render(); });
  $$('#h-feed [data-f]').forEach((b) => b.onclick = () => { feed = b.dataset.f; renderFeed(); });
  const sq = $('#top-q'); sq.value = q; sq.oninput = () => { q = sq.value.trim(); page = 0; render(); };
  if (qs.get('focus')) setTimeout(() => sq.focus(), 50);
  render(); let last = 0; APP.onUpdate(() => { if (document.activeElement === sq) return; renderFeed(); if (Date.now() - last > 4000) { last = Date.now(); render(); } });
};
