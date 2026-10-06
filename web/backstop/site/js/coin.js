/* Coin page: price against its buyback line and vault backing, each strategy the coin runs, trading and activity. */
(function () {
  const U = () => window.UI;
  const addr = (location.pathname.split('/coin/')[1] || new URLSearchParams(location.search).get('a') || '').toLowerCase().replace(/[^0-9a-fx]/g, '');
  let x = null, chart = null, range = '7d', tab = 'trades', side = 'buy', showBacking = false;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const alpha = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const barOf = ts => x.chart.t0 + Math.max(0, Math.min(x.chart.px.length - 1, Math.floor((ts - x.chart.t0) / x.chart.step))) * x.chart.step;
  const pairAmt = (v) => U().num(v, v >= 100 ? 0 : 4) + ' ' + x.pairSym;

  // ------------------------------------------------------------ head
  function head() {
    const { esc, usd, delta, pairGlyph, tokImg, short, ago, ic } = U();
    return `<nav class="crumbs"><a href="/">Explore</a><span>/</span><span>${esc(x.name)}</span></nav>
    <div class="coin-head">${pairGlyph(x, 'lg')}
      <div class="coin-title"><h1>${esc(x.name)} <span class="sym">$${esc(x.symbol)}</span>${x.demo ? '<span class="tag sample">Sample</span>' : ''}</h1>
        <div class="coin-meta"><span class="pairwith">${tokImg({ logo: x.pairLogo })}Backed by <b>${esc(x.pairSym)}</b></span><span>by <span class="mono">${short(x.creator)}</span></span><span>launched ${ago(x.createdAt)} ago</span>
        <button data-copy="${x.addr}" title="Copy contract address">${ic('copy')}<span class="mono">${short(x.addr)}</span></button></div></div>
      <div class="coin-price"><b>${usd(x.px)}</b><span>${delta(x.c24)} 24h · ${usd(x.mc)} market cap</span></div>
    </div>`;
  }
  function kpis() {
    const { usd, num, pct } = U();
    const v = x.vault, f = x.fund; const dips = x.events.length;
    return `<div class="kpis">
      <div class="v"><span>Vault backing</span><b>${v ? usd(v.usd) : '—'}</b><small>${v ? `${usd(v.perCoin)} per coin` : 'No vault'}</small></div>
      <div class="o"><span>Buyback fund</span><b>${f ? usd(f.usd) : '—'}</b><small>${f ? `next at ${pct(x.toTrigger)}` : 'No dip buybacks'}</small></div>
      <div><span>Burned</span><b>${x.burned ? (x.burned / BS.SUPPLY * 100).toFixed(2) + '%' : '0%'}</b><small>${dips ? `${num(x.burned, 0)} coins, ${dips} burn${dips > 1 ? 's' : ''}` : 'nothing yet'}</small></div>
      <div><span>Holders</span><b>${num(x.holders, 0)}</b><small>${x.split.holders ? `${usd(x.fees.holders)} paid to them` : 'rewards off'}</small></div>
    </div>`;
  }

  // ------------------------------------------------------------ chart
  function chartPanel() {
    return `<section class="panel chart-panel"><div class="panel-h"><h2>Price</h2><div class="r" style="display:flex;gap:8px;flex-wrap:wrap">${x.vault ? `<button class="chip" id="bkBtn" aria-pressed="false" title="Draw the vault backing per coin under the price (log scale)"><span class="strat"><i class="v on">V</i></span>Backing</button>` : ''}<div class="seg" id="rangeSeg"><button data-r="1d">24H</button><button data-r="7d">7D</button><button data-r="all">All</button></div></div></div>
      <div class="chart" id="chart"></div>
      <div class="legend"><span><i></i>Price</span>${x.vault ? '<span id="bkLegend" class="hidden"><i class="v"></i>Vault backing per coin</span>' : ''}${x.fund ? '<span><i class="dash"></i>High since last buyback</span><span><i class="bb"></i>Buyback line, 20% under the high</span>' : ''}${x.events.some(e => e.kind === 'dip') ? '<span><i class="dot"></i>Dip buyback &amp; burn</span>' : ''}${x.events.some(e => e.kind === 'tp') ? '<span><i class="dot v"></i>Take-profit burn</span>' : ''}<span style="margin-left:auto" class="faint" id="scaleNote">Log scale</span></div></section>`;
  }
  function drawChart() {
    const el = document.getElementById('chart'); if (!el || !window.LightweightCharts) return;
    if (chart) { chart.remove(); chart = null; }
    const { usd } = U(); const ink = css('--ink'), muted = css('--muted'), line = css('--line'), vault = css('--vault'), bb = css('--bb');
    chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: alpha(line.startsWith('#') ? line : '#dbe1e8', .6) }, horzLines: { color: alpha(line.startsWith('#') ? line : '#dbe1e8', .6) } },
      rightPriceScale: { borderVisible: false, mode: showBacking ? 1 : 0, scaleMargins: { top: .12, bottom: .08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 3 },
      crosshair: { mode: 0, vertLine: { color: muted, labelBackgroundColor: ink }, horzLine: { color: muted, labelBackgroundColor: ink } },
      localization: { priceFormatter: p => usd(p) },
    });
    const fmt = { type: 'custom', formatter: p => usd(p), minMove: 1e-12 };
    const s = chart.addAreaSeries({ lineColor: ink, topColor: alpha(ink, .1), bottomColor: alpha(ink, 0), lineWidth: 2, priceFormat: fmt, priceLineVisible: false });
    const c = x.chart; const data = c.px.map((p, i) => ({ time: c.t0 + i * c.step, value: p }));
    s.setData(data);
    if (x.vault && showBacking) {
      const b = chart.addLineSeries({ color: vault, lineWidth: 2, priceFormat: fmt, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false });
      b.setData(c.backing.map((v, i) => ({ time: c.t0 + i * c.step, value: v })).filter(d => d.value > 0));
    }
    if (x.fund) {
      s.createPriceLine({ price: x.fund.ref, color: muted, lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: 'High' });
      s.createPriceLine({ price: x.fund.trigger, color: bb, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Buyback' });
    }
    const marks = x.events.map(e => ({ time: barOf(e.ts), position: e.kind === 'dip' ? 'belowBar' : 'aboveBar', color: e.kind === 'dip' ? bb : vault, shape: 'circle', size: 1 })).sort((a, b) => a.time - b.time);
    s.setMarkers(marks);
    setRange();
    const bk = document.getElementById('bkBtn'); if (bk) { bk.classList.toggle('on', showBacking); bk.setAttribute('aria-pressed', showBacking); }
    const lg = document.getElementById('bkLegend'); if (lg) lg.classList.toggle('hidden', !showBacking);
    const sn = document.getElementById('scaleNote'); if (sn) sn.textContent = showBacking ? 'Log scale' : '';
  }
  function setRange() {
    if (!chart) return; const c = x.chart; const end = c.t0 + (c.px.length - 1) * c.step;
    const span = { '1d': 86400, '7d': 7 * 86400 }[range];
    if (!span || end - span <= c.t0) chart.timeScale().fitContent(); else chart.timeScale().setVisibleRange({ from: end - span, to: end });
    U().$$('#rangeSeg button').forEach(b => b.classList.toggle('on', b.dataset.r === range));
  }

  // ------------------------------------------------------------ strategy cards
  function vaultCard() {
    const { usd, pct, tokImg, esc } = U(); const v = x.vault;
    const gain = (v.usd / v.cost - 1) * 100;
    return `<section class="panel sc vault"><div class="panel-h"><h3>Vault</h3><span class="tag vault">${U().bps(x.split.vault)} of every trade</span></div><div class="panel-b">
      <div class="big"><b>${usd(v.usd)}</b><span>${tokImg({ logo: x.pairLogo })}</span><span class="mono">${pairAmt(v.amount)}</span></div>
      <div class="kv"><div><span>Paid for it</span><b>${usd(v.cost)} <span class="${gain >= 0 ? 'up' : 'down'}">${pct(gain)}</span></b></div><div><span>Backing per coin</span><b>${usd(v.perCoin)}</b></div><div><span>Price vs backing</span><b>${(x.px / v.perCoin).toFixed(1)}×</b></div></div>
      <p class="note">Every trade buys ${esc(x.pairSym)} into the vault. Nothing can withdraw it, the creator included. It only leaves ${x.redeem && x.tp ? 'when holders redeem or the vault takes profit' : x.redeem ? 'when holders redeem' : x.tp ? 'through take-profit burns' : 'never: it only grows'}.</p></div></section>`;
  }
  function dipCard() {
    const { usd, pct, num } = U(); const f = x.fund; const dips = x.events.filter(e => e.kind === 'dip');
    const next2 = f.trigger * 0.8;
    return `<section class="panel sc bb"><div class="panel-h"><h3>Dip buyback</h3><span class="tag bb">${U().bps(x.split.buyback)} of every trade</span></div><div class="panel-b">
      <div class="big"><b>${usd(f.usd)}</b><span>ready, spends <b class="mono" style="font-size:13px;color:var(--ink)">${usd(f.usd / 2)}</b> at the line</span></div>
      <div class="ladder">
        <div><span class="rung hi">High since last buyback</span><span class="val">${usd(f.ref)}</span></div>
        <div><span class="rung now">Price now</span><span class="val">${usd(x.px)}</span></div>
        <div><span class="rung trig">Buyback line (−20%)</span><span class="val c-bb">${usd(f.trigger)} <span class="faint">${pct(x.toTrigger)}</span></span></div>
        <div><span class="rung next">Line after that (−36%)</span><span class="val faint">${usd(next2)}</span></div>
      </div>
      <p class="note">When the 30-minute average price closes under the line, half the fund buys ${esc2(x.symbol)} and burns it. The high then resets to that price, so every further 20% fall triggers again. ${dips.length ? `${dips.length} buyback${dips.length > 1 ? 's' : ''} so far, ${num(dips.reduce((s, e) => s + e.burned, 0), 0)} coins burned.` : 'No buyback yet.'}</p></div></section>`;
  }
  const esc2 = s => '$' + U().esc(s);
  function tpCard() {
    const { usd, pct } = U(); const v = x.vault; const gain = (v.usd / v.cost - 1) * 100; const at = Math.max(0, Math.min(100, gain / x.tp * 100)); const tps = x.events.filter(e => e.kind === 'tp');
    return `<section class="panel sc tp"><div class="panel-h"><h3>Take profit</h3><span class="tag vault">at +${x.tp}%</span></div><div class="panel-b">
      <div class="big"><b class="${gain >= 0 ? '' : 'down'}" style="color:${gain >= 0 ? 'var(--vault)' : ''}">${pct(gain)}</b><span>of +${x.tp}% target</span></div>
      <div><div class="progress"><i style="width:${at.toFixed(1)}%"></i></div><div class="progress-l"><span>Vault cost ${usd(v.cost)}</span><span>Sells at ${usd(v.cost * (1 + x.tp / 100))}</span></div></div>
      <p class="note">When the vault is worth ${x.tp}% more than it paid, it sells the gain, about ${usd(v.cost * x.tp / 100)} today, buys ${esc2(x.symbol)} and burns it. What the vault paid stays in it. ${tps.length ? `${tps.length} take-profit${tps.length > 1 ? 's' : ''} so far, ${usd(tps.reduce((s, e) => s + e.usd, 0))} burned.` : ''}</p></div></section>`;
  }
  function redeemCard() {
    const { usd, num } = U();
    return `<section class="panel sc vault"><div class="panel-h"><h3>Redeem at backing</h3><span class="tag vault">On</span></div><div class="panel-b">
      <div class="redeem-box"><div class="field"><label for="rdIn">Coins to burn</label><div class="input-wrap"><input class="input num with-post" id="rdIn" inputmode="decimal" value="1000000"><span class="post">$${U().esc(x.symbol)}</span></div></div>
      <div class="redeem-out"><span>You receive</span><b id="rdOut"></b></div>
      <button class="btn btn-line btn-block" disabled>Redeem</button></div>
      <p class="note">Burn coins and take their share of the vault in ${U().esc(x.pairSym)}: ${usd(x.vault.perCoin)} per coin today. Everyone else's backing per coin stays the same. Selling pays more while the price is above backing; redeem is the floor.</p></div></section>`;
  }
  function rewardsCard() {
    const { usd, tokImg, esc, payoutLabel } = U();
    const logos = x.rewards === 'eth' ? [{ logo: BS.known(BS.weth).logo }] : x.rewards === 'basket' ? x.basket : [{ logo: x.pairLogo }];
    return `<section class="panel sc"><div class="panel-h"><h3>Holder rewards</h3><span class="tag" style="background:var(--holders-soft);color:var(--holders)">${U().bps(x.split.holders)} of every trade</span></div><div class="panel-b">
      <div class="big"><b style="color:var(--holders)">${usd(x.fees.holders)}</b><span>paid to holders so far</span></div>
      <div class="kv"><div><span>Paid in</span><b style="display:flex;align-items:center;gap:6px;justify-content:flex-end">${logos.map(l => tokImg(l)).join('')}${esc(payoutLabel(x))}</b></div><div><span>Per $10,000 traded</span><b>${usd(x.split.holders)}</b></div></div>
      <p class="note">Each trade's holder share is split across every wallet holding ${esc2(x.symbol)}, in proportion to its balance. Claim any time from your portfolio.</p></div></section>`;
  }
  function offCard() {
    const off = U().STRATS.filter(([k, , , on]) => !on(x));
    if (!off.length) return '';
    return `<section class="panel sc"><div class="panel-h"><h3>Not used by this coin</h3></div><div class="panel-b"><div class="kv">${off.map(([k, l, name, , d]) => `<div style="align-items:flex-start"><span style="display:flex;gap:8px;align-items:flex-start"><span class="strat"><i>${l}</i></span><span><b style="color:var(--ink-2);font-weight:600;font-family:var(--f-body)">${name}</b><br><span style="font-size:12.5px">${d}.</span></span></span></div>`).join('')}</div>
      <p class="note">Strategies are chosen at launch and can't be added or removed later.</p></div></section>`;
  }
  function strategies() {
    const cards = [];
    if (x.vault) cards.push(vaultCard());
    if (x.fund) cards.push(dipCard());
    if (x.tp && x.vault) cards.push(tpCard());
    if (x.redeem && x.vault) cards.push(redeemCard());
    if (x.split.holders) cards.push(rewardsCard());
    const off = offCard(); if (off) cards.push(cards.length % 2 === 0 ? off.replace('class="panel sc"', 'class="panel sc" style="grid-column:1/-1"') : off);
    return `<div class="strategies">${cards.join('')}</div>`;
  }

  // ------------------------------------------------------------ activity
  function activity() {
    const n = { trades: x.trades.length, events: x.events.length, holders: x.top.length };
    return `<section class="panel act"><div class="tabs" id="actTabs" role="tablist"><button data-t="trades">Trades</button><button data-t="events">Buybacks &amp; burns<span class="n">${n.events}</span></button><button data-t="holders">Holders<span class="n">${U().num(x.holders, 0)}</span></button></div><div class="table-wrap" style="border:0;border-radius:0 0 var(--r) var(--r)" id="act"></div></section>`;
  }
  function paintActivity() {
    const { usd, num, ago, short, esc } = U(); const box = document.getElementById('act');
    U().$$('#actTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'trades') box.innerHTML = `<table class="list"><thead><tr><th>Age</th><th class="l">Side</th><th>ETH</th><th>$${esc(x.symbol)}</th><th>Value</th><th>Wallet</th></tr></thead><tbody>${x.trades.slice(0, 15).map(t => `<tr><td class="l"><span class="num muted">${ago(t.ts)}</span></td><td class="l"><span class="ev ${t.side}"><i></i>${t.side === 'buy' ? 'Buy' : 'Sell'}</span></td><td><span class="num">${num(t.eth, 4)}</span></td><td><span class="num">${num(t.coins, 0)}</span></td><td><span class="num">${usd(t.usd)}</span></td><td><span class="addr muted">${short(t.who)}</span></td></tr>`).join('')}</tbody></table>`;
    else if (tab === 'events') box.innerHTML = x.events.length ? `<table class="list"><thead><tr><th>Age</th><th class="l">What</th><th>Spent</th><th>Value</th><th>Coins burned</th><th>At price</th></tr></thead><tbody>${x.events.map(e => `<tr><td class="l"><span class="num muted">${ago(e.ts)}</span></td><td class="l"><span class="ev ${e.kind}"><i></i>${e.kind === 'dip' ? 'Dip buyback' : 'Take profit'}</span></td><td><span class="num">${pairAmt(e.pairAmt)}</span></td><td><span class="num">${usd(e.usd)}</span></td><td><span class="num">${num(e.burned, 0)}</span></td><td><span class="num">${usd(e.px)}</span></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty"><p>No buybacks or burns yet.${x.fund ? ` The next one fires at ${usd(x.fund.trigger)}.` : ''}</p></div>`;
    else { const max = x.top[0] ? x.top[0].bal : 1; box.innerHTML = `<table class="list"><thead><tr><th>#</th><th class="l">Wallet</th><th>Balance</th><th class="l">Share of supply</th></tr></thead><tbody>${x.top.map((h, i) => `<tr><td class="l"><span class="num faint">${i + 1}</span></td><td class="l"><span class="addr">${short(h.addr)}</span>${h.addr === x.creator ? ' <span class="tag">Creator</span>' : ''}</td><td><span class="num">${num(h.bal, 0)}</span></td><td class="l"><span class="hbar"><i style="width:${(h.bal / max * 100).toFixed(1)}%"></i></span><span class="num">${(h.bal / BS.SUPPLY * 100).toFixed(2)}%</span></td></tr>`).join('')}</tbody></table>`; }
  }

  // ------------------------------------------------------------ side: trade, about, fee split
  function tradePanel() {
    return `<section class="panel trade"><div class="tabs2" role="tablist"><button data-side="buy" class="buy">Buy</button><button data-side="sell" class="sell">Sell</button></div><div class="body" id="tradeBody"></div></section>`;
  }
  async function paintTrade() {
    const { esc, usd, num, $$ } = U(); const body = document.getElementById('tradeBody'); if (!body) return;
    $$('.tabs2 button').forEach(b => b.classList.toggle('on', b.dataset.side === side));
    const unit = side === 'buy' ? 'ETH' : '$' + x.symbol;
    const presets = side === 'buy' ? ['0.05', '0.1', '0.25', '0.5'] : ['25%', '50%', '75%', '100%'];
    body.innerHTML = `<div class="field"><label for="amt">${side === 'buy' ? 'You pay' : 'You sell'}</label><div class="input-wrap"><input class="input num with-post" id="amt" inputmode="decimal" value="${side === 'buy' ? '0.1' : '1000000'}"><span class="post">${esc(unit)}</span></div></div>
      <div class="quick">${presets.map(p => `<button type="button" data-q="${p}">${p}${side === 'buy' ? '' : ''}</button>`).join('')}</div>
      <div class="quote"><div class="kv" id="quote"></div></div>
      <button class="btn btn-ink btn-lg btn-block" disabled>${side === 'buy' ? 'Buy' : 'Sell'} $${esc(x.symbol)}</button>
      <p class="faint" style="font-size:12px;line-height:1.5">Trading opens when the contracts are live. Every buy and sell pays 2%, the same through any app or router.</p>`;
    const inp = document.getElementById('amt');
    const q = async () => { const e = await BS.ethUsd(); const v = Number(inp.value) || 0; const fee = 0.02;
      const inUsd = side === 'buy' ? v * e : v * x.px; const impact = Math.min(0.5, inUsd / (x.liq / 2)); const outUsd = inUsd * (1 - fee) * (1 - impact);
      const out = side === 'buy' ? outUsd / x.px : outUsd / e;
      document.getElementById('quote').innerHTML = `<div><span>You get about</span><b>${num(out, side === 'buy' ? 0 : 4)} ${side === 'buy' ? '$' + esc(x.symbol) : 'ETH'}</b></div><div><span>Trade fee (2%)</span><b>${usd(inUsd * fee)}</b></div><div><span>Price impact</span><b>${(impact * 100).toFixed(2)}%</b></div>`; };
    inp.oninput = q; U().$$('[data-q]', body).forEach(b => b.onclick = () => { inp.value = side === 'buy' ? b.dataset.q : String(Math.round(2.1e6 * parseInt(b.dataset.q) / 100)); q(); });
    q();
  }
  function about() {
    const { esc, short, addrLink, ic } = U();
    return `<section class="panel about"><div class="panel-h"><h3>About</h3></div><div class="panel-b" style="display:grid;gap:14px">
      <p>${esc(x.desc)}</p>
      <div class="kv"><div><span>Contract</span><b><span class="addr">${short(x.addr)}</span></b></div><div><span>Backing token</span><b><a class="addr" href="${addrLink(x.pair)}" target="_blank" rel="noopener">${esc(x.pairSym)} ${short(x.pair)}</a></b></div><div><span>Supply</span><b>${U().num(x.circ, 0)}</b></div><div><span>Pool</span><b>Uniswap V4</b></div></div>
    </div></section>`;
  }
  function feeSplit() {
    const s = x.split; const parts = [['creator', 'Creator', s.creator], ['holders', 'Holders', s.holders], ['vault', 'Vault', s.vault], ['bb', 'Buyback', s.buyback], ['platform', 'Platform', s.platform]].filter(p => p[2] > 0);
    return `<section class="panel fs"><div class="panel-h"><h3>Where the 2% goes</h3></div><div class="panel-b">
      <div class="split" role="img" aria-label="${parts.map(p => p[1] + ' ' + U().bps(p[2])).join(', ')}">${parts.map(p => `<i class="s-${p[0]}" style="flex:${p[2]}"></i>`).join('')}</div>
      <div class="split-key">${parts.map(p => `<span><i class="s-${p[0]}"></i>${p[1]}<b>${U().bps(p[2])}</b></span>`).join('')}</div>
      <p class="faint" style="font-size:12px;margin-top:12px">Fixed at launch. ${U().usd(x.fees.creator + x.fees.holders + x.fees.vault + x.fees.buyback + x.fees.platform)} in fees so far.</p></div></section>`;
  }

  function render() {
    const { $, esc } = U(); const root = $('#coinRoot');
    if (!x) { root.innerHTML = `<div class="empty"><h3>Coin not found</h3><p>No Backstop coin at <span class="mono">${esc(addr || 'this address')}</span>.</p><a class="btn btn-ink" href="/">Back to explore</a></div>`; return; }
    document.title = `${x.name} ($${x.symbol}) · Backstop`;
    root.innerHTML = head() + `<div class="coin-grid"><div class="coin-main">${kpis()}${chartPanel()}${strategies()}${activity()}</div><div class="coin-side">${tradePanel()}${feeSplit()}${about()}</div></div>`;
    drawChart(); paintActivity(); paintTrade();
    U().$$('#rangeSeg button').forEach(b => b.onclick = () => { range = b.dataset.r; setRange(); });
    const bk = $('#bkBtn'); if (bk) bk.onclick = () => { showBacking = !showBacking; drawChart(); };
    U().$$('#actTabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; paintActivity(); });
    U().$$('.tabs2 button').forEach(b => b.onclick = () => { side = b.dataset.side; paintTrade(); });
    U().$$('[data-copy]').forEach(b => b.onclick = () => U().copy(b.dataset.copy, 'Contract address'));
    const rd = $('#rdIn'); if (rd) { const go = () => { const n = Number(rd.value) || 0; $('#rdOut').textContent = `${pairAmt(n * x.vault.perCoinPair)} · ${U().usd(n * x.vault.perCoin)}`; }; rd.oninput = go; go(); }
  }
  window.addEventListener('DOMContentLoaded', () => BS.ready.then(() => { x = BS.token(addr); render(); }));
  window.addEventListener('bs:theme', () => { if (x) drawChart(); });
})();
