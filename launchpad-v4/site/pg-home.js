/* Home: title and launch button, a Trending marquee (two laps, 40px/s, pauses on hover, arrows nudge a card),
   underline tabs with the pair pill and list/grid toggle, flat rows or a grid of cards, and Show more. */
window.PAGE = async () => {
  const { $, $$, esc, fmtUsd, fmtPct, shortAddr, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search); let sort = qs.get('sort') || 'mcap', shown = 30, view = (() => { try { return localStorage.getItem('view') || 'list'; } catch { return 'list'; } })();
  const KEY = { new: (a, b) => b.createdAt - a.createdAt, active: (a, b) => b.lastTs - a.lastTs, mcap: (a, b) => b.mcapUsd - a.mcapUsd, trend: (a, b) => (b.vol24 * (1 + Math.max(0, b.c1) / 100)) - (a.vol24 * (1 + Math.max(0, a.c1) / 100)) };
  const spark = (t, w = 120, h = 36) => { const cs = DATA.candles(t.addr, 900, 'hyper').slice(-40); if (cs.length < 2) return `<svg class="sp" viewBox="0 0 ${w} ${h}"></svg>`; const v = cs.map((b) => b.c), lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || hi || 1; const pts = v.map((y, i) => `${(i / (v.length - 1) * (w - 2) + 1).toFixed(1)},${((h - 2) - (y - lo) / rg * (h - 4) + 1).toFixed(1)}`).join(' '); const col = v[v.length - 1] >= v[0] ? '#16b364' : '#ef4444'; return `<svg class="sp" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`; };
  const trc = (t, i) => `<li class="trc"><a href="${tokenUrl(t)}"><span class="art"><img src="${t.img}" alt=""></span><span class="nm"><em>${i + 1}</em>${esc(t.name)}</span><span class="fig"><b>${fmtUsd(t.mcapUsd)}</b><span class="${t.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(t.c24, false)}</span></span></a></li>`;
  const row = (t) => `<a class="r" href="${tokenUrl(t)}"><span class="mk"><img src="${t.img}" alt="" loading="lazy"></span><span class="id"><span class="nm"><b>${esc(t.name)}</b><em>${esc(t.symbol)}</em></span><span class="meta"><span class="cr"><i class="cmark">${t.creator.slice(2, 4).toUpperCase()}</i>${shortAddr(t.creator)}</span><time>${t.age}</time></span></span><span class="pair hm"><img src="${C.chain.logo}" alt="">HYPE</span><span class="hm">${spark(t)}</span><span class="mc">${fmtUsd(t.mcapUsd)}</span></a>`;
  const card = (t) => `<a class="gc" href="${tokenUrl(t)}"><span class="art"><img src="${t.img}" alt="" loading="lazy"></span><span class="nm">${esc(t.name)}<em>${esc(t.symbol)}</em></span><span class="fig"><b>${fmtUsd(t.mcapUsd)}</b>${spark(t, 70, 24)}</span></a>`;
  const qq = (qs.get('q') || '').trim().toLowerCase();
  const list = () => { let ts = DATA.tokens(); if (qq) ts = ts.filter((t) => t.name.toLowerCase().includes(qq) || t.symbol.toLowerCase().includes(qq) || t.addr.includes(qq)); if (sort === 'active') ts = ts.filter((t) => t.lastTs > Date.now() / 1000 - 3600); return ts.sort(KEY[sort] || KEY.mcap); };
  // marquee
  const mq = $('#h-mq'); let off = 0, lapW = 0, last = 0, paused = false, raf = 0; const SPEED = 40;
  function laps() { const top = DATA.tokens().slice().sort(KEY.trend).slice(0, 10); const one = top.map(trc).join(''); mq.innerHTML = `<ol class="lap">${one}</ol><ol class="lap" aria-hidden="true">${one}</ol>`; lapW = mq.firstElementChild.getBoundingClientRect().width; }
  function tick(ts) { if (last && !paused && lapW) { off += (ts - last) / 1000 * SPEED; if (off >= lapW) off -= lapW; mq.style.transform = `translateX(${-off}px)`; } last = ts; raf = requestAnimationFrame(tick); }
  mq.parentElement.onmouseenter = () => { paused = true; }; mq.parentElement.onmouseleave = () => { paused = false; };
  $('#h-tl').onclick = () => { off -= 200; if (off < 0) off += lapW; mq.style.transform = `translateX(${-off}px)`; }; $('#h-tr').onclick = () => { off += 200; if (off >= lapW) off -= lapW; mq.style.transform = `translateX(${-off}px)`; };
  function render() {
    laps();
    const ts = list();
    $('#h-list').classList.toggle('hidden', view !== 'list'); $('#h-cards').classList.toggle('hidden', view !== 'grid');
    if (view === 'list') $('#h-grid').innerHTML = ts.slice(0, shown).map(row).join('') || `<div class="empty">${qq ? `Nothing matches “${esc(qq)}”.` : 'No launches yet.'}</div>`;
    else $('#h-cards').innerHTML = ts.slice(0, shown).map(card).join('');
    $('#h-more').classList.toggle('hidden', ts.length <= shown);
    $$('#h-tabs [data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === sort));
    $$('#h-view [data-v]').forEach((x) => x.classList.toggle('on', x.dataset.v === view));
  }
  $$('#h-tabs [data-sort]').forEach((b) => b.onclick = () => { sort = b.dataset.sort; shown = 30; history.replaceState(null, '', '?sort=' + sort + (qq ? '&q=' + encodeURIComponent(qq) : '')); render(); });
  $$('#h-view [data-v]').forEach((b) => b.onclick = () => { view = b.dataset.v; try { localStorage.setItem('view', view); } catch {} render(); });
  $('#h-more').onclick = () => { shown += 30; render(); };
  if (qs.get('focus')) setTimeout(() => APP.search(), 50);
  render(); raf = requestAnimationFrame(tick); let lastR = 0; APP.onUpdate(() => { if (Date.now() - lastR > 4000) { lastR = Date.now(); render(); } });
};
