// Renders banner.html to a 16:9 PNG for X (1600x900 CSS pixels at 2x), with the Lootbag logo inlined.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const out = process.argv[2];
(async () => {
  const logo = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname, '../site/img/logo.svg')).toString('base64');
  const html = fs.readFileSync(path.join(__dirname, 'banner.html'), 'utf8').split('LOGO').join(logo);
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await p.setContent(html, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  console.log('font loaded:', await p.evaluate(() => document.fonts.check('700 100px "Space Grotesk"')));
  await p.screenshot({ path: out, type: 'png' });
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
  await b.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
