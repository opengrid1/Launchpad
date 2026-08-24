/** liquidstock brand mark and default token logo: the liquid surface IS the
 *  chart — mint liquid rising to the right with bubbles, flat #97fce4 on the
 *  deep-green tile in the Hyperliquid brand language (no gradients). Shown
 *  wherever a coin has no uploaded image and as the header brand mark. */
export const DEFAULT_TOKEN_LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
      `<defs><clipPath id='t'><rect width='64' height='64' rx='16'/></clipPath></defs>` +
      `<rect width='64' height='64' rx='16' fill='#072723'/>` +
      `<g clip-path='url(#t)'>` +
      `<path d='M0 50 C8 46 12 52 20 46 C28 40 32 44 40 36 C48 28 54 28 64 20 L64 64 L0 64 Z' fill='#97fce4'/>` +
      `<circle cx='46' cy='16' r='3' fill='#97fce4' opacity='.85'/>` +
      `<circle cx='55' cy='10' r='2' fill='#97fce4' opacity='.6'/>` +
      `</g></svg>`,
  );

/** liquidstock brand mark (header, favicon): the liquid coin — a coin disc
 *  holding sloshing liquid with bubbles. Deliberately different from the
 *  default token logo above so no coin can pass as the brand. */
export const BRAND_MARK =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
      `<rect width='64' height='64' rx='16' fill='#072723'/>` +
      `<circle cx='32' cy='32' r='23' fill='none' stroke='#97fce4' stroke-width='3.6'/>` +
      `<defs><clipPath id='c'><circle cx='32' cy='32' r='19.6'/></clipPath></defs>` +
      `<g clip-path='url(#c)'>` +
      `<path d='M9.6 34.6 C16 31.4 19.8 37.1 26.2 33.9 C32.6 30.7 36.5 35.8 42.9 32 C48 28.8 51.2 29.4 55.7 26.9 L55.7 54.4 L9.6 54.4 Z' fill='#97fce4'/>` +
      `<circle cx='39.7' cy='23' r='2.3' fill='#97fce4' opacity='.85'/>` +
      `<circle cx='45.8' cy='17.6' r='1.5' fill='#97fce4' opacity='.6'/>` +
      `</g></svg>`,
  );
