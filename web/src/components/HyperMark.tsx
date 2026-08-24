/** Hyperliquid chain badge: mint disc with the two-blob wave glyph, used on
 *  token avatars and wallet rows in place of the Base disc. */
export function HyperMark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#97fce4" />
      <path
        d="M14.5 10.5c3.3 0 5 2.6 5 5.5 0 2.2 1 4 3.5 4s5.5-1.8 5.5 2c0 4.5-2.5 7.5-6 7.5-3.3 0-5-2.6-5-5.5 0-2.2-1-4-3.5-4s-5.5 1.8-5.5-2c0-4.5 2.7-7.5 6-7.5Z"
        fill="#04231d"
        transform="rotate(-45 20 20)"
      />
    </svg>
  );
}
