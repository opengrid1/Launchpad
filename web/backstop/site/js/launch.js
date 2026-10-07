/* Launch form: coin details, the backing token (checked live on Ethereum), the tax and its split, and the strategy options. */
(function () {
  const U = () => window.UI;
  const STEP = 5, PLATFORM = 80, TAX_MIN = 100, TAX_MAX = 1000, TAX_STEP = 50; // basis points
  const pool = () => st.tax - PLATFORM; // what the creator splits
  // presets are shapes; scale one to the current tax in 0.05% steps
  function scaled(split, to) { const keys = Object.keys(split); const tot = keys.reduce((a, k) => a + split[k], 0) || 1; const out = {};
    keys.forEach(k => { out[k] = Math.round(split[k] * to / tot / STEP) * STEP; }); const big = keys.reduce((a, k) => out[k] > out[a] ? k : a, keys[0]); out[big] += to - keys.reduce((a, k) => a + out[k], 0); return out; }
  const PRESETS = [
    { k: 'strategy', name: 'Strategy', d: 'Vault + dip buybacks', split: { creator: 30, holders: 0, vault: 70, buyback: 50, lp: 0 }, tp: 50, redeem: false },
    { k: 'floor', name: 'Floor', d: 'Big vault, redeemable', split: { creator: 30, holders: 0, vault: 120, buyback: 0, lp: 0 }, tp: 0, redeem: true },
    { k: 'dips', name: 'Dip defender', d: 'All buybacks', split: { creator: 40, holders: 0, vault: 0, buyback: 80, lp: 30 }, tp: 0, redeem: false },
    { k: 'deep', name: 'Deep pool', d: 'Liquidity grows every trade', split: { creator: 30, holders: 0, vault: 40, buyback: 30, lp: 50 }, tp: 0, redeem: false },
    { k: 'yield', name: 'Yield', d: 'Holders paid in ETH', split: { creator: 30, holders: 90, vault: 30, buyback: 0, lp: 0 }, tp: 0, redeem: true, payout: 'eth' },
  ];
  const ROWS = [
    ['creator', 'You', 'Paid to your wallet', 's-creator'],
    ['holders', 'Holders', 'Shared by balance', 's-holders'],
    ['vault', 'Vault', 'Holds the backing token', 's-vault'],
    ['buyback', 'Buyback', 'Buys and burns on 20% dips', 's-bb'],
    ['lp', 'Auto-LP', 'Locked liquidity in the pool', 's-lp'],
  ];
  const st = { name: '', sym: '', desc: '', logo: '', pair: null, check: null, tax: 200, split: { ...PRESETS[0].split }, preset: 'strategy', tp: 50, redeem: false, payout: 'pair', basket: [], dev: 0 };
  let gas = null, eth = null;

  const used = () => st.split.creator + st.split.holders + st.split.vault + st.split.buyback + st.split.lp;
  const S = () => '$' + (st.sym || 'TICKER');

  // ------------------------------------------------------------ backing token
  function paintPair() {
    const { esc, tokImg, ic } = U(); const p = st.pair; const b = U().$('#pairBtn');
    b.innerHTML = p ? `${tokImg(p, '')}<span><b>${esc(p.symbol)}</b><small>${esc(p.name || '')}${p.address ? ' · ' + U().short(p.address) : ''}</small></span>${ic('down')}` : `<span><b>Choose a token</b><small>Search or paste an Ethereum address</small></span>${ic('down')}`;
    const box = U().$('#pairStatus'); const c = st.check;
    if (!p) { box.innerHTML = ''; return; }
    if (!c) { box.innerHTML = `<div class="check wait">${ic('info')}<span>Checking ${esc(p.symbol)} on Ethereum…</span></div>`; return; }
    if (c.error) { box.innerHTML = `<div class="check bad">${ic('alert')}<span>${esc(c.error)}</span></div>`; return; }
    const pools = (c.pools || []).filter(r => isFinite(r.depthUsd)).slice(0, 3);
    const list = pools.length ? `<div class="pools">${pools.map(r => `<span><span>${esc(r.label)}</span><span>${U().usd(r.depthUsd)} ${esc(r.quote)}</span></span>`).join('')}</div>` : '';
    box.innerHTML = c.ok ? `<div class="check ok">${ic('check')}<span><b>${esc(c.symbol)} can back a coin.</b> ${c.note ? esc(c.note) : `Priced at ${U().usd(c.priceUsd)} from its deepest pool.`}${list}</span></div>`
      : `<div class="check bad">${ic('alert')}<span><b>${esc(c.symbol || 'This token')} can't back a coin yet.</b> ${esc(c.reason)}${list}</span></div>`;
  }
  async function setPair(t) {
    st.pair = t; st.check = null; st.basket = st.basket.filter(a => a !== (t && t.address || '').toLowerCase()); paintPair(); paintAll();
    const want = t.address;
    try { const c = await BS.checkToken(t.address); if (st.pair && st.pair.address === want) { st.check = c; if (c.symbol && !t.logo) st.pair = { ...t, symbol: c.symbol, name: c.name }; } }
    catch (e) { if (st.pair && st.pair.address === want) st.check = { error: 'Could not reach Ethereum to check this token. Try again in a moment.' }; }
    paintPair(); paintAll();
  }
  function openPicker() {
    const { esc, tokImg, dialog, $, $$ } = U();
    const ov = dialog('Backing token', `<div class="dialog-search">${U().ic('search')}<input id="pq" placeholder="Search or paste an address" autocomplete="off" spellcheck="false"></div><div class="dialog-b" id="pr"></div>`);
    const inp = $('#pq', ov), out = $('#pr', ov);
    const render = () => { const q = inp.value.trim().toLowerCase(); const all = BS.knownList();
      if (BS.isAddress(q)) { const k = BS.known(q); out.innerHTML = `<button class="opt" data-a="${q}">${tokImg(k || {}, 'ti')}<span class="t"><b>${esc(k ? k.symbol : 'Use this address')}</b><span class="mono">${esc(q)}</span></span></button>`; }
      else { const hits = q ? all.filter(t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) : all; const groups = [...new Set(hits.map(t => t.group))];
        out.innerHTML = groups.map(g => `<div class="opt-group">${esc(g)}</div>` + hits.filter(t => t.group === g).map(t => `<button class="opt" data-a="${t.address.toLowerCase()}">${tokImg(t, 'ti')}<span class="t"><b>${esc(t.symbol)}</b><span>${esc(t.name)}</span></span></button>`).join('')).join('') || '<div class="empty" style="padding:30px"><p>No match. Paste the token address instead.</p></div>'; }
      $$('[data-a]', out).forEach(b => b.onclick = () => { const a = b.dataset.a; const k = BS.known(a); setPair(k ? { ...k, address: a } : { address: a, symbol: U().short(a), name: 'Checking…', logo: '' }); ov.close(); }); };
    inp.oninput = render; render(); setTimeout(() => inp.focus(), 20);
  }

  // ------------------------------------------------------------ split
  function paintPresets() {
    U().$('#presets').innerHTML = PRESETS.map(p => `<button type="button" data-p="${p.k}" class="${st.preset === p.k ? 'on' : ''}"><b>${p.name}</b><small>${p.d}</small></button>`).join('');
  }
  function paintTax() {
    const { bps } = U(); const t = st.tax;
    U().$('#taxBox').innerHTML = `<div class="tax-top"><div><b>Tax on every buy and sell</b><small>${bps(PLATFORM)} goes to the platform. You split the other <b class="mono">${bps(pool())}</b> below.</small></div>
      <div class="stepper tax-step"><button type="button" data-tax="-1" aria-label="Lower tax" ${t <= TAX_MIN ? 'disabled' : ''}>−</button><output>${bps(t)}</output><button type="button" data-tax="1" aria-label="Higher tax" ${t >= TAX_MAX ? 'disabled' : ''}>+</button></div></div>
      <input type="range" class="tax-range" id="taxRange" min="${TAX_MIN}" max="${TAX_MAX}" step="${TAX_STEP}" value="${t}" aria-label="Tax" style="--at:${((t - TAX_MIN) / (TAX_MAX - TAX_MIN) * 100).toFixed(1)}%">
      <div class="tax-ticks"><span>1%</span><span>${t > 500 ? 'Over 5% is flagged by some scanners and aggregators' : 'Lower tax, easier to trade'}</span><span>10%</span></div>`;
  }
  function setTax(t) { t = Math.max(TAX_MIN, Math.min(TAX_MAX, Math.round(t / TAX_STEP) * TAX_STEP)); if (t === st.tax) return; st.tax = t;
    const u = used(); st.split = u ? scaled(st.split, pool()) : { ...st.split, creator: pool() }; paintAll(); }
  function paintAlloc() {
    const { bps, esc } = U(); const left = pool() - used();
    U().$('#alloc').innerHTML = ROWS.map(([k, name, d, cls]) => `<div class="arow"><i class="${cls}"></i><div><b>${name}</b><small>${d}</small></div>
      <div class="stepper"><button type="button" data-k="${k}" data-d="-1" aria-label="Less to ${esc(name)}" ${st.split[k] <= 0 ? 'disabled' : ''}>−</button><output>${bps(st.split[k])}</output><button type="button" data-k="${k}" data-d="1" aria-label="More to ${esc(name)}" ${left <= 0 ? 'disabled' : ''}>+</button></div></div>`).join('')
      + `<div class="arow fixed"><i class="s-platform"></i><div><b>Platform</b><small>Fixed</small></div><div class="stepper"><span></span><output>${bps(PLATFORM)}</output><span></span></div></div>`;
    const parts = [['creator', st.split.creator], ['holders', st.split.holders], ['vault', st.split.vault], ['bb', st.split.buyback], ['lp', st.split.lp], ['platform', PLATFORM]].filter(p => p[1] > 0);
    const m = U().$('#meter'); m.classList.toggle('short', left > 0);
    m.innerHTML = `<div class="split">${parts.map(p => `<i class="s-${p[0]}" style="flex:${p[1]}"></i>`).join('')}${left > 0 ? `<i style="flex:${left};background:repeating-linear-gradient(45deg,var(--line) 0 4px,transparent 4px 8px)"></i>` : ''}</div><b>${left > 0 ? bps(left) + ' left to assign' : bps(st.tax) + ' assigned'}</b>`;
  }

  // ------------------------------------------------------------ options
  function paintOpts() {
    const { esc, tokImg } = U(); const v = st.split.vault > 0, h = st.split.holders > 0, bb = st.split.buyback > 0, lp = st.split.lp > 0;
    const pairSym = st.pair ? st.pair.symbol : 'the backing token';
    const basketChoices = BS.knownList().filter(t => !st.pair || t.address.toLowerCase() !== st.pair.address.toLowerCase()).filter(t => t.symbol !== 'DAI' && t.symbol !== 'USDe');
    U().$('#opts').innerHTML = `
      <div class="opt-row ${bb ? '' : 'dim'}"><div><b><span class="strat"><i class="d ${bb ? 'on' : ''}">D</i></span>Dip buyback ${bb ? '<span class="tag bb">On</span>' : '<span class="tag">Off</span>'}</b><small>${bb ? 'Every 20% dip, half the fund buys and burns.' : 'Give Buyback a share to turn on.'}</small></div></div>
      <div class="opt-row ${lp ? '' : 'dim'}"><div><b><span class="strat"><i class="l ${lp ? 'on' : ''}">L</i></span>Auto-LP ${lp ? '<span class="tag" style="background:var(--lp-soft);color:var(--lp)">On</span>' : '<span class="tag">Off</span>'}</b><small>${lp ? 'Every $250 collected is added to the pool as liquidity nobody can remove.' : 'Give Auto-LP a share to turn on.'}</small></div></div>
      <div class="opt-row ${v ? '' : 'dim'}"><div><b><span class="strat"><i class="t ${v && st.tp ? 'on' : ''}">T</i></span>Take profit</b><small>${v ? 'Vault sells its gain and burns coins.' : 'Needs a vault share.'}</small>
        <div class="seg" id="tpSeg">${[0, 25, 50, 100].map(n => `<button type="button" data-tp="${n}" class="${st.tp === n ? 'on' : ''}" ${v ? '' : 'disabled'}>${n ? '+' + n + '%' : 'Off'}</button>`).join('')}</div></div></div>
      <div class="opt-row ${v ? '' : 'dim'}"><div><b><span class="strat"><i class="r ${v && st.redeem ? 'on' : ''}">R</i></span>Redeem at backing</b><small>${v ? 'Holders burn coins for their share of the vault.' : 'Needs a vault share.'}</small></div><button type="button" class="switch" id="rdSw" role="switch" aria-checked="${v && st.redeem}" aria-label="Redeem at backing" ${v ? '' : 'disabled'}></button></div>
      <div class="opt-row ${h ? '' : 'dim'}"><div><b><span class="strat"><i class="h ${h ? 'on' : ''}">H</i></span>Pay holders in</b><small>${h ? '' : 'Give Holders a share to turn on.'}</small>
        <div class="seg" id="paySeg">${[['pair', st.pair ? st.pair.symbol : 'Backing token'], ['eth', 'ETH'], ['basket', 'Up to 4 tokens']].map(([k, l]) => `<button type="button" data-pay="${k}" class="${st.payout === k ? 'on' : ''}" ${h ? '' : 'disabled'}>${esc(l)}</button>`).join('')}</div>
        ${h && st.payout === 'basket' ? `<div class="basket">${basketChoices.map(t => { const a = t.address.toLowerCase(); const on = st.basket.includes(a); return `<button type="button" data-b="${a}" class="${on ? 'on' : ''}" ${!on && st.basket.length >= 4 ? 'disabled' : ''}>${tokImg(t, '')}${esc(t.symbol)}</button>`; }).join('')}</div>` : ''}</div></div>`;
  }

  // ------------------------------------------------------------ first buy and the summary
  function devEstimate() {
    const a = st.dev; if (!a || !eth) return null;
    const R = (BS.cfg.startCap || 5000) / eth; const inn = a * (1 - st.tax / 1e4); const f = inn / (R + inn); return { f, coins: f * BS.SUPPLY, usd: a * eth };
  }
  function paintDev() {
    const e = devEstimate(); const { num, usd } = U();
    U().$('#devNote').innerHTML = (e ? `≈ <b class="mono">${(e.f * 100).toFixed(2)}%</b> of supply (${usd(e.usd)}). ` : '') + `Only you can buy in the launch block. After that the tax starts at 99% and falls to ${U().bps(st.tax)} over the first minute.`;
  }
  function paintSum() {
    const { esc, usd, ic, bps } = U(); const s = st.split; const left = pool() - used(); const per = 10000;
    const flows = [['creator', 'You', s.creator], ['holders', 'Holders', s.holders], ['vault', 'Vault', s.vault], ['bb', 'Buyback fund', s.buyback], ['lp', 'Auto-LP', s.lp], ['platform', 'Platform', PLATFORM]].filter(f => f[2] > 0);
    const rules = [];
    const pairSym = st.pair ? st.pair.symbol : 'the backing token';
    if (s.vault) rules.push(['v', 'vault', `The vault buys ${esc(pairSym)} with ${bps(s.vault)} of every trade and never sells it${st.tp ? ' except for take-profit' : ''}.`]);
    if (s.lp) rules.push(['v', 'lock', `${bps(s.lp)} of every trade deepens the pool with locked liquidity.`]);
    if (s.buyback) rules.push(['bb', 'flame', `On every 20% dip, half the buyback fund buys ${esc(S())} and burns it.`]);
    if (s.vault && st.tp) rules.push(['bb', 'flame', `At +${st.tp}% on the vault, the gain buys ${esc(S())} and burns it.`]);
    if (s.vault && st.redeem) rules.push(['v', 'lock', `Holders can redeem ${esc(S())} for its share of the vault.`]);
    if (s.holders) rules.push(['v', 'check', `Holders earn ${bps(s.holders)} of every trade, paid in ${st.payout === 'eth' ? 'ETH' : st.payout === 'basket' ? (st.basket.length ? st.basket.map(a => (BS.known(a) || {}).symbol).join(', ') : 'the tokens you pick') : esc(pairSym)}.`]);
    const missing = [];
    if (!st.name.trim()) missing.push('a name'); if (!st.sym.trim()) missing.push('a ticker'); if (!st.pair || !st.check || !st.check.ok) missing.push('a backing token');
    if (left > 0) missing.push(`the last ${bps(left)} of the split`); if (s.holders && st.payout === 'basket' && !st.basket.length) missing.push('at least one reward token');
    const gasEth = gas != null ? gas * (BS.cfg.launchGas || 4.2e6) / 1e9 : null;
    U().$('#sum').innerHTML = `
      <div class="head">${st.logo ? `<img class="av" src="${st.logo}" alt="" style="width:46px;height:46px">` : `<span class="av" style="width:46px;height:46px;display:grid;place-items:center;font:800 15px var(--f-display);color:var(--muted)">${esc((st.sym || '?').slice(0, 2).toUpperCase())}</span>`}
        <div style="min-width:0"><b>${esc(st.name || 'Your coin')}</b><small>${esc(S())}${st.pair ? ' · backed by ' + esc(st.pair.symbol) : ''}</small></div></div>
      <div class="flow"><span class="eyebrow" style="margin-bottom:4px">Tax ${bps(st.tax)} · per ${usd(per, { compact: false })} traded</span>${flows.map(f => `<div class="flow-row"><i class="s-${f[0]}"></i><span>${f[1]}</span><b>${usd(per * f[2] / 1e4, { compact: false })}</b></div>`).join('')}${left > 0 ? `<div class="flow-row"><i style="background:var(--line)"></i><span class="faint">Not assigned</span><b class="faint">${usd(per * left / 1e4, { compact: false })}</b></div>` : ''}</div>
      <div class="go">
        <button class="btn btn-ink btn-lg btn-block" type="button" disabled>Launch ${esc(S())}</button>
        <p>${missing.length ? `Needs ${missing.join(', ')}.` : 'Ready. Launches open when the contracts go live.'}${gasEth != null ? ` Gas ≈ <b class="mono">${gasEth.toFixed(4)} ETH</b>${eth ? ` (${usd(gasEth * eth)})` : ''}.` : ''}</p>
      </div>`;
  }
  function paintAll() { paintTax(); paintPresets(); paintAlloc(); paintOpts(); paintDev(); paintSum(); }

  function wire() {
    const { $, $$ } = U(); const f = $('#lf');
    $('#pairBtn').onclick = openPicker;
    const text = () => { st.name = $('#name').value; st.sym = $('#sym').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); st.desc = $('#desc').value; paintOpts(); paintDev(); paintSum(); };
    ['#name', '#sym', '#desc'].forEach(s => $(s).addEventListener('input', text));
    $('#logo').onchange = e => { const file = e.target.files[0]; if (!file) return; const r = new FileReader(); r.onload = () => { st.logo = r.result; $('#logoPv').innerHTML = `<img src="${r.result}" alt="">`; paintSum(); }; r.readAsDataURL(file); };
    f.addEventListener('click', e => {
      const p = e.target.closest('[data-p]'); if (p) { const pr = PRESETS.find(x => x.k === p.dataset.p); st.preset = pr.k; st.split = scaled(pr.split, pool()); st.tp = pr.tp; st.redeem = pr.redeem; if (pr.payout) st.payout = pr.payout; paintAll(); return; }
      const sb = e.target.closest('[data-k]'); if (sb && !sb.disabled) { const k = sb.dataset.k, d = Number(sb.dataset.d) * STEP; const left = pool() - used(); if (d > 0 && left <= 0) return; st.split[k] = Math.max(0, st.split[k] + Math.min(d, left)); st.preset = null;
        if (!st.split.vault) { st.tp = 0; st.redeem = false; } paintAll(); return; }
      const tx = e.target.closest('[data-tax]'); if (tx && !tx.disabled) { setTax(st.tax + Number(tx.dataset.tax) * TAX_STEP); return; }
      const tp = e.target.closest('[data-tp]'); if (tp && !tp.disabled) { st.tp = Number(tp.dataset.tp); st.preset = null; paintAll(); return; }
      const pay = e.target.closest('[data-pay]'); if (pay && !pay.disabled) { st.payout = pay.dataset.pay; paintAll(); return; }
      const bk = e.target.closest('[data-b]'); if (bk && !bk.disabled) { const a = bk.dataset.b; st.basket = st.basket.includes(a) ? st.basket.filter(x => x !== a) : [...st.basket, a].slice(0, 4); paintAll(); return; }
      if (e.target.closest('#rdSw')) { st.redeem = !st.redeem; st.preset = null; paintAll(); return; }
      const dv = e.target.closest('[data-dev]'); if (dv) { $('#dev').value = dv.dataset.dev === '0' ? '' : dv.dataset.dev; st.dev = Number(dv.dataset.dev) || 0; paintDev(); }
    });
    f.addEventListener('input', e => { if (e.target.id === 'taxRange') setTax(Number(e.target.value)); });
    $('#dev').addEventListener('input', e => { st.dev = Math.max(0, Number(e.target.value) || 0); paintDev(); });
  }
  async function start() {
    wire();
    const q = new URLSearchParams(location.search).get('pair'); const k = q && BS.known(q);
    paintAll(); setPair(k ? { ...k, address: q.toLowerCase() } : q && BS.isAddress(q) ? { address: q.toLowerCase(), symbol: U().short(q), name: 'Checking…' } : { ...BS.known(BS.weth), address: BS.weth });
    BS.ethUsd().then(v => { eth = v; paintDev(); paintSum(); });
    BS.gasGwei().then(g => { gas = g; paintSum(); }).catch(() => {});
  }
  window.addEventListener('DOMContentLoaded', () => BS.ready.then(start));
})();
