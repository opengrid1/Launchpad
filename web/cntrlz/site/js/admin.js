/* Admin: the admin wallet's fixed list of powers. Platform (pause launches, push fees, fee recipient,
   start cap), blocked pair tokens, and per coin: collect pool liquidity, hide, edit the description.
   Every action goes through UD.admin; in the preview it only explains what it would do. */
(function () {
  const U = () => window.UI;
  let plat = null, blockedList = [];

  async function load() {
    plat = await UD.admin.state().catch(() => null);
    blockedList = plat ? plat.blocked : [];
  }

  function kpis() {
    const { usd, eth, short, addrLink, $ } = U(); const all = UD.allTokens ? UD.allTokens() : UD.tokens(); const C = UD.cfg.contracts || {};
    const owed = all.reduce((s, x) => s + x.platformOwed, 0), hiddenN = all.filter(x => x.hidden).length, openN = UD.openWindows().length;
    return `<div class="keyrow"><div class="stat-key"><span>Platform fees to push</span><b>${usd(owed)}</b><small>0.3% of every trade, waiting as claims</small></div>
      <div class="stat-key"><span>Coins</span><b>${all.length}</b><small>${hiddenN} hidden · ${openN} open windows</small></div>
      <div class="stat-key"><span>Launches</span><b class="${plat && plat.paused ? 'c-undone' : 'c-kept'}">${plat ? (plat.paused ? 'Paused' : 'Open') : '…'}</b><small>${plat ? `start cap ${usd(plat.startCap)}` : ''}</small></div>
      <div class="stat-key"><span>Factory</span><b style="font-size:15px">${C.factory ? `<a class="link mono" href="${addrLink(C.factory)}" target="_blank" rel="noopener">${short(C.factory)}</a>` : '<span class="faint">not deployed</span>'}</b><small>admin ${short(UD.cfg.admin)}</small></div></div>`;
  }

  function platform() {
    const { esc, usd, short, ic } = U(); const p = plat || {};
    return `<section class="panel"><div class="panel-h"><h2>Platform</h2></div>
      <div class="arow"><div class="t"><b>Launches</b><small>${p.paused ? 'New launches are paused. Trading, cancel and keep still work.' : 'Anyone can launch a coin.'}</small></div><button class="key" data-act="pause">${p.paused ? 'Resume launches' : 'Pause launches'}</button></div>
      <div class="arow"><div class="t"><b>Platform fees</b><small>Pushes every coin's 0.3% share to the fee recipient <span class="mono">${esc(short(p.feeRecipient || UD.cfg.admin))}</span>.</small></div><button class="key" data-act="push">${ic('send')}Push fees</button></div>
      <div class="arow"><div class="t"><b>Fee recipient</b><small>Where the platform's share goes.</small></div><div class="inline"><input class="input mono" id="feeTo" placeholder="0x…" value="${esc(p.feeRecipient || '')}"><button class="key" data-act="feeTo">Set</button></div></div>
      <div class="arow"><div class="t"><b>Start cap</b><small>Market cap new coins start at, $1,000 to $100,000. Coins already launched don't change.</small></div><div class="inline"><div class="input-wrap"><input class="input num" id="startCap" inputmode="numeric" value="${p.startCap || 5000}"><span class="post">USD</span></div><button class="key" data-act="startCap">Set</button></div></div>
    </section>`;
  }

  function blocked() {
    const { esc, short, ic } = U();
    return `<section class="panel"><div class="panel-h"><h2>Blocked pair tokens</h2><span class="r faint" style="font-size:12.5px">Can't be used for new launches; coins already paired with them keep trading</span></div>
      <div class="arow"><div class="inline" style="flex:1"><input class="input mono" id="blockAddr" placeholder="Token address" spellcheck="false"><button class="key" data-act="block">${ic('lock')}Block</button></div></div>
      ${blockedList.length ? blockedList.map(a => `<div class="arow"><div class="t"><b class="mono">${esc(short(a))}</b></div><button class="key sm" data-unblock="${esc(a)}">Unblock</button></div>`).join('') : '<div class="arow"><small class="faint">Nothing blocked.</small></div>'}
    </section>`;
  }

  function coins() {
    const { esc, usd, eth, pairGlyph, ago, $$ } = U(); const all = UD.allTokens ? UD.allTokens() : UD.tokens();
    return `<section class="panel"><div class="panel-h"><h2>Coins</h2><span class="r faint" style="font-size:12.5px">Hiding takes a coin off the site; it keeps trading</span></div>
      <div class="table-wrap cards"><table class="list"><thead><tr><th>Coin</th><th>Platform fees</th><th>Open windows</th><th title="Everything the hook holds in the pool for this coin">Pool liquidity</th><th>Collect</th><th>Edit</th><th>Listed</th></tr></thead><tbody>
      ${all.map(x => `<tr><td><div class="coin-cell" style="display:flex;align-items:center;gap:11px">${pairGlyph(x, 'sm')}<div><b style="font-weight:600">${esc(x.name)}</b><small class="muted" style="display:block;font-size:12.5px">$${esc(x.symbol)} · ${esc(x.pair.symbol)} · ${ago(x.createdAt)} old</small></div></div></td>
        <td data-l="Platform fees"><span class="num">${usd(x.platformOwed)}</span></td>
        <td data-l="Open windows"><span class="num">${x.trades.filter(t => t.state === 'open').length} · ${eth(x.openEth)}</span></td>
        <td data-l="Pool liquidity"><span class="num">${usd(x.poolUsd)}</span><small class="faint" style="display:block">${x.poolPairDesc}</small></td>
        <td data-l="Collect"><button class="key sm" data-collect="${x.addr}">Collect</button></td>
        <td data-l="Edit"><button class="key sm" data-edit="${x.addr}">Description</button></td>
        <td data-l="Listed"><button class="switch" role="switch" data-h="${x.addr}" aria-checked="${!x.hidden}" aria-label="List ${esc(x.symbol)}" style="margin-left:auto;display:block"></button></td></tr>`).join('')}
      </tbody></table></div></section>`;
  }

  // pull part of a coin's pool liquidity out; open windows are never touched
  function openCollect(x) {
    const { esc, usd, eth, num, dialog, $, $$, toast } = U(); let bps = 2500;
    const ov = dialog(`Collect from $${x.symbol}`, `<div class="dialog-b" style="padding:16px;display:grid;gap:14px">
      <div class="field"><span class="lbl">How much of the pool liquidity</span><div class="keys" id="clSeg">${[1000, 2500, 5000, 10000].map(b => `<button class="key sm ${b === bps ? 'down yellow' : ''}" data-b="${b}">${b / 100}%</button>`).join('')}</div></div>
      <div class="field"><label for="clTo">Send to</label><input class="input mono" id="clTo" spellcheck="false" value="${esc((window.bsWallet && bsWallet.address) || UD.cfg.admin)}"></div>
      <div class="facts"><div><span>You receive</span><b id="clOut">—</b></div><div><span>Open windows</span><b>${x.trades.filter(t => t.state === 'open').length} · untouched</b></div></div>
      <small class="muted">Removing liquidity lowers the price and makes trades thinner. Open windows are never touched.</small>
      <button class="key lg wide ink" id="clGo">Collect</button></div>`);
    let seq = 0;
    const paint = async () => { $$('#clSeg .key', ov).forEach(b => b.classList.toggle('down', +b.dataset.b === bps)); $$('#clSeg .key', ov).forEach(b => b.classList.toggle('yellow', +b.dataset.b === bps));
      const f = bps / 10000; const show = (c, p, u) => { $('#clOut', ov).textContent = `${num(c, 0)} $${x.symbol} + ${x.poolPairFmt(p / Math.max(x.poolPair, 1e-18))} · ${usd(u)}`; };
      show(x.poolCoins * f, x.poolPair * f, x.poolUsd * f);
      if (UD.live && UD.admin.collectQuote) { const s = ++seq; const to = $('#clTo', ov).value.trim(); try { const q = await UD.admin.collectQuote(x, bps, /^0x[0-9a-fA-F]{40}$/.test(to) ? to : undefined); if (s === seq && q.exact) show(q.coin, q.pair, q.usd); } catch {} } };
    $$('#clSeg .key', ov).forEach(b => b.onclick = () => { bps = +b.dataset.b; paint(); });
    $('#clGo', ov).onclick = () => { const to = $('#clTo', ov).value.trim(); if (!/^0x[0-9a-fA-F]{40}$/.test(to)) { toast('Enter a wallet address', { err: true }); return; } ov.close(); act('collect', [x.addr, bps, to], `Collected ${bps / 100}% of $${x.symbol} pool liquidity`); };
    paint();
  }

  function openEdit(x) {
    const { esc, dialog, $ } = U();
    const ov = dialog(`Description of $${x.symbol}`, `<div class="dialog-b" style="padding:16px;display:grid;gap:12px"><textarea class="input" id="edDesc" maxlength="280">${esc(x.desc)}</textarea><small class="muted">Shown on the coin page and in link previews. The coin's own on-chain text stays as it is; this overrides it on the site. Empty restores the original.</small><button class="key lg wide ink" id="edGo">Save</button></div>`);
    $('#edGo', ov).onclick = () => { const d = $('#edDesc', ov).value.trim(); ov.close(); act('setCoinMetadata', [x.addr, d], d ? `$${x.symbol} description updated` : `$${x.symbol} description restored`); };
  }

  async function act(fn, args, done) {
    const { toast } = U();
    try { const rc = await UD.admin.call(fn, args); toast(done, { tx: rc && rc.hash }); if (UD.live) await UD.load(); await load(); paint(); } catch (e) { toast(e.message, { err: true }); paint(); }
  }

  function paint() {
    const { $, $$, isAdmin, esc, short } = U();
    if (!isAdmin()) { $('#adm').innerHTML = `<div class="pf-head"><h1>Admin</h1></div><div class="empty"><h3>Admin only</h3><p>Connect the admin wallet <span class="mono">${esc(short(UD.cfg.admin))}</span> to see this page.</p><button class="key ink" data-wallet-open>Connect</button></div>`; const b = $('[data-wallet-open]'); if (b) b.onclick = () => window.bsWallet && bsWallet.open(); return; }
    $('#adm').innerHTML = `<div class="pf-head"><div><h1>Admin</h1><div class="muted" style="margin-top:4px">${UD.live ? 'Live on Ethereum. Every number here is read from the contracts.' : 'Preview. The contracts are not deployed yet; actions explain what they would do.'}</div></div></div>${kpis()}<div class="adm-grid">${platform()}${blocked()}</div>${coins()}`;
    $$('[data-act]').forEach(b => b.onclick = () => {
      const k = b.dataset.act;
      if (k === 'pause') act(plat && plat.paused ? 'resume' : 'pause', [], plat && plat.paused ? 'Launches resumed' : 'Launches paused');
      if (k === 'push') { const all = (UD.allTokens ? UD.allTokens() : UD.tokens()).filter(x => x.platformOwed > 0).map(x => x.addr); if (!all.length) { U().toast('Nothing to push yet', { icon: 'info' }); return; } act('pushPlatformFees', [all], 'Platform fees pushed'); }
      if (k === 'feeTo') act('setFeeRecipient', [$('#feeTo').value.trim()], 'Fee recipient set');
      if (k === 'startCap') act('setStartCap', [Number($('#startCap').value)], 'Start cap set');
      if (k === 'block') act('setTokenBlocked', [$('#blockAddr').value.trim(), true], 'Token blocked');
    });
    $$('[data-unblock]').forEach(b => b.onclick = () => act('setTokenBlocked', [b.dataset.unblock, false], 'Token unblocked'));
    const tok = a => (UD.allTokens ? UD.allTokens() : UD.tokens()).find(x => x.addr === a) || UD.token(a);
    $$('[data-h]').forEach(b => b.onclick = () => { const x = tok(b.dataset.h); act('setHidden', [x.addr, !x.hidden], x.hidden ? `$${x.symbol} is listed again` : `$${x.symbol} is hidden`); });
    $$('[data-collect]').forEach(b => b.onclick = () => openCollect(tok(b.dataset.collect)));
    $$('[data-edit]').forEach(b => b.onclick = () => openEdit(tok(b.dataset.edit)));
  }
  async function start() { paint(); if (U().isAdmin()) { await load(); paint(); } }
  window.addEventListener('DOMContentLoaded', () => UD.ready.then(start));
  window.addEventListener('bs:wallet', () => UD.ready.then(start));
})();
