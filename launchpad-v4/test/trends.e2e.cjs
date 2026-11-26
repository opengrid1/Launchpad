const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = '/home/user/Launchpad/launchpad-v4/site';
const API = { trends: require(ROOT + '/api/trends.js'), idea: require(ROOT + '/api/idea.js') };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer(async (q, r) => { let p = q.url.split('?')[0];
  const m = p.match(/^\/api\/(\w+)$/); if (m && API[m[1]]) { q.query = Object.fromEntries(new URL(q.url, 'http://x').searchParams); return API[m[1]](q, r); }
  if (p.startsWith('/api/')) { const x = await fetch('https://www.liquidfi.fun' + q.url); r.writeHead(x.status, { 'content-type': 'application/json' }); return r.end(await x.text()); }
  if (p === '/') p = '/index.html'; if (!path.extname(p)) p += '.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
srv.listen(8794, async () => {
  const { chromium } = require('playwright'); const b = await chromium.launch(); const errs = [];
  for (const [w, h, tag] of [[1360, 900, 'desktop'], [390, 844, 'mobile']]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
    p.on('pageerror', (e) => errs.push(tag + ' PAGEERROR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(tag + ' ' + m.text().slice(0, 150)); });
    await p.goto('http://127.0.0.1:8794/trends'); await p.waitForSelector('[data-idea]', { timeout: 30000 });
    console.log(tag, 'cards', await p.$$eval('.tc', (x) => x.length), 'nav has Trending', await p.evaluate(() => !!document.querySelector('a[href="/trends"]')), 'overflow', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    if (tag === 'desktop') {
      await p.click('[data-idea]'); await p.waitForSelector('[data-launch]', { timeout: 30000 });
      console.log('idea:', await p.$eval('.idea', (e) => e.textContent.replace(/\s+/g, ' ').trim()));
      await p.screenshot({ path: 'shots/trends-desktop.png' });
      await p.click('[data-launch]'); await p.waitForURL(/\/launch/, { timeout: 15000 }); await p.waitForTimeout(1500);
      console.log('launch form:', JSON.stringify(await p.evaluate(() => ({ name: document.querySelector('#f-name').value, sym: document.querySelector('#f-sym').value, desc: document.querySelector('#f-desc').value, img: !!document.querySelector('#drop img') }))));
      await p.screenshot({ path: 'shots/trends-launch.png' });
    } else await p.screenshot({ path: 'shots/trends-mobile.png' });
  }
  console.log('errors', errs); await b.close(); srv.close(); });
