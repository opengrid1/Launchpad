// Anonymity-set demo. Slider maps to a "1 in N" reading and an honest verdict.
// Kept tiny and dependency-free on purpose.
(function () {
  var range = document.getElementById("aset-range");
  if (!range) return;

  var count = document.getElementById("aset-count");
  var verdict = document.getElementById("aset-verdict");
  var fill = document.getElementById("aset-fill");
  var max = Number(range.max);

  function format(n) {
    return n.toLocaleString("en-US");
  }

  function verdictFor(n) {
    if (n <= 1) return "No cover. With one depositor, the withdrawal can only be you.";
    if (n < 20) return "Thin. A determined observer narrows it to a handful.";
    if (n < 500) return "Getting somewhere, but a fresh address and patience still matter.";
    if (n < 10000) return "Decent cover, as long as your timing does not give you away.";
    return "Strong cover. You are one face in a large, identical crowd.";
  }

  function update() {
    var n = Number(range.value);
    count.textContent = format(n);
    verdict.textContent = verdictFor(n);
    // log scale feels right: 1 is empty, max pins to full
    var pct = Math.log10(n) / Math.log10(max);
    fill.style.width = (pct * 100).toFixed(1) + "%";
  }

  range.addEventListener("input", update);
  update();
})();
