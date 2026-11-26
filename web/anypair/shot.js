// usage: node shot.js <path> <out.png> [w] [h] [theme] [full]
const { chromium } = require('playwright');
(async () => {
  const [path, out, w = '1440', h = '900', theme = '', full = ''] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--proxy-bypass-list=127.0.0.1;localhost', '--ignore-certificate-errors'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h }, colorScheme: theme === 'dark' ? 'dark' : 'light', deviceScaleFactor: +w < 500 ? 2 : 1 });
  const errs = []; p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  await p.goto('http://127.0.0.1:8790' + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => errs.push('goto ' + e.message));
  await p.waitForTimeout(2500);
  await p.screenshot({ path: out, fullPage: !!full });
  console.log(errs.slice(0, 8).join('\n') || 'no errors');
  await b.close();
})();
