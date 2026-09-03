/** hyperstock brand mark and default token logo: the liquid surface IS the
 *  chart — mint liquid rising to the right with bubbles, flat #97fce4 on the
 *  deep-green tile in the Hyperliquid brand language (no gradients). Shown
 *  wherever a coin has no uploaded image and as the header brand mark. */
import { BRAND_FLAVOR } from "../brand";

/** The squidpad squid: teal mantle with tentacles and eyes, centred in a
 *  64x64 tile. `bg` paints the rounded backing (tile for the logo, none for a
 *  transparent overlay). Kept in sync with the PNG brand assets in /public. */
const squidMark = (bg: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
      bg +
      `<g transform='translate(32 30) scale(0.82)'>` +
      // back tentacles (darker teal)
      `<g fill='#2fb9a8'>` +
      `<path d='M-13 6 C-18 16 -22 22 -26 30 C-24 31 -21 27 -18 22 C-16 26 -18 32 -16 34 C-14 31 -13 24 -12 18 Z'/>` +
      `<path d='M13 6 C18 16 22 22 26 30 C24 31 21 27 18 22 C16 26 18 32 16 34 C14 31 13 24 12 18 Z'/>` +
      `</g>` +
      // front tentacles
      `<g fill='#4fe0cb'>` +
      `<path d='M-6 8 C-8 20 -9 28 -10 36 C-8 37 -6 30 -5 22 C-4 30 -6 36 -4 38 C-2 34 -1 22 0 12 Z'/>` +
      `<path d='M6 8 C8 20 9 28 10 36 C8 37 6 30 5 22 C4 30 6 36 4 38 C2 34 1 22 0 12 Z'/>` +
      `</g>` +
      // mantle + sheen
      `<path d='M0 -26 C13 -26 21 -15 21 -1 C21 9 16 15 9 17 C3 18.6 -3 18.6 -9 17 C-16 15 -21 9 -21 -1 C-21 -15 -13 -26 0 -26 Z' fill='#4fe0cb'/>` +
      `<path d='M0 -24 C10 -24 16.5 -16 18 -6 C13 -12 6 -14 0 -14 C-6 -14 -13 -12 -18 -6 C-16.5 -16 -10 -24 0 -24 Z' fill='#b6f5ea' opacity='.6'/>` +
      // eyes
      `<circle cx='-8' cy='-3' r='4.4' fill='#04221e'/>` +
      `<circle cx='8' cy='-3' r='4.4' fill='#04221e'/>` +
      `<circle cx='-6.6' cy='-4.4' r='1.5' fill='#eafff9'/>` +
      `<circle cx='9.4' cy='-4.4' r='1.5' fill='#eafff9'/>` +
      `</g></svg>`,
  );

/** squidpad default token logo and brand mark: the squid on the deep-teal tile. */
const INK_TOKEN_LOGO = squidMark(`<rect width='64' height='64' rx='16' fill='#062723'/>`);
const INK_BRAND_MARK = INK_TOKEN_LOGO;

const HYPER_TOKEN_LOGO =
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

const HYPER_BRAND_MARK =
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

// meowstock uses the uploaded cat mark (teal on a deep-teal tile) as both the
// brand mark and the default token avatar.
const MEOW_MARK = "/meow-tile.png";
// Dividenz (Robinhood Chain): the glossy green feather logo.
const DIVIDENZ_MARK = "/dividenz-feather.png";
const IS_DIVIDENZ = BRAND_FLAVOR === "robinhood";

export const DEFAULT_TOKEN_LOGO =
  IS_DIVIDENZ ? DIVIDENZ_MARK : BRAND_FLAVOR === "meow" ? MEOW_MARK : BRAND_FLAVOR === "ink" ? INK_TOKEN_LOGO : HYPER_TOKEN_LOGO;
export const BRAND_MARK =
  IS_DIVIDENZ ? DIVIDENZ_MARK : BRAND_FLAVOR === "meow" ? MEOW_MARK : BRAND_FLAVOR === "ink" ? INK_BRAND_MARK : HYPER_BRAND_MARK;
