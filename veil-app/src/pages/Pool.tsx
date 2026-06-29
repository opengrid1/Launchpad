import type { Page } from '../App'
import { POOLS, RECENT_ACTIVITY } from '../data/pool'

export function Pool({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const totalDeposits = POOLS.reduce((s, p) => s + p.deposits, 0)
  const totalTvl = POOLS.reduce((s, p) => s + p.tvlHype, 0)

  return (
    <main className="rise-in mt-6">
      <h1 className="text-2xl font-bold tracking-tight">Pool</h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-relaxed text-fog-300">
        The bigger each anonymity set, the harder it is to link a withdrawal back to a deposit.
        Here&apos;s what the pools look like right now.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ['Total value locked', `${totalTvl.toLocaleString()} HYPE`],
          ['Deposits all-time', totalDeposits.toLocaleString()],
          ['Active pools', String(POOLS.length)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-void-900 p-5 ring-1 ring-void-700">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fog-500">{k}</span>
            <span className="mt-2 block font-mono text-2xl font-semibold text-iris-300">{v}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-2xl bg-void-900 p-5 ring-1 ring-void-700">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-iris-400">Pools</h2>
          <div className="mt-4 space-y-2.5">
            {POOLS.map((p) => {
              const max = Math.max(...POOLS.map((x) => x.deposits))
              return (
                <div key={p.denomination} className="rounded-xl bg-void-850 p-3.5 ring-1 ring-void-700">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-base font-semibold text-fog-100">
                      {p.denomination} <span className="text-[12px] text-fog-500">HYPE</span>
                    </span>
                    <span className="font-mono text-[13px] text-fog-300">
                      {p.deposits.toLocaleString()} <span className="text-fog-500">in set</span>
                    </span>
                  </div>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-void-900">
                    <div
                      className="h-full rounded-full bg-iris-500"
                      style={{ width: `${(p.deposits / max) * 100}%` }}
                    />
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-fog-500">
                    {p.tvlHype.toLocaleString()} HYPE locked
                  </div>
                </div>
              )
            })}
          </div>
          <button
            onClick={() => onNavigate('deposit')}
            className="mt-5 w-full cursor-pointer rounded-xl bg-iris-500 py-3 text-sm font-bold text-void-950 transition hover:bg-iris-400"
          >
            Deposit into a pool
          </button>
        </section>

        <aside className="h-fit rounded-2xl bg-void-900 p-5 ring-1 ring-void-700">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-iris-400">
            Recent activity
          </h2>
          <ul className="mt-4 space-y-3">
            {RECENT_ACTIVITY.map((a, i) => (
              <li key={i} className="flex items-center gap-3 text-[13px]">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] ${
                    a.kind === 'deposit'
                      ? 'bg-iris-500/15 text-iris-300'
                      : 'bg-mint-500/15 text-mint-400'
                  }`}
                >
                  {a.kind === 'deposit' ? '↓' : '↑'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-fog-100">
                    {a.kind === 'deposit' ? 'Deposit' : 'Withdraw'} · {a.denomination} HYPE
                  </span>
                  <span className="block truncate font-mono text-[11px] text-fog-500">{a.ref}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-fog-500">{a.ageMins}m</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] leading-relaxed text-fog-500">
            Anyone can read this — that&apos;s the point. The ledger is public; what stays hidden is
            which deposit pairs with which withdrawal.
          </p>
        </aside>
      </div>
    </main>
  )
}
