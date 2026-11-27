// The Peak mark: the letter A as a summit of banded chevrons, thick and thin in turn, in a ring. One source for the
// site's logo and icon and for everything drawn from them.
//   node brand/peak.cjs      writes site/img/logo.svg and site/img/favicon.svg
const fs = require('fs'), path = require('path');
const INK = '#17132b', PAPER = '#fff5e4';
// [apex y, half width at y = 190, stroke width]: every leg runs at the same slope
const BANDS = [[24, 78, 15], [58, 62.500, 4], [76, 54, 15], [110, 38.500, 4], [128, 30, 15], [162, 14, 4]];
// at icon sizes the fine lines would vanish, so the small mark has fewer, heavier bands
const BANDS_SMALL = [[26, 78, 20], [72, 56, 8], [98, 44, 20], [146, 22, 8]];
const legs = (bands, color) => bands.map(([y, half, w]) => `<path d="M${100 - half} 190L100 ${y}L${100 + half} 190" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="miter" stroke-miterlimit="10"/>`).join('');
// the mark in its ring, on a disc of paper so it reads on any background
const mark = ({ bands = BANDS, ink = INK, paper = PAPER, ring = 6, id = 'pk' } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="98" fill="${paper}"/><clipPath id="${id}"><circle cx="100" cy="100" r="${92 - ring}"/></clipPath><circle cx="100" cy="100" r="${98 - ring / 2}" fill="none" stroke="${ink}" stroke-width="${ring}"/><g clip-path="url(#${id})">${legs(bands, ink)}</g></svg>`;
module.exports = { INK, PAPER, BANDS, BANDS_SMALL, legs, mark };
if (require.main === module) {
  const out = path.join(__dirname, '../site/img');
  fs.writeFileSync(path.join(out, 'logo.svg'), mark() + '\n');
  fs.writeFileSync(path.join(out, 'favicon.svg'), mark({ bands: BANDS_SMALL, ring: 9 }) + '\n');
  console.log('logo.svg and favicon.svg written to', out);
}
