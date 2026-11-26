const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const [file, out, size, bg] = process.argv.slice(2); const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--ignore-certificate-errors'] });
  const p = await b.newPage({ viewport: { width: +size, height: +size } });
  const svg = fs.readFileSync(file, 'utf8').replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await p.setContent(`<html><body style="margin:0;background:${bg || 'transparent'}">${svg}</body></html>`); await p.waitForTimeout(300);
  await p.screenshot({ path: out, omitBackground: !bg }); await b.close(); })();
