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
  // a coin's picture: its uploaded image when it has one, otherwise a pixel sack drawn from its address
  const av = (c, size = 44) => `<span class="av${c.official ? '' : ' art'}" style="width:${size}px;height:${size}px;${c.official ? 'background:#16306b' : ''}">${c.official ? `<img src="/img/logo.svg" alt="" style="width:64%;height:64%">` : c.img ? `<img src="${esc(c.img)}" alt="">` : bagArt(2000 + parseInt(c.addr.slice(2, 9), 16) % 100000)}</span>`;
  const stkHue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const STK_LOGO = new Set(['AAOI', 'AAPL', 'ADBE', 'AMD', 'AMZN', 'ANT', 'ARM', 'AVGO', 'BE', 'BIDU', 'BILI', 'BRK.B', 'BUD', 'COIN', 'CRCL', 'CRWV', 'ETH', 'FGI', 'GME', 'GOOGL', 'GRND', 'HIMS', 'HOOD', 'HSAI', 'INFY', 'INTC', 'KO', 'LI', 'LITE', 'LLY', 'MCD', 'META', 'MRNA', 'MRVL', 'MSFT', 'MSTR', 'MU', 'NFLX', 'NIO', 'NKE', 'NOK', 'NOW', 'NVDA', 'NVO', 'ORCL', 'PDD', 'PLTR', 'SAN', 'SAP', 'SE', 'SGOV', 'SKHY', 'SNDK', 'SNOW', 'SONY', 'SPCX', 'SPYM', 'TSLA', 'TTWO', 'UL', 'USDC', 'VALE', 'VVV', 'WDC', 'WRD']), STK_LIGHT = new Set(['TTWO', 'VVV', 'SONY']);
  const tokenBadge = (s, size = 20) => {
    const z = `width:${size}px;height:${size}px`;
    if (s === 'LOOT') return `<img class="tkl" src="/img/logo.svg" alt="" style="${z};border-radius:50%;background:#16306b;padding:${Math.round(size * 0.14)}px">`;
    if (STK_LOGO.has(s)) return `<span class="stk lg${STK_LIGHT.has(s) ? ' lt' : ''}" style="${z}" title="${esc(s)}"><img src="/img/stk/${esc(s)}.png" alt="" loading="lazy"></span>`;
    return `<span class="stk" style="${z};background:hsl(${stkHue(s)} 55% 42%);font-size:${Math.max(7, Math.round(size * 0.3))}px">${esc(s.slice(0, 4))}</span>`;
  };
  const stack = (list, n = 4) => `<span class="stack">${list.slice(0, n).map((s) => tokenBadge(s)).join('')}</span>${list.length > n ? ` <span class="dim">+${list.length - n}</span>` : ''}`;
  const label = (s) => s;
  const pays = (c) => c.rewards.map(label).join(', ');
  const CRYPTO = ['ETH', 'USDC', 'VVV'], isStock = (s) => !CRYPTO.includes(s) && s !== 'LOOT';

  // ---------- nav
  // nav icons: one 24px grid, 1.75 stroke, round caps and joins
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    home: svg('<path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z"/>'),
    sack: svg('<path d="M9.2 3.6c.9.7 1.8 1 2.8 1s1.9-.3 2.8-1L13.7 7h-3.4z"/><path d="M10.1 7h3.8c3.2 1.8 5.4 4.7 5.4 8 0 3.4-2.9 5.5-7.3 5.5S4.7 18.4 4.7 15c0-3.3 2.2-6.2 5.4-8z"/><path d="M9.3 14.6c1.8 1.1 3.6 1.1 5.4 0"/>'),
    grid: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'),
    gift: svg('<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7M12 8v12.5"/><path d="M12 8C11 5 9.6 3.5 8 3.5a2.2 2.2 0 0 0 0 4.5zM12 8c1-3 2.4-4.5 4-4.5a2.2 2.2 0 0 1 0 4.5z"/>'),
    chute: svg('<path d="M3 11a9 9 0 0 1 18 0z"/><path d="M3 11l7 7M21 11l-7 7M12 11v7"/><rect x="9.5" y="18" width="5" height="3.5" rx="1"/>'),
    mint: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M12 8.5v7M8.5 12h7"/>'),
    book: svg('<path d="M12 6.8v13.7"/><path d="M3.5 5.2c2.9-.9 5.7-.6 8.5 1.6 2.8-2.2 5.6-2.5 8.5-1.6v13.3c-2.9-.9-5.7-.6-8.5 1.6-2.8-2.2-5.6-2.5-8.5-1.6z"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
  };
  const NAV = [['Trade', [['#/', 'Board', 'home'], ['#/coins', 'Lootbag coins', 'sack'], ['#/bags', 'Bags', 'grid']]], ['Earn', [['#/rewards', 'Rewards', 'gift'], ['#/airdrops', 'Airdrops', 'chute'], ['#/mint', 'Mint', 'mint']]], ['Learn', [['#/how', 'How it works', 'book']]]];
  $('#nav').innerHTML = NAV.map(([g, items]) => `<h6>${g}</h6>` + items.map(([h, l, i]) => `<a href="${h}" data-r="${h}">${I[i]}<span>${l}</span></a>`).join('')).join('');
  $('#tabbar').innerHTML = [['#/', 'Board', 'home'], ['#/create', 'Create', 'plus', 'plus'], ['#/coins', 'Lootbag coins', 'sack'], ['#/bags', 'Bags', 'grid'], ['#/rewards', 'Rewards', 'gift'], ['#/airdrops', 'Airdrops', 'chute'], ['#/mint', 'Mint', 'mint'], ['#/how', 'How it works', 'book']].map(([h, l, i, c]) => `<a href="${h}" data-r="${h}" class="${c || ''}" aria-label="${l}">${I[i]}</a>`).join('');
  const copyLoot = $('[data-copyloot]'); if (copyLoot) copyLoot.onclick = () => { navigator.clipboard && navigator.clipboard.writeText('0x10070000000000000000000000000000000b4c'); toast('$LOOT address copied'); };
  $$('[data-connect]').forEach((b) => (b.onclick = () => toast(PREVIEW)));

  const foot = () => `<footer class="foot"><div class="fr"><b>© ${new Date().getFullYear()} Lootbag</b><span><a href="#/how#contracts">Contracts</a><a href="#" data-pv>Terms</a><a href="#" data-pv>Privacy</a><a href="https://x.com" target="_blank" rel="noopener">X</a></span></div><p>Tokens on Lootbag are launched by their creators, not by Lootbag. They are highly risky and can lose all their value. Nothing here is financial advice.</p></footer>`;
  const hms = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm ' + (s % 60) + 's'; };
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
          <p>Launch a coin on VVV, ETH, USDC or a stock. Every trade pays your holders in ETH or stocks, and traders earn ETH airdrops.</p>
          <div class="acts"><a class="btn blue pill" href="#/create">Launch a coin</a></div>
        </div>
      </section>
      <div class="bar">${[['trending', 'Trending'], ['new', 'New'], ['paying', 'Paying now'], ['top', 'Top']].map(([k, l]) => `<button class="tab ${state.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}<span class="live">${cs.length} live</span></div>
      <div class="chips">${[['pVVV', 'Paired with VVV'], ['pETH', 'Paired with ETH'], ['pSTK', 'Paired with a stock'], ['stocks', 'Pays stocks'], ['eth', 'Pays ETH']].map(([k, l]) => `<button class="fchip ${state.chip === k ? 'on' : ''}" data-chip="${k}">${l}</button>`).join('')}</div>
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
    const f = { stocks: (c) => c.rewards.some(isStock), eth: (c) => c.rewards.includes('ETH'), pVVV: (c) => c.pair === 'VVV', pETH: (c) => c.pair === 'ETH', pUSDC: (c) => c.pair === 'USDC', pSTK: (c) => isStock(c.pair) }[state.chip];
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
        <div class="l1">${c.official ? 'Lootbag coin' : `Paired to ${tokenBadge(c.pair, 16)} <b>${esc(CRYPTO.includes(c.pair) ? c.pair : '$' + label(c.pair))}</b>`}</div>
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
    const cur = c.rewards[c.rewardIx], pairL = CRYPTO.includes(c.pair) ? c.pair : '$' + label(c.pair);
    const LOOT_USD = (D.coins.find((x) => x.official) || { priceUsd: 0.00124 }).priceUsd;
    const pairUsd = c.pair === 'ETH' ? D.ethUsd : c.pair === 'USDC' ? 1 : c.pair === 'VVV' ? D.vvvUsd : c.pair === 'LOOT' ? LOOT_USD : (D.stocks.find((x) => x.sym === c.pair) || { usd: 100 }).usd;
    const routeTxt = c.pair === 'ETH' ? 'Trades straight against <b>ETH</b>' : `Goes through <a>${esc(pairL)}</a>: ETH → ${c.pair === 'USDC' || c.pair === 'VVV' ? c.pair : c.pair === 'LOOT' ? '$LOOT' : 'USDC → ' + esc(pairL)} → $${esc(c.ticker)}`;
    view.innerHTML = `<a class="back" href="#/">← Board</a>
      <div class="cp">
        <div>
      <div class="chead"><div class="lg">${av(c, 64)}<span class="pb">${tokenBadge(c.pair, 24)}</span></div>
        <div style="min-width:0"><h1>${esc(c.name)}<span>$${esc(c.ticker)}</span></h1><div class="sub">Paired to <b>${esc(pairL)}</b> · holders are paid in ${esc(c.rewards.map((r) => (r === 'ETH' ? 'ETH' : '$' + label(r))).join(', '))} · ${ago(c.createdAt)} ago</div></div>
        <div class="links"><button class="btn sm" data-copy>Copy address <span class="mono">${short(c.addr)}</span></button>${c.x ? `<a class="btn sm" href="${esc(c.x)}" target="_blank" rel="noopener">X ↗</a>` : ''}<a class="btn sm" href="#" data-preview>DexScreener ↗</a><a class="btn sm" href="#" data-preview>Explorer ↗</a></div></div>
      <div class="kpis"><div><span>Market cap</span><b class="up">${usd(c.mcap)}</b></div><div><span>Price</span><b>${usd(c.priceUsd)}</b></div><div><span>Price in ${esc(pairL)}</span><b>${num(c.priceUsd / pairUsd, 9)}</b></div><div><span>Holders</span><b>${num(c.holders, 0)}</b></div></div>
          <div class="card chart"><div class="tools">${['1m', '5m', '15m', '1h', '4h', '1d'].map((t) => `<button class="${t === '5m' ? 'on' : ''}" data-tf="${t}">${t}</button>`).join('')}<div class="mode"><button class="on" data-mode="mc">MCap</button><i></i><button data-mode="px">Price</button></div></div><div id="cv"></div></div>
          <div class="hr">
            <h3>Holder rewards</h3>
            <p>The holders' share of every fee is kept by this coin's contract. Every 5 minutes, counted from this coin's launch, it pays every holder in ${esc(c.rewards.map(payTok).join(', '))}, by how much they hold. Nothing to claim.</p>
            <div class="hrow">${tokenBadge(cur, 32)}<b>${esc(payTok(cur))}</b>${c.rewards.length > 1 ? `<span class="dim">then ${esc(c.rewards.filter((r) => r !== cur).map(payTok).join(', '))}</span>` : ''}<span class="sp"></span><span class="mute">${c.pot >= 5 ? `Next payout in <b id="cd">${mmss(c.nextPayout)}</b>` : `Payout waiting for $5 in fees (${usd(c.pot)} so far)`}</span></div>
          </div>
        </div>
        <div class="sticky side-col">
          <div class="card panel">
            <div class="bs"><button class="on b" data-side="b">Buy</button><button class="s" data-side="s">Sell</button></div>
            <div class="field"><label><span id="amt-l">Amount (ETH)</span><span>Slippage 3%</span></label><div class="unit-in"><input class="inp" id="amt" placeholder="0.0" inputmode="decimal"><span id="amt-u">ETH</span></div><div class="presets" id="pre">${['0.01', '0.05', '0.1', '0.5'].map((v) => `<button data-v="${v}">${v} ETH</button>`).join('')}</div></div>
            <div class="route">Balance: — ETH<br>${routeTxt}<span id="est" hidden></span>${c.pair !== 'ETH' ? `<div class="paywith">Pay with <button class="on">ETH</button><button data-preview>${esc(pairL)}</button></div>` : ''}</div>
            <button class="btn green block" style="height:50px" id="go">Connect wallet</button>
          </div>
          <div class="rs"><div class="rh"><b>Next payout</b><span class="blue">${c.pot >= 5 ? 'ready' : Math.round((c.pot / 5) * 100) + '%'}</span></div><div class="meter"><i style="width:${Math.min(100, (c.pot / 5) * 100)}%"></i></div><p>Pays every holder every 5 minutes once $5 has built up. The coin trades in its own Uniswap v4 pool, and its liquidity is locked forever.</p></div>
          <div class="rs"><b class="rt">Details</b><div class="kv"><span>Address</span><b>${short(c.addr)}</b></div><div class="kv"><span>Pool</span><b>${short(c.creator)}</b></div><div class="kv"><span>Paired with</span><b>${esc(pairL)}</b></div><div class="kv"><span>Supply</span><b>1,000,000,000</b></div><div class="kv"><span>Trading fee</span><b>2%</b></div>
            <h4 class="rt2">Where every fee goes</h4><div class="kv"><span><i class="drop-dot" style="background:var(--buy)"></i>Holders</span><b>0.5%</b></div><div class="kv"><span><i class="drop-dot" style="background:var(--blue)"></i>Lootbag</span><b>1.5%</b></div></div>
        </div>
      </div>${foot()}`;
    $('[data-copy]').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(c.addr); toast('Address copied'); };
    $$('[data-preview]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); toast(PREVIEW); }));
    let side = 'b';
    const est = () => { const v = Number($('#amt').value) || 0; $('#est').textContent = v ? (side === 'b' ? `You get about ${num((v * D.ethUsd * 0.98) / c.priceUsd, 0)} $${c.ticker}` : `You get about ${num((v * c.priceUsd * 0.98) / D.ethUsd, 5)} ETH`) : 'You get about —'; };
    $$('[data-side]').forEach((b) => (b.onclick = () => { side = b.dataset.side; $$('[data-side]').forEach((x) => x.classList.toggle('on', x === b)); $('#amt-l').textContent = side === 'b' ? 'Amount (ETH)' : 'Amount ($' + c.ticker + ')'; $('#amt-u').textContent = side === 'b' ? 'ETH' : c.ticker; $('#pre').innerHTML = (side === 'b' ? ['0.01', '0.05', '0.1', '0.5'].map((v) => `<button data-v="${v}">${v} ETH</button>`) : ['25', '50', '75', '100'].map((v) => `<button data-v="${v}%">${v}%</button>`)).join(''); bindPre(); $('#go').className = 'btn block ' + (side === 'b' ? 'green' : 'red'); $('#go').style.height = '50px'; est(); }));
    const bindPre = () => $$('#pre button').forEach((b) => (b.onclick = () => { $('#amt').value = b.dataset.v.endsWith('%') ? '' : b.dataset.v; est(); }));
    bindPre(); $('#amt').oninput = est; $('#go').onclick = () => toast(PREVIEW);
    const sub = (k) => {
      $$('[data-st]').forEach((b) => b.classList.toggle('on', b.dataset.st === k));
      $('#st').innerHTML = k === 'trades' ? `<table class="t"><tr><th>Wallet</th><th>Side</th><th class="r">USD</th><th class="r">$${esc(c.ticker)}</th><th class="r">Age</th></tr>${c.trades.slice(0, 15).map((t) => `<tr><td class="mono">${short(t.wallet)}</td><td class="${t.buy ? 'up' : 'dn'}">${t.buy ? 'Buy' : 'Sell'}</td><td class="r">${usd(t.usd)}</td><td class="r">${num(t.tokens, 0)}</td><td class="r mute">${ago(t.ts)}</td></tr>`).join('')}</table>`
        : k === 'holders' ? `<table class="t"><tr><th>#</th><th>Wallet</th><th class="r">Share</th><th class="r">Earning</th></tr>${c.holderList.map((h, i) => `<tr><td class="mute">${i + 1}</td><td class="mono">${short(h.wallet)}</td><td class="r">${h.pct.toFixed(2)}%</td><td class="r up">${usd((c.paid24 * h.pct) / 100)}/day</td></tr>`).join('')}</table>`
        : `<table class="t"><tr><th>Paid</th><th>Paid in</th><th class="r">Amount</th><th class="r">Wallets</th></tr>${c.payouts.map((p) => `<tr><td class="mute">${ago(p.ts)} ago</td><td>${tokenBadge(p.token, 18)} ${esc(p.token === 'ETH' ? 'ETH' : '$' + label(p.token))}</td><td class="r up">${usd(p.usd)}</td><td class="r">${num(p.wallets, 0)}</td></tr>`).join('')}</table>`;
    };

    every(1000, () => { tickCards(); const el = $('#cd'); if (el) el.textContent = mmss(c.nextPayout); });
    let step = 300, mode = 'mc';
    drawChart(c, step, mode);
    $$('[data-tf]').forEach((b) => (b.onclick = () => { $$('[data-tf]').forEach((x) => x.classList.toggle('on', x === b)); step = { '1m': 300, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[b.dataset.tf]; drawChart(c, step, mode); }));
    $$('[data-mode]').forEach((b) => (b.onclick = () => { $$('[data-mode]').forEach((x) => x.classList.toggle('on', x === b)); mode = b.dataset.mode; drawChart(c, step, mode); }));
  }
  let chart = null;
  function drawChart(c, step, mode) {
    const f = mode === 'px' ? 1e-9 : 1;
    const el = $('#cv'); if (!el || !window.LightweightCharts) return;
    if (chart) { chart.remove(); chart = null; }
    chart = LightweightCharts.createChart(el, { layout: { background: { color: 'transparent' }, textColor: '#8f9ab3', fontFamily: 'Space Grotesk', fontSize: 11 }, grid: { vertLines: { color: 'rgba(34,48,75,.35)' }, horzLines: { color: 'rgba(34,48,75,.35)' } }, rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.2 } }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 6 }, crosshair: { mode: 1, vertLine: { color: '#33466b', labelBackgroundColor: '#15233f' }, horzLine: { color: '#33466b', labelBackgroundColor: '#15233f' } }, autoSize: true });
    const s = chart.addCandlestickSeries({ upColor: '#34d399', downColor: '#f2606b', borderVisible: false, wickUpColor: '#34d399', wickDownColor: '#f2606b', priceLineColor: '#3d7bff', priceLineStyle: 2, priceFormat: { type: 'custom', minMove: mode === 'px' ? 1e-12 : 0.01, formatter: (v) => usd(v) } });
    const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    const out = [], vs = []; let cur = null, cv = 0;
    for (const k of c.candles) { const b = Math.floor(k.t / step) * step; if (!cur || cur.time !== b) { if (cur) { out.push(cur); vs.push({ time: cur.time, value: cv, color: cur.close >= cur.open ? 'rgba(52,211,153,.45)' : 'rgba(242,96,107,.45)' }); } cur = { time: b, open: k.o * f, high: k.h * f, low: k.l * f, close: k.c * f }; cv = k.v; } else { cur.high = Math.max(cur.high, k.h * f); cur.low = Math.min(cur.low, k.l * f); cur.close = k.c * f; cv += k.v; } }
    if (cur) { out.push(cur); vs.push({ time: cur.time, value: cv, color: cur.close >= cur.open ? 'rgba(52,211,153,.45)' : 'rgba(242,96,107,.45)' }); }
    s.setData(out); vol.setData(vs); chart.timeScale().fitContent();
  }


  // ---------- create: one form card, the launch summary on the right
  function create() {
    const F = { pair: 'VVV', pairStock: 'NVDA', rewards: [], img: '', cat: 'all', dev: '0.01' };
    const stocks = D.stocks, crypto = [{ sym: 'ETH', name: 'Ether', usd: D.ethUsd }, { sym: 'USDC', name: 'USD Coin', usd: 1 }, { sym: 'VVV', name: 'Venice', usd: D.vvvUsd }], memes = [{ sym: 'LOOT', name: 'Lootbag', usd: 0.00124 }];
    const pool = () => (F.cat === 'stocks' ? stocks : F.cat === 'crypto' ? crypto : F.cat === 'memes' ? memes : [...crypto, ...stocks, ...memes]);
    const ic = { x: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L2 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>', tg: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 4 3 11l6 2 2 6 3-4 5 4z"/></svg>', web: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>', img: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="15" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m18.5 15-4-4-8 8M19 2v5M16.5 4.5h5"/></svg>' };
    view.innerHTML = `<div class="cg"><div class="card cform">
        <div class="ch"><h1>Create a coin</h1><button class="btn sm" id="reset">↺ Reset</button></div>
        <div class="crow"><label class="imgbox" id="ph" for="img">${ic.img}<b>ADD IMAGE</b><small>PNG, JPG, WEBP, GIF</small></label><input type="file" id="img" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
          <div class="cfields"><div class="two"><div class="field"><label><span class="lbl">Name</span><span id="n-n">0/32</span></label><input class="inp t" id="f-name" maxlength="32" placeholder="Name"></div><div class="field"><label><span class="lbl">Ticker</span><span id="t-n">0/10</span></label><div class="pre-in"><span>$</span><input class="inp t" id="f-tk" maxlength="10" placeholder="TICKER" style="text-transform:uppercase"></div></div></div>
          <div class="field"><label><span class="lbl">Description</span><span id="d-n">0/280</span></label><textarea class="inp" id="f-desc" maxlength="280" placeholder="Tell people what your coin is about, in a line or two"></textarea></div></div></div>
        <div class="fs"><div class="fh"><span class="lbl">Links</span><span>Optional. X and Telegram show in wallets and on DexScreener; your website shows on the coin's page here</span></div>
          <div class="three"><div class="icon-in">${ic.x}<input class="inp t" placeholder="X URL"></div><div class="icon-in">${ic.tg}<input class="inp t" placeholder="Telegram URL"></div><div class="icon-in">${ic.web}<input class="inp t" placeholder="Website URL"></div></div></div>
        <div class="fs"><div class="fh"><span class="lbl">Paired with</span><span id="pair-h">Trades in its own Uniswap v4 pool against VVV</span></div>
          <div class="seg3 four" id="pair">${[['VVV', 'VVV'], ['ETH', 'Ethereum'], ['USDC', 'USDC'], ['STOCK', 'Stock']].map(([k, t]) => `<button data-pair="${k}" class="${k === 'VVV' ? 'on' : ''}">${tokenBadge(k === 'STOCK' ? 'NVDA' : k, 24)}${t}</button>`).join('')}</div>
          <div id="pair-stock" style="display:none"><div class="srch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="inp t" id="ps-q" placeholder="Search by ticker or name"></div><div class="tgrid" id="ps"></div></div></div>
        <div class="fs"><div class="fh"><span class="lbl">Rewarded with</span><span>Paid to every holder in payout rounds every 5 minutes</span></div>
          <p class="fp">Each round buys the reward with the fees the coin earned and pays holders in it. Pick nothing and they get ETH. Pick more and they take turns.</p>
          <div class="cats" id="cats">${[['all', 'All', stocks.length + 4], ['stocks', 'Stocks', stocks.length], ['crypto', 'Crypto', 3], ['memes', 'Memes', 1]].map(([k, l, n]) => `<button data-cat="${k}" class="${k === 'all' ? 'on' : ''}">${l} <i>${n}</i></button>`).join('')}</div>
          <div class="srch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="inp t" id="rw-q" placeholder="Search by ticker, name or address"></div>
          <div class="tgrid" id="rw"></div></div>
        <div class="fs" style="border:0;padding-bottom:0"><div class="fh"><span class="lbl">Dev buy</span></div>
          <p class="fp">Required: at least 0.005 ETH, up to 2% of the supply. Creators can't hold more than that at launch, on every coin on Lootbag. Your coin is listed once it goes through.</p>
          <div class="devrow"><div class="cats" id="devp">${['0.005', '0.01', '0.05', '0.1'].map((v) => `<button data-dev="${v}" class="${v === F.dev ? 'on' : ''}">${v} ETH</button>`).join('')}</div><div class="amt-in"><input class="inp t" id="f-dev" value="${F.dev}" inputmode="decimal"><span>ETH</span></div></div>
          <div class="note" style="text-align:right" id="dev-usd"></div></div>
      </div>
      <div class="sticky"><div class="card panel" id="pv"></div></div></div>${foot()}`;
    const listBtn = (s, on, n) => `<button data-t="${s.sym}" class="${on ? 'on' : ''}">${tokenBadge(s.sym, 32)}<span><b>${esc(s.sym)}</b><small>${s.usd >= 1 ? usd(s.usd) : '$' + s.usd}</small></span>${n ? `<em>${n}</em>` : ''}</button>`;
    const ps = () => { const q = ($('#ps-q').value || '').toLowerCase(); $('#ps').innerHTML = stocks.filter((s) => !q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).map((s) => listBtn(s, F.pairStock === s.sym)).join(''); $$('#ps [data-t]').forEach((b) => (b.onclick = () => { F.pairStock = b.dataset.t; ps(); pv(); })); };
    const rw = () => { const q = ($('#rw-q').value || '').toLowerCase(); $('#rw').innerHTML = pool().filter((s) => !q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).map((s) => { const i = F.rewards.indexOf(s.sym); return listBtn(s, i >= 0, i >= 0 ? i + 1 : 0); }).join(''); $$('#rw [data-t]').forEach((b) => (b.onclick = () => { const s = b.dataset.t, i = F.rewards.indexOf(s); if (i >= 0) F.rewards.splice(i, 1); else if (F.rewards.length < 10) F.rewards.push(s); else toast('Up to 10 rewards'); rw(); pv(); })); };
    const pv = () => {
      const name = $('#f-name').value.trim(), tk = $('#f-tk').value.trim().toUpperCase(), pair = F.pair === 'STOCK' ? F.pairStock : F.pair, dev = Number($('#f-dev').value) || 0;
      $('#n-n').textContent = $('#f-name').value.length + '/32'; $('#t-n').textContent = $('#f-tk').value.length + '/10'; $('#dev-usd').textContent = '≈ ' + usd(dev * D.ethUsd);
      $('#pair-h').textContent = 'Trades in its own Uniswap v4 pool against ' + label(pair);
      const taken = tk && D.coins.find((c) => c.ticker === tk), rew = F.rewards.length ? F.rewards : ['ETH'];
      $('#pv').innerHTML = `<h3 style="font-size:16px;margin-bottom:16px">Launch summary</h3>
        <div class="sumhead">${F.img ? `<span class="sumimg" style="background-image:url('${F.img}')"></span>` : `<span class="sumimg">${ic.img}</span>`}<div><b>${esc(name || 'Untitled')}</b><div class="mute" style="font-size:13px">${tk ? '$' + esc(tk) : 'No ticker yet'}</div></div></div>
        <div style="margin:18px 0 4px"><div class="kv"><span>Trades on</span><b>Uniswap v4</b></div><div class="kv"><span>Paired with</span><b>${esc(label(pair))}</b></div><div class="kv"><span>Holders earn</span><b>${esc(rew.map(label).join(' → '))}</b></div><div class="kv"><span>Trading fee</span><b>2%</b></div><div class="kv"><span>Launch market cap</span><b>≈ $5K</b></div><div class="kv"><span>Supply</span><b>1,000,000,000</b></div><div class="kv"><span>Dev buy</span><b>${dev} ETH</b></div><div class="kv"><span>Liquidity</span><b>Locked forever</b></div><div class="kv"><span>Launch cost</span><b>0.001 ETH${taken ? ' + 0.05 ETH copy fee' : ''}</b></div></div>
        <div class="sect" style="padding-bottom:6px"><h4>Where every fee goes</h4><div class="kv"><span><i class="drop-dot" style="background:var(--buy)"></i>Holders</span><b>25%</b></div><div class="kv"><span><i class="drop-dot" style="background:var(--blue)"></i>Lootbag</span><b>75%</b></div></div>
        ${taken ? `<p class="note warn">$${esc(tk)} is already on Lootbag: a copy costs 0.05 ETH, refunded if your coin reaches $70K within 48 hours.</p>` : ''}
        <p class="note" style="line-height:1.6;margin:10px 0 18px">2 approvals in your wallet: first your dev buy's ETH is made ready, then the launch with your dev buy inside it, so nobody can buy before you. Your coin is listed on Lootbag as soon as it goes through.</p>
        <button class="btn blue block" style="height:46px" id="launch">Connect wallet</button>`;
      $('#launch').onclick = () => toast(PREVIEW);
    };
    $$('[data-pair]').forEach((b) => (b.onclick = () => { F.pair = b.dataset.pair; $$('[data-pair]').forEach((x) => x.classList.toggle('on', x === b)); $('#pair-stock').style.display = F.pair === 'STOCK' ? '' : 'none'; pv(); }));
    $$('[data-cat]').forEach((b) => (b.onclick = () => { F.cat = b.dataset.cat; $$('[data-cat]').forEach((x) => x.classList.toggle('on', x === b)); rw(); }));
    $$('[data-dev]').forEach((b) => (b.onclick = () => { $('#f-dev').value = b.dataset.dev; $$('[data-dev]').forEach((x) => x.classList.toggle('on', x === b)); pv(); }));
    $('#ps-q').oninput = ps; $('#rw-q').oninput = rw;
    ['#f-name', '#f-tk', '#f-dev'].forEach((s) => ($(s).oninput = pv));
    $('#f-desc').oninput = () => ($('#d-n').textContent = $('#f-desc').value.length + '/280');
    $('#reset').onclick = () => create();
    $('#img').onchange = () => { const f = $('#img').files[0]; if (!f) return; if (f.size > 1048576) return toast('The image is over 1 MB'); const r = new FileReader(); r.onload = () => { F.img = r.result; $('#ph').style.backgroundImage = `url('${F.img}')`; $('#ph').innerHTML = ''; pv(); }; r.readAsDataURL(f); };
    ps(); rw(); pv();
  }

  const statsRow = (items) => `<div class="srow">${items.map(([k, v, s]) => `<div><span>${k}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`).join('')}</div>`;
  const payTok = (r) => (CRYPTO.includes(r) ? r : '$' + label(r));

  // ---------- rewards
  function rewards() {
    const paying = D.coins.slice().sort((a, b) => b.paid24 - a.paid24).slice(0, 8), total24 = D.coins.reduce((s, c) => s + c.paid24, 0);
    view.innerHTML = `<div class="ph1"><h1>Rewards</h1><p>Hold a coin launched on Lootbag and you earn from every trade made in it. Rewards land in your wallet automatically; there's nothing to claim.</p></div>
      ${statsRow([['All payouts', usd(D.platform.paidHolders + D.bags.paidUsd), 'holders + Bag vaults'], ['Paid to holders', usd(D.platform.paidHolders), num(D.platform.paidHolders / 9.7, 0) + ' payments'], ['Last 24 hours', usd(total24), 'to holders'], ["You're earning on", '–', '']])}
      <div class="lookup"><button class="btn blue" data-connect2>Connect wallet</button><span class="mute">or</span><input class="inp t" id="rq" placeholder="Paste any wallet address"><button class="btn" id="rgo">Look up</button></div><div id="rres"></div>
      <div class="lh"><h3>Paying out now</h3><span>Hold any of these and you're paid every 5 minutes</span></div>
      <div>${paying.map((c) => `<a class="prow" href="#/coin/${c.addr}">${av(c, 40)}<div class="grow"><b>$${esc(c.ticker)}</b><div class="mute">${usd(c.paid24)} to holders in 24h · ${usd(c.mcap)} market cap</div></div><div class="pays"><span class="mute">Pays in</span>${tokenBadge(c.rewards[0], 20)}<b>${esc(payTok(c.rewards[0]))}</b>${c.rewards.length > 1 ? `<span class="dim">+${c.rewards.length - 1}</span>` : ''}</div></a>`).join('')}</div>
      <p class="fine">Every coin has its own payout round every 5 minutes, counted from its launch. In each round, the holders' share of its trading fees is swapped into the coin's reward token and split between all of its holders by how much they hold. A coin pays out once at least $5 has built up. A share under $1 in a round is skipped and stays in the pot for the next round.</p>${foot()}`;
    $('[data-connect2]').onclick = () => toast(PREVIEW);
    $('#rgo').onclick = () => { const v = $('#rq').value.trim(); $('#rres').innerHTML = /^0x[0-9a-fA-F]{40}$/.test(v) ? '<p class="note">No Lootbag coins in this wallet yet.</p>' : '<p class="note">Paste a full 0x address.</p>'; };
  }

  // ---------- airdrops
  function airdrops() {
    const A = D.airdrop, b = A.board.slice(0, 18), top = b.slice(3, 20).reduce((s, y) => s + y.vol, 0), rest = A.board.slice(20).reduce((s, y) => s + y.vol, 0) || 1;
    const share = (x, i) => (i === 0 ? 5.3 : i === 1 ? 4 : i === 2 ? 3 : Math.min(3, (13 * x.vol) / top));
    const left = A.endsAt - Date.now() / 1000;
    view.innerHTML = `<div class="ph1"><h1>Airdrops</h1><p>Trade any coin launched on Lootbag, here or in any app that routes through Uniswap. Every 10 hours the pot is split between the top 500 traders by volume, straight to their wallets. #1, #2 and #3 get 5.3%, 4%, 3% of the pot, places 4–20 share 13%, and everyone else shares the rest. Places 4 and down go by volume: the more volume, the bigger the share. You need at least $50 of volume in the round. Wash trading is filtered out: coins sold within 2 minutes of buying don't count.</p></div>
      <div class="srow big"><div><span>In the pot</span><b>${num(A.pot, 3)} ETH</b><small>≈ ${usd(A.potUsd)}</small></div><div><span>Next airdrop</span><b id="acd">${hms(left)}</b><div class="meter thin"><i style="width:${Math.max(4, 100 - (left / 36000) * 100)}%"></i></div><small>${num(A.traders, 0)} traders · ${usd(A.volume)} volume this round</small></div><div><span>Last airdrop · round 1</span><b>${num(A.pot * 1.7, 3)} ETH</b><small>to 500 traders · <u>every wallet</u></small></div></div>
      <div class="lookup" style="margin-top:28px"><span>Connect your wallet to see your rank and payout.</span><button class="btn blue" data-connect2>Connect wallet</button></div>
      <div class="lh"><h3>Leaderboard</h3><span>Top 50 shown · everyone up to #500 gets paid</span></div>
      <div class="tw"><table class="t lb"><tr><th>#</th><th>Wallet</th><th class="r">Volume</th><th class="r">Share</th><th class="r">Payout</th></tr>${b.map((x, i) => `<tr><td class="dim">${i + 1}</td><td>${short(x.wallet)}</td><td class="r">${usd(x.vol)}</td><td class="r mute">${share(x, i).toFixed(2)}%</td><td class="r up">${num((A.pot * share(x, i)) / 100, 3)} ETH</td></tr>`).join('')}</table></div>
      <div class="lh"><h3>Past airdrops</h3></div><div class="past"><span class="mute">Round 1</span><span class="mute">${new Date(Date.now() - 36000e3).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><b>${num(A.pot * 1.7, 3)} ETH</b><span class="mute">to 500 traders</span><span class="sp"></span><span class="mute">Every wallet</span><span class="mute">Transaction</span></div>
      <p class="fine">Payouts above are what the pot pays right now and grow as fees come in. A pot under 0.005 ETH, or a payout under 0.00005 ETH, rolls into the next airdrop.</p>${foot()}`;
    $('[data-connect2]').onclick = () => toast(PREVIEW);
    every(1000, () => { const e = $('#acd'); if (e) e.textContent = hms(A.endsAt - Date.now() / 1000); });
  }

  // ---------- Bags (NFT vaults): pixel art, drawn from the Bag's number
  function bagArt(id) {
    let x = id * 2654435761 % 4294967296; const r = () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
    const bgs = ['#fde68a', '#ddd6fe', '#fdba74', '#1e3a8a', '#c4b5fd', '#a7f3d0', '#fecdd3', '#bae6fd', '#e9d5ff', '#fef3c7'];
    const bodies = [['#e8484f', '#b32d36'], ['#3d7bff', '#2456c7'], ['#f59e0b', '#b86f06'], ['#22c55e', '#15803d'], ['#e5e7eb', '#9ca3af'], ['#a855f7', '#7e22ce'], ['#ec4899', '#be185d'], ['#374151', '#1f2937']];
    const bg = bgs[Math.floor(r() * bgs.length)], [b1, b2] = bodies[Math.floor(r() * bodies.length)], tie = ['#fbbf24', '#f8fafc', '#34d399', '#f472b6'][Math.floor(r() * 4)];
    const eyes = Math.floor(r() * 4), hat = Math.floor(r() * 5), mouth = Math.floor(r() * 3), px = [];
    const P = (cx, cy, c, w = 1, h = 1) => px.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`);
    // the sack: neck, tie, round body (16x16 grid)
    P(6, 3, b1, 4, 1); P(5, 4, tie, 6, 1); P(6, 5, b1, 4, 1);
    [[4, 6, 8], [3, 7, 10], [2, 8, 12], [2, 9, 12], [2, 10, 12], [2, 11, 12], [3, 12, 10], [4, 13, 8]].forEach(([sx, y, w]) => P(sx, y, b1, w, 1));
    [[3, 12, 10], [4, 13, 8]].forEach(([sx, y, w]) => P(sx, y, b2, w, 1)); P(2, 8, b2, 1, 4); P(13, 8, b2, 1, 4);
    P(4, 14, 'rgba(0,0,0,.18)', 8, 1);
    if (eyes === 0) { P(5, 9, '#111'); P(10, 9, '#111'); } else if (eyes === 1) { P(5, 9, '#fff', 2, 2); P(6, 10, '#111'); P(9, 9, '#fff', 2, 2); P(10, 10, '#111'); } else if (eyes === 2) { P(4, 9, '#111', 3, 1); P(9, 9, '#111', 3, 1); } else { P(4, 9, '#111', 8, 1); P(4, 9, '#3d7bff', 3, 1); P(9, 9, '#3d7bff', 3, 1); }
    if (mouth === 0) P(7, 11, '#111', 2, 1); else if (mouth === 1) { P(6, 11, '#111'); P(7, 12, '#111', 2, 1); P(9, 11, '#111'); } else P(7, 11, '#7f1d1d', 2, 2);
    if (hat === 1) { P(5, 1, '#111827', 6, 2); P(4, 3, '#111827', 8, 1); } else if (hat === 2) { P(7, 0, '#ef4444', 2, 1); P(6, 1, '#f59e0b', 4, 1); P(5, 2, '#3b82f6', 6, 1); } else if (hat === 3) { P(6, 1, '#22c55e', 1, 2); P(9, 1, '#22c55e', 1, 2); P(7, 2, '#16a34a', 2, 1); } else if (hat === 4) { P(4, 2, '#fde047', 8, 1); P(5, 1, '#fde047'); P(8, 1, '#fde047'); P(10, 1, '#fde047'); }
    if (r() < 0.3) { P(13, 2, '#fff'); P(12, 3, '#fff', 3, 1); P(13, 4, '#fff'); }
    return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" fill="${bg}"/>${px.join('')}</svg>`;
  }
  function bags() {
    const B = D.bags, list = Array.from({ length: 20 }, (_, k) => ({ id: k + 1, earned: Math.round(98 - (k > 4 ? 56 : 0) + ((k * 7) % 5)) }));
    view.innerHTML = `<div class="ph1"><h1>Bags</h1><p>Every Bag minted so far, and what each one holds in its vault.</p></div>
      <div class="card scard">${[['Minted', `${B.minted}<span> / ${num(B.total, 0)}</span>`, `<div class="meter thin"><i style="width:${(B.minted / B.total) * 100}%"></i></div>`], ['$LOOT burned', num(B.minted * B.perMintLoot, 0), num(B.perMintLoot, 0) + ' per mint'], ['Paid out so far', usd(B.paidUsd), '12 rounds · 1,478 payments'], ['In all vaults now', usd(B.paidUsd * 0.41), 'across ' + B.minted + ' Bags']].map(([k, v, s]) => `<div><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('')}</div>
      <div class="card nextp"><span class="mute">Next payout</span><b id="bcd">in ${mmss(B.nextHour)}</b><span class="mute">buys ${tokenBadge(B.today, 20)} <b>$${esc(label(B.today))}</b> with ≈ ${num(B.pot * 0.05, 2)} ETH, 5% of the ${num(B.pot, 1)} ETH pot, split across ${B.minted} Bags (≈ ${num((B.pot * 0.05) / B.minted, 4)} ETH each)</span></div>
      <div class="metal"><span>Bag pot 0x9a2c…41f0</span><span>Collection 0x5b1e…7c2a</span><span>5% royalty on resales</span></div>
      <div class="card gridcard"><div class="gh"><div class="cats"><button class="on">All <i>${B.minted}</i></button><button data-preview>Yours <i>0</i></button></div><div class="srch" style="margin:0;max-width:290px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="inp t" placeholder="Bag # or owner wallet"></div></div>
        <div class="nftgrid">${list.map((x) => `<div class="nft"><div class="art">${bagArt(x.id)}</div><div class="nb"><b>Bag #${x.id}</b><span>${usd(x.earned)} <i>earned</i></span><button class="btn block" data-preview>OpenSea</button></div></div>`).join('')}</div></div>${foot()}`;
    $$('[data-preview]').forEach((b) => (b.onclick = () => toast(PREVIEW)));
    let s = B.nextHour; every(1000, () => { s = s <= 1 ? 3600 : s - 1; const e = $('#bcd'); if (e) e.textContent = 'in ' + mmss(s); });
  }
  function mint() {
    const B = D.bags;
    view.innerHTML = `<div class="ph1"><h1>Mint a Bag</h1><p>A Bag is an NFT with its own vault that only the NFT controls. Minting burns $LOOT and gives you the next numbered Bag. Every hour, the Bag pot spends 5% of what it holds on the day's token and splits it equally between all active Bags, straight into their vaults. Sell or send the NFT and its whole vault goes with it.</p></div>
      <div class="mintgrid"><div class="card mintc">
          <div class="ms"><h4>You send</h4><div class="mrow"><span><b>$LOOT</b> <i>burned</i></span><b class="big">${num(B.perMintLoot, 0)}</b></div><div class="mrow" style="border:0"><span><b>ETH</b> <i>0.045 ETH goes to the Bags already minted, 0.005 ETH to Lootbag</i></span><b class="big">${B.perMintEth}</b></div></div>
          <div class="arrow">↓</div>
          <div class="mr"><h4>You receive</h4><div class="recv"><div class="art">${bagArt(B.minted + 1)}</div><div><b style="font-size:20px">Bag #${B.minted + 1}</b><p class="mute" style="margin:4px 0 8px;font-size:14px">The next Bag in line. It earns 5 tokens in rotation. ${num(B.total - B.minted, 0)} of ${num(B.total, 0)} are left.</p><span class="stack">${B.rotation.map((t) => tokenBadge(t, 22)).join('')}</span></div></div>
          <p class="note">Plus a little ETH for gas to open the vault.</p><button class="btn blue block pillish" data-preview>Connect your wallet</button></div></div>
        <div class="card yours"><h3>Your Bags</h3><div class="empty">Connect your wallet to see your Bags.</div></div></div>
      <div class="card how3"><h3>How it works</h3><div class="cols">${[['Mint', 'Your $LOOT is burned and you get an NFT with a vault tied to it. Whoever holds the NFT owns everything in its vault.'], ['Activate', 'The vault opens a balance for each token in the rotation the first time it is paid, so it can receive every token from then on.'], ['Earn', "Every hour, the pot spends 5% of what it holds on the day's token and sends every active Bag an equal share, straight into its vault. Withdraw whenever you like."]].map(([t, d], i) => `<div><div class="ct"><span class="n">${i + 1}</span><b>${t}</b></div><p>${d}</p></div>`).join('')}</div></div>${foot()}`;
    $$('[data-preview]').forEach((b) => (b.onclick = () => toast(PREVIEW)));
  }

  // ---------- Lootbag coins: square tiles
  function lootCoins() {
    let sort = 'mcap';
    const draw = () => {
      const q = ($('#lq') && $('#lq').value || '').toLowerCase();
      const cs = D.coins.filter((c) => !q || c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).sort((a, b) => (sort === 'mcap' ? b.mcap - a.mcap : b.mcap * 0.3 - a.mcap * 0.3 + (b.holders - a.holders)));
      $('#tiles').innerHTML = cs.map((c) => `<div class="tile"><a href="#/coin/${c.addr}" class="sq">${av(c, 210)}${c.official ? '<span class="tb gr">Lootbag</span>' : c.pair === 'LOOT' || c.rewards.includes('LOOT') ? '<span class="tb">LOOT</span>' : ''}</a><div class="tt"><b>$${esc(c.ticker)}</b> <span>${esc(c.name)}</span></div><div class="tm"><span class="up">${usd(c.mcap)}</span> · liq ${usd(c.mcap * 0.28)}</div><a class="btn block" href="#/coin/${c.addr}">Trade $${esc(c.ticker)}</a></div>`).join('');
    };
    view.innerHTML = `<div class="ph1 row"><div><h1>Lootbag coins</h1><p>Coins launched on Lootbag, paired with VVV, ETH, USDC or a stock.</p></div><div class="ph1r"><div class="tog"><button class="on" data-s="mcap">Market cap</button><button data-s="liq">Liquidity</button></div><div class="srch" style="margin:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="inp t" id="lq" placeholder="Search Lootbag coins"></div></div></div><div class="tiles" id="tiles"></div>${foot()}`;
    $$('[data-s]').forEach((b) => (b.onclick = () => { sort = b.dataset.s; $$('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    $('#lq').oninput = draw; draw();
  }

  // ---------- how it works
  function how() {
    const S = [
      ['overview', 'Overview', `<p>Lootbag is a coin launchpad on Base, built on Uniswap v4. Every coin launched on Lootbag shares its trading fees with the wallets that hold it: part of the fee on each trade is kept for them and paid out every five minutes.</p><p>A creator makes two choices when launching a coin. The first is the pair, the token the coin is priced in: VVV (the default), ETH, USDC or a tokenized stock. The second is the reward, the token its holders are paid in. Everything after the launch is automated: fees are collected, the reward is bought and distributed, and holders never have to claim anything.</p><p>Lootbag shares its own revenue as well. 10% of it is paid to the traders of Lootbag coins as ETH airdrops every 10 hours, and 25% goes to Bags and is paid into vaults owned by their holders.</p>`],
      ['launch', 'Launching a coin', `<p>A launch takes one form and two wallet approvals.</p><ul><li><b>Pair.</b> VVV by default, or ETH, USDC or a stock. Buyers can always pay in ETH: the route swaps it for them.</li><li><b>Reward.</b> The token holders are paid in. It defaults to ETH; pick up to 10 and they take turns.</li><li><b>Launch transaction.</b> Creates the coin and opens its own Uniswap v4 pool with all 1,000,000,000 coins in it, liquidity locked forever. It costs 0.001 ETH plus gas.</li><li><b>Dev buy.</b> Required, at least 0.005 ETH, inside the launch transaction so nobody can buy before the creator. A creator can hold at most 2% at launch.</li><li><b>Launch-block buyers earn nothing.</b> A wallet that buys in the launch block never receives holder rewards from that coin or airdrop credit for it.</li></ul>`],
      ['trading', 'How a coin trades', `<p>Every coin trades in its own Uniswap v4 pool from the first block, on Lootbag or in any app that routes through Uniswap. There is no bonding curve and no graduation: the pool is the market from launch, and its liquidity can never be withdrawn.</p>`],
      ['fees', 'Fees', `<p>Every buy and sell pays a fee of 2%.</p><table><tr><th>Holders</th><th>Lootbag</th></tr><tr><td>0.5%</td><td>1.5%</td></tr></table><p>Lootbag's share is split as it is paid: 25% to the Bag pot, 10% to the trader airdrop pot, and the rest to Lootbag. Holders never receive Lootbag's share, and Lootbag never takes theirs.</p>`],
      ['rewards', 'Holder rewards', `<p>Every coin has its own payout round every five minutes, counted from its launch. In each round the holders' share is bought into the current reward and split between all holders by the size of their balances. Pools and launch-block buyers are left out, and so is the creator's wallet.</p><p>A coin pays out once at least $5 has built up. A share below $1 waits for a later round. Each holder's share is kept by the coin's own contract, which updates it on every transfer, so it is exact and on-chain.</p>`],
      ['airdrops', 'Trader airdrops', `<p>10% of Lootbag's revenue goes into the airdrop pot. Every 10 hours the pot is paid in ETH to the 500 wallets that traded the most volume on Lootbag coins. #1, #2 and #3 get 5.3%, 4%, 3%; places 4–20 share 13%; everyone else up to #500 shares the rest by volume. At least $50 of volume, at most 10% of a pot per wallet, and coins sold or sent within 2 minutes don't count.</p>`],
      ['tickers', 'Tickers', `<p>A ticker is 2 to 10 letters or digits; capitalization doesn't matter. Each ticker can be launched once for free. Launching an existing ticker again costs 0.05 ETH, refunded if the new coin reaches $70K market cap within 48 hours.</p>`],
      ['bags', 'Bags', `<p>A Bag is an NFT with its own vault. The collection is limited to 1,000. Minting burns 100,000 $LOOT and costs 0.05 ETH, of which 0.045 ETH goes to the Bags already minted. Once an hour the Bag pot spends 5% of what it holds on the day's token and sends an equal amount into every Bag's vault. The holder of the Bag can withdraw its vault at any time; the vault moves with the Bag when it's sold.</p>`],
      ['loot', '$LOOT', `<p>$LOOT is Lootbag's own coin. Minting a Bag burns 100,000 $LOOT, and the Bag pot buys it one day in five.</p>`],
      ['contracts', 'Contracts', `<p>The addresses of Lootbag's contracts, fee wallets and pots are published here at launch.</p>`],
    ];
    view.innerHTML = `<div class="doc"><nav>${S.map(([id, t], i) => `<a href="#/how#${id}" data-to="${id}" class="${i ? '' : 'on'}">${t}</a>`).join('')}</nav><div><div class="ph1" style="margin-top:0"><h1>How it works</h1><p>How coins are launched and traded on Lootbag, how fees are divided, and how holders and traders are paid.</p></div>${S.map(([id, t, b]) => `<section id="d-${id}"><h2>${t}</h2>${b}</section>`).join('')}</div></div>${foot()}`;
    $$('[data-to]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); $$('[data-to]').forEach((x) => x.classList.toggle('on', x === a)); $('#d-' + a.dataset.to).scrollIntoView({ behavior: 'smooth' }); }));
    const frag = location.hash.split('#')[2]; if (frag) setTimeout(() => { const el = $('#d-' + frag); if (el) el.scrollIntoView(); }, 50);
  }

  // ---------- router
  function route() {
    timers.forEach(clearInterval); timers = []; if (chart) { chart.remove(); chart = null; }
    const h = location.hash.replace(/^#/, '') || '/', parts = h.split('#')[0].split('/').filter(Boolean), r = parts[0] || '';
    const key = '#/' + (r === 'coin' ? '' : r);
    $$('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === key));
    window.scrollTo(0, 0);
    if (!r) board(); else if (r === 'coin') coin(parts[1] || ''); else if (r === 'create') create(); else if (r === 'rewards') rewards(); else if (r === 'airdrops') airdrops(); else if (r === 'bags') bags(); else if (r === 'mint') mint(); else if (r === 'coins') lootCoins(); else if (r === 'loot') coin((D.coins.find((x) => x.official) || {}).addr || ''); else if (r === 'how') how(); else board();
  }
  if (matchMedia('(max-width: 900px)').matches) $('#q').placeholder = 'Search';
  $('#q').oninput = () => { state.q = $('#q').value; if (location.hash && location.hash !== '#/') location.hash = '#/'; else drawGrid(); };
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-pv]'); if (t) { e.preventDefault(); toast(PREVIEW); } });
  D.ready.then(() => { route(); addEventListener('hashchange', route); });
})();
