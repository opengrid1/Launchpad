/** Hyprpad brand mark — rendered PNG icon (see scripts/genlogo.py). */
export function Logo({ href = '#/' }: { href?: string }) {
  return (
    <a href={href} className="group flex items-center gap-2.5 no-underline">
      <img
        src="/logo.png"
        width="32"
        height="32"
        alt="Hyprpad"
        className="h-8 w-8 rounded-[11px] transition-transform group-hover:-translate-y-0.5"
      />
      <span className="text-[15px] font-semibold tracking-tight text-fg">Hyprpad</span>
    </a>
  )
}
