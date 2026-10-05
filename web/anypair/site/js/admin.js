/* Admin: only works for the admin wallet (the contracts check it); hidden from everyone else. */
(function () {
  let U, $, $$;
  const run = async (btn, target, fn, args, ok) => { const t = btn.textContent; btn.disabled = true; btn.textContent = 'Confirm…'; try { const rc = await AP.admin.call(target, fn, args); U.toast(ok, { tx: rc.hash }); await AP.refresh(); paint(); } catch (e) { U.toast(e.message, { err: true }); btn.disabled = false; btn.textContent = t; } };
  async function paint() {
    const w = window.apWallet;
    if (!U.isAdmin()) { $('#adm').innerHTML = `<div class="panel empty" style="padding:72px 20px">${U.ic('shield')}<h3>Admin only</h3><p>${w && w.connected ? 'This wallet is not the admin.' : 'Connect the admin wallet.'}</p>${w && w.connected ? '' : '<button class="btn btn-primary" id="ac">Connect wallet</button>'}</div>`; const b = $('#ac'); if (b) b.onclick = () => apWallet.open(); return; }
    const s = await AP.admin.state(); const coins = AP.tokens();
    const fees = await Promise.all(coins.map(async x => { const f = await AP.platformFees(x.addr); return { x, f, v: Number(AP.formatUnits(f, x.pairDec)) }; }));
    const owed = fees.filter(r => r.f > 0n); const owedUsd = owed.reduce((a, r) => a + r.v * r.x.pairUsd, 0);
    const { esc, usd, num, short, pairGlyph, ago } = U;
    $('#adm').innerHTML = `<div class="hero" style="padding-bottom:16px"><div><h1>Admin</h1><p>${AP.demo ? 'Preview with the sample coins. Actions go live once the contracts are deployed on Base.' : 'Every action here is an on-chain transaction from the admin wallet.'}</p></div></div>
      <div class="pf-tiles"><div class="panel tile"><span>Launches</span><b style="font-size:20px">${s.paused ? '<span class="down">Paused</span>' : '<span class="up">Open</span>'}</b><button class="btn btn-line btn-sm" style="margin-top:10px" id="pz">${s.paused ? 'Resume launches' : 'Pause launches'}</button></div>
        <div class="panel tile"><span>Platform fees waiting</span><b>${usd(owedUsd)}</b><button class="btn btn-primary btn-sm" style="margin-top:10px" id="pf" ${owed.length ? '' : 'disabled'}>Send to fee wallet (${owed.length})</button></div>
        <div class="panel tile"><span>Fee wallet</span><b class="mono" style="font-size:16px;margin-top:8px">${short(s.feeRecipient)}</b><button class="btn btn-line btn-sm" style="margin-top:10px" id="fr">Change</button></div></div>
      <div class="panel" style="margin-bottom:18px"><div class="panel-h"><h3>Coins</h3></div><div class="panel-b" style="padding-top:8px"><div style="overflow-x:auto"><table class="list"><thead><tr><th>Coin</th><th>Market cap</th><th>Platform fees</th><th>Listing</th><th></th></tr></thead><tbody>
        ${fees.map(({ x, v }) => `<tr><td><div class="coin-cell">${pairGlyph(x, 'sm')}<div><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">$${esc(x.symbol)} / ${esc(x.pairSym)} · ${ago(x.createdAt)} · <span class="mono">${short(x.addr)}</span></div></div></div></td><td class="num">${usd(x.mc)}</td><td class="num">${num(v, 6)} ${esc(x.pairSym)}</td><td>${x.hidden ? '<span class="tag warn">Hidden</span>' : '<span class="tag">Listed</span>'}</td>
          <td><div style="display:flex;gap:6px;justify-content:flex-end"><button class="btn btn-line btn-sm" data-hide="${x.addr}" data-h="${x.hidden ? 0 : 1}">${x.hidden ? 'Show' : 'Hide'}</button><button class="btn btn-line btn-sm" data-meta="${x.addr}">Edit</button><button class="btn btn-line btn-sm" data-col="${x.addr}">Collect</button><a class="btn btn-ghost btn-sm" href="/coin/${x.addr}">Open</a></div></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty"><p>No coins yet.</p></div></td></tr>'}
      </tbody></table></div></div></div>
      <div class="row2"><div class="panel"><div class="panel-h"><h3>Pair tokens</h3></div><div class="panel-b stack-v">
          <div class="field"><label>Token address</label><input class="input mono" id="ta" placeholder="0x…"></div><div id="tinfo" class="muted" style="font-size:13px"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-line btn-sm" id="tb">Block</button><button class="btn btn-line btn-sm" id="tu">Unblock</button><button class="btn btn-line btn-sm" id="tc">Clear price source</button></div>
          <div class="row2"><div class="field"><label>Fixed USD price</label><input class="input num" id="tp" placeholder="1.00"></div><div class="field"><label>Chainlink feed <span class="faint" style="font-weight:400">optional</span></label><input class="input mono" id="tf" placeholder="0x…"></div></div>
          <div style="display:flex;gap:8px"><button class="btn btn-line btn-sm" id="tl">List price</button><button class="btn btn-line btn-sm" id="tx">Unlist</button></div></div></div>
        <div class="panel"><div class="panel-h"><h3>Price safety</h3></div><div class="panel-b stack-v"><p class="muted" style="font-size:13px">A pool must hold at least this much on its ETH or USDC side to price a token. Raise it if thin pools get through.</p>
          <div class="field"><label>Minimum pool depth (USD)</label><input class="input num" id="md" value="${s.minDepth}"></div><button class="btn btn-line btn-sm" id="mds" style="align-self:flex-start">Save</button></div></div></div>`;
    $('#pz').onclick = e => run(e.currentTarget, 'factory', s.paused ? 'resume' : 'pause', [], s.paused ? 'Launches resumed' : 'Launches paused');
    $('#pf').onclick = e => run(e.currentTarget, 'factory', 'pushPlatformFees', [owed.map(r => r.x.addr)], 'Platform fees sent');
    $('#fr').onclick = e => { const a = prompt('New fee wallet address'); if (a && AP.isAddress(a)) run(e.currentTarget, 'factory', 'setFeeRecipient', [a], 'Fee wallet changed'); };
    $$('[data-hide]').forEach(b => b.onclick = () => run(b, 'factory', 'setHidden', [b.dataset.hide, b.dataset.h === '1'], b.dataset.h === '1' ? 'Coin hidden' : 'Coin listed'));
    $$('[data-meta]').forEach(b => b.onclick = () => editMeta(AP.token(b.dataset.meta)));
    $$('[data-col]').forEach(b => b.onclick = () => collect(AP.token(b.dataset.col)));
    const ta = () => $('#ta').value.trim();
    $('#ta').oninput = async () => { const a = ta(); if (!AP.isAddress(a)) { $('#tinfo').textContent = ''; return; } try { const [i, bl, li, src, b2] = await Promise.all([AP.tokenInfo(a), AP.admin.blocked(a), AP.admin.listed(a), AP.admin.source(a), AP.admin.b20(a)]);
      $('#tinfo').innerHTML = `<b>${esc(i.symbol)}</b> · ${bl ? '<span class="down">blocked</span>' : 'not blocked'} · ${li.listed ? `listed at $${(Number(li.usdPrice8) / 1e8).toFixed(4)}` : 'not listed'} · ${Number(src.dex) ? 'priced from ' + esc(AP.DEX_NAMES[Number(src.dex)]) : 'no pool source'}${b2.b20 ? ` · B20, ${b2.ok ? 'open to Anypair' : '<span class="down">' + esc(b2.why.toLowerCase()) + '</span>'}` : ''}`; } catch (e) { $('#tinfo').textContent = AP.errText(e); } };
    $('#tb').onclick = e => AP.isAddress(ta()) && run(e.currentTarget, 'factory', 'setTokenBlocked', [ta(), true], 'Token blocked');
    $('#tu').onclick = e => AP.isAddress(ta()) && run(e.currentTarget, 'factory', 'setTokenBlocked', [ta(), false], 'Token unblocked');
    $('#tc').onclick = e => AP.isAddress(ta()) && run(e.currentTarget, 'oracle', 'clearSource', [ta()], 'Price source cleared');
    $('#tl').onclick = e => { const p = parseFloat($('#tp').value) || 0; const fd = $('#tf').value.trim(); if (!AP.isAddress(ta()) || (!p && !AP.isAddress(fd))) return U.toast('Enter a token and a price or feed', { err: true }); run(e.currentTarget, 'oracle', 'setListed', [ta(), true, BigInt(Math.round(p * 1e8)), AP.isAddress(fd) ? fd : '0x0000000000000000000000000000000000000000'], 'Price listed'); };
    $('#tx').onclick = e => AP.isAddress(ta()) && run(e.currentTarget, 'oracle', 'setListed', [ta(), false, 0n, '0x0000000000000000000000000000000000000000'], 'Token unlisted');
    $('#mds').onclick = e => { const v = parseFloat($('#md').value); if (v >= 0) run(e.currentTarget, 'oracle', 'setMinDepthUsd', [AP.parseUnits(String(v), 18)], 'Minimum depth saved'); };
  }
  function editMeta(x) {
    const ov = U.dialog('Edit ' + x.symbol, `<div class="dialog-b" style="padding:18px" ><div class="stack-v"><div class="field"><label>Description</label><textarea class="textarea" id="md1">${U.esc(x.desc)}</textarea></div><div class="field"><label>Image URL or data URI</label><input class="input" id="md2" value="${U.esc(x.img)}"></div><div class="row3"><div class="field"><label>X</label><input class="input" id="md3" value="${U.esc(x.links.x)}"></div><div class="field"><label>Website</label><input class="input" id="md4" value="${U.esc(x.links.web)}"></div><div class="field"><label>Telegram</label><input class="input" id="md5" value="${U.esc(x.links.tg)}"></div></div><div style="display:flex;gap:8px"><button class="btn btn-primary" id="mdsave">Save on-chain</button><button class="btn btn-ghost" id="mdreset">Restore original</button></div></div></div>`, { wide: true });
    const save = (btn, uri) => run(btn, 'factory', 'setCoinMetadata', [x.addr, uri], 'Metadata saved').then(() => ov.close());
    $('#mdsave', ov).onclick = e => save(e.currentTarget, JSON.stringify({ description: $('#md1', ov).value, image: $('#md2', ov).value, x: $('#md3', ov).value, website: $('#md4', ov).value, telegram: $('#md5', ov).value, routes: x.routes }));
    $('#mdreset', ov).onclick = e => save(e.currentTarget, '');
  }
  function collect(x) {
    const ov = U.dialog('Collect liquidity · ' + x.symbol, `<div class="dialog-b" style="padding:18px"><div class="stack-v"><p class="muted" style="font-size:13px">Pulls part of the launch position (coins and ${U.esc(x.pairSym)}) out of the pool. Not reversible.</p><div class="row2"><div class="field"><label>Percent</label><input class="input num" id="cp" value="100"></div><div class="field"><label>Send to</label><input class="input mono" id="cr" value="${apWallet.address}"></div></div><button class="btn btn-primary" id="cgo">Collect</button></div></div>`);
    $('#cgo', ov).onclick = e => { const p = Math.round((parseFloat($('#cp', ov).value) || 0) * 100); const r = $('#cr', ov).value.trim(); if (!(p > 0 && p <= 10000) || !AP.isAddress(r)) return U.toast('Check the percent and address', { err: true }); run(e.currentTarget, 'factory', 'collect', [x.addr, p, r], 'Liquidity collected').then(() => ov.close()); };
  }
  function start() { U = window.UI; $ = U.$; $$ = U.$$; const go = () => paint().catch(e => console.warn(e)); window.addEventListener('ap:wallet', go); window.addEventListener('ap:ready', go); go(); }
  window.addEventListener('DOMContentLoaded', start);
})();
