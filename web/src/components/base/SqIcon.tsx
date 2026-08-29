/**
 * squidpad icon set — clean single-weight line icons (Lucide geometry, MIT),
 * drawn on a 24 grid with a 2px stroke and round joins/caps. Used by the
 * squidpad app shell (top nav, mobile tab bar, launch FAB, search). Kept
 * separate from KoiIcon (filled Material Symbols) so the squidpad brand reads
 * as a crisp outline set while the other brands keep their filled glyphs.
 */
const PATHS: Record<string, JSX.Element> = {
  // Markets — candlestick chart with axes (trading-native, distinct from analytics)
  "markets": (
    <>
      <path d="M9 5v4" />
      <rect x="7" y="9" width="4" height="6" rx="1" />
      <path d="M9 15v2" />
      <path d="M17 3v2" />
      <rect x="15" y="5" width="4" height="8" rx="1" />
      <path d="M17 13v3" />
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    </>
  ),
  // Analytics — trending-up line with arrowhead
  "analytics": (
    <>
      <path d="M16 7h6v6" />
      <path d="m22 7-8.5 8.5-5-5L2 17" />
    </>
  ),
  // Rewards — trophy
  "rewards": (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </>
  ),
  // Wallet
  "wallet": (
    <>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </>
  ),
  // Launch — rocket
  "rocket": (
    <>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </>
  ),
  // Search
  "search": (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
};

export type SqIconName = keyof typeof PATHS;

export function SqIcon({
  name,
  size = 22,
  className,
  style,
}: {
  name: SqIconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
