/* Hypex artwork, drawn in code: isometric terraces that climb (the floor that only goes up), stepped contour lines,
   and ribbons of ticker names. Every call takes a seed, so each page gets its own piece. */
(function () {
  const rnd = (seed) => { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const f = (n) => n.toFixed(1);

  // isometric blocks rising left to right: a terrace landscape whose top faces glow brighter the higher they stand
  function terraces({ w = 900, h = 560, seed = 7, cols = 7, rows = 3, tile = 0, rise = 1.05 } = {}) {
    const r = rnd(seed), tw = tile || Math.min(w / (cols + rows) * 1.7, 150), th = tw / 2;
    // one stair: every column a step higher than the last (more than the iso slope, so it reads as climbing), the rows
    // behind it a little lower, a touch of noise so no two pieces match
    const H = [];
    for (let i = 0; i < cols; i++) { H[i] = []; for (let j = 0; j < rows; j++) H[i][j] = th * (0.5 + i * rise) + th * 0.18 * (rows - 1 - j) * 0 + r() * th * 0.15; }
    const max = Math.max(...H.flat());
    // place the stair: its highest top face sits 14% from the top, the whole piece centred across the width
    let minY = Infinity, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const cx = (i - j) * tw / 2, cy = (i + j) * th / 2; minY = Math.min(minY, cy - H[i][j]); minX = Math.min(minX, cx - tw / 2); maxX = Math.max(maxX, cx + tw / 2); }
    const ox = (w - (maxX - minX)) / 2 - minX, oy = h * 0.14 - minY;
    const cells = [];
    for (let s = 0; s < cols + rows - 1; s++) for (let i = 0; i < cols; i++) { const j = s - i; if (j >= 0 && j < rows) cells.push([i, j]); }
    const out = [], P = (pts) => pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' ');
    for (const [i, j] of cells) {
      const z = H[i][j], cx = ox + (i - j) * tw / 2, cy = oy + (i + j) * th / 2, t = i / (cols - 1);
      const top = [[cx, cy - z], [cx + tw / 2, cy + th / 2 - z], [cx, cy + th - z], [cx - tw / 2, cy + th / 2 - z]];
      const left = [[cx - tw / 2, cy + th / 2 - z], [cx, cy + th - z], [cx, cy + th + 400], [cx - tw / 2, cy + th / 2 + 400]];
      const right = [[cx + tw / 2, cy + th / 2 - z], [cx, cy + th - z], [cx, cy + th + 400], [cx + tw / 2, cy + th / 2 + 400]];
      out.push(`<polygon points="${P(left)}" fill="url(#hxL)" stroke="rgba(255,255,255,.05)"/>`);
      out.push(`<polygon points="${P(right)}" fill="url(#hxR)" stroke="rgba(255,255,255,.05)"/>`);
      out.push(`<polygon points="${P(top)}" fill="rgba(212,255,58,${(0.05 + t * 0.6).toFixed(2)})" stroke="rgba(212,255,58,${(0.25 + t * 0.6).toFixed(2)})" stroke-width="1"/>`);
      if (i === cols - 1) out.push(`<polygon points="${P(top)}" fill="#d4ff3a" fill-opacity=".9" filter="url(#hxG)"/><polygon points="${P(top)}" fill="#e6ff8a"/>`);
    }
    return `<svg class="art terr" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>
      <linearGradient id="hxL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d222b"/><stop offset=".55" stop-color="#0b0d11"/></linearGradient>
      <linearGradient id="hxR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13161c"/><stop offset=".55" stop-color="#07080a"/></linearGradient>
      <filter id="hxG" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="14"/></filter></defs>${out.join('')}</svg>`;
  }

  // stepped contour lines: every line a staircase that only steps up, for bands and backgrounds
  function steps({ w = 1200, h = 400, seed = 3, lines = 14, color = 'currentColor' } = {}) {
    const r = rnd(seed), out = [];
    for (let k = 0; k < lines; k++) {
      let x = -20, y = h * (0.15 + 0.9 * k / lines) + 40; const d = ['M' + x + ' ' + f(y)];
      while (x < w + 20) { const run = 40 + r() * 90, up = 6 + r() * 22; x += run; d.push('H' + f(x)); y -= up; d.push('V' + f(y)); }
      out.push(`<path d="${d.join('')}" stroke-opacity="${(0.42 - k / lines * 0.3).toFixed(2)}"/>`);
    }
    return `<svg class="art" viewBox="0 0 ${w} ${h}" fill="none" stroke="${color}" stroke-width="1" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${out.join('')}</svg>`;
  }

  // the old name, kept so every page that asks for "ripples" gets the Hypex lines
  const ripples = (o = {}) => steps({ w: o.w, h: o.h, seed: o.seed, lines: 16, color: o.color });
  const waves = (o = {}) => steps({ w: o.w || 1200, h: o.h || 200, seed: o.seed, lines: o.lines || 9, color: o.color });
  function ribbon(text, times = 24) { const t = String(text || '').toUpperCase().replace(/[<>&"]/g, ''); return `<div class="ribbon" aria-hidden="true"><span>${(t + ' · ').repeat(times)}</span><span>${(t + ' · ').repeat(times)}</span></div>`; }
  window.ART = { terraces, steps, ripples, waves, ribbon };
})();
