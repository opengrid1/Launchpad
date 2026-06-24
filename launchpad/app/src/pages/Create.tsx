import { useState } from "react";

function Toggle({ on, set }: { on: boolean; set: () => void }) {
  return <div className={"switch" + (on ? " on" : "")} onClick={set} role="switch" aria-checked={on} />;
}

function ToggleRow({ name, desc, on, set }: { name: string; desc: string; on: boolean; set: () => void }) {
  return (
    <div className="toggle-row">
      <div>
        <div className="t-name">{name}</div>
        <div className="t-desc">{desc}</div>
      </div>
      <Toggle on={on} set={set} />
    </div>
  );
}

export function Create({ back }: { back: () => void }) {
  // token
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("100000000");
  const [variant, setVariant] = useState<"standard" | "asset">("standard");
  // sale
  const [price, setPrice] = useState("0.0001");
  const [soft, setSoft] = useState("10");
  const [hard, setHard] = useState("80");
  const [duration, setDuration] = useState("3");
  const [liq, setLiq] = useState("60");
  // roles & admin
  const [adminless, setAdminless] = useState(false);
  const [mint, setMint] = useState(true);
  const [burn, setBurn] = useState(true);
  const [metadata, setMetadata] = useState(false);
  // supply cap
  const [capOn, setCapOn] = useState(false);
  const [cap, setCap] = useState("100000000");
  // granular pause
  const [pauseTransfer, setPauseTransfer] = useState(false);
  const [pauseMint, setPauseMint] = useState(true);
  const [pauseBurn, setPauseBurn] = useState(false);
  // compliance / transfer policy
  const [policy, setPolicy] = useState<"open" | "allowlist" | "blocklist">("open");
  const [scSender, setScSender] = useState(true);
  const [scReceiver, setScReceiver] = useState(true);
  const [scMint, setScMint] = useState(false);
  const [freezeSeize, setFreezeSeize] = useState(false);
  // standards
  const [memos, setMemos] = useState(false);
  const [contractURI, setContractURI] = useState("");

  const maxTokens = price && Number(price) > 0 ? Number(hard) / Number(price) : 0;

  const summary = [
    policy === "open" ? "Open transfers" : policy === "allowlist" ? "Allowlist" : "Blocklist",
    capOn ? "Capped" : "Uncapped",
    [pauseTransfer, pauseMint, pauseBurn].some(Boolean) ? "Pausable" : "Non-pausable",
    freezeSeize ? "Freeze/seize" : null,
    adminless ? "Admin-less" : "Admin",
  ].filter(Boolean).join(" · ");

  return (
    <div className="wrap page" style={{ maxWidth: 720 }}>
      <span className="back" onClick={back}>← All launches</span>
      <div className="idx">B20 // BASE MAINNET</div>
      <h1 style={{ fontSize: 26, letterSpacing: "-0.02em", margin: "8px 0 22px" }}>Create a launch</h1>

      {/* 01 — token */}
      <div className="panel">
        <div className="panel-head"><span className="lbl">Token</span><span className="idx">01</span></div>
        <div className="panel-body">
          <label className="field-label">Variant</label>
          <div className="seg" style={{ marginBottom: 16 }}>
            <button className={variant === "standard" ? "active" : ""} onClick={() => setVariant("standard")}>Standard</button>
            <button className={variant === "asset" ? "active" : ""} onClick={() => setVariant("asset")}>Asset (RWA)</button>
          </div>
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
            <label className="field-label">Initial supply</label>
            <input className="input" inputMode="numeric" value={supply} onChange={(e) => setSupply(e.target.value.replace(/[^0-9]/g, ""))} />
          </div>
          {variant === "asset" && <p className="hint">Asset variant adds an OPERATOR_ROLE, for regulated / real-world-asset issuers.</p>}
        </div>
      </div>

      {/* 02 — sale */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Sale</span><span className="idx">02</span></div>
        <div className="panel-body">
          <div className="field-row">
            <div className="field"><label className="field-label">Price (ETH / token)</label>
              <input className="input" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
            <div className="field"><label className="field-label">Duration (days)</label>
              <input className="input" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ""))} /></div>
          </div>
          <div className="field-row">
            <div className="field"><label className="field-label">Soft cap (ETH)</label>
              <input className="input" value={soft} onChange={(e) => setSoft(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
            <div className="field"><label className="field-label">Hard cap (ETH)</label>
              <input className="input" value={hard} onChange={(e) => setHard(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label">Liquidity to pool ({liq}%)</label>
            <input className="input" type="range" min={50} max={100} value={liq} onChange={(e) => setLiq(e.target.value)} style={{ padding: 0, accentColor: "#5f8fc4" }} />
          </div>
        </div>
      </div>

      {/* 03 — roles & admin */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Roles &amp; admin</span><span className="idx">03</span></div>
        <div className="panel-body">
          <ToggleRow name="Permanently admin-less" desc="Renounce DEFAULT_ADMIN at launch. Roles can never be changed again — fully trustless." on={adminless} set={() => setAdminless((v) => !v)} />
          <ToggleRow name="MINT_ROLE" desc="Issue new supply after launch (e.g. rewards)." on={mint} set={() => setMint((v) => !v)} />
          <ToggleRow name="BURN_ROLE" desc="Destroy supply held by the role holder." on={burn} set={() => setBurn((v) => !v)} />
          <ToggleRow name="METADATA_ROLE" desc="Update token metadata / contractURI after launch." on={metadata} set={() => setMetadata((v) => !v)} />
          {adminless && <p className="hint" style={{ color: "var(--amber)" }}>Admin-less is irreversible. The role set above is frozen the moment the token launches.</p>}
        </div>
      </div>

      {/* 04 — supply cap */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Supply cap</span><span className="idx">04</span></div>
        <div className="panel-body">
          <ToggleRow name="Cap total supply" desc="Enforce a hard ceiling on every mint operation." on={capOn} set={() => setCapOn((v) => !v)} />
          {capOn && (
            <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
              <label className="field-label">Max supply</label>
              <input className="input" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          )}
        </div>
      </div>

      {/* 05 — pause policy */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Pause policy</span><span className="idx">05</span></div>
        <div className="panel-body">
          <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>B20 pauses each operation independently, each with its own pause / unpause role.</p>
          <ToggleRow name="Pausable transfers" desc="Halt all transfers in an emergency." on={pauseTransfer} set={() => setPauseTransfer((v) => !v)} />
          <ToggleRow name="Pausable mint" desc="Freeze new issuance." on={pauseMint} set={() => setPauseMint((v) => !v)} />
          <ToggleRow name="Pausable burn" desc="Freeze burns." on={pauseBurn} set={() => setPauseBurn((v) => !v)} />
        </div>
      </div>

      {/* 06 — compliance / transfer policy */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Compliance</span><span className="idx">06</span></div>
        <div className="panel-body">
          <label className="field-label">Transfer policy</label>
          <div className="seg" style={{ marginBottom: 8 }}>
            <button className={policy === "open" ? "active" : ""} onClick={() => setPolicy("open")}>Open</button>
            <button className={policy === "allowlist" ? "active" : ""} onClick={() => setPolicy("allowlist")}>Allowlist</button>
            <button className={policy === "blocklist" ? "active" : ""} onClick={() => setPolicy("blocklist")}>Blocklist</button>
          </div>
          {policy === "open" ? (
            <p className="hint" style={{ marginTop: 8 }}>ALWAYS_ALLOW — anyone can hold and transfer. Default, fully permissionless.</p>
          ) : (
            <>
              <p className="hint" style={{ marginTop: 8, marginBottom: 6 }}>Apply the {policy} policy to these scopes:</p>
              <ToggleRow name="Transfer sender" desc="Screen who can send." on={scSender} set={() => setScSender((v) => !v)} />
              <ToggleRow name="Transfer receiver" desc="Screen who can receive." on={scReceiver} set={() => setScReceiver((v) => !v)} />
              <ToggleRow name="Mint receiver" desc="Screen who can be minted to." on={scMint} set={() => setScMint((v) => !v)} />
            </>
          )}
          <div style={{ height: 8 }} />
          <ToggleRow name="Freeze &amp; seize" desc="BURN_BLOCKED_ROLE — burn from blocked accounts. For regulated issuers only." on={freezeSeize} set={() => setFreezeSeize((v) => !v)} />
        </div>
      </div>

      {/* 07 — standards */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Standards &amp; advanced</span><span className="idx">07</span></div>
        <div className="panel-body">
          <div className="toggle-row">
            <div><div className="t-name">ERC-2612 permit</div><div className="t-desc">Gasless approvals via signature.</div></div>
            <span className="tag">built-in</span>
          </div>
          <ToggleRow name="Transfer memos" desc="Attach bytes32 references to transfers / mints / burns for off-chain reconciliation." on={memos} set={() => setMemos((v) => !v)} />
          <div className="field" style={{ margin: "14px 0 0" }}>
            <label className="field-label">contractURI (ERC-7572) — optional</label>
            <input className="input" placeholder="ipfs://… or https://…" value={contractURI} onChange={(e) => setContractURI(e.target.value)} />
          </div>
        </div>
      </div>

      {/* summary */}
      <div className="panel section-gap">
        <div className="panel-body">
          <div className="kv"><span className="k">Issues as</span><span className="v">{symbol || "—"} · B20 {variant === "asset" ? "Asset" : ""} · Base</span></div>
          <div className="kv"><span className="k">Configuration</span><span className="v">{summary}</span></div>
          <div className="kv"><span className="k">Max raise (hard cap)</span><span className="v">{hard || 0} ETH</span></div>
          <div className="kv"><span className="k">Tokens at hard cap</span><span className="v">{maxTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} {symbol || ""}</span></div>
          <button className="btn primary full" style={{ marginTop: 16 }} disabled={!name || !symbol}>
            Launch {symbol ? "$" + symbol : "token"}
          </button>
          <p className="hint">Preview only. One createB20() tx issues the token with these settings; the presale deploys alongside it.</p>
        </div>
      </div>
    </div>
  );
}
