import { explorerAddress } from '../lib/chain'
import { LAUNCHPAD, SWAP_ROUTER, WHYPE } from '../lib/contracts'

const CONTRACTS: ReadonlyArray<readonly [string, string]> = [
  ['Flatline Launchpad', LAUNCHPAD],
  ['HyperSwap V3 SwapRouter', SWAP_ROUTER],
  ['HyperSwap V3 PositionManager', '0x6eDA206207c09e5428F281761DdC0D300851fBC8'],
  ['WHYPE', WHYPE],
]

export function Docs() {
  return (
    <main className="mx-auto mt-10 max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-fg">Docs</h1>

      <Section title="What is Flatline">
        <p>
          Flatline launches tokens directly onto HyperSwap V3. There is no bonding curve and no presale: every token is
          created together with its liquidity pool in a single transaction, and trading is live from the first block.
        </p>
      </Section>

      <Section title="Launching">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Every launch starts at the same fixed market cap (currently <Mono>$4,000</Mono>), converted to HYPE at launch
            time using the HyperCore oracle.
          </li>
          <li>
            100% of the supply is deposited as single-sided liquidity. There is no team allocation — if the creator wants
            tokens, they use the dev buy, which executes in the same transaction, before anyone else can trade.
          </li>
          <li>Token metadata (image, description, links) is stored on-chain in the token contract itself as a data URI.</li>
          <li>
            Launching requires a HyperEVM big block (~6M gas). The Launch page handles this automatically: your wallet
            signs a free HyperCore message to switch block modes, the launch confirms in the next big block (~1 minute),
            and you switch back after. Your wallet needs an existing HyperCore account for this signature.
          </li>
        </ul>
      </Section>

      <Section title="Trading">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            All swaps route through the canonical HyperSwap V3 pool (1% fee tier). Trading on Flatline and trading on
            HyperSwap directly are the same thing — same pool, same price.
          </li>
          <li>HYPE paid by buyers accumulates inside the liquidity position as locked principal.</li>
        </ul>
      </Section>

      <Section title="Creator rewards">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            The 1% pool fee is the revenue. It is split <Mono>70%</Mono> to the token's creator and <Mono>30%</Mono> to
            the platform. The split is a constant in the contract and cannot be changed.
          </li>
          <li>
            <Mono>collectFees</Mono> is permissionless — anyone can trigger it from the token page. It pulls accrued fees
            from the position and credits both sides. Creators then claim in native HYPE.
          </li>
          <li>
            The creator role (and its future fee stream) is transferable via <Mono>transferCreator</Mono>.
          </li>
        </ul>
      </Section>

      <Section title="Liquidity & trust">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            The LP position NFT is held by the launchpad contract, which has no public withdraw function — liquidity
            cannot be pulled by creators.
          </li>
          <li>
            Full disclosure: the platform owner has an admin function (<Mono>withdrawPosition</Mono>) that can withdraw a
            launch's LP position. It settles the fee split first and is permanently visible on-chain via the{' '}
            <Mono>PositionWithdrawn</Mono> event. Tokens whose liquidity was withdrawn are marked delisted on the board.
          </li>
          <li>The contracts are a reference implementation and have not been independently audited.</li>
        </ul>
      </Section>

      <Section title="Contracts · HyperEVM mainnet · chain 999">
        <div className="overflow-hidden rounded-2xl bg-panel ring-1 ring-hair">
          {CONTRACTS.map(([name, addr], i) => (
            <a
              key={addr}
              href={explorerAddress(addr)}
              target="_blank"
              rel="noreferrer"
              className={`flex flex-col gap-0.5 px-4 py-3 no-underline transition-colors hover:bg-panel2 sm:flex-row sm:items-center sm:justify-between ${
                i > 0 ? 'border-t border-hair' : ''
              }`}
            >
              <span className="text-sm font-semibold text-fg">{name}</span>
              <span className="font-mono text-xs text-ghost">{addr} ↗</span>
            </a>
          ))}
        </div>
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-base font-bold text-fg">{title}</h2>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-dim">{children}</div>
    </section>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-accsoft px-1.5 py-0.5 font-mono text-[12px] text-acc">{children}</span>
}
