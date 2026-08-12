import { BRAND } from "../lib/brand";
import { env } from "../lib/env";
import { addresses } from "../lib/env";
import { v4Client } from "../lib/client";
import { explorerAddr, shortAddr } from "../lib/format";

const IS_RH = String(import.meta.env.VITE_PROTOCOL ?? "") === "rh-v4";

/**
 * Product documentation: how launches, trading, fees and protection work,
 * plus the protocol contracts. Typography-first, no dashboard.
 */
export function DocsPage() {
  return IS_RH ? <CopairDocs /> : <LegacyDocs />;
}

/** Pair=reward launchpad docs (Robinhood Chain). */
function CopairDocs() {
  const rh = v4Client.v4;
  const contracts: { name: string; address: string; note: string }[] = [
    { name: "Factory", address: rh.factory, note: "Launches, pools, and the $3k single-sided seed" },
    { name: "Hook", address: rh.hook, note: "Skims the 1% fee, applies the sniper schedule, splits 80/15/5" },
    { name: "Router", address: rh.router, note: "One-tap ETH buys and sells, auto-routed through the pair" },
    { name: "Uniswap V4 PoolManager", address: rh.poolManager, note: "Official singleton that holds every pool" },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">Docs</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        Everything on {BRAND.name} runs on-chain on {env.chainName}. This page explains the fixed
        protocol rules.
      </p>

      <Section title="The uhood model: launch to earn">
        <p>
          Every coin trades against ETH with a flat 1% fee, and launching is how you earn:
          80% of every trade fee is paid to the creator in ETH, automatically. 5% of every fee,
          plus everything snipers overpay in the first seconds, builds a real bid wall: a live
          buy order sitting just under the market that climbs as the price climbs.
        </p>
        <Facts
          rows={[
            ["Pair", "ETH, every coin"],
            ["Creator earnings", "80% of every fee, in ETH"],
            ["Bid wall", "5% of fees + all sniper premium"],
          ]}
        />
      </Section>

      <Section title="Launching">
        <p>
          Launching is free; you pay only gas. One transaction deploys your token, creates a real
          Uniswap V4 pool against ETH, seeds the full supply single-sided, and opens trading
          immediately. You can attach an initial buy to the same transaction: it fills before
          anyone else can trade and pays only the flat 1% fee, never the sniper rate.
        </p>
        <Facts
          rows={[
            ["Total supply", "1,000,000,000 (fixed)"],
            ["Starting market cap", "≈ $3,000 (fixed)"],
            ["Upfront liquidity", "None required"],
            ["Initial buy", "Optional, atomic, sniper-proof"],
            ["Trade fee", "1%, flat, forever"],
          ]}
        />
      </Section>

      <Section title="Trading">
        <p>
          Buys and sells are one tap in plain ETH, straight through the coin's own pool. Trades
          in the first 5 seconds pay 15%, then 5% until second 15, then 1% from there on; the
          early premium is not kept by anyone, it becomes the coin's bid wall.
        </p>
      </Section>

      <Section title="The diamond curve">
        <p>
          Buying is never taxed. Selling early is: every wallet carries an on-chain holding
          clock, and sells pay an extra fee that decays with time held. What early sellers pay
          is converted to ETH at every harvest and split across everyone still holding, pro
          rata. Jeets pay diamond hands, automatically.
        </p>
        <Facts
          rows={[
            ["Held under 1 hour", "+9% on sells"],
            ["Under 6 hours", "+4%"],
            ["Under 24 hours", "+1.5%"],
            ["24 hours and beyond", "+0%"],
            ["Where it goes", "To remaining holders, in ETH"],
          ]}
        />
        <p>
          Moving coins to a fresh wallet resets that wallet's clock to zero, so the tax cannot
          be dodged by wallet-hopping.
        </p>
      </Section>

      <Section title="Fees and rewards">
        <p>
          The fee is skimmed by the pool's hook on every swap, so it applies to every trade,
          including ones routed directly by bots or aggregators. A keeper harvests every few
          minutes: fees are normalized to ETH, split, and the bid wall is re-placed just under
          the current price. Any coins the wall absorbs are burned on the next bump.
        </p>
        <Facts
          rows={[
            ["Creator", "80% · paid in ETH, every harvest"],
            ["Platform", "15%"],
            ["Bid wall", "5% + sniper premium (15% first 5s, 5% to 15s)"],
          ]}
        />
        <p>
          The wall is real single-sided liquidity owned by the protocol, not a promise: you can
          watch it absorb sells on-chain, and it only ever moves up.
        </p>
      </Section>

      <Section title="Contracts">
        <p>
          The protocol is immutable. The hook has no owner at all: the factory and treasury
          addresses are burned in at deploy and can never be redirected, and factory ownership
          is renounced. Nobody can change the fee split, pause your coin, or touch your pool.
        </p>
        <div className="mt-3 space-y-2">
          {contracts.map((c) => (
            <ContractRow key={c.name} {...c} />
          ))}
        </div>
      </Section>
    </div>
  );
}

/** Original creator-fee launchpad docs (Stable / Arc flavors). */
function LegacyDocs() {
  const contracts: { name: string; address: string; note: string }[] = [
    { name: "LaunchpadFactory", address: addresses.factory, note: "Launches, trading, fee accounting, and owns every V3 position" },
    { name: "TokenDeployer", address: addresses.tokenDeployer, note: "Deploys every token with fixed rules" },
    { name: "WETH", address: addresses.weth, note: "Canonical wrapped native token" },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">Docs</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        Everything on {BRAND.name} runs on-chain on {env.chainName}. This page explains the fixed
        protocol rules.
      </p>

      <Section title="Launching">
        <p>
          Launching is free; you pay only gas. One transaction deploys your token, creates a real
          Uniswap V3 pool at the 1% fee tier, seeds it with the full supply, and opens trading
          immediately. Optionally include an initial buy in the same transaction.
        </p>
        <Facts
          rows={[
            ["Total supply", "1,000,000,000 (fixed)"],
            ["Starting market cap", "$5,000 (fixed)"],
            ["Upfront liquidity", "None required"],
          ]}
        />
      </Section>

      <Section title="Trading and fees">
        <p>
          Every buy and sell through a {BRAND.name} pool pays the token's trade tax, a rate the
          creator picks at launch, from 0% to 10%. The tax is skimmed on the pool itself, so it
          applies to every trade, including ones routed directly by bots or aggregators.
        </p>
        <Facts
          rows={[
            ["Trade tax", "0–10%, set by creator"],
            ["Holders", "50% · paid as the creator's chosen stock"],
            ["Creator", "25% · WETH, claimable"],
            ["Protocol", "25% · WETH"],
          ]}
        />
      </Section>

      <Section title="Contracts">
        <p>All protocol contracts are on Blockscout.</p>
        <div className="mt-3 space-y-2">
          {contracts.map((c) => (
            <ContractRow key={c.name} {...c} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function ContractRow({ name, address, note }: { name: string; address: string; note: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-panel px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{name}</p>
        <p className="truncate text-xs text-ink-3">{note}</p>
      </div>
      {explorerAddr(address) ? (
        <a
          href={explorerAddr(address)!}
          target="_blank"
          rel="noreferrer"
          className="tnum shrink-0 text-xs font-medium text-ink underline underline-offset-2"
        >
          {shortAddr(address)}
        </a>
      ) : (
        <span className="tnum shrink-0 text-xs text-ink-2">{shortAddr(address)}</span>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-6 text-ink-2">{children}</div>
    </section>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-3 space-y-1.5 border-l-2 border-accent pl-4">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 text-sm">
          <dt className="text-ink-3">{k}</dt>
          <dd className="tnum text-right font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
