/* Hidden admin page (/admin). Not linked anywhere public and not in the docs; the wallet menu
   shows an Admin entry only to the admin address. When live, the page renders only for the
   connected admin wallet; in preview it shows the dashboard with sample numbers so the owner
   can see the layout, with the gate rule stated up front. */
(function () {
  const { $, esc, usd, num, eth, ago, short, avatar, coinHref, addrLink, notLive } = window.UI;
  const CFG = window.SPLICE || {};

  const allowed = () => window.UI.isAdmin() || !!CFG.prelaunch;

  // platform economics from the preview engine: ~1% fee, 40% to the platform
  function economics() {
    const coins = UD.tokens();
    const rows = coins.map(c => {
      const feeEth = c.vol24 / UD.ETH_USD * 0.01;
      const platEth = feeEth * 0.4;
      return { c, feeEth, platEth, claimEth: platEth * 0.27 };
    }).sort((a, b) => b.platEth - a.platEth);
    const t = rows.reduce((a, r) => ({ fee: a.fee + r.feeEth, plat: a.plat + r.platEth, claim: a.claim + r.claimEth }), { fee: 0, plat: 0, claim: 0 });
    return { rows, t };
  }

  function gateView() {
    $('#adm-root').innerHTML = `<div class="empty"><h3>Restricted</h3><p>This page is for the OneHook admin wallet.<br>Connect as <span class="mono">${short(CFG.admin || '')}</span> to continue.</p></div>`;
  }

  function render() {
    const { rows, t } = economics();
    const live = window.UI.isAdmin();
    $('#adm-root').innerHTML = `
      <div class="pf-head">
        <div><h1>Admin</h1><p class="muted">${live ? 'Connected as the admin wallet.' : 'Preview: sample numbers. When live, this page only renders for the admin wallet.'}</p></div>
        <div class="pf-total"><span>Admin wallet</span><b class="mono" style="font-size:14px">${short(CFG.admin || '')}</b><small><a href="${addrLink(CFG.admin || '')}" target="_blank" rel="noopener">Etherscan ↗</a></small></div>
      </div>

      <div class="statstrip" style="margin-bottom:14px">
        <div class="stat-cell"><span>Coins</span><b class="num">${num(rows.length, 0)}</b></div>
        <div class="stat-cell"><span>Fees 24h (all)</span><b class="num">${eth(t.fee)}</b></div>
        <div class="stat-cell"><span>Platform share 24h</span><b class="num">${eth(t.plat)}</b></div>
        <div class="stat-cell"><span>ETH</span><b class="num">${usd(UD.ETH_USD)}</b></div>
      </div>

      <div class="panel"><div class="panel-h"><h2>Platform fees</h2><span class="hint">40% of every swap fee</span></div><div class="panel-b">
        <div class="claimrow">
          <div><span class="lbl" style="margin:0">Claimable now</span><b class="mono" style="font-size:20px">${eth(t.claim)}</b><small class="faint" style="display:block">${usd(t.claim * UD.ETH_USD)} · sent to the admin wallet</small></div>
          <button class="btn accent" id="adm-claim">Claim to admin</button>
        </div>
      </div></div>

      <div class="panel"><div class="panel-h"><h2>Per-coin fees</h2><span class="hint">${live ? 'on-chain' : 'sample'}</span></div><div class="panel-b"><div class="table-wrap">
        <table class="list"><thead><tr><th class="l">Coin</th><th>Vol 24h</th><th>Fees 24h</th><th>Platform 24h</th><th>Claimable</th><th>Age</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td class="l"><a class="pf-coin" href="${coinHref(r.c.addr)}">${avatar(r.c, 'sm')}<span><b>${esc(r.c.name)}</b><small class="muted">${esc(r.c.spec)} · $${esc(r.c.symbol)}</small></span></a></td>
          <td class="num">${usd(r.c.vol24)}</td>
          <td class="num mono">${eth(r.feeEth)}</td>
          <td class="num mono">${eth(r.platEth)}</td>
          <td class="num mono">${eth(r.claimEth)}</td>
          <td class="faint">${ago(r.c.createdTs)}</td></tr>`).join('')}</tbody></table>
      </div></div></div>

      <div class="panel"><div class="panel-h"><h2>Contracts</h2><span class="hint">published at go-live</span></div><div class="panel-b">
        <div class="facts">
          <div><span>Hook</span><b class="mono">${CFG.contracts && CFG.contracts.hook ? short(CFG.contracts.hook) : '— not deployed'}</b></div>
          <div><span>Factory</span><b class="mono">${CFG.contracts && CFG.contracts.factory ? short(CFG.contracts.factory) : '— not deployed'}</b></div>
          <div><span>PoolManager</span><b class="mono">${short(CFG.poolManager || '')}</b></div>
          <div><span>Chain</span><b>Ethereum mainnet</b></div>
        </div>
      </div></div>`;
    $('#adm-claim').onclick = notLive;
  }

  function init() { allowed() ? render() : gateView(); window.addEventListener('sp:wallet', () => allowed() ? render() : gateView()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
