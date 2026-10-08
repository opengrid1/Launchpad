/* Launch form: coin, pair (popular tokens or any Ondo stock), undo window, where undo fees go, undo budget, first buy. */
(function () {
  const U = () => window.UI;
  const st = { name: '', sym: '', desc: '', logo: '', pair: null, windowH: 6, feeTo: 'holders', budget: 0, dev: 0 };
  const WINDOWS = [[1, '1 hour', 'Quick cooling-off'], [6, '6 hours', 'Sleep on it'], [24, '24 hours', 'A full day'], [0, 'No undo', 'A plain coin']];

  async function pickPair() {
    const { dialog, ic, esc, usd, pairIcon, $, $$ } = U();
    const ov = dialog('Pair', `<div class="dialog-search">${ic('search')}<input id="pq" placeholder="ETH, gold, TSLA, NVDA, SPY…" autocomplete="off" spellcheck="false"></div><div class="dialog-b" id="pr"><div class="empty"><p>Loading…</p></div></div>`);
    const { popular, stocks } = await UD.pairsList(); const inp = $('#pq', ov), out = $('#pr', ov);
    const row = p => `<button class="opt" data-p="${esc(p.symbol)}">${pairIcon(p)}<span class="t"><b>${esc(p.symbol)}</b><span>${esc(p.name)}</span></span><span class="r"><b>${p.usd ? usd(p.usd) : ''}</b>${p.kind === 'stock' ? '<span class="faint">stock</span>' : ''}</span></button>`;
    const render = () => { const q = inp.value.trim().toLowerCase();
      const pop = popular.filter(p => !q || p.symbol.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q));
      const stk = stocks.filter(p => !q || p.symbol.toLowerCase().includes(q) || p.ticker.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, q ? 40 : 12);
      out.innerHTML = (pop.length ? `<div class="opt-group">Popular</div>${pop.map(row).join('')}` : '') + (stk.length ? `<div class="opt-group">Tokenized stocks · ${stocks.length} on Ethereum via Ondo</div>${stk.map(row).join('')}${!q && stocks.length > 12 ? '<div class="faint" style="padding:8px 10px;font-size:12.5px">Search for the rest.</div>' : ''}` : '') || '<div class="empty"><p>Nothing matches.</p></div>';
      $$('[data-p]', out).forEach(b => b.onclick = () => { st.pair = [...popular, ...stocks].find(p => p.symbol === b.dataset.p); ov.close(); paintPair(); paintSum(); }); };
    inp.oninput = render; render(); setTimeout(() => inp.focus(), 20);
  }
  function paintPair() {
    const { esc, usd, pairIcon, $ } = U(); const p = st.pair;
    $('#pairBtn').innerHTML = p ? `${pairIcon(p)}<span class="t"><b>${esc(p.symbol)}</b><small>${esc(p.name)} · ${usd(p.usd)}</small></span><span class="tag">Change</span>` : `<span class="stock-chip" style="width:34px;height:34px;background:var(--sunk)"></span><span class="t"><b>Choose a pair</b><small>ETH, USDC, BTC, gold, or any of 500+ tokenized stocks</small></span>`;
    $('#pairNote').textContent = !p ? '' : p.kind === 'stock' ? `Buyers can pay in ETH; the router swaps it to ${p.symbol} on the way in. Refunds come back in ${p.symbol}.` : p.symbol === 'ETH' ? 'The simplest pair. Refunds come back in ETH.' : `Buyers can pay in ETH or ${p.symbol}. Refunds come back in ${p.symbol}.`;
    $('#budgetUnit').textContent = p ? p.symbol : 'ETH';
  }
  function paintWindow() {
    const { $, $$, curve } = U();
    $('#winPick').innerHTML = WINDOWS.map(([h, l, d]) => `<button type="button" data-w="${h}" class="${h === st.windowH ? 'on' : ''}"><b>${l}</b><small>${d}</small></button>`).join('');
    $$('#winPick button').forEach(b => b.onclick = () => { st.windowH = +b.dataset.w; paintWindow(); paintSum(); });
    $('#curveBox').innerHTML = st.windowH ? curve(st.windowH, null) : '<small class="muted">Without a window, every buy is final. Buyers see "No undo" on the coin.</small>';
    $$('#feePick button').forEach(b => { b.classList.toggle('on', b.dataset.f === st.feeTo); b.onclick = () => { st.feeTo = b.dataset.f; paintWindow(); paintSum(); }; });
  }
  function paintSum() {
    const { esc, usd, winLabel, pairIcon, $ } = U(); const p = st.pair; const ok = st.name.trim() && st.sym.trim() && p;
    $('#sumBody').innerHTML = `<div class="card-prev"><span class="pg">${st.logo ? `<span class="av"><img src="${st.logo}" alt=""></span>` : `<span class="av" style="--h:48">${esc((st.sym || st.name || '?')[0])}</span>`}${p ? pairIcon(p, 'pr') : ''}</span><div><b style="font-weight:600">${esc(st.name || 'Your coin')}</b><div class="muted" style="font-size:12.5px">$${esc(st.sym || 'TICKER')}${p ? ' · ' + esc(p.symbol) : ''}</div></div></div>
      <div class="facts" style="margin-top:14px"><div><span>Pair</span><b>${p ? esc(p.symbol) : '—'}</b></div><div><span>Undo window</span><b>${winLabel(st.windowH)}</b></div><div><span>Undo fees go to</span><b>${st.windowH ? (st.feeTo === 'burn' ? 'Burned' : 'Holders') : '—'}</b></div><div><span>Tax</span><b>1% · 0.5% you, 0.3% platform, 0.2% reserve</b></div><div><span>Undo budget</span><b>${st.budget ? `${st.budget} ${esc(p ? p.symbol : 'ETH')}` : 'None'}</b></div><div><span>Start</span><b>$5K market cap, 1B supply</b></div><div><span>Your first buy</span><b>${st.dev ? st.dev + ' ETH' : 'None'}</b></div></div>`;
    $('#launchGo').disabled = !ok; $('#launchGo').textContent = ok ? `Launch $${st.sym.trim().toUpperCase()}` : 'Launch';
    $('#goNote').textContent = ok ? 'Launch costs gas only, about $2 at today\'s prices. The pool, the tax split and the window are fixed at launch and can\'t be changed.' : 'Name, ticker and a pair to go.';
  }
  // logo: shrink to a small square webp that fits in the coin's on-chain metadata
  function shrink(file) {
    return new Promise(res => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d'); const s = Math.min(img.width, img.height); g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96);
      let q = .8, out = c.toDataURL('image/webp', q); while (out.length > 4500 && q > .2) { q -= .1; out = c.toDataURL('image/webp', q); } res(out); }; img.src = URL.createObjectURL(file); });
  }

  function start() {
    const { $, notLive } = U();
    const bind = (id, k, fn) => { const el = $('#' + id); el.oninput = () => { st[k] = fn ? fn(el.value) : el.value; paintSum(); if (k === 'sym' || k === 'name') $('#logoPrev').textContent = (st.sym || st.name || 'C')[0].toUpperCase(); }; };
    bind('name', 'name'); bind('sym', 'sym', v => v.replace(/[^a-z0-9]/gi, '').toUpperCase()); bind('desc', 'desc'); bind('budget', 'budget', v => parseFloat(v) || 0); bind('dev', 'dev', v => parseFloat(v) || 0);
    $('#sym').addEventListener('input', () => { $('#sym').value = st.sym; });
    $('#logoBtn').onclick = () => $('#logo').click(); $('#logo').onchange = async e => { const f = e.target.files[0]; if (!f) return; st.logo = await shrink(f); $('#logoPrev').innerHTML = `<img src="${st.logo}" alt="">`; paintSum(); };
    $('#pairBtn').onclick = pickPair;
    const q = new URLSearchParams(location.search).get('pair'); if (q) UD.pairsList().then(({ popular, stocks }) => { st.pair = [...popular, ...stocks].find(p => p.symbol.toLowerCase() === q.toLowerCase()) || null; paintPair(); paintSum(); });
    $('#launchGo').onclick = notLive;
    paintPair(); paintWindow(); paintSum();
  }
  window.addEventListener('DOMContentLoaded', () => UD.ready.then(start));
})();
