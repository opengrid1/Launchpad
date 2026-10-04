/* Launch: logo, name, ticker, any pair, holder rewards in any tokens, optional first buy. */
(function () {
  let U, $, $$;
  const f = { logo: '', pair: null, rewards: true, basket: [] }; // pair/basket items: { info, disc, state: 'checking'|'ok'|'bad', err }
  const qs = new URLSearchParams(location.search);

  // ------------------------------------------------------------ logo: shrink until the data URI is small enough to store on-chain
  async function shrink(file) {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
    for (const [px, q] of [[128, .82], [112, .75], [96, .72], [80, .68], [64, .62]]) {
      const c = document.createElement('canvas'); c.width = c.height = px; const g = c.getContext('2d'); const s = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, px, px);
      const url = c.toDataURL('image/webp', q); if (url.length <= 6000 || px === 64) return url;
    }
  }
  // ------------------------------------------------------------ token picker (pair or basket)
  function picker(title, onPick, exclude) {
    const known = (window.ANYPAIR.tokens || []).filter(t => !exclude.includes(t.address.toLowerCase()));
    const used = {}; for (const x of AP.tokens()) used[x.pair] = (used[x.pair] || 0) + 1;
    const ov = U.dialog(title, `<div class="dialog-search">${U.ic('search')}<input id="pq" placeholder="Search or paste a token address" autocomplete="off" spellcheck="false"></div><div class="dialog-b" id="pl"></div>`);
    const inp = $('#pq', ov), out = $('#pl', ov);
    const render = async () => {
      const q = inp.value.trim().toLowerCase();
      const hits = known.filter(t => !q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase() === q);
      let extra = '';
      if (AP.isAddress(q) && !hits.length && !exclude.includes(q)) { extra = `<div class="opt-group">Token at this address</div><button class="opt" data-a="${q}">${U.letter('?')}<span class="t"><b>Looking up…</b><span class="mono">${U.short(q)}</span></span></button>`;
        AP.tokenInfo(q).then(i => { const b = out.querySelector(`[data-a="${q}"]`); if (b) b.innerHTML = `${U.tokImg(i)}<span class="t"><b>${U.esc(i.symbol)}</b><span>${U.esc(i.name)} · <span class="mono">${U.short(q)}</span></span></span><span class="r">Check pools</span>`; }).catch(() => {}); }
      out.innerHTML = extra + (hits.length ? `<div class="opt-group">${q ? 'Matches' : 'Popular on Base'}</div>` : '') + hits.map(t => `<button class="opt" data-a="${t.address.toLowerCase()}">${U.tokImg(t)}<span class="t"><b>${U.esc(t.symbol)}</b><span>${U.esc(t.name)}</span></span><span class="r">${used[t.address.toLowerCase()] ? `<b>${used[t.address.toLowerCase()]}</b>coins` : ''}</span></button>`).join('')
        + (!hits.length && !extra ? '<div class="empty" style="padding:30px"><p>Paste the token\'s contract address to use any token on Base.</p></div>' : '');
      $$('[data-a]', out).forEach(b => b.onclick = () => { ov.close(); onPick(b.dataset.a); });
    };
    inp.oninput = render; render(); setTimeout(() => inp.focus(), 20);
  }
  async function check(item) {
    item.state = 'checking'; paint();
    try { const w = window.apWallet; item.info = await AP.tokenInfo(item.addr); item.disc = await AP.discover(item.addr, w && w.connected ? w.address : undefined); item.state = item.disc.ready ? 'ok' : 'bad';
      if (!item.disc.ready) { const c = (item.disc.candidates || [])[0]; item.err = c ? (c.err || 'Pools too thin to price it') : 'No pool against ETH or USDC on Uniswap, Aerodrome or PancakeSwap'; } }
    catch (e) { item.state = 'bad'; item.err = AP.errText(e); }
    paint();
  }
  function statusHtml(item, isPair) {
    if (!item) return '';
    if (item.state === 'checking') return `<div class="status wait">${U.ic('search')}<span>Checking ${U.esc(item.info ? item.info.symbol : 'the token')}'s pools on Uniswap, Aerodrome and PancakeSwap…</span></div>`;
    if (item.state === 'bad') return `<div class="status bad">${U.ic('alert')}<span>${U.esc(item.err)}. ${isPair ? 'Pick another pair.' : 'Remove it or pick another.'}</span></div>`;
    const d = item.disc; if (item.addr === AP.weth) return `<div class="status ok">${U.ic('check')}<span>ETH, priced by Chainlink. Trades go straight through the pool.</span></div>`;
    if (d.listed) return `<div class="status ok">${U.ic('check')}<span>${U.esc(item.info.symbol)} has a fixed price source. Ready.</span></div>`;
    const last = (d.hops || [])[d.hops.length - 1]; const where = last ? AP.DEX_NAMES[last.dex] : 'its pool';
    return d.best ? `<div class="status ok">${U.ic('check')}<span>Priced from its ${U.esc(where)} pool against ${d.best.anchor === AP.usdc ? 'USDC' : 'ETH'} (${U.usd(d.best.depth)} deep). Your launch registers it.</span></div>`
      : `<div class="status ok">${U.ic('check')}<span>Already priced from ${U.esc(where)}. Ready.</span></div>`;
  }
  function pickPair(a) { a = a.toLowerCase(); f.pair = { addr: a, state: 'checking' }; f.basket = f.basket.filter(b => b.addr !== a); check(f.pair); }
  function addBasket(a) { a = a.toLowerCase(); if (f.basket.length >= 4 || f.basket.some(b => b.addr === a) || a === AP.weth) return; const it = { addr: a, state: 'checking' }; f.basket.push(it); check(it); }

  // ------------------------------------------------------------ paint
  function values() { return { name: $('#name').value.trim(), sym: $('#sym').value.trim().replace(/^\$/, '').toUpperCase(), desc: $('#desc').value.trim(), x: $('#lx').value.trim(), web: $('#lw').value.trim(), tg: $('#lt').value.trim(), dev: parseFloat($('#dev').value) || 0 }; }
  function paint() {
    const v = values(); const p = f.pair;
    $('#pairBtn').innerHTML = p && p.info ? `${U.tokImg(p.info)}<span class="t"><b>${U.esc(p.info.symbol)}</b><span>${U.esc(p.info.name)} · <span class="mono">${U.short(p.addr)}</span></span></span>${U.ic('down')}` : `${U.letter('?')}<span class="t"><b>Choose a token</b><span>ETH, USDC, cbBTC, AERO or paste any address</span></span>${U.ic('down')}`;
    $('#pairStatus').innerHTML = statusHtml(p, true);
    $('#rw').setAttribute('aria-checked', String(f.rewards)); $('#basketBox').classList.toggle('hidden', !f.rewards);
    $('#rwNote').textContent = f.rewards ? 'You keep 0.7%, holders share 0.5%, the platform takes 0.8%.' : 'Holders earn nothing; you keep 1.2% and the platform takes 0.8%.';
    const pairChip = p && p.info ? `<span class="chip" title="Always available">${U.tokImg(p.info)}${U.esc(p.info.symbol)} <span class="faint">pair</span></span>` : '';
    $('#basket').innerHTML = pairChip + f.basket.map((b, i) => `<span class="chip" style="${b.state === 'bad' ? 'border-color:var(--down)' : ''}">${b.info ? U.tokImg(b.info) : U.letter('…')}${U.esc(b.info ? b.info.symbol : '…')}${b.state === 'checking' ? ' <span class="faint">checking</span>' : ''}<button type="button" class="x" data-rm="${i}" aria-label="Remove">${U.ic('x')}</button></span>`).join('')
      + (f.basket.length < 4 ? `<button type="button" class="chip" id="addB">${U.ic('plus')}Add a token</button>` : '');
    $$('#basket .x svg, #addB svg').forEach(s => { s.style.width = '14px'; s.style.height = '14px'; });
    const bad = f.basket.filter(b => b.state === 'bad'); if (bad.length) $('#basket').insertAdjacentHTML('afterend', '');
    $('#basketBox').querySelectorAll('.status').forEach(n => n.remove()); bad.forEach(b => $('#basket').insertAdjacentHTML('afterend', statusHtml(b, false)));
    $$('[data-rm]').forEach(b => b.onclick = () => { f.basket.splice(+b.dataset.rm, 1); paint(); });
    const ab = $('#addB'); if (ab) ab.onclick = () => picker('Add a reward token', addBasket, [AP.weth, ...(p ? [p.addr] : []), ...f.basket.map(b => b.addr)]);
    preview(v); summary(v); ready(v);
  }
  function preview(v) {
    const p = f.pair && f.pair.info; const pairSym = p ? p.symbol : 'PAIR'; const assets = f.rewards ? (f.basket.filter(b => b.info).length ? f.basket.filter(b => b.info).map(b => b.info) : p ? [p] : []) : [];
    const x = { addr: '0xpreview' + (v.sym || 'x'), name: v.name || 'Your coin', symbol: v.sym || 'TICKER', img: f.logo, pairSym, pairLogo: p ? p.logo : '' };
    $('#pv').innerHTML = `<div class="card"><div class="card-top">${U.pairGlyph(x)}<div class="card-name"><b>${U.esc(x.name)}</b><span>$${U.esc(x.symbol)} / <em>${U.esc(pairSym)}</em></span></div><span class="card-age">new</span></div>
      <div class="card-mid"><div class="mc"><span>Market cap</span><b>$3.00K</b><div style="margin-top:6px"><span class="delta flat">+0.0%</span></div></div>${U.spark([1, 1, 1, 1], true)}</div>
      <div class="card-foot">${f.rewards ? `<span class="earn"><span class="stack">${assets.map(a => U.tokImg(a)).join('')}</span><span>Earn <b>${U.esc(assets.map(a => a.symbol).join(' + ') || '…')}</b></span></span>` : '<span class="earn">Creator keeps <b>1.2%</b></span>'}<span class="num faint">$0 vol</span></div></div>`;
  }
  async function summary(v) {
    const eth = await AP.ethUsd().catch(() => 0); const usd = v.dev * eth; const share = usd > 0 ? usd * .98 / (3000 + usd * .98) * 100 : 0;
    $('#sum').innerHTML = `<div><span>Start market cap</span><b class="num">$3,000</b></div><div><span>Supply</span><b class="num">1,000,000,000</b></div><div><span>Trading fee</span><b>2%</b></div>
      <div><span>You earn</span><b>${f.rewards ? '0.7%' : '1.2%'} of every trade</b></div><div><span>Holders earn</span><b>${f.rewards ? '0.5%' : 'nothing'}</b></div>
      <div><span>First buy</span><b class="num">${v.dev ? `${v.dev} ETH · ~${share.toFixed(1)}%` : 'none'}</b></div>`;
    $('#devNote').innerHTML = v.dev ? `About <b>${U.usd(usd)}</b>, roughly <b>${share.toFixed(2)}%</b> of the supply. Only you can buy in the launch block; after it a fee that starts at 99% and falls to 2% over 20 seconds stops snipers.` : 'Only you can buy in the launch block. Everyone else pays a fee that starts at 99% and falls to 2% over 20 seconds, so bots can\'t snipe the start.';
  }
  function problems(v) {
    const out = []; if (!v.name) out.push('a name'); if (!v.sym) out.push('a ticker'); if (!f.pair) out.push('a pair');
    else if (f.pair.state === 'checking') out.push('the pair check to finish'); else if (f.pair.state === 'bad') out.push('a pair that can be priced');
    if (f.rewards && f.basket.some(b => b.state !== 'ok')) out.push(f.basket.some(b => b.state === 'checking') ? 'reward tokens to finish checking' : 'reward tokens that can be priced');
    return out;
  }
  function ready(v) {
    const pr = problems(v); const w = window.apWallet; const btn = $('#launchBtn');
    $('#readyNote').textContent = pr.length ? 'Waiting for ' + pr.join(', ') + '.' : `$${v.sym} / ${f.pair.info.symbol}, ${f.rewards ? 'holders earn ' + ((f.basket.length ? f.basket.map(b => b.info.symbol) : [f.pair.info.symbol]).join(' + ')) : 'no holder rewards'}${v.dev ? `, first buy ${v.dev} ETH` : ''}.`;
    if (AP.prelaunch) { btn.disabled = true; btn.textContent = 'Launches open soon'; return; }
    btn.disabled = !!pr.length && !!(w && w.connected); btn.textContent = w && w.connected ? 'Launch coin' : 'Connect wallet to launch';
  }
  async function submit(e) {
    e.preventDefault(); if (AP.prelaunch) return; const w = apWallet; if (!w.connected) return w.open();
    const v = values(); if (problems(v).length) return; const btn = $('#launchBtn'); btn.disabled = true; btn.textContent = 'Confirm in your wallet…';
    try {
      const p = f.pair; const basket = f.rewards ? f.basket : [];
      const sources = [p, ...basket].flatMap(it => it.disc.sources || []);
      const routes = {}; for (const it of [p, ...basket]) if (it.addr !== AP.weth && it.disc.hops && it.disc.hops.length) routes[it.addr] = it.disc.hops;
      const meta = { description: v.desc, image: f.logo, website: v.web, x: v.x, telegram: v.tg, routes };
      const res = await AP.launch({ name: v.name, symbol: v.sym, meta, pair: p.addr, basket: basket.map(b => b.addr), holderRewards: f.rewards, sources, pairHops: p.disc.hops || [], devBuyWei: v.dev ? AP.parseUnits(String(v.dev), 18) : 0n });
      U.toast(`$${v.sym} is live`, { tx: res.rc.hash }); setTimeout(() => location.href = res.token ? '/coin/' + res.token : '/', 900);
    } catch (err) { U.toast(err.message || String(err), { err: true }); btn.disabled = false; ready(v); }
  }
  function start() {
    U = window.UI; $ = U.$; $$ = U.$$;
    $('#logo').onchange = async e => { const file = e.target.files[0]; if (!file) return; try { f.logo = await shrink(file); $('#logoPv').innerHTML = `<img src="${f.logo}" alt="">`; $('#logoNote').textContent = `Shrunk to ${(f.logo.length / 1024).toFixed(1)} KB for on-chain storage.`; paint(); } catch { U.toast('That image could not be read', { err: true }); } };
    ['name', 'sym', 'desc', 'lx', 'lw', 'lt', 'dev'].forEach(id => $('#' + id).addEventListener('input', paint));
    $('#dev').addEventListener('input', () => { $('#dev').value = $('#dev').value.replace(',', '.').replace(/[^0-9.]/g, ''); });
    $$('[data-dev]').forEach(b => b.onclick = () => { $('#dev').value = b.dataset.dev === '0' ? '' : b.dataset.dev; paint(); });
    $('#pairBtn').onclick = () => picker('Pair your coin with', pickPair, []);
    $('#rw').onclick = () => { f.rewards = !f.rewards; paint(); };
    $('#lf').onsubmit = submit;
    window.addEventListener('ap:wallet', paint);
    pickPair(qs.get('pair') && AP.isAddress(qs.get('pair')) ? qs.get('pair') : AP.weth);
  }
  window.addEventListener('DOMContentLoaded', start);
})();
