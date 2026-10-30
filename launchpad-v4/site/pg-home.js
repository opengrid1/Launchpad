/* Home ("Today"): stories, stats, live line, Suggested rows, Browse tiles, Top Charts, all coins. ?sort= and ?q= deep links. */
window.PAGE = async () => {
  const { $, $$, esc, fmtNum, fmtUsd, fmtPct, ago, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search); let sort = qs.get('sort') || 'new', q = qs.get('q') || '', page = 0; const PER = 20;
  $('#h-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const hue = (t) => { let h = 0; for (const ch of t.symbol) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const grad = (t) => `linear-gradient(150deg, hsl(${hue(t)} 70% 58%), hsl(${(hue(t) + 40) % 360} 70% 42%))`;
  const chainImgs = (t) => t.chains.map((c) => `<img src="${C.chainOf(c).logo}" alt="${c}">`).join('');
  const state = (t) => { const f = t.fee; if (!f) return ''; if (f.kind === 'snipe') return `<span class="badge dn"><i class="live"></i>snipe ${f.left}s</span>`; if (f.kind === 'vol') return `<span class="badge warn"><i class="live"></i>${(f.total / 100).toFixed(1)}% fee</span>`; return ''; };
  const story = (t, k, big) => `<a class="story ${big ? 'big' : ''}" href="${tokenUrl(t)}" style="--g:${grad(t)}"><span class="k">${k}</span><h3>${esc(t.name)}</h3><p>${esc(t.desc)}</p><div class="ft"><img src="${t.img}" alt=""><div class="t"><b>$${esc(t.symbol)} · ${fmtUsd(t.mcapUsd)}</b><span>${fmtPct(t.c24, false)} today · ${fmtNum(t.vol24, 0)} HYPE volume</span></div><span class="btn">Trade</span></div></a>`;
  const app = (t, opt = {}) => `<a class="app ${opt.hi ? 'hi' : ''}" href="${tokenUrl(t)}">${opt.n ? `<span class="n">${opt.n}</span>` : ''}<img class="av" src="${t.img}" alt=""><div class="t"><b>${esc(t.name)}</b><span>${chainImgs(t)} $${esc(t.symbol)} · ${t.age}${t.creatorTaxBps ? ` · +${t.creatorTaxBps / 100}% creator fee` : ''}${t.buyback ? ' · buyback' : ''} ${state(t)}</span>${opt.sub === false ? '' : `<small>${fmtUsd(t.mcapUsd)} · ${fmtPct(t.c24, false)} today · ${fmtNum(t.vol24, 1)} HYPE volume · ${t.holders} holders</small>`}</div><span class="btn ${opt.hi ? 'white' : ''}">Trade</span></a>`;
  const KEY = { new: (a, b) => b.createdAt - a.createdAt, trend: (a, b) => (b.vol24 * (1 + Math.max(0, b.c1) / 100)) - (a.vol24 * (1 + Math.max(0, a.c1) / 100)), vol: (a, b) => b.vol24 - a.vol24, mcap: (a, b) => b.mcapUsd - a.mcapUsd, fees: (a, b) => b.feesAll - a.feesAll };
  const TILES = [['New', 'new', '#5aa0ff,#2f6fe8'], ['Trending', 'trend', '#ffb067,#ff7a3d'], ['Top volume', 'vol', '#67d08a,#2fa85a'], ['Market cap', 'mcap', '#b48cff,#7f56e8'], ['Creator payouts', 'fees', '#ffd27a,#f0a63a'], ['HYPE pair', 'new', '#7ad9e0,#2fa8b8']];
  const TILE_ICON = { new: '<path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" fill="#fff"/>', trend: '<path d="M4 17l5-6 4 4 7-8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="7" r="2.5" fill="#fff"/>', vol: '<rect x="4" y="11" width="4" height="9" rx="1.5" fill="#fff"/><rect x="10" y="5" width="4" height="15" rx="1.5" fill="#fff"/><rect x="16" y="8" width="4" height="12" rx="1.5" fill="#fff"/>', mcap: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="3"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>', fees: '<path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7z" fill="#fff"/><path d="M9 12l2 2 4-4" stroke="#2fa85a" stroke-width="2" fill="none" stroke-linecap="round"/>' };
  function list() { let ts = DATA.tokens(); if (q) { const s = q.toLowerCase(); ts = ts.filter((t) => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.addr.includes(s) || (t.mint || '').toLowerCase().includes(s)); } return ts.sort(KEY[sort] || KEY.new); }
  function render() {
    const all = DATA.tokens(), trending = all.slice().sort(KEY.trend);
    $('#h-today').innerHTML = story(trending[0], 'Coin of the day', true) + trending.slice(1, 3).map((t, i) => story(t, i ? 'Rising' : 'Trending')).join('');
    $('#h-sug').innerHTML = trending.slice(3, 7).map((t, i) => app(t, { hi: i === 0 })).join('');
    $('#h-tiles').innerHTML = TILES.map(([l, s, g]) => `<a class="tile" href="?sort=${s}#all" style="--g:linear-gradient(150deg,${g})"><span>${l}</span><svg viewBox="0 0 24 24">${TILE_ICON[s] || TILE_ICON.new}</svg></a>`).join('');
    $('#h-top').innerHTML = all.slice().sort(KEY.vol).slice(0, 10).map((t, i) => app(t, { n: i + 1 })).join('');
    const ts = list(), pages = Math.max(1, Math.ceil(ts.length / PER)); if (page >= pages) page = pages - 1;
    $('#h-all-t').textContent = q ? `Results for “${q}”` : 'All coins';
    $('#h-list').innerHTML = ts.slice(page * PER, page * PER + PER).map((t) => app(t)).join('') || `<div class="empty">No coins match.</div>`;
    $('#h-pager').innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="btn sm ${i === page ? 'pri' : ''}" data-p="${i}">${i + 1}</button>`).join('') : '';
    $$('#h-pager [data-p]').forEach((b) => b.onclick = () => { page = +b.dataset.p; render(); scrollTo({ top: $('#all').offsetTop - 20, behavior: 'smooth' }); });
    const s = DATA.stats(); $('#h-stats').innerHTML = `<div class="sbox"><span class="lab">Launches</span><b class="num">${s.launches}</b><small>${s.launches24} today</small></div><div class="sbox"><span class="lab">Volume 24h</span><b class="num">${fmtNum(s.vol24, 0)} HYPE</b><small>${APP.usd(s.vol24)}</small></div><div class="sbox"><span class="lab">Paid to creators</span><b class="num">${fmtNum(s.creatorsPaid, 1)} HYPE</b><small>${APP.usd(s.creatorsPaid)}</small></div><div class="sbox"><span class="lab">HYPE</span><b class="num">${fmtUsd(APP.hypeUsd)}</b><small>${APP.gasGwei ? APP.gasGwei.toFixed(1) + ' gwei' : 'HyperEVM + Solana'}</small></div><div class="sbox"><span class="lab">Fee</span><b class="num">1%</b><small>70% to creators</small></div>`;
    const feed = all.flatMap((t) => DATA.trades(t.addr).slice(0, 2).map((tr) => ({ ...tr, t }))).sort((a, b) => b.ts - a.ts).slice(0, 8);
    $('#h-feed').innerHTML = feed.map((x) => `<span><img src="${x.t.img}" alt=""><b class="${x.buy ? 'up' : 'dn'}">${x.buy ? 'Buy' : 'Sell'}</b> ${fmtNum(x.hype, 2)} HYPE of $${esc(x.t.symbol)} on ${C.chainOf(x.chain).short} · ${ago(x.ts)}</span>`).join('');
    $$('#h-filters [data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === sort));
  }
  $$('#h-filters [data-sort]').forEach((b) => b.onclick = () => { sort = b.dataset.sort; page = 0; history.replaceState(null, '', '?sort=' + sort + (q ? '&q=' + encodeURIComponent(q) : '') + '#all'); render(); });
  const sq = $('#h-q'); sq.value = q; sq.oninput = () => { q = sq.value.trim(); page = 0; render(); if (q) scrollTo({ top: $('#all').offsetTop - 20, behavior: 'smooth' }); };
  render(); if (qs.get('sort') || location.hash === '#all') setTimeout(() => scrollTo({ top: $('#all').offsetTop - 20 }), 50);
  let last = 0; APP.onUpdate(() => { if (Date.now() - last > 4000) { last = Date.now(); render(); } });
};
