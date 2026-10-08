/* Home: the tape of open windows, and coins as cards. */
(function () {
  let sort = 'trend', timer = null;
  const SORTS = {
    trend: l => [...l].sort((a, b) => b.vol24 - a.vol24),
    kept: l => [...l].filter(x => x.keptPct != null).sort((a, b) => b.keptPct - a.keptPct || b.vol24 - a.vol24),
    new: l => [...l].sort((a, b) => b.createdAt - a.createdAt),
    stocks: l => [...l].filter(x => x.pair.kind === 'stock').sort((a, b) => b.vol24 - a.vol24),
  };

  function tape() {
    const { esc, eth, usd, winLabel, pairGlyph, coinHref, $ } = UI;
    const ws = UD.openWindows().slice(0, 14); const s = UD.stats();
    $('#tapeN').textContent = `${s.openCount} open windows · ${eth(s.openEth)} held`;
    const chip = w => `<a class="chip" href="${coinHref(w.x.addr)}" data-closes="${w.closes}" data-opened="${w.ts}">${pairGlyph(w.x, 'sm')}<span class="t"><b>${eth(w.eth)} of $${esc(w.x.symbol)}</b><small>${winLabel(w.hours)} window · closes in <span class="clock" data-c>—</span></small><span class="drain thin"><i data-d></i></span></span></a>`;
    const html = ws.map(chip).join(''); $('#tape').innerHTML = html + html; // doubled so the loop is seamless
  }
  function tick() {
    const now = UD.now();
    UI.$$('[data-closes]').forEach(el => { const closes = +el.dataset.closes, opened = +el.dataset.opened; const left = closes - now;
      const c = el.querySelector('[data-c]'); if (c) c.textContent = UI.clock(left); const d = el.querySelector('[data-d]'); if (d) d.style.width = (Math.max(0, left) / (closes - opened) * 100).toFixed(2) + '%'; });
  }

  function cards() {
    const { esc, usd, eth, delta, ring, pairGlyph, coinHref, winLabel, ago, $, $$ } = UI;
    const rows = SORTS[sort](UD.tokens()); const s = UD.stats();
    $('#totals').innerHTML = `<span class="faint" style="font-size:13px">${s.coins} coins · ${usd(s.vol24)} today · <span class="c-kept">${s.kept == null ? '—' : s.kept.toFixed(0) + '% kept'}</span></span>`;
    $('#grid').innerHTML = rows.map(x => { const open = x.trades.filter(t => t.state === 'open'); const newest = open[0];
      return `<a class="card" href="${coinHref(x.addr)}">
        <div class="ct">${pairGlyph(x)}<div class="t"><b>${esc(x.name)}</b><small>$${esc(x.symbol)} · <em>${esc(x.pair.symbol)}</em> · ${ago(x.createdAt)} old</small></div>${x.pair.kind === 'stock' ? '<span class="tag">stock</span>' : ''}</div>
        <div class="cm">${ring(x.keptPct, 52)}<div class="px"><b>${usd(x.px)}</b><small>${delta(x.c24)}<span>${usd(x.mc)} mcap</span></small></div></div>
        <div class="cb">${newest ? `<div class="row" data-closes="${newest.closes}" data-opened="${newest.ts}"><span>${open.length} open window${open.length === 1 ? '' : 's'} · ${eth(x.openEth)}</span><span class="clock">closes in <span data-c>—</span></span></div><div class="drain thin" data-closes="${newest.closes}" data-opened="${newest.ts}"><i data-d></i></div>` : `<div class="row"><span>No open windows</span></div><div class="drain thin"><i style="width:0"></i></div>`}
          <div class="stat"><span>Burned <b>${usd(x.burnedUsd)}</b></span><span>Vol 24h <b>${usd(x.vol24)}</b></span><span>Kept <b>${x.windowBuys - x.undos}/${x.windowBuys}</b></span></div></div></a>`; }).join('') || '<div class="empty" style="grid-column:1/-1"><p>No coins here yet.</p></div>';
    tick();
  }

  function start() {
    tape(); cards(); clearInterval(timer); timer = setInterval(tick, 1000);
    UI.$$('#sort [data-s]').forEach(b => b.onclick = () => { sort = b.dataset.s; UI.$$('#sort [data-s]').forEach(o => o.classList.toggle('down', o === b)); cards(); });
  }
  window.addEventListener('DOMContentLoaded', () => UD.ready.then(start));
})();
