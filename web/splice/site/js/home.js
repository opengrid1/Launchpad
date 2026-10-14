/* Explore: a live market board. Market-stats strip, streaming trade tape, gene filters + sort
   tabs, and animated coin cards that tick with the shared market clock (window.UD). */
(function () {
  const { $, $$, esc, usd, num, delta, ago, geneChip, avatar, coinSpark, coinHref, tick } = window.UI;

  // ---------------- market stats ----------------
  function statstrip() {
    const s = UD.stats();
    const items = [
      ['Coins spliced', () => num(UD.stats().coins, 0), 'coins'],
      ['Volume 24h', () => usd(UD.stats().vol24), 'vol'],
      ['Fees to creators', () => usd(UD.stats().feesCreatorsEth * UD.ETH_USD), 'fees'],
      ['Block', () => num(UD.block(), 0), 'block'],
      ['ETH', () => usd(UD.ETH_USD), 'eth'],
    ];
    $('#stats').innerHTML = `<span class="live"><i></i>LIVE <span class="faint">preview</span></span>` + items.map(([l, , k]) =>
      `<div class="stat-cell"><span>${l}</span><b class="num" data-stat="${k}"></b></div>`).join('');
    items.forEach(([, fn, k]) => { const el = $(`[data-stat="${k}"]`); if (el) el.textContent = fn(); el && (el.dataset.v = ''); });
  }
  function statTick() {
    const s = UD.stats();
    tick($('[data-stat="vol"]'), s.vol24, v => usd(v));
    tick($('[data-stat="fees"]'), s.feesCreatorsEth * UD.ETH_USD, v => usd(v));
    const b = $('[data-stat="block"]'); if (b) b.textContent = num(UD.block(), 0);
  }

  // ---------------- tape ----------------
  function tapeRow(t) {
    return `<a class="tchip" href="${coinHref(t.coin.addr)}"><span class="delta ${t.buy ? 'up' : 'down'}">${t.buy ? 'BUY' : 'SELL'}</span><b>$${esc(t.coin.symbol)}</b><span class="muted mono">${t.eth} ETH</span><span class="faint">${ago(t.ts)}</span></a>`;
  }
  function tape() {
    $('#tape').innerHTML = `<div class="tape-h"><i></i>Live trades <span class="faint">preview</span></div><div class="tape" id="tapebody">${UD.tape().map(tapeRow).join('')}</div>`;
  }
  function onTrade(t) { const body = $('#tapebody'); if (!body) return;
    body.insertAdjacentHTML('afterbegin', tapeRow(t)); body.firstElementChild.classList.add('tchip-new');
    while (body.children.length > 24) body.lastElementChild.remove(); }

  // ---------------- cards ----------------
  function meter(c) {
    if (c.params.maxw && c.protected) return `<div class="meter maxw" title="Max-wallet lifts as the coin matures"><div class="meter-l"><span>Max-wallet · ${c.params.maxw.pct}%</span><span>${Math.round(c.protectPct)}%</span></div><div class="bar"><span style="width:${Math.round(c.protectPct)}%"></span></div></div>`;
    const rem = UD.snipeRemaining(c);
    if (rem > 0) return `<div class="meter snipe" title="Anti-snipe tax decaying to base"><div class="meter-l"><span>Anti-snipe decaying</span><span>${rem} blk</span></div><div class="bar snipe"><span style="width:${Math.round(100 - rem / c.params.snipe.decayBlocks * 100)}%"></span></div></div>`;
    return '';
  }
  function badge(c) { if (c.ageHrs < 1) return '<span class="nb new">NEW</span>'; if (c.params.agent) return '<span class="nb agent">AGENT</span>'; return ''; }
  function card(c) {
    return `<a class="card" href="${coinHref(c.addr)}" data-addr="${c.addr}">
      <div class="ct">${avatar(c)}<div class="t"><b>${esc(c.name)} ${badge(c)}</b><small>$${esc(c.symbol)} · ${esc(c.pair.symbol)} · ${ago(c.createdTs)}</small></div></div>
      <div class="cm"><span class="px num" data-mc>${usd(c.mc)}</span><div class="r">mcap<br><span data-delta>${delta(c.c24)}</span></div></div>
      <div class="sparkbox" data-spark>${coinSpark(c)}</div>
      <div class="genes">${c.genes.map(k => geneChip(k)).join('')}</div>
      ${meter(c)}
      <div class="stat"><span>Vol <b>${usd(c.vol24)}</b></span><span>Liq <b>${usd(c.liq)}</b></span><span>Hold <b>${num(c.holders, 0)}</b></span></div>
    </a>`;
  }

  // ---------------- filters + render ----------------
  let tab = 'trending'; const genes = new Set();
  function list() {
    let arr = tab === 'new' ? UD.newest() : tab === 'gainers' ? [...UD.tokens()].sort((a, b) => b.c24 - a.c24)
      : tab === 'mc' ? [...UD.tokens()].sort((a, b) => b.mc - a.mc) : UD.trending();
    if (genes.size) arr = arr.filter(c => [...genes].every(g => c.genes.includes(g)));
    return arr;
  }
  const cardEls = {};
  function grid() {
    const arr = list(); const g = $('#grid');
    $('#noresult').hidden = arr.length > 0;
    g.innerHTML = arr.map(card).join('');
    Object.keys(cardEls).forEach(k => delete cardEls[k]);
    $$('#grid .card').forEach(el => cardEls[el.dataset.addr] = el);
  }
  function genefilter() {
    $('#genefilter').innerHTML = `<button class="gchip ${genes.size ? '' : 'on'}" data-g="all">All genes</button>` +
      UD.GENE_ORDER.map(k => { const gd = UD.GENES[k]; return `<button class="gchip ${genes.has(k) ? 'on' : ''}" data-g="${k}"><span class="gene ${gd.cls}" style="padding:0;border:none;background:none"><span class="dot"></span></span>${esc(gd.name)}</button>`; }).join('');
    $$('#genefilter .gchip').forEach(b => b.onclick = () => { const k = b.dataset.g; if (k === 'all') genes.clear(); else genes.has(k) ? genes.delete(k) : genes.add(k); genefilter(); grid(); });
  }

  function onTick() {
    statTick();
    const arr = list();
    arr.forEach(c => { const el = cardEls[c.addr]; if (!el) return;
      tick(el.querySelector('[data-mc]'), c.mc, v => usd(v));
      const d = el.querySelector('[data-delta]'); if (d) d.innerHTML = delta(c.c24);
      const m = el.querySelector('[data-spark]'); // refresh sparkline occasionally handled below
    });
  }
  let sparkN = 0;
  function sparkRefresh() { sparkN++; if (sparkN % 6) return; Object.entries(cardEls).forEach(([a, el]) => { const c = UD.coin(a); const box = el.querySelector('[data-spark]'); if (c && box) box.innerHTML = coinSpark(c); }); }

  function init() {
    statstrip(); tape(); genefilter(); grid();
    $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return;
      $$('#tabs .sort').forEach(s => s.classList.toggle('on', s === b)); tab = b.dataset.tab; grid(); });
    UD.subscribe(ev => { if (ev.type === 'trade') onTrade(ev.trade); else { onTick(); sparkRefresh(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
