import { useState } from "react";
import { useAccount, useBalance, useConnect, useSendTransaction, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { parseEther, formatEther } from "viem";
import { fmt } from "../data/launches";

// Reference parameters for the Coinworks token presale.
const TOKEN = "Coinworks";
const SYMBOL = "WORK";
const SUPPLY = 1_000_000_000;
const PRICE = 0.00000004; // ETH per WORK (10 ETH hard cap / 250M presale supply)
const HARD_CAP = 10; // ETH
const SOFT_CAP = 5; // ETH
const PROCEEDS = "0x14c8905f188a8012a5a10122bf257d0ba5d418a6" as `0x${string}`; // destination for raised ETH

const ALLOC = [
  { k: "Presale", pct: 25, color: "var(--blue)", note: "This round" },
  { k: "Liquidity", pct: 30, color: "var(--ink)", note: "Paired with the raise, LP locked" },
  { k: "Treasury & ecosystem", pct: 20, color: "var(--green)", note: "Grants, listings, incentives" },
  { k: "Team", pct: 15, color: "var(--amber)", note: "12-month vest, 3-month cliff" },
  { k: "Community rewards", pct: 10, color: "var(--mut)", note: "Trading and staking rewards" },
];

const UTILITY = [
  ["70% revenue share", "70% of every fee the launchpad earns goes straight to WORK holders, paid in ETH. Creation, trading and graduation fees from every launch on the platform, split pro-rata to what you hold."],
  ["Buyback & burn", "A share of the remaining fees buys WORK on the market and burns it, so supply shrinks as platform volume grows."],
  ["Launch priority", "WORK holders get boosted allocation when a token graduates to a DEX."],
];

export function Presale() {
  const [amount, setAmount] = useState("");

  const { isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const { data: bal } = useBalance({
    address: PROCEEDS,
    chainId: base.id,
    query: { refetchInterval: 12_000 },
  });
  const { sendTransaction, isPending: sending, data: txHash, error: txError, reset } = useSendTransaction();

  const amt = amount && Number(amount) > 0 ? Number(amount) : 0;
  const tokens = amt / PRICE;
  const ofSupply = (tokens / SUPPLY) * 100;
  const raised = bal ? Number(formatEther(bal.value)) : 0;
  const progress = raised / HARD_CAP;
  const softPct = (SOFT_CAP / HARD_CAP) * 100;
  const onBase = chainId === base.id;
  const valid = amt > 0;

  function contribute() {
    if (!isConnected) { if (connectors[0]) connect({ connector: connectors[0] }); return; }
    if (!onBase) { switchChain({ chainId: base.id }); return; }
    if (!valid) return;
    reset();
    sendTransaction({ to: PROCEEDS, value: parseEther(amount) });
  }

  const btnLabel = !isConnected ? "Connect wallet"
    : !onBase ? "Switch to Base"
    : sending ? "Confirm in wallet…"
    : valid ? `Contribute ${amt} ETH`
    : "Enter an amount";
  const btnDisabled = isConnected && onBase && (!valid || sending);

  return (
    <div className="wrap page">
      <div className="idx">TOKEN // PRESALE</div>
      <h1 style={{ fontSize: 26, letterSpacing: "-0.02em", margin: "8px 0 6px" }}>
        {TOKEN} token presale
      </h1>
      <p className="tagline" style={{ maxWidth: "62ch", marginBottom: 24 }}>
        ${SYMBOL} is the B20 token that runs the launchpad. 70% of every fee the platform earns is
        paid straight to ${SYMBOL} holders in ETH. The presale seeds the initial liquidity and
        treasury before trading opens.
      </p>

      <div className="detail">
        {/* left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* round status */}
          <div className="panel panel-body">
            <div className="detail-hero">
              <div className="token-glyph">WO</div>
              <div style={{ flex: 1 }}>
                <h1>{TOKEN}</h1>
                <div className="card-sym">${SYMBOL} · B20 Asset · Base</div>
              </div>
              <span className="status live">Live</span>
            </div>

            <div className="progress" style={{ marginTop: 18 }}>
              <div className="progress-fill" style={{ width: Math.min(100, progress * 100) + "%" }} />
              <div className="soft-mark" style={{ left: softPct + "%" }} title="Soft cap" />
            </div>
            <div className="card-meta" style={{ marginTop: 8 }}>
              <span><b>{fmt(raised, 4)}</b> / {fmt(HARD_CAP, 0)} ETH raised</span>
              <span>{Math.round(progress * 100)}% of hard cap</span>
            </div>

            <div className="stats section-gap">
              <Stat k="Price" v={PRICE.toFixed(8)} sub={`ETH per ${SYMBOL}`} />
              <Stat k="Hard cap" v={fmt(HARD_CAP, 0) + " ETH"} />
              <Stat k="Soft cap" v={fmt(SOFT_CAP, 0) + " ETH"} />
              <Stat k="Presale supply" v={fmt(SUPPLY * 0.25, 0)} sub={`${SYMBOL} (25%)`} />
            </div>
          </div>

          {/* allocation */}
          <div className="panel">
            <div className="panel-head"><span className="lbl">Allocation</span><span className="idx">SUPPLY {fmt(SUPPLY, 0)}</span></div>
            <div className="panel-body">
              <div className="split">
                {ALLOC.map((a) => (
                  <span key={a.k} style={{ width: a.pct + "%", background: a.color }} title={`${a.k} ${a.pct}%`} />
                ))}
              </div>
              <div className="legend">
                {ALLOC.map((a) => (
                  <div className="legend-item" key={a.k}>
                    <span className="legend-dot" style={{ background: a.color }} />
                    <span>{a.k}</span>
                    <span className="legend-pct">{a.pct}%</span>
                  </div>
                ))}
              </div>
              <div className="alloc-notes">
                {ALLOC.map((a) => (
                  <div className="kv" key={a.k}><span className="k">{a.k}</span><span className="v">{a.note}</span></div>
                ))}
              </div>
            </div>
          </div>

          {/* utility */}
          <div className="panel">
            <div className="panel-head"><span className="lbl">What ${SYMBOL} does</span></div>
            <div className="panel-body">
              {UTILITY.map(([t, d]) => (
                <div className="util-row" key={t}>
                  <div className="util-k">{t}</div>
                  <div className="util-d">{d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* mechanics */}
          <div className="panel">
            <div className="panel-head"><span className="lbl">How the sale settles</span></div>
            <div className="panel-body">
              <div className="kv stack"><span className="k">Sale type</span><span className="v">Fixed price, first come first served</span></div>
              <div className="kv stack"><span className="k">Proceeds wallet</span><span className="v" style={{ wordBreak: "break-all" }}>{PROCEEDS}</span></div>
              <div className="kv stack"><span className="k">Where the ETH goes</span><span className="v">Every contribution is sent straight to the proceeds wallet. No escrow, no middle contract holding funds.</span></div>
              <div className="kv stack"><span className="k">When the token goes live</span><span className="v">{SYMBOL} is distributed automatically to every contributor, pro-rata to their contribution. No manual claim step.</span></div>
              <div className="kv stack"><span className="k">Refunds</span><span className="v">All contributions are final and non-refundable.</span></div>
              <div className="kv stack"><span className="k">Vesting</span><span className="v">Presale unlocks in full at distribution. Team vests over 12 months.</span></div>
            </div>
          </div>
        </div>

        {/* right: contribute widget */}
        <div className="panel" style={{ position: "sticky", top: 16 }}>
          <div className="panel-head">
            <span className="lbl">Contribute</span>
            <span className="idx">DIRECT</span>
          </div>
          <div className="panel-body">
            <label className="field-label">You contribute</label>
            <div className="term-input">
              <input
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              <span className="unit">ETH</span>
            </div>
            <div className="quick">
              {[0.1, 0.5, 1, 5].map((q) => (
                <button key={q} onClick={() => setAmount(String(q))}>{q}</button>
              ))}
            </div>

            <div className="fee-line" style={{ marginTop: 14 }}>
              <span>You receive</span>
              <span>{fmt(tokens, 0)} {SYMBOL}</span>
            </div>
            <div className="fee-line">
              <span>Share of supply</span>
              <span>{amt > 0 ? ofSupply.toFixed(3) + "%" : "·"}</span>
            </div>
            <div className="fee-line">
              <span>Price</span>
              <span>{PRICE.toFixed(8)} ETH</span>
            </div>

            <button className="btn primary full" style={{ marginTop: 14 }} onClick={contribute} disabled={btnDisabled}>
              {btnLabel}
            </button>
            {txHash && (
              <p className="ok">
                Contribution sent.{" "}
                <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer">View on Basescan</a>
              </p>
            )}
            {txError && (
              <p className="warn">{(txError as { shortMessage?: string }).shortMessage || "Transaction failed or was rejected."}</p>
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
