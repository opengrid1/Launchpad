import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatEther, parseEther, type Address } from "viem";
import { useAccount } from "wagmi";
import type { CandleInterval } from "@launchpad/sdk";

import { Chart } from "../components/Chart";
import { Art } from "../components/Art";
import { Copy } from "../components/Copy";
import { client, type PairInfo } from "../lib/client";
import { env, FEES } from "../lib/env";
import { ago, dateShort, hype, num, pct, short, usd, wei } from "../lib/format";
import { runTx, useBalances, useCandles, useEthUsd, useFeeNow, useHolders, useRewards, useToken, useTrades, type Token } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const INTERVALS: CandleInterval[] = ["5m", "15m", "1h", "4h", "1d"];

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const { data: t, isLoading } = useToken(address);
  if (isLoading) return <main className="page"><div className="prog"><div className="art skeleton" style={{ minHeight: 88 }} /><div className="skeleton" style={{ height: 44, width: 240, minHeight: 0 }} /></div><div className="skeleton" style={{ minHeight: 340 }} /></main>;
  if (!t) return <main className="page"><section className="hero" style={{ gridTemplateColumns: "1fr" }}><div><h1>Not <em>here</em>.</h1><p className="sub">That address is not a coin launched on this factory.</p><Link to="/" className="btn ghost">Back to the feed</Link></div></section></main>;
  return <MarketPage t={t} />;
}

function MarketPage({ t }: { t: Token }) {
  const { data: ethUsd = 0 } = useEthUsd();
  const pair = t.pair;
  const [interval, setInterval_] = useState<CandleInterval>("15m");
  const [view, setView] = useState<"mcap" | "price">("mcap");
  const { data: candles } = useCandles(t.address, interval);
  const [tab, setTab] = useState<"trades" | "holders" | "about">("trades");
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const chg = t.priceChange24hPct;
  const links = [t.metadata?.website && { l: "Website", u: t.metadata.website }, t.metadata?.twitter && { l: "X", u: t.metadata.twitter }, t.metadata?.telegram && { l: "Telegram", u: t.metadata.telegram }].filter(Boolean) as { l: string; u: string }[];

  return (
    <main className="page">
      <div className="prog">
        <Art src={t.metadata?.logo} name={t.name} className="art" />
        <div>
          <h1>{t.name}</h1>
          <div className="meta"><span className="onair"><span className="dot" style={{ width: 6, height: 6, boxShadow: "none" }} />TRADING</span><span className="mono">{t.symbol}</span><span>pairs {pair.symbol}</span><span>by <a href={`${env.explorerUrl}/address/${t.creator}`} target="_blank" rel="noreferrer" style={{ color: "var(--green)" }}>{short(t.creator)}</a></span><span>since {dateShort(t.createdAt)}</span></div>
        </div>
        <div className="price">
          <div className="v">{usd(t.priceUsd)}</div>
          <div className={"c " + (chg == null ? "faint" : chg >= 0 ? "up" : "down")}>{chg == null ? "" : `${pct(chg)} · 24h`}</div>
        </div>
      </div>

      <div className="two">
        <div>
          <div className="panel" style={{ padding: 12 }}>
            <div className="head" style={{ padding: "2px 4px 8px", flexWrap: "wrap" }}>
              <div className="seg"><button className={view === "mcap" ? "on" : ""} onClick={() => setView("mcap")}>Market cap</button><button className={view === "price" ? "on" : ""} onClick={() => setView("price")}>Price</button></div>
              <div className="seg">{INTERVALS.map((i) => <button key={i} className={interval === i ? "on" : ""} onClick={() => setInterval_(i)}>{i}</button>)}</div>
            </div>
            {candles && candles.length > 1 ? <Chart candles={candles} hypeUsd={pair.usd} mode={view} /> : <div className="chart" style={{ display: "grid", placeItems: "center", color: "var(--ink3)" }}>{candles ? "Not enough trades for a chart yet. The first buy starts it." : "Loading chart…"}</div>}
          </div>
          <div className="tabs chips-row">
            {(["trades", "holders", "about"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k === "trades" ? "Trades" : k === "holders" ? "Holders" : "About"}</button>)}
          </div>
          {tab === "trades" && <Trades address={t.address} symbol={t.symbol} pair={pair} />}
          {tab === "holders" && <Holders address={t.address} creator={t.creator} />}
          {tab === "about" && (
            <div className="panel">
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t.metadata?.description || "The creator did not add a description."}</p>
              {links.length > 0 && <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>{links.map((l) => <a key={l.l} className="btn ghost" href={l.u} target="_blank" rel="noreferrer">{l.l}</a>)}</div>}
            </div>
          )}
        </div>

        <aside>
          <div className="panel desk" id="trade">
            <TradePanel token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} pair={pair} ethUsd={ethUsd} />
          </div>
          <Rewards token={t.address} pair={pair} />
          <div className="panel" style={{ marginTop: 14 }}>
            <div className="lbl" style={{ marginBottom: 6 }}>Details</div>
            <dl className="specs">
              <dt>Market cap</dt><dd>{usd(t.marketCapUsd, { compact: true })}</dd>
              <dt>Liquidity</dt><dd>{usd(wei(t.liquidityWei) * pair.usd, { compact: true })}</dd>
              <dt>Volume · 24h</dt><dd>{usd(wei(t.volume24hWei) * pair.usd, { compact: true })}</dd>
              <dt>Trades · 24h</dt><dd>{num(t.txCount24h, 0)}</dd>
              <dt>Holders</dt><dd>{num(t.holderCount, 0)}</dd>
              <dt>Pair</dt><dd>{pair.isNative ? "ETH" : <Copy value={pair.address} label={pair.symbol} />}</dd>
              <dt>Fee</dt><dd>{FEES.taxPct}% · {FEES.creatorPct}/{FEES.holderPct}/{FEES.platformPct}</dd>
              <dt>Paid out</dt><dd>{t.rewards ? `${hype(wei(t.rewards.holders + t.rewards.creator + t.rewards.platform), 4)} ${pair.symbol}` : "—"}</dd>
              <dt>Supply</dt><dd>1B fixed</dd>
              <dt>Launched</dt><dd>{dateShort(t.createdAt)}</dd>
              <dt>Contract</dt><dd><Copy value={t.address} label="Contract address" /></dd>
              <dt>Pool</dt><dd><Copy value={t.poolId} label="Pool id" /></dd>
              <dt>Links</dt><dd><a href={`${env.explorerUrl}/token/${t.address}`} target="_blank" rel="noreferrer">Etherscan</a> · <a href={`https://dexscreener.com/${env.dexscreenerChain}/${t.poolId}`} target="_blank" rel="noreferrer">DexScreener</a></dd>
            </dl>
          </div>
        </aside>
      </div>

      <div className="mobilebar">
        <button className="big" onClick={() => setSheet("buy")}>Buy</button>
        <button className="big sell" onClick={() => setSheet("sell")}>Sell</button>
      </div>
      {sheet && (
        <>
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet desk"><div className="grab" /><TradePanel token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} pair={pair} ethUsd={ethUsd} initial={sheet} /></div>
        </>
      )}
    </main>
  );
}

// ---------- trade ----------
function TradePanel({ token, symbol, priceWei, pair, ethUsd, initial = "buy" }: { token: Address; symbol: string; priceWei: bigint; pair: PairInfo; ethUsd: number; initial?: "buy" | "sell" }) {
  const { address: me, isConnected } = useAccount();
  const qc = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">(initial);
  const [amt, setAmt] = useState("");
  // Buyers pay ETH when the pair has an on-chain route, else the pair asset itself.
  const payEth = pair.ethRoute;
  const payUnit = payEth ? "ETH" : pair.symbol;
  const payUsd = payEth ? ethUsd : pair.usd;
  const { data: bal } = useBalances(me, token, pair.isNative ? undefined : pair.address);
  const { data: fee } = useFeeNow(token);
  const amountWei = useMemo(() => { try { return amt && Number(amt) > 0 ? parseEther(amt as `${number}`) : 0n; } catch { return 0n; } }, [amt]);
  const payBal = bal ? (payEth ? bal.native : bal.pair) : 0n;

  const { data: sim } = useQuery({
    queryKey: ["quote", token, side, amountWei.toString(), me],
    enabled: amountWei > 0n && isConnected,
    queryFn: async () => { await ensureWallet().catch(() => undefined); return client.previewSwapOut(token, side, amountWei); },
    staleTime: 8_000,
  });
  // Spot estimate: priceWei is pair units per coin; convert ETH input via USD when paying ETH on a stock pair.
  const pairPerEth = pair.usd > 0 && ethUsd > 0 ? ethUsd / pair.usd : 1;
  const spot = priceWei > 0n
    ? side === "buy"
      ? BigInt(Math.floor((Number(amountWei) * (payEth && !pair.isNative ? pairPerEth : 1) * 1e18) / Number(priceWei)))
      : BigInt(Math.floor((Number(amountWei) * Number(priceWei)) / 1e18 / (payEth && !pair.isNative ? pairPerEth : 1)))
    : 0n;
  const feeBps = fee?.total ?? FEES.taxPct * 100;
  const out = sim ?? (spot * BigInt(10_000 - feeBps)) / 10_000n;
  const outNum = wei(out);
  const impact = spot > 0n && sim != null ? (1 - Number(sim) / Number(spot)) * 100 : null;
  const surcharge = fee && fee.total > fee.base;

  const max = () => {
    if (!bal) return;
    if (side === "buy") { const keep = payEth ? parseEther("0.005") : 0n; setAmt(formatEther(payBal > keep ? payBal - keep : 0n)); }
    else setAmt(formatEther(bal.token));
  };
  const chip = (f: number) => {
    if (side === "buy") setAmt(String(f));
    else if (bal) setAmt(formatEther((bal.token * BigInt(Math.round(f * 100))) / 100n));
  };
  const over = side === "buy" ? !!bal && amountWei > payBal : !!bal && amountWei > bal.token;
  const buyChips = payEth ? [0.01, 0.05, 0.1, 0.5] : [0.01, 0.05, 0.1, 0.5];

  const go = async () => {
    if (!isConnected) return openWalletModal();
    await ensureWallet();
    const floor = (out * 95n) / 100n;
    const ok = await runTx(side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`, () => (side === "buy" ? client.buyToken(token, amountWei, floor) : client.sellToken(token, amountWei, floor)));
    if (ok) { setAmt(""); qc.invalidateQueries(); }
  };

  return (
    <>
      <div className="seg">
        <button className={side === "buy" ? "on" : ""} onClick={() => { setSide("buy"); setAmt(""); }}>Buy</button>
        <button className={side === "sell" ? "on sell" : ""} onClick={() => { setSide("sell"); setAmt(""); }}>Sell</button>
      </div>
      <div className="amount">
        <div className="lbl"><span>{side === "buy" ? "You pay" : "You sell"}</span><span>{bal ? (side === "buy" ? `${hype(wei(payBal), 4)} ${payUnit}` : `${num(wei(bal.token))} ${symbol}`) : ""}</span></div>
        <div className="in"><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="unit">{side === "buy" ? payUnit : symbol}</span></div>
      </div>
      <div className="chips">
        {side === "buy" ? buyChips.map((v) => <button key={v} onClick={() => chip(v)}>{v}</button>) : [0.25, 0.5, 0.75].map((v) => <button key={v} onClick={() => chip(v)}>{v * 100}%</button>)}
        <button onClick={max}>Max</button>
      </div>
      <dl className="quote">
        <dt>You get</dt><dd>{amountWei > 0n ? `${side === "buy" ? num(outNum) : hype(outNum, 5)} ${side === "buy" ? symbol : payUnit}` : "—"}</dd>
        <dt>Value</dt><dd>{amountWei > 0n ? usd(side === "buy" ? wei(amountWei) * payUsd : outNum * payUsd) : "—"}</dd>
        <dt>{sim != null ? "Price impact" : "Estimate"}</dt><dd>{sim != null ? (impact != null ? `${Math.max(0, impact).toFixed(2)}%` : "—") : "spot, before impact"}</dd>
        <dt>Fee</dt><dd>{surcharge ? <span className="down">{(feeBps / 100).toFixed(1)}% launch surcharge</span> : `${FEES.taxPct}% · ${FEES.creatorPct}% creator · ${FEES.holderPct}% holders · ${FEES.platformPct}% platform`}</dd>
      </dl>
      {surcharge && <div className="warn">Anti-snipe: the fee is {(feeBps / 100).toFixed(0)}% right now and drops to {FEES.taxPct}% within 20 seconds of launch. Wait a moment.</div>}
      {over && <div className="warn">More than you have.</div>}
      <button className={"big " + (side === "sell" ? "sell" : "")} disabled={isConnected && (amountWei === 0n || over)} onClick={go}>
        {!isConnected ? "Connect wallet" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
      </button>
      <p className="note">{pair.isNative ? "" : payEth ? `This coin trades against ${pair.symbol}. You pay and receive ETH; the router swaps through ${pair.symbol}'s own pool on the way. ` : `This coin trades against ${pair.symbol}, which has no ETH route on-chain. You pay and receive ${pair.symbol}. `}Slippage 5%. Trades settle on Uniswap V4.</p>
    </>
  );
}

// ---------- rewards ----------
function Rewards({ token, pair }: { token: Address; pair: PairInfo }) {
  const { address: me } = useAccount();
  const qc = useQueryClient();
  const { data } = useRewards(token, me);
  if (!data) return null;
  const canEth = pair.ethRoute && !pair.isNative;
  const unit = pair.symbol;
  const claim = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); await runTx(label, fn, async () => { await qc.invalidateQueries({ queryKey: ["rewards", token.toLowerCase()] }); await qc.invalidateQueries({ queryKey: ["bal"] }); }); };
  const anything = data.pending > 0n || (data.isCreator && data.creatorFees > 0n) || data.platformFees > 0n;
  return (
    <div className="panel pay" style={{ marginTop: 14 }}>
      <div className="between"><div><div className="lbl">Your rewards</div><div className="v">{hype(wei(data.pending), 5)} {unit}</div></div><span className="small mono">{me ? `${num(wei(data.balance))} held` : "connect to see"}</span></div>
      {data.pending > 0n && (
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={claim("Claim rewards", () => client.claimRewards(token, false))}>Claim {pair.isNative ? "ETH" : unit}</button>
          {canEth && <button className="btn ghost" onClick={claim("Claim as ETH", () => client.claimRewards(token, true))}>Claim as ETH</button>}
        </div>
      )}
      {data.isCreator && (
        <div style={{ marginTop: 14 }}>
          <div className="between"><div><div className="lbl">Creator fees</div><div className="v">{hype(wei(data.creatorFees), 5)} {unit}</div></div><span className="small mono">lifetime {hype(wei(data.totalCreator), 4)}</span></div>
          {data.creatorFees > 0n && (
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn" onClick={claim("Claim creator fees", () => client.claimCreatorFees(token, false))}>Claim {pair.isNative ? "ETH" : unit}</button>
              {canEth && <button className="btn ghost" onClick={claim("Claim creator fees as ETH", () => client.claimCreatorFees(token, true))}>Claim as ETH</button>}
            </div>
          )}
        </div>
      )}
      <p className="note">{FEES.holderPct}% of every trade fee is credited to holders as it happens, in {unit}. Hold the coin, earn on every trade, no harvest step.{data.platformFees > 0n ? ` Platform share waiting: ${hype(wei(data.platformFees), 5)} ${unit}.` : ""}</p>
      {!anything && <span />}
    </div>
  );
}

// ---------- trades / holders ----------
function Trades({ address, symbol, pair }: { address: Address; symbol: string; pair: PairInfo }) {
  const { data: trades } = useTrades(address);
  if (!trades) return <div className="skeleton" style={{ minHeight: 120 }} />;
  return (
    <div className="log">
      {trades.length === 0 && <div className="empty">No trades yet. The first buy sets the price.</div>}
      {trades.map((tr) => (
        <a key={tr.id} className="li" href={`${env.explorerUrl}/tx/${tr.txHash}`} target="_blank" rel="noreferrer">
          <span className="t">{ago(tr.timestamp)}</span>
          <span className={tr.isBuy ? "up" : "down"}>{tr.isBuy ? "BUY" : "SELL"}</span>
          <span className="who">{short(tr.trader)}</span>
          <span className="r">{num(wei(tr.tokenAmount))} {symbol}<small>{hype(wei(tr.nativeAmountWei), 4)} {pair.symbol} · {usd(wei(tr.nativeAmountWei) * pair.usd)}</small></span>
        </a>
      ))}
    </div>
  );
}

function Holders({ address, creator }: { address: Address; creator: Address }) {
  const { data: holders } = useHolders(address);
  if (!holders) return <div className="skeleton" style={{ minHeight: 120 }} />;
  return (
    <div className="log">
      {holders.length === 0 && <div className="empty">No holders found yet.</div>}
      {holders.map((h, i) => (
        <a key={h.address} className="li" href={`${env.explorerUrl}/address/${h.address}`} target="_blank" rel="noreferrer">
          <span className="t">#{i + 1}</span>
          <span className={h.address.toLowerCase() === creator.toLowerCase() ? "up" : "who"}>{h.address.toLowerCase() === creator.toLowerCase() ? "CREATOR" : ""}</span>
          <span className="who">{short(h.address)}</span>
          <span className="r">{h.pct.toFixed(2)}%<small>{num(wei(h.balance))}</small></span>
        </a>
      ))}
    </div>
  );
}
