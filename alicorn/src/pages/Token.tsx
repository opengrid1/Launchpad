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
import { env, FEES, isPinned } from "../lib/env";
import { ago, cnum, dateShort, hype, num, pct, short, usd, wei } from "../lib/format";
import { runTx, useBalances, useCandles, useEthUsd, useFeeNow, useHolders, useRewards, useToken, useTrades, type Token } from "../lib/hooks";
import { isTokenPair, stockByAddress } from "../lib/stocks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const INTERVALS: CandleInterval[] = ["5m", "15m", "1h", "4h", "1d"];

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const { data: t, isLoading } = useToken(address);
  if (isLoading) return <main><div className="skel" style={{ height: 60, marginBottom: 16 }} /><div className="skel" style={{ height: 420 }} /></main>;
  if (!t) return <main className="gate"><h1>Coin not found</h1><p>That address was not launched on this factory.</p><Link to="/" className="b">Back to coins</Link></main>;
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
  const kind = pair.isNative ? "eth" : isTokenPair(pair.address) ? "token" : "stock";
  const meta = stockByAddress(pair.address);
  const fees = t.rewards ? t.rewards.holders + t.rewards.creator + t.rewards.platform : 0n;

  return (
    <main>
      <div className="tk-h">
        <Art src={t.metadata?.logo} name={t.name} className="art" />
        <div>
          <h1>{t.name}<span>{t.symbol}</span>{isPinned(t.address) && <span className="chip official">Official</span>}</h1>
          <div className="meta">
            <span className={"chip " + kind}>Pays in {pair.symbol}</span>
            <span>Created {dateShort(t.createdAt)} by <a href={`${env.explorerUrl}/address/${t.creator}`} target="_blank" rel="noreferrer">{short(t.creator)}</a></span>
            <Copy value={t.address} label="CA" />
            {links.map((l) => <a key={l.l} href={l.u} target="_blank" rel="noreferrer">{l.l}</a>)}
          </div>
        </div>
        <div className="price">
          <div className="v">{usd(t.priceUsd)}</div>
          <div className="c"><b className={chg == null ? "faint" : chg >= 0 ? "up" : "down"}>{chg == null ? "no 24h data" : `${pct(chg)} 24h`}</b>{hype(wei(t.priceWei || "0"), 6)} {pair.symbol}</div>
        </div>
      </div>

      <div className="tk">
        <div>
          <div className="card">
            <div className="strip">
              <div><span>Market cap</span><b>{usd(t.marketCapUsd, { compact: true })}</b></div>
              <div><span>Volume 24h</span><b>{usd(wei(t.volume24hWei) * pair.usd, { compact: true })}</b></div>
              <div><span>Trades 24h</span><b>{num(t.txCount24h, 0)}</b></div>
              <div><span>Holders</span><b>{num(t.holderCount, 0)}</b></div>
              <div><span>Paid to holders</span><b className="vi">{t.rewards ? `${num(wei(t.rewards.holders), 4)} ${pair.symbol}` : "—"}</b></div>
              <div><span>Last trade</span><b>{last ? <><span className={last.isBuy ? "up" : "down"}>{last.isBuy ? "Buy" : "Sell"}</span> {usd(wei(last.nativeAmountWei) * pair.usd)}</> : "—"}</b></div>
            </div>
            <div className="chart-h">
              <span className="pair"><b>{t.symbol}/{pair.symbol}</b> · {pair.symbol} {usd(pair.usd)}</span>
              <div className="row-flex">
                <div className="seg">{INTERVALS.map((i) => <button key={i} className={interval === i ? "on" : ""} onClick={() => setInterval_(i)}>{i}</button>)}</div>
                <div className="seg"><button className={view === "mcap" ? "on" : ""} onClick={() => setView("mcap")}>Mcap</button><button className={view === "price" ? "on" : ""} onClick={() => setView("price")}>Price</button></div>
              </div>
            </div>
            <div className="chart-b">{candles ? <Chart candles={candles} hypeUsd={pair.usd} mode={view} volumeUsd={wei(t.volume24hWei) * pair.usd} /> : <div className="gc-empty">Chart loads with the first trade.</div>}</div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="tabs">{(["trades", "holders", "about"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k}</button>)}</div>
            {tab === "trades" && <Trades address={t.address} symbol={t.symbol} pair={pair} />}
            {tab === "holders" && <Holders address={t.address} creator={t.creator} />}
            {tab === "about" && <div className="about">{t.metadata?.description || "The creator did not add a description."}</div>}
          </div>
        </div>

        <aside>
          <div className="card trade desk"><div className="card-b"><TradeBox token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} pair={pair} ethUsd={ethUsd} /></div></div>
          <div className="card" style={{ marginTop: 12 }}><Yours token={t.address} pair={pair} /></div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-h"><h2>Pool</h2><span className="eyebrow">Uniswap V4</span></div>
            <div className="card-b">
              <dl className="kv">
                <dt>Pair asset</dt><dd>{pair.isNative ? "ETH" : `${meta?.name ?? pair.symbol} (${pair.symbol})`}</dd>
                <dt>Pair price</dt><dd>{usd(pair.usd)}</dd>
                <dt>ETH route</dt><dd>{pair.isNative ? "Native" : pair.ethRoute ? `ETH → ${meta?.route?.via === "WETH" ? "" : `${meta?.route?.via} → `}${pair.symbol}` : "None, pay in the asset"}</dd>
                {!pair.isNative && <><dt>Pair contract</dt><dd><Copy value={pair.address} label={pair.symbol} /></dd></>}
                <dt>Liquidity</dt><dd>{t.reserves ? <>{hype(wei(t.reserves.pair), 4)} {pair.symbol} · {usd(wei(t.reserves.pair) * pair.usd, { compact: true })}<span className="dim">{cnum(wei(t.reserves.token))} {t.symbol}</span></> : usd(wei(t.liquidityWei) * pair.usd, { compact: true })}</dd>
                <dt>Fees collected</dt><dd>{hype(wei(fees), 4)} {pair.symbol}<span className="dim">{FEES.taxPct}% per trade · {FEES.holderPct}/{FEES.creatorPct}/{FEES.platformPct} split</span></dd>
                <dt>Supply</dt><dd>1B fixed<span className="dim">liquidity burned</span></dd>
                <dt>Pool id</dt><dd><Copy value={t.poolId} label="pool" /></dd>
                <dt>Links</dt><dd><a className="vi" href={`${env.explorerUrl}/token/${t.address}`} target="_blank" rel="noreferrer">Etherscan</a> · <a className="vi" href={`https://dexscreener.com/${env.dexscreenerChain}/${t.poolId}`} target="_blank" rel="noreferrer">DexScreener</a></dd>
              </dl>
            </div>
          </div>
        </aside>
      </div>

      <div className="mobilebar">
        <button className="b buy" onClick={() => setSheet("buy")}>Buy</button>
        <button className="b sell" onClick={() => setSheet("sell")}>Sell</button>
      </div>
      {sheet && (
        <>
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet"><div className="grab" /><div className="trade"><TradeBox token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} pair={pair} ethUsd={ethUsd} initial={sheet} /></div></div>
        </>
      )}
    </main>
  );
}

/** Your rewards from this coin, and the claim buttons. */
function Yours({ token, pair }: { token: Address; pair: PairInfo }) {
  const { address: me } = useAccount();
  const qc = useQueryClient();
  const { data } = useRewards(token, me);
  const unit = pair.symbol;
  const canEth = pair.ethRoute && !pair.isNative;
  const act = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); await runTx(label, fn, async () => { await qc.invalidateQueries({ queryKey: ["rewards", token.toLowerCase()] }); await qc.invalidateQueries({ queryKey: ["bal"] }); }); };
  return (
    <>
      <div className="card-h"><h2>Your rewards</h2><span className="eyebrow">{FEES.holderPct}% of every fee</span></div>
      <div className="card-b rw">
        <span className="eyebrow">Claimable</span>
        <div className="big">{data ? hype(wei(data.pending), 5) : "—"}<small>{unit}</small></div>
        <div className="sub">{!me ? "Connect a wallet to see your balance and rewards." : data ? `${num(wei(data.balance))} held · ${usd(wei(data.pending) * pair.usd)} claimable` : "Loading…"}</div>
        {!me && <div className="row-flex"><button className="b sm" onClick={() => openWalletModal()}>Connect wallet</button></div>}
        {data && data.pending > 0n && <div className="row-flex"><button className="b pri sm" onClick={act("Claim rewards", () => client.claimRewards(token, false))}>Claim {unit}</button>{canEth && <button className="b sm" onClick={act("Claim as ETH", () => client.claimRewards(token, true))}>Claim as ETH</button>}</div>}
        {data?.isCreator && (
          <div className="creator">
            <span className="eyebrow">Creator fees · lifetime {hype(wei(data.totalCreator), 4)} {unit}</span>
            <div className="big" style={{ fontSize: 20 }}>{hype(wei(data.creatorFees), 5)}<small>{unit}</small></div>
            {data.creatorFees > 0n && <div className="row-flex"><button className="b pri sm" onClick={act("Claim creator fees", () => client.claimCreatorFees(token, false))}>Claim {unit}</button>{canEth && <button className="b sm" onClick={act("Claim creator fees as ETH", () => client.claimCreatorFees(token, true))}>Claim as ETH</button>}</div>}
          </div>
        )}
        <p className="fine">Rewards are credited in {unit} as each trade settles. Hold the coin and they accrue. Claim any time.</p>
      </div>
    </>
  );
}

function TradeBox({ token, symbol, priceWei, pair, ethUsd, initial = "buy" }: { token: Address; symbol: string; priceWei: bigint; pair: PairInfo; ethUsd: number; initial?: "buy" | "sell" }) {
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
  const holdersCut = amountWei > 0n ? wei(side === "buy" ? amountWei : out) * payUsd * (FEES.taxPct / 100) * (FEES.holderPct / 100) : 0;
  return (
    <>
      <div className="seg" style={{ display: "flex" }}>
        <button style={{ flex: 1 }} className={side === "buy" ? "on buy" : ""} onClick={() => { setSide("buy"); setAmt(""); }}>Buy</button>
        <button style={{ flex: 1 }} className={side === "sell" ? "on sell" : ""} onClick={() => { setSide("sell"); setAmt(""); }}>Sell</button>
      </div>
      <div className="amount">
        <div className="lbl"><span>{side === "buy" ? "You pay" : "You sell"}</span><button type="button" onClick={max}>{bal ? (side === "buy" ? `${hype(wei(payBal), 4)} ${payUnit}` : `${num(wei(bal.token))} ${symbol}`) : "Max"}</button></div>
        <div className="in-row"><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="u">{side === "buy" ? payUnit : symbol}</span></div>
      </div>
      <div className="chips">{side === "buy" ? [0.01, 0.05, 0.1, 0.5].map((v) => <button key={v} onClick={() => chip(v)}>{v}</button>) : [0.25, 0.5, 0.75, 1].map((v) => <button key={v} onClick={() => chip(v)}>{v * 100}%</button>)}</div>
      <dl className="quote">
        <dt>You receive</dt><dd><b>{amountWei > 0n ? `${side === "buy" ? num(outNum) : hype(outNum, 5)} ${side === "buy" ? symbol : payUnit}` : "—"}</b></dd>
        <dt>Value</dt><dd><b>{amountWei > 0n ? usd(side === "buy" ? wei(amountWei) * payUsd : outNum * payUsd) : "—"}</b></dd>
        <dt>{sim != null ? "Price impact" : "Quote"}</dt><dd><b>{sim != null ? (impact != null ? `${Math.max(0, impact).toFixed(2)}%` : "—") : "Spot"}</b></dd>
        <dt>Fee</dt><dd><b className={surcharge ? "down" : ""}>{(feeBps / 100).toFixed(0)}%{surcharge ? " (launch)" : ""}<span className="faint" style={{ fontWeight: 400 }}> · {usd(holdersCut)} to holders</span></b></dd>
      </dl>
      {surcharge && <div className="warn">Launch protection: the fee is {(feeBps / 100).toFixed(0)}% right now and drops to {FEES.taxPct}% within 30 seconds of launch.</div>}
      {over && <div className="warn">Amount is more than your balance.</div>}
      <button className={"b lg wide " + (side === "sell" ? "sell" : "buy")} disabled={isConnected && (amountWei === 0n || over)} onClick={go}>{!isConnected ? "Connect wallet" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}</button>
      <p className="fine">{pair.isNative ? "" : payEth ? `Priced in ${pair.symbol}. You pay and receive ETH; the router swaps through ${pair.symbol}. ` : `Priced in ${pair.symbol}, which has no ETH route: you pay and receive ${pair.symbol}. `}Slippage 5%.</p>
    </>
  );
}

const PAGE = 12;

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="b ghost sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Prev</button>
      <span>{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</span>
      <button className="b ghost sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

function Trades({ address, symbol, pair }: { address: Address; symbol: string; pair: PairInfo }) {
  const { data: trades } = useTrades(address);
  const [page, setPage] = useState(0);
  if (!trades) return <div className="skel" style={{ height: 140, margin: 12 }} />;
  const slice = trades.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="log">
      {trades.length === 0 && <div className="empty">No trades yet. The first buy sets the price.</div>}
      {slice.map((tr) => (
        <a key={tr.id} className="li" href={`${env.explorerUrl}/tx/${tr.txHash}`} target="_blank" rel="noreferrer">
          <span className="t">{ago(tr.timestamp)}</span>
          <span className={"side " + (tr.isBuy ? "up" : "down")}>{tr.isBuy ? "Buy" : "Sell"}</span>
          <span className="who">{short(tr.trader)}</span>
          <span className="r">{num(wei(tr.tokenAmount))} {symbol}<small>{hype(wei(tr.nativeAmountWei), 4)} {pair.symbol} · {usd(wei(tr.nativeAmountWei) * pair.usd)}</small></span>
        </a>
      ))}
      <Pager page={page} total={trades.length} onPage={setPage} />
    </div>
  );
}

function Holders({ address, creator }: { address: Address; creator: Address }) {
  const { data: holders } = useHolders(address);
  if (!holders) return <div className="skel" style={{ height: 140, margin: 12 }} />;
  const slice = holders.slice(0, PAGE);
  return (
    <div className="log">
      {holders.length === 0 && <div className="empty">No holders found yet.</div>}
      {slice.map((h, i) => {
        const dev = h.address.toLowerCase() === creator.toLowerCase();
        return (
          <a key={h.address} className="li" href={`${env.explorerUrl}/address/${h.address}`} target="_blank" rel="noreferrer">
            <span className="t">#{i + 1}</span>
            <span className={"side " + (dev ? "vi" : "faint")}>{dev ? "Dev" : ""}</span>
            <span className="who">{short(h.address)}</span>
            <span className="r">{h.pct.toFixed(2)}%<small>{num(wei(h.balance))}</small></span>
          </a>
        );
      })}
      {holders.length > PAGE && <p className="note" style={{ textAlign: "center", maxWidth: "none", padding: "10px 0 12px", margin: 0 }}>Top {PAGE}. Full list on <a className="vi" href={`${env.explorerUrl}/token/${address}#balances`} target="_blank" rel="noreferrer">Etherscan</a>.</p>}
    </div>
  );
}
