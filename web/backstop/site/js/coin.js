/* Coin page: price against its buyback line and vault backing, each strategy the coin runs, trading and activity. */
(function () {
  const U = () => window.UI;
  const addr = (location.pathname.split('/coin/')[1] || new URLSearchParams(location.search).get('a') || '').toLowerCase().replace(/[^0-9a-fx]/g, '');
  let x = null, tab = 'trades', side = 'buy', slip = 5;
  const pairAmt = (v) => U().num(v, v >= 100 ? 0 : 4) + ' ' + x.pairSym;

  // ------------------------------------------------------------ head
  function head() {
    const { esc, usd, delta, pairGlyph, tokImg, short, ago, ic } = U();
    return `<nav class="crumbs"><a href="/">Explore</a><span>/</span><span>${esc(x.name)}</span></nav>
    <div class="coin-head">${pairGlyph(x, 'lg')}
      <div class="coin-title"><h1>${esc(x.name)} <span class="sym">$${esc(x.symbol)}</span></h1>
        <div class="coin-meta"><span class="pairwith">${tokImg({ logo: x.pairLogo })}Backed by <b>${esc(x.pairSym)}</b></span><span class="tag">Tax ${U().bps(x.tax)}</span><span>${ago(x.createdAt)} old</span>
        <button data-copy="${x.addr}" title="Copy contract address">${ic('copy')}<span class="mono">${short(x.addr)}</span></button></div></div>
      <div class="coin-price"><b>${usd(x.px)}</b><span>${delta(x.c24)} · ${usd(x.mc)} mcap</span></div>
    </div>`;
  }
  function kpis() {
    const { usd, num } = U(); const v = x.vault, f = x.fund;
    return `<div class="kpis">
      <div class="v"><span>Vault</span><b>${v ? usd(v.usd) : '—'}</b></div>
      <div class="o"><span>Buyback fund</span><b>${f ? usd(f.usd) : '—'}</b></div>
      <div><span>Burned</span><b>${x.burned ? (x.burned / BS.SUPPLY * 100).toFixed(2) + '%' : '0%'}</b></div>
      <div><span>Holders</span><b>${num(x.holders, 0)}</b></div>
    </div>`;
  }

  // ------------------------------------------------------------ chart: TradingView Advanced Charts (tv.js)
  function chartPanel() {
    return `<section class="panel chart-panel"><div class="tv" id="tv"></div>
      <div class="legend">${x.fund ? '<span><i class="bb"></i>Next buyback</span>' : ''}${x.vault ? '<span><i class="v"></i>Vault backing</span>' : ''}${x.events.length ? '<span><i class="dot"></i>Burn (B on the bars)</span>' : ''}</div></section>`;
  }

  // ------------------------------------------------------------ strategy: one row per strategy the coin runs
  function strategies() {
    const { usd, pct, esc, bps, payoutLabel } = U(); const v = x.vault, f = x.fund; const rows = []; const prots = U().protections(x);
    const row = (k, name, share, main, sub, extra) => `<div class="srow"><span class="strat"><i class="${k} on">${k.toUpperCase()}</i></span><div class="sname"><b>${name}</b>${share ? `<small>${share}</small>` : ''}</div><div class="sval"><b>${main}</b>${sub ? `<small>${sub}</small>` : ''}</div>${extra || ''}</div>`;
    if (v) rows.push(row('v', 'Vault', bps(x.split.vault) + ' of trades', usd(v.usd), `${usd(v.perCoin)} per coin`));
    if (f) rows.push(row('d', 'Dip buyback', bps(x.split.buyback) + ' of trades', usd(f.usd), `fires at ${usd(f.trigger)} <span class="c-bb">${pct(x.toTrigger)}</span>`));
    if (x.tp && v) { const gain = (v.usd / v.cost - 1) * 100; const at = Math.max(0, Math.min(100, gain / x.tp * 100));
      rows.push(row('t', 'Take profit', 'at +' + x.tp + '%', pct(gain), `<span class="progress mini"><i style="width:${at.toFixed(0)}%"></i></span>`)); }
    if (x.redeem && v) rows.push(row('r', 'Redeem', 'burn for backing', usd(v.perCoin), 'per coin', '<button class="btn btn-line" id="rdBtn">Redeem</button>'));
    if (x.autoBurn) rows.push(row('b', 'Auto-burn', bps(x.split.burn) + ' of trades', usd(x.autoBurn.usd), `${U().num(x.autoBurn.coins, 0)} coins burned`));
    if (x.lp) rows.push(row('l', 'Auto-LP', bps(x.split.lp) + ' of trades', usd(x.lp.usd), x.lp.adds ? `locked in ${x.lp.adds} adds · pool ${usd(x.liq)}` : `${usd(x.lp.pending)} of $250 to first add`));
    if (x.split.holders) rows.push(row('h', 'Holder rewards', bps(x.split.holders) + ' of trades', usd(x.fees.holders), 'paid in ' + esc(payoutLabel(x))));
    return `<section class="panel strat-panel"><div class="panel-h"><h2>Strategy</h2><a class="r link" href="/docs#split" style="font-size:13px">How it works</a></div><div class="slist">${rows.join('')}</div>${prots.length ? `<div class="prot"><span class="eyebrow">Protection</span>${prots.map(([l, d]) => `<span class="pchip" title="${esc(d)}">${U().ic('shield')}${esc(l)}</span>`).join('')}</div>` : ''}</section>`;
  }
  function openRedeem() {
    const { usd, esc, dialog, $, toast } = U();
    const ov = dialog('Redeem at backing', `<div class="panel-b redeem-box"><div class="field"><label for="rdIn">Coins to burn</label><div class="input-wrap"><input class="input num with-post" id="rdIn" inputmode="decimal" placeholder="0"><span class="post">$${esc(x.symbol)}</span></div><small class="faint" id="rdBal"></small></div>
      <div class="redeem-out"><span>You receive</span><b id="rdOut">—</b></div><button class="btn btn-ink btn-block" id="rdGo">Redeem</button></div>`);
    const rd = $('#rdIn', ov), go = $('#rdGo', ov); let bal = 0n; const w = window.bsWallet;
    const wei = () => { try { return EH.parseUnits(rd.value || '0', 18); } catch { return 0n; } };
    const quote = async () => { const n = wei(); if (!n) { $('#rdOut', ov).textContent = '—'; return; } const out = await EH.redeemQuote(x.addr, n); const amt = Number(out) / 10 ** x.pairDec; $('#rdOut', ov).textContent = `${pairAmt(amt)} · ${usd(amt * x.pairUsd)}`; };
    rd.oninput = () => { rd.value = rd.value.replace(/[^0-9.]/g, ''); quote(); };
    if (w && w.connected) EH.balances(x.addr, w.address).then(b => { bal = b.coin; $('#rdBal', ov).innerHTML = `Balance ${U().num(Number(bal) / 1e18, 0)} · <button class="link" id="rdMax">Max</button>`; $('#rdMax', ov).onclick = () => { rd.value = EH.formatUnits(bal, 18); quote(); }; });
    go.onclick = async () => { if (!(w && w.connected)) { w.open(); return; } const n = wei(); if (!n) return; go.disabled = true; go.textContent = 'Confirm in your wallet…';
      try { const out = await EH.redeemQuote(x.addr, n); await EH.redeem(x.addr, n, out * 99n / 100n); toast('Redeemed'); ov.close(); refresh(); } catch (e) { toast(e.message, { err: true }); go.disabled = false; go.textContent = 'Redeem'; } };
  }

  // ------------------------------------------------------------ activity
  function activity() {
    const n = { trades: x.trades.length, events: x.events.length, holders: x.top.length };
    return `<section class="panel act"><div class="tabs" id="actTabs" role="tablist"><button data-t="trades">Trades</button><button data-t="events">Buybacks &amp; burns<span class="n">${n.events}</span></button><button data-t="holders">Holders<span class="n">${U().num(x.holders, 0)}</span></button></div><div class="table-wrap" style="border:0;border-radius:0 0 var(--r) var(--r)" id="act"></div></section>`;
  }
  function paintActivity() {
    const { usd, num, ago, short, esc } = U(); const box = document.getElementById('act');
    U().$$('#actTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'trades' && !x.trades.length) box.innerHTML = '<div class="empty"><p>No trades yet.</p></div>';
    else if (tab === 'trades') box.innerHTML = `<table class="list"><thead><tr><th>Age</th><th class="l">Side</th><th>Value</th><th>$${esc(x.symbol)}</th><th>Wallet</th></tr></thead><tbody>${x.trades.slice(0, 15).map(t => `<tr><td class="l"><span class="num muted">${ago(t.ts)}</span></td><td class="l"><span class="ev ${t.side}"><i></i>${t.side === 'buy' ? 'Buy' : 'Sell'}</span></td><td><span class="num">${usd(t.usd)}</span></td><td><span class="num">${num(t.coins, 0)}</span></td><td><span class="addr muted">${t.who ? short(t.who) : '…'}</span></td></tr>`).join('')}</tbody></table>`;
    else if (tab === 'events') box.innerHTML = x.events.length ? `<table class="list"><thead><tr><th>Age</th><th class="l">What</th><th>Spent</th><th>Burned</th></tr></thead><tbody>${x.events.map(e => `<tr><td class="l"><span class="num muted">${ago(e.ts)}</span></td><td class="l"><span class="ev ${e.kind}"><i></i>${e.kind === 'dip' ? 'Dip buyback' : 'Take profit'}</span></td><td><span class="num">${usd(e.usd)}</span></td><td><span class="num">${num(e.burned, 0)}</span></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty"><p>No buybacks or burns yet.${x.fund ? ` The next one fires at ${usd(x.fund.trigger)}.` : ''}</p></div>`;
    else if (!x.top.length) box.innerHTML = '<div class="empty"><p>Holder list loads from the explorer and can take a minute after launch.</p></div>';
    else { const max = x.top[0] ? x.top[0].bal : 1; box.innerHTML = `<table class="list"><thead><tr><th>#</th><th class="l">Wallet</th><th>Balance</th><th class="l">Share of supply</th></tr></thead><tbody>${x.top.map((h, i) => `<tr><td class="l"><span class="num faint">${i + 1}</span></td><td class="l"><span class="addr">${short(h.addr)}</span>${h.addr === x.creator ? ' <span class="tag">Creator</span>' : ''}</td><td><span class="num">${num(h.bal, 0)}</span></td><td class="l"><span class="hbar"><i style="width:${(h.bal / max * 100).toFixed(1)}%"></i></span><span class="num">${(h.bal / BS.SUPPLY * 100).toFixed(2)}%</span></td></tr>`).join('')}</tbody></table>`; }
  }

  // ------------------------------------------------------------ side: trade, fee split, about
  // the order ticket: amount on top, a receipt of what the trade does underneath, including where its fee goes
  function tradePanel() {
    return `<section class="panel ticket"><div class="tk-tabs" role="tablist"><button data-side="buy">Buy</button><button data-side="sell">Sell</button><button type="button" class="tk-slip" id="slipBtn" title="Slippage tolerance"></button></div><div id="tradeBody"></div></section>`;
  }
  // pay with ETH (routed to the backing token) or with the backing token itself
  let pay = null, bal = null, qn = 0;
  const canEth = () => x.pair === BS.weth || x.ethRoute !== false;
  async function loadBal() { const w = window.bsWallet; bal = w && w.connected ? await EH.balances(x.addr, w.address).catch(() => null) : null; }
  function paintTrade() {
    const { esc, usd, num, tokImg, coinImg, $, $$, bps, toast } = U(); const body = document.getElementById('tradeBody'); if (!body) return;
    if (pay == null) pay = canEth() ? 'eth' : 'pair';
    $$('.tk-tabs [data-side]').forEach(b => { b.classList.toggle('on', b.dataset.side === side); b.setAttribute('aria-selected', b.dataset.side === side); });
    $('#slipBtn').innerHTML = `Slippage <b>${slip}%</b>`;
    const buy = side === 'buy'; const eth = pay === 'eth' || x.pair === BS.weth; const w = window.bsWallet; const connected = w && w.connected;
    const payTok = eth ? { logo: (BS.known(BS.weth) || {}).logo, sym: 'ETH', dec: 18 } : { logo: x.pairLogo, sym: x.pairSym, dec: x.pairDec };
    const balIn = !bal ? null : buy ? (eth ? bal.eth : bal.pair) : bal.coin; const decIn = buy ? payTok.dec : 18;
    const unit = buy ? `${tokImg({ logo: payTok.logo }, 'ti')}${esc(payTok.sym)}` : `${coinImg(x, 'ti')}${esc(x.symbol)}`;
    const quick = buy ? (eth ? [['0.01', '0.01'], ['0.05', '0.05'], ['0.1', '0.1'], ['0.5', '0.5']] : [['p25', '25%'], ['p50', '50%'], ['p75', '75%'], ['p100', 'Max']]) : [['p25', '25%'], ['p50', '50%'], ['p75', '75%'], ['p100', 'Max']];
    const route = x.pair === BS.weth ? ['ETH', x.symbol] : eth ? (buy ? ['ETH', x.pairSym, x.symbol] : [x.symbol, x.pairSym, 'ETH']) : (buy ? [x.pairSym, x.symbol] : [x.symbol, x.pairSym]);
    const sp = x.split; const parts = [['vault', 'Vault', sp.vault], ['bb', 'Buyback fund', sp.buyback], ['burn', 'Auto-burn', sp.burn || 0], ['lp', 'Auto-LP', sp.lp || 0], ['holders', 'Holders', sp.holders], ['creator', 'Creator', sp.creator], ['platform', 'Platform', sp.platform]].filter(p => p[2] > 0);
    const payPick = x.pair === BS.weth ? '' : `<div class="seg" id="paySeg" style="margin-bottom:10px">${[['eth', 'ETH'], ['pair', x.pairSym]].map(([k, l]) => `<button type="button" data-pay="${k}" class="${pay === k ? 'on' : ''}" ${k === 'eth' && !canEth() ? 'disabled title="No pool to route ETH into this token"' : ''}>${buy ? 'Pay' : 'Get'} ${esc(l)}</button>`).join('')}</div>`;
    body.innerHTML = `${payPick}
      <div class="tk-amt">
        <div class="tk-lbl"><span>${buy ? 'Spend' : 'Sell'}</span>${balIn != null ? `<span>Balance <b class="mono">${num(Number(balIn) / 10 ** decIn, buy && eth ? 4 : 0)}</b></span>` : ''}</div>
        <div class="tk-in"><input class="num" id="amt" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Amount" value=""><span class="tk-unit">${unit}</span></div>
        <div class="tk-sub"><span id="inUsd" class="mono"></span><span class="tk-quick">${quick.map(([v, l]) => `<button type="button" data-q="${v}">${l}</button>`).join('')}</span></div>
      </div>
      <div class="tk-perf" aria-hidden="true"></div>
      <div class="tk-rcpt">
        <div class="ln big"><span>You get</span><i></i><b id="out">—</b></div>
        <div class="ln"><span>At least, after ${slip}% slippage</span><i></i><b id="minOut">—</b></div>
        <div class="ln"><span>Price impact</span><i></i><b id="imp">—</b></div>
        <div class="ln"><span id="taxLbl">Tax, ${bps(x.tax)}</span><i></i><b id="fee">—</b></div>
        <div class="tk-split split" aria-hidden="true">${parts.map(p => `<i class="s-${p[0]}" style="flex:${p[2]}"></i>`).join('')}</div>
        <div class="tk-fees">${parts.map(p => `<div class="ln sub"><span><i class="s-${p[0]}"></i>${p[1]} <span class="faint">${bps(p[2])}</span></span><i></i><b data-part="${p[2]}"${p[0] === 'platform' ? ' data-plat="1"' : ''}>—</b></div>`).join('')}</div>
      </div>
      <div class="tk-perf" aria-hidden="true"></div>
      <div class="tk-go">
        <div class="tk-warn" id="maxWarn"></div>
        <button class="btn btn-ink btn-lg btn-block" id="tradeGo">${connected ? (buy ? 'Buy' : 'Sell') + ' ' + esc(x.symbol) : 'Connect wallet to ' + (buy ? 'buy' : 'sell')}</button>
        <div class="tk-route">${route.map(r => `<span>${esc(r)}</span>`).join('<i>→</i>')}</div>
      </div>`;
    const inp = $('#amt'); let last = null;
    const amountWei = () => { try { return EH.parseUnits(inp.value || '0', decIn); } catch { return 0n; } };
    const q = async () => {
      const my = ++qn; const v = amountWei(); const go = $('#tradeGo'); last = null;
      const e = await BS.ethUsd(); const unitUsd = buy ? (eth ? e : x.pairUsd) : x.px; const inUsd = Number(v) / 10 ** decIn * unitUsd;
      $('#inUsd').textContent = v ? '≈ ' + usd(inUsd) : '';
      if (!v) { ['#out', '#minOut', '#imp', '#fee'].forEach(s => $(s).textContent = '—'); $$('[data-part]', body).forEach(b => b.textContent = '—'); return; }
      try {
        const r = buy ? await EH.quoteBuy(x.addr, v, eth) : await EH.quoteSell(x.addr, v, eth); if (my !== qn) return; last = r;
        const outDec = buy ? 18 : eth ? 18 : x.pairDec; const out = Number(r.out) / 10 ** outDec; const outUnit = buy ? x.symbol : eth ? 'ETH' : x.pairSym;
        const outUsd = buy ? out * x.px : out * (eth ? e : x.pairUsd); const impact = Math.max(0, 1 - outUsd / Math.max(1e-12, inUsd * (1 - r.taxBps / 1e4)));
        $('#out').textContent = `${num(out, buy ? 0 : 6)} ${outUnit}`; $('#minOut').textContent = `${num(out * (1 - slip / 100), buy ? 0 : 6)} ${outUnit}`;
        const im = $('#imp'); im.textContent = (impact * 100).toFixed(2) + '%'; im.className = impact > 0.05 ? 'down' : '';
        const feeUsd = Number(r.fee) / 10 ** x.pairDec * x.pairUsd; $('#fee').textContent = usd(feeUsd); $('#taxLbl').textContent = `Tax, ${(r.taxBps / 100).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}%${r.taxBps > x.tax ? (x.prot && x.prot.snipeBps && Date.now() / 1000 - x.createdAt < x.prot.snipeSecs ? ' (anti-snipe)' : ' (dynamic)') : ''}`;
        const cents = n => n >= 1 ? usd(n) : '$' + n.toFixed(2); const extra = r.taxBps - x.tax;
        $$('[data-part]', body).forEach(b => { const part = Number(b.dataset.part); const share = b.dataset.plat ? part : part + extra * part / Math.max(1, x.tax - 100); b.textContent = cents(feeUsd * share / Math.max(1, r.taxBps)); });
        const p = x.prot || {}; const coins = buy ? out : Number(v) / 1e18; const over = p.maxTx && coins > BS.SUPPLY * p.maxTx / 1e4;
        $('#maxWarn').textContent = over ? `Over the ${p.maxTx / 100}% max per trade (${num(BS.SUPPLY * p.maxTx / 1e4, 0)} ${x.symbol}). Split it into smaller trades.` : balIn != null && v > balIn ? 'More than your balance.' : '';
        go.disabled = !!over || (balIn != null && v > balIn);
      } catch (err) { if (my !== qn) return; $('#out').textContent = '—'; $('#maxWarn').textContent = EH.errText(err); }
    };
    let tmr; inp.oninput = () => { inp.value = inp.value.replace(/[^0-9.]/g, ''); clearTimeout(tmr); tmr = setTimeout(q, 250); };
    $$('[data-q]', body).forEach(b => b.onclick = () => { const k = b.dataset.q;
      if (k[0] === 'p') { if (balIn == null) { if (w) w.open(); return; } let amt = balIn * BigInt(k.slice(1)) / 100n; if (buy && eth && k === 'p100') amt = amt > 3000000000000000n ? amt - 3000000000000000n : 0n; inp.value = EH.formatUnits(amt, decIn); }
      else inp.value = k; q(); });
    $$('[data-pay]', body).forEach(b => b.onclick = () => { if (b.disabled) return; pay = b.dataset.pay; paintTrade(); });
    $('#tradeGo').onclick = async () => {
      if (!(w && w.connected)) { w.open(); return; } const v = amountWei(); if (!v) { inp.focus(); return; }
      const go = $('#tradeGo'); go.disabled = true; go.textContent = 'Confirm in your wallet…';
      try {
        const r = last || (buy ? await EH.quoteBuy(x.addr, v, eth) : await EH.quoteSell(x.addr, v, eth));
        const min = r.out * BigInt(Math.round((100 - slip) * 100)) / 10000n;
        if (buy) await EH.buy(x.addr, v, min, eth); else await EH.sell(x.addr, v, min, eth);
        toast(`${buy ? 'Bought' : 'Sold'} ${x.symbol}`); inp.value = ''; refresh();
      } catch (err) { toast(err.message, { err: true }); go.disabled = false; go.textContent = (buy ? 'Buy ' : 'Sell ') + x.symbol; }
    };
  }
  function about() {
    const { esc, short, addrLink, ic } = U();
    return `<section class="panel about"><div class="panel-h"><h3>About</h3></div><div class="panel-b" style="display:grid;gap:14px">
      <p>${esc(x.desc)}</p>
      <div class="kv"><div><span>Contract</span><b><span class="addr">${short(x.addr)}</span></b></div><div><span>Backing token</span><b><a class="addr" href="${addrLink(x.pair)}" target="_blank" rel="noopener">${esc(x.pairSym)} ${short(x.pair)}</a></b></div></div>
    </div></section>`;
  }
  function render() {
    const { $, esc } = U(); const root = $('#coinRoot');
    if (!x) { root.innerHTML = `<div class="empty"><h3>Coin not found</h3><p>No Etherhook coin at <span class="mono">${esc(addr || 'this address')}</span>.</p><a class="btn btn-ink" href="/">Back to explore</a></div>`; return; }
    document.title = `${x.name} ($${x.symbol}) · Etherhook`;
    root.innerHTML = head() + `<div class="coin-grid"><div class="coin-main">${kpis()}${chartPanel()}${strategies()}${activity()}</div><div class="coin-side">${tradePanel()}${about()}</div></div>`;
    if (window.bsChart && window.TradingView) bsChart.init($('#tv'), x); paintActivity(); paintTrade();
    U().$$('#actTabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; paintActivity(); });
    U().$$('.tk-tabs [data-side]').forEach(b => b.onclick = () => { side = b.dataset.side; paintTrade(); });
    $('#slipBtn').onclick = e => { const m = U().menu(e.currentTarget, [1, 3, 5, 10].map(n => `<button data-s="${n}">${n}%${n === slip ? ' ✓' : ''}</button>`).join('')); U().$$('[data-s]', m).forEach(b => b.onclick = () => { slip = Number(b.dataset.s); m.remove(); paintTrade(); }); };
    U().$$('[data-copy]').forEach(b => b.onclick = () => U().copy(b.dataset.copy, 'Contract address'));
    const rb = $('#rdBtn'); if (rb) rb.onclick = openRedeem;
  }
  async function refresh() { await BS.reload().catch(() => {}); x = BS.token(addr); if (!x) return; render(); }
  async function prep() { if (!x) return; if (x.pair !== BS.weth) x.ethRoute = (await EH.hopsFor(x.pair).catch(() => null)) !== null; await loadBal(); }
  window.addEventListener('DOMContentLoaded', () => BS.ready.then(async () => { x = BS.token(addr); await prep(); render(); if (x) EH.trades(x.addr).then(() => paintActivity()).catch(() => {}); }));
  window.addEventListener('bs:wallet', async () => { if (x) { await loadBal(); paintTrade(); } });
})();
