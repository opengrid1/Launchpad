import type { ReactNode } from 'react'

const UPDATED = 'June 2026'

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto mt-10 max-w-2xl pb-10">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-1 font-mono text-xs text-ghost">Last updated · {UPDATED}</p>
      <div className="mt-8 space-y-8">{children}</div>
    </main>
  )
}

function Block({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-fg">{heading}</h2>
      <div className="mt-2.5 space-y-2 text-sm leading-relaxed text-dim">{children}</div>
    </section>
  )
}

export function Terms() {
  return (
    <Page title="Terms of Service">
      <p className="text-sm leading-relaxed text-dim">
        Hyprpad is a non-custodial interface to smart contracts deployed on HyperEVM. By using it you agree to the terms
        below. If you do not agree, do not use the interface.
      </p>
      <Block heading="No custody, no intermediary">
        <p>
          Hyprpad never holds your funds or private keys. Every action — launching a token, buying, selling, claiming
          fees — is a transaction you sign and broadcast from your own wallet directly to public smart contracts.
        </p>
      </Block>
      <Block heading="No financial advice">
        <p>
          Nothing here is investment, financial, legal, or tax advice. Tokens launched through Hyprpad are created by
          third parties, can lose all value, and may be illiquid. You are solely responsible for evaluating any token
          before trading it.
        </p>
      </Block>
      <Block heading="Creator responsibilities">
        <p>
          If you launch a token you are responsible for its name, metadata, and conduct, and for complying with the laws
          that apply to you. Do not impersonate others or upload infringing or unlawful content.
        </p>
      </Block>
      <Block heading="Unaudited software">
        <p>
          The contracts are an unaudited reference implementation provided “as is,” without warranties of any kind. Smart
          contracts can contain bugs. Interacting with them is at your own risk and may result in total loss of funds.
        </p>
      </Block>
      <Block heading="Limitation of liability">
        <p>
          To the maximum extent permitted by law, the Hyprpad contributors are not liable for any losses arising from use
          of the interface or the underlying contracts.
        </p>
      </Block>
    </Page>
  )
}

export function Privacy() {
  return (
    <Page title="Privacy Policy">
      <p className="text-sm leading-relaxed text-dim">
        Hyprpad is a static, client-side interface. We aim to collect as little as possible.
      </p>
      <Block heading="What we don't collect">
        <p>
          There is no account, no sign-up, and no server-side database. We do not ask for your name, email, or identity,
          and we never have access to your private keys or funds.
        </p>
      </Block>
      <Block heading="On-chain data">
        <p>
          Transactions you submit are recorded permanently on the public HyperEVM blockchain. Wallet addresses and
          activity on a public ledger are inherently public and outside our control.
        </p>
      </Block>
      <Block heading="Third-party services">
        <p>
          The interface reads public market data from GeckoTerminal and connects wallets through Privy. Those providers
          process requests under their own privacy policies. Your wallet provider and RPC endpoint may also see your IP
          address when you broadcast transactions.
        </p>
      </Block>
      <Block heading="Cookies">
        <p>
          We use only the local storage needed to keep your wallet session and interface preferences on your device. No
          advertising or cross-site tracking cookies are set.
        </p>
      </Block>
    </Page>
  )
}

export function Whitepaper() {
  return (
    <Page title="Whitepaper">
      <p className="text-sm leading-relaxed text-dim">
        Hyprpad turns a token launch into a live market. There is no bonding curve and no presale — a token and its
        HyperSwap V3 pool ship in a single transaction, and trading is open from block one.
      </p>
      <Block heading="The launch">
        <p>
          A creator supplies a name, symbol, and metadata. The launchpad mints the full supply, opens a single-sided
          concentrated-liquidity position on HyperSwap V3 (1% fee tier), and locks that liquidity in the launchpad
          contract. The starting market cap is anchored at $4,000 using the HyperCore oracle for the HYPE price.
        </p>
      </Block>
      <Block heading="The market">
        <p>
          Because the token launches straight into a V3 pool, anyone can buy or sell instantly at the prevailing price.
          Price discovery is continuous and set by real order flow, not a scripted curve. Metadata lives on-chain as a
          data URI, so there is no IPFS pin or backend to keep alive.
        </p>
      </Block>
      <Block heading="Fees">
        <p>
          Every trade pays the 1% pool fee. Of the fees the launchpad collects, 70% accrue to the token's creator and
          30% to the protocol. Creators claim their share in native HYPE at any time, and the creator role — the address
          that receives fees — is transferable to another wallet.
        </p>
      </Block>
      <Block heading="Roadmap">
        <p>
          Hyprpad is evolving toward an identity-linked model: launches tied to an X account, fees routable to a chosen
          wallet or handle, and optional crowdfunding for new tokens. These require a contract redeploy and will ship as
          a versioned upgrade.
        </p>
      </Block>
      <p className="rounded-xl bg-panel2/60 p-4 text-xs leading-relaxed text-ghost ring-1 ring-hair">
        This document describes an unaudited reference implementation and is not an offer, solicitation, or promise of
        future returns. Tokens launched on Hyprpad can lose all value.
      </p>
    </Page>
  )
}
