import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { parseEther, type Address } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { onair } from "../lib/client";
import { ADDRESSES, env } from "../lib/env";
import { hype, num, short, usd, wei } from "../lib/format";
import { runTx, useConfig, useHypeUsd, useIsOwner, useTokens, type Token } from "../lib/hooks";
import { countdown, secondsLeft } from "../lib/onair";
import { ensureWallet, openWalletModal } from "../lib/wallet";

/** Platform admin: owner-only factory and auction-house actions. */
export default function Admin() {
  const { address: me, isConnected } = useAccount();
  const owner = useIsOwner();
  const { data: cfg } = useConfig();
  const { data: tokens } = useTokens();
  const { data: hypeUsd = 0 } = useHypeUsd();
  const qc = useQueryClient();
  const [f, setF] = useState({ hypeUsd: "", feeTo: "", duration: "", minBid: "", floor: "", bond: "", asset: "", amount: "", newOwner: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const call = (label: string, fn: Parameters<typeof onair.adminCall>[0], args: unknown[] = []) => async () => {
    if (!isConnected) return openWalletModal();
    await ensureWallet();
    await runTx(label, () => onair.adminCall(fn, args), async () => { await qc.invalidateQueries(); });
  };

  if (!isConnected) return <main className="page"><section className="hero" style={{ gridTemplateColumns: "1fr" }}><div><div className="lbl" style={{ marginBottom: 12 }}>Admin</div><h1>Platform <em>admin</em>.</h1><p className="sub">Connect the owner wallet.</p><div className="cta"><button className="btn red" onClick={() => openWalletModal()}>Connect wallet</button></div></div></section></main>;

  return (
    <main className="page admin">
      <section className="sec">
        <div className="lbl" style={{ marginBottom: 12 }}>Admin · {short(me!)}{owner ? " · owner" : " · read only"}</div>
        <h1 style={{ fontSize: 56 }}>Platform <em>admin</em>.</h1>
        {!owner && <p className="warn" style={{ marginTop: 12 }}>This wallet does not own the factory. Actions will revert. Owner: {cfg ? short(cfg.owner) : "…"}</p>}
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Platform</h2></div>
        <div className="panel">
          <dl className="specs">
            <dt>Factory</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.factory}`} target="_blank" rel="noreferrer">{ADDRESSES.factory}</a></dd>
            <dt>Auction house</dt><dd><a href={`${env.explorerUrl}/address/${ADDRESSES.house}`} target="_blank" rel="noreferrer">{ADDRESSES.house}</a></dd>
            <dt>Owner</dt><dd>{cfg ? cfg.owner : "…"}</dd>
            <dt>Fee recipient</dt><dd>{cfg ? cfg.feeRecipient : "…"}</dd>
            <dt>Launches</dt><dd>{cfg ? (cfg.paused ? "PAUSED" : "open") : "…"}</dd>
            <dt>HYPE price on file</dt><dd>{cfg ? usd(cfg.hypeUsd) : "…"}</dd>
            <dt>Auction length</dt><dd>{cfg ? `${num(cfg.durationBlocks, 0)} blocks · ${countdown(cfg.durationBlocks)}` : "…"}</dd>
            <dt>Floor</dt><dd>{cfg ? usd(Number(cfg.floorMcapUsd8) / 1e8, { compact: true }) : "…"} FDV</dd>
            <dt>Bond</dt><dd>{cfg ? `${hype(wei(cfg.minRaiseWei), 0)} HYPE` : "…"}</dd>
            <dt>Min bid</dt><dd>{cfg ? `${hype(wei(cfg.minBidWei))} HYPE` : "…"}</dd>
          </dl>
        </div>
        <div className="agrid">
          <div className="panel">
            <div className="lbl" style={{ marginBottom: 10 }}>Launches</div>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {cfg?.paused ? <button className="btn" onClick={call("Resume launches", "resume")}>Resume launches</button> : <button className="btn ghost" onClick={call("Pause launches", "pause")}>Pause launches</button>}
            </div>
            <p className="note">Pausing blocks new launches only. Auctions, trading, claims and harvests keep running.</p>
          </div>
          <div className="panel">
            <div className="lbl" style={{ marginBottom: 10 }}>HYPE price · sizes the $3k floor</div>
            <div className="row"><input className="inp" inputMode="decimal" placeholder={cfg ? String(cfg.hypeUsd) : "USD per HYPE"} value={f.hypeUsd} onChange={set("hypeUsd")} /><button className="btn" disabled={!(Number(f.hypeUsd) > 0)} onClick={call("Set HYPE price", "setQuoteUsd", [BigInt(Math.round(Number(f.hypeUsd) * 1e8))])}>Set</button></div>
            <p className="note">Every new launch's floor and every displayed dollar value use this. Update it when HYPE moves.</p>
          </div>
          <div className="panel">
            <div className="lbl" style={{ marginBottom: 10 }}>Fee recipient</div>
            <div className="row"><input className="inp" placeholder={cfg?.feeRecipient ?? "0x…"} value={f.feeTo} onChange={set("feeTo")} /><button className="btn" disabled={!/^0x[0-9a-fA-F]{40}$/.test(f.feeTo)} onClick={call("Set fee recipient", "setFeeRecipient", [f.feeTo as Address])}>Set</button></div>
          </div>
          <div className="panel">
            <div className="lbl" style={{ marginBottom: 10 }}>Auction settings</div>
            <div className="split2">
              <label className="fld">Length · blocks<input className="inp" inputMode="numeric" placeholder={cfg ? String(cfg.durationBlocks) : "14400"} value={f.duration} onChange={set("duration")} /></label>
              <label className="fld">Min bid · HYPE<input className="inp" inputMode="decimal" placeholder={cfg ? String(wei(cfg.minBidWei)) : "0.05"} value={f.minBid} onChange={set("minBid")} /></label>
              <label className="fld">Floor · USD FDV<input className="inp" inputMode="decimal" placeholder={cfg ? String(Number(cfg.floorMcapUsd8) / 1e8) : "3000"} value={f.floor} onChange={set("floor")} /></label>
              <label className="fld">Bond · HYPE<input className="inp" inputMode="decimal" placeholder={cfg ? String(wei(cfg.minRaiseWei)) : "220"} value={f.bond} onChange={set("bond")} /></label>
            </div>
            <button className="btn" style={{ marginTop: 10 }} disabled={!cfg} onClick={() => cfg && call("Set auction config", "setAuctionConfig", [
              BigInt(f.duration || cfg.durationBlocks),
              f.minBid ? parseEther(f.minBid as `${number}`) : cfg.minBidWei,
              f.floor ? BigInt(Math.round(Number(f.floor) * 1e8)) : cfg.floorMcapUsd8,
              f.bond ? parseEther(f.bond as `${number}`) : cfg.minRaiseWei,
            ])()}>Save settings</button>
            <p className="note">Blank fields keep their current value. Applies to auctions opened after the change.</p>
          </div>
          <div className="panel">
            <div className="lbl" style={{ marginBottom: 10 }}>Recover stray assets</div>
            <div className="split2">
              <input className="inp" placeholder="token address" value={f.asset} onChange={set("asset")} />
              <input className="inp" inputMode="decimal" placeholder="amount (whole units)" value={f.amount} onChange={set("amount")} />
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn ghost" disabled={!/^0x[0-9a-fA-F]{40}$/.test(f.asset) || !(Number(f.amount) > 0)} onClick={call("Recover token", "recoverERC20", [f.asset as Address, parseEther((f.amount || "0") as `${number}`)])}>Recover token</button>
              <button className="btn ghost" onClick={call("Recover HYPE", "recoverNative")}>Recover native HYPE</button>
            </div>
            <p className="note">Sends to the owner wallet. Auction reserves sit in the factory while an auction runs; do not recover a coin that is still in auction.</p>
          </div>
          <div className="panel">
            <div className="lbl" style={{ marginBottom: 10 }}>Transfer ownership</div>
            <div className="row"><input className="inp" placeholder="new owner 0x…" value={f.newOwner} onChange={set("newOwner")} /><button className="btn sellbtn" disabled={!/^0x[0-9a-fA-F]{40}$/.test(f.newOwner)} onClick={call("Transfer ownership", "transferOwnership", [f.newOwner as Address])}>Transfer</button></div>
            <p className="note">One step, no confirmation from the new owner. Double-check the address.</p>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Launches</h2><span className="lbl">{tokens?.length ?? 0} coins</span></div>
        {!tokens ? <div className="skeleton" style={{ minHeight: 120 }} /> : (
          <div className="list">
            {tokens.map((t) => <LaunchRow key={t.address} t={t} hypeUsd={hypeUsd} me={me!} call={call} />)}
          </div>
        )}
      </section>
      <p className="small" style={{ marginTop: 16 }}><Link to="/" style={{ color: "var(--green)" }}>Back to the feed</Link></p>
    </main>
  );
}

function LaunchRow({ t, hypeUsd, me, call }: { t: Token; hypeUsd: number; me: Address; call: (label: string, fn: Parameters<typeof onair.adminCall>[0], args?: unknown[]) => () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [bps, setBps] = useState("2500");
  const [to, setTo] = useState("");
  const a = t.auction;
  const running = !!a && !a.finalized;
  const dest = (/^0x[0-9a-fA-F]{40}$/.test(to) ? to : me) as Address;
  const status = t.mode === "instant" ? "instant · trading" : !a ? "auction · seeded" : a.cancelled ? "auction · cancelled" : a.open ? `auction · ${countdown(secondsLeft(a))} left` : a.finalized ? (a.graduated ? "auction · seeded" : "auction · failed, refunds") : "auction · ended, needs settle";
  return (
    <div className="li" style={{ display: "block" }}>
      <div className="arow">
        <Art src={t.metadata?.logo} name={t.name} className="art" size={40} />
        <div><Link to={`/t/${t.address}`} style={{ color: "inherit", fontWeight: 600 }}>{t.name}</Link><div className="l2">{t.symbol} · {status} · {short(t.address)}</div></div>
        <div className="r">{running ? `${hype(wei(a!.raised), 2)} HYPE raised · ${hype(wei(a!.escrow), 2)} in escrow` : `${usd(t.marketCapUsd, { compact: true })} cap · ${usd(wei(t.liquidityWei) * hypeUsd, { compact: true })} liq`}</div>
        <button className="btn ghost" onClick={() => setOpen(!open)}>{open ? "Close" : "Actions"}</button>
      </div>
      {open && (
        <div className="acts">
          <label className="fld">Send to<input className="inp" placeholder={`default: you (${short(me)})`} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          {running ? (
            <>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn" onClick={call("Collect escrow", "collectEscrow", [t.address as Address, dest])}>Collect spent escrow ({hype(wei(a!.raised - a!.collected), 3)} HYPE)</button>
                <button className="btn sellbtn" onClick={call("Sweep escrow", "sweepEscrow", [t.address as Address, dest])}>Sweep ALL escrow ({hype(wei(a!.escrow), 3)} HYPE)</button>
                <button className="btn ghost" disabled={a!.collected > 0n || a!.swept} onClick={call("Cancel auction", "cancelAuction", [t.address as Address])}>Cancel auction</button>
                {!a!.open && <button className="btn" onClick={call("Settle auction", "finalize", [t.address as Address])}>Settle (big blocks)</button>}
              </div>
              <p className="note">Collect takes only HYPE bidders have already spent; refunds stay intact and the auction can no longer fail. Sweep takes everything including unspent budgets: bidders keep their coins, get no refund, and the pool opens with coins only. Cancel refunds everyone and is blocked once anything was collected.</p>
            </>
          ) : (
            <>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn ghost" onClick={call("Harvest fees", "harvestFees", [t.address as Address])}>Harvest fees (70/30)</button>
                <span className="row"><input className="inp" style={{ width: 90 }} inputMode="numeric" value={bps} onChange={(e) => setBps(e.target.value.replace(/[^0-9]/g, ""))} /><span className="small">bps</span><button className="btn" disabled={!(Number(bps) > 0 && Number(bps) <= 10000)} onClick={call("Collect liquidity", "collect", [t.address as Address, Number(bps), dest])}>Collect {(Number(bps) / 100).toFixed(0)}% of liquidity</button></span>
                <button className="btn sellbtn" onClick={call("Collect all liquidity", "collectFees", [t.address as Address])}>Collect everything to owner</button>
              </div>
              <p className="note">Collect pulls that share of the locked position (coins and HYPE) plus any fees sitting on it. Harvest only distributes accrued fees and anyone may call it.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
