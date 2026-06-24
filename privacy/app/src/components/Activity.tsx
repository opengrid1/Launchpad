import { useState } from "react";

// Expandable global-activity feed. Sample rows for the testnet preview; wire to
// the pool's Deposit/Withdrawal events to make it live.
const ROWS = [
  { dot: "red", type: "Withdraw", amt: "0.0120 ETH", time: "3m ago" },
  { dot: "green", type: "Accepted", amt: "0.1000 ETH", time: "8m ago" },
  { dot: "amber", type: "Queued", amt: "1.0000 ETH", time: "14m ago" },
  { dot: "green", type: "Accepted", amt: "0.1000 ETH", time: "26m ago" },
  { dot: "blue", type: "Deposit", amt: "1.0000 ETH", time: "41m ago" },
];

export function Activity() {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel">
      <button className={"feed-toggle" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)}>
        <span className="lbl">Global Activity</span>
        <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      {open && (
        <>
          <div className="feed-stats">
            <div className="feed-stat">
              <div className="fk">Pool TVL</div>
              <div className="fv">9.6324</div>
            </div>
            <div className="feed-stat">
              <div className="fk">Pending</div>
              <div className="fv">0.0000</div>
            </div>
            <div className="feed-stat">
              <div className="fk">Deposits</div>
              <div className="fv">974</div>
            </div>
          </div>
          <div className="feed-list">
            {ROWS.map((r, i) => (
              <div className="feed-row" key={i}>
                <span className={"dot " + r.dot} />
                <span className="ftype">{r.type}</span>
                <span className="famt">{r.amt}</span>
                <span className="ftime">{r.time}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
