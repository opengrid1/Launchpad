/* Docs: draws the refund schedule for a six-hour window. */
(function () {
  window.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('curveDoc'); if (b) b.innerHTML = `<small class="muted">A six-hour window. The dot is a buyer forty minutes in, who would get back about ${(UI.refundShare(40 * 60, 6 * 3600) * 100).toFixed(0)}%.</small>${UI.curve(6, 40 / 360, { h: 110 })}`; });
})();
