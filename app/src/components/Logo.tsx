/** Hyprpad brand mark — an upward launch arrow rising off a pad, in dark ink on a cyan tile. */
export function Logo({ href = '#/' }: { href?: string }) {
  return (
    <a href={href} className="group flex items-center gap-2.5 no-underline">
      <span className="btn-primary flex h-8 w-8 items-center justify-center rounded-[10px] transition-transform group-hover:-translate-y-0.5">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M10 3.4 L10 12.4" stroke="#04201c" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M6 7.4 L10 3.4 L14 7.4" stroke="#04201c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.2 15.6 H14.8" stroke="#04201c" strokeWidth="2.4" strokeLinecap="round" opacity="0.6" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-fg">Hyprpad</span>
    </a>
  )
}
