import { useState } from "react";
import { LAUNCHES, fmt, type Launch, type Status } from "../data/launches";
import { LaunchCard } from "../components/LaunchCard";
import { Featured } from "../components/Featured";

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

  const totalRaised = LAUNCHES.reduce((s, l) => s + l.raised, 0);
  const totalHolders = LAUNCHES.reduce((s, l) => s + l.holders, 0);
  const liveCount = LAUNCHES.filter((l) => l.status === "live").length;
  const featured = LAUNCHES.filter((l) => l.status === "live").sort((a, b) => b.raised - a.raised)[0];

  return (
    <div className="wrap page">
      {/* terminal data strip */}
      <div className="ticker" style={{ borderTop: "1px solid var(--line)", marginBottom: 26 }}>
        <Cell k="Total raised" v={`${fmt(totalRaised)} ETH`} accent />
        <Cell k="Live now" v={String(liveCount)} />
        <Cell k="Launches" v={String(LAUNCHES.length)} />
        <Cell k="Holders" v={fmt(totalHolders, 0)} />
        <Cell k="Network" v="Base Mainnet" />
        <Cell k="Standard" v="B20 native" />
      </div>

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

      {filter === "all" && featured && <Featured launch={featured} onOpen={() => open(featured)} />}

      <div className="row between" style={{ margin: "22px 0 18px", flexWrap: "wrap", gap: 12 }}>
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

function Cell({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="ticker-cell">
      <span className="tk">{k}</span>
      <span className="tv">{accent ? <span className="ac">{v}</span> : v}</span>
    </div>
  );
}
