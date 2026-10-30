/* Home, laid out like clanker.world: hero, "Trending now" cards, pills and the token table. ?sort= and ?q= deep links. */
window.PAGE = async () => {
  const { $, $$, esc, fmtNum, fmtUsd, fmtPct, shortAddr, ago, fmtDate, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search); let sort = qs.get('sort') || 'trend', q = qs.get('q') || '', page = 0; const PER = 25;
  const KEY = { new: (a, b) => b.createdAt - a.createdAt, trend: (a, b) => (b.vol24 * (1 + Math.max(0, b.c1) / 100)) - (a.vol24 * (1 + Math.max(0, a.c1) / 100)), vol: (a, b) => b.vol24 - a.vol24, mcap: (a, b) => b.mcapUsd - a.mcapUsd, fees: (a, b) => b.feesAll - a.feesAll };
  const chainImg = (t) => `<img class="ch" src="${C.chainOf(t.chains[0]).logo}" alt="">`;
  const state = (t) => { const f = t.fee; if (!f) return ''; if (f.kind === 'snipe') return `<span class="badge dn">snipe ${f.left}s</span>`; if (f.kind === 'vol') return `<span class="badge warn">${(f.total / 100).toFixed(1)}% fee</span>`; return t.createdAt > Date.now() / 1000 - 3600 ? `<span class="badge new">NEW</span>` : ''; };
  const created = (t) => { const age = Date.now() / 1000 - t.createdAt; if (age < 86400) return `${Math.floor(age / 3600)}h ${Math.floor((age % 3600) / 60)}m`; return new Date(t.createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: age > 86400 * 180 ? 'numeric' : undefined }); };
  const tcard = (t) => `<a class="tcard" href="${tokenUrl(t)}"><img src="${t.img}" alt=""><div style="min-width:0"><b>${esc(t.name)}<small>${esc(t.symbol)}</small></b><span>${fmtUsd(t.mcapUsd)}<i class="${t.c24 >= 0 ? 'up' : 'dn'}">${fmtPct(t.c24, false)}</i></span></div></a>`;
  const row = (t) => `<tr onclick="location.href='${tokenUrl(t)}'" style="cursor:pointer"><td><div class="tk"><div class="avw"><img class="av" src="${t.img}" alt="">${chainImg(t)}</div><div style="min-width:0"><b>${esc(t.name)}</b><small>${esc(t.symbol)} ${state(t)}</small></div></div></td><td><div class="by"><i>${t.creator.slice(2, 4).toUpperCase()}</i><span class="hm addr">${shortAddr(t.creator)}</span></div></td><td class="hm" style="color:var(--fg-2)">${created(t)}</td><td class="r">${fmtPct(t.c1)}</td><td class="r hm">${fmtPct(t.c24)}</td><td class="r hm">${fmtUsd(t.vol24 * APP.hypeUsd)}</td><td class="r hm">${fmtUsd(t.liqHype * APP.hypeUsd)}</td><td class="r hm"><b>${fmtUsd(t.mcapUsd)}</b></td></tr>`;
  function list() { let ts = DATA.tokens(); if (q) { const s = q.toLowerCase(); ts = ts.filter((t) => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.addr.includes(s) || (t.mint || '').toLowerCase().includes(s)); } return ts.sort(KEY[sort] || KEY.trend); }
  function render() {
    const all = DATA.tokens();
    $('#h-trend').innerHTML = all.slice().sort(KEY.trend).slice(0, 4).map(tcard).join('');
    const ts = list(), pages = Math.max(1, Math.ceil(ts.length / PER)); if (page >= pages) page = pages - 1;
    $('#h-rows').innerHTML = ts.slice(page * PER, page * PER + PER).map(row).join('') || `<tr><td colspan="8" class="empty">No coins match.</td></tr>`;
    $('#h-pager').innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="btn sm ${i === page ? 'pur' : ''}" data-p="${i}">${i + 1}</button>`).join('') : '';
    $$('#h-pager [data-p]').forEach((b) => b.onclick = () => { page = +b.dataset.p; render(); scrollTo({ top: $('#list').offsetTop - 70, behavior: 'smooth' }); });
    $$('#h-tabs [data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === sort)); $('#h-viewall').href = `?sort=${sort}#list`;
    const ql = $('#h-qlabel'); ql.classList.toggle('show', !!q); ql.textContent = q ? `Results for “${q}”` : '';
  }
  $$('#h-tabs [data-sort]').forEach((b) => b.onclick = () => { sort = b.dataset.sort; page = 0; history.replaceState(null, '', '?sort=' + sort + (q ? '&q=' + encodeURIComponent(q) : '') + '#list'); render(); });
  const sq = $('#top-q'); if (sq) { sq.value = q; sq.oninput = () => { q = sq.value.trim(); page = 0; render(); if (q) scrollTo({ top: $('#list').offsetTop - 70, behavior: 'smooth' }); }; if (qs.get('focus')) setTimeout(() => sq.focus(), 50); }
  render(); if (qs.get('sort') || location.hash === '#list') setTimeout(() => scrollTo({ top: $('#list').offsetTop - 70 }), 50);
  let last = 0; APP.onUpdate(() => { if (Date.now() - last > 4000) { last = Date.now(); render(); } });
};
