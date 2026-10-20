const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--proxy-server=' + process.env.HTTPS_PROXY, '--ignore-certificate-errors'] });
  const pages = (process.argv[2]||'index,token').split(',');
  for (const p of pages) for (const [w,h] of [[1440,900],[390,844]]) {
    const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w<500?2:1 });
    pg.on('pageerror', e => console.log(p, w, 'ERR', e.message));
    pg.on('console', m => { if (m.type()==='error' && !/net::|404|Failed to load/.test(m.text())) console.log(p, w, 'CONSOLE', m.text().slice(0,160)); });
    await pg.goto('http://127.0.0.1:8767/' + p + '.html', { waitUntil: 'networkidle' });
    await pg.waitForTimeout(1500);
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (sw) console.log(p, w, 'OVERFLOW', await pg.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position!=='fixed').slice(0,4).map(e => e.tagName+'.'+e.className.toString().slice(0,60))));
    await pg.screenshot({ path: `shots/${p}-${w}.png`, fullPage: true });
    await pg.close();
  }
  await b.close(); console.log('ok');
})().catch(e => { console.error(e.message); process.exit(1); });
