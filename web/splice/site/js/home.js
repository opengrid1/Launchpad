/* Explore: the board. A dense, sortable coin table (dexscreener-style) with a live stats strip,
   streaming tape and gene filters. Rows tick with the shared market clock (window.UD). */
(function () {
  const { $, $$, esc, usd, num, delta, ago, gc, avatar, coinHref, tick } = window.UI;

  // ---------------- market stats ----------------
  function statstrip() {
    const items = [
      ['Coins', 'coins'], ['24h volume', 'vol'], ['Fees to creators', 'fees'], ['Block', 'block'], ['ETH', 'eth'],
    ];
    $('#stats').innerHTML = `<span class="live"><i></i>LIVE <span class="faint">preview</span></span>` +
      items.map(([l, k]) => `<div class="stat-cell"><span>${l}</span><b class="num" data-stat="${k}"></b></div>`).join('');
    const s = UD.stats();
    $('[data-stat="coins"]').textContent = num(s.coins, 0);
    $('[data-stat="vol"]').textContent = usd(s.vol24);
    $('[data-stat="fees"]').textContent = usd(s.feesCreatorsEth * UD.ETH_USD);
    $('[data-stat="block"]').textContent = UD.block().toLocaleString('en-US');
    $('[data-stat="eth"]').textContent = usd(UD.ETH_USD);
  }
  function statTick() {
    const s = UD.stats();
    tick($('[data-stat="vol"]'), s.vol24, v => usd(v));
    tick($('[data-stat="fees"]'), s.feesCreatorsEth * UD.ETH_USD, v => usd(v));
    const b = $('[data-stat="block"]'); if (b) b.textContent = UD.block().toLocaleString('en-US');
  }

  // ---------------- tape ----------------
  const tapeRow = t => `<a class="tchip" href="${coinHref(t.coin.addr)}"><span class="delta ${t.buy ? 'up' : 'down'}">${t.buy ? 'BUY' : 'SELL'}</span><b>$${esc(t.coin.symbol)}</b><span class="muted">${t.eth} ETH</span><span class="faint">${ago(t.ts)}</span></a>`;
  function tape() {
    $('#tape').innerHTML = `<div class="tape-h"><i></i>Live trades <span class="faint">· preview</span></div><div class="tape" id="tapebody">${UD.tape().map(tapeRow).join('')}</div>`;
  }
  function onTrade(t) { const body = $('#tapebody'); if (!body) return;
    body.insertAdjacentHTML('afterbegin', tapeRow(t)); body.firstElementChild.classList.add('tchip-new');
    while (body.children.length > 24) body.lastElementChild.remove(); }

  // ---------------- the board ----------------
  const COLS = [
    { k: 'idx', l: '#', cls: 'rowidx l', sort: null, hide: 'hide-s' },
    { k: 'name', l: 'Token', cls: 'l', sort: 'name' },
    { k: 'price', l: 'Price', sort: 'price' },
    { k: 'c24', l: '24h %', sort: 'c24' },
    { k: 'ageHrs', l: 'Age', sort: 'ageHrs', hide: 'hide-s' },
    { k: 'vol24', l: 'Volume', sort: 'vol24', hide: 'hide-s' },
    { k: 'liq', l: 'Liquidity', sort: 'liq', hide: 'hide-m' },
    { k: 'mc', l: 'Mcap', sort: 'mc' },
    { k: 'holders', l: 'Holders', sort: 'holders', hide: 'hide-m' },
    { k: 'genes', l: 'Instincts', cls: 'l', sort: null, hide: 'hide-s' },
  ];
  let sortKey = 'trend', sortDir = -1;
  const genes = new Set();

  function list() {
    let arr;
    if (sortKey === 'trend') { arr = UD.trending(); if (sortDir === 1) arr = [...arr].reverse(); }
    else arr = [...UD.tokens()].sort((a, b) => {
      const asc = sortKey === 'name' ? a.name.localeCompare(b.name) : (a[sortKey] || 0) - (b[sortKey] || 0);
      return sortDir === -1 ? -asc : asc; // -1 = descending (default)
    });
    if (genes.size) arr = arr.filter(c => [...genes].every(g => c.genes.includes(g)));
    return arr;
  }

  function protoTag(c) {
    if (c.params.maxw && c.protected) return `<span class="mt" title="Max-wallet protection">MW <span class="bar"><span style="width:${Math.round(c.protectPct)}%"></span></span></span>`;
    const rem = UD.snipeRemaining(c);
    if (rem > 0) return `<span class="mt" title="Anti-snipe decaying">AS ${rem} blk <span class="bar snipe"><span style="width:${Math.round(100 - rem / c.params.snipe.decayBlocks * 100)}%"></span></span></span>`;
    return '';
  }
  const badge = c => c.ageHrs < 1 ? '<span class="nb new">NEW</span>' : (c.params.agent ? '<span class="nb agent">AGENT</span>' : '');

  function rowHtml(c, i) {
    return `<tr data-addr="${c.addr}">
      <td class="rowidx l hide-s">${i + 1}</td>
      <td class="l"><span class="tk">${avatar(c, 'sm')}<span class="t"><b>${esc(c.name)} <span class="muted" style="font-weight:500">$${esc(c.symbol)}</span>${badge(c)}</b><small>${esc(c.spec)}</small><span class="tk-genes">${c.genes.map(k => gc(k)).join('')}</span></span></span></td>
      <td class="mono" data-price>${usd(c.price, { compact: false })}</td>
      <td data-delta>${delta(c.c24)}</td>
      <td class="hide-s muted">${ago(c.createdTs)}</td>
      <td class="mono hide-s" data-vol>${usd(c.vol24)}</td>
      <td class="hide-m muted">${usd(c.liq)}</td>
      <td class="mono" data-mc>${usd(c.mc)}</td>
      <td class="hide-m muted">${num(c.holders, 0)}</td>
      <td class="l hide-s"><div class="genes">${c.genes.map(k => gc(k)).join('')}</div>${protoTag(c)}</td>
    </tr>`;
  }

  const rowEls = {};
  function board() {
    const arr = list();
    $('#noresult').hidden = arr.length > 0;
    const head = COLS.map(col => {
      const on = col.sort && col.sort === sortKey;
      return `<th class="${col.cls || ''} ${col.hide || ''} ${on ? 'on' : ''}" ${col.sort ? `data-sort="${col.sort}"` : ''}>${col.l}${on ? `<span class="dir">${sortDir < 0 ? '▼' : '▲'}</span>` : ''}</th>`;
    }).join('');
    $('#board').innerHTML = `<table class="coins"><thead><tr>${head}</tr></thead><tbody>${arr.map(rowHtml).join('')}</tbody></table>`;
    Object.keys(rowEls).forEach(k => delete rowEls[k]);
    $$('#board tbody tr').forEach(el => { rowEls[el.dataset.addr] = el; el.onclick = () => location.href = coinHref(el.dataset.addr); });
    $$('#board th[data-sort]').forEach(th => th.onclick = () => {
      const k = th.dataset.sort;
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; }
      $$('#tabs .sort').forEach(s => s.classList.remove('on'));
      board();
    });
  }

  function genefilter() {
    $('#genefilter').innerHTML = `<button class="gchip ${genes.size ? '' : 'on'}" data-g="all">All instincts</button>` +
      UD.GENE_ORDER.map(k => { const gd = UD.GENES[k]; return `<button class="gchip ${genes.has(k) ? 'on' : ''}" data-g="${k}">${gc(k)}${esc(gd.name)}</button>`; }).join('');
    $$('#genefilter .gchip').forEach(b => b.onclick = () => { const k = b.dataset.g; if (k === 'all') genes.clear(); else genes.has(k) ? genes.delete(k) : genes.add(k); genefilter(); board(); });
  }

  function onTick() {
    statTick();
    UD.tokens().forEach(c => { const el = rowEls[c.addr]; if (!el) return;
      tick(el.querySelector('[data-price]'), c.price, v => usd(v, { compact: false }));
      tick(el.querySelector('[data-mc]'), c.mc, v => usd(v));
      const d = el.querySelector('[data-delta]'); if (d) d.innerHTML = delta(c.c24);
    });
  }

  function init() {
    statstrip(); tape(); genefilter(); board();
    $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return;
      $$('#tabs .sort').forEach(s => s.classList.toggle('on', s === b));
      const t = b.dataset.tab;
      sortKey = t === 'trending' ? 'trend' : t === 'new' ? 'createdTs' : t === 'gainers' ? 'c24' : 'mc';
      sortDir = -1; board(); });
    UD.subscribe(ev => { if (ev.type === 'trade') onTrade(ev.trade); else onTick(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
