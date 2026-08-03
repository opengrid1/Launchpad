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
  return IS_RH ? <WingmanDocs /> : <LegacyDocs />;
}

/** Pair=reward launchpad docs (Robinhood Chain). */
function WingmanDocs() {
  const rh = v4Client.v4;
  const contracts: { name: string; address: string; note: string }[] = [
    { name: "Factory", address: rh.factory, note: "Launches, pools, and the $3k single-sided seed" },
    { name: "Hook", address: rh.hook, note: "Collects trade fees and splits them 80/20" },
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

      <Section title="The wingman model">
        <p>
          Every coin launches paired with a <em>wingman</em>: any token you choose — a tokenized
          stock (NVDA, TSLA, …), another meme coin, or ETH. The pair token is the market your coin
          trades against <b>and</b> the money its holders earn. Hold the coin, and every trade pays
          you in its wingman.
        </p>
        <Facts
          rows={[
            ["Pair token", "any stock · meme · ETH — creator's choice"],
            ["Holder rewards", "paid in the pair token"],
            ["Rewards start", "from the very first trade"],
          ]}
        />
      </Section>

      <Section title="Launching">
        <p>
          Launching is free; you pay only gas. One transaction deploys your token, creates a real
          Uniswap V4 pool against your chosen pair token, seeds the full supply single-sided, and
          opens trading immediately.
        </p>
        <Facts
          rows={[
            ["Total supply", "1,000,000,000 (fixed)"],
            ["Starting market cap", "≈ $3,000 (fixed)"],
            ["Upfront liquidity", "None required"],
            ["Trade tax", "0–10%, set by creator at launch"],
          ]}
        />
      </Section>

      <Section title="Trading">
        <p>
          Buys and sells are one tap in plain ETH. The router wraps your ETH and routes it through
          official Uniswap pools into the pair token, then into your coin — and back out again on
          sells. You never need to hold the pair token to trade.
        </p>
      </Section>

      <Section title="Fees and rewards">
        <p>
          The trade tax is skimmed by the pool's hook on every swap, so it applies to every trade,
          including ones routed directly by bots or aggregators. Accrued fees are normalized into
          the pair token on each harvest and split two ways — there is no protocol cut.
        </p>
        <Facts
          rows={[
            ["Holders", "80% · paid in the pair token, pro-rata"],
            ["Creator", "20% · paid in the pair token"],
            ["Claiming", "one tap on the token page, any time"],
          ]}
        />
        <p>
          Rewards accrue per wallet with O(1) accounting: buying, selling or transferring settles
          your pending rewards first, so nothing is ever lost or diluted retroactively.
        </p>
      </Section>

      <Section title="Contracts">
        <p>The protocol is immutable: ownership is renounced at deploy time.</p>
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
