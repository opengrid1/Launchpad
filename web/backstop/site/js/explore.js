/* Explore: every strategy coin, the platform totals and the coins nearest a buyback. */
(function () {
  const U = () => window.UI;
  const qs = new URLSearchParams(location.search);
  const state = { f: qs.get('s') || 'all', sort: 'trending' };
  const FILTERS = [['all', 'All', null], ['v', 'Vault', x => x.split.vault > 0], ['d', 'Dip buyback', x => x.split.buyback > 0], ['t', 'Take profit', x => x.tp > 0], ['r', 'Redeem', x => x.redeem], ['h', 'Holder rewards', x => x.split.holders > 0], ['l', 'Auto-LP', x => x.split.lp > 0]];

  function ledger() {
    const { usd, num, $ } = U(); const s = BS.stats(); const all = BS.tokens();
    $('#ledger').innerHTML = `
      <div><span class="eyebrow">Coins</span><b>${s.coins}</b></div>
      <div class="v"><span class="eyebrow">In vaults</span><b>${usd(s.vaults)}</b></div>
      <div class="o"><span class="eyebrow">Burned</span><b>${usd(s.burnedUsd)}</b></div>
      <div class="o"><span class="eyebrow">Buyback funds</span><b>${usd(s.funds)}</b></div>`;
  }

  // where the price sits between its trigger (left) and its high (right)
  function ladderMini(x) {
    const f = x.fund; const span = f.ref - f.trigger; const at = Math.max(0, Math.min(1, (x.px - f.trigger) / (span || 1)));
    return `<div class="ladder-mini" aria-hidden="true"><span class="rail"></span><span class="fill" style="left:0;width:${(at * 100).toFixed(1)}%"></span><span class="tick" style="left:0"></span><span class="hi"></span><span class="now" style="left:${(at * 100).toFixed(1)}%"></span></div>`;
  }
  function watch() {
    const { esc, usd, pct, coinHref, pairGlyph, $ } = U();
    const list = BS.tokens().filter(x => x.fund && x.fund.usd > 1).sort((a, b) => b.toTrigger - a.toTrigger).slice(0, 3);
    $('#watch').innerHTML = list.map(x => `<a class="wcard" href="${coinHref(x.addr)}">
      <div class="t">${pairGlyph(x, 'sm')}<div style="min-width:0"><b>${esc(x.name)}</b><small>$${esc(x.symbol)}</small></div><div class="r"><b>${pct(x.toTrigger)}</b><small>to buyback</small></div></div>
      ${ladderMini(x)}</a>`).join('') || '<p class="muted">No coin has a buyback fund yet.</p>';
  }

  function filters() {
    const { esc, $ } = U(); const all = BS.tokens();
    $('#filters').innerHTML = FILTERS.map(([k, label, fn]) => `<button class="chip ${state.f === k ? 'on' : ''}" data-f="${k}" role="tab" aria-selected="${state.f === k}">${esc(label)} <span class="n">${fn ? all.filter(fn).length : all.length}</span></button>`).join('');
  }

  function backing(x) {
    const { usd } = U();
    if (!x.vault) return '<span class="faint">—</span>';
    const w = Math.max(2, Math.min(100, x.backedPct));
    return `<div class="gauge" title="The vault holds ${usd(x.vault.usd)} of ${x.pairSym}: ${usd(x.vault.perCoin)} for every coin"><div class="lbl">${x.backedPct.toFixed(1)}%</div><div class="bar"><i style="width:${w}%"></i></div></div>`;
  }
  function nextBuyback(x) {
    const { usd, pct } = U();
    if (!x.fund) return '<span class="faint">—</span>';
    const near = x.toTrigger > -8; const at = Math.max(0, Math.min(100, (1 - Math.min(20, -x.toTrigger) / 20) * 100));
    return `<div class="dist ${near ? 'near' : ''}" title="Buys back below ${usd(x.fund.trigger)} with half of ${usd(x.fund.usd)}"><div class="lbl">${pct(x.toTrigger)}</div><div class="track"><b style="left:${(100 - at).toFixed(1)}%"></b></div></div>`;
  }
  function row(x) {
    const { esc, pairGlyph, usd, delta, ago, stratBadges } = U();
    return `<tr data-href="/coin/${x.addr}">
      <td><div class="coin-cell">${pairGlyph(x, 'sm')}<div><b>${esc(x.name)}</b><small>$${esc(x.symbol)} · <em>${esc(x.pairSym)}</em></small></div></div></td>
      <td data-l="Price"><span class="num">${usd(x.px)}</span></td>
      <td data-l="24h">${delta(x.c24)}</td>
      <td data-l="Market cap"><span class="num">${usd(x.mc)}</span></td>
      <td data-l="Tax"><span class="num">${U().bps(x.tax)}</span></td>
      <td class="l" data-l="Backing">${backing(x)}</td>
      <td class="l" data-l="Next buyback">${nextBuyback(x)}</td>
      <td data-l="Volume" class="m-hide"><span class="num">${usd(x.vol24)}</span></td></tr>`;
  }
  function list() {
    const { $ } = U();
    let rows = BS.tokens(); const f = FILTERS.find(r => r[0] === state.f); if (f && f[2]) rows = rows.filter(f[2]);
    const by = {
      trending: (a, b) => b.vol24 + b.tx24 * 40 - (a.vol24 + a.tx24 * 40),
      new: (a, b) => b.createdAt - a.createdAt,
      dip: (a, b) => (b.toTrigger == null ? -1e9 : b.toTrigger) - (a.toTrigger == null ? -1e9 : a.toTrigger),
      backed: (a, b) => b.backedPct - a.backedPct,
    };
    rows = [...rows].sort(by[state.sort]);
    const box = $('#coins');
    if (!rows.length) { box.innerHTML = '<div class="empty"><h3>No coins run this strategy yet</h3><p>Be the first to launch one.</p><a class="btn btn-ink" href="/launch">Launch a coin</a></div>'; return; }
    box.innerHTML = `<table class="list"><thead><tr><th>Coin</th><th>Price</th><th>24h</th><th>Market cap</th><th>Tax</th><th class="l">Backing</th><th class="l">Next buyback</th><th>Volume</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
    U().$$('tr[data-href]', box).forEach(tr => tr.onclick = e => { if (e.metaKey || e.ctrlKey) window.open(tr.dataset.href); else location.href = tr.dataset.href; });
  }
  function paint() { ledger(); watch(); filters(); list(); }
  function wire() {
    const { $, $$ } = U();
    $('#filters').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; state.f = b.dataset.f; history.replaceState(null, '', state.f === 'all' ? '/' : '/?s=' + state.f); filters(); list(); };
    $$('#sortSeg button').forEach(b => b.onclick = () => { state.sort = b.dataset.sort; $$('#sortSeg button').forEach(x => x.classList.toggle('on', x === b)); list(); });
  }
  function start() { wire(); BS.ready.then(paint); }
  window.addEventListener('DOMContentLoaded', start);
})();
