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
// The ear's own geometry (the same numbers the logo was drawn from), so a banner can colour, outline or crop its parts
const f2 = (n) => Number(n.toFixed(2));
const arm = (y, w, s) => `M${f2(32 + s)} ${y}L${f2(32 + s * (1 + w))} ${f2(y - w * 0.72)}L${f2(32 + s * (1 + w))} ${f2(y - w * 0.72 - 5.6)}L${f2(32 + s)} ${f2(y - 5.6)}z`;
const PARTS = [...[[53, 14.5], [43.6, 14.5], [34.2, 12], [24.8, 8.5]].flatMap(([y, w]) => [arm(y, w, 1), arm(y, w, -1)]), 'M32 6.500 36.300 12.300 32 18.100 27.700 12.300z'];
// draw: (part index) => svg attributes for that part
const earSvg = (draw, viewBox = '0 0 64 64', style = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice" style="display:block;width:100%;height:100%;${style}">${PARTS.map((d, i) => `<path d="${d}" ${draw(i)}/>`).join('')}</svg>`;
const box = (x, y, w, h, inner) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px">${inner}</div>`;
// an ear standing with its foot on the line y = base
const stand = (cx, base, h, draw) => box(cx - h / 2, base - h * (53 / 64), h, h, earSvg(draw));
const zig = (y, color, wd) => `<path d="M${Array.from({ length: 20 }, (_, i) => `${i * 90 - 60} ${y + (i % 2 ? 0 : 70)}`).join('L')}" fill="none" stroke="${color}" stroke-width="${wd}" stroke-linejoin="miter"/>`;

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
// Six more, each a different idea
Object.assign(banners, {
  // 4: the chevrons woven edge to edge, the mark set into them
  weave: `${FONT}<body style="margin:0;width:1500px;height:500px;background:${INK};overflow:hidden;position:relative">
    <svg viewBox="0 0 1500 500" style="position:absolute;inset:0;width:1500px;height:500px">${Array.from({ length: 13 }, (_, i) => zig(-150 + i * 58, i % 4 === 2 ? SUN : CREAM, 22)).join('')}</svg>
    <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:214px;height:214px;border-radius:50%;background:${INK};border:14px solid ${INK};box-shadow:0 0 0 10px ${CREAM}">${logo}</div></body>`,
  // 5: the ear so close that it is only bars of light, two of them gold
  crop: `${FONT}<body style="margin:0;width:1500px;height:500px;background:${INK};overflow:hidden;position:relative">
    ${box(0, 0, 1500, 500, earSvg((i) => `fill="${i === 3 || i === 4 ? SUN : CREAM}"`, '-4 21.500 54 18'))}
    <div style="position:absolute;left:104px;top:64px;${WORD(52, CREAM)}">Ambrosia</div></body>`,
  // 6: a field drawn in line, one ear ripe
  lines: `${FONT}<body style="margin:0;width:1500px;height:500px;background:${INK};overflow:hidden;position:relative">
    ${[210, 250, 190, 270, 220, 260, 200, 280, 230, 250, 210].map((h, i) => stand(100 + i * 130, 470, h, () => (i === 7 ? `fill="${SUN}"` : `fill="none" stroke="${CREAM}" stroke-width=".800" stroke-linejoin="round"`))).join('')}
    <div style="position:absolute;left:0;right:0;top:66px;text-align:center;${WORD(74, CREAM)}">Ambrosia</div></body>`,
  // 7: five colours, five ears, no words at all
  blocks: `${FONT}<body style="margin:0;width:1500px;height:500px;overflow:hidden;position:relative;background:${INK}">
    ${[SUN, MINT, LILAC, PINK, TAN].map((c, i) => `<div style="position:absolute;left:${i * 300}px;top:0;width:300px;height:500px;background:${c};border-right:${i < 4 ? 6 : 0}px solid ${INK};box-sizing:border-box"></div>` + box(i * 300 + 20, 120, 260, 260, earSvg(() => `fill="${INK}"`))).join('')}</body>`,
  // 8: a horizon, a few ears standing on it, and room to breathe
  horizon: `${FONT}<body style="margin:0;width:1500px;height:500px;background:${CREAM};overflow:hidden;position:relative">
    <div style="position:absolute;left:0;right:0;top:352px;height:5px;background:${INK}"></div>
    ${[[1010, 170], [1105, 230], [1205, 190], [1310, 260], [1415, 205]].map(([x, h], i) => stand(x, 354, h, () => `fill="${i === 3 ? TAN : INK}"`)).join('')}
    <div style="position:absolute;left:108px;top:168px;${WORD(118, INK)}">Ambrosia</div></body>`,
  // 9: the mark alone, large, half on ink and half on gold
  split: `${FONT}<body style="margin:0;width:1500px;height:500px;background:${SUN};overflow:hidden;position:relative">
    <div style="position:absolute;left:0;top:0;width:750px;height:500px;background:${INK}"></div>
    ${box(750 - 230, 20, 460, 460, `<div style="position:absolute;inset:0;clip-path:inset(0 50% 0 0)">${earSvg(() => `fill="${CREAM}"`)}</div><div style="position:absolute;inset:0;clip-path:inset(0 0 0 50%)">${earSvg(() => `fill="${INK}"`)}</div>`)}</body>`,
});
(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const shot = async (html, w, h, scale, file) => { const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale }); await p.setContent(html, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); await p.screenshot({ path: path.join(__dirname, file) }); await p.close(); };
  await shot(pfp(INK, CREAM), 1000, 1000, 1, 'x-pfp.png');
  await shot(pfp(SUN, INK), 1000, 1000, 1, 'x-pfp-yellow.png');
  for (const [k, html] of Object.entries(banners)) { await shot(html, 1500, 500, 1, `x-banner-${k}.png`); await shot(html, 1500, 500, 2, `x-banner-${k}@2x.png`); }
  const keys = Object.keys(banners), p = await b.newPage({ viewport: { width: 1100, height: 600 }, deviceScaleFactor: 2 });
  await p.setContent(`<body style="margin:0;padding:24px;background:#2a2740;font:600 22px sans-serif;color:#fff">${keys.map((k, i) => `<div style="margin-bottom:22px"><div style="margin:0 0 8px">${i + 1}. ${k}</div><img style="display:block;width:1052px;border-radius:10px" src="data:image/png;base64,${fs.readFileSync(path.join(__dirname, `x-banner-${k}.png`)).toString('base64')}"></div>`).join('')}</body>`);
  await p.screenshot({ path: path.join(__dirname, 'x-banner-options.png'), fullPage: true }); await p.close();
  await b.close(); console.log('written to', __dirname);
})();
