import { useState } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { usePresale } from "../hooks/usePresale";
import { ProgressBar } from "../components/ProgressBar";

function eth(v: bigint, dp = 4) {
  const n = Number(formatEther(v));
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

function phaseOf(s: { startTime: bigint; endTime: bigint; finalized: boolean }) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (s.finalized) return "finalized" as const;
  if (now < s.startTime) return "upcoming" as const;
  if (now > s.endTime) return "ended" as const;
  return "live" as const;
}

function countdown(target: bigint) {
  const secs = Number(target - BigInt(Math.floor(Date.now() / 1000)));
  if (secs <= 0) return "0s";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function Presale() {
  const { isConnected } = useAccount();
  const { configured, sale, mine, actions, tx } = usePresale();
  const [amount, setAmount] = useState("");

  if (!configured) {
    return (
      <section className="panel notice">
        <h2>Presale not live yet</h2>
        <p>
          The token sale contract is not deployed on this network. Once it ships to the testnet,
          drop its address into <code>src/lib/config.ts</code> and this page goes live with no other
          changes.
        </p>
      </section>
    );
  }

  if (!sale) {
    return <section className="panel">Loading sale…</section>;
  }

  const phase = phaseOf(sale);
  const raised = Number(sale.totalRaised);
  const hard = Number(sale.hardCap);
  const progress = hard > 0 ? raised / hard : 0;
  const softFrac = hard > 0 ? Number(sale.softCap) / hard : 0;
  const canBuy = phase === "live" && isConnected;
  const canClaim = sale.finalized && sale.succeeded && mine.owed > 0n;
  const canRefund = sale.finalized && !sale.succeeded && mine.contributed > 0n;
  const canFinalize = !sale.finalized && (phase === "ended" || sale.totalRaised >= sale.hardCap);

  return (
    <div className="presale">
      <section className="panel hero-panel">
        <div className="row between">
          <div>
            <p className="kicker">$UMBRA presale</p>
            <h2>One flat price. Same rate for everyone.</h2>
          </div>
          <span className={"phase " + phase}>{phase}</span>
        </div>

        <ProgressBar value={progress} soft={softFrac} />
        <div className="row between small muted">
          <span>{eth(sale.totalRaised)} ETH raised</span>
          <span>
            soft {eth(sale.softCap, 0)} / hard {eth(sale.hardCap, 0)} ETH
          </span>
        </div>

        <div className="stats">
          <Stat k="Price" v={`${eth(sale.price, 6)} ETH`} sub="per UMBRA" />
          <Stat
            k={phase === "upcoming" ? "Starts in" : phase === "live" ? "Ends in" : "Window"}
            v={phase === "upcoming" ? countdown(sale.startTime) : phase === "live" ? countdown(sale.endTime) : "closed"}
          />
          <Stat k="Your contribution" v={`${eth(mine.contributed)} ETH`} />
          <Stat k="Your tokens" v={`${eth(mine.owed, 2)} UMBRA`} sub={sale.finalized ? "" : "pending sale"} />
        </div>
      </section>

      <section className="panel">
        <h3>Buy</h3>
        <div className="buy-row">
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            disabled={!canBuy}
          />
          <span className="unit">ETH</span>
          <button
            className="btn primary"
            disabled={!canBuy || !amount || Number(amount) <= 0 || tx.isPending || tx.mining}
            onClick={() => actions.buy(amount)}
          >
            {tx.isPending || tx.mining ? "confirming" : "Buy"}
          </button>
        </div>
        {!isConnected && <p className="hint">Connect a wallet to take part.</p>}
        {phase === "upcoming" && <p className="hint">The sale has not started yet.</p>}
        {phase === "ended" && <p className="hint">The buy window has closed.</p>}

        {(canClaim || canRefund || canFinalize) && (
          <div className="actions">
            {canFinalize && (
              <button className="btn" onClick={() => actions.finalize()} disabled={tx.isPending}>
                Finalize sale
              </button>
            )}
            {canClaim && (
              <button className="btn primary" onClick={() => actions.claim()} disabled={tx.isPending}>
                Claim {eth(mine.owed, 2)} UMBRA
              </button>
            )}
            {canRefund && (
              <button className="btn" onClick={() => actions.refund()} disabled={tx.isPending}>
                Refund {eth(mine.contributed)} ETH
              </button>
            )}
          </div>
        )}

        {tx.error && <p className="error">{(tx.error as Error).message.split("\n")[0]}</p>}
        {tx.confirmed && <p className="ok">Confirmed.</p>}
      </section>
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
