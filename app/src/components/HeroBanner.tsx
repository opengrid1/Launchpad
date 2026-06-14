/** Hero banner with an animated perspective grid background. */
export function HeroBanner() {
  return (
    <section className="relative mt-7 overflow-hidden rounded-2xl border border-hair bg-panel">
      <div className="hero-grid" aria-hidden />
      {/* soft cyan glow above the grid horizon */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgba(63,224,207,0.12), transparent 70%)' }}
        aria-hidden
      />
      <div className="relative px-6 py-12 text-center sm:py-16">
        <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-fg sm:text-5xl">
          Launch coins <span className="text-acc">/</span> keep the fees
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-dim sm:text-base">
          Spin up a <span className="font-semibold text-fg">live market</span> in one click and earn{' '}
          <span className="font-semibold text-acc">70% of every trade</span> — routed to the wallet or X account you choose.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <a href="#/launch" className="btn-primary rounded-xl px-6 py-2.5 text-sm font-semibold no-underline">
            Launch a token
          </a>
          <a
            href="#/how-it-works"
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-dim no-underline ring-1 ring-hair2 transition hover:text-fg"
          >
            How it works
          </a>
        </div>
      </div>
    </section>
  )
}
