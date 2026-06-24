import { useState } from "react";
import { LAUNCHES, type Launch, type Status } from "../data/launches";
import { LaunchCard } from "../components/LaunchCard";

const FILTERS: { k: "all" | Status; label: string }[] = [
  { k: "all", label: "All" },
  { k: "live", label: "Live" },
  { k: "upcoming", label: "Upcoming" },
  { k: "success", label: "Funded" },
  { k: "ended", label: "Ended" },
];

export function Explore({ open, create }: { open: (l: Launch) => void; create: () => void }) {
  const [filter, setFilter] = useState<"all" | Status>("all");
  const list = filter === "all" ? LAUNCHES : LAUNCHES.filter((l) => l.status === filter);

  return (
    <div className="wrap page">
      <div className="explore-head">
        <div>
          <span className="idx">B20 // BASE MAINNET</span>
          <h1>Launch a token. Same price for everyone.</h1>
          <p className="tagline">
            Fixed-price fair launches issued natively on Base with B20. No bonding curve, no
            insiders, chain-level compliance.
          </p>
        </div>
        <button className="btn primary" onClick={create}>+ Create launch</button>
      </div>

      <div className="row between" style={{ marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div className="filters">
          {FILTERS.map((f) => (
            <button key={f.k} className={filter === f.k ? "active" : ""} onClick={() => setFilter(f.k)}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="lbl">{list.length} launches</span>
      </div>

      <div className="grid">
        {list.map((l) => (
          <LaunchCard key={l.id} launch={l} onOpen={() => open(l)} />
        ))}
      </div>
    </div>
  );
}
