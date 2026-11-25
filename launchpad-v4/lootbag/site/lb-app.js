/* Lootbag front-end: hash routes #/ (board), #/coin/<addr>, #/create, #/rewards, #/airdrops, #/bags, #/loot,
   #/how. Reads window.LB_DATA (sample coins in the preview, the indexer once live). No wallet writes in the preview. */
(function () {
  const D = window.LB_DATA, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const view = $('#view');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (v, d) => { v = Number(v) || 0; const a = Math.abs(v); if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'; if (a >= 1e4) return '$' + (v / 1e3).toFixed(1) + 'K'; if (a >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }); if (a >= 1) return '$' + v.toFixed(d ?? 2); if (a === 0) return '$0'; return '$' + v.toPrecision(3); };
  const num = (v, d = 2) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
  const pct = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
  const ago = (ts) => { const s = Math.max(1, Math.floor(Date.now() / 1000 - ts)); if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  const mmss = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const toast = (m) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); };
  const PREVIEW = 'Preview: launches and trades open when Lootbag goes live.';

  // ---------- marks: coin avatars and stock badges are drawn, not fetched
  const av = (c, size = 44) => `<span class="av" style="width:${size}px;height:${size}px;background:${c.official ? '#16306b' : `linear-gradient(140deg,hsl(${c.hue} 70% 62%),hsl(${(c.hue + 40) % 360} 65% 44%))`};font-size:${Math.round(size * 0.34)}px">${c.official ? `<img src="/img/logo.svg" style="width:64%;height:64%">` : esc(c.ticker.slice(0, 2))}</span>`;
  const stkHue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const tokenBadge = (s, size = 20) => s === 'ETH' ? `<span class="stk" style="width:${size}px;height:${size}px;background:#627eea">Ξ</span>` : s === 'USDG' ? `<span class="stk" style="width:${size}px;height:${size}px;background:#1d9e6b">$</span>` : s === 'LOOT' ? `<img src="/img/logo.svg" style="width:${size}px;height:${size}px;border-radius:6px">` : `<span class="stk" style="width:${size}px;height:${size}px;background:hsl(${stkHue(s)} 55% 42%)">${esc(s.slice(0, 4))}</span>`;
  const stack = (list, n = 4) => `<span class="stack">${list.slice(0, n).map((s) => tokenBadge(s)).join('')}</span>${list.length > n ? ` <span class="dim">+${list.length - n}</span>` : ''}`;
  const label = (s) => (s === 'ETH' || s === 'USDG' || s === 'LOOT' ? s : s + 'x');
  const pays = (c) => c.rewards.map(label).join(', ');
  const isStock = (s) => s !== 'ETH' && s !== 'USDG' && s !== 'LOOT';

  // ---------- nav
  const I = {
    board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    create: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    rewards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 11h16v9H4zM2.5 7h19v4h-19zM12 7v13M12 7c-2-4-6-4-6-1.5S10 7 12 7zm0 0c2-4 6-4 6-1.5S14 7 12 7z"/></svg>',
    air: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 0 1 18 0zM12 12v8M9 20h6"/></svg>',
    bags: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 4c1 .9 2 1.3 3 1.3S14 4.9 15 4l-1 3h-4zM10 8h4c3 1.8 5 4.4 5 7.2 0 3-2.8 4.8-7 4.8s-7-1.8-7-4.8C5 12.4 7 9.8 10 8z"/></svg>',
    loot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/></svg>',
    how: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5zM4 5.5v16"/></svg>',
  };
  I.home = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>';
  I.plus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>';
  I.mint = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';
  const NAV = [['Trade', [['#/', 'Board', 'home'], ['#/coins', 'Lootbag coins', 'bags'], ['#/bags', 'Bags', 'board']]], ['Earn', [['#/rewards', 'Rewards', 'rewards'], ['#/airdrops', 'Airdrops', 'air'], ['#/mint', 'Mint', 'mint']]], ['Learn', [['#/how', 'How it works', 'how']]]];
  $('#nav').innerHTML = NAV.map(([g, items]) => `<h6>${g}</h6>` + items.map(([h, l, i]) => `<a href="${h}" data-r="${h}">${I[i]}<span>${l}</span></a>`).join('')).join('');
  $('#tabbar').innerHTML = [['#/', 'Board', 'home'], ['#/create', 'Create', 'plus', 'plus'], ['#/coins', 'Lootbag coins', 'bags'], ['#/bags', 'Bags', 'board'], ['#/rewards', 'Rewards', 'rewards'], ['#/airdrops', 'Airdrops', 'air'], ['#/mint', 'Mint', 'mint'], ['#/how', 'How it works', 'how']].map(([h, l, i, c]) => `<a href="${h}" data-r="${h}" class="${c || ''}" aria-label="${l}">${I[i]}</a>`).join('');
  const copyLoot = $('[data-copyloot]'); if (copyLoot) copyLoot.onclick = () => { navigator.clipboard && navigator.clipboard.writeText('0x10070000000000000000000000000000000b4c'); toast('$LOOT address copied'); };
  $$('[data-connect]').forEach((b) => (b.onclick = () => toast(PREVIEW)));

  const foot = () => `<footer class="foot"><span>Coins on Lootbag are launched by their creators, not by Lootbag. They are highly risky and can lose all their value. Nothing here is financial advice.</span><span><a href="#/how">How it works</a> · <a href="#/how#contracts">Contracts</a> · © ${new Date().getFullYear()} Lootbag</span></footer>`;
  let timers = [];
  const every = (ms, f) => timers.push(setInterval(f, ms));

  // ---------- board
  const state = { tab: 'trending', chip: '', q: '' };
  function board() {
    const P = D.platform, cs = D.coins, recent = cs.filter((c) => !c.official).slice(0, 5);
    view.innerHTML = `
      <section class="hero">
        <svg class="waves" viewBox="0 0 1200 150" preserveAspectRatio="none" fill="none" stroke="#3d7bff" stroke-opacity=".45" stroke-width="2"><path d="M0 95C150 20 250 20 400 95S650 170 800 95 1050 20 1200 95"/><path d="M0 125C150 50 250 50 400 125S650 200 800 125 1050 50 1200 125"/></svg>
        <div>
          <h1>Hold the bag.<br><span>Get paid in stocks.</span></h1>
          <p>Launch a coin on ETH, USDG or a stock. Every trade pays your holders in ETH or stocks, and traders earn ETH airdrops.</p>
          <div class="acts"><a class="btn blue pill" href="#/create">Launch a coin</a></div>
        </div>
      </section>
      <div class="bar">${[['trending', 'Trending'], ['new', 'New'], ['paying', 'Paying now'], ['top', 'Top']].map(([k, l]) => `<button class="tab ${state.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}<span class="live">${cs.length} live</span></div>
      <div class="chips">${[['pETH', 'Paired with ETH'], ['pSTK', 'Paired with a stock'], ['stocks', 'Pays stocks'], ['eth', 'Pays ETH']].map(([k, l]) => `<button class="fchip ${state.chip === k ? 'on' : ''}" data-chip="${k}">${l}</button>`).join('')}</div>
      <div class="grid" id="grid"></div>${foot()}`;
    $$('[data-tab]').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; board(); }));
    $$('[data-chip]').forEach((b) => (b.onclick = () => { state.chip = state.chip === b.dataset.chip ? '' : b.dataset.chip; board(); }));
    drawGrid();
    every(1000, tickCards);
  }
  function filtered() {
    let cs = D.coins.slice();
    const q = state.q.toLowerCase();
    if (q) cs = cs.filter((c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q) || c.addr.includes(q));
    const f = { stocks: (c) => c.rewards.some(isStock), eth: (c) => c.rewards.includes('ETH'), pETH: (c) => c.pair === 'ETH', pUSDG: (c) => c.pair === 'USDG', pSTK: (c) => isStock(c.pair) }[state.chip];
    if (f) cs = cs.filter(f);
    const sort = { trending: (a, b) => b.vol24 - a.vol24, new: (a, b) => b.createdAt - a.createdAt, paying: (a, b) => b.paid24 - a.paid24, top: (a, b) => b.mcap - a.mcap }[state.tab];
    return cs.sort(sort);
  }
  function card(c) {
    return `<a class="card coin" href="#/coin/${c.addr}">
      <span class="ghost">${av(c, 170)}</span>${c.official ? '<span class="badge">Lootbag</span>' : ''}
      <span class="in">${av(c, 44)}
        <div class="tkl"><b>$${esc(c.ticker)}</b><span>${esc(c.name)}</span></div>
        <div class="mc">${usd(c.mcap)}</div>
        <div class="l1">${c.official ? 'Lootbag coin' : `Paired to ${tokenBadge(c.pair, 16)} <b>${esc(c.pair === 'ETH' || c.pair === 'USDG' ? c.pair : '$' + label(c.pair))}</b>`}</div>
        <div class="l2">Pays ${esc(c.rewards.slice(0, 2).map((r) => (r === 'ETH' ? 'ETH' : '$' + label(r))).join(' · '))}${c.rewards.length > 2 ? ' +' + (c.rewards.length - 2) : ''}</div>
      </span></a>`;
  }
  function drawGrid() { const g = $('#grid'); if (g) g.innerHTML = filtered().map(card).join('') || '<p class="mute">No coins match.</p>'; }
  function tickCards() {
    for (const c of D.coins) c.nextPayout = c.nextPayout <= 1 ? 300 : c.nextPayout - 1;
    $$('[data-next]').forEach((el) => { const c = D.coins.find((x) => x.addr === el.dataset.next); if (c) el.textContent = 'Next drop ' + mmss(c.nextPayout); });
  }

  // ---------- coin page
  function coin(a) {
    const c = D.coins.find((x) => x.addr === a);
    if (!c) { view.innerHTML = `<a class="back" href="#/">← Board</a><h1>Coin not found</h1>`; return; }
    const cur = c.rewards[c.rewardIx], pairL = c.pair === 'ETH' || c.pair === 'USDG' ? c.pair : '$' + label(c.pair);
    const LOOT_USD = (D.coins.find((x) => x.official) || { priceUsd: 0.00124 }).priceUsd;
    const pairUsd = c.pair === 'ETH' ? D.ethUsd : c.pair === 'USDG' ? 1 : c.pair === 'LOOT' ? LOOT_USD : (D.stocks.find((x) => x.sym === c.pair) || { usd: 100 }).usd;
    const routeTxt = c.pair === 'ETH' ? 'Trades straight against <b>ETH</b>' : `Goes through <a>${esc(pairL)}</a>: ETH → ${c.pair === 'USDG' ? 'USDG' : c.pair === 'LOOT' ? '$LOOT' : 'USDG → ' + esc(pairL)} → $${esc(c.ticker)}`;
    view.innerHTML = `<a class="back" href="#/">← Board</a>
      <div class="chead"><div class="lg">${av(c, 64)}<span class="pb">${tokenBadge(c.pair, 24)}</span></div>
        <div style="min-width:0"><h1>${esc(c.name)}<span>$${esc(c.ticker)}</span></h1><div class="sub">Paired to <b>${esc(pairL)}</b> · holders are paid in ${esc(c.rewards.map((r) => (r === 'ETH' ? 'ETH' : '$' + label(r))).join(', '))} · ${ago(c.createdAt)} ago</div></div>
        <div class="links"><button class="btn sm" data-copy>Copy address <span class="mono">${short(c.addr)}</span></button>${c.x ? `<a class="btn sm" href="${esc(c.x)}" target="_blank" rel="noopener">X ↗</a>` : ''}<a class="btn sm" href="#" data-preview>DexScreener ↗</a><a class="btn sm" href="#" data-preview>Explorer ↗</a></div></div>
      <div class="kpis"><div><span>Market cap</span><b class="up">${usd(c.mcap)}</b></div><div><span>Price</span><b>${usd(c.priceUsd)}</b></div><div><span>Price in ${esc(pairL)}</span><b>${num(c.priceUsd / pairUsd, 9)}</b></div><div><span>Holders</span><b>${num(c.holders, 0)}</b></div></div>
      <div class="cp">
        <div>
          <div class="card chart"><div class="tools">${['5m', '15m', '1h', '4h'].map((t, i) => `<button class="${i ? '' : 'on'}" data-tf="${t}">${t}</button>`).join('')}<div class="tog"><button class="on">Market cap</button><button data-preview>Price</button></div></div><div id="cv"></div></div>
          <div class="sect" style="margin-top:20px;border:0;padding-top:4px">
            <h3 style="margin:0 0 8px;font:600 16px var(--f)">Holder rewards</h3>
            <p class="mute" style="margin:0 0 14px;font-size:14px;line-height:1.7">The holders' share of every fee is kept by this coin's contract. Every 5 minutes, counted from this coin's launch, it pays every holder in ${esc(c.rewards.map((r) => (r === 'ETH' ? 'ETH' : '$' + label(r))).join(', '))}, by how much they hold. Nothing to claim.</p>
            <div class="card panel" style="background:var(--panel)">
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${tokenBadge(cur, 36)}<div><b>${esc(cur === 'ETH' ? 'ETH' : '$' + label(cur))}</b><div class="mute" style="font-size:13px">${c.pot >= 5 ? `<span class="up">Payout ready: ${usd(c.pot)}</span>` : `Payout waiting for $5 in fees (${usd(c.pot)} so far)`}</div></div><div style="margin-left:auto;text-align:right"><div class="mute" style="font-size:12px">Next payout</div><div class="count" id="cd">${mmss(c.nextPayout)}</div></div></div>
              <div class="meter"><i style="width:${Math.min(100, (c.pot / 5) * 100)}%"></i></div>
              ${c.rewards.length > 1 ? `<div class="rot">${c.rewards.map((r, i) => `<span class="${i === c.rewardIx ? 'cur' : ''}">${tokenBadge(r, 20)}${esc(r === 'ETH' ? 'ETH' : '$' + label(r))}</span>`).join('')}</div>` : ''}
            </div>
          </div>
          <div class="card" style="margin-top:16px;background:var(--panel)">
            <div class="stabs">${[['trades', 'Trades'], ['holders', 'Holders'], ['drops', 'Payouts']].map(([k, l], i) => `<button class="tab ${i ? '' : 'on'}" data-st="${k}">${l}</button>`).join('')}</div>
            <div class="tw" id="st"></div>
          </div>
        </div>
        <div class="sticky side-col">
          <div class="card panel">
            <div class="bs"><button class="on b" data-side="b">Buy</button><button class="s" data-side="s">Sell</button></div>
            <div class="field"><label><span id="amt-l">Amount (ETH)</span><span>Slippage 3%</span></label><input class="inp" id="amt" placeholder="0.0" inputmode="decimal"><div class="presets" id="pre">${['0.01', '0.05', '0.1', '0.5'].map((v) => `<button data-v="${v}">${v} ETH</button>`).join('')}</div></div>
            <div class="route">Balance: — ETH<br>${routeTxt}<br><span id="est">You get about —</span>${c.pair !== 'ETH' ? `<div class="paywith">Pay with <button class="on">ETH</button><button data-preview>${esc(pairL)}</button></div>` : ''}</div>
            <button class="btn green block" style="height:50px" id="go">Connect wallet</button>
          </div>
          <div class="card panel" style="margin-top:14px">
            <h3>Next payout</h3><div class="meter"><i style="width:${Math.min(100, (c.pot / 5) * 100)}%"></i></div><div class="mute" style="font-size:13px">Pays holders every 5 minutes once $5 has built up. Liquidity sits in its own Uniswap v4 pool and is locked forever.</div>
            <div class="sect" style="margin-top:16px"><h4>Details</h4>
              <div class="kv"><span>Address</span><b class="mono">${short(c.addr)}</b></div><div class="kv"><span>Pool</span><b>Uniswap v4</b></div><div class="kv"><span>Paired with</span><b>${esc(pairL)}</b></div><div class="kv"><span>Supply</span><b>1,000,000,000</b></div><div class="kv"><span>Trading fee</span><b>2%</b></div></div>
            <div class="sect" style="padding-bottom:0"><h4>Where every fee goes</h4>
              <div class="kv"><span><i class="drop-dot" style="background:var(--buy)"></i>Holders</span><b>0.5%</b></div><div class="kv"><span><i class="drop-dot" style="background:var(--blue)"></i>Lootbag</span><b>1.5%</b></div></div>
          </div>
        </div>
      </div>${foot()}`;
    $('[data-copy]').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(c.addr); toast('Address copied'); };
    $$('[data-preview]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); toast(PREVIEW); }));
    let side = 'b';
    const est = () => { const v = Number($('#amt').value) || 0; $('#est').textContent = v ? (side === 'b' ? `You get about ${num((v * D.ethUsd * 0.98) / c.priceUsd, 0)} $${c.ticker}` : `You get about ${num((v * c.priceUsd * 0.98) / D.ethUsd, 5)} ETH`) : 'You get about —'; };
    $$('[data-side]').forEach((b) => (b.onclick = () => { side = b.dataset.side; $$('[data-side]').forEach((x) => x.classList.toggle('on', x === b)); $('#amt-l').textContent = side === 'b' ? 'Amount (ETH)' : 'Amount ($' + c.ticker + ')'; $('#pre').innerHTML = (side === 'b' ? ['0.01', '0.05', '0.1', '0.5'].map((v) => `<button data-v="${v}">${v} ETH</button>`) : ['25', '50', '75', '100'].map((v) => `<button data-v="${v}%">${v}%</button>`)).join(''); bindPre(); $('#go').className = 'btn block ' + (side === 'b' ? 'green' : 'red'); $('#go').style.height = '50px'; est(); }));
    const bindPre = () => $$('#pre button').forEach((b) => (b.onclick = () => { $('#amt').value = b.dataset.v.endsWith('%') ? '' : b.dataset.v; est(); }));
    bindPre(); $('#amt').oninput = est; $('#go').onclick = () => toast(PREVIEW);
    const sub = (k) => {
      $$('[data-st]').forEach((b) => b.classList.toggle('on', b.dataset.st === k));
      $('#st').innerHTML = k === 'trades' ? `<table class="t"><tr><th>Wallet</th><th>Side</th><th class="r">USD</th><th class="r">$${esc(c.ticker)}</th><th class="r">Age</th></tr>${c.trades.slice(0, 15).map((t) => `<tr><td class="mono">${short(t.wallet)}</td><td class="${t.buy ? 'up' : 'dn'}">${t.buy ? 'Buy' : 'Sell'}</td><td class="r">${usd(t.usd)}</td><td class="r">${num(t.tokens, 0)}</td><td class="r mute">${ago(t.ts)}</td></tr>`).join('')}</table>`
        : k === 'holders' ? `<table class="t"><tr><th>#</th><th>Wallet</th><th class="r">Share</th><th class="r">Earning</th></tr>${c.holderList.map((h, i) => `<tr><td class="mute">${i + 1}</td><td class="mono">${short(h.wallet)}</td><td class="r">${h.pct.toFixed(2)}%</td><td class="r up">${usd((c.paid24 * h.pct) / 100)}/day</td></tr>`).join('')}</table>`
        : `<table class="t"><tr><th>Paid</th><th>Paid in</th><th class="r">Amount</th><th class="r">Wallets</th></tr>${c.payouts.map((p) => `<tr><td class="mute">${ago(p.ts)} ago</td><td>${tokenBadge(p.token, 18)} ${esc(p.token === 'ETH' ? 'ETH' : '$' + label(p.token))}</td><td class="r up">${usd(p.usd)}</td><td class="r">${num(p.wallets, 0)}</td></tr>`).join('')}</table>`;
    };
    $$('[data-st]').forEach((b) => (b.onclick = () => sub(b.dataset.st))); sub('trades');
    every(1000, () => { tickCards(); const el = $('#cd'); if (el) el.textContent = mmss(c.nextPayout); });
    drawChart(c, 300);
    $$('[data-tf]').forEach((b) => (b.onclick = () => { $$('[data-tf]').forEach((x) => x.classList.toggle('on', x === b)); drawChart(c, { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 }[b.dataset.tf]); }));
  }
  let chart = null;
  function drawChart(c, step) {
    const el = $('#cv'); if (!el || !window.LightweightCharts) return;
    if (chart) { chart.remove(); chart = null; }
    chart = LightweightCharts.createChart(el, { layout: { background: { color: 'transparent' }, textColor: '#8f9ab3', fontFamily: 'Space Grotesk' }, grid: { vertLines: { color: '#111c33' }, horzLines: { color: '#111c33' } }, rightPriceScale: { borderColor: '#22304b' }, timeScale: { borderColor: '#22304b', timeVisible: true }, crosshair: { mode: 1 }, autoSize: true });
    const s = chart.addCandlestickSeries({ upColor: '#34d399', downColor: '#f2606b', borderVisible: false, wickUpColor: '#34d399', wickDownColor: '#f2606b', priceFormat: { type: 'custom', formatter: (v) => usd(v) } });
    const out = []; let cur = null;
    for (const k of c.candles) { const b = Math.floor(k.t / step) * step; if (!cur || cur.time !== b) { if (cur) out.push(cur); cur = { time: b, open: k.o, high: k.h, low: k.l, close: k.c }; } else { cur.high = Math.max(cur.high, k.h); cur.low = Math.min(cur.low, k.l); cur.close = k.c; } }
    if (cur) out.push(cur);
    s.setData(out); chart.timeScale().fitContent();
  }

  // ---------- create
  function create() {
    const F = { pair: 'ETH', pairStock: 'NVDA', rewards: ['NVDA'], img: '' };
    const stocks = D.stocks;
    view.innerHTML = `<div class="ph1"><h1>Create a coin</h1><p>Your coin opens its own Uniswap v4 pool in the same transaction, with its liquidity locked forever. Every trade pays its holders.</p></div>
      <div class="cg"><div>
        <section class="card sec"><h2>Your coin</h2><p>Name, ticker, picture and links. They can't be changed after launch.</p>
          <div class="up-img" style="margin-bottom:16px"><label class="ph" id="ph" for="img">＋</label><input type="file" id="img" accept="image/png,image/jpeg,image/webp,image/gif" hidden><div class="mute" style="font-size:13px">PNG, JPG, WEBP or GIF, up to 1 MB.<br>Square works best.</div></div>
          <div class="two"><div class="field"><label>Name</label><input class="inp t" id="f-name" maxlength="32" placeholder="Golden Goose"></div><div class="field"><label>Ticker <span id="tk-state"></span></label><input class="inp t" id="f-tk" maxlength="10" placeholder="GOOSE" style="text-transform:uppercase"></div></div>
          <div class="field"><label>Description <span class="dim" id="d-n">0/280</span></label><textarea class="inp" id="f-desc" maxlength="280" placeholder="What is it about?"></textarea></div>
          <div class="two"><div class="field"><label>X</label><input class="inp t" placeholder="https://x.com/…"></div><div class="field"><label>Telegram</label><input class="inp t" placeholder="https://t.me/…"></div></div>
          <div class="field"><label>Website</label><input class="inp t" placeholder="https://…"></div>
        </section>
        <section class="card sec"><h2>Paired with</h2><p>What your coin is priced in. Buyers can always pay in ETH; the route swaps it for them.</p>
          <div class="seg" id="pair">${[['ETH', 'ETH', 'The standard pair'], ['USDG', 'USDG', 'Priced in dollars'], ['STOCK', 'A stock', 'NVDA, TSLA, SPY…']].map(([k, t, s]) => `<button data-pair="${k}" class="${k === 'ETH' ? 'on' : ''}"><b>${t}</b><small>${s}</small></button>`).join('')}</div>
          <div id="pair-stock" style="display:none"><input class="inp t" id="ps-q" placeholder="Search ${stocks.length} stocks" style="margin-top:12px"><div class="picker" id="ps"></div></div>
        </section>
        <section class="card sec"><h2>Rewarded with</h2><p>What your holders get every five minutes. Pick up to 10; they take turns, each until it has been paid out.</p>
          <input class="inp t" id="rw-q" placeholder="Search ETH and ${stocks.length} stocks"><div class="picker" id="rw"></div>
          <div class="note" id="rw-n"></div>
        </section>
        <section class="card sec"><h2>Your first buy</h2><p>Required, in the launch transaction itself, so nobody can buy before you. You can hold at most 2% of the supply.</p>
          <div class="field"><label><span>Amount (ETH)</span><span>min 0.005 ETH</span></label><input class="inp" id="f-dev" value="0.01" inputmode="decimal"></div>
          <div class="note">Wallets that buy in the launch block never earn loot. As the creator, you don't earn loot from your own coin either.</div>
        </section>
      </div>
      <div class="sticky"><div class="card panel" id="pv"></div></div></div>${foot()}`;
    const ps = () => { const q = ($('#ps-q').value || '').toLowerCase(); $('#ps').innerHTML = stocks.filter((s) => !q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).map((s) => `<button data-s="${s.sym}" class="${F.pairStock === s.sym ? 'on' : ''}">${tokenBadge(s.sym, 26)}<span>${esc(s.sym)}x<small>${esc(s.name)}</small></span></button>`).join(''); $$('#ps [data-s]').forEach((b) => (b.onclick = () => { F.pairStock = b.dataset.s; ps(); pv(); })); };
    const rw = () => { const q = ($('#rw-q').value || '').toLowerCase(); const opts = [{ sym: 'ETH', name: 'Ether' }, ...stocks]; $('#rw').innerHTML = opts.filter((s) => !q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).map((s) => { const i = F.rewards.indexOf(s.sym); return `<button data-r="${s.sym}" class="${i >= 0 ? 'on' : ''}">${tokenBadge(s.sym, 26)}<span>${esc(label(s.sym))}<small>${esc(s.name)}</small></span>${i >= 0 ? `<span class="n">${i + 1}</span>` : ''}</button>`; }).join(''); $$('#rw [data-r]').forEach((b) => (b.onclick = () => { const s = b.dataset.r, i = F.rewards.indexOf(s); if (i >= 0) F.rewards.splice(i, 1); else if (F.rewards.length < 10) F.rewards.push(s); else toast('Up to 10 rewards'); rw(); pv(); })); $('#rw-n').textContent = F.rewards.length ? `Holders get ${F.rewards.map(label).join(' → ')}${F.rewards.length > 1 ? ', in turns' : ''}.` : 'Pick nothing and holders get ETH.'; };
    const pv = () => {
      const name = $('#f-name').value.trim() || 'Your coin', tk = ($('#f-tk').value.trim() || 'TICKER').toUpperCase(), pair = F.pair === 'STOCK' ? F.pairStock : F.pair;
      const taken = D.coins.find((c) => c.ticker === tk);
      $('#tk-state').innerHTML = $('#f-tk').value.trim().length < 2 ? '' : taken ? '<span class="gold">taken: 0.05 ETH copy fee</span>' : '<span class="up">free</span>';
      const fake = { ticker: tk, hue: 42, official: false };
      $('#pv').innerHTML = `<h3>Preview</h3><div style="display:flex;gap:12px;align-items:center">${F.img ? `<span class="av" style="width:54px;height:54px;border-radius:15px;background:center/cover url('${F.img}')"></span>` : av(fake, 54)}<div><b>${esc(name)}</b><div class="mute">$${esc(tk)}</div></div></div>
        <div style="margin:16px 0 8px"><div class="kv"><span>Paired with</span><b>${tokenBadge(pair, 16)} ${esc(label(pair))}</b></div><div class="kv"><span>Holders get</span><b>${F.rewards.length ? esc(F.rewards.map(label).join(' → ')) : 'ETH'}</b></div><div class="kv"><span>Trading fee</span><b>2% (0.5% to holders)</b></div><div class="kv"><span>Supply</span><b class="num">1,000,000,000</b></div><div class="kv"><span>Opening market cap</span><b>about $5,000</b></div><div class="kv"><span>Liquidity</span><b>locked forever</b></div><div class="kv"><span>Launch fee</span><b>0.001 ETH${taken ? ' + 0.05 ETH copy fee' : ''}</b></div><div class="kv"><span>Your first buy</span><b>${esc($('#f-dev').value || '0')} ETH</b></div></div>
        ${taken ? '<div class="note warn">$' + esc(tk) + ' is already on Lootbag. The copy fee comes back to you if your coin reaches $70K within 48 hours.</div>' : ''}
        <button class="btn gold block" style="margin-top:14px" id="launch">Launch $${esc(tk)}</button><div class="note" style="text-align:center">Two approvals: the launch, with your first buy inside it.</div>`;
      $('#launch').onclick = () => toast(PREVIEW);
    };
    $$('[data-pair]').forEach((b) => (b.onclick = () => { F.pair = b.dataset.pair; $$('[data-pair]').forEach((x) => x.classList.toggle('on', x === b)); $('#pair-stock').style.display = F.pair === 'STOCK' ? '' : 'none'; pv(); }));
    $('#ps-q').oninput = ps; $('#rw-q').oninput = rw;
    ['#f-name', '#f-tk', '#f-dev'].forEach((s) => ($(s).oninput = pv));
    $('#f-desc').oninput = () => ($('#d-n').textContent = $('#f-desc').value.length + '/280');
    $('#img').onchange = () => { const f = $('#img').files[0]; if (!f) return; if (f.size > 1048576) return toast('The image is over 1 MB'); const r = new FileReader(); r.onload = () => { F.img = r.result; $('#ph').style.backgroundImage = `url('${F.img}')`; $('#ph').textContent = ''; pv(); }; r.readAsDataURL(f); };
    ps(); rw(); pv();
  }

  // ---------- rewards
  function rewards() {
    const paying = D.coins.slice().sort((a, b) => b.paid24 - a.paid24).slice(0, 12), total24 = D.coins.reduce((s, c) => s + c.paid24, 0);
    view.innerHTML = `<div class="ph1"><h1>Rewards</h1><p>Hold a Lootbag coin and its trades pay you. Every five minutes, each coin drops its holders' share straight into their wallets in ETH or stocks. There is nothing to claim.</p></div>
      <div class="stat3"><div class="card"><span>Paid to holders</span><b class="gold">${usd(D.platform.paidHolders)}</b></div><div class="card"><span>Last 24 hours</span><b>${usd(total24)}</b></div><div class="card"><span>Drops every</span><b>5 min</b></div></div>
      <div class="card panel" style="margin-bottom:18px"><h3>What's yours?</h3><p class="mute" style="margin:0 0 12px;font-size:13.5px">Paste any wallet to see what it earns. Nothing to connect or sign.</p><div style="display:flex;gap:8px"><input class="inp t" id="rq" placeholder="0x…"><button class="btn gold" id="rgo">Check</button></div><div id="rres"></div></div>
      <h3 style="font:600 17px var(--fd);margin:26px 0 12px">Paying out now</h3>
      <div class="card">${paying.map((c) => `<a class="lrow" href="#/coin/${c.addr}">${av(c, 40)}<div class="grow"><b>$${esc(c.ticker)}</b> <span class="mute">${esc(c.name)}</span><div class="mute" style="font-size:12.5px">Pays ${esc(pays(c))} · ${usd(c.mcap)} market cap</div></div><div style="text-align:right"><b class="num gold">${usd(c.paid24)}</b><div class="mute" style="font-size:12px">to holders in 24h</div></div></a>`).join('')}</div>${foot()}`;
    $('#rgo').onclick = () => { const v = $('#rq').value.trim(); if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return ($('#rres').innerHTML = '<p class="note">Paste a full 0x address.</p>'); $('#rres').innerHTML = `<p class="note">No Lootbag coins in this wallet yet. Buy any coin on the board and its next drop pays you.</p>`; };
  }

  // ---------- airdrops
  function airdrops() {
    const A = D.airdrop, b = A.board, tot = b.reduce((s, x) => s + x.vol, 0);
    const shares = b.map((x, i) => (i === 0 ? 5.3 : i === 1 ? 4 : i === 2 ? 3 : i < 20 ? (13 * x.vol) / b.slice(3, 20).reduce((s, y) => s + y.vol, 0) : (74.7 * x.vol) / tot));
    view.innerHTML = `<div class="ph1"><h1>Trader airdrops</h1><p>10% of Lootbag's revenue fills the airdrop pot. Every 10 hours it is paid in ETH to the 500 wallets that traded the most volume on Lootbag coins, on any app.</p></div>
      <div class="stat3"><div class="card"><span>In the pot</span><b class="gold">${num(A.pot, 3)} ETH</b><span>${usd(A.potUsd)}</span></div><div class="card"><span>Next airdrop</span><b id="acd">${mmss(A.endsAt - Date.now() / 1000)}</b></div><div class="card"><span>This round</span><b>${num(A.traders, 0)} traders</b><span>${usd(A.volume)} volume</span></div></div>
      <div class="card panel" style="margin-bottom:18px;font-size:14px"><h3>How the pot is shared</h3><div class="mute">#1, #2 and #3 get 5.3%, 4% and 3% of the pot. Places 4 to 20 share 13% by volume, and everyone else up to #500 shares the rest by volume. You need at least $50 of volume in the round, and no wallet gets more than 10% of a pot. Coins sold or sent within 2 minutes of buying don't count.</div></div>
      <div class="card tw"><table class="t"><tr><th>#</th><th>Wallet</th><th class="r">Volume</th><th class="r">Share</th><th class="r">Payout</th></tr>${b.map((x, i) => `<tr><td class="mute">${i + 1}</td><td class="num">${short(x.wallet)}</td><td class="r num">${usd(x.vol)}</td><td class="r num">${shares[i].toFixed(2)}%</td><td class="r num gold">${num((A.pot * shares[i]) / 100, 4)} ETH</td></tr>`).join('')}</table></div>${foot()}`;
    every(1000, () => { const e = $('#acd'); if (e) e.textContent = mmss(A.endsAt - Date.now() / 1000); });
  }

  // ---------- bags (NFT vaults)
  function bagArt(id, hue) {
    const h2 = (hue + 50) % 360, eyes = id % 3, hat = id % 4;
    return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="120" fill="hsl(${hue} 45% 16%)"/><circle cx="96" cy="22" r="10" fill="hsl(${h2} 70% 60%)" opacity=".5"/><path d="M44 30c4 4 9 6 16 6s12-2 16-6l-5 13H49z" fill="hsl(42 90% 62%)"/><path d="M48 44h24c16 9 24 22 24 36 0 14-14 22-36 22S24 94 24 80c0-14 8-27 24-36z" fill="hsl(${hue} 70% 58%)"/><rect x="47" y="40" width="26" height="7" rx="3.5" fill="hsl(42 90% 62%)"/>${eyes === 0 ? '<circle cx="50" cy="72" r="4" fill="#111"/><circle cx="70" cy="72" r="4" fill="#111"/>' : eyes === 1 ? '<rect x="44" y="70" width="12" height="4" rx="2" fill="#111"/><rect x="64" y="70" width="12" height="4" rx="2" fill="#111"/>' : '<circle cx="50" cy="72" r="5" fill="#fff"/><circle cx="51" cy="73" r="2.5" fill="#111"/><circle cx="70" cy="72" r="5" fill="#fff"/><circle cx="71" cy="73" r="2.5" fill="#111"/>'}<path d="M52 84q8 6 16 0" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/>${hat === 1 ? '<rect x="42" y="18" width="36" height="8" rx="2" fill="#222"/><rect x="50" y="6" width="20" height="14" rx="2" fill="#222"/>' : hat === 2 ? '<path d="M40 26 60 6l20 20z" fill="hsl(${h2} 70% 55%)"/>' : ''}</svg>`;
  }
  function bags() {
    const B = D.bags;
    view.innerHTML = `<div class="ph1"><h1>Bags</h1><p>1,000 numbered Bags, each with its own vault. Every hour the Bag pot buys the day's stock and drops an equal share into every Bag's vault. Whoever holds the Bag owns its vault.</p></div>
      <div class="stat3"><div class="card"><span>Minted</span><b>${B.minted} / ${num(B.total, 0)}</b><span>${num(B.minted * B.perMintLoot, 0)} $LOOT burned</span></div><div class="card"><span>Paid out so far</span><b class="up">${usd(B.paidUsd)}</b></div><div class="card"><span>Next payout in</span><b id="bcd">${mmss(B.nextHour)}</b><span>buys $${esc(label(B.today))} with 5% of the ${num(B.pot, 1)} ETH pot</span></div></div>
      <div class="chips"><button class="fchip on">All ${B.minted}</button><button class="fchip" data-preview>Yours 0</button><a class="btn sm" href="#/mint" style="margin-left:auto">Mint a Bag</a></div>
      <div class="bags">${B.list.map((x) => `<div class="card bagc">${bagArt(x.id, x.hue)}<b>Bag #${x.id}</b><small>${usd(x.earned)} earned</small></div>`).join('')}</div>${foot()}`;
    $$('[data-preview]').forEach((b) => (b.onclick = () => toast(PREVIEW)));
    let s = B.nextHour; every(1000, () => { s = s <= 1 ? 3600 : s - 1; const e = $('#bcd'); if (e) e.textContent = mmss(s); });
  }
  function mint() {
    const B = D.bags;
    view.innerHTML = `<div class="ph1"><h1>Mint a Bag</h1><p>Minting burns $LOOT and gives you the next numbered Bag. Every hour, the Bag pot spends 5% of what it holds on the day's token and splits it equally between all active Bags, straight into their vaults. Sell or send the Bag and its whole vault goes with it.</p></div>
      <div class="cg"><div>
        <div class="card panel"><div class="kv"><span>You send</span><b>${num(B.perMintLoot, 0)} $LOOT <span class="mute">burned</span> + ${B.perMintEth} ETH</b></div><div class="kv"><span>Where the ETH goes</span><b>0.045 ETH to the Bags already minted, 0.005 ETH to Lootbag</b></div><div class="kv"><span>You receive</span><b>Bag #${B.minted + 1}</b></div><div class="kv"><span>Left</span><b>${num(B.total - B.minted, 0)} of ${num(B.total, 0)}</b></div></div>
        <div class="card panel" style="margin-top:16px"><h3>How it works</h3>
          <div class="lrow" style="border:0;padding-left:0"><span class="pill">1</span><div class="grow"><b>Mint</b><div class="mute" style="font-size:13.5px">Your $LOOT is burned and you get a Bag with a vault tied to it. Whoever holds the Bag owns everything in its vault.</div></div></div>
          <div class="lrow" style="padding-left:0"><span class="pill">2</span><div class="grow"><b>Earn</b><div class="mute" style="font-size:13.5px">Every hour the pot spends 5% of what it holds on the day's token (${B.rotation.map((r) => '$' + label(r)).join(' → ')}) and sends every Bag an equal share.</div></div></div>
          <div class="lrow" style="padding-left:0"><span class="pill">3</span><div class="grow"><b>Withdraw</b><div class="mute" style="font-size:13.5px">Take your vault's tokens out whenever you like, or sell the Bag with its vault on any NFT marketplace.</div></div></div>
        </div>
      </div>
      <div class="sticky"><div class="card panel"><div style="max-width:220px;margin:0 auto 14px">${bagArt(B.minted + 1, 220)}</div><div style="text-align:center;margin-bottom:12px"><b>Bag #${B.minted + 1}</b><div class="mute" style="font-size:13px">The next Bag in line</div></div><button class="btn blue block" data-preview>Connect your wallet</button></div></div></div>${foot()}`;
    $$('[data-preview]').forEach((b) => (b.onclick = () => toast(PREVIEW)));
  }
  function lootCoins() {
    const cs = D.coins.filter((c) => c.official || c.pair === 'LOOT' || c.rewards.includes('LOOT')).sort((a, b) => b.mcap - a.mcap);
    view.innerHTML = `<div class="ph1"><h1>Lootbag coins</h1><p>Coins paired with $LOOT or paying their holders in $LOOT. Every buy of them buys $LOOT too.</p></div><div class="grid">${cs.map(card).join('')}</div>${foot()}`;
  }
  // ---------- $LOOT
  function loot() {
    const c = D.coins.find((x) => x.official);
    view.innerHTML = `<div class="ph1"><h1>$LOOT</h1><p>Lootbag's own coin. It launched on Lootbag like any other, so its holders get loot drops too: NVDA, TSLA, SPY and $LOOT itself, in turns.</p></div>
      <div class="stat3"><div class="card"><span>Market cap</span><b>${usd(c.mcap)}</b></div><div class="card"><span>Burned</span><b>${num(D.platform.burnedLoot, 0)}</b><span>by Bag mints</span></div><div class="card"><span>Paid to holders</span><b class="gold">${usd(c.paidAll)}</b></div></div>
      <div class="card panel"><h3>How $LOOT is tied to Lootbag</h3><div class="kv"><span>Every Bag minted</span><b>burns 100,000 $LOOT</b></div><div class="kv"><span>The Bag pot's rotation</span><b>buys $LOOT one day in five</b></div><div class="kv"><span>Its own trades</span><b>pay its holders, like every coin</b></div></div>
      <a class="btn gold" style="margin-top:16px" href="#/coin/${c.addr}">Trade $LOOT</a>${foot()}`;
  }

  // ---------- how it works
  function how() {
    const S = [
      ['overview', 'Overview', `<p>Lootbag is a coin launchpad where every coin pays its holders. Each coin opens its own Uniswap v4 pool the moment it launches, with its liquidity locked forever. Every buy and sell pays a 2% fee; a quarter of it, 0.5% of the trade, goes to the coin's holders.</p><p>Every five minutes that share is turned into the coin's reward (ETH or a tokenized stock such as NVDA, TSLA or SPY) and dropped into every holder's wallet, by how much they hold. Nobody has to claim anything.</p>`],
      ['launch', 'Launching a coin', `<p>One form, two approvals. You choose what your coin is <b>paired with</b> (ETH, USDG or a stock) and what its holders are <b>rewarded with</b> (ETH or up to 10 stocks, paid in turns). Your first buy is required and happens inside the launch transaction, so nobody can buy before you.</p><ul><li>Supply: 1,000,000,000, all of it in the pool at launch. No team allocation.</li><li>You can hold at most 2% at launch.</li><li>Launch fee: 0.001 ETH.</li><li>Tickers: each ticker launches once for free. A copy costs 0.05 ETH, refunded if the copy reaches $70K market cap within 48 hours.</li></ul>`],
      ['trading', 'Trading', `<p>Coins trade in their Uniswap v4 pool from the first block, on Lootbag or any app that routes through Uniswap. On Lootbag you can always pay in ETH: if a coin is paired with USDG or a stock, the route swaps your ETH for it in the same transaction.</p>`],
      ['fees', 'Fees', `<table><tr><th>Every buy and sell</th><th>Share of the trade</th></tr><tr><td>Holders, as loot drops</td><td>0.5%</td></tr><tr><td>Lootbag</td><td>1.5%</td></tr><tr><td><b>Total</b></td><td><b>2%</b></td></tr></table><p>Lootbag's share is split as it is earned: 25% to the Bag pot, 10% to the trader airdrop pot, and the rest to Lootbag.</p>`],
      ['loot', 'Loot drops', `<p>Every coin has its own round every five minutes, counted from its launch. The holders' share is bought into the current reward and sent to every holder by the size of their balance.</p><ul><li>A coin drops once at least $5 has built up; smaller amounts wait for the next round.</li><li>A wallet's share under $1 waits in the coin for a later round.</li><li>The pool, the creator's wallet and any wallet that bought in the launch block never earn.</li><li>Each holder's share is kept by the coin's own contract, which updates it on every transfer, so it is exact and on-chain. A holder can also take their own share at any time.</li></ul>`],
      ['airdrops', 'Trader airdrops', `<p>10% of Lootbag's revenue fills the airdrop pot. Every 10 hours it is paid in ETH to the top 500 traders by volume across all Lootbag coins: 5.3%, 4% and 3% to the top three, 13% shared by places 4 to 20, the rest by volume. At least $50 of volume, at most 10% of a pot per wallet, and coins sold or sent within 2 minutes don't count.</p>`],
      ['bags', 'Bags', `<p>1,000 numbered NFTs, each with its own vault. Minting burns 100,000 $LOOT and costs 0.05 ETH (0.045 ETH to the Bags already minted). Every hour the Bag pot spends 5% of what it holds on the day's token and drops an equal share into every Bag's vault. The holder of a Bag can withdraw its vault at any time, and the vault moves with the Bag when it's sold.</p>`],
      ['loottoken', '$LOOT', `<p>Lootbag's own coin, launched on Lootbag like any other. Its holders get loot drops in NVDA, TSLA, SPY and $LOOT. Bag mints burn it, and the Bag pot buys it one day in five.</p>`],
      ['contracts', 'Contracts', `<p>The addresses of every Lootbag contract, the fee wallets and the pots are published here at launch, so every payout can be checked on the explorer.</p>`],
      ['risks', 'Risks', `<p>Coins on Lootbag are launched by their creators, not by Lootbag. They are highly risky and can lose all their value. Loot drops depend on trading: a coin nobody trades pays nothing. Nothing here is financial advice.</p>`],
    ];
    view.innerHTML = `<div class="ph1"><h1>How Lootbag works</h1><p>How coins launch and trade, where every fee goes, and how holders, traders and Bags are paid.</p></div><div class="doc"><nav>${S.map(([id, t]) => `<a href="#/how#${id}" data-to="${id}">${t}</a>`).join('')}</nav><div>${S.map(([id, t, b]) => `<section id="d-${id}"><h2>${t}</h2>${b}</section>`).join('')}</div></div>${foot()}`;
    $$('[data-to]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); $('#d-' + a.dataset.to).scrollIntoView({ behavior: 'smooth' }); }));
    const frag = location.hash.split('#')[2]; if (frag) setTimeout(() => { const el = $('#d-' + frag); if (el) el.scrollIntoView(); }, 50);
  }

  // ---------- router
  function route() {
    timers.forEach(clearInterval); timers = []; if (chart) { chart.remove(); chart = null; }
    const h = location.hash.replace(/^#/, '') || '/', parts = h.split('#')[0].split('/').filter(Boolean), r = parts[0] || '';
    const key = '#/' + (r === 'coin' ? '' : r);
    $$('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === key));
    window.scrollTo(0, 0);
    if (!r) board(); else if (r === 'coin') coin(parts[1] || ''); else if (r === 'create') create(); else if (r === 'rewards') rewards(); else if (r === 'airdrops') airdrops(); else if (r === 'bags') bags(); else if (r === 'mint') mint(); else if (r === 'coins') lootCoins(); else if (r === 'loot') loot(); else if (r === 'how') how(); else board();
  }
  if (matchMedia('(max-width: 900px)').matches) $('#q').placeholder = 'Search';
  $('#q').oninput = () => { state.q = $('#q').value; if (location.hash && location.hash !== '#/') location.hash = '#/'; else drawGrid(); };
  D.ready.then(() => { route(); addEventListener('hashchange', route); });
})();
