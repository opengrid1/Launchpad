// Renders the Anypair brand set from mark.svg: pfp, icons, OG image.
const { chromium } = require('playwright'); const fs = require('fs');
const mark = fs.readFileSync('mark-a.svg', 'utf8').replace(/<svg [^>]*>/, '').replace('</svg>', '');
const markSvg = (size, x = 0, y = 0) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 128 128">${mark}</svg>`;
const FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=IBM+Plex+Sans:wght@500&display=swap">';
// a blobby sticker badge with a word on it, like Inky's
const badge = (x, y, rot, word, fill, w) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(1.45)">
  <path d="M${-w / 2 - 14} -34 Q${-w / 2 - 34} 2 ${-w / 2 - 12} 38 Q0 50 ${w / 2 + 10} 40 Q${w / 2 + 36} 2 ${w / 2 + 14} -38 Q0 -50 ${-w / 2 - 14} -34 Z" fill="#fbfbf9"/>
  <path d="M${-w / 2 - 8} -27 Q${-w / 2 - 24} 2 ${-w / 2 - 6} 30 Q0 40 ${w / 2 + 5} 32 Q${w / 2 + 26} 2 ${w / 2 + 8} -30 Q0 -40 ${-w / 2 - 8} -27 Z" fill="${fill}" stroke="#0a0b0d" stroke-width="6" stroke-linejoin="round"/>
  <text x="0" y="16" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="800" font-size="46" fill="#fff" stroke="#0d0e12" stroke-width="9" paint-order="stroke" letter-spacing="-1">${word}</text>
  <circle cx="${w / 2 + 12}" cy="-32" r="7" fill="${fill}" stroke="#fbfbf9" stroke-width="4"/><circle cx="${-w / 2 - 12}" cy="34" r="5" fill="${fill}" stroke="#fbfbf9" stroke-width="3"/></g>`;
const dots = c => [[150, 210, 9, c], [110, 330, 22, c], [880, 770, 15, c], [770, 880, 7, c], [860, 300, 6, c], [205, 850, 8, c]].map(([x, y, r, f]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}"/>`).join('');
const pages = {
  'pfp.png': [1000, 1000, `<svg width="1000" height="1000" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#0052ff"/>${dots('#ffffff')}${markSvg(700, 150, 150)}${badge(815, 175, -12, 'any', '#0a0b0d', 96)}${badge(200, 835, 9, 'pair', '#0a0b0d', 112)}</svg>`],
  'pfp-dark.png': [1000, 1000, `<svg width="1000" height="1000" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#0a0b0d"/>${dots('#0052ff')}${markSvg(700, 150, 150)}${badge(815, 175, -12, 'any', '#0052ff', 96)}${badge(200, 835, 9, 'pair', '#0052ff', 112)}</svg>`],
  'logo-512.png': [512, 512, `<svg width="512" height="512" viewBox="0 0 512 512">${markSvg(512)}</svg>`, true],
  'icon-192.png': [192, 192, `<svg width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" rx="44" fill="#0052ff"/>${markSvg(176, 8, 10)}</svg>`],
  'apple-touch-icon.png': [180, 180, `<svg width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" fill="#0052ff"/>${markSvg(164, 8, 9)}</svg>`],
  'favicon-64.png': [64, 64, `<svg width="64" height="64" viewBox="0 0 64 64">${markSvg(64)}</svg>`, true],
  'og.png': [1200, 630, `<svg width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#f4f4f1"/><circle cx="1110" cy="90" r="12" fill="#0052ff"/><circle cx="1040" cy="560" r="20" fill="#0052ff"/><circle cx="640" cy="80" r="7" fill="#0052ff"/>${markSvg(450, 735, 100)}
     <text x="90" y="250" font-family="Bricolage Grotesque" font-weight="800" font-size="118" fill="#0d0e12" letter-spacing="-5">any<tspan fill="#0052ff">pair</tspan></text>
     <text x="94" y="330" font-family="IBM Plex Sans" font-weight="500" font-size="38" fill="#34363d">Coins on Base, paired with anything.</text>
     <text x="94" y="384" font-family="IBM Plex Sans" font-weight="500" font-size="30" fill="#66686f">Holders earn from every trade.</text></svg>`],
};
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--ignore-certificate-errors'] });
  for (const [name, [w, h, svg, transparent]] of Object.entries(pages)) { const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<html><head>${FONT}</head><body style="margin:0">${svg}</body></html>`, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
    await p.screenshot({ path: 'out/' + name, omitBackground: !!transparent }); await p.close(); console.log(name); }
  await b.close(); })();
