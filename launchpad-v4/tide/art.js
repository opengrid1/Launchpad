/* Kinex artwork, drawn in code so every page gets a unique piece: tide-line contours (ripples) and ribbons. */
(function () {
  const rnd = (seed) => { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  // concentric tide lines around one or two drop points, like a tide chart. w×h viewBox, stroke color from CSS
  function ripples({ w = 900, h = 520, seed = 7, rings = 26, color = 'currentColor' } = {}) {
    const r = rnd(seed), cx = w * (0.62 + r() * 0.1), cy = h * (0.45 + r() * 0.1), paths = [];
    for (let i = 1; i <= rings; i++) {
      const R = i * (Math.min(w, h) / rings) * 0.95, n = 96, pts = [];
      for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2, wob = 1 + Math.sin(a * 3 + i * 0.7) * 0.012 * i / 3 + Math.sin(a * 7 + i) * 0.006; pts.push([cx + Math.cos(a) * R * 1.35 * wob, cy + Math.sin(a) * R * 0.78 * wob]); }
      const d = pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('') + 'Z';
      paths.push(`<path d="${d}" stroke-opacity="${(0.55 - i / rings * 0.45).toFixed(2)}"/>`);
    }
    return `<svg class="art" viewBox="0 0 ${w} ${h}" fill="none" stroke="${color}" stroke-width="1" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g>${paths.join('')}</g><circle cx="${cx}" cy="${cy}" r="3" fill="${color}"/></svg>`;
  }
  // layered wave lines, for narrow bands
  function waves({ w = 1200, h = 200, lines = 9, seed = 3, color = 'currentColor' } = {}) {
    const r = rnd(seed), out = [];
    for (let i = 0; i < lines; i++) {
      const y0 = h * (0.2 + 0.6 * i / (lines - 1)), amp = 6 + r() * 14, f = 1.5 + r() * 2, ph = r() * 6, pts = [];
      for (let x = 0; x <= w; x += 12) pts.push([x, y0 + Math.sin(x / w * Math.PI * 2 * f + ph) * amp + Math.sin(x / w * Math.PI * 2 * f * 2.3 + ph) * amp * 0.3]);
      out.push(`<path d="${pts.map((p, k) => (k ? 'L' : 'M') + p[0] + ' ' + p[1].toFixed(1)).join('')}" stroke-opacity="${(0.5 - i / lines * 0.35).toFixed(2)}"/>`);
    }
    return `<svg class="art" viewBox="0 0 ${w} ${h}" fill="none" stroke="${color}" stroke-width="1" preserveAspectRatio="none" aria-hidden="true">${out.join('')}</svg>`;
  }
  // a repeating word band (ticker · ticker · …)
  function ribbon(text, times = 24) { const t = String(text || '').toUpperCase().replace(/[<>&"]/g, ''); return `<div class="ribbon" aria-hidden="true"><span>${(t + ' · ').repeat(times)}</span><span>${(t + ' · ').repeat(times)}</span></div>`; }
  window.ART = { ripples, waves, ribbon };
})();
