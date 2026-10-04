/* Portfolio: coins held, rewards waiting, coins created and their fees. */
(function () {
  let U, $, $$; let tab = 'holdings'; let data = null;
  function gate() {
    $('#pf').innerHTML = `<div class="panel empty" style="padding:72px 20px">${U.ic('wallet')}<h3>Connect a wallet</h3><p>See your coins, the rewards waiting for you, and the fees from coins you launched.</p><button class="btn btn-primary" id="pfc">Connect wallet</button></div>`;
    $('#pfc').onclick = () => apWallet.open();
  }
  async function load() {
    const w = window.apWallet; if (!w || !w.connected) return gate();
    if (!data) $('#pf').innerHTML = `<div class="pf-head"><div class="pf-id"><span class="ident skel"></span><div><h1 class="skel">0x0000…0000</h1></div></div></div><div class="pf-tiles">${'<div class="panel tile"><span class="skel">Loading</span><b class="skel">$0.00</b></div>'.repeat(3)}</div>`;
    try { data = await AP.portfolio(w.address); paint(); } catch (e) { $('#pf').innerHTML = `<div class="panel empty"><h3>Could not load</h3><p>${U.esc(AP.errText(e))}</p></div>`; }
  }
  function paint() {
    const w = apWallet; const { esc, usd, num, pairGlyph, short, ident, ago, txLink, addrLink, coinHref, ic } = U;
    const value = data.holdings.reduce((s, h) => s + h.bal * h.x.px, 0), pend = data.holdings.reduce((s, h) => s + h.pendUsd, 0), fees = data.created.reduce((s, c) => s + c.feesUsd, 0);
    $('#pf').innerHTML = `<div class="pf-head"><div class="pf-id"><span class="ident" style="background:${ident(w.address)}"></span><div><h1 class="mono" style="font-family:var(--f-mono);font-size:22px">${short(w.address)}</h1><div class="coin-meta" style="margin-top:4px"><button class="copy" data-copy="${w.address}">Copy${ic('copy')}</button><a class="copy" href="${addrLink(w.address)}" target="_blank" rel="noopener">Basescan${ic('ext')}</a></div></div></div></div>
      <div class="pf-tiles"><div class="panel tile"><span>Coins held</span><b>${usd(value)}</b></div><div class="panel tile"><span>Rewards waiting</span><b>${usd(pend)}</b></div><div class="panel tile"><span>Creator fees waiting</span><b>${usd(fees)}</b></div></div>
      <div class="panel"><div class="tabs" style="padding:0 18px" id="pft"><button data-t="holdings" class="${tab === 'holdings' ? 'on' : ''}">Holdings <span class="faint">${data.holdings.length}</span></button><button data-t="created" class="${tab === 'created' ? 'on' : ''}">Created <span class="faint">${data.created.length}</span></button><button data-t="claims" class="${tab === 'claims' ? 'on' : ''}">Claims</button></div><div id="pfb"></div></div>`;
    $$('[data-copy]').forEach(b => b.onclick = () => U.copy(b.dataset.copy));
    $('#pft').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; tab = b.dataset.t; paint(); };
    const box = $('#pfb');
    if (tab === 'holdings') {
      if (!data.holdings.length) { box.innerHTML = `<div class="empty"><h3>No coins yet</h3><p>Coins you buy show up here with the rewards they earn you.</p><a class="btn btn-line" href="/">Explore coins</a></div>`; return; }
      box.innerHTML = `<div style="overflow-x:auto"><table class="list"><thead><tr><th>Coin</th><th>Balance</th><th>Value</th><th>24h</th><th>Rewards waiting</th><th></th></tr></thead><tbody>${data.holdings.map(h => `<tr data-href="${coinHref(h.x.addr)}"><td><div class="coin-cell">${pairGlyph(h.x, 'sm')}<div><b>${esc(h.x.name)}</b><div class="muted" style="font-size:12px">$${esc(h.x.symbol)} / ${esc(h.x.pairSym)}</div></div></div></td><td class="num">${num(h.bal)}</td><td class="num">${usd(h.bal * h.x.px)}</td><td>${U.delta(h.x.c24)}</td><td class="num">${h.pend > 0 ? `${num(h.pend, 6)} ${esc(h.x.pairSym)} <span class="muted">${usd(h.pendUsd)}</span>` : '<span class="faint">—</span>'}</td><td>${h.pend > 0 ? `<button class="btn btn-primary btn-sm" data-claim="${h.x.addr}">Claim</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    } else if (tab === 'created') {
      if (!data.created.length) { box.innerHTML = `<div class="empty"><h3>You haven't launched a coin</h3><p>Launch one and earn 0.7% of every trade, in its pair token.</p><a class="btn btn-primary" href="/launch">Launch a coin</a></div>`; return; }
      box.innerHTML = `<div style="overflow-x:auto"><table class="list"><thead><tr><th>Coin</th><th>Market cap</th><th>All-time volume</th><th>Your share</th><th>Fees waiting</th><th></th></tr></thead><tbody>${data.created.map(c => `<tr data-href="${coinHref(c.x.addr)}"><td><div class="coin-cell">${pairGlyph(c.x, 'sm')}<div><b>${esc(c.x.name)}</b><div class="muted" style="font-size:12px">$${esc(c.x.symbol)} / ${esc(c.x.pairSym)} · ${ago(c.x.createdAt)}</div></div></div></td><td class="num">${usd(c.x.mc)}</td><td class="num">${usd(c.x.volAll)}</td><td class="num">${c.x.holderBps ? '0.7%' : '1.2%'}</td><td class="num">${num(c.fees, 6)} ${esc(c.x.pairSym)} <span class="muted">${usd(c.feesUsd)}</span></td><td>${c.fees > 0 ? `<button class="btn btn-primary btn-sm" data-pay="${c.x.addr}">Claim</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    } else {
      if (!data.claims.length) { box.innerHTML = `<div class="empty"><p>No reward claims yet.</p></div>`; return; }
      const mode = m => ['as pair', 'as ETH', 'as basket'][m] || '';
      box.innerHTML = `<div style="overflow-x:auto"><table class="list"><thead><tr><th>Coin</th><th>Amount</th><th>Taken</th><th>When</th><th></th></tr></thead><tbody>${data.claims.map(c => `<tr onclick="window.open('${txLink(c.tx)}','_blank')"><td><div class="coin-cell">${pairGlyph(c.x, 'sm')}<b>${esc(c.x.symbol)}</b></div></td><td class="num">${num(c.amount, 6)} ${esc(c.x.pairSym)}</td><td>${mode(c.mode)}</td><td class="num muted">${ago(c.ts)} ago</td><td>${ic('ext')}</td></tr>`).join('')}</tbody></table></div>`;
    }
    $$('#pfb tr[data-href]').forEach(tr => tr.onclick = e => { if (e.target.closest('button')) return; location.href = tr.dataset.href; });
    $$('[data-claim]').forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = 'Confirm…'; try { const rc = await AP.claim(b.dataset.claim, 'pair'); U.toast('Rewards claimed', { tx: rc.hash }); data = null; load(); } catch (e) { U.toast(e.message, { err: true }); b.disabled = false; b.textContent = 'Claim'; } });
    $$('[data-pay]').forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = 'Confirm…'; try { const rc = await AP.payCreator(b.dataset.pay); U.toast('Creator fees sent to your wallet', { tx: rc.hash }); data = null; load(); } catch (e) { U.toast(e.message, { err: true }); b.disabled = false; b.textContent = 'Claim'; } });
  }
  function start() { U = window.UI; $ = U.$; $$ = U.$$; gate(); const go = () => { data = null; load(); }; window.addEventListener('ap:wallet', go); window.addEventListener('ap:ready', go); if (AP.tokens().length) go(); }
  window.addEventListener('DOMContentLoaded', start);
})();
