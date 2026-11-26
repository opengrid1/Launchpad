const { chromium } = require('playwright'); const OUT = process.argv[2];
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 2200 }, deviceScaleFactor: 2 });
await p.goto('file://' + __dirname + '/final.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready);
await p.locator('#pfp').screenshot({ path: OUT + '/buzzpad-pfp.png' }); await p.locator('#banner').screenshot({ path: OUT + '/buzzpad-banner.png' });
const q = await b.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 }); await q.goto('file://' + __dirname + '/final.html', { waitUntil: 'networkidle' }); await q.evaluate(() => document.fonts.ready);
await q.locator('#icon').screenshot({ path: OUT + '/buzzpad-logo.png', omitBackground: true }); await b.close(); })();
