/* Home: title and launch button, a Trending row of square cards, underline tabs with a search box, and a white
   table card of coins (token, pair, sparkline, market cap) with a Show more button. */
window.PAGE = async () => {
  const { $, $$, esc, fmtUsd, fmtPct, shortAddr, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search); let sort = qs.get('sort') || 'new', q = qs.get('q') || '', shown = 30;
  const KEY = { new: (a, b) => b.createdAt - a.createdAt, trend: (a, b) => (b.vol24 * (1 + Math.max(0, b.c1) / 100)) - (a.vol24 * (1 + Math.max(0, a.c1) / 100)), vol: (a, b) => b.vol24 - a.vol24, mcap: (a, b) => b.mcapUsd - a.mcapUsd, fees: (a, b) => b.feesAll - a.feesAll };
  const state = (t) => { const f = t.fee; if (!f) return ''; if (f.kind === 'snipe') return `<span class="badge dn"><i class="live"></i>snipe ${f.left}s</span>`; if (f.kind === 'vol') return `<span class="badge warn"><i class="live"></i>${(f.total / 100).toFixed(1)}% fee</span>`; return t.createdAt > Date.now() / 1000 - 3600 ? `<span class="badge ac">New</span>` : ''; };
  const spark = (t) => { const cs = DATA.candles(t.addr, 900, 'hyper').slice(-40); if (cs.length < 2) return '<svg class="sp" viewBox="0 0 84 28"></svg>'; const v = cs.map((b) => b.c), lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || hi || 1; const pts = v.map((y, i) => `${(i / (v.length - 1) * 82 + 1).toFixed(1)},${(26 - (y - lo) / rg * 24 + 1).toFixed(1)}`).join(' '); const col = v[v.length - 1] >= v[0] ? '#00c805' : '#ff5000'; return `<svg class="sp" viewBox="0 0 84 28" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`; };
  const trc = (t, i) => `<a class="trc" href="${tokenUrl(t)}"><img src="${t.img}" alt=""><div class="t"><small><em>${i + 1}</em>${esc(t.name)}</small><b>${fmtUsd(t.mcapUsd)}<span class="${t.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(t.c24, false)}</span></b></div></a>`;
  const row = (t) => `<tr data-h="${tokenUrl(t)}"><td><div class="c"><img src="${t.img}" alt="" loading="lazy"><div class="t"><b>${esc(t.name)}<em>${esc(t.symbol)}</em></b><small><i>${t.creator.slice(2, 4).toUpperCase()}</i>${shortAddr(t.creator)}<span>${t.age}</span>${state(t)}</small></div></div></td><td class="hm"><span class="pair"><img src="${C.chain.logo}" alt="">HYPE</span></td><td class="hm">${spark(t)}</td><td class="r mc">${fmtUsd(t.mcapUsd)}<small class="${t.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(t.c24, false)}</small></td></tr>`;
  function list() { let ts = DATA.tokens(); if (q) { const s = q.toLowerCase(); ts = ts.filter((t) => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.addr.includes(s)); } return ts.sort(KEY[sort] || KEY.new); }
  function render() {
    const all = DATA.tokens();
    $('#h-trend').innerHTML = all.slice().sort(KEY.trend).slice(0, 10).map(trc).join('');
    const ts = list();
    $('#h-grid').innerHTML = ts.slice(0, shown).map(row).join('') || `<tr><td colspan="4" class="empty">No coins match.</td></tr>`;
    $$('#h-grid tr[data-h]').forEach((r) => r.onclick = () => { location.href = r.dataset.h; });
    $('#h-more').classList.toggle('hidden', ts.length <= shown);
    $$('#h-tabs [data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === sort));
  }
  $$('#h-tabs [data-sort]').forEach((b) => b.onclick = () => { sort = b.dataset.sort; shown = 30; history.replaceState(null, '', '?sort=' + sort + (q ? '&q=' + encodeURIComponent(q) : '')); render(); });
  $('#h-more').onclick = () => { shown += 30; render(); };
  const tr = $('#h-trend'); $('#h-tl').onclick = () => tr.scrollBy({ left: -340, behavior: 'smooth' }); $('#h-tr').onclick = () => tr.scrollBy({ left: 340, behavior: 'smooth' });
  const sq = $('#top-q'); sq.value = q; sq.oninput = () => { q = sq.value.trim(); shown = 30; render(); };
  if (qs.get('focus')) setTimeout(() => { sq.focus(); sq.scrollIntoView({ block: 'center' }); }, 50);
  render(); let last = 0; APP.onUpdate(() => { if (document.activeElement === sq) return; if (Date.now() - last > 4000) { last = Date.now(); render(); } });
};
