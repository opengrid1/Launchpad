// Renders brand.html's SVGs to PNGs in site/img: node brand/render.cjs (needs playwright; PW env points at it)
const path = require('path');
const { chromium } = require(process.env.PW || 'playwright');
const OUT = path.join(__dirname, '..', 'site', 'img');
const SIZES = [['mark', 'mark-512.png', 512], ['mark', 'mark-128.png', 128], ['icon', 'icon-192.png', 192], ['icon', 'apple-touch-icon.png', 180], ['icon', 'favicon-64.png', 64], ['icon', 'favicon-32.png', 32], ['pfp', 'brand/pfp.png'], ['tokdef', 'token-default.png', 256], ['banner', 'brand/banner.png'], ['og', 'og.png']];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--ignore-certificate-errors'] });
  const p = await b.newPage({ deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(__dirname, 'brand.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  for (const [id, file, size] of SIZES) {
    const box = await p.evaluate(i => { document.querySelectorAll('.art').forEach(s => s.style.display = 'none'); const s = document.getElementById(i); s.style.display = 'block'; return { w: s.width.baseVal.value, h: s.height.baseVal.value }; }, id);
    const scale = size ? size / box.w : 1;
    await p.setViewportSize({ width: Math.round(box.w * scale), height: Math.round(box.h * scale) });
    await p.evaluate(([i, sc]) => { const s = document.getElementById(i); s.style.transformOrigin = '0 0'; s.style.transform = `scale(${sc})`; }, [id, scale]);
    await p.screenshot({ path: path.join(OUT, file), omitBackground: id === 'mark' || id === 'tokdef', clip: { x: 0, y: 0, width: Math.round(box.w * scale), height: Math.round(box.h * scale) } });
    console.log(file);
  }
  await b.close();
})();
