/** Default liquidstock token logo: a flat mint droplet on the deep-green
 *  tile, in the Hyperliquid brand language (solid #97fce4 glyph on dark
 *  green, no gradients). Shown wherever a coin has no uploaded image and as
 *  the header brand mark. */
export const DEFAULT_TOKEN_LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
      `<rect width='64' height='64' rx='16' fill='#072723'/>` +
      `<path d='M32 8c10.2 12.2 16 20 16 28a16 16 0 1 1-32 0c0-8 5.8-15.8 16-28Z' fill='#97fce4'/>` +
      `</svg>`,
  );
