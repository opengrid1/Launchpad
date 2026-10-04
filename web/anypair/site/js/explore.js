/* Explore: every coin, filtered by what it is paired with. */
(function () {
  const U = () => window.UI;
  const VENUES = { uniswap: ['Uniswap', '/img/dex/uniswap.webp'], aerodrome: ['Aerodrome', '/img/dex/aerodrome.webp'], pancakeswap: ['PancakeSwap', '/img/dex/pancakeswap.webp'] };
  const qs = new URLSearchParams(location.search);
  const state = { dex: qs.get('dex') || 'all', pair: qs.get('pair') || 'all', sort: 'trending', view: localStorage.getItem('ap:view') || 'grid' };
  const visible = () => AP.tokens().filter(x => !x.hidden);
  function earnLine(x) {
    const { esc, tokImg } = U();
    if (!x.holderBps) return `<span class="earn">Creator keeps <b>1.2%</b></span>`;
    const assets = x.basket.length ? x.basket : [{ symbol: x.pairSym, logo: x.pairLogo }];
    return `<span class="earn"><span class="stack">${assets.map(a => tokImg(a, 'stack-i')).join('')}</span><span>Earn <b>${esc(assets.map(a => a.symbol).join(' + '))}</b></span></span>`;
  }
  function card(x) {
    const { esc, pairGlyph, usd, delta, spark, ago, coinHref } = U();
    return `<a class="card" href="${coinHref(x.addr)}">
      <div class="card-top">${pairGlyph(x)}<div class="card-name"><b>${esc(x.name)}</b><span>$${esc(x.symbol)} / <em>${esc(x.pairSym)}</em><img class="dexi" src="${(VENUES[x.venue] || VENUES.uniswap)[1]}" alt="${esc((VENUES[x.venue] || VENUES.uniswap)[0])}" title="${esc((VENUES[x.venue] || VENUES.uniswap)[0])}"></span></div>${x.demo ? '<span class="tag sample">Sample</span>' : `<span class="card-age">${ago(x.createdAt)}</span>`}</div>
      <div class="card-mid"><div class="mc"><span>Market cap</span><b>${usd(x.mc)}</b><div style="margin-top:6px">${delta(x.c24)} <span class="faint" style="font-size:12px">24h</span></div></div>${spark(x.spark, x.c24 >= 0)}</div>
      <div class="card-foot">${earnLine(x)}<span class="num">${usd(x.vol24)} <span class="faint">vol</span></span></div></a>`;
  }
  function row(x) {
    const { esc, pairGlyph, usd, delta, ago, num } = U();
    return `<tr data-href="/coin/${x.addr}"><td><div class="coin-cell">${pairGlyph(x, 'sm')}<div><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">$${esc(x.symbol)} / ${esc(x.pairSym)}</div></div></div></td>
      <td class="num">${usd(x.px)}</td><td>${delta(x.c1)}</td><td>${delta(x.c24)}</td><td class="num">${usd(x.mc)}</td><td class="num">${usd(x.vol24)}</td><td class="num">${usd(x.liq)}</td><td class="num">${num(x.tx24, 0)}</td><td>${earnLine(x)}</td><td class="num muted">${ago(x.createdAt)}</td></tr>`;
  }
  function sorted() {
    let list = visible(); if (state.pair !== 'all') list = list.filter(x => x.pair === state.pair); if (state.dex !== 'all') list = list.filter(x => x.venue === state.dex);
    const by = { trending: (a, b) => (b.vol24 + b.tx24 * 5) - (a.vol24 + a.tx24 * 5) || b.lastTrade - a.lastTrade, new: (a, b) => b.createdAt - a.createdAt, mc: (a, b) => b.mc - a.mc };
    return list.sort(by[state.sort]);
  }
  function paint() {
    const { esc, usd, tokImg, $ } = U(); const all = visible();
    // header numbers
    const vol = all.reduce((s, x) => s + x.vol24, 0); const paid = all.reduce((s, x) => s + x.totalHolderRewards * x.pairUsd, 0);
    $('#heroStats').innerHTML = `<div><span>Coins</span><b>${all.length}</b></div><div><span>24h volume</span><b>${usd(vol)}</b></div><div><span>Paid to holders</span><b>${usd(paid)}</b></div>`;
    // DEX filter chips: where each coin's pair trades
    const by = {}; for (const x of all) by[x.venue] = (by[x.venue] || 0) + 1;
    const chips = [['all', 'All', '', all.length], ...Object.keys(VENUES).map(k => [k, VENUES[k][0], VENUES[k][1], by[k] || 0])];
    $('#pairChips').innerHTML = chips.map(([k, name, logo, n]) => `<button class="chip ${state.dex === k ? 'on' : ''}" data-dex="${k}" role="tab" aria-selected="${state.dex === k}">${logo ? `<img src="${logo}" alt="">` : ''}${esc(name)} <span class="faint num">${n}</span></button>`).join('');
    
    const list = sorted(); const box = $('#coins');
    if (!all.length) { box.innerHTML = AP.prelaunch ? `<div class="panel empty"><h3>Launches open soon</h3><p>Coins show up here the moment launches open. You can already try the launch form with any token on Base.</p><a class="btn btn-primary" href="/launch">Try the launch form</a></div>` : `<div class="panel empty"><h3>No coins yet</h3><p>Be the first: pick a name, pick a pair, launch.</p><a class="btn btn-primary" href="/launch">Launch a coin</a></div>`; return; }
    if (state.view === 'list') box.innerHTML = `<div class="list-wrap"><table class="list"><thead><tr><th>Coin</th><th>Price</th><th>1h</th><th>24h</th><th>Market cap</th><th>Volume</th><th>Liquidity</th><th>Trades</th><th style="text-align:left">Rewards</th><th>Age</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`;
    else box.innerHTML = `<div class="grid">${list.map(card).join('')}</div>`;
    U().$$('tr[data-href]', box).forEach(tr => tr.onclick = () => location.href = tr.dataset.href);
  }
  function wire() {
    const { $, $$ } = U();
    $('#pairChips').onclick = e => { const b = e.target.closest('[data-dex]'); if (!b) return; state.dex = b.dataset.dex; state.pair = 'all'; history.replaceState(null, '', state.dex === 'all' ? '/' : '/?dex=' + state.dex); paint(); };
    $$('#sortSeg button').forEach(b => b.onclick = () => { state.sort = b.dataset.sort; $$('#sortSeg button').forEach(x => x.classList.toggle('on', x === b)); paint(); });
    $$('#viewSeg button').forEach(b => { b.classList.toggle('on', b.dataset.view === state.view); b.onclick = () => { state.view = b.dataset.view; try { localStorage.setItem('ap:view', state.view); } catch {} $$('#viewSeg button').forEach(x => x.classList.toggle('on', x === b)); paint(); }; });
  }
  function start() { wire(); const go = () => paint(); if (AP.tokens().length) go(); window.addEventListener('ap:ready', go); window.addEventListener('ap:update', go); if (!AP.prelaunch) setInterval(() => AP.refresh().catch(() => {}), 30000); }
  window.addEventListener('DOMContentLoaded', () => { if (window.AP) start(); else window.addEventListener('load', start); });
})();
