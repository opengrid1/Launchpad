// The Lootbag mark: a tied sack in brushed gold, with a four-point sparkle cut out of it.
// Geometric and flat enough to read at 16px. One source for the logo, favicon, profile picture, banner and link image.
const MARK = (k = 'm') => {
  const id = 'lbm-' + k + '-';
  const body = 'M23.4 26h17.2C49.6 30.4 55 37.6 55 45.6 55 54.6 45.4 59 32 59S9 54.6 9 45.6c0-8 5.4-15.2 14.4-19.6z';
  const neck = 'M19.5 7.5c4 2.6 8.2 3.9 12.5 3.9s8.5-1.3 12.5-3.9L39.8 21H24.2z';
  const sp = (x, y, r) => `M${x} ${y - r}C${x + r * 0.16} ${y - r * 0.16} ${x + r * 0.16} ${y - r * 0.16} ${x + r} ${y}C${x + r * 0.16} ${y + r * 0.16} ${x + r * 0.16} ${y + r * 0.16} ${x} ${y + r}C${x - r * 0.16} ${y + r * 0.16} ${x - r * 0.16} ${y + r * 0.16} ${x - r} ${y}C${x - r * 0.16} ${y - r * 0.16} ${x - r * 0.16} ${y - r * 0.16} ${x} ${y - r}z`;
  return `
  <defs>
    <linearGradient id="${id}g" x1="14" y1="6" x2="50" y2="60" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff6dd"/><stop offset=".42" stop-color="#f6cf72"/><stop offset="1" stop-color="#c98c2a"/>
    </linearGradient>
    <mask id="${id}m"><rect width="64" height="64" fill="#fff"/><path d="${sp(32, 43.5, 9.5)}" fill="#000"/></mask>
  </defs>
  <g fill="url(#${id}g)">
    <path d="${neck}"/>
    <rect x="21.5" y="21" width="21" height="4" rx="2"/>
    <path d="${body}" mask="url(#${id}m)"/>
  </g>`;
};
if (typeof module !== 'undefined') module.exports = { MARK };
