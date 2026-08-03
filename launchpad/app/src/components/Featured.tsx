import type { Launch } from "../data/launches";
import { fmt } from "../data/launches";

export function Featured({ launch, onOpen }: { launch: Launch; onOpen: () => void }) {
  const progress = launch.status === "graduated" ? 1 : launch.marketCap / launch.graduateAt;
  const up = launch.change24h >= 0;
  return (
    <div className="featured" onClick={onOpen}>
      <div className="f-left">
        <span className="f-tag">Spotlight // trending</span>
        <h2>{launch.name}</h2>
        <div className="card-sym" style={{ marginBottom: 14 }}>${launch.symbol} · B20 · Base · {launch.createdAgo}</div>
        <p className="f-desc">{launch.about}</p>
      </div>
      <div className="f-right">
        <div className="progress">
          <div className="progress-fill" style={{ width: Math.min(100, progress * 100) + "%" }} />
        </div>
        <div className="card-meta" style={{ marginBottom: 14 }}>
          <span>{Math.round(progress * 100)}% to graduation</span>
          <span className={up ? "ch-up" : "ch-down"}>{up ? "+" : ""}{launch.change24h.toFixed(1)}%</span>
        </div>
        <div className="f-stat"><span className="k">Market cap</span><span className="v">{fmt(launch.marketCap)} ETH</span></div>
        <div className="f-stat"><span className="k">Price</span><span className="v">{fmt(launch.priceEth, 7)} ETH</span></div>
        <div className="f-stat"><span className="k">Holders</span><span className="v">{fmt(launch.holders, 0)}</span></div>
        <button className="btn primary full" style={{ marginTop: 14 }}>Trade now</button>
      </div>
    </div>
  );
}
