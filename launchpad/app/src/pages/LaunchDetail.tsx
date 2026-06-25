import { useState } from "react";
import type { Launch } from "../data/launches";
import { fmt } from "../data/launches";
import { IconGlobe, IconX, IconTelegram, IconDiscord } from "../components/Icons";

const STATUS_LABEL: Record<Launch["status"], string> = {
  bonding: "Bonding", graduated: "Graduated",
};

export function LaunchDetail({ launch }: { launch: Launch }) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");

  const bonding = launch.status === "bonding";
  const progress = bonding ? launch.marketCap / launch.graduateAt : 1;
  const up = launch.change24h >= 0;
  const price = launch.priceEth;

  const amt = amount && Number(amount) > 0 ? Number(amount) : 0;
  // bonding curve slippage rises with order size vs liquidity in the curve
  const impact = Math.min((amt * (mode === "buy" ? 1 : price) / Math.max(launch.liquidity, 0.5)) * 100, 30);
  const out = mode === "buy" ? (amt / price) * (1 - impact / 100) : amt * price * (1 - impact / 100);

  return (
    <div className="wrap page">

      <div className="detail">
        {/* left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="panel panel-body">
            <div className="detail-hero">
              <div className="token-glyph">{launch.symbol.slice(0, 2)}</div>
              <div style={{ flex: 1 }}>
                <h1>{launch.name}</h1>
                <div className="card-sym">${launch.symbol} · {launch.createdAgo}</div>
              </div>
              <span className={"status " + launch.status}>{STATUS_LABEL[launch.status]}</span>
            </div>

            {bonding ? (
              <>
                <div className="progress" style={{ marginTop: 18 }}>
                  <div className="progress-fill" style={{ width: Math.min(100, progress * 100) + "%" }} />
                </div>
                <div className="card-meta" style={{ marginTop: 8 }}>
                  <span><b>{Math.round(progress * 100)}%</b> to graduation</span>
                  <span>{fmt(launch.marketCap)} / {fmt(launch.graduateAt, 0)} ETH mcap</span>
                </div>
              </>
            ) : (
              <p className="note" style={{ marginTop: 14 }}>◆ Live and trading on a Uniswap v4 pool.</p>
            )}

            <div className="stats section-gap">
              <Stat k="Price" v={fmt(price, 7)} sub="ETH" />
              <Stat k="Market cap" v={fmt(launch.marketCap) + " ETH"} />
              <Stat k="24h" v={(up ? "+" : "") + launch.change24h.toFixed(1) + "%"} />
              <Stat k="Holders" v={fmt(launch.holders, 0)} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><span className="lbl">Token</span><span className="idx">B20</span></div>
            <div className="panel-body">
              <div className="kv"><span className="k">Total supply</span><span className="v">{fmt(launch.supply, 0)}</span></div>
              <div className="kv"><span className="k">Standard</span><span className="v">B20 (native)</span></div>
              <div className="kv"><span className="k">Liquidity</span><span className="v">{fmt(launch.liquidity)} ETH · Uniswap v4</span></div>
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
                  {launch.links.website && <a className="social-chip" href={"https://" + launch.links.website.replace(/^https?:\/\//, "")} target="_blank" rel="noreferrer"><IconGlobe size={13} /> Website</a>}
                  {launch.links.x && <a className="social-chip" href={"https://" + launch.links.x} target="_blank" rel="noreferrer"><IconX size={13} /> Twitter</a>}
                  {launch.links.telegram && <a className="social-chip" href={"https://" + launch.links.telegram} target="_blank" rel="noreferrer"><IconTelegram size={13} /> Telegram</a>}
                  {launch.links.discord && <a className="social-chip" href={"https://" + launch.links.discord} target="_blank" rel="noreferrer"><IconDiscord size={13} /> Discord</a>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* right: instant trade */}
        <div className="panel" style={{ position: "sticky", top: 16 }}>
          <div className="panel-head">
            <span className="lbl">Trade</span>
            <span className="idx">UNISWAP V4</span>
          </div>
          <div className="panel-body">
            <div className="seg" style={{ marginBottom: 16 }}>
              <button className={mode === "buy" ? "active" : ""} onClick={() => setMode("buy")}>Buy</button>
              <button className={mode === "sell" ? "active" : ""} onClick={() => setMode("sell")}>Sell</button>
            </div>

            <label className="field-label">You {mode === "buy" ? "pay" : "sell"}</label>
            <div className="term-input">
              <input inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
              <span className="unit">{mode === "buy" ? "ETH" : launch.symbol}</span>
            </div>
            <div className="fee-line">
              <span>You receive</span>
              <span>{fmt(out, mode === "buy" ? 0 : 4)} {mode === "buy" ? launch.symbol : "ETH"}</span>
            </div>
            <div className="fee-line">
              <span>Price impact</span>
              <span>{amt > 0 ? "~" + impact.toFixed(2) + "%" : "·"}</span>
            </div>
            <button className={"btn full " + (mode === "buy" ? "primary" : "")} disabled={!amount}>
              {mode === "buy" ? "Buy " : "Sell "}{launch.symbol}
            </button>
            <p className="hint">
              Instant buy and sell on the token's Uniswap v4 pool. Liquidity is managed by the project.
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
