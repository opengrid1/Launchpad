window.addEventListener('DOMContentLoaded', () => {
  const C = (window.ANYPAIR || {}).contracts || {}; const U = window.UI;
  const rows = [['Factory', C.factory], ['Router', C.router], ['Price oracle', C.oracle], ['Pool hook', C.hook]].filter(r => r[1]);
  U.$('#addrs').innerHTML = rows.map(([k, a]) => `<div><span>${k}</span><b><a class="addr" href="${U.addrLink(a)}" target="_blank" rel="noopener">${U.short(a)}</a></b></div>`).join('');
});
