const http = require('http'), fs = require('fs'), path = require('path'); const { chromium } = require('playwright');
const ROOT = __dirname, OUT = process.argv[2] || ROOT;
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(f).pipe(s); }).listen(8799, async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 1500, height: 1500 }, deviceScaleFactor: 2 });
  p.on('console', (m) => console.log('console', m.text())); p.on('pageerror', (e) => console.log('err', e.message));
  await p.goto('http://127.0.0.1:8799/press.html', { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.done, null, { timeout: 60000 }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
  await p.locator('#pfp').screenshot({ path: OUT + '/buzzpad-pfp.png' }); await p.evaluate(() => { document.body.style.background = 'transparent'; }); await p.locator('#logo').screenshot({ path: OUT + '/buzzpad-logo.png', omitBackground: true }); await p.locator('#banner').screenshot({ path: OUT + '/buzzpad-banner.png' });
  await b.close(); srv.close();
});
