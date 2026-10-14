/* Portfolio: in preview there is no connected position, so show a clear connect prompt. Once a
   wallet is connected the same view lists holdings, claimable dividends and coins you created. */
(function () {
  const { $, esc, ic } = window.UI;

  function connectView() {
    $('#pf-root').innerHTML = `<div class="empty">
      <h3>Connect a wallet</h3>
      <p>Your spliced coins, holdings and claimable dividends show up here.<br>Trading and launching open when Splice goes live on Base.</p>
      <div style="margin-top:18px"><button class="btn accent lg" data-connect>Connect</button></div>
    </div>`;
    // re-bind the connect button the shell created
    $('#pf-root [data-connect]').onclick = () => window.UI.notLive();
  }

  function init() { connectView(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
