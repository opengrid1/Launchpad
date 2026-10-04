// Anypair brand set from a-pro.svg (shaded A with linked rings): pfp, icons, OG image.
const { chromium } = require('playwright'); const fs = require('fs');
const inner = fs.readFileSync('a-pro.svg', 'utf8').replace(/<svg [^>]*>/, '').replace('</svg>', '');
const mark = (size, x = 0, y = 0) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 128 128">${inner}</svg>`;
const FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=IBM+Plex+Sans:wght@500&display=swap">';
// pill badge with a navy outline and a small offset tab, tilted
const pill = (x, y, rot, word, fill, ink, w) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="${-w / 2}" y="-38" width="${w}" height="76" rx="38" fill="#0a1b4d"/><rect x="${-w / 2 + 7}" y="-31" width="${w - 14}" height="62" rx="31" fill="${fill}"/><rect x="${-w / 2 + 22}" y="-24" width="${w * 0.35}" height="7" rx="3.5" fill="#ffffff" opacity=".45"/><text x="0" y="17" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="800" font-size="50" fill="${ink}" letter-spacing="-1">${word}</text></g>`;
const dots = [[150, 200, 10], [105, 330, 20], [890, 760, 16], [770, 885, 7], [870, 330, 6], [210, 860, 9], [560, 110, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity=".85"/>`).join('');
const pages = {
  'pfp.png': [1000, 1000, `<svg width="1000" height="1000"><defs><radialGradient id="bg" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="#2a74ff"/><stop offset="1" stop-color="#0040d4"/></radialGradient></defs><rect width="1000" height="1000" fill="url(#bg)"/>${dots}${mark(760, 120, 110)}</svg>`],
  'logo-512.png': [512, 512, mark(512), true],
  'icon-192.png': [192, 192, `<svg width="192" height="192"><rect width="192" height="192" rx="42" fill="#0052ff"/>${mark(170, 11, 8)}</svg>`, true],
  'apple-touch-icon.png': [180, 180, `<svg width="180" height="180"><rect width="180" height="180" fill="#0052ff"/>${mark(160, 10, 8)}</svg>`],
  'favicon-64.png': [64, 64, mark(64), true],
  'og.png': [1200, 630, `<svg width="1200" height="630"><rect width="1200" height="630" fill="#f4f4f1"/><circle cx="1090" cy="110" r="12" fill="#0052ff"/><circle cx="1040" cy="530" r="18" fill="#0052ff"/><circle cx="150" cy="520" r="7" fill="#0052ff"/>${mark(360, 150, 130)}
     <text x="540" y="360" font-family="Bricolage Grotesque" font-weight="800" font-size="150" fill="#0a0b0d" letter-spacing="-6">any<tspan fill="#0052ff">pair</tspan></text></svg>`],
  'banner-x.png': [1500, 500, `<svg width="1500" height="500"><defs><radialGradient id="bb" cx=".5" cy=".45" r=".8"><stop offset="0" stop-color="#2a74ff"/><stop offset="1" stop-color="#0040d4"/></radialGradient></defs><rect width="1500" height="500" fill="url(#bb)"/>
     ${[[120, 90, 8], [260, 400, 14], [1380, 120, 10], [1250, 420, 6], [700, 60, 5], [980, 450, 9], [1440, 300, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity=".8"/>`).join('')}
     ${mark(300, 470, 95)}<text x="790" y="300" font-family="Bricolage Grotesque" font-weight="800" font-size="130" fill="#ffffff" letter-spacing="-5">any<tspan fill="#0a1b4d">pair</tspan></text></svg>`],
};
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--ignore-certificate-errors'] });
  for (const [name, [w, h, svg, transparent]] of Object.entries(pages)) { const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<html><head>${FONT}</head><body style="margin:0">${svg}</body></html>`, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200);
    await p.screenshot({ path: 'out3/' + name, omitBackground: !!transparent }); await p.close(); }
  await b.close(); })();
