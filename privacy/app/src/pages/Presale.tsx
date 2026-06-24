import { useState } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { usePresale, type SaleState } from "../hooks/usePresale";
import { useDemoPresale } from "../hooks/useDemoPresale";
import { ADDRESSES, isAddress } from "../lib/config";
import { ProgressBar } from "../components/ProgressBar";

const CONFIGURED = isAddress(ADDRESSES.presale);

export function Presale() {
  return CONFIGURED ? <LivePresale /> : <DemoPresale />;
}

function LivePresale() {
  const r = usePresale();
  return <PresaleView sale={r.sale} mine={r.mine} actions={r.actions} tx={r.tx} demo={false} />;
}

function DemoPresale() {
  const r = useDemoPresale();
  return <PresaleView sale={r.sale} mine={r.mine} actions={r.actions} tx={r.tx} demo />;
}

type ViewProps = {
  sale: SaleState | null;
  mine: { contributed: bigint; owed: bigint };
  actions: { buy: (eth: string) => void; claim: () => void; refund: () => void; finalize: () => void };
  tx: { isPending: boolean; mining: boolean; confirmed: boolean; error: unknown };
  demo: boolean;
};

function eth(v: bigint, dp = 4) {
  return Number(formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: dp });
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

function PresaleView({ sale, mine, actions, tx, demo }: ViewProps) {
  const { isConnected } = useAccount();
  const [amount, setAmount] = useState("");

  if (!sale) return <section className="panel panel-pad muted">Loading sale…</section>;

  const phase = phaseOf(sale);
  const progress = sale.hardCap > 0n ? Number(sale.totalRaised) / Number(sale.hardCap) : 0;
  const softFrac = sale.hardCap > 0n ? Number(sale.softCap) / Number(sale.hardCap) : 0;
  const canBuy = phase === "live" && (isConnected || demo);
  const canClaim = sale.finalized && sale.succeeded && mine.owed > 0n;
  const canRefund = sale.finalized && !sale.succeeded && mine.contributed > 0n;
  const canFinalize = !sale.finalized && (phase === "ended" || sale.totalRaised >= sale.hardCap);

  return (
    <div className="presale">
      {demo && (
        <div className="banner">
          PREVIEW // sample data, buttons act locally. Deploy the sale contract and set its address in{" "}
          <code>src/lib/config.ts</code> to go live.
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <span className="lbl">Presale</span>
          <span className={"phase " + phase}>{phase}</span>
        </div>
        <div className="panel-body">
          <span className="idx">$UMBRA // FIXED PRICE</span>
          <h2 className="headline">One flat price.<br />Same rate for everyone.</h2>

          <ProgressBar value={progress} soft={softFrac} />
          <div className="row between small muted">
            <span>{eth(sale.totalRaised)} ETH raised</span>
            <span>soft {eth(sale.softCap, 0)} / hard {eth(sale.hardCap, 0)}</span>
          </div>

          <div className="stats">
            <Stat k="Price" v={`${eth(sale.price, 6)}`} sub="ETH / UMBRA" />
            <Stat
              k={phase === "upcoming" ? "Starts in" : phase === "live" ? "Ends in" : "Window"}
              v={phase === "upcoming" ? countdown(sale.startTime) : phase === "live" ? countdown(sale.endTime) : "closed"}
            />
            <Stat k="Your in" v={`${eth(mine.contributed)}`} sub="ETH" />
            <Stat k="Your tokens" v={`${eth(mine.owed, 0)}`} sub={sale.finalized ? "UMBRA" : "UMBRA · pending"} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="lbl">Buy</span>
          <span className="idx">{phase === "live" ? "OPEN" : "CLOSED"}</span>
        </div>
        <div className="panel-body">
          <div className="term-input">
            <input
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              disabled={!canBuy}
            />
            <span className="unit">ETH</span>
          </div>
          <button
            className="btn primary full"
            style={{ marginTop: "var(--s3)" }}
            disabled={!canBuy || !amount || Number(amount) <= 0 || tx.isPending || tx.mining}
            onClick={() => actions.buy(amount)}
          >
            {tx.isPending || tx.mining ? "Confirming" : "Buy $UMBRA"}
          </button>

          {!isConnected && !demo && <p className="hint">Connect a wallet to take part.</p>}
          {phase === "upcoming" && <p className="hint">The sale has not started yet.</p>}
          {phase === "ended" && <p className="hint">The buy window has closed.</p>}

          {(canClaim || canRefund || canFinalize) && (
            <div className="actions">
              {canFinalize && <button className="btn" onClick={() => actions.finalize()} disabled={tx.isPending}>Finalize</button>}
              {canClaim && <button className="btn accent" onClick={() => actions.claim()} disabled={tx.isPending}>Claim {eth(mine.owed, 0)}</button>}
              {canRefund && <button className="btn" onClick={() => actions.refund()} disabled={tx.isPending}>Refund {eth(mine.contributed)}</button>}
            </div>
          )}

          {tx.error ? <p className="error">{(tx.error as Error).message.split("\n")[0]}</p> : null}
          {tx.confirmed && <p className="ok">// confirmed</p>}
        </div>
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
