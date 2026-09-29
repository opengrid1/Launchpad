/** Estonks icon set: 24px grid, 1.8 stroke, rounded joins, duotone fills. */
const ICONS: Record<string, JSX.Element> = {
  coins: <><path d="M8.39 7.28A6.5 6.5 0 1 1 12.28 15.61" /><circle cx="9.5" cy="14.5" r="6.5" fill="currentColor" fillOpacity=".18" /><path d="M11.6 12.6a2.6 2.6 0 1 0 0 3.8" /></>,
  launch: <><path d="M12 2.5c3 2.4 4.5 5.8 4.5 9.8L14 15h-4l-2.5-2.7c0-4 1.5-7.4 4.5-9.8z" fill="currentColor" fillOpacity=".18" /><circle cx="12" cy="9.5" r="1.7" fill="currentColor" stroke="none" /><path d="M7.6 11.6L5 15.5l3.4-.6M16.4 11.6L19 15.5l-3.4-.6" /><path d="M10.4 17.5L12 21.5l1.6-4" /></>,
  wallet: <><path d="M3.5 8.5A2.5 2.5 0 0 1 6 6h11.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5z" fill="currentColor" fillOpacity=".18" /><path d="M20 11h-4a2 2 0 0 0 0 4h4" fill="currentColor" fillOpacity=".3" /><path d="M6 6l9.5-2.5v2.5" /><circle cx="16.2" cy="13" r=".9" fill="currentColor" stroke="none" /></>,
  stats: <><rect x="4" y="13" width="4" height="7" rx="1.5" fill="currentColor" fillOpacity=".18" /><rect x="10" y="8" width="4" height="12" rx="1.5" fill="currentColor" fillOpacity=".45" /><rect x="16" y="4" width="4" height="16" rx="1.5" fill="currentColor" fillOpacity=".18" /></>,
  tune: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8M4 12h14" /><circle cx="16" cy="7" r="2" fill="currentColor" fillOpacity=".3" /><circle cx="10" cy="17" r="2" fill="currentColor" fillOpacity=".3" /><circle cx="20" cy="12" r="0" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  share: <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M7 8l5-5 5 5" />,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" /></>,
  check: <path d="M5 12l5 5L20 7" />,
  image: <><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="10.5" r="1.8" /><path d="M21 16l-5-4.5-7 7.5" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.7 5.4 3.7 8.5s-1.2 5.9-3.7 8.5c-2.5-2.6-3.7-5.4-3.7-8.5S9.5 6.1 12 3.5z" /></>,
  external: <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />,
  x: <path d="M17.5 3h3.1l-6.8 7.8L21.8 21h-6.3l-4.9-6.4L5 21H1.9l7.3-8.3L1.5 3h6.4l4.4 5.9zm-1.1 16.1h1.7L7 4.8H5.2z" fill="currentColor" stroke="none" />,
  telegram: <path d="M21.6 4.2 18.5 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-7.9c.4-.3-.1-.5-.6-.2L6.4 13.3 1.7 11.8c-1-.3-1-1 .2-1.5L20.3 3c.8-.3 1.6.2 1.3 1.2z" fill="currentColor" stroke="none" />,
  up: <path d="M4 18l4.5-6 3.5 3 4-6 4 4" />,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, className, style }: { name: IconName; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

/** The E mark: three bars, apricot and ivory, in a dark tile. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
      <rect x="1" y="1" width="28" height="28" rx="8" fill="#1c1e24" stroke="rgba(255,255,255,.14)" />
      <rect x="7" y="7" width="4" height="16" rx="2" fill="#f2f2f0" />
      <rect x="7" y="7" width="16" height="4" rx="2" fill="#ffab7a" />
      <rect x="7" y="13" width="11" height="4" rx="2" fill="#f2f2f0" />
      <rect x="7" y="19" width="14" height="4" rx="2" fill="#ffab7a" />
    </svg>
  );
}
