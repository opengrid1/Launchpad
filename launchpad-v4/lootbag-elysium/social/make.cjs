// Draws the profile picture and the banner for X from the site's logo and colours:
//   node social/make.cjs        (needs Playwright; writes the PNGs beside this file)
// pfp: 1000x1000, the mark filling the square so X's round crop shows the logo itself.
// banners: 1500x500 (and 3000x1000), three of them, with the name at most. X lays the profile picture over the
// banner's lower left, so the name never sits there.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const INK = '#17132b', CREAM = '#fff5e4', SUN = '#ffd23f', TAN = '#ff7a1a', MINT = '#b9f3d4', LILAC = '#cfc2ff', PINK = '#ff8fb1';
const logo = fs.readFileSync(path.join(__dirname, '../site/img/logo.svg'), 'utf8');
// the ear alone (the logo without its disc), in any colour
const ear = (fill) => logo.replace(/<circle[^>]*fill="#17132b"[^>]*\/>/, '').split(CREAM).join(fill);
const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=DM+Sans:opsz,wght@9..40,500;9..40,700&display=swap">`;
const pfp = (bg, fg) => `${FONT}<body style="margin:0;width:1000px;height:1000px;background:${bg};display:grid;place-items:center"><div style="width:860px;height:860px">${ear(fg)}</div></body>`;
// Three banners with next to no words: the name at most, and the ear of wheat doing the talking.
const WORD = (size, color) => `font:800 ${size}px/1 'Bricolage Grotesque';letter-spacing:-.03em;color:${color}`;
const earAt = (x, bottom, h, fill) => `<div style="position:absolute;left:${x - h / 2}px;top:${bottom - h}px;width:${h}px;height:${h}px">${ear(fill)}</div>`;
const banners = {
  // a field at dusk: ears of different heights rising from the lower edge, the name alone at the left
  field: `${FONT}<body style="margin:0;width:1500px;height:500px;background:${INK};overflow:hidden;position:relative">
    ${[[700, 548, 300, CREAM], [878, 566, 380, CREAM], [1056, 552, 320, SUN], [1234, 572, 400, CREAM], [1412, 556, 340, CREAM]].map((e) => earAt(...e)).join('')}
    <div style="position:absolute;left:110px;top:150px;${WORD(112, CREAM)}">Ambrosia</div></body>`,
  // the ear as a pattern, edge to edge, and the name on a label in the middle
  pattern: `${FONT}<body style="margin:0;width:1500px;height:500px;background:${CREAM};overflow:hidden;position:relative">
    ${Array.from({ length: 5 }, (_, r) => Array.from({ length: 15 }, (_, c) => earAt(c * 112 - 30 + (r % 2) * 56, r * 122 + 96, 132, INK)).join('')).join('')}
    <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:22px;padding:22px 40px 22px 26px;background:${SUN};border:5px solid ${INK};border-radius:30px;box-shadow:10px 10px 0 ${INK}">
      <div style="width:104px;height:104px">${logo}</div><div style="${WORD(100, INK)}">Ambrosia</div></div></body>`,
  // the mark and the name, nothing else
  name: `${FONT}<body style="margin:0;width:1500px;height:500px;background:${SUN};overflow:hidden;position:relative">
    <div style="position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:30px;white-space:nowrap">
      <div style="width:170px;height:170px">${logo}</div><div style="${WORD(150, INK)}">Ambrosia</div></div></body>`,
};
(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const shot = async (html, w, h, scale, file) => { const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale }); await p.setContent(html, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); await p.screenshot({ path: path.join(__dirname, file) }); await p.close(); };
  await shot(pfp(INK, CREAM), 1000, 1000, 1, 'x-pfp.png');
  await shot(pfp(SUN, INK), 1000, 1000, 1, 'x-pfp-yellow.png');
  for (const [k, html] of Object.entries(banners)) { await shot(html, 1500, 500, 1, `x-banner-${k}.png`); await shot(html, 1500, 500, 2, `x-banner-${k}@2x.png`); }
  await b.close(); console.log('written to', __dirname);
})();
