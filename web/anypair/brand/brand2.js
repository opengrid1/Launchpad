// Anypair flat brand set from flat-a.svg: pfp, icons, OG image.
const { chromium } = require('playwright'); const fs = require('fs');
const src = fs.readFileSync('flat-a.svg', 'utf8');
const inner = src.replace(/<svg [^>]*>/, '').replace('</svg>', '');
const noTile = inner.replace(/<rect width="128" height="128" rx="32" fill="#0052ff"\/>\n?/, '');
const mark = (size, x = 0, y = 0, body = inner) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 128 128">${body}</svg>`;
const FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=IBM+Plex+Sans:wght@500&display=swap">';
const pages = {
  'pfp.png': [1000, 1000, `<svg width="1000" height="1000"><rect width="1000" height="1000" fill="#0052ff"/>${mark(820, 90, 90, noTile)}</svg>`],
  'logo-512.png': [512, 512, mark(512), true],
  'icon-192.png': [192, 192, mark(192), true],
  'apple-touch-icon.png': [180, 180, `<svg width="180" height="180"><rect width="180" height="180" fill="#0052ff"/>${mark(160, 10, 10, noTile)}</svg>`],
  'favicon-64.png': [64, 64, mark(64), true],
  'og.png': [1200, 630, `<svg width="1200" height="630"><rect width="1200" height="630" fill="#f4f4f1"/>${mark(300, 96, 165)}
     <text x="450" y="300" font-family="Bricolage Grotesque" font-weight="800" font-size="120" fill="#0a0b0d" letter-spacing="-5">any<tspan fill="#0052ff">pair</tspan></text>
     <text x="456" y="372" font-family="IBM Plex Sans" font-weight="500" font-size="36" fill="#34363d">Coins on Base, paired with anything.</text>
     <text x="456" y="422" font-family="IBM Plex Sans" font-weight="500" font-size="28" fill="#66686f">Holders earn from every trade.</text></svg>`],
};
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--ignore-certificate-errors'] });
  for (const [name, [w, h, svg, transparent]] of Object.entries(pages)) { const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<html><head>${FONT}</head><body style="margin:0">${svg}</body></html>`, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200);
    await p.screenshot({ path: 'out2/' + name, omitBackground: !!transparent }); await p.close(); console.log(name); }
  await b.close(); })();
