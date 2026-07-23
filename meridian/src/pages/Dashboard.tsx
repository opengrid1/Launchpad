import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { portfolioSeries, portfolioValue, TOKENS, TRANSACTIONS } from "../lib/data";
import { fmtPct, fmtUsd, timeAgo } from "../lib/format";
import { useApp } from "../lib/store";
import { useFakeLoad } from "../lib/hooks";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { AreaChart } from "../components/charts";
import { Icon } from "../components/Icon";
import { TokenIcon } from "../components/TokenIcon";
import { Modal, ModalHeader, Skeleton, StatusBadge } from "../components/ui";
import { NetworkBadge, WalletModal } from "../components/wallet";

const RANGES = ["1D", "1W", "1M", "1Y"];

function SendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const [step, setStep] = useState<"form" | "confirm" | "sending">("form");
  const [amount, setAmount] = useState("250");
  const [to, setTo] = useState("0x912d…B845");
  const token = TOKENS[3]; // USDM

  const close = () => {
    onClose();
    setTimeout(() => setStep("form"), 250);
  };

  return (
    <Modal open={open} onClose={close}>
      {step === "form" && (
        <>
          <ModalHeader title="Send" onClose={close} />
          <label className="card-title" style={{ display: "block", marginBottom: 8 }}>Asset</label>
          <div className="card inner row gap-3" style={{ padding: "12px 14px", marginBottom: 16 }}>
            <TokenIcon token={token} size={32} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{token.name}</div>
              <div className="faint" style={{ fontSize: "0.8rem" }}>
                Balance: {token.holding.toLocaleString()} {token.symbol}
              </div>
            </div>
          </div>
          <label className="card-title" style={{ display: "block", marginBottom: 8 }}>Amount</label>
          <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ marginBottom: 16 }} />
          <label className="card-title" style={{ display: "block", marginBottom: 8 }}>Recipient</label>
          <input className="input mono" value={to} onChange={(e) => setTo(e.target.value)} style={{ marginBottom: 24 }} />
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => setStep("confirm")}>
            Review transfer
          </button>
        </>
      )}
      {step === "confirm" && (
        <>
          <ModalHeader title="Confirm transfer" onClose={close} />
          <div className="card inner" style={{ padding: 18, marginBottom: 20 }}>
            {[
              ["Sending", `${amount} ${token.symbol}`],
              ["To", to],
              ["Network", "Meridian One"],
              ["Network fee", "$0.0041"],
              ["Arrival", "< 1 second"],
            ].map(([k, v]) => (
              <div key={k} className="row between" style={{ padding: "7px 0", fontSize: "0.92rem" }}>
                <span className="muted">{k}</span>
                <span className={k === "To" ? "mono" : "tnum"} style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
          <p className="faint" style={{ fontSize: "0.82rem", marginBottom: 20 }}>
            Transfers are final once confirmed. Double-check the recipient address.
          </p>
          <div className="row gap-3">
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStep("form")}>
              Back
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1.4 }}
              onClick={() => {
                setStep("sending");
                setTimeout(() => {
                  close();
                  toast({
                    kind: "success",
                    title: "Transfer confirmed",
                    body: `${amount} ${token.symbol} sent to ${to}`,
                  });
                }, 1300);
              }}
            >
              Confirm & send
            </button>
          </div>
        </>
      )}
      {step === "sending" && (
        <div style={{ textAlign: "center", padding: "26px 0 18px" }}>
          <span className="spin" style={{ color: "var(--accent)", display: "inline-flex" }}>
            <Icon name="spinner" size={38} strokeWidth={2} />
          </span>
          <h3 className="h3" style={{ marginTop: 18 }}>Broadcasting…</h3>
          <p className="muted" style={{ marginTop: 8, fontSize: "0.9rem" }}>
            Settling on Meridian One
          </p>
        </div>
      )}
    </Modal>
  );
}

export function Dashboard() {
  const { wallet, settings } = useApp();
  const navigate = useNavigate();
  const loading = useFakeLoad(750);
  const [range, setRange] = useState("1M");
  const [sendOpen, setSendOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  const series = useMemo(() => portfolioSeries(range), [range]);
  const total = portfolioValue();
  const changePct = ((series[series.length - 1] - series[0]) / series[0]) * 100;
  const changeUsd = series[series.length - 1] - series[0];
  const holdings = useMemo(
    () => [...TOKENS].sort((a, b) => b.holding * b.price - a.holding * a.price).slice(0, 6),
    []
  );
  const feed = TRANSACTIONS.slice(0, 7);
  const hide = settings.hideBalances;
  const mask = (s: string) => (hide ? "••••••" : s);

  if (!wallet) {
    return (
      <div className="page container" style={{ display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <span
            style={{
              display: "inline-flex",
              padding: 18,
              borderRadius: "50%",
              background: "var(--accent-soft)",
              color: "var(--accent)",
            }}
          >
            <Icon name="wallet" size={30} />
          </span>
          <h2 className="h2" style={{ marginTop: 22 }}>Connect to view your dashboard</h2>
          <p className="sub" style={{ marginTop: 12 }}>
            Your portfolio, activity and markets — one calm view across every chain.
          </p>
          <button className="btn btn-primary btn-lg" style={{ marginTop: 26 }} onClick={() => setWalletOpen(true)}>
            <Icon name="wallet" size={18} />
            Connect wallet
          </button>
        </div>
        <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      </div>
    );
  }

  return (
    <div className="page container">
      <div className="row between wrap" style={{ gap: 14, marginBottom: 28 }}>
        <div>
          <h1 className="h2">Portfolio</h1>
          <p className="muted" style={{ marginTop: 4, fontSize: "0.92rem" }}>
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"} — here's where you stand.
          </p>
        </div>
        <NetworkBadge />
      </div>

      <div className="split-main">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Balance + chart */}
          <div className="card">
            {loading ? (
              <>
                <Skeleton w={120} h={14} />
                <Skeleton w={260} h={40} style={{ marginTop: 12 }} />
                <Skeleton h={240} r={16} style={{ marginTop: 24 }} />
              </>
            ) : (
              <>
                <div className="row between wrap" style={{ gap: 12 }}>
                  <div>
                    <div className="card-title">Total balance</div>
                    <div style={{ fontSize: "2.5rem", fontWeight: 800, letterSpacing: "-0.03em", marginTop: 4 }}>
                      {hide ? "••••••" : <AnimatedNumber value={total} format={(v) => fmtUsd(v)} />}
                    </div>
                    <div className="row gap-2" style={{ marginTop: 6 }}>
                      <span className={`badge ${changePct >= 0 ? "up" : "down"}`}>{fmtPct(changePct)}</span>
                      <span className="muted tnum" style={{ fontSize: "0.9rem" }}>
                        {mask(`${changeUsd >= 0 ? "+" : ""}${fmtUsd(Math.abs(changeUsd))}`)} · {range}
                      </span>
                    </div>
                  </div>
                  <div className="seg" role="tablist" aria-label="Chart range">
                    {RANGES.map((r) => (
                      <button key={r} className={r === range ? "active" : ""} onClick={() => setRange(r)} role="tab" aria-selected={r === range}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 20 }}>
                  <AreaChart data={series} height={250} />
                </div>
                <div className="row gap-3" style={{ marginTop: 20, flexWrap: "wrap" }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setSendOpen(true)}>
                    <Icon name="send" size={15} /> Send
                  </button>
                  <Link to="/markets" className="btn btn-soft btn-sm">
                    <Icon name="swap" size={15} /> Swap
                  </Link>
                  <button className="btn btn-soft btn-sm" onClick={() => setSendOpen(true)}>
                    <Icon name="receive" size={15} /> Receive
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Holdings table */}
          <div className="card" style={{ padding: 0 }}>
            <div className="row between" style={{ padding: "20px 24px 14px" }}>
              <h3 className="h3">Holdings</h3>
              <Link to="/markets" className="muted" style={{ fontSize: "0.88rem" }}>
                All markets →
              </Link>
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="num">Balance</th>
                    <th className="num">Price</th>
                    <th className="num">24h</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          <td><div className="row gap-3"><Skeleton w={34} h={34} r="50%" /><Skeleton w={90} /></div></td>
                          <td className="num"><Skeleton w={70} style={{ marginLeft: "auto" }} /></td>
                          <td className="num"><Skeleton w={70} style={{ marginLeft: "auto" }} /></td>
                          <td className="num"><Skeleton w={54} style={{ marginLeft: "auto" }} /></td>
                          <td className="num"><Skeleton w={80} style={{ marginLeft: "auto" }} /></td>
                        </tr>
                      ))
                    : holdings.map((t) => (
                        <tr key={t.symbol} className="clickable" onClick={() => navigate(`/token/${t.symbol}`)}>
                          <td>
                            <div className="row gap-3">
                              <TokenIcon token={t} size={34} />
                              <div>
                                <div style={{ fontWeight: 600 }}>{t.symbol}</div>
                                <div className="faint" style={{ fontSize: "0.8rem" }}>{t.name}</div>
                              </div>
                            </div>
                          </td>
                          <td className="num muted">{mask(`${t.holding.toLocaleString(undefined, { maximumFractionDigits: 4 })}`)}</td>
                          <td className="num">{fmtUsd(t.price)}</td>
                          <td className={`num ${t.change24h >= 0 ? "up-text" : "down-text"}`}>{fmtPct(t.change24h)}</td>
                          <td className="num" style={{ fontWeight: 600 }}>{mask(fmtUsd(t.holding * t.price))}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Activity feed side column */}
        <div className="card" style={{ padding: 0 }}>
          <div className="row between" style={{ padding: "20px 20px 12px" }}>
            <h3 className="h3">Activity</h3>
            <Link to="/activity" className="muted" style={{ fontSize: "0.88rem" }}>
              View all →
            </Link>
          </div>
          <div style={{ padding: "0 8px 12px" }}>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="row gap-3" style={{ padding: "12px 12px" }}>
                    <Skeleton w={36} h={36} r="50%" />
                    <div style={{ flex: 1 }}>
                      <Skeleton w="65%" />
                      <Skeleton w="40%" h={11} style={{ marginTop: 7 }} />
                    </div>
                  </div>
                ))
              : feed.map((tx) => (
                  <div key={tx.id} className="row gap-3" style={{ padding: "11px 12px", borderRadius: "var(--r-md)" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background:
                          tx.direction === "in"
                            ? "rgba(61,232,176,0.12)"
                            : tx.direction === "out"
                            ? "rgba(255,107,129,0.1)"
                            : "var(--surface-2)",
                        color:
                          tx.direction === "in" ? "var(--up)" : tx.direction === "out" ? "var(--down)" : "var(--text-2)",
                      }}
                    >
                      <Icon name={tx.kind === "approve" ? "approve" : tx.kind} size={16} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row between gap-2">
                        <span style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {tx.title}
                        </span>
                        {tx.amountUsd > 0 && (
                          <span className={`tnum ${tx.direction === "in" ? "up-text" : ""}`} style={{ fontSize: "0.88rem", fontWeight: 600, flexShrink: 0 }}>
                            {tx.direction === "in" ? "+" : tx.direction === "out" ? "−" : ""}
                            {mask(fmtUsd(tx.amountUsd))}
                          </span>
                        )}
                      </div>
                      <div className="row between" style={{ marginTop: 2 }}>
                        <span className="faint" style={{ fontSize: "0.78rem" }}>{timeAgo(tx.ts)}</span>
                        {tx.status !== "confirmed" && <StatusBadge status={tx.status} />}
                      </div>
                    </div>
                  </div>
                ))}
          </div>
        </div>
      </div>

      <SendModal open={sendOpen} onClose={() => setSendOpen(false)} />
    </div>
  );
}
