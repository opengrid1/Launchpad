/* Coin page: chart, buy / sell in ETH, holder rewards, creator fees, trades, holders, details. */
(function () {
  const addr = (location.pathname.split('/coin/')[1] || new URLSearchParams(location.search).get('a') || '').toLowerCase().replace(/[^0-9a-fx]/g, '');
  const st = { mode: 'buy', slip: Number(localStorage.getItem('ap:slip')) || 5, res: 300, tab: 'trades', quoteSeq: 0, x: null, chart: null, series: null, vol: null, holders: null };
  let U, $, $$;

  function shell(x) {
    const { esc, pairGlyph, usd, delta, ago, short, ic, tokImg, addrLink } = U;
    const links = [x.links.x && `<a class="btn btn-line btn-sm" href="${esc(x.links.x)}" target="_blank" rel="noopener">${ic('xlogo')}X</a>`, x.links.web && `<a class="btn btn-line btn-sm" href="${esc(x.links.web)}" target="_blank" rel="noopener">${ic('globe')}Website</a>`, x.links.tg && `<a class="btn btn-line btn-sm" href="${esc(x.links.tg)}" target="_blank" rel="noopener">${ic('send')}Telegram</a>`].filter(Boolean).join('');
    document.title = `${x.symbol} / ${x.pairSym} · ${x.name} · Anypair`;
    $('#coinRoot').innerHTML = `
      <nav class="crumbs"><a href="/">Explore</a><span>/</span><a href="/?pair=${x.pair}">${esc(x.pairSym)} pairs</a><span>/</span><span>${esc(x.name)}</span></nav>
      ${x.demo ? `<div class="status wait" style="margin-bottom:14px">${ic('info')}<span><b>Sample coin.</b> It shows how a coin page works and isn't a real token. Trading opens when Anypair launches.</span></div>` : ''}
      ${x.hidden ? `<div class="status bad" style="margin-bottom:14px">${ic('alert')}<span>This coin is hidden from listings. It still trades.</span></div>` : ''}
      <div class="coin-head">${pairGlyph(x, 'lg')}
        <div class="coin-title"><h1>${esc(x.name)} <span class="pairing">${esc(x.symbol)}/<em>${esc(x.pairSym)}</em></span></h1>
          <div class="coin-meta"><button class="copy" data-copy="${x.addr}">${short(x.addr)}${ic('copy')}</button><span>Launched ${ago(x.createdAt)} ago by <a class="addr" href="${addrLink(x.creator)}" target="_blank" rel="noopener">${short(x.creator)}</a></span><span id="srcTag"></span></div>
          ${links ? `<div class="links">${links}</div>` : ''}</div>
        <div class="coin-price"><b id="pxNow">${usd(x.px)}</b><span id="pxChg">${delta(x.c24)} <span class="muted">24h</span></span></div></div>
      <div class="coin-grid">
        <div class="coin-main">
          <div class="statline" id="statline"></div>
          <div class="panel chart-panel"><div class="chart-bar"><div class="seg" id="resSeg">${[[60, '1m'], [300, '5m'], [900, '15m'], [3600, '1h'], [14400, '4h']].map(([s, l]) => `<button data-res="${s}" class="${s === st.res ? 'on' : ''}">${l}</button>`).join('')}</div><span class="legend" id="legend"></span></div><div class="chart" id="chart"></div></div>
          <div class="panel"><div class="tabs" style="padding:0 18px" id="tabs"><button data-tab="trades" class="on">Trades</button><button data-tab="holders">Holders</button><button data-tab="about">About</button></div><div id="tabBody" class="panel-b" style="padding-top:6px"></div></div>
        </div>
        <aside class="coin-side">
          <div class="panel trade" id="trade"></div>
          <div class="panel" id="rewards"></div>
          <div class="panel hidden" id="creator"></div>
          <div class="panel hidden" id="adminCard"></div>
        </aside>
      </div>`;
    $$('[data-copy]').forEach(b => b.onclick = () => U.copy(b.dataset.copy));
    $('#resSeg').onclick = e => { const b = e.target.closest('[data-res]'); if (!b) return; st.res = +b.dataset.res; $$('#resSeg button').forEach(z => z.classList.toggle('on', z === b)); drawChart(); };
    $('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return; st.tab = b.dataset.tab; $$('#tabs button').forEach(z => z.classList.toggle('on', z === b)); paintTab(); };
    AP.hopsFor(x.pair).then(h => { const last = h[h.length - 1]; if (last) $('#srcTag').innerHTML = `<span class="tag pair">${esc(x.pairSym)} via ${esc(AP.DEX_NAMES[last.dex] || 'DEX')}</span>`; }).catch(() => {});
    tradePanel(); rewardsCard(); creatorCard(); adminCard(); initChart();
    AP.holders(x.addr, 50).then(h => { st.holders = h; if ($('#hc')) $('#hc').textContent = U.num(h.length, 0); }).catch(() => {});
  }
  function stats(x) {
    const { usd, num } = U;
    $('#statline').innerHTML = `<div><span>Market cap</span><b>${usd(x.mc)}</b></div><div><span>Liquidity</span><b>${usd(x.liq)}</b></div><div><span>24h volume</span><b>${usd(x.vol24)}</b></div><div><span>Holders</span><b id="hc">${st.holders ? num(st.holders.length, 0) : '…'}</b></div><div><span>${x.holderBps ? 'Paid to holders' : 'Paid to creator'}</span><b>${usd((x.holderBps ? x.totalHolderRewards : x.totalCreatorFees) * x.pairUsd)}</b></div>`;
    $('#pxNow').textContent = usd(x.px); $('#pxChg').innerHTML = `${U.delta(x.c24)} <span class="muted">24h</span>`;
  }

  // ------------------------------------------------------------ chart
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function initChart() {
    const el = $('#chart'); if (!window.LightweightCharts || !el) return;
    st.chart = LightweightCharts.createChart(el, { autoSize: true, layout: { background: { color: 'transparent' }, textColor: css('--muted'), fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: 'transparent' }, horzLines: { color: css('--line') } }, rightPriceScale: { borderVisible: false, scaleMargins: { top: .12, bottom: .24 } }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 }, localization: { priceFormatter: p => U.usd(p, { compact: false }).replace('$', '$') } });
    st.series = st.chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--down'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--down'), priceFormat: { type: 'custom', minMove: 1e-12, formatter: p => U.usd(p, { compact: false }) } });
    st.vol = st.chart.addHistogramSeries({ priceScaleId: 'v', priceFormat: { type: 'volume' }, color: css('--line-2'), lastValueVisible: false, priceLineVisible: false });
    st.chart.priceScale('v').applyOptions({ scaleMargins: { top: .82, bottom: 0 }, visible: false });
    st.chart.subscribeCrosshairMove(p => { const d = p && p.seriesData && p.seriesData.get(st.series); $('#legend').innerHTML = d ? `O ${U.usd(d.open)} H ${U.usd(d.high)} L ${U.usd(d.low)} C ${U.usd(d.close)}` : ''; });
    window.addEventListener('ap:theme', () => { st.chart.applyOptions({ layout: { textColor: css('--muted') }, grid: { horzLines: { color: css('--line') } } }); st.series.applyOptions({ upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down') }); drawChart(); });
    drawChart();
  }
  async function drawChart() {
    if (!st.series) return; const bars = await AP.bars(addr, st.res); const up = css('--up'), down = css('--down');
    st.series.setData(bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
    st.vol.setData(bars.map(b => ({ time: b.time, value: b.value, color: (b.close >= b.open ? up : down) + '55' })));
    if (bars.length > 120) st.chart.timeScale().setVisibleLogicalRange({ from: bars.length - 120, to: bars.length + 2 }); else st.chart.timeScale().fitContent();
  }

  // ------------------------------------------------------------ trade
  function tradePanel() {
    const x = st.x; const { esc, tokImg, coinImg, ic } = U; const buy = st.mode === 'buy';
    const unit = buy ? `<span class="unit">${tokImg({ symbol: 'ETH', logo: '/img/tokens/eth.webp' })}ETH</span>` : `<span class="unit">${x.img ? `<img src="${esc(x.img)}" alt="">` : U.letter(x.symbol)}${esc(x.symbol)}</span>`;
    const quick = buy ? ['0.01', '0.05', '0.1', '0.5'].map(v => `<button data-q="${v}">${v}</button>`).join('') : ['25', '50', '75', '100'].map(v => `<button data-p="${v}">${v === '100' ? 'Max' : v + '%'}</button>`).join('');
    $('#trade').innerHTML = `<div class="seg"><button class="buy ${buy ? 'on' : ''}" data-mode="buy">Buy</button><button class="sell ${!buy ? 'on' : ''}" data-mode="sell">Sell</button></div>
      <div class="amount"><div class="amount-top"><span>${buy ? 'You pay' : 'You sell'}</span><span id="bal">Balance —</span></div><div class="amount-row"><input id="amt" inputmode="decimal" placeholder="0.0" autocomplete="off" aria-label="Amount">${unit}</div></div>
      <div class="quick">${quick}</div>
      <div class="receive"><span>You receive about</span><b id="out">—</b></div>
      <button class="btn btn-lg btn-block ${buy ? 'btn-up' : 'btn-down'}" id="go">${buy ? 'Buy' : 'Sell'} $${esc(x.symbol)}</button>
      <div class="fine"><span>${x.pair === AP.weth ? 'Straight through the ETH pool' : `ETH is swapped to ${esc(x.pairSym)} on the way`}</span><button id="slip">Slippage ${st.slip}%</button></div>`;
    $$('#trade [data-mode]').forEach(b => b.onclick = () => { st.mode = b.dataset.mode; tradePanel(); });
    $('#amt').oninput = () => { $('#amt').value = $('#amt').value.replace(',', '.').replace(/[^0-9.]/g, ''); quote(); };
    $$('#trade [data-q]').forEach(b => b.onclick = () => { $('#amt').value = b.dataset.q; quote(); });
    $$('#trade [data-p]').forEach(b => b.onclick = async () => { const w = apWallet; if (!w.connected) return w.open(); const bal = await AP.balanceOf(x.addr, w.address); const v = bal * BigInt(b.dataset.p) / 100n; $('#amt').value = AP.formatUnits(v, 18); quote(); });
    $('#slip').onclick = () => { const opts = [1, 3, 5, 10, 20]; st.slip = opts[(opts.indexOf(st.slip) + 1) % opts.length] || 5; try { localStorage.setItem('ap:slip', st.slip); } catch {} $('#slip').textContent = `Slippage ${st.slip}%`; };
    $('#go').onclick = submit;
    balance(); quote();
  }
  async function balance() {
    const w = window.apWallet; if (!w || !w.connected) { $('#bal').textContent = ''; paintGo(); return; }
    try { if (st.mode === 'buy') { const b = await AP.ethBalance(w.address); st.bal = b; $('#bal').textContent = 'Balance ' + U.num(Number(AP.formatUnits(b, 18)), 4) + ' ETH'; }
      else { const b = await AP.balanceOf(addr, w.address); st.bal = b; $('#bal').textContent = 'Balance ' + U.num(Number(AP.formatUnits(b, 18))); } } catch {}
    paintGo();
  }
  function amountWei() { const v = ($('#amt') || {}).value; if (!v || !(+v > 0)) return 0n; try { return AP.parseUnits(v, 18); } catch { return 0n; } }
  function paintGo() {
    const b = $('#go'); if (!b) return; const w = window.apWallet; const v = amountWei(); const sym = '$' + st.x.symbol;
    if (st.x.demo) { b.textContent = 'Trading opens at launch'; b.disabled = true; return; }
    if (!w || !w.connected) { b.textContent = 'Connect wallet'; b.disabled = false; return; }
    if (!v) { b.textContent = st.mode === 'buy' ? `Buy ${sym}` : `Sell ${sym}`; b.disabled = true; return; }
    if (st.bal != null && v > st.bal) { b.textContent = st.mode === 'buy' ? 'Not enough ETH' : `Not enough ${sym}`; b.disabled = true; return; }
    b.textContent = st.mode === 'buy' ? `Buy ${sym}` : `Sell ${sym}`; b.disabled = false;
  }
  async function quote() {
    paintGo(); const v = amountWei(); const seq = ++st.quoteSeq; const out = $('#out');
    if (!v) { out.textContent = '—'; st.minOut = 0n; return; }
    out.textContent = '…';
    try { const w = window.apWallet; const from = w && w.connected ? w.address : null;
      const q = st.mode === 'buy' ? await AP.quoteBuy(addr, v, from) : await AP.quoteSell(addr, v, from); if (seq !== st.quoteSeq) return;
      st.minOut = q * BigInt(100 - st.slip) / 100n; const n = Number(AP.formatUnits(q, 18));
      out.textContent = st.mode === 'buy' ? `${U.num(n)} ${st.x.symbol}` : `${U.num(n, 5)} ETH`;
    } catch (e) { if (seq === st.quoteSeq) out.textContent = '—'; }
  }
  async function submit() {
    if (st.x.demo) return; const w = apWallet; if (!w.connected) return w.open(); const v = amountWei(); if (!v) return; const b = $('#go'); const label = b.textContent;
    b.disabled = true; b.textContent = st.mode === 'buy' ? 'Confirm in your wallet…' : 'Confirm in your wallet…';
    try { await quote(); const rc = st.mode === 'buy' ? await AP.buy(addr, v, st.minOut || 0n) : await AP.sell(addr, v, st.minOut || 0n);
      U.toast(st.mode === 'buy' ? `Bought $${st.x.symbol}` : `Sold $${st.x.symbol}`, { tx: rc.hash }); $('#amt').value = ''; await refresh(); }
    catch (e) { U.toast(e.message || String(e), { err: true }); b.textContent = label; }
    finally { b.disabled = false; balance(); }
  }

  // ------------------------------------------------------------ rewards + creator
  async function rewardsCard() {
    const x = st.x; const { esc, tokImg, usd, num, ic } = U; const el = $('#rewards');
    const split = x.holderBps ? [['c', 0.7, 'Creator'], ['h', 0.5, 'Holders'], ['p', 0.8, 'Platform']] : [['c', 1.2, 'Creator'], ['p', 0.8, 'Platform']];
    const bar = `<div class="split">${split.map(([k, v]) => `<i class="${k}" style="flex:${v}"></i>`).join('')}</div><div class="legend-row">${split.map(([k, v, l]) => `<span><i class="${k === 'c' ? 'split-c' : k}" style="background:var(${k === 'c' ? '--accent' : k === 'h' ? '--pair' : '--line-2'})"></i>${l} ${v}%</span>`).join('')}</div>`;
    if (!x.holderBps) { el.innerHTML = `<div class="panel-h"><h3>Trading fee 2%</h3></div><div class="panel-b">${bar}<p class="muted" style="margin-top:12px;font-size:13px">The creator turned holder rewards off, so their share is 1.2% of every trade.</p></div>`; return; }
    const assets = x.basket.length ? x.basket : [{ symbol: x.pairSym, logo: x.pairLogo }];
    el.innerHTML = `<div class="panel-h">${ic('gift')}<h3>Holders earn 0.5% of every trade</h3></div><div class="panel-b">${bar}
      <div class="earn-assets">${assets.map(a => `<span class="chip">${tokImg(a)}${esc(a.symbol)}</span>`).join('')}</div>
      <p class="muted" style="margin-top:10px;font-size:12.5px">Paid in ${esc(x.pairSym)} as it comes in. ${x.basket.length ? `Claim it as is, as ETH, or split equally into ${esc(assets.map(a => a.symbol).join(', '))}.` : 'Claim it as is or as ETH.'}</p>
      <div id="myRewards"></div></div>`;
    const w = window.apWallet; const box = $('#myRewards');
    if (x.demo) { box.innerHTML = `<div class="pending"><span>Your rewards</span><b>0 ${esc(x.pairSym)}</b></div><div class="claim-row"><button class="btn btn-primary btn-sm" disabled>Claim ${esc(x.pairSym)}</button><button class="btn btn-line btn-sm" disabled>As ETH</button>${x.basket.length ? '<button class="btn btn-line btn-sm" disabled>As basket</button>' : ''}</div>`; return; }
    if (!w || !w.connected) { box.innerHTML = `<div class="pending"><span>Your rewards</span><button class="btn btn-line btn-sm" data-connect>Connect to see</button></div>`; box.querySelector('[data-connect]').onclick = () => apWallet.open(); return; }
    try { const p = await AP.pending(x.addr, w.address); const v = Number(AP.formatUnits(p, x.pairDec));
      box.innerHTML = `<div class="pending"><span>Your rewards</span><div style="text-align:right"><b>${num(v, 6)} ${esc(x.pairSym)}</b><div class="muted" style="font-size:12px">${usd(v * x.pairUsd)}</div></div></div>
        <div class="claim-row"><button class="btn btn-primary btn-sm" data-claim="pair" ${p > 0n ? '' : 'disabled'}>Claim ${esc(x.pairSym)}</button>${x.pair !== AP.weth ? `<button class="btn btn-line btn-sm" data-claim="eth" ${p > 0n ? '' : 'disabled'}>As ETH</button>` : ''}${x.basket.length ? `<button class="btn btn-line btn-sm" data-claim="basket" ${p > 0n ? '' : 'disabled'}>As basket</button>` : ''}</div>`;
      $$('[data-claim]', box).forEach(b => b.onclick = async () => { const t = b.textContent; b.disabled = true; b.textContent = 'Confirm…'; try { const rc = await AP.claim(x.addr, b.dataset.claim); U.toast('Rewards claimed', { tx: rc.hash }); rewardsCard(); } catch (e) { U.toast(e.message, { err: true }); b.disabled = false; b.textContent = t; } });
    } catch (e) { box.innerHTML = ''; }
  }
  async function creatorCard() {
    const x = st.x; const w = window.apWallet; const el = $('#creator'); if (x.demo || !w || !w.connected || w.address !== x.creator) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden'); const f = await AP.creatorFees(x.addr); const v = Number(AP.formatUnits(f, x.pairDec));
    el.innerHTML = `<div class="panel-h">${U.ic('coins')}<h3>Your creator fees</h3></div><div class="panel-b"><div class="pending" style="margin-top:0"><span>Ready to claim</span><div style="text-align:right"><b>${U.num(v, 6)} ${U.esc(x.pairSym)}</b><div class="muted" style="font-size:12px">${U.usd(v * x.pairUsd)}</div></div></div><button class="btn btn-primary btn-block" style="margin-top:12px" id="payc" ${f > 0n ? '' : 'disabled'}>Claim creator fees</button></div>`;
    $('#payc').onclick = async () => { const b = $('#payc'); b.disabled = true; b.textContent = 'Confirm…'; try { const rc = await AP.payCreator(x.addr); U.toast('Creator fees sent to your wallet', { tx: rc.hash }); creatorCard(); } catch (e) { U.toast(e.message, { err: true }); b.disabled = false; b.textContent = 'Claim creator fees'; } };
  }

  function adminCard() {
    const el = $('#adminCard'); if (!el) return; if (!U.isAdmin()) { el.classList.add('hidden'); return; } const x = st.x; el.classList.remove('hidden');
    el.innerHTML = `<div class="panel-h">${U.ic('shield')}<h3>Admin</h3></div><div class="panel-b" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-line btn-sm" id="ah">${x.hidden ? 'Show in listings' : 'Hide from listings'}</button><a class="btn btn-line btn-sm" href="/admin">Edit, collect, fees</a></div>`;
    $('#ah').onclick = async e => { const b = e.currentTarget; b.disabled = true; try { const rc = await AP.admin.call('factory', 'setHidden', [x.addr, !x.hidden]); U.toast(x.hidden ? 'Coin listed' : 'Coin hidden', { tx: rc.hash }); await refresh(); location.reload(); } catch (err) { U.toast(err.message, { err: true }); b.disabled = false; } };
  }

  // ------------------------------------------------------------ tabs
  async function paintTab() {
    const box = $('#tabBody'); const x = st.x; const { esc, usd, num, ago, short, txLink, addrLink, tokImg } = U;
    if (st.tab === 'about') {
      const hops = await AP.hopsFor(x.pair).catch(() => []); const last = hops[hops.length - 1];
      box.innerHTML = `<div class="about" style="padding-top:12px">${x.desc ? `<p>${esc(x.desc)}</p>` : '<p class="muted">No description.</p>'}</div>
        <div class="kv" style="margin-top:18px"><div><span>Coin</span><b class="addr"><a href="${addrLink(x.addr)}" target="_blank" rel="noopener">${short(x.addr)}</a></b></div><div><span>Pair</span><b>${esc(x.pairSym)} · <a class="addr" href="${addrLink(x.pair)}" target="_blank" rel="noopener">${short(x.pair)}</a></b></div>
        <div><span>${esc(x.pairSym)} priced from</span><b>${last ? esc(AP.DEX_NAMES[last.dex]) : x.pair === AP.weth ? 'Chainlink ETH/USD' : '—'}</b></div><div><span>Supply</span><b class="num">1,000,000,000</b></div><div><span>Start market cap</span><b class="num">$3,000</b></div>
        <div><span>Trading fee</span><b>2% (${x.holderBps ? '0.7% creator · 0.5% holders' : '1.2% creator'} · 0.8% platform)</b></div><div><span>Holder rewards</span><b>${x.holderBps ? esc((x.basket.length ? x.basket.map(b => b.symbol) : [x.pairSym]).join(' + ')) : 'Off'}</b></div>
        <div><span>Pool</span><b>Uniswap V4 · <span class="mono">${short(x.poolId)}</span></b></div><div><span>Created</span><b>${new Date(x.createdAt * 1000).toLocaleString()}</b></div></div>`;
      return;
    }
    if (st.tab === 'holders') {
      box.innerHTML = '<div class="empty" style="padding:30px"><p>Loading holders…</p></div>';
      const hs = st.holders || (st.holders = await AP.holders(x.addr, 50)); if ($('#hc')) $('#hc').textContent = num(hs.length, 0);
      if (!hs.length) { box.innerHTML = '<div class="empty"><p>No holders yet.</p></div>'; return; }
      const max = hs[0].bal;
      box.innerHTML = `<div style="overflow-x:auto"><table class="list" style="margin-top:4px"><thead><tr><th>#</th><th style="text-align:left">Wallet</th><th>Share</th><th>Coins</th></tr></thead><tbody>${hs.map((h, i) => `<tr onclick="window.open('${addrLink(h.wallet)}','_blank')"><td class="num muted" style="text-align:left">${i + 1}</td><td style="text-align:left"><span class="addr">${short(h.wallet)}</span> ${h.wallet === x.creator ? '<span class="tag acc">creator</span>' : ''}${window.apWallet && apWallet.address === h.wallet ? ' <span class="tag pair">you</span>' : ''}</td><td class="num bar-cell"><i style="width:${(h.bal / max * 100).toFixed(1)}%"></i><span>${(h.bal / 1e9 * 100).toFixed(2)}%</span></td><td class="num">${num(h.bal)}</td></tr>`).join('')}</tbody></table></div>`;
      return;
    }
    box.innerHTML = '<div class="empty" style="padding:30px"><p>Loading trades…</p></div>';
    const t = await AP.trades(x.addr, 60);
    if (!t.length) { box.innerHTML = '<div class="empty"><p>No trades yet. The first buyer gets the $3,000 start.</p></div>'; return; }
    box.innerHTML = `<div style="overflow-x:auto"><table class="list" style="margin-top:4px"><thead><tr><th style="text-align:left">Age</th><th style="text-align:left">Side</th><th>Value</th><th>${esc(x.symbol)}</th><th>${esc(x.pairSym)}</th><th>Wallet</th><th></th></tr></thead><tbody>${t.map(r => `<tr onclick="window.open('${txLink(r.tx)}','_blank')"><td class="num muted" style="text-align:left">${ago(r.ts)}</td><td style="text-align:left" class="${r.buy ? 'up' : 'down'}"><b>${r.buy ? 'Buy' : 'Sell'}</b></td><td class="num">${usd(r.usd)}</td><td class="num">${num(r.coinAmt)}</td><td class="num">${num(r.pairAmt, 6)}</td><td class="addr muted">${r.wallet ? short(r.wallet) : '—'}</td><td>${U.ic('ext')}</td></tr>`).join('')}</tbody></table></div>`;
    U.$$('#tabBody td svg').forEach(s => { s.style.width = '14px'; s.style.height = '14px'; s.style.color = 'var(--faint)'; });
  }

  async function refresh() { await AP.refresh(); st.x = AP.token(addr) || st.x; st.holders = null; stats(st.x); drawChart(); rewardsCard(); creatorCard(); paintTab(); balance(); AP.holders(addr, 50).then(h => { st.holders = h; if ($('#hc')) $('#hc').textContent = U.num(h.length, 0); }).catch(() => {}); }
  function start() {
    U = window.UI; $ = U.$; $$ = U.$$;
    const go = () => { const x = AP.token(addr); if (!x) { if (!AP.stale) $('#coinRoot').innerHTML = `<div class="panel empty"><h3>Coin not found</h3><p>No Anypair coin at ${U.esc(U.short(addr) || 'this address')}.</p><a class="btn btn-primary" href="/">Back to explore</a></div>`; return; }
      const first = !st.x; st.x = x; if (first) { shell(x); paintTab(); } stats(x); };
    if (AP.tokens().length) go(); window.addEventListener('ap:ready', go); window.addEventListener('ap:update', () => { go(); if (st.x) { drawChart(); } });
    window.addEventListener('ap:wallet', () => { if (!st.x) return; balance(); quote(); rewardsCard(); creatorCard(); adminCard(); });
    if (!AP.prelaunch) setInterval(() => AP.refresh().catch(() => {}), 20000);
  }
  window.addEventListener('DOMContentLoaded', start);
})();
