window.addEventListener('DOMContentLoaded', () => {
  const C = (window.ANYPAIR || {}).contracts || {}; const U = window.UI;
  const rows = [['Factory', C.factory], ['Router', C.router], ['Price oracle', C.oracle], ['Pool hook', C.hook]].filter(r => r[1]);
  if (!rows.length) { U.$('#addrs').innerHTML = '<p class="muted" style="font-size:14px">Contract addresses appear here at launch.</p>'; return; }
  U.$('#addrs').innerHTML = rows.map(([k, a]) => `<div><span>${k}</span><b><a class="addr" href="${U.addrLink(a)}" target="_blank" rel="noopener">${U.short(a)}</a></b></div>`).join('');
});
