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
  const [supply, setSupply] = useState("1000000000");
  const [variant, setVariant] = useState<"asset" | "stablecoin">("asset");
  const [decimals, setDecimals] = useState("18");
  const [currency, setCurrency] = useState("USD");
  // listing
  const [logo, setLogo] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  // launch (bonding curve)
  const [graduateAt, setGraduateAt] = useState("80");
  const [initialBuy, setInitialBuy] = useState("");
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

      {/* 01 token */}
      <div className="panel">
        <div className="panel-head"><span className="lbl">Token</span><span className="idx">01</span></div>
        <div className="panel-body">
          <label className="field-label">Variant</label>
          <div className="seg" style={{ marginBottom: 16 }}>
            <button className={variant === "asset" ? "active" : ""} onClick={() => setVariant("asset")}>Asset</button>
            <button className={variant === "stablecoin" ? "active" : ""} onClick={() => setVariant("stablecoin")}>Stablecoin</button>
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
          <div className="field-row">
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Total supply</label>
              <input className="input" inputMode="numeric" value={supply} onChange={(e) => setSupply(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
            {variant === "asset" ? (
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">Decimals (6 to 18)</label>
                <input className="input" inputMode="numeric" value={decimals} onChange={(e) => setDecimals(e.target.value.replace(/[^0-9]/g, ""))} />
              </div>
            ) : (
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">Currency (ISO code)</label>
                <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} />
              </div>
            )}
          </div>
          <p className="hint">
            {variant === "asset"
              ? "Asset: general tokens (memes, utility, RWA). 6 to 18 decimals, supports rebase and OPERATOR_ROLE."
              : "Stablecoin: fiat-pegged. Decimals fixed at 6, tagged with an ISO currency code."}
          </p>
        </div>
      </div>

      {/* 02 listing */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Listing</span><span className="idx">02</span></div>
        <div className="panel-body">
          <label className="field-label">Logo</label>
          <div className="logo-upload" style={{ marginBottom: 16 }}>
            <label className="logo-box">
              {logo ? <img src={logo} alt="logo" /> : "+"}
              <input
                type="file"
                accept="image/png,image/svg+xml,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setLogo(URL.createObjectURL(f));
                }}
              />
            </label>
            <div>
              <div className="t-name">Upload token logo</div>
              <div className="t-desc">PNG / SVG, square. Pinned to IPFS on launch.</div>
            </div>
          </div>

          <div className="field">
            <label className="field-label">Description</label>
            <textarea className="input" rows={3} placeholder="What is this token and who is it for?" value={description} onChange={(e) => setDescription(e.target.value)} style={{ resize: "vertical" }} />
          </div>

          <label className="field-label">Links</label>
          <div className="social-grid">
            <div className="input-icon"><span className="pfx">WEB</span><input placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} /></div>
            <div className="input-icon"><span className="pfx">X</span><input placeholder="x.com/handle" value={x} onChange={(e) => setX(e.target.value)} /></div>
            <div className="input-icon"><span className="pfx">TG</span><input placeholder="t.me/group" value={telegram} onChange={(e) => setTelegram(e.target.value)} /></div>
            <div className="input-icon"><span className="pfx">DC</span><input placeholder="discord.gg/invite" value={discord} onChange={(e) => setDiscord(e.target.value)} /></div>
          </div>
          <p className="hint">Logo, description and links are pinned to IPFS and written into the token's ERC-7572 <code>contractURI</code> metadata, then indexed by the launchpad for its listing.</p>
        </div>
      </div>

      {/* 03 launch (bonding curve) */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Launch</span><span className="idx">03</span></div>
        <div className="panel-body">
          <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
            The token is tradable on a bonding curve from the first block. Anyone can
            buy and sell immediately. It graduates to a Base DEX (LP burned) once it fills the curve.
          </p>
          <div className="field-row">
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Graduate at (ETH market cap)</label>
              <input className="input" value={graduateAt} onChange={(e) => setGraduateAt(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Initial dev buy in ETH (optional)</label>
              <input className="input" placeholder="0.0" value={initialBuy} onChange={(e) => setInitialBuy(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
          </div>
          <p className="hint">Curve price starts near zero and rises as people buy. An initial dev buy seeds the first position in the same launch tx.</p>
        </div>
      </div>

      {/* 03 roles & admin */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Roles &amp; admin</span><span className="idx">04</span></div>
        <div className="panel-body">
          <ToggleRow name="Permanently admin-less" desc="Renounce DEFAULT_ADMIN at launch. Roles can never be changed again. Fully trustless." on={adminless} set={() => setAdminless((v) => !v)} />
          <ToggleRow name="MINT_ROLE" desc="Issue new supply after launch (e.g. rewards)." on={mint} set={() => setMint((v) => !v)} />
          <ToggleRow name="BURN_ROLE" desc="Destroy supply held by the role holder." on={burn} set={() => setBurn((v) => !v)} />
          <ToggleRow name="METADATA_ROLE" desc="Update token metadata / contractURI after launch." on={metadata} set={() => setMetadata((v) => !v)} />
          {adminless && <p className="hint" style={{ color: "var(--amber)" }}>Admin-less is irreversible. The role set above is frozen the moment the token launches.</p>}
        </div>
      </div>

      {/* 04 supply cap */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Supply cap</span><span className="idx">05</span></div>
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

      {/* 05 pause policy */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Pause policy</span><span className="idx">06</span></div>
        <div className="panel-body">
          <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>B20 pauses each operation independently, each with its own pause / unpause role.</p>
          <ToggleRow name="Pausable transfers" desc="Halt all transfers in an emergency." on={pauseTransfer} set={() => setPauseTransfer((v) => !v)} />
          <ToggleRow name="Pausable mint" desc="Freeze new issuance." on={pauseMint} set={() => setPauseMint((v) => !v)} />
          <ToggleRow name="Pausable burn" desc="Freeze burns." on={pauseBurn} set={() => setPauseBurn((v) => !v)} />
        </div>
      </div>

      {/* 06 compliance / transfer policy */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Compliance</span><span className="idx">07</span></div>
        <div className="panel-body">
          <label className="field-label">Transfer policy</label>
          <div className="seg" style={{ marginBottom: 8 }}>
            <button className={policy === "open" ? "active" : ""} onClick={() => setPolicy("open")}>Open</button>
            <button className={policy === "allowlist" ? "active" : ""} onClick={() => setPolicy("allowlist")}>Allowlist</button>
            <button className={policy === "blocklist" ? "active" : ""} onClick={() => setPolicy("blocklist")}>Blocklist</button>
          </div>
          {policy === "open" ? (
            <p className="hint" style={{ marginTop: 8 }}>ALWAYS_ALLOW. Anyone can hold and transfer. Default, fully permissionless.</p>
          ) : (
            <>
              <p className="hint" style={{ marginTop: 8, marginBottom: 6 }}>Apply the {policy} policy to these scopes:</p>
              <ToggleRow name="Transfer sender" desc="Screen who can send." on={scSender} set={() => setScSender((v) => !v)} />
              <ToggleRow name="Transfer receiver" desc="Screen who can receive." on={scReceiver} set={() => setScReceiver((v) => !v)} />
              <ToggleRow name="Mint receiver" desc="Screen who can be minted to." on={scMint} set={() => setScMint((v) => !v)} />
            </>
          )}
          <div style={{ height: 8 }} />
          <ToggleRow name="Freeze &amp; seize" desc="BURN_BLOCKED_ROLE. Burn from blocked accounts. For regulated issuers only." on={freezeSeize} set={() => setFreezeSeize((v) => !v)} />
        </div>
      </div>

      {/* 07 standards */}
      <div className="panel section-gap">
        <div className="panel-head"><span className="lbl">Standards &amp; advanced</span><span className="idx">08</span></div>
        <div className="panel-body">
          <div className="toggle-row">
            <div><div className="t-name">ERC-2612 permit</div><div className="t-desc">Gasless approvals via signature.</div></div>
            <span className="tag">built-in</span>
          </div>
          <ToggleRow name="Transfer memos" desc="Attach bytes32 references to transfers / mints / burns for off-chain reconciliation." on={memos} set={() => setMemos((v) => !v)} />
          <div className="field" style={{ margin: "14px 0 0" }}>
            <label className="field-label">contractURI override (advanced)</label>
            <input className="input" placeholder="ipfs://… (auto-built from Listing if blank)" value={contractURI} onChange={(e) => setContractURI(e.target.value)} />
            <p className="hint">Leave blank to use the metadata built from your Listing. Paste a URI to host your own.</p>
          </div>
        </div>
      </div>

      {/* summary */}
      <div className="panel section-gap">
        <div className="panel-body">
          <div className="kv"><span className="k">Issues as</span><span className="v">{symbol || "TBA"} · B20 {variant === "asset" ? "Asset" : "Stablecoin"} · Base</span></div>
          <div className="kv"><span className="k">Configuration</span><span className="v">{summary}</span></div>
          <div className="kv"><span className="k">Trading</span><span className="v">Instant · bonding curve</span></div>
          <div className="kv"><span className="k">Graduates at</span><span className="v">{graduateAt || 0} ETH mcap</span></div>
          <div className="kv"><span className="k">Initial dev buy</span><span className="v">{initialBuy || "0"} ETH</span></div>
          <button className="btn primary full" style={{ marginTop: 16 }} disabled={!name || !symbol}>
            Launch {symbol ? "$" + symbol : "token"}
          </button>
          <p className="hint">Preview only. One createB20() tx issues the token and opens its bonding curve for instant trading.</p>
        </div>
      </div>
    </div>
  );
}
