import type { ReactNode } from 'react'
import { explorerAddress } from '../lib/chain'
import { LAUNCHPAD, SWAP_ROUTER, WHYPE } from '../lib/contracts'

const SPEC: ReadonlyArray<readonly [string, string]> = [
  ['Network', 'HyperEVM mainnet (chain 999)'],
  ['Venue', 'HyperSwap V3 · 1% fee tier'],
  ['Start market cap', '$4,000 (HyperCore oracle)'],
  ['Supply', '1,000,000,000 · 100% pooled · single-sided'],
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

const STEPS: ReadonlyArray<readonly [string, string]> = [
  ['Describe the token', 'Pick a name, symbol, image, and description. Add socials and a fee payout wallet or X handle if you want.'],
  ['Sign one transaction', 'Hyprpad mints the full supply, creates the HyperSwap V3 pool, and locks the liquidity — all atomically.'],
  ['Trading goes live', 'The moment the transaction confirms, anyone can buy or sell against the pool. Price discovery starts immediately.'],
  ['Earn and claim', 'You collect 70% of every trade fee. Claim your share in native HYPE from the token page whenever you like.'],
]

const FAQ: ReadonlyArray<readonly [string, string]> = [
  ['Is there a bonding curve or presale?', 'No. The token and its HyperSwap V3 pool ship in a single transaction and trade at a real market price from block one.'],
  ['Where does the initial price come from?', 'The pool opens single-sided around a $4,000 starting market cap, priced in HYPE via the HyperCore oracle.'],
  ['How do creator fees work?', 'Every trade pays the 1% pool fee. Of the fees the launchpad collects, 70% accrue to the creator and 30% to the protocol. Creators claim in native HYPE.'],
  ['Can I change where fees go?', 'Yes. The creator role — the address that receives fees — is transferable, so you can route earnings to another wallet.'],
  ['Where is the token image and metadata stored?', 'Fully on-chain as a base64 data URI. There is no IPFS pin or backend that can disappear.'],
  ['Is it audited?', 'No. The contracts are an unaudited reference implementation. Interacting with them is at your own risk.'],
]

export function Docs() {
  return (
    <main className="mx-auto mt-10 max-w-2xl pb-10">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Documentation</h1>
      <p className="mt-3 text-sm leading-relaxed text-dim">
        Hyprpad is a token launchpad on HyperEVM built to crowdfund projects in the Hyperliquid ecosystem — AI trading
        agents, tooling, and infrastructure. A project launches a token, the community funds it by trading, and the
        creator earns an ongoing 70% of every trade to finance development.
      </p>

      <Section title="How it works">
        <ol className="space-y-3">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="flex gap-3.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accsoft font-mono text-xs font-bold text-acc">
                {i + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold text-fg">{title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-dim">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Trading">
        <p>
          Because each token launches straight into a HyperSwap V3 pool, anyone can buy or sell instantly at the
          prevailing price. Buys swap HYPE for the token; sells swap the token back to HYPE. Price discovery is
          continuous and set by real order flow — there is no curve or schedule pushing the price.
        </p>
        <p>
          The trade panel on each token page quotes your output live, lets you set slippage, and handles token approval
          for sells. Set a slippage tolerance you are comfortable with on low-liquidity tokens.
        </p>
      </Section>

      <Section title="Fees & creator rewards">
        <p>
          Every swap pays the pool's 1% fee. Hyprpad splits the fees it collects <strong className="text-fg">70% to the
          token creator</strong> and 30% to the protocol. Creator fees accrue continuously and are claimed in native
          HYPE from the token page — collecting realizes any pool fees into the split, then sends your share to your
          wallet.
        </p>
        <p>
          The creator role is transferable, so earnings can be routed to a different wallet at any time. This is the
          basis for the upcoming identity-linked model where fees can be directed to a chosen wallet or X account.
        </p>
      </Section>

      <Section title="For creators">
        <ul className="list-disc space-y-2 pl-5">
          <li>You don't need to supply any HYPE to launch — 100% of the supply is pooled single-sided.</li>
          <li>An optional dev buy lets you take the first position in your own token at launch.</li>
          <li>Claim accrued fees in HYPE anytime; there is no vesting or lockup on your rewards.</li>
          <li>Transfer the creator role to move where future fees are paid.</li>
        </ul>
      </Section>

      <Section title="For traders">
        <ul className="list-disc space-y-2 pl-5">
          <li>Connect a wallet, open a token, and buy with HYPE or sell back to HYPE directly through HyperSwap V3.</li>
          <li>Watch market cap and the live chart — every token is a real market and can move sharply.</li>
          <li>Liquidity is locked in the launchpad position, but the owner can withdraw it via an admin call; withdrawn tokens show as <em>delisted</em>.</li>
        </ul>
      </Section>

      <Section title="Specifications">
        <div className="-mx-1">
          {SPEC.map(([k, v], i) => (
            <div key={k} className={`flex items-center justify-between gap-3 py-2.5 ${i > 0 ? 'border-t border-hair' : ''}`}>
              <span className="text-sm text-dim">{k}</span>
              <span className="text-right font-mono text-sm text-fg">{v}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Security & risks">
        <ul className="list-disc space-y-2 pl-5">
          <li>The contracts are an <strong className="text-fg">unaudited</strong> reference implementation and may contain bugs.</li>
          <li>Tokens are created by third parties, can lose all value, and may be illiquid.</li>
          <li>The launchpad owner can withdraw a pool's liquidity, which disables trading for that token.</li>
          <li>Always verify the token address and never trade more than you can afford to lose.</li>
        </ul>
      </Section>

      <h2 className="mt-10 text-sm font-semibold text-fg">Contracts</h2>
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

      <Section title="FAQ">
        <div className="-mx-1">
          {FAQ.map(([q, a], i) => (
            <div key={q} className={`py-3.5 ${i > 0 ? 'border-t border-hair' : ''}`}>
              <p className="text-sm font-semibold text-fg">{q}</p>
              <p className="mt-1 text-sm leading-relaxed text-dim">{a}</p>
            </div>
          ))}
        </div>
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <div className="mt-3 space-y-2.5 text-sm leading-relaxed text-dim">{children}</div>
    </section>
  )
}

function shorten(addr: string) {
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`
}
