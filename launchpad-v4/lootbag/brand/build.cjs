// Renders the brand assets to ../site/img and ./out with Playwright. Run: node build.cjs
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const { MARK } = require('./mark.js');
const OUT = path.join(__dirname, 'out'), IMG = path.join(__dirname, '../site/img'); fs.mkdirSync(OUT, { recursive: true });
const svgMark = (size, id) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${MARK(id)}</svg>`;
// standalone svgs for the site
fs.writeFileSync(path.join(IMG, 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${MARK('l')}</svg>\n`);
fs.writeFileSync(path.join(IMG, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="fb" cx="32" cy="38" r="34" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3a2708"/><stop offset="1" stop-color="#120d06"/></radialGradient></defs><rect width="64" height="64" rx="14" fill="url(#fb)"/><g transform="translate(5 5) scale(.84)">${MARK('f')}</g></svg>\n`);

const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap">`;
const base = `*{margin:0;box-sizing:border-box}body{background:#0b0906;font-family:'Space Grotesk',sans-serif;color:#f7f2e8;-webkit-font-smoothing:antialiased}`;
// soft warm field: glow, a faint chart line, a few coins catching the light
const coins = (list) => list.map(([x, y, r, o, rot]) => `<g transform="translate(${x} ${y}) rotate(${rot})" opacity="${o}"><ellipse rx="${r}" ry="${r * 0.42}" fill="#7a5110"/><ellipse cy="${-r * 0.12}" rx="${r}" ry="${r * 0.42}" fill="url(#cg)"/><ellipse cy="${-r * 0.12}" rx="${r * 0.62}" ry="${r * 0.24}" fill="none" stroke="#a86d12" stroke-opacity=".6" stroke-width="${Math.max(1, r * 0.07)}"/></g>`).join('');
const COIN_DEF = `<linearGradient id="cg" x1="0" y1="-1" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#fff0c4"/><stop offset=".5" stop-color="#f3bf4e"/><stop offset="1" stop-color="#c3831c"/></linearGradient>`;

const RAYS = (cx, cy, n, r0, r1, op) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, w = 0.012 + (i % 3) * 0.006; return `<path d="M${cx + Math.cos(a - w) * r0} ${cy + Math.sin(a - w) * r0}L${cx + Math.cos(a) * r1} ${cy + Math.sin(a) * r1}L${cx + Math.cos(a + w) * r0} ${cy + Math.sin(a + w) * r0}z" fill="url(#ray)" opacity="${(op * (0.45 + ((i * 37) % 11) / 20)).toFixed(2)}"/>`; }).join('');
const RAYDEF = (cx, cy, r) => `<radialGradient id="ray" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffd477" stop-opacity=".9"/><stop offset="1" stop-color="#ffd477" stop-opacity="0"/></radialGradient>`;
const SCENE = (W, H, cx, cy, rr, glowR) => `<defs>${RAYDEF(cx, cy, rr)}<radialGradient id="bg" cx="${cx}" cy="${cy}" r="${Math.max(W, H) * 0.75}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2e1f08"/><stop offset=".5" stop-color="#140f08"/><stop offset="1" stop-color="#0a0806"/></radialGradient>
  <radialGradient id="glow" cx="${cx}" cy="${cy}" r="${glowR}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffcb5c" stop-opacity=".5"/><stop offset=".5" stop-color="#ffcb5c" stop-opacity=".12"/><stop offset="1" stop-color="#ffcb5c" stop-opacity="0"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>${RAYS(cx, cy, 72, 40, rr, 0.22)}<circle cx="${cx}" cy="${cy}" r="${glowR}" fill="url(#glow)"/>`;
const pages = {
  pfp: { w: 1000, h: 1000, html: `<svg width="1000" height="1000" viewBox="0 0 1000 1000">${SCENE(1000, 1000, 500, 520, 700, 420)}
    <g transform="translate(160 170) scale(10.6)">${MARK('p')}</g></svg>` },
  banner: { w: 1500, h: 500, html: `<svg width="1500" height="500" viewBox="0 0 1500 500">${SCENE(1500, 500, 750, 210, 900, 300)}
    <g transform="translate(660 82) scale(2.8)">${MARK('b')}</g></svg>
    <div style="position:absolute;left:0;right:0;top:300px;text-align:center;font:700 54px/1 'Space Grotesk';letter-spacing:.34em;padding-left:.34em;color:#f7f2e8">LOOTBAG</div>
    <div style="position:absolute;left:0;right:0;top:378px;text-align:center;font:500 17px/1 'Space Grotesk';letter-spacing:.28em;padding-left:.28em;color:#c9a86a">HOLD THE BAG</div>` },
  og: { w: 1200, h: 630, html: `<svg width="1200" height="630" viewBox="0 0 1200 630">${SCENE(1200, 630, 600, 250, 800, 320)}
    <g transform="translate(500 110) scale(3.1)">${MARK('o')}</g></svg>
    <div style="position:absolute;left:0;right:0;top:360px;text-align:center;font:700 60px/1 'Space Grotesk';letter-spacing:.34em;padding-left:.34em;color:#f7f2e8">LOOTBAG</div>
    <div style="position:absolute;left:0;right:0;top:450px;text-align:center;font:500 26px/1.3 'Space Grotesk';color:#d9c9a6">Hold the bag. <span style="color:#f4b740">Get paid in stocks.</span></div>` },
  apple: { w: 180, h: 180, html: `<svg width="180" height="180" viewBox="0 0 64 64"><defs><radialGradient id="ab" cx="32" cy="38" r="34" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3a2708"/><stop offset="1" stop-color="#120d06"/></radialGradient></defs><rect width="64" height="64" fill="url(#ab)"/><g transform="translate(5 5) scale(.84)">${MARK('a')}</g></svg>` },
  mark: { w: 1024, h: 1024, transparent: true, html: svgMark(1024, 'k') },
};
(async () => {
  const b = await chromium.launch();
  for (const [name, P] of Object.entries(pages)) {
    const p = await b.newPage({ viewport: { width: P.w, height: P.h }, deviceScaleFactor: 1 });
    await p.setContent(`<!doctype html><html><head>${FONT}<style>${base}${P.transparent ? 'body{background:transparent}' : ''}</style></head><body><div style="position:relative;width:${P.w}px;height:${P.h}px;overflow:hidden">${P.html}</div></body></html>`);
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
    const file = { pfp: 'lootbag-pfp.png', banner: 'lootbag-x-banner.png', og: 'og.png', apple: 'apple-icon.png', mark: 'lootbag-mark.png' }[name];
    await p.screenshot({ path: path.join(OUT, file), omitBackground: !!P.transparent });
    await p.close();
  }
  for (const f of ['og.png', 'apple-icon.png']) fs.copyFileSync(path.join(OUT, f), path.join(IMG, f));
  await b.close(); console.log('ok', fs.readdirSync(OUT));
})();
