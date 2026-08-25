/** hyperstock brand mark and default token logo: the liquid surface IS the
 *  chart — mint liquid rising to the right with bubbles, flat #97fce4 on the
 *  deep-green tile in the Hyperliquid brand language (no gradients). Shown
 *  wherever a coin has no uploaded image and as the header brand mark. */
import { BRAND_FLAVOR } from "../brand";

/** squidpad default token logo: a flat violet squid on the deep-ink tile. */
const INK_TOKEN_LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
      `<rect width='64' height='64' rx='16' fill='#120e22'/>` +
      `<path d='M32 10 C41 10 47 17 47 26 C47 32 44 36 40 38 L40 44 C40 46 38 47 36.5 46 L34 44 L34 49 C34 51 32.7 52 32 52 C31.3 52 30 51 30 49 L30 44 L27.5 46 C26 47 24 46 24 44 L24 38 C20 36 17 32 17 26 C17 17 23 10 32 10 Z' fill='#a78bfa'/>` +
      `<circle cx='26.5' cy='26' r='3' fill='#120e22'/>` +
      `<circle cx='37.5' cy='26' r='3' fill='#120e22'/>` +
      `</svg>`,
  );

/** squidpad brand mark: the squid coin. */
const INK_BRAND_MARK =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
      `<rect width='64' height='64' rx='16' fill='#120e22'/>` +
      `<circle cx='32' cy='32' r='23' fill='none' stroke='#a78bfa' stroke-width='3.6'/>` +
      `<path d='M32 18 C38.5 18 43 23 43 29.5 C43 33.8 40.8 36.7 38 38.2 L38 42 C38 43.5 36.5 44.2 35.4 43.4 L33.6 42 L33.6 45.4 C33.6 46.8 32.6 47.5 32 47.5 C31.4 47.5 30.4 46.8 30.4 45.4 L30.4 42 L28.6 43.4 C27.5 44.2 26 43.5 26 42 L26 38.2 C23.2 36.7 21 33.8 21 29.5 C21 23 25.5 18 32 18 Z' fill='#a78bfa'/>` +
      `<circle cx='28' cy='29' r='2.2' fill='#120e22'/>` +
      `<circle cx='36' cy='29' r='2.2' fill='#120e22'/>` +
      `</svg>`,
  );

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

export const DEFAULT_TOKEN_LOGO = BRAND_FLAVOR === "ink" ? INK_TOKEN_LOGO : HYPER_TOKEN_LOGO;
export const BRAND_MARK = BRAND_FLAVOR === "ink" ? INK_BRAND_MARK : HYPER_BRAND_MARK;
