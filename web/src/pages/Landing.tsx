import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTokens } from "@launchpad/sdk/react";

import { TokenLogo } from "../components/TokenTable";
import { Badge, Button } from "../components/ui";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { compact, fmtPct, fmtUsd, fmtWei } from "../lib/format";

export function Landing() {
  const { data: stats } = useQuery({
    queryKey: ["platform-stats"],
    queryFn: () => client.getPlatformStats(),
    refetchInterval: 30_000,
    retry: 1,
  });
  const { data: trending } = useTokens(client, { sort: "volume", limit: 4 });

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-4 pb-20 pt-20 text-center sm:pt-28">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          Live on {env.chainName}
        </p>
        <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-6xl">
          Launch tokens on Robinhood Chain
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-ink-2 sm:text-lg">
          One transaction deploys your token into a real Uniswap V3 pool with trading enabled
          instantly. Anti-whale protection guards the early market, then lifts itself on-chain.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/create">
            <Button className="px-6 py-3 text-base">Create Token</Button>
          </Link>
          <Link to="/markets">
            <Button variant="ghost" className="px-6 py-3 text-base">
              Explore Tokens
            </Button>
          </Link>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-edge bg-panel/50">
        <dl className="mx-auto grid max-w-5xl grid-cols-2 gap-y-6 px-4 py-8 text-center sm:grid-cols-4">
          <Stat label="Tokens launched" value={stats ? compact(stats.totalLaunches) : "-"} />
          <Stat
            label="Total volume"
            value={stats ? `${fmtWei(stats.totalVolumeWei)} ${env.nativeSymbol}` : "-"}
          />
          <Stat
            label="Paid to creators"
            value={stats ? `${fmtWei(stats.creatorPayoutsWei)} ${env.nativeSymbol}` : "-"}
          />
          <Stat label="Creator fee share" value="80%" />
        </dl>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-4 py-20">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Real markets from block one
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-10 sm:grid-cols-3">
          <Step
            n="01"
            title="Launch in one transaction"
            body="Your ERC-20 deploys, a Uniswap V3 pool is created and seeded with your liquidity, and trading opens immediately. No bonding curve, no waiting room, nothing simulated."
          />
          <Step
            n="02"
            title="Protected early market"
            body="Max transaction, max wallet and an optional buy cooldown stop whales from owning the launch. At a 40,000 USD market cap the token removes its own limits, permanently."
          />
          <Step
            n="03"
            title="Earn from every trade"
            body="80% of the 3% trading fee accrues to you on-chain with every buy and sell. Track earnings live on your dashboard and withdraw them with one click."
          />
        </div>
      </section>

      {/* Trending */}
      {trending && trending.length > 0 ? (
        <section className="mx-auto max-w-5xl px-4 pb-20">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-ink">Trending</h2>
            <Link to="/markets" className="text-sm font-medium text-accent hover:text-accent-2">
              All markets
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {trending.map((t) => (
              <Link
                key={t.address}
                to={`/t/${t.address}`}
                className="flex items-center justify-between rounded-2xl border border-edge bg-panel px-4 py-3.5 transition-colors hover:border-edge-2"
              >
                <span className="flex items-center gap-3">
                  <TokenLogo token={t} size={36} />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {t.symbol}
                      {t.limitsActive ? <Badge tone="amber">Protected</Badge> : null}
                    </span>
                    <span className="text-xs text-ink-3">{t.name}</span>
                  </span>
                </span>
                <span className="text-right">
                  <span className="tnum block text-sm font-semibold text-ink">
                    {fmtUsd(t.priceUsd)}
                  </span>
                  <span
                    className={`tnum text-xs font-medium ${
                      t.priceChange24hPct == null
                        ? "text-ink-3"
                        : t.priceChange24hPct >= 0
                          ? "text-up"
                          : "text-down"
                    }`}
                  >
                    {fmtPct(t.priceChange24hPct)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Closing CTA */}
      <section className="border-t border-edge">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-16 text-center">
          <h2 className="max-w-lg text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Your token could be trading in the next block
          </h2>
          <Link to="/create">
            <Button className="px-6 py-3 text-base">Create Token</Button>
          </Link>
          <p className="max-w-md text-xs leading-5 text-ink-3">
            Real contracts, real wallets, real Uniswap V3 pools. Liquidity is protocol-managed and
            every action is verifiable on-chain.
          </p>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{label}</dt>
      <dd className="tnum mt-1.5 text-2xl font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <p className="tnum text-sm font-semibold text-accent">{n}</p>
      <h3 className="mt-2 text-base font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-ink-2">{body}</p>
    </div>
  );
}
