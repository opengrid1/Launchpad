/** liquidstock brand mark and default token logo: three rising candlesticks
 *  emerging from a liquid wave, in the Hyperliquid brand language (flat mint
 *  #97fce4 on the deep-green tile, no gradients). Shown wherever a coin has
 *  no uploaded image and as the header brand mark. */
export const DEFAULT_TOKEN_LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
      `<defs><clipPath id='t'><rect width='64' height='64' rx='16'/></clipPath></defs>` +
      `<rect width='64' height='64' rx='16' fill='#072723'/>` +
      `<g clip-path='url(#t)'>` +
      `<path d='M0 45 C6 41.5 12 41.5 18 44.5 C24 47.5 30 47.5 36 44.5 C42 41.5 48 41.5 54 44.5 C58 46.5 61 46.5 64 45 L64 64 L0 64 Z' fill='#177a66'/>` +
      `<rect x='14.9' y='24' width='2.2' height='26' rx='1.1' fill='#97fce4'/>` +
      `<rect x='11' y='29' width='10' height='18' rx='2.5' fill='#97fce4'/>` +
      `<rect x='30.9' y='16' width='2.2' height='32' rx='1.1' fill='#97fce4'/>` +
      `<rect x='27' y='21' width='10' height='24' rx='2.5' fill='#97fce4'/>` +
      `<rect x='46.9' y='9' width='2.2' height='37' rx='1.1' fill='#97fce4'/>` +
      `<rect x='43' y='14' width='10' height='28' rx='2.5' fill='#97fce4'/>` +
      `</g></svg>`,
  );
