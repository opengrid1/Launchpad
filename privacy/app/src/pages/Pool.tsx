import { useState } from "react";
import { useReadContract } from "wagmi";
import { formatEther } from "viem";
import { ADDRESSES, isAddress, POOLS } from "../lib/config";
import { poolAbi } from "../lib/abis";
import { randomNote, encodeNote, type Note } from "../lib/note";

export function Pool() {
  const configured = isAddress(ADDRESSES.shieldedPool);
  const [pool, setPool] = useState(POOLS[1].value);
  const [note, setNote] = useState<{ note: Note; backup: string } | null>(null);

  const denom = useReadContract({
    address: ADDRESSES.shieldedPool as `0x${string}`,
    abi: poolAbi,
    functionName: "denomination",
    query: { enabled: configured },
  });

  function generate() {
    const n = randomNote();
    setNote({ note: n, backup: encodeNote(n) });
  }

  return (
    <div className="pool">
      <section className="panel">
        <p className="kicker">shielded pool</p>
        <h2>Deposit one note, withdraw as a stranger.</h2>
        <p className="muted">
          Privacy comes from the anonymity set, not the proof alone. Use a fresh recipient address
          and wait for other deposits before you withdraw.
        </p>

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
        {configured && denom.data !== undefined && (
          <p className="hint">On-chain denomination: {formatEther(denom.data as bigint)} ETH</p>
        )}
      </section>

      <section className="panel">
        <div className="row between">
          <h3>Deposit</h3>
          <span className="tag pending">prover wiring pending</span>
        </div>
        <p className="muted">
          Step one generates a secret note in your browser. Save the backup string somewhere safe:
          it is the only way to withdraw, and it never leaves your machine.
        </p>
        <button className="btn" onClick={generate}>
          Generate note
        </button>

        {note && (
          <div className="note-box">
            <span className="stat-k">Your note backup</span>
            <code className="note-string">{note.backup}</code>
            <p className="warn">
              Anyone with this string can spend the deposit. Lose it and the funds are gone. Save it
              before depositing.
            </p>
            <button className="btn primary" disabled title="Wired once the in-browser prover lands">
              Deposit {pool} ETH
            </button>
            <p className="hint">
              Deposit is disabled until the prover module computes the commitment
              (Poseidon) and the withdraw proof (Groth16). The contract call is already wired:
              <code> pool.deposit(commitment)</code>.
            </p>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="row between">
          <h3>Withdraw</h3>
          <span className="tag pending">prover wiring pending</span>
        </div>
        <p className="muted">
          Paste a saved note and a fresh recipient address. The browser builds a zero-knowledge proof
          that you own a leaf in the tree, then the relayer (or you) posts it.
        </p>
        <textarea className="note-input" placeholder="umbra-v1-…" rows={2} disabled />
        <input className="addr-input" placeholder="recipient 0x…" disabled />
        <button className="btn primary" disabled>
          Generate proof and withdraw
        </button>
      </section>
    </div>
  );
}
