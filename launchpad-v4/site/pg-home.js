/* Home: a quiet markets table. Hero with three numbers, a segmented sort, search, then one row per coin with a
   sparkline. Mobile shows the same table with fewer columns. */
window.PAGE = async () => {
  const { $, $$, esc, fmtNum, fmtUsd, fmtPct, fmtPrice, shortAddr, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search); let sort = qs.get('sort') || 'new', q = qs.get('q') || '', page = 0; const PER = 30;
  const KEY = { new: (a, b) => b.createdAt - a.createdAt, trend: (a, b) => (b.vol24 * (1 + Math.max(0, b.c1) / 100)) - (a.vol24 * (1 + Math.max(0, a.c1) / 100)), vol: (a, b) => b.vol24 - a.vol24, mcap: (a, b) => b.mcapUsd - a.mcapUsd, fees: (a, b) => b.feesAll - a.feesAll, holders: (a, b) => b.holders - a.holders, c24: (a, b) => b.c24 - a.c24 };
  const state = (t) => { const f = t.fee; if (!f) return ''; if (f.kind === 'snipe') return `<span class="badge dn"><i class="live"></i>snipe ${f.left}s</span>`; if (f.kind === 'vol') return `<span class="badge warn"><i class="live"></i>${(f.total / 100).toFixed(1)}% fee</span>`; return `<span class="muted">1%</span>`; };
  const spark = (t) => { const cs = DATA.candles(t.addr, 900, 'hyper').slice(-40); if (cs.length < 2) return ''; const v = cs.map((b) => b.c), lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || hi || 1; const pts = v.map((y, i) => `${(i / (v.length - 1) * 94 + 1).toFixed(1)},${(26 - (y - lo) / rg * 24 + 1).toFixed(1)}`).join(' '); const col = v[v.length - 1] >= v[0] ? 'var(--up)' : 'var(--dn)'; return `<svg class="sp" viewBox="0 0 96 28" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`; };
  const row = (t, i) => `<tr data-h="${tokenUrl(t)}"><td class="n">${page * PER + i + 1}</td><td><div class="c"><img src="${t.img}" alt="" loading="lazy"><div class="t"><b>${esc(t.name)}</b><small><em>$${esc(t.symbol)}</em>${t.age} ago<span class="hm">· by ${shortAddr(t.creator)}</span></small></div></div></td><td class="r hm">${fmtUsd(t.pxUsd)}</td><td class="r hm">${fmtPct(t.c24)}</td><td class="r"><b>${fmtUsd(t.mcapUsd)}</b><div class="mo">${fmtPct(t.c24)}</div></td><td class="r hm">${fmtUsd(t.vol24 * APP.hypeUsd)}</td><td class="r hm">${t.holders}</td><td class="hm">${spark(t)}</td><td class="r st hm">${state(t)}</td></tr>`;
  function list() { let ts = DATA.tokens(); if (q) { const s = q.toLowerCase(); ts = ts.filter((t) => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.addr.includes(s)); } return ts.sort(KEY[sort] || KEY.new); }
  function render() {
    const s = DATA.stats();
    $('#h-stats').innerHTML = `<div><span>24h volume</span><b>${fmtUsd(s.vol24 * APP.hypeUsd)}</b></div><div><span>Coins</span><b>${s.launches}</b></div><div><span>Paid to creators</span><b>${fmtUsd(s.creatorsPaid * APP.hypeUsd)}</b></div>`;
    const ts = list(), pages = Math.max(1, Math.ceil(ts.length / PER)); if (page >= pages) page = pages - 1;
    const th = (k, l, r) => `<th class="${r ? 'r ' : ''}${k ? 's ' : ''}${k === sort ? 'on' : ''} ${l === 'Coin' || l === 'Market cap' || !l ? '' : 'hm'}" ${k ? `data-k="${k}"` : ''}>${l}</th>`;
    $('#h-grid').innerHTML = `<thead><tr><th class="n"></th>${th('', 'Coin')}<th class="r hm">Price</th>${th('c24', '24h', 1)}${th('mcap', 'Market cap', 1)}${th('vol', 'Volume 24h', 1)}${th('holders', 'Holders', 1)}<th class="hm">7d</th><th class="r hm">Fee</th></tr></thead><tbody>${ts.slice(page * PER, page * PER + PER).map(row).join('') || `<tr><td colspan="9" class="empty">No coins match.</td></tr>`}</tbody>`;
    $$('#h-grid tbody tr[data-h]').forEach((r) => r.onclick = () => { location.href = r.dataset.h; });
    $$('#h-grid th[data-k]').forEach((h) => h.onclick = () => setSort(h.dataset.k));
    $('#h-pager').innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="btn sm ${i === page ? 'pri' : ''}" data-p="${i}">${i + 1}</button>`).join('') : '';
    $$('#h-pager [data-p]').forEach((b) => b.onclick = () => { page = +b.dataset.p; render(); scrollTo({ top: $('#h-tabs').offsetTop - 70, behavior: 'smooth' }); });
    $$('#h-tabs [data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === sort));
  }
  const setSort = (k) => { sort = k; page = 0; history.replaceState(null, '', '?sort=' + sort + (q ? '&q=' + encodeURIComponent(q) : '')); render(); };
  $$('#h-tabs [data-sort]').forEach((b) => b.onclick = () => setSort(b.dataset.sort));
  const sq = $('#top-q'); sq.value = q; sq.oninput = () => { q = sq.value.trim(); page = 0; render(); };
  if (qs.get('focus')) setTimeout(() => sq.focus(), 50);
  render(); let last = 0; APP.onUpdate(() => { if (Date.now() - last > 4000 && document.activeElement !== sq) { last = Date.now(); render(); } });
};
