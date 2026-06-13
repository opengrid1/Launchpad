import { explorerAddress } from '../lib/chain'
import { LAUNCHPAD, SWAP_ROUTER, WHYPE } from '../lib/contracts'

const SPEC: ReadonlyArray<readonly [string, string]> = [
  ['Venue', 'HyperSwap V3 · 1% fee tier'],
  ['Start market cap', '$4,000 (HyperCore oracle)'],
  ['Supply', '100% pooled · single-sided'],
  ['Fee split', '70% creator · 30% protocol'],
  ['Liquidity', 'Locked in launchpad position'],
  ['Metadata', 'On-chain data URI'],
]

const CONTRACTS: ReadonlyArray<readonly [string, string]> = [
  ['Launchpad', LAUNCHPAD],
  ['SwapRouter', SWAP_ROUTER],
  ['PositionManager', '0x6eDA206207c09e5428F281761DdC0D300851fBC8'],
  ['WHYPE', WHYPE],
]

export function Docs() {
  return (
    <main className="mx-auto mt-10 max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Docs</h1>

      <section className="elev mt-6 overflow-hidden rounded-2xl ring-1 ring-hair">
        {SPEC.map(([k, v], i) => (
          <div
            key={k}
            className={`flex items-center justify-between px-4 py-3 ${i > 0 ? 'border-t border-hair' : ''}`}
          >
            <span className="text-sm text-dim">{k}</span>
            <span className="font-mono text-sm text-fg">{v}</span>
          </div>
        ))}
      </section>

      <h2 className="mt-9 text-sm font-semibold text-fg">Notes</h2>
      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-dim">
        <li>No bonding curve, no presale. Token and pool ship in one transaction.</li>
        <li>Creator fees claim in native HYPE. The creator role is transferable.</li>
        <li>Owner can withdraw a pool's liquidity via an on-chain admin call; withdrawn tokens show as delisted.</li>
        <li>Unaudited reference implementation.</li>
      </ul>

      <h2 className="mt-9 text-sm font-semibold text-fg">Contracts</h2>
      <section className="elev mt-3 overflow-hidden rounded-2xl ring-1 ring-hair">
        {CONTRACTS.map(([name, addr], i) => (
          <a
            key={addr}
            href={explorerAddress(addr)}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center justify-between gap-3 px-4 py-3 no-underline transition-colors hover:bg-panel2 ${
              i > 0 ? 'border-t border-hair' : ''
            }`}
          >
            <span className="text-sm text-dim">{name}</span>
            <span className="truncate font-mono text-xs text-ghost">{shorten(addr)} ↗</span>
          </a>
        ))}
      </section>
    </main>
  )
}

function shorten(addr: string) {
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`
}
