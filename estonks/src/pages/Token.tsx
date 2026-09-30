import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatEther, parseEther, type Address } from "viem";
import { useAccount } from "wagmi";
import type { CandleInterval } from "@launchpad/sdk";

import { Art } from "../components/Art";
import { Chart } from "../components/Chart";
import { Copy } from "../components/Copy";
import { Icon } from "../components/Icon";
import { client, type PairInfo } from "../lib/client";
import { env, FEES, isMain } from "../lib/env";
import { ago, dateShort, hype, num, pct, short, usd, wei } from "../lib/format";
import { stockByAddress } from "../lib/stocks";
import { runTx, useBalances, useCandles, useEthUsd, useFeeNow, useHolders, useLedger, useToken, useTrades, type Token } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";
import { ETH as PRIVATE_ETH } from "../lib/private/core";
import { priv, usePrivate } from "../lib/private/session";

const RANGES: { k: CandleInterval; l: string }[] = [{ k: "5m", l: "1H" }, { k: "15m", l: "24H" }, { k: "1h", l: "7D" }, { k: "1d", l: "ALL" }];

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const { data: t, isLoading } = useToken(address);
  if (isLoading && !t) return <main><div className="skel" style={{ height: 80, marginTop: 16 }} /><div className="skel" style={{ height: 300, marginTop: 12 }} /></main>;
  if (!t) return <main className="gate"><h1>Not a coin here.</h1><p className="lede">That address was not launched on this factory.</p><Link to="/" className="btn dim">Back to coins</Link></main>;
  return <Coin t={t} />;
}

function Coin({ t }: { t: Token }) {
  const { data: ethUsd = 0 } = useEthUsd();
  const pair = t.pair;
  const [range, setRange] = useState<CandleInterval>("15m");
  const [view, setView] = useState<"price" | "mcap">("price");
  const { data: candles } = useCandles(t.address, range);
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  useEffect(() => { document.body.style.overflow = sheet ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [sheet]);
  const chg = t.priceChange24hPct;
  const links = [
    t.metadata?.twitter && { l: "X", u: t.metadata.twitter, i: "x" as const },
    t.metadata?.telegram && { l: "Telegram", u: t.metadata.telegram, i: "telegram" as const },
    t.metadata?.website && { l: "Website", u: t.metadata.website, i: "globe" as const },
    { l: "Etherscan", u: `${env.explorerUrl}/token/${t.address}`, i: "external" as const },
  ].filter(Boolean) as { l: string; u: string; i: "x" | "telegram" | "globe" | "external" }[];
  const dock = <Dock token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} pair={pair} ethUsd={ethUsd} initial={sheet ?? "buy"} />;

  return (
    <main className="grid2 pad-trade">
      <div>
        <div className="coinhead">
          <Link className="back" to="/" aria-label="Back"><Icon name="back" size={18} /></Link>
          <Art src={t.metadata?.logo} address={t.address} size="lg" />
          <div className="t"><h2>{t.symbol}{isMain(t.address) && <span className="badge main">MAIN</span>}<span className={"badge " + (pair.isNative ? "eth" : "stock")}>{pair.symbol}</span></h2><small>{t.name} · by <a href={`${env.explorerUrl}/address/${t.creator}`} target="_blank" rel="noreferrer">{short(t.creator)}</a> · {dateShort(t.createdAt)}</small></div>
        </div>
        <div className="price"><b>{usd(t.priceUsd)}</b><span className={"badge " + (chg == null ? "mute" : chg >= 0 ? "up" : "down")}>{chg == null ? "no 24h data" : `${pct(chg)} · 24H`}</span><span className="pnear">{hype(wei(t.priceWei || "0"), 6)} {pair.symbol}</span></div>

        <div className="chart">
          <div className="chead">
            <div className="ranges">{RANGES.map((r) => <button key={r.k} className={range === r.k ? "on" : ""} onClick={() => setRange(r.k)}>{r.l}</button>)}</div>
            <div className="cstat"><button className={"badge " + (view === "price" ? "" : "mute")} onClick={() => setView("price")}>Price</button><button className={"badge " + (view === "mcap" ? "" : "mute")} onClick={() => setView("mcap")}>Mcap</button></div>
          </div>
          {candles ? <Chart candles={candles} hypeUsd={pair.usd} mode={view} volumeUsd={wei(t.volume24hWei) * pair.usd} supply={wei(t.totalSupply || "0") || 1e9} /> : <div className="empty">Loading chart…</div>}
        </div>

        <div className="figs four" style={{ marginTop: 10 }}>
          <div><span className="label">Mcap</span><b>{usd(t.marketCapUsd, { compact: true })}</b></div>
          <div><span className="label">Liq</span><b>{usd(wei(t.liquidityWei) * pair.usd, { compact: true })}</b></div>
          <div><span className="label">Holders</span><b>{num(t.holderCount, 0)}</b></div>
          <div><span className="label">Vol 24h</span><b>{usd(wei(t.volume24hWei) * pair.usd, { compact: true })}</b></div>
        </div>

        <div className="about">
          <p>{t.metadata?.description || `${t.name}. Paired with ${pair.symbol}, so every trade pays ${t.symbol} holders in ${pair.symbol}.`}</p>
          <div className="links">{links.map((l) => <a key={l.l} href={l.u} target="_blank" rel="noreferrer" aria-label={l.l} title={l.l}><Icon name={l.i} size={17} /></a>)}</div>
        </div>

        <Position t={t} pair={pair} />

        <div className="sec"><h2>Trades</h2><span className="badge mute">live</span></div>
        <Trades address={t.address} symbol={t.symbol} pair={pair} />

        <div className="sec"><h2>Holders</h2><span className="badge mute">top 20</span></div>
        <Holders address={t.address} creator={t.creator} />

        <div className="sec"><h2>Info</h2></div>
        <div className="card info">
          <div className="kv"><span>Pair</span><b>{pair.isNative ? "ETH" : <Copy value={pair.address} label={pair.symbol} />}</b></div>
          <div className="kv"><span>Contract</span><b><Copy value={t.address} label="Contract" /></b></div>
          <div className="kv"><span>Creator</span><b><Copy value={t.creator} label="Creator" /></b></div>
          <div className="kv"><span>Pool</span><b><a href={`https://dexscreener.com/${env.dexscreenerChain}/${t.poolId}`} target="_blank" rel="noreferrer">DexScreener</a></b></div>
          <div className="kv"><span>In the pool</span><b>{t.reserves ? `${hype(wei(t.reserves.pair), 4)} ${pair.symbol}` : "—"}</b></div>
          {t.basket.length > 0 && <div className="kv"><span>Rewards basket</span><b>{basketNames(t.basket)}</b></div>}
          <div className="kv"><span>Fee</span><b>{(t.feeTier / 100).toFixed(t.feeTier % 100 ? 2 : 0)}%</b></div>
          <div className="kv"><span>Supply</span><b>{num(wei(t.totalSupply), 0)}</b></div>
        </div>
      </div>

      <aside className="side tside">{dock}</aside>

      <div className="tbar"><div className="in"><button className="btn buy lg" onClick={() => setSheet("buy")}>Buy</button><button className="btn sellb lg" onClick={() => setSheet("sell")}>Sell</button></div></div>
      <div className={"tsheet " + (sheet ? "open" : "")}><div className="scrim" onClick={() => setSheet(null)} /><div className="panel"><div className="grab" />{sheet && dock}</div></div>
    </main>
  );
}

/** Holding, value, pending rewards and the claim, plus creator fees when it is the creator looking. */
function Position({ t, pair }: { t: Token; pair: PairInfo }) {
  const { address: me, isConnected } = useAccount();
  const qc = useQueryClient();
  const { data } = useLedger(t.address, me);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["ledger", t.address.toLowerCase()] }); await qc.invalidateQueries({ queryKey: ["token", t.address.toLowerCase()] }); await qc.invalidateQueries({ queryKey: ["portfolio"] }); };
  const act = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); await runTx(label, fn, refresh); };
  if (!isConnected) return (
    <div className="pos"><div className="ph"><h3>Your position</h3></div><p className="note" style={{ margin: 0 }}>Connect a wallet to see your {t.symbol} and the rewards it has earned.</p><button className="btn dim wide" onClick={() => openWalletModal()}>Connect wallet</button></div>
  );
  if (!data) return <div className="skel" style={{ height: 150, marginTop: 10 }} />;
  const held = wei(data.balance);
  const value = held * Number(t.priceUsd);
  const share = data.eligibleSupply > 0n ? (Number(data.balance) / Number(data.eligibleSupply)) * 100 : 0;
  const rewardUsd = wei(data.pending) * pair.usd;
  const canEth = pair.ethRoute && !pair.isNative;
  return (
    <div className="pos">
      <div className="ph"><h3>Your position</h3>{value > 0 && <span className="badge mute">{share.toFixed(2)}% of supply</span>}</div>
      <div className="pg">
        <div><span className="label">Holding</span><b>{num(held)}</b><small>{t.symbol}</small></div>
        <div><span className="label">Value</span><b>{usd(value)}</b><small>{hype(held * wei(t.priceWei || "0"), 4)} {pair.symbol}</small></div>
        <div><span className="label">Rewards</span><b>{hype(wei(data.pending), 5)} {pair.symbol}</b><small>{usd(rewardUsd)}</small></div>
      </div>
      <div className="rowb">
        <button className="btn dim claim" disabled={data.pending === 0n} onClick={act("Claim rewards", () => client.claimRewards(t.address, false))}>Claim {pair.symbol}</button>
        {canEth && <button className="btn dim" disabled={data.pending === 0n} onClick={act("Claim as ETH", () => client.claimRewards(t.address, true))}>Claim as ETH</button>}
        {t.basket.length > 0 && <button className="btn dim" disabled={data.pending === 0n} onClick={act("Claim as basket", () => client.claimAsBasket(t.address))}>Claim as basket</button>}
      </div>
      {t.basket.length > 0 && <p className="note" style={{ margin: 0 }}>Basket: equal parts {basketNames(t.basket)}, bought when you claim. Each stock has a 5% price floor.</p>}
      <p className="note" style={{ margin: 0 }}>{FEES.holderPct}% of the {FEES.taxPct}% fee on every trade is split among holders, credited as trades happen. Lifetime paid to holders: {hype(wei(data.totalHolder), 4)} {pair.symbol}.</p>
      {data.isCreator && (
        <div className="creator">
          <div className="ph"><h3>Creator fees</h3><span className="badge mute">lifetime {hype(wei(data.totalCreator), 4)} {pair.symbol}</span></div>
          <div className="pg"><div><span className="label">To claim</span><b>{hype(wei(data.creatorFees), 5)} {pair.symbol}</b><small>{usd(wei(data.creatorFees) * pair.usd)}</small></div></div>
          <div className="rowb">
            <button className="btn dim claim" disabled={data.creatorFees === 0n} onClick={act("Claim creator fees", () => client.payCreator(t.address))}>Claim {pair.symbol}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The order form: side, pay, receive, details, button. */
function Dock({ token, symbol, priceWei, pair, ethUsd, initial = "buy" }: { token: Address; symbol: string; priceWei: bigint; pair: PairInfo; ethUsd: number; initial?: "buy" | "sell" }) {
  const { address: me, isConnected } = useAccount();
  const qc = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">(initial);
  useEffect(() => { setSide(initial); setAmt(""); }, [initial]);
  const [amt, setAmt] = useState("");
  const ps = usePrivate();
  const [privOn, setPrivOn] = useState(false);
  const payEth = pair.ethRoute;
  // Private mode: pay from, and receive into, the private balance. ETH-routable coins only.
  const privMode = privOn && ps.unlocked && payEth;
  const payUnit = payEth ? "ETH" : pair.symbol;
  const payUsd = payEth ? ethUsd : pair.usd;
  const { data: bal } = useBalances(me, token, pair.isNative ? undefined : pair.address);
  const { data: fee } = useFeeNow(token);
  const amountWei = useMemo(() => { try { return amt && Number(amt) > 0 ? parseEther(amt as `${number}`) : 0n; } catch { return 0n; } }, [amt]);
  const privEth = ps.balances.get(PRIVATE_ETH) ?? 0n;
  const privTok = ps.balances.get(token.toLowerCase()) ?? 0n;
  const payBal = privMode ? privEth : bal ? (payEth ? bal.native : bal.pair) : 0n;
  const tokBal = privMode ? privTok : bal?.token ?? 0n;
  const { data: sim } = useQuery({
    queryKey: ["quote", token, side, amountWei.toString(), me],
    enabled: amountWei > 0n && isConnected && !privMode,
    queryFn: async () => { await ensureWallet().catch(() => undefined); return client.previewSwapOut(token, side, amountWei); },
    staleTime: 8_000,
  });
  const pairPerEth = pair.usd > 0 && ethUsd > 0 ? ethUsd / pair.usd : 1;
  const k = payEth && !pair.isNative ? pairPerEth : 1;
  const spot = priceWei > 0n ? (side === "buy" ? BigInt(Math.floor((Number(amountWei) * k * 1e18) / Number(priceWei))) : BigInt(Math.floor((Number(amountWei) * Number(priceWei)) / 1e18 / k))) : 0n;
  const feeBps = fee?.total ?? FEES.taxPct * 100;
  const out = privMode ? (spot * BigInt(10_000 - feeBps - 50)) / 10_000n : sim ?? (spot * BigInt(10_000 - feeBps)) / 10_000n;
  const simKnown = typeof sim === "bigint";
  const outNum = wei(out);
  const impact = spot > 0n && simKnown ? Math.max(0, (1 - Number(sim) / Number(spot)) * 100) : null;
  const surcharge = !!fee && fee.total > fee.base;
  const over = privMode ? amountWei > (side === "buy" ? privEth : privTok) : side === "buy" ? !!bal && amountWei > payBal : !!bal && amountWei > bal.token;
  // A reverted simulation means the route cannot fill right now (thin stock pool, launch guard); never send blind.
  const noRoute = !privMode && amountWei > 0n && isConnected && sim === null;
  const minOut = (out * 95n) / 100n;
  const pctOf = (f: number) => { if (!bal && !privMode) return; if (side === "buy") { const keep = payEth && !privMode ? parseEther("0.003") : 0n; const base = payBal > keep ? payBal - keep : 0n; setAmt(formatEther((base * BigInt(Math.round(f * 100))) / 100n)); } else setAmt(formatEther((tokBal * BigInt(Math.round(f * 100))) / 100n)); };
  const go = async () => {
    if (privMode) {
      const ok = await runTx(side === "buy" ? `Private buy ${symbol}` : `Private sell ${symbol}`, () => (side === "buy" ? priv.buy(token, amountWei) : priv.sell(token, amountWei, (out * 90n) / 100n)), undefined, "Proving on this device");
      if (ok) { setAmt(""); qc.invalidateQueries(); }
      return;
    }
    if (!isConnected) return openWalletModal();
    await ensureWallet();
    const ok = await runTx(side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`, () => (side === "buy" ? client.buyToken(token, amountWei, minOut) : client.sellToken(token, amountWei, minOut)));
    if (ok) { setAmt(""); qc.invalidateQueries(); }
  };
  const inTok = side === "buy" ? payUnit : symbol;
  const outTok = side === "buy" ? symbol : payUnit;
  const route = pair.isNative ? "ETH · " + symbol : payEth ? `ETH · ${pair.symbol} · ${symbol}` : `${pair.symbol} · ${symbol}`;
  return (
    <div className={"tcard " + (side === "sell" ? "sell" : "")}>
      <div className="seg"><button className={side === "buy" ? "on" : ""} onClick={() => { setSide("buy"); setAmt(""); }}>Buy</button><button className={side === "sell" ? "on" : ""} onClick={() => { setSide("sell"); setAmt(""); }}>Sell</button></div>
      {ps.live && payEth && <div className="dock-private">
        {ps.unlocked
          ? <button className={privOn ? "on" : ""} onClick={() => { setPrivOn(!privOn); setAmt(""); }}><Icon name="private" size={14} /> {privOn ? "Private: on" : "Private: off"}</button>
          : <Link to="/private"><Icon name="private" size={14} /> Trade privately</Link>}
        {privMode && <span>From your private balance · 0.5% + gas</span>}
      </div>}
      <div className="box">
        <div className="bh"><span>You pay</span><span className="bal">{privMode ? "Private" : "Balance"} <b>{bal || privMode ? (side === "buy" ? `${hype(wei(payBal), 4)} ${payUnit}` : `${num(wei(tokBal))} ${symbol}`) : "…"}</b></span></div>
        <div className="bi"><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Amount" /><span className="tok"><i className="dot" style={{ background: side === "buy" ? (payEth ? "#a9b8cc" : "#9b7dff") : "#2fd67b" }} />{inTok}</span></div>
        <div className="bf"><span className="usd">{amountWei > 0n ? usd(side === "buy" ? wei(amountWei) * payUsd : wei(amountWei) * Number(priceWei) / 1e18 * pair.usd) : "$0"}</span><div className="q">{[0.25, 0.5, 1].map((f) => <button key={f} onClick={() => pctOf(f)}>{f === 1 ? "Max" : `${f * 100}%`}</button>)}</div></div>
      </div>
      <div className="arrow"><Icon name="down" size={14} /></div>
      <div className="box">
        <div className="bh"><span>You receive</span>{(bal || privMode) && <span className="bal">{privMode ? "Private" : "Holding"} <b>{num(wei(tokBal))}</b></span>}</div>
        <div className="bi"><output>{amountWei > 0n ? (side === "buy" ? num(outNum) : hype(outNum, 5)) : "0"}</output><span className="tok"><i className="dot" style={{ background: side === "buy" ? "#2fd67b" : (payEth ? "#a9b8cc" : "#9b7dff") }} />{outTok}</span></div>
        <div className="bf"><span className="usd">{amountWei > 0n ? usd(side === "buy" ? outNum * Number(priceWei) / 1e18 * pair.usd : outNum * payUsd) : "$0"}</span></div>
      </div>
      <div className="det">
        <div><span>Rate</span><b>{priceWei > 0n ? `1 ${payUnit} = ${num(k * 1e18 / Number(priceWei))} ${symbol}` : "—"}</b></div>
        <div><span>Price impact</span><b className={impact != null && impact > 5 ? "down" : ""}>{impact != null ? `${impact.toFixed(2)}%` : sim === null ? "—" : "estimate"}</b></div>
        <div><span>Min received</span><b>{amountWei > 0n ? (side === "buy" ? num(wei(minOut)) : hype(wei(minOut), 5)) : "—"}</b></div>
        <div><span>Fee</span><b className={surcharge ? "down" : ""}>{(feeBps / 100).toFixed(feeBps % 100 ? 2 : 0)}%{surcharge ? " anti-snipe" : ""}</b></div>
        <div><span>Route</span><b>{route}</b></div>
      </div>
      <button className={"btn lg wide go " + (side === "sell" ? "sellb" : "buy")} disabled={(isConnected || privMode) && (amountWei === 0n || over || noRoute)} onClick={go}>{privMode ? (over ? "Not enough" : side === "buy" ? `Buy ${symbol} privately` : `Sell ${symbol} privately`) : !isConnected ? "Connect wallet" : over ? "Not enough" : noRoute ? "No quote right now" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}</button>
      {noRoute && <p className="note" style={{ margin: 0, textAlign: "center" }}>{pair.isNative ? "The pool could not fill this size. Try a smaller amount." : `The ${pair.symbol} route could not fill this size right now. Try a smaller amount, or trade in ${pair.symbol} directly.`}</p>}
    </div>
  );
}

/** Basket stocks by ticker symbol, in launch order. */
const basketNames = (b: Address[]) => b.map((a) => stockByAddress(a)?.symbol ?? short(a)).join(" · ");

const PAGE = 8;

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (total === 0) return null;
  return (
    <div className="pager">
      <span>{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</span>
      <div><button disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page"><Icon name="back" size={16} /></button><button disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page"><Icon name="next" size={16} /></button></div>
    </div>
  );
}

function Trades({ address, symbol, pair }: { address: Address; symbol: string; pair: PairInfo }) {
  const { data: trades } = useTrades(address);
  const [page, setPage] = useState(0);
  if (!trades) return <div className="skel" style={{ height: 140 }} />;
  const slice = trades.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <>
      <div className="list">
        {trades.length === 0 && <div className="empty">No trades yet. The first buy sets the price.</div>}
        {slice.map((tr) => (
          <a key={tr.id} className="item" href={`${env.explorerUrl}/tx/${tr.txHash}`} target="_blank" rel="noreferrer">
            <span className={"mark " + (tr.isBuy ? "up" : "down")}>{tr.isBuy ? "▲" : "▼"}</span>
            <span><b>{short(tr.trader)}</b><small>{tr.isBuy ? "Bought" : "Sold"} {num(wei(tr.tokenAmount))} {symbol} · {ago(tr.timestamp)}</small></span>
            <span className={"amt " + (tr.isBuy ? "up" : "down")}>{tr.isBuy ? "+" : "−"}{hype(wei(tr.nativeAmountWei), 4)} {pair.symbol}<br /><small>{usd(wei(tr.nativeAmountWei) * pair.usd)}</small></span>
          </a>
        ))}
      </div>
      <Pager page={page} total={trades.length} onPage={setPage} />
    </>
  );
}

function Holders({ address, creator }: { address: Address; creator: Address }) {
  const { data: holders } = useHolders(address);
  if (!holders) return <div className="skel" style={{ height: 120 }} />;
  if (holders.length === 0) return <div className="empty">No holders yet.</div>;
  return (
    <div className="card">
      {holders.map((h, i) => (
        <a key={h.address} className="rank" href={`${env.explorerUrl}/address/${h.address}`} target="_blank" rel="noreferrer">
          <i>{String(i + 1).padStart(2, "0")}</i>
          <b>{short(h.address)}{h.address.toLowerCase() === creator.toLowerCase() && <span className="badge mute" style={{ marginLeft: 6 }}>creator</span>}</b>
          <span className="amt">{h.pct.toFixed(2)}%</span>
        </a>
      ))}
    </div>
  );
}
