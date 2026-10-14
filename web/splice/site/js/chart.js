/* Dependency-free canvas candlestick + volume chart for the coin page.
   window.SpliceChart.create(container, coin) -> { setTF(tf), redraw(), destroy() }
   Draws candles, a volume band, a dashed last-price line, grid + axis labels, and a crosshair
   with an OHLC readout on hover. Theme colours are read from CSS variables at draw time. */
(function () {
  const TFS = ['1H', '1D', '1W', 'ALL'];
  function cssVar(el, name, fb) { const v = getComputedStyle(el).getPropertyValue(name).trim(); return v || fb; }

  function create(container, coin) {
    container.classList.add('chart');
    container.innerHTML = `<div class="chart-tabs">${TFS.map((t, i) => `<button class="chart-tf ${i === 1 ? 'on' : ''}" data-tf="${t}">${t}</button>`).join('')}<span class="chart-read" id="cread"></span></div><canvas class="chart-cv"></canvas>`;
    const cv = container.querySelector('.chart-cv');
    const read = container.querySelector('#cread');
    const ctx = cv.getContext('2d');
    let tf = '1D', hover = -1, raf = 0;

    function draw() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = cv.clientWidth || container.clientWidth, cssH = cv.clientHeight || 260;
      cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH);
      const data = UD.candles(coin.addr, tf); if (!data.length) return;
      const colUp = cssVar(container, '--up', '#27e39a'), colDown = cssVar(container, '--down', '#ff5d6c');
      const colLine = cssVar(container, '--line', '#262b36'), colMuted = cssVar(container, '--faint', '#656d7c');
      const colInk = cssVar(container, '--ink', '#eef1f5'), colSurf = cssVar(container, '--surface-2', '#1b1f28');
      const padR = 62, padL = 8, padT = 10, volH = Math.round(cssH * 0.18), padB = 20;
      const plotH = cssH - padT - padB - volH, plotW = cssW - padL - padR;
      let lo = Infinity, hi = -Infinity, vmax = 0;
      data.forEach(d => { lo = Math.min(lo, d.l); hi = Math.max(hi, d.h); vmax = Math.max(vmax, d.v); });
      const pad = (hi - lo) * 0.08 || hi * 0.05; lo -= pad; hi += pad;
      const X = i => padL + (i + 0.5) / data.length * plotW;
      const Y = p => padT + (1 - (p - lo) / (hi - lo || 1)) * plotH;
      const cw = Math.max(1.5, Math.min(14, plotW / data.length * 0.62));

      ctx.font = '11px "Martian Mono", monospace'; ctx.textBaseline = 'middle';
      // grid + price labels
      ctx.strokeStyle = colLine; ctx.fillStyle = colMuted; ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) { const p = lo + (hi - lo) * g / 4, y = Y(p);
        ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.textAlign = 'left'; ctx.fillText(UI.usd(p, { compact: p >= 1 }), padL + plotW + 6, y); }

      // volume band
      const volY0 = cssH - padB;
      data.forEach((d, i) => { const h = vmax ? (d.v / vmax) * (volH - 4) : 0; ctx.fillStyle = d.c >= d.o ? colUp : colDown; ctx.globalAlpha = .22;
        ctx.fillRect(X(i) - cw / 2, volY0 - h, cw, h); }); ctx.globalAlpha = 1;

      // candles
      data.forEach((d, i) => { const up = d.c >= d.o; ctx.strokeStyle = ctx.fillStyle = up ? colUp : colDown; ctx.lineWidth = 1;
        const x = X(i); ctx.beginPath(); ctx.moveTo(x, Y(d.h)); ctx.lineTo(x, Y(d.l)); ctx.stroke();
        const yO = Y(d.o), yC = Y(d.c); ctx.fillRect(x - cw / 2, Math.min(yO, yC), cw, Math.max(1, Math.abs(yC - yO))); });

      // last price line
      const last = data[data.length - 1]; const ly = Y(last.c); const up = last.c >= last.o;
      ctx.strokeStyle = up ? colUp : colDown; ctx.setLineDash([3, 3]); ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(padL + plotW, ly); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = up ? colUp : colDown; ctx.fillRect(padL + plotW, ly - 9, padR - 2, 18);
      ctx.fillStyle = cssVar(container, '--accent-ink', '#04150e'); ctx.textAlign = 'left'; ctx.fillText(UI.usd(last.c, { compact: last.c >= 1 }), padL + plotW + 5, ly);

      // crosshair + readout
      if (hover >= 0 && hover < data.length) { const d = data[hover], x = X(hover);
        ctx.strokeStyle = colMuted; ctx.globalAlpha = .5; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, volY0); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        const c = d.c >= d.o ? 'var(--up)' : 'var(--down)';
        read.innerHTML = `O <b>${UI.usd(d.o, { compact: false })}</b> H <b>${UI.usd(d.h, { compact: false })}</b> L <b>${UI.usd(d.l, { compact: false })}</b> C <b style="color:${c}">${UI.usd(d.c, { compact: false })}</b>`;
      } else { read.innerHTML = `<span class="muted">Vol 24h ${UI.usd(coin.vol24)} · drag to inspect</span>`; }
    }

    function schedule() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
    cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); const data = UD.candles(coin.addr, tf);
      const padL = 8, padR = 62, plotW = (cv.clientWidth) - padL - padR; const x = e.clientX - r.left - padL;
      hover = Math.max(0, Math.min(data.length - 1, Math.round(x / plotW * data.length - 0.5))); schedule(); });
    cv.addEventListener('pointerleave', () => { hover = -1; schedule(); });
    container.querySelectorAll('.chart-tf').forEach(b => b.onclick = () => {
      container.querySelectorAll('.chart-tf').forEach(x => x.classList.toggle('on', x === b)); tf = b.dataset.tf; hover = -1; draw(); });

    let ro; if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(schedule); ro.observe(container); }
    draw();
    return { setTF: t => { tf = t; draw(); }, redraw: schedule, destroy: () => { ro && ro.disconnect(); } };
  }
  window.SpliceChart = { create };
})();
