import type { Route } from '../App'
import { WALLET, eth } from '../data/offerings'
import { ParGlyph } from './ParLine'

const TODAY = new Date('2026-06-17T00:00:00').toLocaleDateString('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

export function Masthead({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  const tab = route.page === 'issue' ? 'issue' : 'board'
  return (
    <header className="border-b-2 border-ink">
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <button onClick={() => onNavigate({ page: 'board' })} className="flex cursor-pointer items-center gap-2.5 text-left">
          <ParGlyph size={26} />
          <span className="font-serif text-[27px] font-semibold leading-none tracking-[-0.01em]">Par</span>
          <span className="hidden border-l border-rule-2 pl-2.5 font-mono text-[10px] uppercase leading-[1.25] tracking-[0.14em] text-ink-2 sm:block">
            Fixed-price
            <br />
            offerings
          </span>
        </button>

        <div className="flex items-center gap-4">
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2 md:inline">{TODAY}</span>
          <span className="hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2 sm:inline-flex">
            <span className="inline-block h-[7px] w-[7px] rounded-[1px] bg-pos" />
            Ethereum mainnet
          </span>
          <button className="cursor-pointer rounded-[6px] bg-ink px-3 py-1.5 text-left font-mono text-[12px] leading-[1.25] text-paper transition hover:opacity-90">
            <span className="block">{WALLET.address}</span>
            <span className="block text-[10px] text-paper/55">{eth(WALLET.balanceEth)} ETH</span>
          </button>
        </div>
      </div>

      <nav className="flex items-center gap-6 pb-2">
        {(
          [
            ['Board', 'board'],
            ['Issue', 'issue'],
          ] as const
        ).map(([label, key]) => (
          <button
            key={key}
            onClick={() => onNavigate(key === 'issue' ? { page: 'issue' } : { page: 'board' })}
            className={`-mb-[2px] cursor-pointer border-b-2 pb-1.5 font-mono text-[12px] uppercase tracking-[0.12em] transition ${
              tab === key ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
  )
}
