import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { tokenBySymbol, TRANSACTIONS } from "../lib/data";
import { fmtNum, fmtPct, fmtUsd, timeAgo } from "../lib/format";
import { useApp } from "../lib/store";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { AreaChart } from "../components/charts";
import { Icon } from "../components/Icon";
import { TokenIcon } from "../components/TokenIcon";
import { Modal, ModalHeader, StatusBadge } from "../components/ui";

const RANGES = ["1D", "1W", "1M", "1Y"];

export function TokenDetail() {
  const { symbol = "" } = useParams();
  const token = tokenBySymbol(symbol);
  const { toast, wallet } = useApp();
  const [range, setRange] = useState("1D");
  const [tradeOpen, setTradeOpen] = useState<null | "buy" | "sell">(null);
  const [amount, setAmount] = useState("100");

  const chartData = useMemo(() => {
    if (!token) return [];
    // Reuse the token's 48-point series; stretch drift slightly per range for variety.
    const stretch = { "1D": 1, "1W": 1.6, "1M": 2.6, "1Y": 4.2 }[range] ?? 1;
    const base = token.series;
    return base.map((v, i) => v * (1 + ((i / base.length) * (stretch - 1) * token.change24h) / 100));
  }, [token, range]);

  const trades = useMemo(
    () => TRANSACTIONS.filter((t) => t.symbol === token?.symbol || t.kind === "swap").slice(0, 8),
    [token]
  );

  if (!token) {
    return (
      <div className="page container" style={{ textAlign: "center" }}>
        <h2 className="h2" style={{ marginTop: 60 }}>Asset not found</h2>
        <p className="sub" style={{ marginTop: 12 }}>We couldn't find “{symbol}”.</p>
        <Link to="/markets" className="btn btn-soft" style={{ marginTop: 24 }}>
          Back to markets
        </Link>
      </div>
    );
  }

  const stats = [
    { label: "Market cap", value: fmtUsd(token.marketCap, { compact: true }) },
    { label: "24h volume", value: fmtUsd(token.volume24h, { compact: true }) },
    { label: "Circulating supply", value: `${fmtNum(token.marketCap / token.price)} ${token.symbol}` },
    { label: "All-time high", value: fmtUsd(token.price * 1.42) },
  ];

  const confirmTrade = () => {
    const side = tradeOpen;
    setTradeOpen(null);
    toast({
      kind: "success",
      title: `${side === "buy" ? "Buy" : "Sell"} order filled`,
      body: `${fmtUsd(Number(amount) || 0)} of ${token.symbol} at ${fmtUsd(token.price)}`,
    });
  };

  return (
    <div className="page container">
      <Link to="/markets" className="muted row gap-2" style={{ fontSize: "0.9rem", marginBottom: 22, display: "inline-flex" }}>
        <Icon name="receive" size={15} />
        Markets
      </Link>

      <div className="row between wrap" style={{ gap: 16, marginBottom: 24 }}>
        <div className="row gap-4">
          <TokenIcon token={token} size={52} />
          <div>
            <div className="row gap-3">
              <h1 style={{ fontSize: "1.6rem", fontWeight: 700 }}>{token.name}</h1>
              <span className="badge">{token.symbol}</span>
            </div>
            <div className="row gap-3" style={{ marginTop: 6 }}>
              <span className="tnum" style={{ fontSize: "1.35rem", fontWeight: 700 }}>
                <AnimatedNumber value={token.price} format={(v) => fmtUsd(v)} duration={800} />
              </span>
              <span className={`badge ${token.change24h >= 0 ? "up" : "down"}`}>{fmtPct(token.change24h)} · 24h</span>
            </div>
          </div>
        </div>
        <div className="row gap-3">
          <button className="btn btn-primary" onClick={() => setTradeOpen("buy")}>Buy</button>
          <button className="btn btn-ghost" onClick={() => setTradeOpen("sell")}>Sell</button>
        </div>
      </div>

      <div className="split-main">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <div className="row between wrap" style={{ gap: 12, marginBottom: 16 }}>
              <h3 className="h3">Price</h3>
              <div className="seg" role="tablist" aria-label="Chart range">
                {RANGES.map((r) => (
                  <button key={r} className={r === range ? "active" : ""} onClick={() => setRange(r)} role="tab" aria-selected={r === range}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <AreaChart data={chartData} height={280} />
          </div>

          <div className="card" style={{ padding: 0 }}>
            <h3 className="h3" style={{ padding: "20px 24px 12px" }}>Recent network trades</h3>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Detail</th>
                    <th className="num">Value</th>
                    <th className="num">Status</th>
                    <th className="num">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((tx) => (
                    <tr key={tx.id}>
                      <td style={{ fontWeight: 600 }}>{tx.title}</td>
                      <td className="muted">{tx.detail}</td>
                      <td className="num">{tx.amountUsd > 0 ? fmtUsd(tx.amountUsd) : "—"}</td>
                      <td className="num"><StatusBadge status={tx.status} /></td>
                      <td className="num faint">{timeAgo(tx.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <h3 className="h3" style={{ marginBottom: 8 }}>Statistics</h3>
            {stats.map((s) => (
              <div key={s.label} className="row between" style={{ padding: "11px 0", borderBottom: "1px solid var(--border)", fontSize: "0.92rem" }}>
                <span className="muted">{s.label}</span>
                <span className="tnum" style={{ fontWeight: 600 }}>{s.value}</span>
              </div>
            ))}
            {wallet && (
              <div className="row between" style={{ padding: "11px 0", fontSize: "0.92rem" }}>
                <span className="muted">Your balance</span>
                <span className="tnum" style={{ fontWeight: 600 }}>
                  {token.holding.toLocaleString(undefined, { maximumFractionDigits: 4 })} {token.symbol}
                </span>
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="h3">About {token.name}</h3>
            <p className="muted" style={{ marginTop: 10, fontSize: "0.92rem", lineHeight: 1.7 }}>
              {token.name} trades against deep aggregated liquidity on Meridian.
              Orders route across concentrated liquidity pools for best
              execution, and every fill settles on-chain in under a second.
            </p>
            <div className="row gap-2" style={{ marginTop: 16, flexWrap: "wrap" }}>
              <span className="badge">Audited</span>
              <span className="badge">Deep liquidity</span>
              <span className="badge accent">Verified asset</span>
            </div>
          </div>
        </div>
      </div>

      <Modal open={tradeOpen !== null} onClose={() => setTradeOpen(null)}>
        <ModalHeader title={`${tradeOpen === "buy" ? "Buy" : "Sell"} ${token.symbol}`} onClose={() => setTradeOpen(null)} />
        <label className="card-title" style={{ display: "block", marginBottom: 8 }}>Amount (USD)</label>
        <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        <div className="card inner" style={{ padding: 16, margin: "16px 0 20px" }}>
          {[
            ["Rate", `1 ${token.symbol} = ${fmtUsd(token.price)}`],
            ["You receive", `≈ ${((Number(amount) || 0) / token.price).toFixed(5)} ${token.symbol}`],
            ["Network fee", "$0.0041"],
            ["Slippage", "0.10% max"],
          ].map(([k, v]) => (
            <div key={k} className="row between" style={{ padding: "6px 0", fontSize: "0.9rem" }}>
              <span className="muted">{k}</span>
              <span className="tnum" style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={confirmTrade}>
          Confirm {tradeOpen === "buy" ? "purchase" : "sale"}
        </button>
      </Modal>
    </div>
  );
}
