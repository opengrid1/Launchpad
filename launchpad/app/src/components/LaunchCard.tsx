import type { Launch } from "../data/launches";
import { fmt } from "../data/launches";

const STATUS_LABEL: Record<Launch["status"], string> = {
  bonding: "Bonding",
  graduated: "Graduated",
};

function sparkPaths(seed: string, up: boolean) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const n = 18, w = 100, ht = 30;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const jitter = ((h % 1000) / 1000 - 0.5) * 0.25;
    const trend = (i / (n - 1)) * (up ? 0.7 : 0.3) + (up ? 0.15 : 0.4);
    const y = Math.min(1, Math.max(0, trend + jitter));
    pts.push([(i / (n - 1)) * w, ht - y * (ht - 3) - 1.5]);
  }
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return { line, area: `${line} L${w} ${ht} L0 ${ht} Z` };
}

export function LaunchCard({ launch, onOpen }: { launch: Launch; onOpen: () => void }) {
  const progress = launch.status === "graduated" ? 1 : launch.marketCap / launch.graduateAt;
  const up = launch.change24h >= 0;
  const { line, area } = sparkPaths(launch.id, up);
  return (
    <div className="card" onClick={onOpen}>
      <div className="card-top">
        <div className="token-glyph">{launch.symbol.slice(0, 2)}</div>
        <div style={{ flex: 1 }}>
          <div className="card-name">{launch.name}</div>
          <div className="card-sym">${launch.symbol} · {launch.createdAgo}</div>
        </div>
        <span className={"status " + launch.status}>{STATUS_LABEL[launch.status]}</span>
      </div>

      <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <path className="spark-area" d={area} />
        <path className="spark-line" d={line} />
      </svg>

      <div className="card-meta">
        <span>MC <b>{fmt(launch.marketCap)} ETH</b></span>
        <span className={up ? "ch-up" : "ch-down"}>{up ? "+" : ""}{launch.change24h.toFixed(1)}%</span>
      </div>

      {launch.status === "bonding" ? (
        <>
          <div className="progress" style={{ marginTop: 10 }}>
            <div className="progress-fill" style={{ width: Math.min(100, progress * 100) + "%" }} />
          </div>
          <div className="card-meta">
            <span>{Math.round(progress * 100)}% to graduation</span>
            <span>{launch.holders} holders</span>
          </div>
        </>
      ) : (
        <div className="card-meta" style={{ marginTop: 10 }}>
          <span className="grad-tag">◆ Graduated to DEX</span>
          <span>{launch.holders} holders</span>
        </div>
      )}
    </div>
  );
}
