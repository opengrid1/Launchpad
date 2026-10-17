window.addEventListener('DOMContentLoaded', () => {
  const U = window.UI; const C = (window.BACKSTOP || {}).contracts || {};
  const rows = [['Factory', C.factory], ['Router', C.router], ['Pool hook', C.hook], ['Vaults', C.vaults]].filter(r => r[1]);
  U.$('#addrs').innerHTML = rows.length ? rows.map(([k, a]) => `<div><span>${k}</span><a class="addr" href="${U.addrLink(a)}" target="_blank" rel="noopener">${U.short(a)}</a></div>`).join('')
    : '<div><span>Contract addresses are posted here when they deploy.</span></div>';
  // highlight the section being read; on narrow screens keep its chip in view
  const nav = U.$('#docsNav'); const links = U.$$('a', nav);
  const secs = links.map(a => document.getElementById(a.hash.slice(1))).filter(Boolean);
  let cur = null;
  const mark = () => {
    let on = secs[0];
    for (const s of secs) if (s.getBoundingClientRect().top <= 140) on = s;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) on = secs[secs.length - 1];
    if (on === cur) return; cur = on;
    links.forEach(a => { const hit = a.hash === '#' + on.id; a.classList.toggle('on', hit); if (hit && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - 16, behavior: 'smooth' }); });
  };
  window.addEventListener('scroll', mark, { passive: true }); window.addEventListener('resize', mark); mark();
});
