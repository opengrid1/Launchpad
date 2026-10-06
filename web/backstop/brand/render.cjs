const { chromium } = require('/tmp/claude-0/-home-user-Launchpad/dfc4f013-9c73-51ea-a5ff-a0c98e61bbc5/scratchpad/pw/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--ignore-certificate-errors'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
  await p.goto('file://' + path.resolve('brand.html'), { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  const out = process.argv[2];
  for (const id of ['icon', 'og', 'banner']) await (await p.$('#' + id)).screenshot({ path: `${out}/${id}.png` });
  for (const el of await p.$$('.coin')) { const id = (await el.getAttribute('id')).slice(2); await el.screenshot({ path: `${out}/coin-${id}.png` }); }
  await b.close();
})();
