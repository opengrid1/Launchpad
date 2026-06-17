/**
 * The single diagram in the product. It argues the thesis instead of
 * decorating: the solid oxblood line is the par price, identical for the
 * first subscriber and the last. Struck faintly behind it is the bonding
 * curve Par refuses to use, where price climbs as the sale fills and early
 * money front-runs everyone after it.
 */
export function ParLine({ width = 132, height = 56 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 132 56" fill="none" role="img" aria-label="A flat par price against a rising bonding curve">
      {/* the curve Par rejects */}
      <path
        d="M8 48 C 44 48, 70 46, 92 30 S 122 8, 126 6"
        stroke="var(--color-ink-3)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 4"
      />
      {/* the par price: one level, everyone */}
      <path d="M8 28 L124 28" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" />
      {/* endpoints, marking that the price does not move */}
      <circle cx="8" cy="28" r="2.4" fill="var(--color-accent)" />
      <circle cx="124" cy="28" r="2.4" fill="var(--color-accent)" />
    </svg>
  )
}

/** Wordmark glyph: the par line, tight. */
export function ParGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 9 C 9 9, 11 6, 15 6" stroke="var(--color-ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1.5 3" />
      <path d="M3 16 L21 16" stroke="var(--color-accent)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}
