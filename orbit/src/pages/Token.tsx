import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatEther, parseEther, type Address } from "viem";
import { useAccount } from "wagmi";
import type { CandleInterval } from "@launchpad/sdk";

import { Chart } from "../components/Chart";
import { Logo } from "../components/Logo";
import { client } from "../lib/client";
import { env } from "../lib/env";
import { ago, dateShort, hype, num, pct, short, usd, wei } from "../lib/format";
import { runTx, useBalances, useCandles, useHolders, useHypeUsd, useToken, useTrades } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const INTERVALS: CandleInterval[] = ["5m", "15m", "1h", "4h", "1d"];

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const { data: t, isLoading } = useToken(address);
  const { data: hypeUsd = 0 } = useHypeUsd();
  const [interval, setInterval_] = useState<CandleInterval>("15m");
  const { data: candles } = useCandles(address, interval);
  const [tab, setTab] = useState<"trades" | "holders" | "about">("trades");
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);

  if (isLoading) return <main className="page"><div className="token-head"><div className="art skeleton" style={{ minHeight: 96 }} /><div><div className="skeleton" style={{ height: 40, width: 220, minHeight: 0 }} /></div></div><div className="skeleton" style={{ minHeight: 340 }} /></main>;
  if (!t) return <main className="page"><section className="hero"><h1>Coin not found.</h1><p className="sub">That address is not a coin launched here.</p><Link to="/" className="learn">All coins</Link></section></main>;

  const chg = t.priceChange24hPct;
  const links = [t.metadata?.website && { l: "Website", u: t.metadata.website }, t.metadata?.twitter && { l: "X", u: t.metadata.twitter }, t.metadata?.telegram && { l: "Telegram", u: t.metadata.telegram }].filter(Boolean) as { l: string; u: string }[];

  return (
    <main className="page">
      <div className="token-head">
        <Logo src={t.metadata?.logo} name={t.name} className="art" />
        <div>
          <h1>{t.name}</h1>
          <div className="small">{t.symbol} · pairs HYPE · by <a href={`${env.explorerUrl}/address/${t.creator}`} target="_blank" rel="noreferrer">{short(t.creator)}</a></div>
        </div>
        <div className="price">
          <div className="v">{usd(t.priceUsd)}</div>
          <div className={"c " + (chg == null ? "faint" : chg >= 0 ? "up" : "down")}>{pct(chg)} today</div>
        </div>
      </div>

      <div className="two">
        <div>
          <div className="panel" style={{ padding: 12 }}>
            <div className="between" style={{ padding: "4px 8px 10px" }}>
              <span className="small">Price · USD</span>
              <div className="segmented">{INTERVALS.map((i) => <button key={i} className={interval === i ? "on" : ""} onClick={() => setInterval_(i)}>{i}</button>)}</div>
            </div>
            {candles && candles.length > 1 ? <Chart candles={candles} hypeUsd={hypeUsd} /> : <div className="chart" style={{ display: "grid", placeItems: "center", color: "var(--ink3)" }}>{candles ? "Not enough trades for a chart yet." : "Loading…"}</div>}
          </div>

          <div className="tabs">
            {(["trades", "holders", "about"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
          </div>
          {tab === "trades" && <Trades address={t.address} symbol={t.symbol} hypeUsd={hypeUsd} />}
          {tab === "holders" && <Holders address={t.address} creator={t.creator} pool={t.pool} />}
          {tab === "about" && (
            <div className="panel soft">
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t.metadata?.description || "The creator did not add a description."}</p>
              {links.length > 0 && <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>{links.map((l) => <a key={l.l} className="pillbtn quiet" href={l.u} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>{l.l}</a>)}</div>}
            </div>
          )}
        </div>

        <aside>
          <div className="panel trade" id="trade">
            <TradePanel token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} hypeUsd={hypeUsd} />
          </div>
          <Rewards token={t.address} />
          <div className="panel soft" style={{ marginTop: 14 }}>
            <dl className="specs">
              <dt>Market cap</dt><dd>{usd(t.marketCapUsd, { compact: true })}</dd>
              <dt>Liquidity</dt><dd>{usd(wei(t.liquidityWei) * hypeUsd, { compact: true })}</dd>
              <dt>Volume · 24h</dt><dd>{usd(wei(t.volume24hWei) * hypeUsd, { compact: true })}</dd>
              <dt>Trades · 24h</dt><dd>{num(t.txCount24h, 0)}</dd>
              <dt>Holders</dt><dd>{num(t.holderCount, 0)}</dd>
              <dt>Supply</dt><dd>1B fixed</dd>
              <dt>Launched</dt><dd>{dateShort(t.createdAt)}</dd>
              <dt>Contract</dt><dd><a href={`${env.explorerUrl}/token/${t.address}`} target="_blank" rel="noreferrer">{short(t.address)}</a></dd>
              <dt>Pool</dt><dd><a href={`https://dexscreener.com/${env.dexscreenerChain}/${t.pool}`} target="_blank" rel="noreferrer">DexScreener</a></dd>
            </dl>
          </div>
        </aside>
      </div>

      <div className="mobilebar">
        <button className="bigbtn" onClick={() => setSheet("buy")}>Buy</button>
        <button className="bigbtn sell" onClick={() => setSheet("sell")}>Sell</button>
      </div>
      {sheet && (
        <>
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet trade">
            <div className="grab" />
            <TradePanel token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} hypeUsd={hypeUsd} initial={sheet} />
          </div>
        </>
      )}
    </main>
  );
}

// ---------- trade ----------
function TradePanel({ token, symbol, priceWei, hypeUsd, initial = "buy" }: { token: Address; symbol: string; priceWei: bigint; hypeUsd: number; initial?: "buy" | "sell" }) {
  const { address: me, isConnected } = useAccount();
  const qc = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">(initial);
  const [amt, setAmt] = useState("");
  const { data: bal } = useBalances(me, token);
  const amountWei = useMemo(() => { try { return amt && Number(amt) > 0 ? parseEther(amt as `${number}`) : 0n; } catch { return 0n; } }, [amt]);

  // exact quote from a router simulation when a wallet is connected, spot estimate otherwise
  const { data: sim } = useQuery({
    queryKey: ["quote", token, side, amountWei.toString(), me],
    enabled: amountWei > 0n && isConnected,
    queryFn: async () => { await ensureWallet().catch(() => undefined); return client.previewSwapOut(token, side, amountWei); },
    staleTime: 8_000,
  });
  const spot = priceWei > 0n ? (side === "buy" ? (amountWei * 10n ** 18n) / priceWei : (amountWei * priceWei) / 10n ** 18n) : 0n;
  const out = sim ?? (spot * 99n) / 100n; // spot estimate minus the 1% pool fee
  const outNum = wei(out);
  const impact = spot > 0n && sim != null ? (1 - Number(sim) / Number(spot)) * 100 : null;

  const max = () => {
    if (!bal) return;
    if (side === "buy") { const keep = parseEther("0.01"); setAmt(formatEther(bal.native > keep ? bal.native - keep : 0n)); }
    else setAmt(formatEther(bal.token));
  };
  const chip = (f: number) => {
    if (!bal) return;
    if (side === "buy") setAmt(String(f));
    else setAmt(formatEther((bal.token * BigInt(Math.round(f * 100))) / 100n));
  };
  const over = side === "buy" ? !!bal && amountWei > bal.native : !!bal && amountWei > bal.token;

  const go = async () => {
    if (!isConnected) return openWalletModal();
    await ensureWallet();
    const floor = (out * 95n) / 100n; // 5% slippage; the client caps it at the real fill
    const ok = await runTx(side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`, () => (side === "buy" ? client.buyToken(token, amountWei, floor) : client.sellToken(token, amountWei, floor)));
    if (ok) { setAmt(""); qc.invalidateQueries(); }
  };

  return (
    <>
      <div className="segmented">
        <button className={side === "buy" ? "on" : ""} onClick={() => { setSide("buy"); setAmt(""); }}>Buy</button>
        <button className={side === "sell" ? "on sell" : ""} onClick={() => { setSide("sell"); setAmt(""); }}>Sell</button>
      </div>
      <div className="amount">
        <div className="lbl"><span>{side === "buy" ? "You pay" : "You sell"}</span><span>{bal ? (side === "buy" ? `${hype(wei(bal.native))} HYPE` : `${num(wei(bal.token))} ${symbol}`) : ""}</span></div>
        <div className="in"><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="unit">{side === "buy" ? "HYPE" : symbol}</span></div>
      </div>
      <div className="chips">
        {side === "buy" ? [0.1, 0.5, 1, 5].map((v) => <button key={v} onClick={() => chip(v)}>{v}</button>) : [0.25, 0.5, 0.75].map((v) => <button key={v} onClick={() => chip(v)}>{v * 100}%</button>)}
        <button onClick={max}>Max</button>
      </div>
      <dl className="quote">
        <dt>You receive</dt><dd><b>{amountWei > 0n ? `${side === "buy" ? num(outNum) : hype(outNum)} ${side === "buy" ? symbol : "HYPE"}` : "—"}</b></dd>
        <dt>Value</dt><dd><b>{amountWei > 0n ? usd(side === "buy" ? wei(amountWei) * hypeUsd : outNum * hypeUsd) : "—"}</b></dd>
        <dt>{sim != null ? "Price impact" : "Estimate"}</dt><dd><b>{sim != null ? (impact != null ? `${Math.max(0, impact).toFixed(2)}%` : "—") : "spot, before impact"}</b></dd>
        <dt>Fee</dt><dd><b>1% · to holders, creator, platform</b></dd>
      </dl>
      {over && <div className="warn">More than you have.</div>}
      <button className={"bigbtn " + (side === "sell" ? "sell" : "")} disabled={isConnected && (amountWei === 0n || over)} onClick={go}>
        {!isConnected ? "Connect wallet" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
      </button>
      <p className="note">Slippage 5%, capped to the real fill so the trade cannot revert on the floor. Trades settle on HyperSwap.</p>
    </>
  );
}

// ---------- rewards ----------
function Rewards({ token }: { token: Address }) {
  const { address: me } = useAccount();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["rewards", token, me],
    enabled: !!me,
    refetchInterval: 30_000,
    queryFn: () => client.baseRewards(token, me!),
  });
  if (!me || !data) return null;
  const claimable = wei(data.claimable);
  return (
    <div className="panel soft" style={{ marginTop: 14 }}>
      <div className="between">
        <div>
          <div className="small">Your holder rewards</div>
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", fontVariantNumeric: "tabular-nums" }}>{hype(claimable, 5)} HYPE</div>
        </div>
        <button className="pillbtn" disabled={data.claimable === 0n} onClick={async () => {
          await ensureWallet();
          await runTx("Claim rewards", async () => { const hs = await client.claimBaseRewards(token, me); if (!hs.length) throw new Error("Nothing to claim"); return hs[hs.length - 1]; }, async () => { await qc.invalidateQueries({ queryKey: ["rewards", token, me] }); });
        }}>Claim</button>
      </div>
      <p className="note" style={{ marginTop: 8 }}>Half of every trade's fee goes to holders, split by how much of the coin you hold. It waits here until you claim it.</p>
    </div>
  );
}

// ---------- trades / holders ----------
function Trades({ address, symbol, hypeUsd }: { address: Address; symbol: string; hypeUsd: number }) {
  const { data: trades } = useTrades(address);
  if (!trades) return <div className="skeleton" style={{ minHeight: 120 }} />;
  if (trades.length === 0) return <div className="panel soft"><p className="small" style={{ margin: 0 }}>No trades yet. The first buy sets the price.</p></div>;
  return (
    <div className="list">
      {trades.map((tr) => (
        <a key={tr.id} className="li" href={`${env.explorerUrl}/tx/${tr.txHash}`} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
          <div><span className={tr.isBuy ? "up" : "down"} style={{ fontWeight: 600 }}>{tr.isBuy ? "Buy" : "Sell"}</span> <span className="l2" style={{ display: "inline" }}>{short(tr.trader)} · {ago(tr.timestamp)}</span></div>
          <div className="r">{num(wei(tr.tokenAmount))} {symbol}<div className="l2">{hype(wei(tr.nativeAmountWei))} HYPE · {usd(wei(tr.nativeAmountWei) * hypeUsd)}</div></div>
        </a>
      ))}
    </div>
  );
}

function Holders({ address, creator, pool }: { address: Address; creator: Address; pool: Address }) {
  const { data: holders } = useHolders(address);
  if (!holders) return <div className="skeleton" style={{ minHeight: 120 }} />;
  const tag = (a: string) => (a.toLowerCase() === pool.toLowerCase() ? "pool" : a.toLowerCase() === creator.toLowerCase() ? "creator" : null);
  return (
    <div className="list">
      {holders.map((h, i) => (
        <a key={h.address} className="li" href={`${env.explorerUrl}/address/${h.address}`} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
          <div><span className="faint" style={{ display: "inline-block", width: 26 }}>{i + 1}</span>{short(h.address)} {tag(h.address) && <span className="badge">{tag(h.address)}</span>}</div>
          <div className="r">{h.pct.toFixed(2)}%<div className="l2">{num(wei(h.balance))}</div></div>
        </a>
      ))}
    </div>
  );
}

// keep the effect import in use for future live patches
void useEffect;
