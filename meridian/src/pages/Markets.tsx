import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TOKENS } from "../lib/data";
import { fmtPct, fmtUsd } from "../lib/format";
import { useFakeLoad } from "../lib/hooks";
import { Sparkline } from "../components/charts";
import { Icon } from "../components/Icon";
import { TokenIcon } from "../components/TokenIcon";
import { Skeleton } from "../components/ui";

type Filter = "all" | "gainers" | "losers";
type SortKey = "marketCap" | "price" | "change24h" | "volume24h";

export function Markets() {
  const navigate = useNavigate();
  const loading = useFakeLoad(650);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [desc, setDesc] = useState(true);

  const movers = useMemo(
    () => [...TOKENS].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 3),
    []
  );

  const rows = useMemo(() => {
    let list = TOKENS.filter(
      (t) =>
        t.name.toLowerCase().includes(query.toLowerCase()) ||
        t.symbol.toLowerCase().includes(query.toLowerCase())
    );
    if (filter === "gainers") list = list.filter((t) => t.change24h > 0);
    if (filter === "losers") list = list.filter((t) => t.change24h < 0);
    return [...list].sort((a, b) => (desc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
  }, [query, filter, sortKey, desc]);

  const sortBy = (k: SortKey) => {
    if (k === sortKey) setDesc((d) => !d);
    else {
      setSortKey(k);
      setDesc(true);
    }
  };

  const th = (label: string, k: SortKey) => (
    <th
      className="num"
      style={{ cursor: "pointer", userSelect: "none" }}
      onClick={() => sortBy(k)}
      aria-sort={sortKey === k ? (desc ? "descending" : "ascending") : "none"}
    >
      {label}
      {sortKey === k ? (desc ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <div className="page container">
      <div className="row between wrap" style={{ gap: 16, marginBottom: 28 }}>
        <div>
          <h1 className="h2">Markets</h1>
          <p className="muted" style={{ marginTop: 4, fontSize: "0.92rem" }}>
            Live pricing from aggregated on-chain liquidity.
          </p>
        </div>
        <div className="search-wrap" style={{ maxWidth: 320 }}>
          <Icon name="search" size={17} />
          <input
            className="input"
            placeholder="Search assets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search assets"
          />
        </div>
      </div>

      {/* Top movers */}
      <div className="grid-3" style={{ marginBottom: 24 }}>
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div className="card" key={i}>
                <div className="row gap-3">
                  <Skeleton w={38} h={38} r="50%" />
                  <div style={{ flex: 1 }}>
                    <Skeleton w="55%" />
                    <Skeleton w="35%" h={11} style={{ marginTop: 7 }} />
                  </div>
                </div>
                <Skeleton h={44} style={{ marginTop: 18 }} />
              </div>
            ))
          : movers.map((t) => (
              <button
                key={t.symbol}
                className="card hover"
                style={{ textAlign: "left", width: "100%" }}
                onClick={() => navigate(`/token/${t.symbol}`)}
              >
                <div className="row between">
                  <div className="row gap-3">
                    <TokenIcon token={t} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      <div className="faint" style={{ fontSize: "0.82rem" }}>Top mover</div>
                    </div>
                  </div>
                  <span className={`badge ${t.change24h >= 0 ? "up" : "down"}`}>{fmtPct(t.change24h)}</span>
                </div>
                <div className="row between" style={{ marginTop: 20, alignItems: "flex-end" }}>
                  <span className="tnum" style={{ fontSize: "1.3rem", fontWeight: 700 }}>{fmtUsd(t.price)}</span>
                  <Sparkline data={t.series} positive={t.change24h >= 0} width={110} height={36} />
                </div>
              </button>
            ))}
      </div>

      {/* Filters */}
      <div className="row between wrap" style={{ gap: 12, marginBottom: 16 }}>
        <div className="seg" role="tablist" aria-label="Market filter">
          {(["all", "gainers", "losers"] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)} role="tab" aria-selected={filter === f}>
              {f === "all" ? "All assets" : f === "gainers" ? "Gainers" : "Losers"}
            </button>
          ))}
        </div>
        <span className="faint" style={{ fontSize: "0.85rem" }}>{rows.length} assets</span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th>
                <th>Asset</th>
                {th("Price", "price")}
                {th("24h", "change24h")}
                {th("Market cap", "marketCap")}
                {th("Volume (24h)", "volume24h")}
                <th className="num">Last 48h</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td><Skeleton w={16} /></td>
                      <td><div className="row gap-3"><Skeleton w={34} h={34} r="50%" /><Skeleton w={110} /></div></td>
                      {Array.from({ length: 4 }).map((_, j) => (
                        <td className="num" key={j}><Skeleton w={72} style={{ marginLeft: "auto" }} /></td>
                      ))}
                      <td className="num"><Skeleton w={110} h={34} style={{ marginLeft: "auto" }} /></td>
                    </tr>
                  ))
                : rows.map((t, i) => (
                    <tr key={t.symbol} className="clickable" onClick={() => navigate(`/token/${t.symbol}`)}>
                      <td className="faint">{i + 1}</td>
                      <td>
                        <div className="row gap-3">
                          <TokenIcon token={t} size={34} />
                          <div>
                            <div style={{ fontWeight: 600 }}>{t.name}</div>
                            <div className="faint" style={{ fontSize: "0.8rem" }}>{t.symbol}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num" style={{ fontWeight: 600 }}>{fmtUsd(t.price)}</td>
                      <td className={`num ${t.change24h >= 0 ? "up-text" : "down-text"}`}>{fmtPct(t.change24h)}</td>
                      <td className="num muted">{fmtUsd(t.marketCap, { compact: true })}</td>
                      <td className="num muted">{fmtUsd(t.volume24h, { compact: true })}</td>
                      <td>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <Sparkline data={t.series} positive={t.change24h >= 0} width={110} height={34} />
                        </div>
                      </td>
                    </tr>
                  ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "48px 0" }}>
                    <div className="muted">No assets match “{query}”.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
