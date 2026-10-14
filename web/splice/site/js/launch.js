/* Launch: the gene picker drives a live preview. In preview, "Splice it" explains it opens live. */
(function () {
  const { $, $$, esc, notLive, toast } = window.UI;
  const G = UD.GENES, ORDER = UD.GENE_ORDER;

  // the fee gene is effectively mandatory; others are opt-in. agent is "phase 2", shown but marked.
  const on = new Set(['fee']);

  function genecard(k) {
    const g = G[k]; const locked = k === 'fee';
    return `<button type="button" class="genecard ${on.has(k) ? 'on' : ''} ${locked ? 'locked' : ''}" data-gene="${k}" ${locked ? 'aria-disabled="true"' : ''}>
      <div class="gh"><span class="gene ${g.cls}" style="padding:0;border:none;background:none"><span class="dot"></span></span><b>${esc(g.name)}</b><span class="sw"></span></div>
      <small>${esc(g.short)}</small>
    </button>`;
  }

  function render() {
    $('#genepick').innerHTML = ORDER.map(genecard).join('');
    $$('#genepick .genecard').forEach(el => el.onclick = () => {
      const k = el.dataset.gene; if (k === 'fee') return; // fee stays on
      if (on.has(k)) on.delete(k); else on.add(k);
      render(); preview();
    });
    preview();
  }

  function preview() {
    const nm = ($('#f-name').value || '').trim();
    $('#pv-name').textContent = nm || 'Your coin';
    const keys = ORDER.filter(k => on.has(k));
    $('#pv-genes').innerHTML = keys.map(k => `<span class="gene ${G[k].cls}"><span class="dot"></span>${esc(G[k].name)}</span>`).join('')
      || '<span class="faint" style="font-size:13px">None yet — the constitution still applies.</span>';
    $('#pv-core').innerHTML = UD.CONSTITUTION.map(c => `<span class="gene" title="${esc(c.desc)}">${esc(c.name)}</span>`).join('');
  }

  function init() {
    render();
    $('#f-name').addEventListener('input', preview);
    $('#launch-btn').onclick = () => {
      const nm = ($('#f-name').value || '').trim(), sym = ($('#f-sym').value || '').trim();
      if (!nm || !sym) return toast('Add a name and ticker first.', { err: true });
      notLive();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
