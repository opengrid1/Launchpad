/** Default liquidstock token logo: a mint droplet on the Hyperliquid
 *  deep-green tile with a soft water shine. Shown wherever a coin has no
 *  uploaded image (board rows, token page, lists). */
export const DEFAULT_TOKEN_LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#98fce4'/><stop offset='1' stop-color='#2fb5a6'/></linearGradient></defs>` +
      `<rect width='64' height='64' rx='16' fill='#05261f'/>` +
      `<path d='M32 7c10.5 12.5 16.5 20.5 16.5 28.7a16.5 16.5 0 1 1-33 0C15.5 27.5 21.5 19.5 32 7Z' fill='url(#g)'/>` +
      `<path d='M24.5 36.5a8 8 0 0 0 5.5 7.6' stroke='#eafffa' stroke-width='3.4' fill='none' stroke-linecap='round' opacity='.85'/>` +
      `</svg>`,
  );
