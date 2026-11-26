/* Equo docs: phone menu, search over the pages and this page's headings, heading links, copy buttons,
   and the table of contents following the scroll */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let IC = {};
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;

  /* phone menu */
  const open = () => document.body.classList.add('side-open'), close = () => document.body.classList.remove('side-open');
  const mb = $('#dmenu'); if (mb) mb.onclick = open;
  const cb = $('#dclose'); if (cb) cb.onclick = close;
  document.addEventListener('click', (e) => { if (document.body.classList.contains('side-open') && !e.target.closest('.dside') && !e.target.closest('#dmenu')) close(); });

  /* heading links and copy buttons, once the icons are in */
  fetch('/docs/icons.json').then((r) => r.json()).then((j) => { IC = j;
    $$('.dx-body h2[id], .dx-body h3[id]').forEach((h) => { const a = document.createElement('a'); a.className = 'ha'; a.href = '#' + h.id; a.setAttribute('aria-label', 'Link to this section'); a.innerHTML = ic('link-round'); h.prepend(a); });
    $$('.dx-body pre').forEach((pre) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'cp'; b.setAttribute('aria-label', 'Copy code'); b.innerHTML = ic('copy'); pre.appendChild(b);
      b.onclick = () => { const t = (pre.querySelector('code') || pre).innerText; navigator.clipboard.writeText(t).then(() => { b.classList.add('ok'); b.innerHTML = ic('check-circle'); setTimeout(() => { b.classList.remove('ok'); b.innerHTML = ic('copy'); }, 1400); }).catch(() => {}); }; });
  }).catch(() => {});

  /* the table of contents follows the section in view */
  const toc = $$('.dtoc a'); if (toc.length) {
    const hs = toc.map((a) => document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))).filter(Boolean);
    const mark = () => { let cur = hs[0]; for (const h of hs) { if (h.getBoundingClientRect().top < 120) cur = h; } toc.forEach((a) => a.classList.toggle('on', cur && a.getAttribute('href') === '#' + cur.id)); };
    addEventListener('scroll', mark, { passive: true }); mark();
  }

  /* search: every page by title and summary, and this page's sections */
  let PAGES = null;
  const load = () => PAGES ? Promise.resolve(PAGES) : fetch('/docs/search.json').then((r) => r.json()).then((j) => (PAGES = j)).catch(() => (PAGES = []));
  function openSearch() {
    if ($('.sov')) return;
    const ov = document.createElement('div'); ov.className = 'sov';
    ov.innerHTML = `<div class="sbx" role="dialog" aria-label="Search the docs"><div class="sin">${ic('magnifer')}<input placeholder="Search the docs" autocomplete="off"><kbd>Esc</kbd></div><div class="sres"></div></div>`;
    document.body.appendChild(ov);
    const inp = $('input', ov), res = $('.sres', ov); let sel = 0, items = [];
    const here = $$('.dx-body h2[id], .dx-body h3[id]').map((h) => ({ t: h.textContent.trim(), g: 'On this page', u: '#' + h.id, d: '' }));
    const hl = (s, q) => { if (!q) return esc(s); const i = s.toLowerCase().indexOf(q); return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<em>' + esc(s.slice(i, i + q.length)) + '</em>' + esc(s.slice(i + q.length)); };
    const render = () => { const q = inp.value.trim().toLowerCase();
      items = (PAGES || []).concat(here).filter((p) => !q || (p.t + ' ' + p.d + ' ' + p.g).toLowerCase().includes(q)).slice(0, 14);
      sel = Math.min(sel, Math.max(0, items.length - 1));
      res.innerHTML = items.length ? items.map((p, i) => `<a href="${p.u}" class="${i === sel ? 'on' : ''}"><span class="g">${esc(p.g)}</span><b>${hl(p.t, q)}</b>${p.d ? `<small>${hl(p.d, q)}</small>` : ''}</a>`).join('') : '<div class="none">Nothing matches that.</div>'; };
    load().then(render); render(); inp.focus();
    inp.addEventListener('input', () => { sel = 0; render(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter' && items[sel]) { location.href = items[sel].u; ov.remove(); }
    });
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.sres a')) ov.remove(); });
  }
  const sb = $('#dsearch'); if (sb) sb.onclick = openSearch;
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const o = $('.sov'); if (o) o.remove(); close(); }
    else if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
  });
})();
