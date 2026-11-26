/* Launch: coin, pair (four popular keys plus every Ondo stock), first buy; then the coin card as it will look. */
(function () {
  const U = () => window.UI;
  const st = { name: '', sym: '', desc: '', logo: '', pair: null, dev: 0, lw: '', lx: '', lt: '' };
  let busy = false;
  const QUICK = ['ETH', 'PAXG', 'XAUt'];
  let popular = [], stocks = [];

  function paintPairs() {
    const { esc, usd, pairIcon, $, $$ } = U(); const p = st.pair;
    $('#pairkeys').innerHTML = QUICK.map(sym => popular.find(t => t.symbol === sym)).filter(Boolean).map(t => `<button type="button" class="pairkey ${p && p.symbol === t.symbol ? 'down' : ''}" data-p="${esc(t.symbol)}">${pairIcon(t)}<span class="t"><b>${esc(t.symbol)}</b><small>${esc(t.symbol === 'ETH' ? 'Ether' : t.symbol === 'PAXG' ? 'Gold, Paxos' : 'Gold, Tether')}</small></span></button>`).join('');
    $$('#pairkeys [data-p]').forEach(b => b.onclick = () => { st.pair = popular.find(t => t.symbol === b.dataset.p); paintPairs(); paintStocks(); paintPreview(); });
    $('#pairNote').textContent = !p ? '' : p.kind === 'stock' ? `${p.name}, ${usd(p.usd)} a share. Refunds and sells come back in ${p.symbol}, swappable to ETH in one click.` : p.symbol === 'ETH' ? 'The simplest pair. Refunds come back in ETH.' : `Refunds and sells come back in ${p.symbol}.`;
    $('#s2').classList.toggle('done', !!p);
  }
  // every tokenized stock, as a key with its logo; the grid scrolls, nothing is hidden behind a search
  let filter = '';
  function paintStocks() {
    const { esc, usd, pairIcon, $, $$ } = U(); const p = st.pair; const q = filter.trim().toLowerCase();
    const list = q ? stocks.filter(t => t.ticker.toLowerCase().startsWith(q) || t.name.toLowerCase().includes(q)) : stocks;
    $('#stocksN').textContent = `Tokenized stocks · ${stocks.length}${q ? ` · ${list.length} match` : ''}`;
    $('#stockgrid').innerHTML = list.map(t => `<button type="button" class="stockkey ${p && p.symbol === t.symbol ? 'down' : ''}" data-s="${esc(t.symbol)}" title="${esc(t.name)} · ${usd(t.usd)}">${pairIcon(t)}<b>${esc(t.ticker)}</b><small>${esc(t.name)}</small></button>`).join('') || '<div class="empty" style="grid-column:1/-1;padding:24px"><p>No ticker starts with that.</p></div>';
    $$('#stockgrid [data-s]').forEach(b => b.onclick = () => { st.pair = stocks.find(t => t.symbol === b.dataset.s); paintPairs(); paintStocks(); paintPreview(); });
  }
  function paintPreview() {
    const { esc, usd, eth, ring, pairIcon, coinAv, $ } = U(); const p = st.pair; const ok = st.name.trim() && st.sym.trim() && p;
    const fake = { symbol: st.sym || 'TICKER', hue: 48, img: st.logo };
    $('#preview').innerHTML = `<div class="lside-h">How it will look</div>
      <div class="card" style="pointer-events:none"><div class="ct"><span class="pg">${coinAv(fake)}${p ? pairIcon(p, 'pr') : ''}</span><div class="t"><b>${esc(st.name || 'Your coin')}</b><small>$${esc(st.sym || 'TICKER')} · <em>${p ? esc(p.symbol) : '—'}</em> · just launched</small></div></div>
        <div class="cm">${ring(null, 52)}<div class="px"><b>${usd(5000 / 1e9)}</b><small><span class="delta flat">0%</span><span>$5.0K mcap</span></small></div></div>
        <div class="cb"><div class="row"><span>No open windows</span></div><div class="drain thin"><i style="width:0"></i></div><div class="stat"><span>Burned <b>$0</b></span><span>Vol 24h <b>${st.dev ? usd(st.dev * UD.ethUsd()) : '$0'}</b></span><span>Kept <b>0/0</b></span></div></div></div>
      <div class="panel"><div class="panel-b"><div class="facts"><div><span>Supply</span><b>1B, all in the pool</b></div><div><span>Start</span><b>$5K market cap</b></div><div><span>Windows</span><b>30m to 7d, 0.05 ETH per 6h</b></div><div><span>Premiums</span><b>Burned</b></div><div><span>Tax</span><b>1%: 0.7% you, 0.3% platform</b></div><div><span>Protection</span><b>Anti-snipe minute, anti-sandwich</b></div><div><span>Your first buy</span><b>${st.dev ? eth(st.dev) + ', no window' : 'None'}</b></div></div></div></div>
      <div class="go"><button class="key lg wide yellow" id="launchGo" ${ok && !busy ? '' : 'disabled'}>${busy ? 'Confirm in your wallet…' : ok ? `Launch $${esc(st.sym.trim().toUpperCase())}` : 'Launch'}</button><p>${ok ? 'Costs gas only. The coin\'s rules can\'t be changed after launch, by you or by anyone.' : 'A name, a ticker and a pair to go.'}</p></div>`;
    $('#launchGo').onclick = launch;
    $('#s1').classList.toggle('done', !!(st.name.trim() && st.sym.trim())); $('#s3').classList.toggle('done', st.dev > 0);
  }
  async function launch() {
    const { toast } = U();
    if (!UD.live) { U().notLive(); return; }
    if (!(window.bsWallet && bsWallet.connected)) { window.bsWallet && bsWallet.open(); return; }
    const url = v => { v = v.trim(); return v && !/^https?:\/\//i.test(v) ? 'https://' + v : v; };
    const meta = { description: st.desc.trim() }; if (st.logo) meta.image = st.logo; if (st.lw.trim()) meta.website = url(st.lw); if (st.lx.trim()) meta.x = url(st.lx.replace(/^@/, 'x.com/')); if (st.lt.trim()) meta.telegram = url(st.lt.replace(/^@/, 't.me/'));
    busy = true; paintPreview();
    try {
      const { rc, token } = await UD.launch({ name: st.name.trim(), symbol: st.sym.trim().toUpperCase(), meta, pair: st.pair.address, devEth: st.dev || 0 });
      toast(`$${st.sym.trim().toUpperCase()} is live`, { tx: rc.hash });
      if (token) { location.href = '/coin/' + token; return; }
      location.href = '/';
    } catch (e) { toast(e.message, { err: true }); busy = false; paintPreview(); }
  }
  function shrink(file) {
    return new Promise(res => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d'); const s = Math.min(img.width, img.height); g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96);
      let q = .8, out = c.toDataURL('image/webp', q); while (out.length > 4500 && q > .2) { q -= .1; out = c.toDataURL('image/webp', q); } res(out); }; img.src = URL.createObjectURL(file); });
  }

  async function start() {
    const { $ } = U();
    const bind = (id, k, fn) => { const el = $('#' + id); el.oninput = () => { st[k] = fn ? fn(el.value) : el.value; if (k === 'sym') el.value = st.sym; paintPreview(); }; };
    bind('name', 'name'); bind('sym', 'sym', v => v.replace(/[^a-z0-9]/gi, '').toUpperCase()); bind('desc', 'desc'); bind('dev', 'dev', v => parseFloat(v) || 0); bind('lw', 'lw'); bind('lx', 'lx'); bind('lt', 'lt');
    $('#logoBtn').onclick = () => $('#logo').click(); $('#logo').onchange = async e => { const f = e.target.files[0]; if (!f) return; st.logo = await shrink(f); $('#logoPrev').innerHTML = `<img src="${st.logo}" alt="">`; $('#logoPrev').classList.remove('av-def'); paintPreview(); };
    paintPreview();
    ({ popular, stocks } = await UD.pairsList());
    const q = new URLSearchParams(location.search).get('pair'); if (q) st.pair = [...popular, ...stocks].find(t => t.symbol.toLowerCase() === q.toLowerCase()) || null;
    paintPairs(); paintStocks(); paintPreview();
    $('#stockq').oninput = () => { filter = $('#stockq').value; paintStocks(); };
  }
  window.addEventListener('DOMContentLoaded', () => UD.ready.then(start));
})();
