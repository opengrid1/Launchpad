/* Home, laid out like the App Store's Search tab: title and avatar, search field, "Suggested ›" rows (the first one
   highlighted), "Browse ›" tiles, then every coin under a segmented control. ?sort=, ?q= and ?focus= deep links. */
window.PAGE = async () => {
  const { $, $$, esc, fmtNum, fmtUsd, fmtPct, ago, tokenUrl } = APP, C = CFG;
  const qs = new URLSearchParams(location.search); let sort = qs.get('sort') || 'new', q = qs.get('q') || '', page = 0; const PER = 30;
  const chainImgs = (t) => t.chains.map((c) => `<img src="${C.chainOf(c).logo}" alt="${c}">`).join('');
  const state = (t) => { const f = t.fee; if (!f) return ''; if (f.kind === 'snipe') return `<span class="badge dn"><i class="live"></i>snipe ${f.left}s</span>`; if (f.kind === 'vol') return `<span class="badge warn"><i class="live"></i>${(f.total / 100).toFixed(1)}% fee</span>`; return ''; };
  const sub = { new: (t) => `${fmtUsd(t.mcapUsd)} · ${fmtPct(t.c24, false)} today · ${t.holders} holders`, trend: (t) => `${fmtNum(t.vol24, 1)} HYPE volume · ${fmtPct(t.c1, false)} 1h`, vol: (t) => `${fmtNum(t.vol24, 1)} HYPE volume · ${t.buys24} buys · ${t.sells24} sells`, mcap: (t) => `${fmtUsd(t.mcapUsd)} · ${fmtNum(t.liqHype, 1)} HYPE locked`, fees: (t) => `${fmtNum(t.feesAll * 0.7, 2)} HYPE paid to the creator` };
  const app = (t, opt = {}) => `<a class="app ${opt.hi ? 'hi' : ''}" href="${tokenUrl(t)}">${opt.n ? `<span class="n">${opt.n}</span>` : ''}<img class="av" src="${t.img}" alt=""><div class="t"><b>${esc(t.name)}</b><span>${opt.plain ? esc(t.desc) : `${chainImgs(t)} $${esc(t.symbol)} · ${t.age}${t.creatorTaxBps ? ` · +${t.creatorTaxBps / 100}% creator fee` : ''}${t.buyback ? ' · buyback' : ''} ${state(t)}`}</span>${opt.plain ? '' : `<small>${(sub[sort] || sub.new)(t)}</small>`}</div><span class="btn ${opt.hi ? 'white' : ''}">Trade</span></a>`;
  const KEY = { new: (a, b) => b.createdAt - a.createdAt, trend: (a, b) => (b.vol24 * (1 + Math.max(0, b.c1) / 100)) - (a.vol24 * (1 + Math.max(0, a.c1) / 100)), vol: (a, b) => b.vol24 - a.vol24, mcap: (a, b) => b.mcapUsd - a.mcapUsd, fees: (a, b) => b.feesAll - a.feesAll };
  const TILES = [['Top Volume', 'vol', '#9ec2ff,#5e93f0', '🏆'], ['Trending', 'trend', '#ffbe8f,#f58a4b', '🔥'], ['New', 'new', '#9fdf9f,#4fb85e', '✨'], ['Market Cap', 'mcap', '#c9b2ff,#9472ec', '💎'], ['Payouts', 'fees', '#ffd79a,#f2b24a', '💰'], ['HYPE Pair', 'new', '#a3e3ea,#4ebbc9', '🪙']];
  function list() { let ts = DATA.tokens(); if (q) { const s = q.toLowerCase(); ts = ts.filter((t) => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.addr.includes(s) || (t.mint || '').toLowerCase().includes(s)); } return ts.sort(KEY[sort] || KEY.new); }
  function render() {
    const all = DATA.tokens(), trending = all.slice().sort(KEY.trend);
    $('#h-discover').classList.toggle('hidden', !!q);
    $('#h-sug').innerHTML = trending.slice(0, 3).map((t, i) => app(t, { hi: i === 0, plain: true })).join('');
    $('#h-tiles').innerHTML = TILES.map(([l, s, g, e]) => `<a class="tile" href="?sort=${s}#all" style="--g:linear-gradient(160deg,${g})"><span>${l}</span><em>${e}</em></a>`).join('');
    const ts = list(), pages = Math.max(1, Math.ceil(ts.length / PER)); if (page >= pages) page = pages - 1;
    const ranked = sort !== 'new';
    $('#h-all-t').textContent = q ? `Results for “${q}”` : 'All Coins';
    $('#h-list').innerHTML = ts.slice(page * PER, page * PER + PER).map((t, i) => app(t, { n: ranked ? page * PER + i + 1 : 0 })).join('') || `<div class="empty">No coins match.</div>`;
    $('#h-pager').innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="btn sm ${i === page ? 'pri' : ''}" data-p="${i}">${i + 1}</button>`).join('') : '';
    $$('#h-pager [data-p]').forEach((b) => b.onclick = () => { page = +b.dataset.p; render(); scrollTo({ top: $('#all').offsetTop - 8, behavior: 'smooth' }); });
    const feed = all.flatMap((t) => DATA.trades(t.addr).slice(0, 2).map((tr) => ({ ...tr, t }))).sort((a, b) => b.ts - a.ts).slice(0, 8);
    $('#h-feed').innerHTML = feed.map((x) => `<span><img src="${x.t.img}" alt=""><b class="${x.buy ? 'up' : 'dn'}">${x.buy ? 'Buy' : 'Sell'}</b> ${fmtNum(x.hype, 2)} HYPE of $${esc(x.t.symbol)} on ${C.chainOf(x.chain).short} · ${ago(x.ts)}</span>`).join('');
    $$('#h-tabs [data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === sort));
  }
  $$('#h-tabs [data-sort]').forEach((b) => b.onclick = () => { sort = b.dataset.sort; page = 0; history.replaceState(null, '', '?sort=' + sort + (q ? '&q=' + encodeURIComponent(q) : '') + '#all'); render(); });
  const sq = $('#h-q'); sq.value = q; sq.oninput = () => { q = sq.value.trim(); page = 0; render(); };
  if (qs.get('focus')) { $('#h-title').textContent = 'Search'; setTimeout(() => sq.focus(), 50); }
  render(); if (qs.get('sort') || location.hash === '#all') setTimeout(() => scrollTo({ top: $('#all').offsetTop - 8 }), 50);
  let last = 0; APP.onUpdate(() => { if (Date.now() - last > 4000) { last = Date.now(); render(); } });
};
