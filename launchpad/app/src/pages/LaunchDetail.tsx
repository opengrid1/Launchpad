import { useState } from "react";
import type { Launch } from "../data/launches";
import { fmt } from "../data/launches";
import { ProgressBar } from "../components/ProgressBar";

const STATUS_LABEL: Record<Launch["status"], string> = {
  live: "Live", upcoming: "Upcoming", success: "Funded", ended: "Ended",
};

// deterministic 24h change for the trading view
function change24h(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 4000) / 100 - 20); // -20%..+20%
}

export function LaunchDetail({ launch, back }: { launch: Launch; back: () => void }) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");

  const progress = launch.hardCap > 0 ? launch.raised / launch.hardCap : 0;
  const presale = launch.status === "live";       // contribute at fixed price
  const trading = launch.status === "success";    // trades on the DEX, buy + sell
  const upcoming = launch.status === "upcoming";
  const failed = launch.status === "ended";
  const price = launch.priceEth;

  const amt = amount && Number(amount) > 0 ? Number(amount) : 0;
  const impact = trading ? Math.min((amt / Math.max(launch.raised, 1)) * 100, 18) : 0;
  const out =
    mode === "buy"
      ? (amt / price) * (1 - impact / 100)        // tokens
      : amt * price * (1 - impact / 100);          // ETH
  const sellBlocked = mode === "sell" && !trading; // can't sell during/before presale
  const canAct = (presale && mode === "buy") || trading;

  const ch = change24h(launch.id);

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
              <Stat k={trading ? "Market price" : "Price"} v={fmt(price, 6)} sub="ETH / token" />
              <Stat k={upcoming ? "Starts" : trading ? "24h" : "Ends in"} v={trading ? (ch >= 0 ? "+" : "") + ch.toFixed(1) + "%" : launch.endsIn} />
              <Stat k="Holders" v={fmt(launch.holders, 0)} />
              <Stat k={trading ? "Liquidity" : "For sale"} v={trading ? fmt(launch.raised) + " ETH" : fmt(launch.forSale / 1e6, 1) + "M"} sub={trading ? "locked" : launch.symbol} />
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

        {/* right: trade / participate */}
        <div className="panel" style={{ position: "sticky", top: 16 }}>
          <div className="panel-head">
            <span className="lbl">{trading ? "Trade" : "Participate"}</span>
            <span className="idx">{presale ? "PRESALE" : trading ? "LIVE MARKET" : upcoming ? "SOON" : "CLOSED"}</span>
          </div>
          <div className="panel-body">
            {(presale || trading) && (
              <div className="seg" style={{ marginBottom: 16 }}>
                <button className={mode === "buy" ? "active" : ""} onClick={() => setMode("buy")}>Buy</button>
                <button className={mode === "sell" ? "active" : ""} onClick={() => setMode("sell")}>Sell</button>
              </div>
            )}

            {upcoming ? (
              <>
                <p className="note">Sale starts {launch.endsIn}.</p>
                <button className="btn primary full" disabled style={{ marginTop: 14 }}>Not started</button>
              </>
            ) : failed ? (
              <>
                <p className="note">Soft cap missed. Contributions are fully refundable.</p>
                <button className="btn primary full" style={{ marginTop: 14 }}>Refund contribution</button>
              </>
            ) : sellBlocked ? (
              <>
                <p className="note">Selling opens once the sale closes and liquidity goes live.</p>
                <button className="btn full" disabled style={{ marginTop: 14 }}>Sell unavailable</button>
              </>
            ) : (
              <>
                <label className="field-label">You {mode === "buy" ? "pay" : "sell"}</label>
                <div className="term-input">
                  <input inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <span className="unit">{mode === "buy" ? "ETH" : launch.symbol}</span>
                </div>
                <div className="fee-line">
                  <span>You receive</span>
                  <span>{fmt(out, mode === "buy" ? 0 : 4)} {mode === "buy" ? launch.symbol : "ETH"}</span>
                </div>
                {trading && (
                  <div className="fee-line">
                    <span>Price impact</span>
                    <span>{amt > 0 ? "~" + impact.toFixed(2) + "%" : "—"}</span>
                  </div>
                )}
                <button className={"btn full " + (mode === "sell" ? "" : "primary")} disabled={!canAct || !amount}>
                  {mode === "buy" ? "Buy " : "Sell "}{launch.symbol}
                </button>
                <p className="hint">
                  {presale
                    ? "Presale: flat price for everyone. Overpay past the hard cap is refunded; soft cap missed means full refunds."
                    : "Trades against the locked liquidity pool at market price. Slippage applies on large orders."}
                </p>
              </>
            )}
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
