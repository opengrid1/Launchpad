import { useState } from "react";
import { useReadContract } from "wagmi";
import { ADDRESSES, isAddress, POOLS } from "../lib/config";
import { poolAbi } from "../lib/abis";
import { randomNote, encodeNote, type Note } from "../lib/note";

type Mode = "deposit" | "withdraw";

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

  function generate() {
    const n = randomNote();
    setNote({ note: n, backup: encodeNote(n) });
  }

  const fee = (Number(pool) * 0.003).toFixed(4);

  return (
    <div className="pool">
      <section className="panel">
        <p className="kicker">Shielded pool</p>
        <h2 style={{ marginBottom: 6 }}>Deposit one note, leave as a stranger.</h2>
        <p className="muted small" style={{ marginTop: 8 }}>
          Privacy comes from the anonymity set, not the proof alone. Use a fresh recipient and wait
          for the pool to fill before withdrawing.
        </p>
      </section>

      <section className="panel">
        <div className="seg" style={{ marginBottom: 20 }}>
          <button className={mode === "deposit" ? "active" : ""} onClick={() => setMode("deposit")}>
            Deposit
          </button>
          <button className={mode === "withdraw" ? "active" : ""} onClick={() => setMode("withdraw")}>
            Withdraw
          </button>
        </div>

        {mode === "deposit" ? (
          <>
            <label className="field-label">Select pool</label>
            <div className="denoms">
              {POOLS.map((p) => (
                <button
                  key={p.value}
                  className={"denom " + (pool === p.value ? "active" : "")}
                  onClick={() => setPool(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label className="field-label">You deposit</label>
            <div className="amount-box">
              <span className="amt">{pool}</span>
              <span className="unit">ETH</span>
            </div>
            <p className="fee-line">Relayer fee (0.3%) on withdraw: {fee} ETH</p>

            {!note ? (
              <button className="btn full" onClick={generate}>
                Generate note
              </button>
            ) : (
              <div className="note-box">
                <span className="kicker">Your note backup</span>
                <code className="note-string">{note.backup}</code>
                <p className="warn">
                  Anyone with this string can spend the deposit. Save it before depositing. It never
                  leaves your browser.
                </p>
                <button className="btn primary full" disabled title="Enabled once the in-browser prover lands">
                  Deposit {pool} ETH
                </button>
                <div className="row between">
                  <span className="tag">prover wiring pending</span>
                  <span className="hint" style={{ margin: 0 }}>
                    contract call wired: <code>deposit(commitment)</code>
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <label className="field-label">Note</label>
            <textarea className="note-input" placeholder="umbra-v1-…" rows={2} disabled />
            <label className="field-label">Recipient</label>
            <input className="addr-input" placeholder="0x…" disabled />
            <p className="fee-line">A relayer can post this so the fresh address needs no gas.</p>
            <button className="btn primary full" disabled>
              Generate proof and withdraw
            </button>
            <div className="row between" style={{ marginTop: 12 }}>
              <span className="tag">prover wiring pending</span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
