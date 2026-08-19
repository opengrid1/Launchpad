import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";

import { TokenLogo } from "../components/TokenLogo";
import { BASE_STOCKS, baseStockOf } from "../lib/base/stocks";
import { BASE_USDC, BASE_WETH } from "../lib/base/routes";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtUsd, timeAgo } from "../lib/format";
import { isHidden, isImpersonator } from "../lib/hiddenTokens";
import { isOfficial } from "../lib/official";
import { volUsd } from "../components/market/util";

type Sort = "vol" | "mcap" | "new";
const SORTS: { id: Sort; label: string }[] = [
  { id: "vol", label: "Volume" },
  { id: "mcap", label: "Market cap" },
  { id: "new", label: "New" },
];

const rewardLabel = (addr?: string) => {
  if (!addr) return null;
  if (addr.toLowerCase() === BASE_WETH.toLowerCase()) return "ETH";
  if (addr.toLowerCase() === BASE_USDC.toLowerCase()) return "USDC";
  return baseStockOf(addr)?.symbol ?? null;
};
const rewardOf = (t: TokenSummary) => rewardLabel((t.metadata as any)?.rewardStock as string | undefined);

function priceStr(usd: number): string {
  if (!isFinite(usd) || usd <= 0) return "—";
  if (usd >= 1) return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (usd >= 0.001) return `$${usd.toFixed(4)}`;
  if (usd >= 0.0000001) return `$${usd.toFixed(8)}`;
  return `$${usd.toExponential(1)}`;
}

// Design-preview fixtures (only used when VITE_PREVIEW=1 and there is no live data).
const mk = (name: string, symbol: string, reward: string, mcap: number, price: number, chg: number, vol: number, age: number): any => ({
  address: `0x${symbol}${"0".repeat(38)}`.slice(0, 42), name, symbol, marketCapUsd: String(mcap), priceUsd: String(price),
  priceChange24hPct: chg, createdAt: Math.floor(Date.now() / 1000) - age, volume24hWei: String(BigInt(Math.round(vol)) * 10n ** 18n), volumeTotalWei: "0",
  metadata: { rewardStock: (BASE_STOCKS.find((s) => s.symbol === reward)?.address) ?? (reward === "ETH" ? BASE_WETH : BASE_USDC) },
});
const PREVIEW: TokenSummary[] = [
  mk("Meta Moon", "MMOON", "META", 210500, 0.000102, 58.9, 41000, 40000),
  mk("Nvidia Pepe", "NVPEPE", "NVDA", 128400, 0.0000412, 34.2, 33800, 3600),
  mk("Diamond Doge", "DDOGE", "ETH", 92100, 0.0000091, -8.4, 21400, 7200),
  mk("Strategy Stack", "STACK", "MSTR", 77800, 0.0000388, 21.5, 15600, 90000),
  mk("Apple Cat", "ACAT", "AAPL", 61200, 0.0000305, 12.1, 12200, 15000),
  mk("Spy Sniper", "SNIPE", "SPY", 51000, 0.0000254, 6.0, 9800, 120000),
  mk("Money Printer", "PRINT", "USDC", 44300, 0.0000221, 3.7, 7300, 26000),
  mk("Googl Gains", "GGAIN", "GOOGL", 33900, 0.0000169, -2.2, 4100, 62000),
];

/**
 * stonkpad markets — a restrained, data-forward table in the spirit of a real
 * pro-trading interface: near-black, one mint accent, tabular numbers, tight
 * rows. The product's hook (the asset each coin pays) is one quiet column, not
 * a decoration.
 */
export function ExploreStockBoard() {
  const [sort, setSort] = useState<Sort>("vol");
  const [reward, setReward] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const { data: byVolume, loading: lv } = useTokens(client, { sort: "volume", limit: 100 });
  const { data: byNew, loading: ln } = useTokens(client, { sort: "new", limit: 100 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 130);
    return () => window.clearTimeout(id);
  }, [query]);

  const all = useMemo(() => {
    if (env.hideTokens) return [] as TokenSummary[];
    const seen = new Map<string, TokenSummary>();
    for (const t of [...(byVolume ?? []), ...(byNew ?? [])]) {
      if (!isHidden(t.address) && !isImpersonator(t)) seen.set(t.address.toLowerCase(), t);
    }
    const list = [...seen.values()];
    if (list.length === 0 && String(import.meta.env.VITE_PREVIEW ?? "") === "1") return PREVIEW;
    return list;
  }, [byVolume, byNew]);

  const feed = useMemo(() => {
    let list = all;
    if (reward) list = list.filter((t) => rewardOf(t) === reward);
    if (debounced) list = list.filter((t) => t.name.toLowerCase().includes(debounced) || t.symbol.toLowerCase().includes(debounced) || t.address.toLowerCase() === debounced);
    const s = [...list];
    if (sort === "mcap") s.sort((a, b) => Number(b.marketCapUsd) - Number(a.marketCapUsd));
    else if (sort === "new") s.sort((a, b) => b.createdAt - a.createdAt);
    else s.sort((a, b) => volUsd(b) - volUsd(a) || Number(b.marketCapUsd) - Number(a.marketCapUsd));
    return s;
  }, [all, reward, debounced, sort]);

  const stats = useMemo(() => ({
    count: all.length,
    mcap: all.reduce((a, t) => a + Number(t.marketCapUsd || 0), 0),
    vol: all.reduce((a, t) => a + volUsd(t), 0),
  }), [all]);

  const rewards = useMemo(() => {
    const set = new Set<string>();
    all.forEach((t) => { const r = rewardOf(t); if (r) set.add(r); });
    return ["ETH", "USDC", ...BASE_STOCKS.map((s) => s.symbol)].filter((r) => set.has(r));
  }, [all]);

  const loading = !env.hideTokens && (lv || ln) && all.length === 0;

  return (
    <div className="hl">
      {/* Intro band */}
      <section className="hl-intro">
        <div className="hl-intro-copy">
          <h1 className="hl-h1">Launch a coin. Earn real stock.</h1>
          <p className="hl-sub">Every coin on Base pairs a tokenized stock, ETH or USDC. Each trade streams that asset to holders.</p>
        </div>
        <div className="hl-stats">
          <div><span>Listings</span><b>{stats.count || "—"}</b></div>
          <div><span>Market cap</span><b>{stats.mcap ? fmtUsd(stats.mcap) : "—"}</b></div>
          <div><span>24h volume</span><b>{stats.vol ? fmtUsd(stats.vol) : "—"}</b></div>
          <Link to="/launch" className="hl-launch">Launch a coin</Link>
        </div>
      </section>

      {/* Toolbar */}
      <div className="hl-toolbar">
        <div className="hl-seg">
          {SORTS.map((s) => (
            <button key={s.id} className={sort === s.id ? "on" : ""} onClick={() => setSort(s.id)}>{s.label}</button>
          ))}
        </div>
        <div className="hl-rewards">
          <button className={reward === null ? "on" : ""} onClick={() => setReward(null)}>All</button>
          {rewards.map((r) => (
            <button key={r} className={reward === r ? "on" : ""} onClick={() => setReward(reward === r ? null : r)}>{r}</button>
          ))}
        </div>
        <div className="hl-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" />
        </div>
      </div>

      {/* Table */}
      <div className="hl-table" role="table">
        <div className="hl-tr hl-th" role="row">
          <span className="hl-c-coin">Coin</span>
          <span className="hl-c-earn">Earns</span>
          <span className="hl-c-num">Price</span>
          <span className="hl-c-num">24h</span>
          <span className="hl-c-num">Market cap</span>
          <span className="hl-c-num hl-hide">Volume</span>
          <span className="hl-c-num hl-hide">Age</span>
        </div>
        {loading ? (
          [...Array(10)].map((_, i) => <div key={i} className="hl-tr hl-skel" />)
        ) : feed.length === 0 ? (
          <div className="hl-empty">
            {reward ? `No coin earns ${reward} yet. ` : debounced ? "No match. " : "No coins listed yet. "}
            <Link to="/launch" className="hl-a">Launch the first one</Link>.
          </div>
        ) : (
          feed.map((t) => {
            const r = rewardOf(t);
            const chg = t.priceChange24hPct;
            const has = chg != null && isFinite(chg);
            return (
              <Link to={`/token/${t.address}`} key={t.address} className="hl-tr" role="row">
                <span className="hl-c-coin">
                  <TokenLogo token={t} size={30} />
                  <span className="hl-coin-id">
                    <b>{t.symbol}{isOfficial(t.address) && <em className="hl-off">OFFICIAL</em>}</b>
                    <i>{t.name}</i>
                  </span>
                </span>
                <span className="hl-c-earn">{r ? <span className="hl-tag"><span className="hl-tag-dot" />{r}</span> : <span className="hl-muted">—</span>}</span>
                <span className="hl-c-num hl-nums">{priceStr(Number(t.priceUsd))}</span>
                <span className={`hl-c-num hl-nums ${has ? (chg! >= 0 ? "hl-up" : "hl-dn") : "hl-muted"}`}>{has ? `${chg! >= 0 ? "+" : ""}${chg!.toFixed(1)}%` : "—"}</span>
                <span className="hl-c-num hl-nums">{fmtUsd(t.marketCapUsd)}</span>
                <span className="hl-c-num hl-nums hl-hide">{fmtUsd(volUsd(t))}</span>
                <span className="hl-c-num hl-nums hl-hide hl-muted">{timeAgo(t.createdAt).replace(" ago", "")}</span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
