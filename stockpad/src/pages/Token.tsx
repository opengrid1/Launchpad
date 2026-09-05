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
  if (isLoading) return <main className="page"><div className="skeleton" style={{ height: 90, marginBottom: 16 }} /><div className="skeleton" style={{ height: 420 }} /></main>;
  if (!t) return <main className="page"><section className="hero"><h1>Not <em>here</em>.</h1><p className="sub">That address is not a coin launched on this factory.</p><div className="cta"><Link to="/" className="btn ink">Back to coins</Link></div></section></main>;
  return <Coin t={t} />;
}

function Coin({ t }: { t: Token }) {
  const { data: ethUsd = 0 } = useEthUsd();
  const pair = t.pair;
  const [interval, setInterval_] = useState<CandleInterval>("15m");
  const [view, setView] = useState<"mcap" | "price">("mcap");
  const { data: candles } = useCandles(t.address, interval);
  const { data: tradeList } = useTrades(t.address);
  const last = tradeList?.[0];
  const [tab, setTab] = useState<"trades" | "holders" | "about">("trades");
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const chg = t.priceChange24hPct;
  const links = [t.metadata?.website && { l: "Website", u: t.metadata.website }, t.metadata?.twitter && { l: "X", u: t.metadata.twitter }, t.metadata?.telegram && { l: "Telegram", u: t.metadata.telegram }].filter(Boolean) as { l: string; u: string }[];
  const paid = t.rewards ? t.rewards.holders + t.rewards.creator + t.rewards.platform : 0n;

  return (
    <main className="page">
      <div className="head">
        <Art src={t.metadata?.logo} name={t.name} className="art" />
        <div>
          <h1>{t.name}<span>{t.symbol}</span></h1>
          <div className="meta">
            <span className={"stamp " + (pair.isNative ? "eth" : "stock")}><i />{pair.symbol} pair</span>
            <span>by <a href={`${env.explorerUrl}/address/${t.creator}`} target="_blank" rel="noreferrer">{short(t.creator)}</a></span>
            <span>{dateShort(t.createdAt)}</span>
            <Copy value={t.address} label="CA" />
          </div>
        </div>
        <div className="px">
          <div className="v">{usd(t.marketCapUsd, { compact: true })}</div>
          <div className="c"><span className={"chg " + (chg == null ? "" : chg >= 0 ? "up" : "down")}>{chg == null ? "no 24h data" : `${pct(chg)} 24h`}</span><span>{usd(t.priceUsd)} per {t.symbol}</span></div>
        </div>
      </div>

      <div className="desk">
        <div>
          <div className="panel market">
            <div className="mk-stats">
              <div><span>Price</span><b>{usd(t.priceUsd)}</b></div>
              <div><span>Market cap</span><b className={chg == null ? "" : chg >= 0 ? "up" : "down"}>{usd(t.marketCapUsd, { compact: true })}</b></div>
              <div><span>Volume 24h</span><b>{usd(wei(t.volume24hWei) * pair.usd, { compact: true })}</b></div>
              <div><span>Trades 24h</span><b>{num(t.txCount24h, 0)}</b></div>
              <div><span>Last trade</span><b>{last ? <><em className={last.isBuy ? "up" : "down"}>{last.isBuy ? "BUY" : "SELL"}</em> {usd(wei(last.nativeAmountWei) * pair.usd)}</> : "—"}</b></div>
              <div><span>Holders</span><b>{num(t.holderCount, 0)}</b></div>
            </div>
            <div className="mk-pair">
              <b>{t.symbol} / {pair.symbol}</b>
              <span>{hype(wei(t.priceWei || "0"), 5)} {pair.symbol} · {pair.symbol} at {usd(pair.usd)}</span>
            </div>
            <div className="chart-wrap">
              {candles ? <Chart candles={candles} hypeUsd={pair.usd} mode={view} volumeUsd={wei(t.volume24hWei) * pair.usd} /> : <div className="gc-empty">Loading chart…</div>}
            </div>
            <div className="chart-h">
              <div className="seg">{INTERVALS.map((i) => <button key={i} className={interval === i ? "on" : ""} onClick={() => setInterval_(i)}>{i}</button>)}</div>
              <div className="seg"><button className={view === "mcap" ? "on" : ""} onClick={() => setView("mcap")}>Mcap</button><button className={view === "price" ? "on" : ""} onClick={() => setView("price")}>Price</button></div>
            </div>
          </div>
          <div className="tabs">
            {(["trades", "holders", "about"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k}</button>)}
          </div>
          {tab === "trades" && <Trades address={t.address} symbol={t.symbol} pair={pair} />}
          {tab === "holders" && <Holders address={t.address} creator={t.creator} />}
          {tab === "about" && (
            <div className="panel" style={{ padding: 20 }}>
              <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--ink2)", maxWidth: 640 }}>{t.metadata?.description || "The creator did not add a description."}</p>
              {links.length > 0 && <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>{links.map((l) => <a key={l.l} className="btn sm" href={l.u} target="_blank" rel="noreferrer">{l.l}</a>)}</div>}
            </div>
          )}
        </div>

        <aside>
          <div className="panel ticket"><TradePanel token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} pair={pair} ethUsd={ethUsd} /></div>
          <Rewards token={t.address} pair={pair} />
          <div className="panel">
            <div className="panel-h"><span>Details</span><b>{pair.isNative ? "ETH pair" : `${pair.symbol} pair`}</b></div>
            <dl className="kv">
              <dt>Liquidity</dt><dd>{usd(wei(t.liquidityWei) * pair.usd, { compact: true })}</dd>
              <dt>Volume 24h</dt><dd>{usd(wei(t.volume24hWei) * pair.usd, { compact: true })} · {num(t.txCount24h, 0)} trades</dd>
              <dt>Holders</dt><dd>{num(t.holderCount, 0)}</dd>
              <dt>Fee</dt><dd>{FEES.taxPct}% · {FEES.creatorPct}/{FEES.holderPct}/{FEES.platformPct}</dd>
              <dt>Paid out</dt><dd>{hype(wei(paid), 4)} {pair.symbol} · {usd(wei(paid) * pair.usd, { compact: true })}</dd>
              <dt>Supply</dt><dd>1B fixed</dd>
              <dt>Pair</dt><dd>{pair.isNative ? "ETH" : <Copy value={pair.address} label={pair.symbol} />}</dd>
              <dt>Pool</dt><dd><Copy value={t.poolId} label="id" /></dd>
              <dt>Links</dt><dd><a className="acc" href={`${env.explorerUrl}/token/${t.address}`} target="_blank" rel="noreferrer">Etherscan</a> · <a className="acc" href={`https://dexscreener.com/${env.dexscreenerChain}/${t.poolId}`} target="_blank" rel="noreferrer">DexScreener</a></dd>
            </dl>
          </div>
        </aside>
      </div>

      <div className="mobilebar">
        <button className="big up" onClick={() => setSheet("buy")}>Buy</button>
        <button className="big down" onClick={() => setSheet("sell")}>Sell</button>
      </div>
      {sheet && (
        <>
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet"><div className="grab" /><TradePanel token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} pair={pair} ethUsd={ethUsd} initial={sheet} /></div>
        </>
      )}
    </main>
  );
}

function TradePanel({ token, symbol, priceWei, pair, ethUsd, initial = "buy" }: { token: Address; symbol: string; priceWei: bigint; pair: PairInfo; ethUsd: number; initial?: "buy" | "sell" }) {
  const { address: me, isConnected } = useAccount();
  const qc = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">(initial);
  const [amt, setAmt] = useState("");
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
  const pairPerEth = pair.usd > 0 && ethUsd > 0 ? ethUsd / pair.usd : 1;
  const k = payEth && !pair.isNative ? pairPerEth : 1;
  const spot = priceWei > 0n ? (side === "buy" ? BigInt(Math.floor((Number(amountWei) * k * 1e18) / Number(priceWei))) : BigInt(Math.floor((Number(amountWei) * Number(priceWei)) / 1e18 / k))) : 0n;
  const feeBps = fee?.total ?? FEES.taxPct * 100;
  const out = sim ?? (spot * BigInt(10_000 - feeBps)) / 10_000n;
  const outNum = wei(out);
  const impact = spot > 0n && sim != null ? (1 - Number(sim) / Number(spot)) * 100 : null;
  const surcharge = !!fee && fee.total > fee.base;
  const over = side === "buy" ? !!bal && amountWei > payBal : !!bal && amountWei > bal.token;
  const max = () => { if (!bal) return; if (side === "buy") { const keep = payEth ? parseEther("0.005") : 0n; setAmt(formatEther(payBal > keep ? payBal - keep : 0n)); } else setAmt(formatEther(bal.token)); };
  const chip = (f: number) => { if (side === "buy") setAmt(String(f)); else if (bal) setAmt(formatEther((bal.token * BigInt(Math.round(f * 100))) / 100n)); };
  const go = async () => {
    if (!isConnected) return openWalletModal();
    await ensureWallet();
    const floor = (out * 95n) / 100n;
    const ok = await runTx(side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`, () => (side === "buy" ? client.buyToken(token, amountWei, floor) : client.sellToken(token, amountWei, floor)));
    if (ok) { setAmt(""); qc.invalidateQueries(); }
  };
  return (
    <>
      <div className="seg" style={{ display: "flex" }}>
        <button style={{ flex: 1 }} className={side === "buy" ? "on up" : ""} onClick={() => { setSide("buy"); setAmt(""); }}>Buy</button>
        <button style={{ flex: 1 }} className={side === "sell" ? "on down" : ""} onClick={() => { setSide("sell"); setAmt(""); }}>Sell</button>
      </div>
      <div className="amount">
        <div className="lbl"><span>{side === "buy" ? "You pay" : "You sell"}</span><span>{bal ? (side === "buy" ? `${hype(wei(payBal), 4)} ${payUnit}` : `${num(wei(bal.token))} ${symbol}`) : ""}</span></div>
        <div className="in"><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="unit">{side === "buy" ? payUnit : symbol}</span></div>
      </div>
      <div className="chips">
        {side === "buy" ? [0.01, 0.05, 0.1, 0.5].map((v) => <button key={v} onClick={() => chip(v)}>{v}</button>) : [0.25, 0.5, 0.75].map((v) => <button key={v} onClick={() => chip(v)}>{v * 100}%</button>)}
        <button onClick={max}>Max</button>
      </div>
      <dl className="quote">
        <dt>You get</dt><dd>{amountWei > 0n ? `${side === "buy" ? num(outNum) : hype(outNum, 5)} ${side === "buy" ? symbol : payUnit}` : "—"}</dd>
        <dt>Value</dt><dd>{amountWei > 0n ? usd(side === "buy" ? wei(amountWei) * payUsd : outNum * payUsd) : "—"}</dd>
        <dt>{sim != null ? "Price impact" : "Quote"}</dt><dd>{sim != null ? (impact != null ? `${Math.max(0, impact).toFixed(2)}%` : "—") : "spot"}</dd>
        <dt>Fee</dt><dd className={surcharge ? "down" : ""}>{(feeBps / 100).toFixed(0)}%{surcharge ? " · launch surcharge" : ` · ${FEES.creatorPct}/${FEES.holderPct}/${FEES.platformPct}`}</dd>
      </dl>
      {surcharge && <div className="warn">Anti-snipe: the fee is {(feeBps / 100).toFixed(0)}% right now and drops back to {FEES.taxPct}% within 20 seconds of launch.</div>}
      {over && <div className="warn">More than you have.</div>}
      <button className={"big " + (side === "sell" ? "down" : "up")} disabled={isConnected && (amountWei === 0n || over)} onClick={go}>{!isConnected ? "Connect wallet" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}</button>
      <p className="note">{pair.isNative ? "" : payEth ? `Priced in ${pair.symbol}. You pay and receive ETH; the router goes through ${pair.symbol}'s pool. ` : `Priced in ${pair.symbol}, which has no ETH route on-chain: you pay and receive ${pair.symbol}. `}Slippage 5%. Settles on Uniswap V4.</p>
    </>
  );
}

function Rewards({ token, pair }: { token: Address; pair: PairInfo }) {
  const { address: me } = useAccount();
  const qc = useQueryClient();
  const { data } = useRewards(token, me);
  if (!data) return null;
  const canEth = pair.ethRoute && !pair.isNative;
  const unit = pair.symbol;
  const claim = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); await runTx(label, fn, async () => { await qc.invalidateQueries({ queryKey: ["rewards", token.toLowerCase()] }); await qc.invalidateQueries({ queryKey: ["bal"] }); }); };
  return (
    <div className="panel pay">
      <div className="between"><div><div className="caps">Your rewards</div><div className="v">{hype(wei(data.pending), 5)} <span className="dim" style={{ fontSize: 14, fontWeight: 600 }}>{unit}</span></div></div><span className="faint" style={{ fontSize: 12 }}>{me ? `${num(wei(data.balance))} held` : "connect to see"}</span></div>
      {data.pending > 0n && <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}><button className="btn acc sm" onClick={claim("Claim rewards", () => client.claimRewards(token, false))}>Claim {pair.isNative ? "ETH" : unit}</button>{canEth && <button className="btn sm" onClick={claim("Claim as ETH", () => client.claimRewards(token, true))}>Claim as ETH</button>}</div>}
      {data.isCreator && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          <div className="between"><div><div className="caps">Creator fees</div><div className="v">{hype(wei(data.creatorFees), 5)} <span className="dim" style={{ fontSize: 14, fontWeight: 600 }}>{unit}</span></div></div><span className="faint" style={{ fontSize: 12 }}>lifetime {hype(wei(data.totalCreator), 4)}</span></div>
          {data.creatorFees > 0n && <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}><button className="btn acc sm" onClick={claim("Claim creator fees", () => client.claimCreatorFees(token, false))}>Claim {pair.isNative ? "ETH" : unit}</button>{canEth && <button className="btn sm" onClick={claim("Claim creator fees as ETH", () => client.claimCreatorFees(token, true))}>Claim as ETH</button>}</div>}
        </div>
      )}
      <p className="note">{FEES.holderPct}% of every fee goes to holders the moment a trade happens, in {unit}. Nothing to harvest.{data.platformFees > 0n ? ` Platform share waiting: ${hype(wei(data.platformFees), 5)} ${unit}.` : ""}</p>
    </div>
  );
}

function Trades({ address, symbol, pair }: { address: Address; symbol: string; pair: PairInfo }) {
  const { data: trades } = useTrades(address);
  if (!trades) return <div className="skeleton" style={{ height: 140 }} />;
  return (
    <div className="log">
      {trades.length === 0 && <div className="empty">No trades yet. The first buy sets the price.</div>}
      {trades.map((tr) => (
        <a key={tr.id} className="li" href={`${env.explorerUrl}/tx/${tr.txHash}`} target="_blank" rel="noreferrer">
          <span className="t">{ago(tr.timestamp)}</span>
          <span className={"side " + (tr.isBuy ? "up" : "down")}>{tr.isBuy ? "BUY" : "SELL"}</span>
          <span className="who">{short(tr.trader)}</span>
          <span className="r">{num(wei(tr.tokenAmount))} {symbol}<small>{hype(wei(tr.nativeAmountWei), 4)} {pair.symbol} · {usd(wei(tr.nativeAmountWei) * pair.usd)}</small></span>
        </a>
      ))}
    </div>
  );
}

function Holders({ address, creator }: { address: Address; creator: Address }) {
  const { data: holders } = useHolders(address);
  if (!holders) return <div className="skeleton" style={{ height: 140 }} />;
  return (
    <div className="log">
      {holders.length === 0 && <div className="empty">No holders found yet.</div>}
      {holders.map((h, i) => {
        const dev = h.address.toLowerCase() === creator.toLowerCase();
        return (
          <a key={h.address} className="li" href={`${env.explorerUrl}/address/${h.address}`} target="_blank" rel="noreferrer">
            <span className="t">#{i + 1}</span>
            <span className={"side " + (dev ? "acc" : "faint")}>{dev ? "DEV" : ""}</span>
            <span className="who">{short(h.address)}</span>
            <span className="r">{h.pct.toFixed(2)}%<small>{num(wei(h.balance))}</small></span>
          </a>
        );
      })}
    </div>
  );
}
