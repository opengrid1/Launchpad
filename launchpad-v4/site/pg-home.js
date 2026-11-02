/* Home: title and launch button, a Trending row, underline tabs with the pair pill and list/grid toggle, flat rows
   (token, pair, sparkline, market cap) or a grid of cards, and Show more. */
window.PAGE = async () => {
  const { $, $$, esc, fmtUsd, fmtPct, shortAddr, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search); let sort = qs.get('sort') || 'new', shown = 30, view = (() => { try { return localStorage.getItem('view') || 'list'; } catch { return 'list'; } })();
  const KEY = { new: (a, b) => b.createdAt - a.createdAt, trend: (a, b) => (b.vol24 * (1 + Math.max(0, b.c1) / 100)) - (a.vol24 * (1 + Math.max(0, a.c1) / 100)), vol: (a, b) => b.vol24 - a.vol24, mcap: (a, b) => b.mcapUsd - a.mcapUsd, fees: (a, b) => b.feesAll - a.feesAll };
  const state = (t) => { const f = t.fee; if (!f) return ''; if (f.kind === 'snipe') return `<span class="badge dn sm"><i class="live"></i>snipe ${f.left}s</span>`; if (f.kind === 'vol') return `<span class="badge warn sm"><i class="live"></i>${(f.total / 100).toFixed(1)}% fee</span>`; return ''; };
  const spark = (t, w = 120, h = 36) => { const cs = DATA.candles(t.addr, 900, 'hyper').slice(-40); if (cs.length < 2) return `<svg class="sp" viewBox="0 0 ${w} ${h}"></svg>`; const v = cs.map((b) => b.c), lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || hi || 1; const pts = v.map((y, i) => `${(i / (v.length - 1) * (w - 2) + 1).toFixed(1)},${((h - 2) - (y - lo) / rg * (h - 4) + 1).toFixed(1)}`).join(' '); const col = v[v.length - 1] >= v[0] ? '#00c805' : '#ff5000'; return `<svg class="sp" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`; };
  const trc = (t, i) => `<a class="trc" href="${tokenUrl(t)}"><span class="art"><img src="${t.img}" alt=""></span><span class="nm"><em>${i + 1}</em>${esc(t.name)}</span><span class="fig"><b>${fmtUsd(t.mcapUsd)}</b><span class="${t.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(t.c24, false)}</span></span></a>`;
  const row = (t) => `<a class="r" href="${tokenUrl(t)}"><span class="mk"><img src="${t.img}" alt="" loading="lazy"></span><span class="id"><span class="nm"><b>${esc(t.name)}</b><em>${esc(t.symbol)}</em></span><span class="meta"><span class="cr"><i class="cmark">${t.creator.slice(2, 4).toUpperCase()}</i>${shortAddr(t.creator)}</span><time>${t.age}</time>${state(t)}</span></span><span class="pair hm"><img src="${C.chain.logo}" alt="">HYPE</span><span class="hm">${spark(t)}</span><span class="mc">${fmtUsd(t.mcapUsd)}</span></a>`;
  const card = (t) => `<a class="gc" href="${tokenUrl(t)}"><span class="art"><img src="${t.img}" alt="" loading="lazy"></span><span class="nm">${esc(t.name)}<em>${esc(t.symbol)}</em></span><span class="fig"><b>${fmtUsd(t.mcapUsd)}</b>${spark(t, 70, 24)}</span></a>`;
  const list = () => DATA.tokens().sort(KEY[sort] || KEY.new);
  function render() {
    const all = DATA.tokens();
    $('#h-trend').innerHTML = all.slice().sort(KEY.trend).slice(0, 10).map(trc).join('');
    const ts = list();
    $('#h-list').classList.toggle('hidden', view !== 'list'); $('#h-cards').classList.toggle('hidden', view !== 'grid');
    if (view === 'list') $('#h-grid').innerHTML = ts.slice(0, shown).map(row).join('') || `<div class="empty">No coins yet.</div>`;
    else $('#h-cards').innerHTML = ts.slice(0, shown).map(card).join('');
    $('#h-more').classList.toggle('hidden', ts.length <= shown);
    $$('#h-tabs [data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === sort));
    $$('#h-view [data-v]').forEach((x) => x.classList.toggle('on', x.dataset.v === view));
  }
  $$('#h-tabs [data-sort]').forEach((b) => b.onclick = () => { sort = b.dataset.sort; shown = 30; history.replaceState(null, '', '?sort=' + sort); render(); });
  $$('#h-view [data-v]').forEach((b) => b.onclick = () => { view = b.dataset.v; try { localStorage.setItem('view', view); } catch {} render(); });
  $('#h-more').onclick = () => { shown += 30; render(); };
  const tr = $('#h-trend'); $('#h-tl').onclick = () => tr.scrollBy({ left: -400, behavior: 'smooth' }); $('#h-tr').onclick = () => tr.scrollBy({ left: 400, behavior: 'smooth' });
  if (qs.get('focus')) setTimeout(() => APP.search(), 50);
  render(); let last = 0; APP.onUpdate(() => { if (Date.now() - last > 4000) { last = Date.now(); render(); } });
};
