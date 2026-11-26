/* Docs: the window price list. */
(function () {
  window.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('priceBox'); if (!b) return; const { eth, winLabel, premiumFor, WINDOWS } = UI;
    b.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;font-size:13.5px;flex-wrap:wrap"><b>0.05 ETH buys six hours.</b><span class="muted">Linear, from 30 minutes to 7 days.</span></div><div class="pricekeys">${WINDOWS.map(h => `<span class="key sm"><span>${winLabel(h)}</span><kbd>${eth(premiumFor(h))}</kbd></span>`).join('')}</div>`; });
})();
