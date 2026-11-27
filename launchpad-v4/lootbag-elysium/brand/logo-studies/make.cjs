// Logo studies, crafted to the standard of the Elysium mark: one colour, exact geometry, real detail.
// Every mark is drawn in a 200x200 box around (100,100); INK and PAPER are swapped for the dark version.
const { chromium } = require('playwright'); const fs = require('fs');
const INK = '#17132b', PAPER = '#fff5e4';
const f = (n) => Number(n.toFixed(2));
const P = (r, deg) => { const a = (deg * Math.PI) / 180; return [f(100 + r * Math.sin(a)), f(100 - r * Math.cos(a))]; }; // 0 degrees is up, clockwise
const pt = (r, deg) => P(r, deg).join(' ');
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${inner}</svg>`;

// ---- 1. Bloom: the asphodel of the Elysian meadows, as rings of pointed petals laid over one another
const petal = (tip, base, deg, half, fill) => { const c = (tip + base) / 2 * 1.06;
  return `<path d="M${pt(base * 0.7, deg)}L${pt(base, deg - half)}Q${pt(c, deg - half * 0.92)} ${pt(tip, deg)}Q${pt(c, deg + half * 0.92)} ${pt(base, deg + half)}z" fill="${fill}" stroke="${INK}" stroke-width="2.600" stroke-linejoin="round"/>`; };
const bloom = () => { const n = 12, step = 360 / n; let s = `<circle cx="100" cy="100" r="98" fill="${INK}"/>`;
  [[92, 58, 0], [73, 41, 0.5], [54, 25, 0], [36, 10, 0.5]].forEach(([tip, base, off]) => { for (let i = 0; i < n; i++) s += petal(tip, base, (i + off) * step, step / 2, PAPER); });
  return s + `<circle cx="100" cy="100" r="9" fill="${INK}"/><circle cx="100" cy="100" r="3.200" fill="${PAPER}"/>`; };

// ---- 2. Star: the chain's chevrons turned around a centre, so they close into stars one inside another
const star = (R, ratio, n, w, rot = 0) => `<path d="M${Array.from({ length: n * 2 }, (_, i) => pt(i % 2 ? R * ratio : R, rot + (i * 180) / n)).join('L')}z" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linejoin="miter" stroke-miterlimit="8"/>`;
const starMark = () => `<circle cx="100" cy="100" r="95" fill="none" stroke="${INK}" stroke-width="6"/>` + [[84, 9], [67.500, 3.200], [57, 9], [40.500, 3.200], [30, 8]].map(([R, w]) => star(R, 0.66, 8, w)).join('') + `<path d="M${Array.from({ length: 16 }, (_, i) => pt(i % 2 ? 7.500 : 13, i * 22.5)).join('L')}z" fill="${INK}"/>`;

// ---- 3. Amphora: the vessel ambrosia is kept in, painted the way Greek potters painted them
const BODY = 'M83 32H117V38.500H110V63C110 71 139 79 139 103C139 128 111.500 143 108 155H118V162.500H82V155H92C88.500 143 61 128 61 103C61 79 90 71 90 63V38.500H83z';
const amphora = () => { const zz = (y, amp, n, x0, x1) => `M${Array.from({ length: n * 2 + 1 }, (_, i) => `${f(x0 + ((x1 - x0) * i) / (n * 2))} ${i % 2 ? y - amp : y + amp}`).join('L')}`;
  const rays = Array.from({ length: 7 }, (_, i) => { const x = 79 + i * 7; return `M${x - 3.200} 155L${x} 133L${x + 3.200} 155z`; }).join('');
  return `<circle cx="100" cy="100" r="98" fill="${INK}"/><path d="M91 45C74 41 64 60 77 82M109 45C126 41 136 60 123 82" fill="none" stroke="${PAPER}" stroke-width="5" stroke-linecap="round"/>
    <clipPath id="amph"><path d="${BODY}"/></clipPath><path d="${BODY}" fill="${PAPER}"/>
    <g clip-path="url(#amph)" fill="${INK}"><rect x="50" y="52" width="100" height="3.200"/><rect x="50" y="76" width="100" height="4"/><rect x="50" y="83.500" width="100" height="2"/>
      <path d="${zz(100, 8.500, 6, 57, 143)}" fill="none" stroke="${INK}" stroke-width="5.600" stroke-linejoin="miter"/><rect x="50" y="114.500" width="100" height="2"/><rect x="50" y="120" width="100" height="4"/><path d="${rays}"/><rect x="50" y="157.500" width="100" height="2.400"/></g>`; };

// ---- the ear of wheat, redrawn with a fine echo line over every grain (as an engraver would)
const ear = (cx, cy, k, col) => { const arm = (y, w, s, t, lift) => { const x0 = s * 2.4, x1 = s * (2.4 + w), yy = y - lift; return `M${f(cx + k * x0)} ${f(cy + k * yy)}L${f(cx + k * x1)} ${f(cy + k * (yy - w * 0.72))}L${f(cx + k * x1)} ${f(cy + k * (yy - w * 0.72 - t))}L${f(cx + k * x0)} ${f(cy + k * (yy - t))}z`; };
  let d = ''; [[50, 40], [25, 40], [0, 33], [-25, 24]].forEach(([y, w]) => { for (const s of [1, -1]) d += arm(y, w, s, 11.500, 0) + arm(y, w, s, 3, 15.500); });
  d += `M${f(cx)} ${f(cy - k * 90)}L${f(cx + k * 12)} ${f(cy - k * 73)}L${f(cx)} ${f(cy - k * 56)}L${f(cx - k * 12)} ${f(cy - k * 73)}z`;
  return `<path d="${d}" fill="${col}"/>`; };
// ---- 4. Meander: a Greek key running round the rim, the ear at its centre
const meander = () => { const n = 16, unit = 360 / n, rIn = 66.500, pitch = 7.200, pts = [[0, 0], [0, 3], [3, 3], [3, 1], [1, 1], [1, 2], [2, 2]];
  const seg = (a, b, base) => { const steps = a[1] === b[1] ? 8 : 1, out = []; for (let i = 0; i <= steps; i++) { const x = a[0] + ((b[0] - a[0]) * i) / steps, y = a[1] + ((b[1] - a[1]) * i) / steps; out.push(pt(rIn + y * pitch, base + (x * unit) / 4.3)); } return out; };
  let keys = ''; for (let u = 0; u < n; u++) { const base = u * unit + unit * 0.15; let all = []; for (let i = 0; i < pts.length - 1; i++) all = all.concat(seg(pts[i], pts[i + 1], base)); keys += `<path d="M${all.join('L')}" fill="none" stroke="${INK}" stroke-width="4.200" stroke-linejoin="miter" stroke-linecap="butt"/>`; }
  return `<circle cx="100" cy="100" r="96" fill="none" stroke="${INK}" stroke-width="4.500"/><circle cx="100" cy="100" r="${rIn - 2.1}" fill="none" stroke="${INK}" stroke-width="4.200"/>${keys}${ear(100, 109, 0.56, INK)}`; };

// ---- 5. Sheaf: the ear alone in its disc, engraved
const sheaf = () => `<circle cx="100" cy="100" r="98" fill="${INK}"/>${ear(100, 112, 0.93, PAPER)}`;

// ---- 6. Peak: the letter A as a summit of banded chevrons, kin to the chain's own mark
const peak = () => { const leg = (apexY, half, w) => `<path d="M${100 - half} 190L100 ${apexY}L${100 + half} 190" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linejoin="miter" stroke-miterlimit="10"/>`;
  return `<clipPath id="pk"><circle cx="100" cy="100" r="86"/></clipPath><circle cx="100" cy="100" r="95" fill="none" stroke="${INK}" stroke-width="6"/><g clip-path="url(#pk)">
    ${leg(24, 78, 15)}${leg(58, 62.500, 4)}${leg(76, 54, 15)}${leg(110, 38.500, 4)}${leg(128, 30, 15)}${leg(162, 14, 4)}</g>`; };

const L = { '1. Bloom': bloom(), '2. Star': starMark(), '3. Amphora': amphora(), '4. Meander': meander(), '5. Sheaf': sheaf(), '6. Peak': peak() };
const slug = (k) => k.replace(/^\d+\. /, '').toLowerCase();
const inv = (v) => v.split(INK).join('@@').split(PAPER).join(INK).split('@@').join(PAPER);
for (const [k, v] of Object.entries(L)) fs.writeFileSync(`${__dirname}/${slug(k)}.svg`, svg(v) + '\n');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } }); const p = await b.newPage({ viewport: { width: 1320, height: 800 }, deviceScaleFactor: 2 });
  const cell = (k, v) => `<div class="c"><h3>${k}</h3><div class="big light"><span style="width:300px;height:300px">${svg(v)}</span></div>
    <div class="row light"><span style="width:64px;height:64px">${svg(v)}</span><span style="width:32px;height:32px">${svg(v)}</span><span style="width:20px;height:20px">${svg(v)}</span><b class="w1">Ambrosia</b></div>
    <div class="row dark"><span style="width:64px;height:64px">${svg(inv(v))}</span><b class="w2">Ambrosia</b></div></div>`;
  await p.setContent(`<!doctype html><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Outfit:wght@500;600&display=swap"><style>body{margin:0;padding:22px;background:#d9d6e3;font:14px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
    .c{background:${PAPER};border-radius:14px;overflow:hidden}h3{margin:0;padding:10px 14px;font:700 15px sans-serif;background:#fff}.big{display:grid;place-items:center;padding:26px 0 18px}.row{display:flex;align-items:center;gap:14px;padding:14px 18px}.light{background:${PAPER};color:${INK}}.dark{background:${INK};color:${PAPER}}
    span{display:block;flex:none}svg{display:block;width:100%;height:100%}.w1{font:800 34px/1 'Bricolage Grotesque';letter-spacing:-.02em;margin-left:auto}.w2{font:500 36px/1 'Outfit';letter-spacing:-.01em}</style>${Object.entries(L).map(([k, v]) => cell(k, v)).join('')}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700); await p.screenshot({ path: __dirname + '/sheet.png', fullPage: true }); await b.close();
})();
