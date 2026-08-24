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
