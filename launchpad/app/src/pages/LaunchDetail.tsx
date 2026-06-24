import { useState } from "react";
import type { Launch } from "../data/launches";
import { fmt } from "../data/launches";
import { ProgressBar } from "../components/ProgressBar";

const STATUS_LABEL: Record<Launch["status"], string> = {
  live: "Live", upcoming: "Upcoming", success: "Funded", ended: "Ended",
};

export function LaunchDetail({ launch, back }: { launch: Launch; back: () => void }) {
  const [amount, setAmount] = useState("");
  const progress = launch.hardCap > 0 ? launch.raised / launch.hardCap : 0;
  const tokens = amount && Number(amount) > 0 ? Number(amount) / launch.priceEth : 0;
  const isLive = launch.status === "live";

  return (
    <div className="wrap page">
      <span className="back" onClick={back}>← All launches</span>

      <div className="detail">
        {/* left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="panel panel-body">
            <div className="detail-hero">
              <div className="token-glyph">{launch.symbol.slice(0, 2)}</div>
              <div style={{ flex: 1 }}>
                <h1>{launch.name}</h1>
                <div className="card-sym">${launch.symbol}</div>
              </div>
              <span className={"status " + launch.status}>{STATUS_LABEL[launch.status]}</span>
            </div>

            <ProgressBar value={progress} />
            <div className="card-meta" style={{ marginTop: 8 }}>
              <span><b>{fmt(launch.raised)}</b> / {fmt(launch.hardCap)} ETH raised</span>
              <span>soft {fmt(launch.softCap, 0)} ETH</span>
            </div>

            <div className="stats section-gap">
              <Stat k="Price" v={fmt(launch.priceEth, 6)} sub="ETH / token" />
              <Stat k={launch.status === "upcoming" ? "Starts" : "Ends in"} v={launch.endsIn} />
              <Stat k="Holders" v={fmt(launch.holders, 0)} />
              <Stat k="For sale" v={fmt(launch.forSale / 1e6, 1) + "M"} sub={launch.symbol} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><span className="lbl">Token</span><span className="idx">B20</span></div>
            <div className="panel-body">
              <div className="kv"><span className="k">Total supply</span><span className="v">{fmt(launch.supply, 0)}</span></div>
              <div className="kv"><span className="k">Standard</span><span className="v">B20 (native)</span></div>
              <div className="kv"><span className="k">Network</span><span className="v">Base Mainnet</span></div>
              <div className="kv">
                <span className="k">Compliance roles</span>
                <span className="roles">
                  {(["mint", "burn", "pause", "freeze"] as const).map((r) => (
                    <span key={r} className={"role" + (launch.roles[r] ? " on" : "")}>{r}</span>
                  ))}
                </span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><span className="lbl">About</span></div>
            <div className="panel-body">
              <p className="note" style={{ marginBottom: launch.links ? 16 : 0 }}>{launch.about}</p>
              {launch.links && (
                <div className="socials">
                  {launch.links.website && <a className="social-chip" href={"https://" + launch.links.website.replace(/^https?:\/\//, "")} target="_blank" rel="noreferrer">↗ Website</a>}
                  {launch.links.x && <a className="social-chip" href={"https://" + launch.links.x} target="_blank" rel="noreferrer">𝕏 Twitter</a>}
                  {launch.links.telegram && <a className="social-chip" href={"https://" + launch.links.telegram} target="_blank" rel="noreferrer">✈ Telegram</a>}
                  {launch.links.discord && <a className="social-chip" href={"https://" + launch.links.discord} target="_blank" rel="noreferrer">◎ Discord</a>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* right: buy */}
        <div className="panel" style={{ position: "sticky", top: 16 }}>
          <div className="panel-head">
            <span className="lbl">Participate</span>
            <span className="idx">{isLive ? "OPEN" : "CLOSED"}</span>
          </div>
          <div className="panel-body">
            <label className="field-label">You contribute</label>
            <div className="term-input">
              <input
                inputMode="decimal" placeholder="0.0" value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                disabled={!isLive}
              />
              <span className="unit">ETH</span>
            </div>
            <div className="fee-line">
              <span>You receive</span>
              <span>{fmt(tokens, 0)} {launch.symbol}</span>
            </div>
            <button className="btn primary full" disabled={!isLive || !amount}>
              {launch.status === "upcoming" ? "Not started" : launch.status === "live" ? "Buy " + launch.symbol : launch.status === "ended" ? "Refund" : "Claim tokens"}
            </button>
            <p className="hint">
              Flat price for every buyer. Overpay past the hard cap is refunded in the same tx. Soft
              cap missed means full refunds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-k">{k}</span>
      <span className="stat-v">{v}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}
