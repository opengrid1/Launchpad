import { useState } from "react";
import { LAUNCHES, fmt, type Launch, type Status } from "../data/launches";
import { LaunchCard } from "../components/LaunchCard";
import { Featured } from "../components/Featured";

const FILTERS: { k: "all" | Status; label: string }[] = [
  { k: "all", label: "All" },
  { k: "bonding", label: "Bonding" },
  { k: "graduated", label: "Graduated" },
];

export function Explore({ open, create }: { open: (l: Launch) => void; create: () => void }) {
  const [filter, setFilter] = useState<"all" | Status>("all");
  const list = filter === "all" ? LAUNCHES : LAUNCHES.filter((l) => l.status === filter);

  const totalMc = LAUNCHES.reduce((s, l) => s + l.marketCap, 0);
  const totalHolders = LAUNCHES.reduce((s, l) => s + l.holders, 0);
  const graduated = LAUNCHES.filter((l) => l.status === "graduated").length;
  const featured = [...LAUNCHES].filter((l) => l.status === "bonding").sort((a, b) => b.marketCap - a.marketCap)[0];

  return (
    <div className="wrap page">
      <div className="ticker" style={{ borderTop: "1px solid var(--line)", marginBottom: 26 }}>
        <Cell k="Total mcap" v={`${fmt(totalMc)} ETH`} accent />
        <Cell k="Tokens" v={String(LAUNCHES.length)} />
        <Cell k="Graduated" v={String(graduated)} />
        <Cell k="Holders" v={fmt(totalHolders, 0)} />
        <Cell k="Network" v="Base Mainnet" />
        <Cell k="Standard" v="B20 native" />
      </div>

      <div className="explore-head">
        <div>
          <span className="idx">B20 // BASE MAINNET</span>
          <h1>Launch a token. Trade it instantly.</h1>
          <p className="tagline">
            Every token is live on a bonding curve the moment it launches — buy and sell instantly,
            no presale. It graduates to a DEX once it fills the curve.
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
        <span className="lbl">{list.length} tokens</span>
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
