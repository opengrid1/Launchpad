/* The owner's page, #/admin: not linked anywhere. For the admin wallet (CFG.admin) on each chain: who owns every
   contract and the ownership waiting to be accepted, launches (pause, launch fee), the team's fees, the bridge (keeper,
   peer, floor HYPE in transit) and the owner's collect on a coin. Every action is a transaction the admin's wallet
   signs; the contracts check the caller. */
(function () {
  const C = window.CFG, X = window.ethers, APP = window.APP;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const low = (a) => String(a || '').toLowerCase(), short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '-');
  const NAMES = { factory: 'Factory', hook: 'Hook', revenue: 'Revenue', limitOrders: 'Limit orders', burner: 'Burner', bridge: 'Bridge' };
  const hype = (v) => (v == null ? '-' : Number(X.formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' HYPE');
  const link = (net, a) => { const ex = C.chainOf(net).explorer; return a ? `<a class="mono" href="${esc(ex)}/address/${esc(a)}" target="_blank" rel="noopener">${esc(short(a))}</a>` : '-'; };

  async function page(view) {
    const W = APP.W, me = low(W.address), admin = low(C.admin);
    if (!DATA.admin) { view.innerHTML = '<div class="page"><section class="phero"><div><h1 class="disp">Admin</h1><p>No contracts on this site yet.</p></div></section></div>'; return; }
    if (!W.connected || me !== admin) {
      view.innerHTML = `<div class="page"><section class="phero"><div><h1 class="disp">Admin</h1><p>${W.connected ? 'This wallet is not the admin.' : 'Connect the admin wallet.'}</p>${W.connected ? '' : '<div class="acts"><button class="btn pri" id="ad-c">Connect</button></div>'}</div></section></div>`;
      const b = $('#ad-c'); if (b) b.onclick = () => W.connect(); return;
    }
    view.innerHTML = '<div class="page"><section class="phero"><div><h1 class="disp">Admin</h1><p>Every chain\'s contracts, read live.</p></div></section><div id="ad-nets"><div class="loading">Loading…</div></div></div>';
    const nets = C.liveChains().map((c) => c.key);
    const states = await Promise.all(nets.map((n) => DATA.admin.read(n).catch((e) => ({ err: APP.errMsg(e) }))));
    $('#ad-nets').innerHTML = nets.map((net, i) => card(net, states[i])).join('');
    bind(view);
  }

  function card(net, s) {
    const ch = C.chainOf(net), k = ch.contracts;
    if (s.err) return `<section class="card adm"><h3>${esc(ch.name)}</h3><p class="note">Could not read: ${esc(s.err)}</p></section>`;
    const me = low(APP.W.address);
    const rows = DATA.admin.owned.filter((c) => k[c]).map((c) => {
      const o = s[c] || {}, pending = low(o.pendingOwner) === me && low(o.owner) !== me;
      return `<tr><td>${NAMES[c]}</td><td>${link(net, k[c])}</td><td>${link(net, o.owner)}${low(o.owner) === me ? ' <span class="badge">you</span>' : ''}</td><td>${pending ? `<button class="btn sm pri" data-act="accept" data-net="${net}" data-c="${c}">Accept ownership</button>` : low(o.pendingOwner) && low(o.pendingOwner) !== '0x0000000000000000000000000000000000000000' ? 'pending ' + link(net, o.pendingOwner) : ''}</td></tr>`;
    }).join('');
    const f = s.factory || {}, b = s.bridge || {}, peer = b.peers ? '0x' + String(b.peers).slice(26) : '', peerOk = peer && low(peer) === low(s.otherBridge);
    const coins = DATA.admin.coins(net);
    return `<section class="card adm"><h3>${esc(ch.name)}</h3>
      <h4>Ownership</h4><table class="tbl"><thead><tr><th>Contract</th><th>Address</th><th>Owner</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <h4>Launches</h4><dl class="defs">
        <div><dt>Status</dt><dd>${f.launchesPaused ? 'Paused' : 'Open'} <button class="btn sm" data-act="pause" data-net="${net}" data-v="${f.launchesPaused ? 0 : 1}">${f.launchesPaused ? 'Open launches' : 'Pause launches'}</button></dd></div>
        <div><dt>Launch fee</dt><dd>${hype(f.launchFeeEth)} <button class="btn sm" data-act="fee" data-net="${net}">Change</button></dd></div>
        <div><dt>$HYPEX</dt><dd>${link(net, f.hypex && f.hypex !== X.ZeroAddress ? f.hypex : '')}</dd></div>
        <div><dt>Start signer</dt><dd>${link(net, f.startSigner)}</dd></div><div><dt>Leg launcher</dt><dd>${link(net, f.legLauncher)}</dd></div></dl>
      <h4>Team fees</h4><dl class="defs"><div><dt>Team</dt><dd>${link(net, f.team)}</dd></div>
        <div><dt>Protocol fees owed</dt><dd>${hype((s.revenue || {}).teamOwed)} ${(s.revenue || {}).teamOwed > 0n ? `<button class="btn sm pri" data-act="claimrev" data-net="${net}">Pay to team</button>` : ''}</dd></div>
        <div><dt>Held by the hook</dt><dd>${hype((s.hook || {}).teamOwed)} ${(s.hook || {}).teamOwed > 0n ? `<button class="btn sm pri" data-act="claimhook" data-net="${net}">Pay to team</button>` : ''}</dd></div></dl>
      <h4>Bridge</h4><dl class="defs"><div><dt>Keeper</dt><dd>${link(net, b.keeper)}</dd></div>
        <div><dt>Peer</dt><dd>${peer ? link(net, peer) : '-'} ${peerOk ? '' : `<span class="badge">not the other chain's bridge</span> <button class="btn sm pri" data-act="peer" data-net="${net}">Set to ${esc(short(s.otherBridge))}</button>`}</dd></div>
        <div><dt>Floor HYPE in transit</dt><dd>${hype(b.floorOut)}</dd></div></dl>
      <h4>Collect</h4><div class="adcol"><select class="inp" id="ad-coin-${net}">${coins.map((c) => `<option value="${esc(c.addr)}">${esc(c.symbol)} · ${esc(c.name)}</option>`).join('') || '<option value="">No coins yet</option>'}</select>
        <button class="btn sm" data-act="collect" data-net="${net}" ${coins.length ? '' : 'disabled'}>Collect all</button></div>
    </section>`;
  }

  function bind(view) {
    const me = APP.W.address;
    const run = async (btn, label, fn) => { btn.disabled = true; try { const r = await fn(); if (r !== false) { APP.toast(label + ' done', 'ok'); await DATA.admin.refresh(); page(view); } } catch (e) { APP.toast(APP.errMsg(e), 'err', 6000); } finally { btn.disabled = false; } };
    $$('[data-act]', view).forEach((btn) => btn.onclick = () => {
      const net = btn.dataset.net, act = btn.dataset.act;
      if (act === 'accept') return run(btn, 'Ownership accepted', () => DATA.admin.tx(net, btn.dataset.c, 'acceptOwnership', []));
      if (act === 'pause') return run(btn, btn.dataset.v === '1' ? 'Launches paused' : 'Launches open', () => DATA.admin.tx(net, 'factory', 'setLaunchesPaused', [btn.dataset.v === '1']));
      if (act === 'claimhook') return run(btn, 'Paid', () => DATA.admin.tx(net, 'hook', 'claimTeam', [X.ZeroAddress]));
      if (act === 'peer') return run(btn, 'Peer set', async () => { const s = await DATA.admin.read(net); return DATA.admin.tx(net, 'bridge', 'setPeer', [s.otherWh, X.zeroPadValue(s.otherBridge, 32)]); });
      if (act === 'fee') {
        const ov = APP.dialog('Launch fee', `<div class="fld"><label>Fee in HYPE</label><input class="inp" id="ad-fee" inputmode="decimal" placeholder="0.135"></div><div class="acts"><button class="btn pri" id="ad-fee-ok">Set</button></div>`);
        $('#ad-fee-ok', ov).onclick = () => { const v = $('#ad-fee', ov).value.trim(); if (!(Number(v) >= 0)) return; ov.remove(); run(btn, 'Launch fee set', () => DATA.admin.tx(net, 'factory', 'setLaunchFee', [X.parseEther(v)])); };
        return;
      }
      if (act === 'collect') {
        const coin = $('#ad-coin-' + net, view).value; if (!coin) return;
        const c = DATA.admin.coins(net).find((x) => low(x.addr) === low(coin));
        const ov = APP.dialog('Collect all', `<p>Takes everything this coin's pool holds on ${esc(C.chainOf(net).name)} to the admin wallet. Type ${esc(c.symbol)} to confirm.</p><div class="fld"><input class="inp" id="ad-cf" autocomplete="off"></div><div class="acts"><button class="btn pri" id="ad-cf-ok">Collect</button></div>`);
        $('#ad-cf-ok', ov).onclick = () => { if ($('#ad-cf', ov).value.trim().toUpperCase() !== c.symbol.toUpperCase()) return APP.toast('Type the ticker to confirm', 'err'); ov.remove(); run(btn, 'Collected', () => DATA.admin.collectAll(net, coin, me)); };
      }
    });
    // the protocol fees are the team's: anyone may pay them out, always to the team
    $$('[data-act="claimrev"]', view).forEach((btn) => btn.onclick = async () => { const net = btn.dataset.net, s = await DATA.admin.read(net); run(btn, 'Paid', () => DATA.admin.tx(net, 'revenue', 'claim', [s.factory.team, X.ZeroAddress, s.factory.team])); });
  }

  APP.adminPage = page;
})();
