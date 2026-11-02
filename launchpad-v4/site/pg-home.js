/* Home, laid out like nad.fun: banner, Trending Now scroller, filter pills, big-image coin cards. */
window.PAGE = async () => {
  const { $, $$, esc, fmtNum, fmtUsd, fmtPct, shortAddr, ago, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search); let sort = qs.get('sort') || 'new', q = qs.get('q') || '', page = 0; const PER = 24;
  const KEY = { new: (a, b) => b.lastTs - a.lastTs, trend: (a, b) => (b.vol24 * (1 + Math.max(0, b.c1) / 100)) - (a.vol24 * (1 + Math.max(0, a.c1) / 100)), vol: (a, b) => b.vol24 - a.vol24, mcap: (a, b) => b.mcapUsd - a.mcapUsd, fees: (a, b) => b.feesAll - a.feesAll };
  const state = (t) => { const f = t.fee; if (!f) return ''; if (f.kind === 'snipe') return `<span class="badge dn st"><i class="live"></i>snipe ${f.left}s</span>`; if (f.kind === 'vol') return `<span class="badge warn st"><i class="live"></i>${(f.total / 100).toFixed(1)}% fee</span>`; return ''; };
  const trc = (t) => `<a class="trc" href="${tokenUrl(t)}"><img src="${t.img}" alt=""><div class="t"><small>${esc(t.symbol)}</small><b>${esc(t.name)}</b><span>MCap ${fmtUsd(t.mcapUsd)}</span></div></a>`;
  const card = (t) => { const ath = Math.max(t.mcapUsd, ...(DATA.candles(t.addr, 3600, 'hyper').map((b) => b.h * 1e9 * APP.hypeUsd))); return `<a class="coin" href="${tokenUrl(t)}"><div class="im"><img src="${t.img}" alt="" loading="lazy">${state(t)}<span class="tk">${esc(t.symbol)}</span><img class="ch" src="${C.chainOf(t.chains[0]).logo}" alt=""></div><div class="bd"><b class="n">${esc(t.name)}</b><p>${esc(t.desc)}</p><div class="meta"><span class="chip">24h <b class="${t.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(t.c24, false)}</b></span><span class="chip">Vol <b>${fmtUsd(t.vol24 * APP.hypeUsd)}</b></span><span class="chip">👥 <b>${t.holders}</b></span></div><div class="by"><i>${t.creator.slice(2, 4).toUpperCase()}</i>${shortAddr(t.creator)}<span>${t.age} ago</span></div><div class="ft"><span>MC <b>${fmtUsd(t.mcapUsd)}</b></span><span>ATH <b>${fmtUsd(ath)}</b></span></div><div class="bar"><i style="width:${Math.min(100, t.mcapUsd / ath * 100).toFixed(0)}%"></i></div></div></a>`; };
  function list() { let ts = DATA.tokens(); if (q) { const s = q.toLowerCase(); ts = ts.filter((t) => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.addr.includes(s)); } return ts.sort(KEY[sort] || KEY.new); }
  function render() {
    const all = DATA.tokens();
    $('#h-trend').innerHTML = all.slice().sort(KEY.trend).slice(0, 8).map(trc).join('');
    const ts = list(), pages = Math.max(1, Math.ceil(ts.length / PER)); if (page >= pages) page = pages - 1;
    $('#h-grid').innerHTML = ts.slice(page * PER, page * PER + PER).map(card).join('') || `<div class="empty" style="grid-column:1/-1">No coins match.</div>`;
    $('#h-pager').innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="btn sm ${i === page ? 'pri' : ''}" data-p="${i}">${i + 1}</button>`).join('') : '';
    $$('#h-pager [data-p]').forEach((b) => b.onclick = () => { page = +b.dataset.p; render(); scrollTo({ top: $('#h-tabs').offsetTop - 70, behavior: 'smooth' }); });
    $$('#h-tabs [data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === sort));
  }
  $$('#h-tabs [data-sort]').forEach((b) => b.onclick = () => { sort = b.dataset.sort; page = 0; history.replaceState(null, '', '?sort=' + sort + (q ? '&q=' + encodeURIComponent(q) : '')); render(); });
  const ps = $('#h-ps'), sq = $('#top-q'); sq.value = q; if (q) ps.classList.add('open'); sq.onfocus = () => ps.classList.add('open'); sq.onblur = () => { if (!sq.value) ps.classList.remove('open'); }; sq.oninput = () => { q = sq.value.trim(); page = 0; render(); };
  if (qs.get('focus')) setTimeout(() => sq.focus(), 50);
  render(); let last = 0; APP.onUpdate(() => { if (Date.now() - last > 4000) { last = Date.now(); render(); } });
};
