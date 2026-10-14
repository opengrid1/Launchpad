/* Launch: compose a coin's DNA. Recipes set gene combos; each gene expands into real parameter
   controls; the helix lights up and a live preview card mirrors the explore board. Preview only. */
(function () {
  const { $, $$, esc, usd, num, helix, geneChip, avatar, sparkSvg, notLive, toast } = window.UI;
  const G = UD.GENES, ORDER = UD.GENE_ORDER;

  // per-gene parameter schema (ranges match the data layer's realism)
  const SCHEMA = {
    snipe: [{ k: 'startPct', label: 'Start tax', min: 5, max: 30, step: 1, val: 20, unit: '%' }, { k: 'decay', label: 'Decays over', min: 60, max: 300, step: 10, val: 120, unit: ' blocks' }],
    buyback: [{ k: 'share', label: 'Fee to buyback', min: 10, max: 60, step: 5, val: 30, unit: '%' }, { k: 'thr', label: 'Burn threshold', min: 0.1, max: 1, step: 0.1, val: 0.4, unit: ' ETH' }],
    div: [{ k: 'share', label: 'Fee to holders', min: 10, max: 60, step: 5, val: 30, unit: '%' }],
    maxw: [{ k: 'cap', label: 'Wallet cap', min: 0.5, max: 3, step: 0.1, val: 1.5, unit: '%' }, { k: 'lift', label: 'Lifts after', min: 2, max: 24, step: 1, val: 6, unit: 'h' }],
    fee: [{ k: 'base', label: 'Base fee', min: 0.3, max: 3, step: 0.1, val: 1, unit: '%' }],
  };
  const FEE_MODES = [['flat', 'Flat'], ['dynamic', 'Dynamic'], ['mev', 'MEV-tax']];

  const state = { on: new Set(['fee']), params: {}, feeMode: 'flat' };
  ORDER.forEach(k => { if (SCHEMA[k]) { state.params[k] = {}; SCHEMA[k].forEach(s => state.params[k][s.k] = s.val); } });

  const RECIPES = [
    { name: 'Fair launch', genes: ['fee', 'snipe', 'maxw'], note: 'anti-bot, anti-whale' },
    { name: 'Blue-chip', genes: ['fee', 'buyback', 'div'], note: 'reflexive + rewards' },
    { name: 'Degen', genes: ['fee', 'snipe', 'buyback'], note: 'fast, deflationary' },
    { name: 'Agent-tuned', genes: ['fee', 'buyback', 'agent'], note: 'AI-managed fees' },
  ];

  function recipes() {
    $('#recipes').innerHTML = RECIPES.map((r, i) => `<button class="recipe" data-i="${i}"><b>${esc(r.name)}</b><span>${esc(r.note)}</span></button>`).join('');
    $$('#recipes .recipe').forEach(b => b.onclick = () => { const r = RECIPES[+b.dataset.i]; state.on = new Set(r.genes); if (r.genes.includes('agent')) state.feeMode = 'dynamic'; render(); });
  }

  function controls(k) {
    if (!state.on.has(k)) return '';
    let html = '';
    if (k === 'fee') html += `<div class="pc"><label>Fee mode</label><div class="modeseg">${FEE_MODES.map(([v, l]) => `<button class="${state.feeMode === v ? 'on' : ''}" data-mode="${v}">${l}</button>`).join('')}</div></div>`;
    (SCHEMA[k] || []).forEach(s => { if (k === 'fee' && state.feeMode !== 'flat') return;
      const v = state.params[k][s.k];
      html += `<div class="pc"><label>${esc(s.label)} <b class="mono" data-pv="${k}.${s.k}">${fmt(v, s.unit)}</b></label><input type="range" class="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" data-rng="${k}.${s.k}"></div>`;
    });
    return `<div class="genectl">${html}</div>`;
  }
  const fmt = (v, u) => (u === '%' || u === ' ETH' || u === 'h' ? v : num(v, 0)) + u;

  function genecard(k) {
    const g = G[k], locked = k === 'fee', on = state.on.has(k);
    return `<div class="genecard ${on ? 'on' : ''} ${locked ? 'locked' : ''}" data-gene="${k}">
      <div class="gh" data-toggle="${k}">${window.UI.gc(k)}<b>${esc(g.name)}</b>${g.phase ? '<span class="nb agent">PHASE 2</span>' : ''}<span class="sw"></span></div>
      <small>${esc(g.short)}</small>
      ${controls(k)}
    </div>`;
  }

  let imgData = null; // data-URL of the uploaded coin image
  function previewCard() {
    const nm = ($('#f-name').value || '').trim() || 'Your coin';
    const sym = (($('#f-sym').value || '').trim() || 'COIN').toUpperCase();
    const c = { name: nm, symbol: sym, color: '#2ee5a2', img: imgData };
    const sp = sparkSvg(Array.from({ length: 24 }, (_, i) => 50 + Math.sin(i / 3) * 12 + i), 1, 300, 40);
    $('#preview-card').innerHTML = `<div class="card static">
      <div class="ct">${avatar(c)}<div class="t"><b>${esc(nm)} <span class="nb new">NEW</span></b><small>$${esc(sym)} · ETH · now</small></div></div>
      <div class="cm"><span class="px">$6.0K</span><div class="r">mcap<br><span class="delta up">+0%</span></div></div>
      <div class="sparkbox">${sp}</div>
      <div class="genes">${[...ORDER].filter(k => state.on.has(k)).map(k => geneChip(k)).join('')}</div>
    </div>`;
  }

  function feeLabel() {
    if (state.feeMode === 'dynamic') return 'dynamic';
    if (state.feeMode === 'mev') return 'MEV-tax';
    return (state.params.fee.base).toFixed(1) + '%';
  }

  function render() {
    recipes();
    $('#genepick').innerHTML = ORDER.map(genecard).join('');
    // toggles
    $$('#genepick [data-toggle]').forEach(h => h.onclick = () => { const k = h.dataset.toggle; if (k === 'fee') return;
      state.on.has(k) ? state.on.delete(k) : state.on.add(k); render(); });
    // fee mode
    $$('#genepick [data-mode]').forEach(b => b.onclick = e => { e.stopPropagation(); state.feeMode = b.dataset.mode; render(); });
    // ranges
    $$('#genepick [data-rng]').forEach(r => r.oninput = () => { const [k, key] = r.dataset.rng.split('.'); const v = parseFloat(r.value); state.params[k][key] = v;
      const pv = $(`[data-pv="${k}.${key}"]`); const s = SCHEMA[k].find(x => x.k === key); if (pv) pv.textContent = fmt(v, s.unit); sideFacts(); });
    sideFacts();
  }

  function sideFacts() {
    $('#helixwrap').innerHTML = helix([...state.on], { w: 300, h: 76, turns: 1.8 });
    previewCard();
    $('#pv-fee').textContent = feeLabel();
    $('#pv-genecount').textContent = state.on.size;
    $('#pv-core').innerHTML = UD.CONSTITUTION.map(x => `<span class="gene" title="${esc(x.desc)}">${esc(x.name)}</span>`).join('');
  }

  function bindUpload() {
    const pick = $('#imgpick'), file = $('#f-file'), ph = $('#imgpick-ph'), img = $('#imgpick-img');
    if (!pick) return;
    pick.onclick = () => file.click();
    file.onchange = () => {
      const f = file.files && file.files[0]; if (!f) return;
      if (f.size > 4 * 1024 * 1024) return toast('Image too large. Keep it under 4 MB.', { err: true });
      const rd = new FileReader();
      rd.onload = () => { imgData = rd.result; img.src = imgData; img.hidden = false; ph.hidden = true; pick.classList.add('has'); previewCard(); };
      rd.readAsDataURL(f);
    };
  }

  function init() {
    render();
    bindUpload();
    $('#pv-core').innerHTML = UD.CONSTITUTION.map(x => `<span class="gene" title="${esc(x.desc)}">${esc(x.name)}</span>`).join('');
    $('#f-name').addEventListener('input', previewCard);
    const sym = $('#f-sym'); sym.addEventListener('input', () => { const p = sym.selectionStart; sym.value = sym.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); sym.setSelectionRange(p, p); previewCard(); });
    const desc = $('#f-desc'); desc.addEventListener('input', () => $('#desc-count').textContent = desc.value.length + '/280');
    $('#launch-btn').onclick = () => { const nm = ($('#f-name').value || '').trim(), s = ($('#f-sym').value || '').trim();
      if (!nm || !s) return toast('Add a name and ticker first.', { err: true }); notLive(); };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
