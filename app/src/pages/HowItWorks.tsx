const STEPS: ReadonlyArray<{ n: string; title: string; body: string; points: readonly string[] }> = [
  {
    n: '01',
    title: 'Create your token',
    body: 'Give your token a name, symbol, image, and description. Add your socials and choose where fees should be paid — a wallet address or an X handle.',
    points: ['1,000,000,000 fixed supply', 'Metadata stored fully on-chain', 'Optional dev buy at launch'],
  },
  {
    n: '02',
    title: 'Launch in one transaction',
    body: 'Hyprpad mints the full supply, opens a HyperSwap V3 pool, and locks the liquidity — all atomically. No bonding curve, no presale, no waiting.',
    points: ['Single-sided liquidity', 'Starts near a $4,000 market cap', 'Liquidity locked in the launchpad'],
  },
  {
    n: '03',
    title: 'Trading goes live',
    body: 'The moment the transaction confirms, your token is a real market. Anyone can buy with HYPE or sell back to HYPE instantly at the live price.',
    points: ['Instant buy & sell', 'Continuous price discovery', 'Live chart and market cap'],
  },
  {
    n: '04',
    title: 'Earn from every trade',
    body: 'You collect 70% of every trade fee for the life of the token. Claim your share in native HYPE from the token page whenever you want — no vesting, no lockup.',
    points: ['70% of all fees to you', 'Paid in native HYPE', 'Payout wallet is transferable'],
  },
]

const DIFF: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'A live market, not a curve',
    body: 'Tokens launch straight into a HyperSwap V3 pool, so the price is set by real trading from block one.',
  },
  {
    title: 'No presale, no gatekeeping',
    body: 'Anyone can launch and anyone can trade. There are no allocations, rounds, or committees to clear.',
  },
  {
    title: 'Crowdfund the ecosystem',
    body: 'Fees fund the builder. It is a market-driven way to back AI agents and projects on Hyperliquid.',
  },
]

export function HowItWorks() {
  return (
    <main className="mx-auto mt-10 max-w-3xl pb-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-acc">How it works</p>
      <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl">
        From idea to live market in one click
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-dim sm:text-base">
        Hyprpad turns a token launch into an open market on HyperEVM. Launch in a single transaction, let the community
        fund it by trading, and earn 70% of every trade to finance what you are building.
      </p>

      {/* steps */}
      <ol className="mt-12 space-y-4">
        {STEPS.map((s) => (
          <li key={s.n} className="elev rounded-2xl p-5 ring-1 ring-hair sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
              <span className="font-mono text-2xl font-semibold text-acc/80 sm:text-3xl">{s.n}</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-fg">{s.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-dim">{s.body}</p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {s.points.map((p) => (
                    <li
                      key={p}
                      className="rounded-lg bg-base px-2.5 py-1.5 font-mono text-[11px] text-dim ring-1 ring-hair"
                    >
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* fee split */}
      <section className="elev mt-12 rounded-2xl p-6 ring-1 ring-hair">
        <h2 className="text-lg font-semibold text-fg">Where the fees go</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-dim">
          Every trade pays the pool's 1% fee. Hyprpad splits the fees it collects between the creator and the protocol.
        </p>
        <div className="mt-5 flex h-3 overflow-hidden rounded-full ring-1 ring-hair">
          <div className="bg-up" style={{ width: '70%' }} />
          <div className="bg-panel2" style={{ width: '30%' }} />
        </div>
        <div className="mt-3 flex justify-between font-mono text-xs">
          <span className="flex items-center gap-1.5 text-up">
            <span className="h-2 w-2 rounded-full bg-up" /> 70% creator
          </span>
          <span className="flex items-center gap-1.5 text-ghost">
            <span className="h-2 w-2 rounded-full bg-panel2 ring-1 ring-hair2" /> 30% protocol
          </span>
        </div>
      </section>

      {/* what's different */}
      <h2 className="mt-12 text-lg font-semibold text-fg">What makes it different</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {DIFF.map((d) => (
          <div key={d.title} className="elev rounded-2xl p-5 ring-1 ring-hair">
            <h3 className="text-sm font-semibold text-fg">{d.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-dim">{d.body}</p>
          </div>
        ))}
      </div>

      {/* cta */}
      <div className="mt-12 flex flex-col items-center gap-4 rounded-2xl border border-hair bg-panel/40 px-6 py-10 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-fg">Ready to launch?</h2>
        <p className="max-w-md text-sm leading-relaxed text-dim">
          Spin up a live market in one click and start earning from every trade.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href="#/launch" className="btn-primary rounded-xl px-6 py-2.5 text-sm font-semibold no-underline">
            Launch a token
          </a>
          <a
            href="#/whitepaper"
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-dim no-underline ring-1 ring-hair2 transition hover:text-fg"
          >
            Read the whitepaper
          </a>
        </div>
      </div>
    </main>
  )
}
