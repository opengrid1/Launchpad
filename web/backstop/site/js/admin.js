/* Admin: platform fees per coin and which coins the site lists. Only shown to the admin wallet. */
(function () {
  const U = () => window.UI;
  const KEY = 'bs:hidden';
  const hidden = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  function paint() {
    const { esc, usd, short, addrLink, pairGlyph, $, $$, isAdmin } = U(); const cfg = BS.cfg;
    if (!isAdmin()) { $('#adm').innerHTML = `<div class="empty"><h3>Admin only</h3><p>Connect the admin wallet <span class="mono">${esc(short(cfg.admin))}</span> to see this page.</p><button class="btn btn-ink" data-wallet-open>Connect</button></div>`; const b = $('[data-wallet-open]'); if (b) b.onclick = () => window.bsWallet && bsWallet.open(); return; }
    const all = BS.tokens(); const h = hidden(); const total = all.reduce((s, x) => s + x.fees.platform, 0);
    $('#adm').innerHTML = `<header class="page-h"><h1>Admin</h1><p>Contracts are not deployed yet. Numbers below come from the sample coins.</p></header>
      <div class="kpis" style="margin-bottom:18px"><div><span>Platform fees</span><b>${usd(total)}</b><small>0.8% of all volume</small></div><div><span>Coins</span><b>${all.length}</b><small>${h.length} hidden</small></div><div><span>Admin</span><b style="font-size:14px"><a class="addr" href="${addrLink(cfg.admin)}" target="_blank" rel="noopener">${short(cfg.admin)}</a></b><small>Ethereum</small></div><div><span>Contracts</span><b style="font-size:14px">Not deployed</b><small>launches closed</small></div></div>
      <section class="panel"><div class="panel-h"><h2>Coins</h2><span class="r faint" style="font-size:12.5px">Preview: listing changes are kept in this browser only</span></div><div class="table-wrap" style="border:0"><table class="list"><thead><tr><th>Coin</th><th>Platform fees</th><th>Volume 24h</th><th>Listed</th></tr></thead><tbody>
      ${all.map(x => `<tr><td><div class="coin-cell">${pairGlyph(x, 'sm')}<div><b>${esc(x.name)}</b><small>$${esc(x.symbol)}</small></div></div></td><td><span class="num">${usd(x.fees.platform)}</span></td><td><span class="num">${usd(x.vol24)}</span></td><td><button class="switch" role="switch" data-h="${x.addr}" aria-checked="${!h.includes(x.addr)}" aria-label="List ${esc(x.symbol)}" style="margin-left:auto;display:block"></button></td></tr>`).join('')}
      </tbody></table></div></section>`;
    $$('[data-h]').forEach(b => b.onclick = () => { const a = b.dataset.h; const cur = hidden(); const next = cur.includes(a) ? cur.filter(v => v !== a) : [...cur, a]; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {} paint(); });
  }
  window.addEventListener('DOMContentLoaded', () => BS.ready.then(paint));
  window.addEventListener('bs:wallet', () => BS.ready.then(paint));
})();
