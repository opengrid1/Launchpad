/* Trending: what the internet is talking about right now (/api/trends), and for any topic a meme token idea from
   Claude (/api/idea): name, ticker, description and logo. "Launch this" fills the launch form with it. */
window.PAGE = async () => {
  const { $, $$, esc, ic, toast, errMsg } = APP, C = CFG;
  const root = $('#pg-trends');
  let data = null, filter = 'all';
  const ideas = new Map(), loading = new Set();
  const SOURCES = [['all', 'Everything'], ['google', 'Searches'], ['wikipedia', 'Wikipedia'], ['polymarket', 'Markets'], ['hackernews', 'Tech'], ['coingecko', 'Crypto']];

  // the logo as a 512 px PNG data URL (the launch form uploads PNG/WEBP): the idea's SVG, or the standard letter mark
  async function logoPng(idea) {
    const src = idea.logo_svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(idea.logo_svg) : APP.defaultImg(idea.ticker, idea.ticker);
    const img = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('Could not draw the logo')); im.src = src; });
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; cv.getContext('2d').drawImage(img, 0, 0, 512, 512);
    return cv.toDataURL('image/png');
  }
  const logoSrc = (idea) => (idea.logo_svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(idea.logo_svg) : APP.defaultImg(idea.ticker, idea.ticker));

  function ideaHtml(t) {
    const i = ideas.get(t.id);
    if (loading.has(t.id)) return '<div class="idea"><p>Thinking of a token…</p></div>';
    if (!i) return '';
    if (!i.suitable) return `<div class="idea no"><p>${esc(i.reason || 'Not a topic for a meme.')}</p></div>`;
    return `<div class="idea"><div class="top"><span class="lg"><img src="${logoSrc(i)}" alt=""></span><span class="nm"><b>${esc(i.name)}</b><span>$${esc(i.ticker)}</span></span></div><p>${esc(i.description)}</p><div class="row-end"><span class="tag">${i.ai ? 'Idea by Claude' : 'Quick idea'}</span><button class="btn sm pri" data-launch="${t.id}">Launch this</button></div></div>`;
  }
  function card(t) {
    return `<article class="tc" id="t-${t.id}"><div class="src"><span>${esc(t.label)} · #${t.rank}</span><a href="${esc(t.url)}" target="_blank" rel="noopener" aria-label="Open source">${ic('ext')}</a></div><h3>${esc(t.title)}</h3>${t.meta ? `<div class="meta">${esc(t.meta)}</div>` : ''}${t.note && t.source !== 'coingecko' ? `<div class="note">${esc(t.note)}</div>` : ''}<div class="slot">${ideaHtml(t)}</div>${ideas.has(t.id) || loading.has(t.id) ? '' : `<div class="act"><button class="btn sm" data-idea="${t.id}">${ic('zap')}Suggest a token</button></div>`}</article>`;
  }
  function render() {
    if (!data) { root.innerHTML = '<div class="empty">Reading what is trending…</div>'; return; }
    const list = data.topics.filter((t) => filter === 'all' || t.source === filter);
    root.innerHTML = `<section class="th"><h1>Trending now.</h1><p>What people are searching, reading, betting on and talking about right now. Pick a topic and get a meme token idea, then launch it on ${esc(C.chain.name)} in one click.</p></section>
      <div class="tf"><div class="seg lg" role="tablist">${SOURCES.map(([k, l]) => `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="tgrid">${list.map(card).join('') || '<div class="empty">Nothing here right now.</div>'}</div>`;
    $$('[data-f]', root).forEach((b) => b.onclick = () => { filter = b.dataset.f; render(); });
  }
  function rerender(id) { const t = data.topics.find((x) => x.id === id); const el = $('#t-' + id); if (t && el) el.outerHTML = card(t); }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-idea],[data-launch]'); if (!b) return;
    if (b.dataset.idea) {
      const id = b.dataset.idea; loading.add(id); rerender(id);
      try { const r = await fetch('/api/idea?id=' + id); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'No idea'); ideas.set(id, j); }
      catch (err) { toast(errMsg(err), 'err'); }
      loading.delete(id); rerender(id); return;
    }
    const i = ideas.get(b.dataset.launch); if (!i) return;
    b.disabled = true; b.textContent = 'Opening…';
    try { const image = await logoPng(i); sessionStorage.setItem('prefill', JSON.stringify({ name: i.name, symbol: i.ticker, description: i.description, image })); location.href = '/launch'; }
    catch (err) { toast(errMsg(err), 'err'); b.disabled = false; b.textContent = 'Launch this'; }
  });

  render();
  try { const r = await fetch('/api/trends'); data = await r.json(); if (data.error) throw new Error(data.error); }
  catch (e) { root.innerHTML = `<div class="empty">Could not read the trends: ${esc(errMsg(e))}</div>`; return; }
  render();
};
