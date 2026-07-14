import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTokens } from "@launchpad/sdk/react";

import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtWei, compact } from "../lib/format";
import { TokenTable } from "../components/TokenTable";
import { Button, Card, CardHeader } from "../components/ui";

type Sort = "new" | "volume" | "marketCap" | "featured";

const sortTabs: { key: Sort; label: string }[] = [
  { key: "new", label: "Newest" },
  { key: "volume", label: "Top volume" },
  { key: "marketCap", label: "Market cap" },
  { key: "featured", label: "Featured" },
];

export function Explore() {
  const [sort, setSort] = useState<Sort>("new");
  const { data: tokens, loading } = useTokens(client, { sort, limit: 100 });
  const { data: stats } = useQuery({
    queryKey: ["platform-stats"],
    queryFn: () => client.getPlatformStats(),
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <section className="mb-8 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Markets</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-ink-2">
            Every token here trades in a real Uniswap V3 pool from the moment it launches. New
            tokens carry anti-whale limits until they reach a 40,000 USD market cap, then trade
            without restriction.
          </p>
        </div>
        <Link to="/create">
          <Button className="whitespace-nowrap">Launch a token</Button>
        </Link>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tokens launched" value={stats ? compact(stats.totalLaunches) : "-"} />
        <Stat
          label="Total volume"
          value={stats ? `${fmtWei(stats.totalVolumeWei)} ${env.nativeSymbol}` : "-"}
        />
        <Stat
          label="24h volume"
          value={stats ? `${fmtWei(stats.volume24hWei)} ${env.nativeSymbol}` : "-"}
        />
        <Stat
          label="Paid to creators"
          value={stats ? `${fmtWei(stats.creatorPayoutsWei)} ${env.nativeSymbol}` : "-"}
        />
      </section>

      <Card>
        <CardHeader
          title="All markets"
          right={
            <div className="flex items-center gap-1">
              {sortTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setSort(tab.key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                    sort === tab.key ? "bg-panel-2 text-ink" : "text-ink-3 hover:text-ink-2"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          }
        />
        <TokenTable tokens={tokens} loading={loading} />
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-edge bg-panel px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink-3">{label}</p>
      <p className="tnum mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
