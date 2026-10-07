// Renders the brand sheet (brand.html) to PNGs: node render.cjs <outdir>
// Needs Playwright; PW_MODULE points at its install when it isn't resolvable from here.
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--ignore-certificate-errors'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
  await p.goto('file://' + path.resolve(__dirname, 'brand.html'), { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  const out = process.argv[2];
  for (const id of ['icon', 'pfp', 'banner', 'tdefault', 'og']) await (await p.$('#' + id)).screenshot({ path: `${out}/${id}.png` });
  for (const id of ['logo', 'lockup']) await (await p.$('#' + id)).screenshot({ path: `${out}/${id}.png`, omitBackground: true });
  fs.writeFileSync(`${out}/logo.svg`, await p.$eval('#logo-svg', (s) => s.outerHTML));
  if (process.env.COINS) for (const el of await p.$$('.coin')) { const id = (await el.getAttribute('id')).slice(2); await el.screenshot({ path: `${out}/coin-${id}.png` }); }
  await b.close();
})();
