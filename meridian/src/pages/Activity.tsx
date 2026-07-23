import { useMemo, useState } from "react";
import { TRANSACTIONS, type Tx } from "../lib/data";
import { dayLabel, fmtUsd, timeAgo } from "../lib/format";
import { useFakeLoad } from "../lib/hooks";
import { useApp } from "../lib/store";
import { Icon } from "../components/Icon";
import { Skeleton, StatusBadge } from "../components/ui";

type Filter = "all" | "swap" | "transfer" | "approve";

function matches(tx: Tx, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "transfer") return tx.kind === "send" || tx.kind === "receive";
  return tx.kind === f;
}

export function Activity() {
  const loading = useFakeLoad(600);
  const { toast } = useApp();
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(() => {
    const filtered = TRANSACTIONS.filter((t) => matches(t, filter));
    const map = new Map<string, Tx[]>();
    for (const tx of filtered) {
      const key = dayLabel(tx.ts);
      map.set(key, [...(map.get(key) ?? []), tx]);
    }
    return [...map.entries()];
  }, [filter]);

  return (
    <div className="page container" style={{ maxWidth: 860 }}>
      <div className="row between wrap" style={{ gap: 16, marginBottom: 28 }}>
        <div>
          <h1 className="h2">Activity</h1>
          <p className="muted" style={{ marginTop: 4, fontSize: "0.92rem" }}>
            Every transaction, settled and signed by you.
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="Activity filter">
          {(
            [
              ["all", "All"],
              ["swap", "Swaps"],
              ["transfer", "Transfers"],
              ["approve", "Approvals"],
            ] as Array<[Filter, string]>
          ).map(([f, label]) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)} role="tab" aria-selected={filter === f}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="row gap-3" style={{ padding: "14px 12px" }}>
              <Skeleton w={38} h={38} r="50%" />
              <div style={{ flex: 1 }}>
                <Skeleton w="45%" />
                <Skeleton w="28%" h={11} style={{ marginTop: 7 }} />
              </div>
              <Skeleton w={80} />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "64px 24px" }}>
          <span style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: "var(--surface-2)", color: "var(--text-2)" }}>
            <Icon name="clock" size={26} />
          </span>
          <h3 className="h3" style={{ marginTop: 18 }}>Nothing here yet</h3>
          <p className="muted" style={{ marginTop: 8, fontSize: "0.92rem" }}>
            No {filter === "all" ? "activity" : `${filter} activity`} in this period.
          </p>
        </div>
      ) : (
        groups.map(([day, txs]) => (
          <div key={day} style={{ marginBottom: 28 }}>
            <div className="card-title" style={{ marginBottom: 10, paddingLeft: 4 }}>{day}</div>
            <div className="card" style={{ padding: 6 }}>
              {txs.map((tx) => (
                <button
                  key={tx.id}
                  className="row gap-3"
                  style={{
                    width: "100%",
                    padding: "13px 14px",
                    borderRadius: "var(--r-lg)",
                    textAlign: "left",
                    transition: "background var(--t-fast) var(--ease)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  onClick={() => toast({ kind: "info", title: "Opening explorer", body: tx.hash })}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 38,
                      height: 38,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background:
                        tx.direction === "in"
                          ? "rgba(61,232,176,0.12)"
                          : tx.direction === "out"
                          ? "rgba(255,107,129,0.1)"
                          : "var(--surface-2)",
                      color: tx.direction === "in" ? "var(--up)" : tx.direction === "out" ? "var(--down)" : "var(--text-2)",
                    }}
                  >
                    <Icon name={tx.kind === "approve" ? "approve" : tx.kind} size={17} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{tx.title}</div>
                    <div className="faint" style={{ fontSize: "0.82rem", marginTop: 1 }}>
                      {tx.detail} · <span className="mono">{tx.hash}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className={`tnum ${tx.direction === "in" ? "up-text" : ""}`} style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                      {tx.amountUsd > 0
                        ? `${tx.direction === "in" ? "+" : tx.direction === "out" ? "−" : ""}${fmtUsd(tx.amountUsd)}`
                        : "—"}
                    </div>
                    <div className="row gap-2" style={{ justifyContent: "flex-end", marginTop: 3 }}>
                      {tx.status !== "confirmed" && <StatusBadge status={tx.status} />}
                      <span className="faint" style={{ fontSize: "0.78rem" }}>{timeAgo(tx.ts)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
