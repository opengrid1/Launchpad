/**
 * koi.fun icon set — original hand-drawn 24px glyphs on a shared grammar:
 * 2.2 stroke, round caps and joins, soft geometry, readable at 20-24px.
 * Color rides on currentColor; the standalone .svg files live in
 * public/icons/koi/ and share this exact geometry.
 */
const BODIES = {
  rocket: (
    <>
      <path d="M18.8 5.2c-4.1.4-7.4 2.2-9.8 5.2l-1.4 1.8 4.2 4.2 1.8-1.4c3-2.4 4.8-5.7 5.2-9.8Z" />
      <circle cx="14.3" cy="9.7" r="1.6" />
      <path d="M8.3 15.7 5 19M6.9 13.5l-2.4.7M10.5 17.1l-.7 2.4" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6.5" width="18" height="13" rx="3.5" />
      <path d="M21 11.5h-3.5a2 2 0 0 0 0 4H21" />
    </>
  ),
  flame: (
    <>
      <path d="M12 3.5C9 7.3 6.8 10 6.8 13.4a5.2 5.2 0 0 0 10.4 0C17.2 10 15 7.3 12 3.5Z" />
      <path d="M12 18.4a2.6 2.6 0 0 1-2.6-2.6c0-1.2 1-2.4 2.6-3.6 1.6 1.2 2.6 2.4 2.6 3.6a2.6 2.6 0 0 1-2.6 2.6Z" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.5 4h9v4.8a4.5 4.5 0 0 1-9 0V4Z" />
      <path d="M7.5 5.5H5V7a2.6 2.6 0 0 0 2.6 2.6M16.5 5.5H19V7a2.6 2.6 0 0 1-2.6 2.6" />
      <path d="M12 13.3V16" />
      <path d="M8.5 20h7M10 16h4" />
    </>
  ),
  "trending-up": (
    <>
      <path d="M4 16.5 9 11l3.5 3L19 7.5" />
      <path d="M14.5 7.5H19V12" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  zap: <path d="M13.2 2.8 5 13h5.4l-.9 8.2L18.9 11h-5.4l.9-8.2Z" />,
  "bar-chart": <path d="M5.5 19.5v-5.5M12 19.5V6.5M18.5 19.5v-9" />,
  "arrow-up": <path d="M12 19V5.5M6 11l6-6 6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  home: (
    <path d="M5 10.3 12 4.7l7 5.6v8.4a1.5 1.5 0 0 1-1.5 1.5h-3v-5a2.5 2.5 0 0 0-5 0v5h-3A1.5 1.5 0 0 1 5 18.7Z" />
  ),
  settings: (
    <>
      <path d="M4 7h8.5M18.5 7H20M4 12h1.5M10.5 12H20M4 17h10.5M19.5 17H20" />
      <circle cx="15.5" cy="7" r="2.1" />
      <circle cx="7.5" cy="12" r="2.1" />
      <circle cx="17" cy="17" r="2.1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5 19.6c.5-3.2 3.3-5.1 7-5.1s6.5 1.9 7 5.1" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  "chevron-down": <path d="m7 10 5 5 5-5" />,
} as const;

export type KoiIconName = keyof typeof BODIES;

export function KoiIcon({ name, size = 22, className, style }: { name: KoiIconName; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      {BODIES[name]}
    </svg>
  );
}
