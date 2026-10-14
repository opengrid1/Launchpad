/* Docs: render the gene list and constitution from the shared data layer so they never drift. */
(function () {
  const { $, esc } = window.UI;
  function init() {
    $('#core').innerHTML = UD.CONSTITUTION.map(c => `<div class="gi"><b>${esc(c.name)}</b><p>${esc(c.desc)}</p></div>`).join('');
    $('#genes-list').innerHTML = UD.GENE_ORDER.map(k => { const g = UD.GENES[k]; return `<div class="gi"><b>${window.UI.gc(k)}${esc(g.name)} <span class="tag">${esc(g.short)}</span></b><p>${esc(g.desc)}</p></div>`; }).join('');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
