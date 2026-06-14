/** Hyprpad brand mark — a solid upward launch arrow on a cyan tile. */
export function Logo({ href = '#/' }: { href?: string }) {
  return (
    <a href={href} className="group flex items-center gap-2.5 no-underline">
      <span className="btn-primary flex h-8 w-8 items-center justify-center rounded-[11px] transition-transform group-hover:-translate-y-0.5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3.6 L19.4 12 L15.1 12 L15.1 20 L8.9 20 L8.9 12 L4.6 12 Z"
            fill="#04201c"
            stroke="#04201c"
            strokeWidth="1.7"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-fg">Hyprpad</span>
    </a>
  )
}
