import type { Launch } from "../data/launches";
import { fmt } from "../data/launches";
import { ProgressBar } from "./ProgressBar";

const STATUS_LABEL: Record<Launch["status"], string> = {
  live: "Live",
  upcoming: "Upcoming",
  success: "Funded",
  ended: "Ended",
};

// Deterministic funding-curve sparkline from the launch id + progress.
function sparkPaths(seed: string, progress: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const n = 18, w = 100, ht = 30;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const jitter = ((h % 1000) / 1000 - 0.5) * 0.12;
    const base = Math.pow(i / (n - 1), 1.5) * Math.max(progress, 0.04);
    const y = Math.min(1, Math.max(0, base + jitter * (i / n)));
    pts.push([(i / (n - 1)) * w, ht - y * (ht - 3) - 1.5]);
  }
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = `${line} L${w} ${ht} L0 ${ht} Z`;
  return { line, area };
}

export function LaunchCard({ launch, onOpen }: { launch: Launch; onOpen: () => void }) {
  const progress = launch.hardCap > 0 ? launch.raised / launch.hardCap : 0;
  const { line, area } = sparkPaths(launch.id, progress);
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

      <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <path className="spark-area" d={area} />
        <path className="spark-line" d={line} />
      </svg>

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
