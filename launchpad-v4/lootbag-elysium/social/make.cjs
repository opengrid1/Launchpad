// Draws the profile picture and the banners for X from the Peak mark (brand/peak.cjs):
//   node social/make.cjs        (needs Playwright; writes the PNGs beside this file)
// pfp: 1000x1000, the mark filling the square so X's round crop shows the logo itself.
// banners: 1500x500 (and 3000x1000), with the name at most. X lays the profile picture over the banner's lower left,
// so the name never sits there.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const { INK, PAPER, BANDS, legs, mark } = require('../brand/peak.cjs');
const SUN = '#ffd23f';
const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&display=swap">`;
const WORD = (size, color) => `font:800 ${size}px/1 'Bricolage Grotesque';letter-spacing:-.03em;color:${color}`;
const page = (bg, inner, w = 1500, h = 500) => `<!doctype html>${FONT}<body style="margin:0;width:${w}px;height:${h}px;background:${bg};overflow:hidden;position:relative">${inner}</body>`;
const box = (x, y, w, h, inner) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px">${inner}</div>`;
// The summit without its ring: the bands from the apex down to a flat foot. `color(i)` colours band i.
const summit = (color, viewBox = '14 14 172 176') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice" style="display:block;width:100%;height:100%">${BANDS.map((b, i) => legs([b], color(i))).join('')}</svg>`;
// a summit standing with its foot on the line y = base, its apex h above
const stand = (cx, base, h, color) => box(cx - (h * 172) / 176 / 2, base - h, (h * 172) / 176, h, summit(color));

const pfp = (bg, fg) => page(bg, box(0, 0, 1000, 1000, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" style="display:block;width:100%;height:100%"><clipPath id="c"><circle cx="100" cy="100" r="88"/></clipPath><g clip-path="url(#c)">${legs(BANDS, fg)}</g></svg>`), 1000, 1000);
const banners = {
  // 1: a range at dusk: summits of different heights along the lower edge, one of them gold, the name alone at the left
  range: page(INK, [[650, 200], [886, 272], [1128, 212], [1368, 268]].map(([x, h], i) => stand(x, 500, h, () => (i === 2 ? SUN : PAPER))).join('') + `<div style="position:absolute;left:110px;top:150px;${WORD(112, PAPER)}">Ambrosia</div>`),
  // 2: the bands so close they are only stripes of light, the thin ones gold
  crop: page(INK, box(0, 0, 1500, 500, summit((i) => (i % 2 ? SUN : PAPER), '30 62 108 36')) + `<div style="position:absolute;left:104px;top:64px;${WORD(52, PAPER)}">Ambrosia</div>`),
  // 3: the mark and the name, nothing else
  name: page(PAPER, `<div style="position:absolute;left:50%;top:48%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:34px;white-space:nowrap"><div style="width:190px;height:190px">${mark()}</div><div style="${WORD(150, INK)}">Ambrosia</div></div>`),
  // 4: the same, on ink
  'name-dark': page(INK, `<div style="position:absolute;left:50%;top:48%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:34px;white-space:nowrap"><div style="width:190px;height:190px">${mark({ ink: PAPER, paper: INK })}</div><div style="${WORD(150, PAPER)}">Ambrosia</div></div>`),
  // 5: the summit alone, half on ink and half on gold, no words at all
  split: page(SUN, `<div style="position:absolute;left:0;top:0;width:750px;height:500px;background:${INK}"></div>` + box(750 - 215, 60, 430, 440, `<div style="position:absolute;inset:0;clip-path:inset(0 50% 0 0)">${summit(() => PAPER)}</div><div style="position:absolute;inset:0;clip-path:inset(0 0 0 50%)">${summit(() => INK)}</div>`)),
  // 6: one great summit rising off the right edge, the name small beside it
  rise: page(PAPER, box(820, 30, 760, 778, summit(() => INK)) + `<div style="position:absolute;left:110px;top:176px;${WORD(104, INK)}">Ambrosia</div>`),
};
(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const shot = async (html, w, h, scale, file) => { const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale }); await p.setContent(html, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); await p.screenshot({ path: path.join(__dirname, file) }); await p.close(); };
  await shot(pfp(INK, PAPER), 1000, 1000, 1, 'x-pfp.png');
  await shot(pfp(PAPER, INK), 1000, 1000, 1, 'x-pfp-light.png');
  await shot(pfp(SUN, INK), 1000, 1000, 1, 'x-pfp-yellow.png');
  for (const [k, html] of Object.entries(banners)) { await shot(html, 1500, 500, 1, `x-banner-${k}.png`); await shot(html, 1500, 500, 2, `x-banner-${k}@2x.png`); }
  // one sheet of everything, numbered, to choose from
  const img = (f) => `data:image/png;base64,${fs.readFileSync(path.join(__dirname, f)).toString('base64')}`;
  const p = await b.newPage({ viewport: { width: 1100, height: 600 }, deviceScaleFactor: 2 });
  await p.setContent(`<!doctype html><body style="margin:0;padding:24px;background:#2a2740;font:600 22px sans-serif;color:#fff"><div style="display:flex;gap:22px;margin-bottom:26px">${[['x-pfp.png', 'PFP'], ['x-pfp-light.png', 'PFP, light'], ['x-pfp-yellow.png', 'PFP, gold']].map(([f, t]) => `<div><div style="margin:0 0 8px">${t}</div><img style="display:block;width:220px;border-radius:50%" src="${img(f)}"></div>`).join('')}</div>
    ${Object.keys(banners).map((k, i) => `<div style="margin-bottom:22px"><div style="margin:0 0 8px">${i + 1}. ${k}</div><img style="display:block;width:1052px;border-radius:10px" src="${img(`x-banner-${k}.png`)}"></div>`).join('')}</body>`);
  await p.screenshot({ path: path.join(__dirname, 'x-options.png'), fullPage: true }); await p.close();
  await b.close(); console.log('written to', __dirname);
})();
