import { useState } from "react";

type Roles = { mint: boolean; burn: boolean; pause: boolean; freeze: boolean };

const ROLE_INFO: { k: keyof Roles; name: string; desc: string }[] = [
  { k: "mint", name: "MINT_ROLE", desc: "Issue new supply after launch (e.g. rewards)." },
  { k: "burn", name: "BURN_ROLE", desc: "Destroy supply held by the role holder." },
  { k: "pause", name: "PAUSE_ROLE", desc: "Halt transfers in an emergency." },
  { k: "freeze", name: "FREEZE_SEIZE", desc: "Freeze or seize balances. For regulated issuers." },
];

export function Create({ back }: { back: () => void }) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("100000000");
  const [price, setPrice] = useState("0.0001");
  const [soft, setSoft] = useState("10");
  const [hard, setHard] = useState("80");
  const [duration, setDuration] = useState("3");
  const [liq, setLiq] = useState("60");
  const [roles, setRoles] = useState<Roles>({ mint: true, burn: true, pause: false, freeze: false });

  const toggle = (k: keyof Roles) => setRoles((r) => ({ ...r, [k]: !r[k] }));
  const maxTokens = price && Number(price) > 0 ? (Number(hard) / Number(price)) : 0;

  return (
    <div className="wrap page" style={{ maxWidth: 720 }}>
      <span className="back" onClick={back}>← All launches</span>
      <div className="idx">B20 // BASE MAINNET</div>
      <h1 style={{ fontSize: 26, letterSpacing: "-0.02em", margin: "8px 0 22px" }}>Create a launch</h1>

      <div className="panel">
        <div className="panel-head"><span className="lbl">Token</span><span className="idx">01</span></div>
        <div className="panel-body">
          <div className="field-row">
            <div className="field">
              <label className="field-label">Name</label>
              <input className="input" placeholder="Veilcoin" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Symbol</label>
              <input className="input" placeholder="VEIL" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label">Total supply</label>
            <input className="input" inputMode="numeric" value={supply} onChange={(e) => setSupply(e.target.value.replace(/[^0-9]/g, ""))} />
          </div>
        </div>
      </div>

      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Sale</span><span className="idx">02</span></div>
        <div className="panel-body">
          <div className="field-row">
            <div className="field">
              <label className="field-label">Price (ETH / token)</label>
              <input className="input" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            <div className="field">
              <label className="field-label">Duration (days)</label>
              <input className="input" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label className="field-label">Soft cap (ETH)</label>
              <input className="input" value={soft} onChange={(e) => setSoft(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            <div className="field">
              <label className="field-label">Hard cap (ETH)</label>
              <input className="input" value={hard} onChange={(e) => setHard(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label">Liquidity to pool ({liq}%)</label>
            <input className="input" type="range" min={50} max={100} value={liq} onChange={(e) => setLiq(e.target.value)} style={{ padding: 0, accentColor: "#5f8fc4" }} />
          </div>
        </div>
      </div>

      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">B20 compliance roles</span><span className="idx">03</span></div>
        <div className="panel-body">
          {ROLE_INFO.map((r) => (
            <div className="toggle-row" key={r.k}>
              <div>
                <div className="t-name">{r.name}</div>
                <div className="t-desc">{r.desc}</div>
              </div>
              <div className={"switch" + (roles[r.k] ? " on" : "")} onClick={() => toggle(r.k)} role="switch" aria-checked={roles[r.k]} />
            </div>
          ))}
          <p className="hint">
            Roles live at the chain level via B20 — no contract to deploy or audit. Freeze/seize is
            for regulated issuers; leave it off for a trustless fair launch.
          </p>
        </div>
      </div>

      <div className="panel section-gap">
        <div className="panel-body">
          <div className="kv"><span className="k">Issues as</span><span className="v">{symbol || "—"} · B20 · Base</span></div>
          <div className="kv"><span className="k">Max raise (hard cap)</span><span className="v">{hard || 0} ETH</span></div>
          <div className="kv"><span className="k">Tokens at hard cap</span><span className="v">{maxTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} {symbol || ""}</span></div>
          <button className="btn primary full" style={{ marginTop: 16 }} disabled={!name || !symbol}>
            Launch {symbol ? "$" + symbol : "token"}
          </button>
          <p className="hint">Preview only. Wiring to B20 issuance + presale comes next.</p>
        </div>
      </div>
    </div>
  );
}
