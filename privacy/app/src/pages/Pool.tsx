import { useState } from "react";
import { useReadContract } from "wagmi";
import { ADDRESSES, isAddress, POOLS } from "../lib/config";
import { poolAbi } from "../lib/abis";
import { randomNote, encodeNote, type Note } from "../lib/note";
import { Activity } from "../components/Activity";

type Mode = "deposit" | "transfer" | "withdraw";

export function Pool() {
  const configured = isAddress(ADDRESSES.shieldedPool);
  const [mode, setMode] = useState<Mode>("deposit");
  const [pool, setPool] = useState(POOLS[1].value);
  const [note, setNote] = useState<{ note: Note; backup: string } | null>(null);

  useReadContract({
    address: ADDRESSES.shieldedPool as `0x${string}`,
    abi: poolAbi,
    functionName: "denomination",
    query: { enabled: configured },
  });

  const fee = (Number(pool) * 0.003).toFixed(4);

  return (
    <div className="pool">
      {/* select pool */}
      <section className="panel">
        <div className="panel-head">
          <span className="lbl">Select Pool</span>
          <span className="idx">FIXED // ETH</span>
        </div>
        <div className="panel-body">
          <div className="pool-rows">
            {POOLS.map((p) => (
              <div
                key={p.value}
                className={"pool-row" + (pool === p.value ? " active" : "")}
                onClick={() => setPool(p.value)}
              >
                <span className="radio" />
                <span className="denom-label">{p.label}</span>
                <span className="denom-meta">anonymity set —</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Activity />

      {/* action */}
      <section className="panel">
        <div className="seg">
          <button className={mode === "deposit" ? "active" : ""} onClick={() => setMode("deposit")}>Deposit</button>
          <button className={mode === "transfer" ? "active" : ""} onClick={() => setMode("transfer")}>Transfer</button>
          <button className={mode === "withdraw" ? "active" : ""} onClick={() => setMode("withdraw")}>Withdraw</button>
        </div>

        <div className="panel-body">
          {mode === "deposit" && (
            <>
              <label className="field-label">Amount</label>
              <div className="amount-box">
                <span className="amt">{pool}</span>
                <span className="unit">ETH</span>
              </div>
              <div className="fee-line">
                <span>Relayer fee 0.3% (on withdraw)</span>
                <span>{fee} ETH</span>
              </div>

              {!note ? (
                <button
                  className="btn full"
                  onClick={() => {
                    const n = randomNote();
                    setNote({ note: n, backup: encodeNote(n) });
                  }}
                >
                  Generate note
                </button>
              ) : (
                <div className="note-box">
                  <span className="lbl">Note backup</span>
                  <code className="note-string">{note.backup}</code>
                  <p className="warn">
                    Anyone with this string can spend the deposit. Save it before depositing. It never
                    leaves your browser.
                  </p>
                  <button className="btn primary full" disabled title="Enabled once the in-browser prover lands">
                    Deposit {pool} ETH
                  </button>
                  <div className="row between">
                    <span className="tag">prover pending</span>
                    <span className="hint" style={{ margin: 0 }}>wired: deposit(commitment)</span>
                  </div>
                </div>
              )}
            </>
          )}

          {mode === "transfer" && (
            <div style={{ padding: "10px 0" }}>
              <label className="field-label">Recipient note</label>
              <input className="addr-input" placeholder="umbra-v1-…" disabled />
              <p className="hint" style={{ marginTop: 0 }}>
                Internal shielded transfers arrive with the arbitrary-amount UTXO pools. The
                fixed-denomination pool supports deposit and withdraw only.
              </p>
              <button className="btn full" disabled style={{ marginTop: "var(--s4)" }}>Not available</button>
            </div>
          )}

          {mode === "withdraw" && (
            <>
              <label className="field-label">Note</label>
              <textarea className="note-input" placeholder="umbra-v1-…" rows={2} disabled />
              <label className="field-label">Recipient</label>
              <input className="addr-input" placeholder="0x…" disabled />
              <div className="fee-line"><span>A relayer can post this</span><span>no gas needed</span></div>
              <button className="btn primary full" disabled>Generate proof and withdraw</button>
              <div className="row between" style={{ marginTop: "var(--s3)" }}>
                <span className="tag">prover pending</span>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
