/* Inkypump docs: mobile sidebar, search, table-of-contents highlight, copy buttons */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // mobile sidebar drawer: a copy of the sidebar navigation
  const ov = document.createElement('div'); ov.className = 'ip-ov';
  const tabs = $$('.nav-tabs a').map(a => `<a href="${a.getAttribute('href')}"${a.dataset.active ? ' data-active="1"' : ''}>${a.textContent.trim()}</a>`).join('');
  ov.innerHTML = `<div class="ip-drawer"><div class="ip-dh"><img src="../img/wordmark-dark.png" alt="Inkypump"><button type="button" class="ip-x" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div><div class="ip-tabs">${tabs}</div><div class="ip-nav lg:text-sm lg:leading-6"></div></div>`;
  document.body.appendChild(ov);
  const nav = $('#navigation-items'); if (nav) $('.ip-nav', ov).innerHTML = nav.innerHTML;
  const openDrawer = () => { ov.classList.add('open'); document.body.style.overflow = 'hidden'; };
  const closeDrawer = () => { ov.classList.remove('open'); document.body.style.overflow = ''; };
  const mb = $('#mobile-nav-button'); if (mb) mb.addEventListener('click', openDrawer);
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.ip-x') || e.target.closest('a')) closeDrawer(); });

  // search
  const sb = document.createElement('div'); sb.className = 'ip-search';
  sb.innerHTML = '<div class="ip-box"><input type="search" placeholder="Search the docs…" autocomplete="off"><ul></ul></div>';
  document.body.appendChild(sb);
  const input = $('input', sb), list = $('ul', sb); let idx = null, sel = 0;
  const openSearch = async () => { sb.classList.add('open'); input.value = ''; input.focus(); if (!idx) { try { idx = await (await fetch('search.json')).json(); } catch { idx = []; } } render(''); };
  const closeSearch = () => sb.classList.remove('open');
  const render = q => { q = q.trim().toLowerCase(); const hits = (idx || []).filter(p => !q || (p.t + ' ' + p.g + ' ' + p.d).toLowerCase().includes(q)).slice(0, 12); sel = 0;
    list.innerHTML = hits.length ? hits.map((p, i) => `<li><a href="${p.u}"${i === 0 ? ' data-sel="1"' : ''}>${p.t}<small>${p.g} · ${p.d}</small></a></li>`).join('') : '<li class="ip-empty">No results</li>'; };
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', e => { const as = $$('li a', list); if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); as.forEach(a => a.removeAttribute('data-sel')); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + as.length) % as.length; if (as[sel]) as[sel].setAttribute('data-sel', '1'); } if (e.key === 'Enter' && as[sel]) location.href = as[sel].getAttribute('href'); if (e.key === 'Escape') closeSearch(); });
  sb.addEventListener('click', e => { if (e.target === sb) closeSearch(); });
  ['#search-bar-entry', '#search-bar-entry-mobile'].forEach(s => { const b = $(s); if (b) b.addEventListener('click', openSearch); });
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } if (e.key === 'Escape') { closeSearch(); closeDrawer(); } });

  // table of contents: highlight the section in view
  const toc = $$('#table-of-contents-content li');
  const heads = toc.map(li => $('#' + CSS.escape($('a', li).getAttribute('href').slice(1)))).filter(Boolean);
  if (heads.length) {
    const update = () => { let i = 0; for (let k = 0; k < heads.length; k++) if (heads[k].getBoundingClientRect().top < 160) i = k; toc.forEach((li, k) => k === i ? li.setAttribute('data-active', '') : li.removeAttribute('data-active')); };
    update(); document.addEventListener('scroll', update, { passive: true });
  }

  // copy page / copy code
  const flash = (b, t) => { const s = $('.col-start-1:not(.invisible)', b) || b; const o = s.textContent; s.textContent = t; setTimeout(() => { s.textContent = o; }, 1200); };
  $$('[data-copy-page]').forEach(b => b.addEventListener('click', () => { const txt = '# ' + $('#page-title').textContent + '\n\n' + $('#content').innerText; navigator.clipboard?.writeText(txt); flash(b, 'Copied'); }));
  $$('.ip-copy').forEach(b => b.addEventListener('click', () => { navigator.clipboard?.writeText($('code', b.parentElement).textContent); b.style.color = '#ff6fb5'; setTimeout(() => { b.style.color = ''; }, 1200); }));
})();
