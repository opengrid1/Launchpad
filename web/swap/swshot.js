const { chromium } = require('playwright'); const fs = require('fs');
const CFG = fs.readFileSync(__dirname + '/config.js', 'utf8').replace(/reownProjectId: '[^']*'/, "reownProjectId: ''");
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--proxy-server=' + process.env.HTTPS_PROXY, '--ignore-certificate-errors', '--proxy-bypass-list=127.0.0.1;localhost'] });
  const errs = [];
  for (const [u, w, h, wallet] of [['/', 1440, 900, false], ['/pools', 1440, 900, true], ['/liquidity', 1440, 900, true], ['/stake', 1440, 900, true], ['/', 390, 844, false], ['/stake', 390, 844, true]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.on('pageerror', e => errs.push(u + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|429/.test(m.text())) errs.push(u + ' console: ' + m.text().slice(0, 160)); });
    if (wallet) await p.addInitScript(() => localStorage.setItem('wallet', '1'));
    await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: CFG }));
    await p.goto('http://127.0.0.1:8768' + u, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
    if (u === '/' && w > 400) { await p.click('#assetOut'); await p.waitForTimeout(300); console.log('picker tokens', (await p.$$('#tlist .sw-tok')).length); await p.click('#tlist .sw-tok:nth-child(3)'); await p.waitForTimeout(200); console.log('out now', await p.textContent('[data-sym="out"]'), '| cta', await p.textContent('#cta'), '| route', await p.textContent('#d_route')); }
    await p.screenshot({ path: 'shots-' + (u.replace(/\W/g, '') || 'swap') + '-' + w + '.png' }); await p.close();
  }
  console.log('ERRORS', errs); await b.close();
})();
