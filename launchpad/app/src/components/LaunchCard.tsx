import type { Launch } from "../data/launches";
import { fmt } from "../data/launches";
import { ProgressBar } from "./ProgressBar";

const STATUS_LABEL: Record<Launch["status"], string> = {
  live: "Live",
  upcoming: "Upcoming",
  success: "Funded",
  ended: "Ended",
};

export function LaunchCard({ launch, onOpen }: { launch: Launch; onOpen: () => void }) {
  const progress = launch.hardCap > 0 ? launch.raised / launch.hardCap : 0;
  return (
    <div className="card" onClick={onOpen}>
      <div className="card-top">
        <div className="token-glyph">{launch.symbol.slice(0, 2)}</div>
        <div style={{ flex: 1 }}>
          <div className="card-name">{launch.name}</div>
          <div className="card-sym">${launch.symbol}</div>
        </div>
        <span className={"status " + launch.status}>{STATUS_LABEL[launch.status]}</span>
      </div>

      <ProgressBar value={progress} />
      <div className="card-meta">
        <span><b>{fmt(launch.raised)}</b> / {fmt(launch.hardCap)} ETH</span>
        <span>{Math.round(progress * 100)}%</span>
      </div>
      <div className="card-meta">
        <span>Price <b>{fmt(launch.priceEth, 6)}</b></span>
        <span>{launch.status === "upcoming" ? launch.endsIn : launch.holders + " holders"}</span>
      </div>
    </div>
  );
}
