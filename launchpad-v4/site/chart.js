/* Token chart on a canvas: candles or line, market cap or price, HYPE or USD, ranges, hover crosshair, volume.
   CHART.mount(el, addr) draws; CHART.update() redraws from DATA after new trades. */
(function () {
  const RANGES = [['5M', 300, 5], ['1H', 3600, 60], ['6H', 21600, 300], ['1D', 86400, 900], ['1W', 604800, 3600], ['All', 0, 0]];
  let el, cv, ctx, addr, chain = 'hyper', rng = 'All', kind = 'candle', mode = 'mcap', unit = 'USD', hover = null, W = 0, H = 0, dpr = 1, bars = [], raf = 0;
  const E = () => window.CFG.econ, SUP = () => E().supply;
  function stepFor(r) { const t = DATA.token(addr); const age = Math.max(60, Math.floor(Date.now() / 1000) - t.createdAt); const span = r[1] || age; return span <= 600 ? 5 : span <= 3600 ? 15 : span <= 21600 ? 60 : span <= 86400 ? 300 : span <= 604800 ? 1800 : 3600; }
  function factor() { return (mode === 'mcap' ? SUP() : 1) * (unit === 'USD' ? APP.hypeUsd : 1); }
  function fmtV(v) { const f = unit === 'USD'; if (mode === 'mcap') return f ? APP.fmtUsd(v) : APP.fmtNum(v, 1) + ' HYPE'; return (f ? '$' : '') + APP.fmtPrice(v).replace(/<sub>(\d+)<\/sub>/, '0$1') + (f ? '' : ' HYPE'); }
  function load() { const r = RANGES.find((x) => x[0] === rng), step = stepFor(r); const all = DATA.candles(addr, step, chain); const from = r[1] ? Math.floor(Date.now() / 1000) - r[1] : 0; bars = all.filter((b) => b.t + step >= from); if (bars.length < 2 && all.length) bars = all.slice(-Math.max(2, Math.min(all.length, 60))); return step; }
  function head() { const t = DATA.token(addr), cs = (t && t.chains) || ['hyper']; return `<div class="ch-hd"><div class="row" style="gap:6px;flex-wrap:wrap">${cs.length > 1 ? `<div class="seg" data-k="chain">${cs.map((c) => `<button class="${chain === c ? 'on' : ''}" data-v="${c}"><img src="${CFG.chainOf(c).logo}" alt="" style="display:inline;width:12px;height:12px;border-radius:50%;vertical-align:-2px;margin-right:4px">${CFG.chainOf(c).short}</button>`).join('')}</div>` : ''}<div class="seg" data-k="rng">${RANGES.map((r) => `<button class="${rng === r[0] ? 'on' : ''}" data-v="${r[0]}">${r[0]}</button>`).join('')}</div></div><div class="row" style="gap:6px;flex-wrap:wrap"><div class="seg" data-k="mode"><button class="${mode === 'mcap' ? 'on' : ''}" data-v="mcap">MCAP</button><button class="${mode === 'price' ? 'on' : ''}" data-v="price">Price</button></div><div class="seg" data-k="unit"><button class="${unit === 'USD' ? 'on' : ''}" data-v="USD">USD</button><button class="${unit === 'HYPE' ? 'on' : ''}" data-v="HYPE">HYPE</button></div><div class="seg" data-k="kind"><button class="${kind === 'candle' ? 'on' : ''}" data-v="candle">Candles</button><button class="${kind === 'line' ? 'on' : ''}" data-v="line">Line</button></div></div></div>`; }
  function mount(e, a, c) {
    el = e; addr = a; if (c) chain = c; el.classList.add('ch'); el.innerHTML = head() + `<div class="ch-cv"><canvas></canvas><div class="ch-tip"></div></div>`;
    cv = el.querySelector('canvas'); ctx = cv.getContext('2d');
    el.querySelectorAll('.seg button').forEach((b) => b.onclick = () => { const k = b.closest('.seg').dataset.k, v = b.dataset.v; if (k === 'rng') rng = v; if (k === 'mode') mode = v; if (k === 'unit') unit = v; if (k === 'kind') kind = v; if (k === 'chain') { chain = v; if (window.CHART.onChain) window.CHART.onChain(v); } mount(el, addr); });
    cv.onmousemove = (ev) => { const r = cv.getBoundingClientRect(); hover = { x: ev.clientX - r.left, y: ev.clientY - r.top }; draw(); }; cv.onmouseleave = () => { hover = null; draw(); };
    cv.addEventListener('touchmove', (ev) => { const r = cv.getBoundingClientRect(); const t = ev.touches[0]; hover = { x: t.clientX - r.left, y: t.clientY - r.top }; draw(); }, { passive: true });
    new ResizeObserver(() => draw()).observe(el.querySelector('.ch-cv'));
    update();
  }
  function update() { if (!el) return; load(); draw(); }
  function draw() {
    if (!cv) return; const box = el.querySelector('.ch-cv'); W = box.clientWidth; H = box.clientHeight; dpr = Math.min(2, devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const tip = el.querySelector('.ch-tip'); if (!bars.length) { ctx.fillStyle = '#8e8e93'; ctx.font = '12px -apple-system, Inter, sans-serif'; ctx.fillText('No trades yet', 16, 30); tip.style.display = 'none'; return; }
    const f = factor(), padR = 72, padB = 26, top = 14, volH = 44; const n = bars.length, cw = (W - padR) / n, lo = Math.min(...bars.map((b) => b.l)) * f, hi = Math.max(...bars.map((b) => b.h)) * f, pad = (hi - lo) * 0.08 || hi * 0.05; const y = (v) => top + (H - padB - volH - top) * (1 - (v * 1 - (lo - pad)) / ((hi + pad) - (lo - pad))); const vmax = Math.max(...bars.map((b) => b.v)) || 1;
    // grid and y labels
    ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.fillStyle = '#8e8e93'; ctx.font = '11px -apple-system, Inter, sans-serif'; ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) { const v = lo - pad + ((hi + pad) - (lo - pad)) * i / 4, yy = y(v); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W - padR, yy); ctx.stroke(); ctx.fillText(fmtV(v), W - padR + 8, yy + 4); }
    // volume
    bars.forEach((b, i) => { const h = b.v / vmax * volH; ctx.fillStyle = b.c >= b.o ? 'rgba(52,199,89,.3)' : 'rgba(255,59,48,.3)'; ctx.fillRect(i * cw + cw * 0.15, H - padB - h, Math.max(1, cw * 0.7), h); });
    // candles or line
    if (kind === 'candle') bars.forEach((b, i) => { const up = b.c >= b.o, x = i * cw + cw / 2; ctx.strokeStyle = ctx.fillStyle = up ? '#34c759' : '#ff3b30'; ctx.beginPath(); ctx.moveTo(x, y(b.h * f)); ctx.lineTo(x, y(b.l * f)); ctx.stroke(); const yo = y(b.o * f), yc = y(b.c * f); ctx.fillRect(i * cw + cw * 0.2, Math.min(yo, yc), Math.max(1, cw * 0.6), Math.max(1, Math.abs(yc - yo))); });
    else { ctx.beginPath(); bars.forEach((b, i) => { const x = i * cw + cw / 2, yy = y(b.c * f); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }); ctx.strokeStyle = '#007aff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; const g = ctx.createLinearGradient(0, top, 0, H - padB - volH); g.addColorStop(0, 'rgba(0,122,255,.2)'); g.addColorStop(1, 'rgba(0,122,255,0)'); ctx.lineTo((n - 1) * cw + cw / 2, H - padB - volH); ctx.lineTo(cw / 2, H - padB - volH); ctx.closePath(); ctx.fillStyle = g; ctx.fill(); }
    // last price line
    const last = bars[n - 1].c * f, yl = y(last); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(0,122,255,.5)'; ctx.beginPath(); ctx.moveTo(0, yl); ctx.lineTo(W - padR, yl); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#007aff'; ctx.fillRect(W - padR, yl - 9, padR, 18); ctx.fillStyle = '#fff'; ctx.fillText(fmtV(last), W - padR + 6, yl + 4);
    // x labels
    ctx.fillStyle = '#8e8e93'; ctx.textAlign = 'center'; const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - padR) / 90)))); const span = bars[n - 1].t - bars[0].t; bars.forEach((b, i) => { if (i % every) return; const d = new Date(b.t * 1000); ctx.fillText(span > 86400 * 2 ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), i * cw + cw / 2, H - 8); });
    // hover
    if (hover && hover.x < W - padR) { const i = Math.max(0, Math.min(n - 1, Math.floor(hover.x / cw))), b = bars[i]; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(i * cw + cw / 2, top); ctx.lineTo(i * cw + cw / 2, H - padB); ctx.moveTo(0, hover.y); ctx.lineTo(W - padR, hover.y); ctx.stroke(); ctx.setLineDash([]); tip.style.display = 'block'; tip.innerHTML = `<b>${new Date(b.t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b><span>O ${fmtV(b.o * f)}</span><span>H ${fmtV(b.h * f)}</span><span>L ${fmtV(b.l * f)}</span><span>C ${fmtV(b.c * f)}</span><span>Vol ${APP.fmtNum(b.v, 2)} HYPE</span>`; tip.style.left = Math.min(hover.x + 14, W - 190) + 'px'; tip.style.top = Math.max(0, hover.y - 10) + 'px'; } else tip.style.display = 'none';
  }
  window.CHART = { mount, update, chain: () => chain };
})();
