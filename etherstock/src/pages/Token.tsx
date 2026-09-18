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
import { runTx, useBalances, useCandles, useEthUsd, useFeeNow, useHolders, useLedger, useToken, useTrades, type Token } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const INTERVALS: CandleInterval[] = ["5m", "15m", "1h", "4h", "1d"];

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const { data: t, isLoading } = useToken(address);
  if (isLoading) return <main><div className="skel" style={{ height: 80, marginBottom: 16 }} /><div className="skel" style={{ height: 380 }} /></main>;
  if (!t) return <main className="gate"><h1>Not a coin here.</h1><p>That address was not launched on this factory.</p><Link to="/" className="b pri">Back to the board</Link></main>;
  return <Coin t={t} />;
}

/** Coin page in bands: identity, a stat strip, chart beside the burn ledger,
 *  then the order dock across the full width, then the logs. */
function Coin({ t }: { t: Token }) {
  const { data: ethUsd = 0 } = useEthUsd();
  const pair = t.pair;
  const [interval, setInterval_] = useState<CandleInterval>("15m");
  const [view, setView] = useState<"mcap" | "price">("mcap");
  const { data: candles } = useCandles(t.address, interval);
  const { data: tradeList } = useTrades(t.address);
  const last = tradeList?.[0];
  const [tab, setTab] = useState<"trades" | "holders" | "about" | "details">("trades");
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const chg = t.priceChange24hPct;
  const links = [t.metadata?.website && { l: "Website", u: t.metadata.website }, t.metadata?.twitter && { l: "X", u: t.metadata.twitter }, t.metadata?.telegram && { l: "Telegram", u: t.metadata.telegram }].filter(Boolean) as { l: string; u: string }[];
  const fees = t.fees ? t.fees.burn + t.fees.creator + t.fees.platform : 0n;
  const burnedPct = t.burn ? (Number(t.burn.burned) / 1e27) * 100 : 0;
  const supplyLeft = 1e9 - wei(t.burn?.burned ?? 0n);

  return (
    <main>
      <div className="coin-id">
        <Art src={t.metadata?.logo} name={t.name} className="art" />
        <div>
          <h1>{t.name}<span>{t.symbol}</span>{isPinned(t.address) && <span className="chip official">official</span>}</h1>
          <div className="meta">
            <span className={"chip " + (pair.isNative ? "eth" : "stock")}>{pair.symbol} pair</span>
            <span>by <a href={`${env.explorerUrl}/address/${t.creator}`} target="_blank" rel="noreferrer">{short(t.creator)}</a></span>
            <span>{dateShort(t.createdAt)}</span>
            <Copy value={t.address} label="CA" />
          </div>
        </div>
        <div className="coin-px">
          <div className="v">{usd(t.priceUsd)}</div>
          <div className="c"><span className={chg == null ? "" : chg >= 0 ? "up" : "down"}>{chg == null ? "no 24h data" : `${pct(chg)} 24h`}</span><span>{hype(wei(t.priceWei || "0"), 6)} {pair.symbol}</span></div>
        </div>
      </div>

      <div className="strip">
        <div><span className="lbl">Market cap</span><b>{usd(t.marketCapUsd, { compact: true })}</b></div>
        <div><span className="lbl">Supply left</span><b>{cnum(supplyLeft)} <span className="faint">/ 1B</span></b></div>
        <div><span className="lbl">Burned</span><b className="ember">{burnedPct.toFixed(2)}%</b></div>
        <div><span className="lbl">Volume 24h</span><b>{usd(wei(t.volume24hWei) * pair.usd, { compact: true })}</b></div>
        <div><span className="lbl">Trades 24h</span><b>{num(t.txCount24h, 0)}</b></div>
        <div><span className="lbl">Holders</span><b>{num(t.holderCount, 0)}</b></div>
        <div><span className="lbl">Last trade</span><b>{last ? <><span className={last.isBuy ? "up" : "down"}>{last.isBuy ? "BUY" : "SELL"}</span> {usd(wei(last.nativeAmountWei) * pair.usd)}</> : "—"}</b></div>
      </div>

      <div className="coin-grid">
        <div className="chartbox">
          <div className="chart-h">
            <span className="pair"><b>{t.symbol} / {pair.symbol}</b> · {pair.symbol} at {usd(pair.usd)}</span>
            <div className="row">
              <div className="seg">{INTERVALS.map((i) => <button key={i} className={interval === i ? "on" : ""} onClick={() => setInterval_(i)}>{i}</button>)}</div>
              <div className="seg"><button className={view === "mcap" ? "on" : ""} onClick={() => setView("mcap")}>Mcap</button><button className={view === "price" ? "on" : ""} onClick={() => setView("price")}>Price</button></div>
            </div>
          </div>
          {candles ? <Chart candles={candles} hypeUsd={pair.usd} mode={view} volumeUsd={wei(t.volume24hWei) * pair.usd} supply={wei(t.totalSupply || "0") || 1e9} /> : <div className="gc-empty">Loading chart…</div>}
        </div>
        <Ledger token={t.address} pair={pair} symbol={t.symbol} />
      </div>

      <Dock token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} pair={pair} ethUsd={ethUsd} />

      <div className="tabs">
        {(["trades", "holders", "about", "details"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k}</button>)}
      </div>
      {tab === "trades" && <Trades address={t.address} symbol={t.symbol} pair={pair} />}
      {tab === "holders" && <Holders address={t.address} creator={t.creator} />}
      {tab === "about" && (
        <div className="about">
          {t.metadata?.description || "The creator did not add a description."}
          {links.length > 0 && <div className="row" style={{ marginTop: 14 }}>{links.map((l) => <a key={l.l} className="b sm" href={l.u} target="_blank" rel="noreferrer">{l.l}</a>)}</div>}
        </div>
      )}
      {tab === "details" && (
        <dl className="kv" style={{ padding: "18px 4px" }}>
          <dt>In the pool</dt><dd>{t.reserves ? <>{hype(wei(t.reserves.pair), 4)} {pair.symbol} · {usd(wei(t.reserves.pair) * pair.usd, { compact: true })}<span className="dim">{cnum(wei(t.reserves.token))} {t.symbol}</span></> : usd(wei(t.liquidityWei) * pair.usd, { compact: true })}</dd>
          <dt>Fees so far</dt><dd>{hype(wei(fees), 4)} {pair.symbol} · {usd(wei(fees) * pair.usd, { compact: true })}<span className="dim">{FEES.taxPct}% per trade · {FEES.creatorPct} creator / {FEES.burnPct} burn / {FEES.platformPct} platform</span></dd>
          <dt>Burned</dt><dd>{t.burn ? <>{num(wei(t.burn.burned), 0)} {t.symbol} · {burnedPct.toFixed(2)}%<span className="dim">{hype(wei(t.burn.spent), 4)} {pair.symbol} spent on buybacks</span></> : "—"}</dd>
          <dt>Pair</dt><dd>{pair.isNative ? "ETH" : <Copy value={pair.address} label={pair.symbol} />}</dd>
          <dt>Pool</dt><dd><Copy value={t.poolId} label="pool id" /></dd>
          <dt>Links</dt><dd><a className="ember" href={`${env.explorerUrl}/token/${t.address}`} target="_blank" rel="noreferrer">Etherscan</a> · <a className="ember" href={`https://dexscreener.com/${env.dexscreenerChain}/${t.poolId}`} target="_blank" rel="noreferrer">DexScreener</a></dd>
        </dl>
      )}

      <div className="mobilebar">
        <button className="b buy" onClick={() => setSheet("buy")}>Buy</button>
        <button className="b sell" onClick={() => setSheet("sell")}>Sell</button>
      </div>
      {sheet && (
        <>
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet"><div className="grab" /><Dock token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} pair={pair} ethUsd={ethUsd} initial={sheet} /></div>
        </>
      )}
    </main>
  );
}

/** The burn ledger: what has burned, the fuse toward the next burn, a manual
 *  trigger, and the creator's claim when it is the creator looking. */
function Ledger({ token, pair, symbol }: { token: Address; pair: PairInfo; symbol: string }) {
  const { address: me } = useAccount();
  const qc = useQueryClient();
  const { data } = useLedger(token, me);
  if (!data) return <div className="skel" style={{ minHeight: 320 }} />;
  const canEth = pair.ethRoute && !pair.isNative;
  const unit = pair.symbol;
  const burnedPct = (Number(data.burned) / 1e27) * 100;
  const fill = data.buybackMin > 0n ? Math.min(100, (Number(data.reserve) / Number(data.buybackMin)) * 100) : 0;
  const armed = fill >= 100;
  const act = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); await runTx(label, fn, async () => { await qc.invalidateQueries({ queryKey: ["ledger", token.toLowerCase()] }); await qc.invalidateQueries({ queryKey: ["token", token.toLowerCase()] }); await qc.invalidateQueries({ queryKey: ["tokens"] }); }); };
  return (
    <div className="ledger">
      <div>
        <div className="lbl">Burn ledger</div>
        <div className="big">{burnedPct.toFixed(2)}%<small>of supply gone</small></div>
      </div>
      <div className="row2">
        <div><span className="lbl">Coins burned</span><b>{cnum(wei(data.burned))}</b></div>
        <div><span className="lbl">{unit} spent</span><b>{hype(wei(data.spent), 4)}</b></div>
      </div>
      <div className="fuse">
        <div className="fuse-h"><span>Next burn</span><b>{hype(wei(data.reserve), 5)} / {hype(wei(data.buybackMin), 4)} {unit}</b></div>
        <div className="fuse-bar"><i className={armed ? "hot" : ""} style={{ width: `${fill}%` }} /></div>
        <div className="fuse-f"><span>{usd(wei(data.reserve) * pair.usd)} in reserve</span><span className={armed ? "ember" : ""}>{armed ? "armed · fires on the next trade" : `fires at ${usd(wei(data.buybackMin) * pair.usd)}`}</span></div>
      </div>
      {data.reserve > 0n
        ? <div className="row"><button className="b soft" onClick={act(`Burn ${symbol}`, () => client.buybackAndBurn(token))}>Burn now</button><span className="faint" style={{ fontSize: 12 }}>anyone can, you pay gas</span></div>
        : <p className="note" style={{ margin: 0 }}>{FEES.burnPct}% of every fee lands here in {unit}. When it holds about $25 the next trade spends it on {symbol} and burns what it bought.</p>}
      {data.isCreator && (
        <div className="creator">
          <div className="lbl">Your creator fees · lifetime {hype(wei(data.totalCreator), 4)} {unit}</div>
          <div className="v">{hype(wei(data.creatorFees), 5)} <span className="faint" style={{ fontSize: 13 }}>{unit}</span></div>
          {data.creatorFees > 0n && <div className="row"><button className="b pri sm" onClick={act("Claim creator fees", () => client.claimCreatorFees(token, false))}>Claim {pair.isNative ? "ETH" : unit}</button>{canEth && <button className="b sm" onClick={act("Claim as ETH", () => client.claimCreatorFees(token, true))}>Claim as ETH</button>}</div>}
        </div>
      )}
    </div>
  );
}

/** The order dock: side, amount, quote and the button in one horizontal line. */
function Dock({ token, symbol, priceWei, pair, ethUsd, initial = "buy" }: { token: Address; symbol: string; priceWei: bigint; pair: PairInfo; ethUsd: number; initial?: "buy" | "sell" }) {
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
  const burnCut = amountWei > 0n ? wei(side === "buy" ? amountWei : out) * payUsd * (FEES.taxPct / 100) * (FEES.burnPct / 100) : 0;
  return (
    <>
      <div className="dock">
        <div className="seg side">
          <button className={side === "buy" ? "on buy" : ""} onClick={() => { setSide("buy"); setAmt(""); }}>Buy</button>
          <button className={side === "sell" ? "on sell" : ""} onClick={() => { setSide("sell"); setAmt(""); }}>Sell</button>
        </div>
        <div className="amt">
          <div className="bal"><span>{side === "buy" ? "You pay" : "You sell"}</span><button type="button" onClick={max}>{bal ? (side === "buy" ? `${hype(wei(payBal), 4)} ${payUnit}` : `${num(wei(bal.token))} ${symbol}`) : "max"}</button></div>
          <div className="field"><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="u">{side === "buy" ? payUnit : symbol}</span></div>
          <div className="chips">{side === "buy" ? [0.01, 0.05, 0.1, 0.5].map((v) => <button key={v} onClick={() => chip(v)}>{v}</button>) : [0.25, 0.5, 0.75, 1].map((v) => <button key={v} onClick={() => chip(v)}>{v * 100}%</button>)}</div>
        </div>
        <div className="quote">
          <span>You get</span><b>{amountWei > 0n ? `${side === "buy" ? num(outNum) : hype(outNum, 5)} ${side === "buy" ? symbol : payUnit}` : "—"}</b>
          <span>Value</span><b>{amountWei > 0n ? usd(side === "buy" ? wei(amountWei) * payUsd : outNum * payUsd) : "—"}</b>
          <span>{sim != null ? "Impact" : "Quote"}</span><b>{sim != null ? (impact != null ? `${Math.max(0, impact).toFixed(2)}%` : "—") : "spot"}</b>
          <span>Fee</span><b className={surcharge ? "down" : ""}>{(feeBps / 100).toFixed(0)}%{surcharge ? " snipe" : ""} <span className="ember">· burns {usd(burnCut)}</span></b>
        </div>
        <div className="go">
          <button className={"b lg " + (side === "sell" ? "sell" : "buy")} disabled={isConnected && (amountWei === 0n || over)} onClick={go}>{!isConnected ? "Connect wallet" : over ? "Not enough" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}</button>
          <span className="sub">{surcharge ? `Anti-snipe fee, back to ${FEES.taxPct}% within 20s of launch` : "Slippage 5% · Uniswap V4"}</span>
        </div>
      </div>
      <p className="dock-note">{pair.isNative ? "" : payEth ? `Priced in ${pair.symbol}. You pay and receive ETH; the router goes through ${pair.symbol}'s pool.` : `Priced in ${pair.symbol}, which has no ETH route: you pay and receive ${pair.symbol}.`}</p>
    </>
  );
}

const PAGE = 12;

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="b sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Prev</button>
      <span>{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</span>
      <button className="b sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

function Trades({ address, symbol, pair }: { address: Address; symbol: string; pair: PairInfo }) {
  const { data: trades } = useTrades(address);
  const [page, setPage] = useState(0);
  if (!trades) return <div className="skel" style={{ height: 140, marginTop: 12 }} />;
  const slice = trades.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <>
      <div className="log">
        {trades.length === 0 && <div className="empty">No trades yet. The first buy sets the price.</div>}
        {slice.map((tr) => (
          <a key={tr.id} className="li" href={`${env.explorerUrl}/tx/${tr.txHash}`} target="_blank" rel="noreferrer">
            <span className="t">{ago(tr.timestamp)}</span>
            <span className={"side " + (tr.isBuy ? "up" : "down")}>{tr.isBuy ? "BUY" : "SELL"}</span>
            <span className="who">{short(tr.trader)}</span>
            <span className="r">{num(wei(tr.tokenAmount))} {symbol}<small>{hype(wei(tr.nativeAmountWei), 4)} {pair.symbol} · {usd(wei(tr.nativeAmountWei) * pair.usd)}</small></span>
          </a>
        ))}
      </div>
      <Pager page={page} total={trades.length} onPage={setPage} />
    </>
  );
}

function Holders({ address, creator }: { address: Address; creator: Address }) {
  const { data: holders } = useHolders(address);
  if (!holders) return <div className="skel" style={{ height: 140, marginTop: 12 }} />;
  const slice = holders.slice(0, PAGE);
  return (
    <>
      <div className="log">
        {holders.length === 0 && <div className="empty">No holders found yet.</div>}
        {slice.map((h, i) => {
          const dev = h.address.toLowerCase() === creator.toLowerCase();
          return (
            <a key={h.address} className="li" href={`${env.explorerUrl}/address/${h.address}`} target="_blank" rel="noreferrer">
              <span className="t">#{i + 1}</span>
              <span className={"side " + (dev ? "ember" : "faint")}>{dev ? "DEV" : ""}</span>
              <span className="who">{short(h.address)}</span>
              <span className="r">{h.pct.toFixed(2)}%<small>{num(wei(h.balance))}</small></span>
            </a>
          );
        })}
      </div>
      {holders.length > PAGE && <p className="note" style={{ textAlign: "center", maxWidth: "none" }}>Top {PAGE}. Full list on <a className="ember" href={`${env.explorerUrl}/token/${address}#balances`} target="_blank" rel="noreferrer">Etherscan</a>.</p>}
    </>
  );
}
