/* Home: title and launch button, a Trending marquee (two laps, 40px/s, pauses on hover, arrows nudge a card),
   underline tabs with the pair pill and list/grid toggle, flat rows or a grid of cards, and Show more. */
window.PAGE = async () => {
  const { $, $$, esc, fmtUsd, fmtPct, shortAddr, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search); let sort = qs.get('sort') || 'mcap', shown = 30, view = (() => { try { return localStorage.getItem('view') || 'list'; } catch { return 'list'; } })();
  const KEY = { new: (a, b) => b.createdAt - a.createdAt, active: (a, b) => b.lastTs - a.lastTs, mcap: (a, b) => b.mcapUsd - a.mcapUsd, trend: (a, b) => (b.vol24 * (1 + Math.max(0, b.c1) / 100)) - (a.vol24 * (1 + Math.max(0, a.c1) / 100)) };
  const spark = (t, w = 120, h = 36) => { const cs = DATA.candles(t.addr, 900, 'hyper').slice(-40); if (cs.length < 2) return `<svg class="sp" viewBox="0 0 ${w} ${h}"></svg>`; const v = cs.map((b) => b.c), lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || hi || 1; const pts = v.map((y, i) => `${(i / (v.length - 1) * (w - 2) + 1).toFixed(1)},${((h - 2) - (y - lo) / rg * (h - 4) + 1).toFixed(1)}`).join(' '); const col = v[v.length - 1] >= v[0] ? '#16b364' : '#ef4444'; return `<svg class="sp" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`; };
  const lvb = (t) => (t.levMax ? `<span class="lvb" title="Long it up to ${t.levMax}x">${t.levMax}x</span>` : '');
  const trc = (t, i) => `<li class="trc"><a href="${tokenUrl(t)}"><span class="art"><img src="${t.img}" alt="" data-sym="${esc(t.symbol)}" data-addr="${t.addr}"></span><span class="nm"><em>${i + 1}</em>${esc(t.name)}${APP.ofc(t)}${lvb(t)}</span><span class="fig"><b>${fmtUsd(t.mcapUsd)}</b><span class="${t.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(t.c24, false)}</span></span></a></li>`;
  const row = (t) => `<a class="r" href="${tokenUrl(t)}"><span class="mk"><img src="${t.img}" alt="" data-sym="${esc(t.symbol)}" data-addr="${t.addr}" loading="lazy"></span><span class="id"><span class="nm"><b>${esc(t.name)}</b>${APP.ofc(t)}${lvb(t)}<em>${esc(t.symbol)}</em></span><span class="meta"><span class="cr">${APP.cmark(t.creator)}${shortAddr(t.creator)}</span><time>${t.age}</time></span></span><span class="pair hm"><img src="${C.chainOf(t.net).logo}" alt="">${esc(t.chainName || C.chain.name)}</span><span class="hm">${spark(t)}</span><span class="mc">${fmtUsd(t.mcapUsd)}</span></a>`;
  const card = (t) => `<a class="gc" href="${tokenUrl(t)}"><span class="art"><img src="${t.img}" alt="" data-sym="${esc(t.symbol)}" data-addr="${t.addr}" loading="lazy"></span><span class="nm">${esc(t.name)}${APP.ofc(t)}${lvb(t)}<em>${esc(t.symbol)}</em></span><span class="fig"><b>${fmtUsd(t.mcapUsd)}</b>${spark(t, 70, 24)}</span></a>`;
  const qq = (qs.get('q') || '').trim().toLowerCase();
  // the pair filter: every coin, or only those paired with one pair (ETH or a stock); the menu lists the pairs coins use
  let pairF = qs.get('pair') || '';
  const pairOpts = () => { const n = new Map(); for (const t of DATA.tokens()) n.set(t.pairSym || CFG.chain.quote, (n.get(t.pairSym || CFG.chain.quote) || 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1]); };
  function pairMenu() {
    const pf = $('#h-pair'); if (!pf) return; const old = $('.pfm'); if (old) { old.remove(); return; }
    const m = document.createElement('div'); m.className = 'pfm'; m.setAttribute('role', 'listbox');
    m.innerHTML = [['', DATA.tokens().length]].concat(pairOpts()).map(([k, n]) => `<button role="option" data-pf="${APP.esc(k)}" class="${k === pairF ? 'on' : ''}">${k ? APP.esc(k) : 'Any pair'}<span>${n}</span></button>`).join('');
    pf.appendChild(m);
    m.onclick = (e) => { const b = e.target.closest('[data-pf]'); if (!b) return; e.stopPropagation(); pairF = b.dataset.pf; m.remove(); shown = 30; const u = new URLSearchParams(location.search); if (pairF) u.set('pair', pairF); else u.delete('pair'); history.replaceState(null, '', '?' + u); render(); };
    setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
  }
  { const pf = $('#h-pair'); if (pf) { pf.onclick = pairMenu; pf.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pairMenu(); } }; } }
  const list = () => { let ts = DATA.tokens(); if (pairF) ts = ts.filter((t) => (t.pairSym || CFG.chain.quote) === pairF); const pl = $('#h-pair-l'); if (pl) pl.textContent = pairF ? pairF + ' pair' : 'Any pair'; if (qq) ts = ts.filter((t) => t.name.toLowerCase().includes(qq) || t.symbol.toLowerCase().includes(qq) || t.addr.includes(qq)); if (sort === 'active') ts = ts.filter((t) => t.lastTs > Date.now() / 1000 - 3600); return ts.sort(KEY[sort] || KEY.mcap); };
  // marquee
  const mq = $('#h-mq'); let off = 0, lapW = 0, last = 0, paused = false, raf = 0; const SPEED = 40;
  function laps() { const top = DATA.tokens().slice().sort(KEY.trend).slice(0, 10); const one = top.map(trc).join(''); mq.innerHTML = `<ol class="lap">${one}</ol>`; const w1 = mq.firstElementChild.getBoundingClientRect().width; if (w1 <= mq.parentElement.getBoundingClientRect().width) { lapW = 0; off = 0; mq.style.transform = ''; return; } mq.insertAdjacentHTML('beforeend', `<ol class="lap" aria-hidden="true">${one}</ol>`); lapW = w1; } // a second lap only when the first overflows: few coins sit still
  function tick(ts) { if (last && !paused && lapW) { off += (ts - last) / 1000 * SPEED; if (off >= lapW) off -= lapW; mq.style.transform = `translateX(${-off}px)`; } last = ts; raf = requestAnimationFrame(tick); }
  mq.parentElement.onmouseenter = () => { paused = true; }; mq.parentElement.onmouseleave = () => { paused = false; };
  $('#h-tl').onclick = () => { if (!lapW) return; off -= 200; if (off < 0) off += lapW; mq.style.transform = `translateX(${-off}px)`; }; $('#h-tr').onclick = () => { if (!lapW) return; off += 200; if (off >= lapW) off -= lapW; mq.style.transform = `translateX(${-off}px)`; };
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
  render(); raf = requestAnimationFrame(tick); let lastR = 0; let trail = 0; APP.onUpdate(() => { const wait = 4000 - (Date.now() - lastR); if (wait <= 0) { lastR = Date.now(); render(); } else if (!trail) trail = setTimeout(() => { trail = 0; lastR = Date.now(); render(); }, wait); }); // at most every 4 s, never dropping the last update
};
