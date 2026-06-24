import type { Launch } from "../data/launches";
import { fmt } from "../data/launches";
import { ProgressBar } from "./ProgressBar";

export function Featured({ launch, onOpen }: { launch: Launch; onOpen: () => void }) {
  const progress = launch.hardCap > 0 ? launch.raised / launch.hardCap : 0;
  return (
    <div className="featured" onClick={onOpen}>
      <div className="f-left">
        <span className="f-tag">Spotlight // live now</span>
        <h2>{launch.name}</h2>
        <div className="card-sym" style={{ marginBottom: 14 }}>${launch.symbol} · B20 · Base</div>
        <p className="f-desc">{launch.about}</p>
      </div>
      <div className="f-right">
        <ProgressBar value={progress} />
        <div className="card-meta" style={{ marginBottom: 14 }}>
          <span><b>{fmt(launch.raised)}</b> / {fmt(launch.hardCap)} ETH</span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <div className="f-stat"><span className="k">Price</span><span className="v">{fmt(launch.priceEth, 6)} ETH</span></div>
        <div className="f-stat"><span className="k">Holders</span><span className="v">{fmt(launch.holders, 0)}</span></div>
        <div className="f-stat"><span className="k">Ends in</span><span className="v">{launch.endsIn}</span></div>
        <button className="btn primary full" style={{ marginTop: 14 }}>View launch</button>
      </div>
    </div>
  );
}
