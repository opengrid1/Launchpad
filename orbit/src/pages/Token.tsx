import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatEther, parseEther, type Address } from "viem";
import { useAccount } from "wagmi";
import type { CandleInterval } from "@launchpad/sdk";

import { Chart } from "../components/Chart";
import { Art } from "../components/Art";
import { Copy } from "../components/Copy";
import { client, onair } from "../lib/client";
import { env, FEES } from "../lib/env";
import { ago, dateShort, hype, num, pct, short, usd, wei } from "../lib/format";
import { runTx, useAuction, useBalances, useBids, useCandles, useCheckpoints, useHolders, useHypeUsd, useToken, useTrades, type Token } from "../lib/hooks";
import { AUCTION_SUPPLY, countdown, mcapUsdToQ96, q96ToFdvWei, q96ToWei, Q96, secondsLeft, snapToGrid, type AuctionState } from "../lib/onair";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const INTERVALS: CandleInterval[] = ["5m", "15m", "1h", "4h", "1d"];

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const { data: t, isLoading } = useToken(address);

  if (isLoading) return <main className="page"><div className="prog"><div className="art skeleton" style={{ minHeight: 88 }} /><div className="skeleton" style={{ height: 44, width: 240, minHeight: 0 }} /></div><div className="skeleton" style={{ minHeight: 340 }} /></main>;
  if (!t) return <main className="page"><section className="hero" style={{ gridTemplateColumns: "1fr" }}><div><h1>Off <em>air</em>.</h1><p className="sub">That address is not a coin launched here.</p><Link to="/" className="btn ghost">Back to the feed</Link></div></section></main>;

  // Auction coins stay on the auction page until a pool exists: while bidding
  // runs, while settlement is pending, and forever if the auction did not bond.
  if (t.mode === "auction" && t.auction && !(t.auction.finalized && t.auction.graduated)) return <AuctionPage t={t} />;
  return <MarketPage t={t} />;
}

// =====================================================================
// A coin with a pool: chart, trades, buy/sell.
// =====================================================================
function MarketPage({ t }: { t: Token }) {
  const { data: hypeUsd = 0 } = useHypeUsd();
  const [interval, setInterval_] = useState<CandleInterval>("15m");
  const [view, setView] = useState<"mcap" | "price">("mcap");
  const { data: candles } = useCandles(t.address, interval);
  const [tab, setTab] = useState<"trades" | "holders" | "about">("trades");
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const chg = t.priceChange24hPct;
  const links = linksOf(t);

  return (
    <main className="page">
      <div className="prog">
        <Art src={t.metadata?.logo} name={t.name} className="art" />
        <div>
          <h1>{t.name}</h1>
          <div className="meta"><span className="onair"><span className="dot" style={{ width: 6, height: 6, boxShadow: "none" }} />TRADING</span>{t.mode === "auction" && <span className="tagl auc">AUCTIONED</span>}<span className="mono">{t.symbol}</span><span>pairs HYPE</span><span>by <a href={`${env.explorerUrl}/address/${t.creator}`} target="_blank" rel="noreferrer" style={{ color: "var(--green)" }}>{short(t.creator)}</a></span><span>since {dateShort(t.createdAt)}</span></div>
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
            {candles && candles.length > 1 ? <Chart candles={candles} hypeUsd={hypeUsd} mode={view} /> : <div className="chart" style={{ display: "grid", placeItems: "center", color: "var(--ink3)" }}>{candles ? "Not enough trades for a chart yet. The first buy starts it." : "Loading chart…"}</div>}
          </div>

          <div className="tabs chips-row">
            {(["trades", "holders", "about"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k === "trades" ? "Trades" : k === "holders" ? "Holders" : "About"}</button>)}
          </div>
          {tab === "trades" && <Trades address={t.address} symbol={t.symbol} hypeUsd={hypeUsd} />}
          {tab === "holders" && <Holders address={t.address} creator={t.creator} pool={t.pool} />}
          {tab === "about" && <About t={t} links={links} />}
        </div>

        <aside>
          <div className="panel desk" id="trade">
            <TradePanel token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} hypeUsd={hypeUsd} />
          </div>
          {t.mode === "auction" && <MyBids token={t.address} symbol={t.symbol} hypeUsd={hypeUsd} settled />}
          <Rewards token={t.address} />
          <div className="panel" style={{ marginTop: 14 }}>
            <div className="lbl" style={{ marginBottom: 6 }}>Details</div>
            <dl className="specs">
              <dt>Market cap</dt><dd>{usd(t.marketCapUsd, { compact: true })}</dd>
              <dt>Liquidity</dt><dd>{usd(wei(t.liquidityWei) * hypeUsd, { compact: true })}</dd>
              <dt>Volume · 24h</dt><dd>{usd(wei(t.volume24hWei) * hypeUsd, { compact: true })}</dd>
              <dt>Trades · 24h</dt><dd>{num(t.txCount24h, 0)}</dd>
              <dt>Holders</dt><dd>{num(t.holderCount, 0)}</dd>
              <dt>Supply</dt><dd>1B fixed</dd>
              <dt>Format</dt><dd>{t.mode === "auction" ? "Auction" : "Instant"}</dd>
              <dt>Launched</dt><dd>{dateShort(t.createdAt)}</dd>
              <dt>Contract</dt><dd><Copy value={t.address} label="Contract address" /></dd>
              <dt>Pool</dt><dd><Copy value={t.pool} label="Pool address" /></dd>
              <dt>Links</dt><dd><a href={`${env.explorerUrl}/token/${t.address}`} target="_blank" rel="noreferrer">Explorer</a> · <a href={`https://dexscreener.com/${env.dexscreenerChain}/${t.pool}`} target="_blank" rel="noreferrer">DexScreener</a></dd>
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
          <div className="sheet desk">
            <div className="grab" />
            <TradePanel token={t.address} symbol={t.symbol} priceWei={BigInt(t.priceWei || "0")} hypeUsd={hypeUsd} initial={sheet} />
          </div>
        </>
      )}
    </main>
  );
}

// =====================================================================
// A coin still in auction: clearing price, raise, bids.
// =====================================================================
function AuctionPage({ t }: { t: Token }) {
  const { data: hypeUsd = 0 } = useHypeUsd();
  const { data: live } = useAuction(t.address);
  const a = live ?? t.auction!;
  const [tab, setTab] = useState<"bids" | "moves" | "about">("bids");
  const [sheet, setSheet] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const readAt = useMemo(() => Date.now(), [a.head]);
  const left = Math.max(0, secondsLeft(a) - Math.floor((now - readAt) / 1000));
  const links = linksOf(t);
  const clearingWei = q96ToWei(a.clearingQ96);
  const fdvUsd = (Number(q96ToFdvWei(a.clearingQ96)) / 1e18) * hypeUsd;
  const raisedPct = a.minRaiseWei > 0n ? Math.min(100, (Number(a.committed) / Number(a.minRaiseWei)) * 100) : 0;
  const soldPct = a.supply > 0n ? (Number(a.sold) / Number(a.supply)) * 100 : 0;
  const floorFdv = (Number(q96ToFdvWei(a.floorPriceQ96)) / 1e18) * hypeUsd;
  const failed = a.finalized && !a.graduated;
  const status = a.cancelled ? "CANCELLED" : a.open ? "AUCTION" : failed ? "DID NOT BOND" : a.finalized ? "ENDED" : "NOT SETTLED";

  return (
    <main className="page">
      <div className="prog">
        <Art src={t.metadata?.logo} name={t.name} className="art" />
        <div>
          <h1>{t.name}</h1>
          <div className="meta"><span className={"onair auc " + (a.open ? "" : "off")}><span className="dot" style={{ width: 6, height: 6, boxShadow: "none" }} />{status}</span><span className="mono">{t.symbol}</span><span>pairs HYPE</span><span>by <a href={`${env.explorerUrl}/address/${t.creator}`} target="_blank" rel="noreferrer" style={{ color: "var(--green)" }}>{short(t.creator)}</a></span><span>since {dateShort(t.createdAt)}</span></div>
        </div>
        <div className="price">
          <div className="v">{a.open ? countdown(left) : a.cancelled ? "cancelled" : a.finalized ? "ended" : "not settled"}</div>
          <div className="c faint">{a.open ? "left in the auction" : a.cancelled || failed ? "refunds open" : a.finalized ? "" : "ended, waiting for settlement"}</div>
        </div>
      </div>

      <div className="two">
        <div>
          <div className="panel stage">
            <div className="stage-top">
              <div>
                <div className="lbl">Clearing price · everyone pays this</div>
                <div className="big-price">{usd((Number(clearingWei) / 1e18) * hypeUsd)}</div>
                <div className="small mono">{hype(wei(clearingWei))} HYPE per coin · {usd(fdvUsd, { compact: true })} FDV · floor {usd(floorFdv, { compact: true })}</div>
              </div>
              <div className="stage-n">
                <div><b>{hype(wei(a.committed), 2)}</b><span>HYPE committed</span></div>
                <div><b>{num(a.bidCount, 0)}</b><span>bids</span></div>
                <div><b>{soldPct.toFixed(1)}%</b><span>of the sale sold</span></div>
              </div>
            </div>
            <div className="bond">
              <div className="between"><span className="lbl">Bond · {hype(wei(a.minRaiseWei), 0)} HYPE to open the pool</span><span className="mono small">{raisedPct.toFixed(0)}%</span></div>
              <div className="bar"><i style={{ width: `${raisedPct}%` }} /></div>
              <p className="note">{failed ? `Ended under the ${hype(wei(a.minRaiseWei), 0)} HYPE bond. No coins were sold and no pool opened; every bid is refundable in full below.` : a.committed >= a.minRaiseWei ? `On track to bond: ${hype(wei(a.committed), 2)} HYPE committed by active bids, ${hype(wei(a.raised), 3)} spent so far. When the auction ends the raise and the unsold half of the supply seed a locked HyperSwap pool at the clearing price.` : `${hype(wei(a.committed), 2)} HYPE committed by active bids (${hype(wei(a.raised), 3)} spent so far). Budgets are spent block by block until the end. If the total ends below ${hype(wei(a.minRaiseWei), 0)} HYPE every bidder is refunded in full and no pool opens.`}</p>
            </div>
            {!a.open && !a.finalized && <Finalize token={t.address} cancelled={a.cancelled} />}
          </div>

          <div className="tabs chips-row">
            {(["bids", "moves", "about"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k === "bids" ? "Bid log" : k === "moves" ? "Price moves" : "About"}</button>)}
          </div>
          {tab === "bids" && <BidLog token={t.address} hypeUsd={hypeUsd} a={a} />}
          {tab === "moves" && <Moves token={t.address} hypeUsd={hypeUsd} a={a} />}
          {tab === "about" && <About t={t} links={links} />}
        </div>

        <aside>
          <div className="panel desk" id="bid">
            <BidPanel token={t.address} symbol={t.symbol} a={a} hypeUsd={hypeUsd} />
          </div>
          <MyBids token={t.address} symbol={t.symbol} hypeUsd={hypeUsd} settled={false} />
          <div className="panel" style={{ marginTop: 14 }}>
            <div className="lbl" style={{ marginBottom: 6 }}>How this auction works</div>
            <dl className="specs">
              <dt>Auction supply</dt><dd>{num(wei(AUCTION_SUPPLY), 0)} · 50%</dd>
              <dt>Released per block</dt><dd>{num(wei(a.perBlock), 0)}</dd>
              <dt>Floor</dt><dd>{usd(floorFdv, { compact: true })} FDV</dd>
              <dt>Min bid</dt><dd>{hype(wei(a.minBidWei))} HYPE</dd>
              <dt>Ends</dt><dd>block {num(a.endBlock, 0)}</dd>
              <dt>Escrow</dt><dd>{hype(wei(a.escrow), 3)} HYPE</dd>
              <dt>Contract</dt><dd><Copy value={t.address} label="Contract address" /></dd>
              <dt>Explorer</dt><dd><a href={`${env.explorerUrl}/token/${t.address}`} target="_blank" rel="noreferrer">HyperEVMScan</a></dd>
            </dl>
            <p className="note">Your budget is spread evenly over the blocks left, so being early does not mean being fast. Each block clears at one price for everyone. If the price passes your max you stop filling and the rest of your budget comes back at the end. Bids cannot be withdrawn.</p>
          </div>
        </aside>
      </div>

      <div className="mobilebar">
        <button className="big amber" onClick={() => setSheet(true)} disabled={!a.open}>{a.open ? "Place a bid" : "Auction ended"}</button>
      </div>
      {sheet && (
        <>
          <div className="scrim" onClick={() => setSheet(false)} />
          <div className="sheet desk">
            <div className="grab" />
            <BidPanel token={t.address} symbol={t.symbol} a={a} hypeUsd={hypeUsd} />
          </div>
        </>
      )}
    </main>
  );
}

function Finalize({ token, cancelled }: { token: Address; cancelled: boolean }) {
  const qc = useQueryClient();
  const { isConnected } = useAccount();
  return (
    <div className="fin">
      <div><b>{cancelled ? "Cancelled by the platform. Not settled yet." : "Ended. Not settled yet."}</b><span className="small">{cancelled ? "Settling opens full refunds for every bid." : "Settling seeds the pool if it bonded, or opens refunds if it did not. Nothing can be claimed until then. The keeper does this within minutes; anyone with big blocks on can trigger it now."}</span></div>
      <button className="btn" onClick={async () => { if (!isConnected) return openWalletModal(); await ensureWallet(); await runTx("Settle auction", () => onair.finalize(token), async () => { await qc.invalidateQueries(); }); }}>Settle now</button>
    </div>
  );
}

// ---------- bid ----------
function BidPanel({ token, symbol, a, hypeUsd }: { token: Address; symbol: string; a: AuctionState; hypeUsd: number }) {
  const { address: me, isConnected } = useAccount();
  const qc = useQueryClient();
  const [amt, setAmt] = useState("");
  const [mult, setMult] = useState<number>(0); // 0 = no limit (100× floor)
  const [custom, setCustom] = useState("");
  const { data: bal } = useBalances(me);
  const budget = useMemo(() => { try { return amt && Number(amt) > 0 ? parseEther(amt as `${number}`) : 0n; } catch { return 0n; } }, [amt]);

  const floorFdv = (Number(q96ToFdvWei(a.floorPriceQ96)) / 1e18) * hypeUsd;
  const clearingFdv = (Number(q96ToFdvWei(a.clearingQ96)) / 1e18) * hypeUsd;
  const maxQ96 = useMemo(() => {
    if (custom) { const q = mcapUsdToQ96(Number(custom), hypeUsd); return q > 0n ? snapToGrid(q, a) : a.floorPriceQ96 * 100n; }
    if (mult === 0) return a.floorPriceQ96 * 100n;
    return snapToGrid(a.floorPriceQ96 * BigInt(mult), a);
  }, [custom, mult, hypeUsd, a]);
  const maxFdv = (Number(q96ToFdvWei(maxQ96)) / 1e18) * hypeUsd;
  const below = maxQ96 < a.clearingQ96;
  const tooSmall = budget > 0n && budget < a.minBidWei;
  const over = !!bal && budget > bal.native;
  const perBlock = a.blocksLeft > 0 ? budget / BigInt(a.blocksLeft) : 0n;
  // Upper bound: the whole budget at today's clearing price. The price only rises.
  const coinsNow = a.clearingQ96 > 0n ? (budget * Q96) / a.clearingQ96 : 0n;
  const share = a.supply > 0n ? (Number(coinsNow) / Number(a.supply)) * 100 : 0;

  const go = async () => {
    if (!isConnected) return openWalletModal();
    await ensureWallet();
    const ok = await runTx(`Bid on ${symbol}`, () => onair.bid(token, maxQ96, budget), async () => { await qc.invalidateQueries({ queryKey: ["auction", token.toLowerCase()] }); await qc.invalidateQueries({ queryKey: ["bids", token.toLowerCase()] }); await qc.invalidateQueries({ queryKey: ["bal"] }); });
    if (ok) setAmt("");
  };

  return (
    <>
      <div className="between" style={{ marginBottom: 12 }}><span className="lbl">Place a bid</span><span className="small mono">{a.open ? `${countdown(secondsLeft(a))} left` : "closed"}</span></div>
      <div className="amount">
        <div className="lbl"><span>Budget</span><span>{bal ? `${hype(wei(bal.native))} HYPE` : ""}</span></div>
        <div className="in"><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} disabled={!a.open} /><span className="unit">HYPE</span></div>
      </div>
      <div className="chips">
        {[0.5, 1, 5, 20].map((v) => <button key={v} onClick={() => setAmt(String(v))}>{v}</button>)}
        <button onClick={() => { if (!bal) return; const keep = parseEther("0.01"); setAmt(formatEther(bal.native > keep ? bal.native - keep : 0n)); }}>Max</button>
      </div>
      <div className="lbl" style={{ marginBottom: 6 }}>Max price · as market cap</div>
      <div className="chips">
        {[1, 2, 5, 10].map((m) => <button key={m} className={!custom && mult === m ? "on" : ""} onClick={() => { setMult(m); setCustom(""); }}>{m}× floor</button>)}
        <button className={!custom && mult === 0 ? "on" : ""} onClick={() => { setMult(0); setCustom(""); }}>No limit</button>
      </div>
      <div className="amount" style={{ padding: "8px 14px" }}>
        <div className="in"><span className="unit">$</span><input inputMode="decimal" placeholder={usd(maxFdv, { compact: true }).replace("$", "")} value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))} style={{ fontSize: 18 }} /><span className="unit">FDV</span></div>
      </div>
      <dl className="quote">
        <dt>Pay at most</dt><dd>{usd(maxFdv, { compact: true })} FDV{mult === 0 && !custom ? " · never outbid" : ""}</dd>
        <dt>Clearing now</dt><dd>{usd(clearingFdv, { compact: true })} FDV · floor {usd(floorFdv, { compact: true })}</dd>
        <dt>Spread as</dt><dd>{budget > 0n ? `${hype(wei(perBlock), 6)} HYPE / block` : "—"}</dd>
        <dt>Up to</dt><dd>{budget > 0n ? `${num(wei(coinsNow))} ${symbol} · ${share.toFixed(2)}%` : "—"}</dd>
        <dt>Value</dt><dd>{budget > 0n ? usd(wei(budget) * hypeUsd) : "—"}</dd>
      </dl>
      {below && <div className="warn">That max is under the clearing price. You would be outbid on arrival.</div>}
      {tooSmall && <div className="warn">Minimum bid is {hype(wei(a.minBidWei))} HYPE.</div>}
      {over && <div className="warn">More than you have.</div>}
      <button className="big amber" disabled={!a.open || (isConnected && (budget === 0n || below || tooSmall || over))} onClick={go}>
        {!isConnected ? "Connect wallet" : !a.open ? "Auction closed" : `Bid ${amt || "0"} HYPE`}
      </button>
      <p className="note">"Up to" is your budget at today's price; the real fill is lower if the price rises. Unspent HYPE is refunded when the auction ends. Bids cannot be withdrawn.</p>
    </>
  );
}

/** The connected wallet's bids on this auction, with claim once settled. */
function MyBids({ token, symbol, hypeUsd, settled }: { token: Address; symbol: string; hypeUsd: number; settled: boolean }) {
  const { address: me } = useAccount();
  const qc = useQueryClient();
  const { data: bids } = useBids(token, me);
  const { data: a } = useAuction(token, !settled);
  if (!me || !bids || bids.length === 0) return null;
  const canClaim = settled || !!a?.finalized;
  const failed = settled ? false : !!a && a.finalized && !a.graduated;
  const total = bids.reduce((s, b) => s + b.budget, 0n);
  return (
    <div className="panel pay" style={{ marginTop: 14 }}>
      <div className="between"><div><div className="lbl">Your bids</div><div className="v">{hype(wei(total), 3)} HYPE</div></div><span className="small mono">{bids.length} bid{bids.length > 1 ? "s" : ""}</span></div>
      <div className="mybids">
        {bids.map((b) => (
          <div key={b.id} className="mb">
            <div>
              <b>{hype(wei(b.budget), 3)} HYPE</b>
              <small>max {usd((Number(q96ToFdvWei(b.maxPriceQ96)) / 1e18) * hypeUsd, { compact: true })} · {b.exited ? "claimed" : b.outbid ? "outbid" : canClaim ? "ready" : "filling"}</small>
            </div>
            <div className="r">
              {failed || a?.cancelled ? <><b>{hype(wei(b.budget), 3)} HYPE</b><small>refund</small></> : <><b>{num(wei(b.coins))} {symbol}</b><small>{hype(wei(b.spent), 3)} spent · {hype(wei(b.refund), 3)} back</small></>}
            </div>
            {canClaim && !b.exited && <button className="btn" onClick={async () => { await ensureWallet(); await runTx("Claim", () => onair.claim(token, b.id), async () => { await qc.invalidateQueries({ queryKey: ["bids", token.toLowerCase()] }); await qc.invalidateQueries({ queryKey: ["bal"] }); }); }}>Claim</button>}
          </div>
        ))}
      </div>
      {!canClaim && <p className="note">Coins and refunds are claimable after the auction settles.</p>}
    </div>
  );
}

function BidLog({ token, hypeUsd, a }: { token: Address; hypeUsd: number; a: AuctionState }) {
  const { data: bids } = useBids(token);
  if (!bids) return <div className="skeleton" style={{ minHeight: 120 }} />;
  return (
    <div className="log">
      {bids.length === 0 && <div className="empty">No bids yet. The first bid sets the pace.</div>}
      {bids.map((b) => (
        <a key={b.id} className="li" href={`${env.explorerUrl}/address/${b.owner}`} target="_blank" rel="noreferrer">
          <span className="t">#{b.id}</span>
          <span className={b.outbid ? "down" : "amber"}>{b.outbid ? "OUTBID" : b.exited ? "CLAIMED" : "BID"}</span>
          <span className="who">{short(b.owner)}</span>
          <span className="r">{hype(wei(b.budget), 3)} HYPE<small>max {usd((Number(q96ToFdvWei(b.maxPriceQ96)) / 1e18) * hypeUsd, { compact: true })} · +{countdown(b.startBlock - a.startBlock)}</small></span>
        </a>
      ))}
    </div>
  );
}

function Moves({ token, hypeUsd, a }: { token: Address; hypeUsd: number; a: AuctionState }) {
  const { data: cps } = useCheckpoints(token);
  if (!cps) return <div className="skeleton" style={{ minHeight: 120 }} />;
  const list = [...cps].reverse();
  return (
    <div className="log">
      {list.map((c, i) => (
        <div key={i} className="li">
          <span className="t">+{c.block - a.startBlock}s</span>
          <span className={i === 0 ? "amber" : "who"}>{i === 0 ? "NOW" : "MOVE"}</span>
          <span className="who">clearing price {i === list.length - 1 ? "opened at the floor" : "rose"}</span>
          <span className="r">{usd((Number(q96ToWei(c.priceQ96)) / 1e18) * hypeUsd)}<small>{usd((Number(q96ToFdvWei(c.priceQ96)) / 1e18) * hypeUsd, { compact: true })} FDV · {hype(wei(c.raised), 2)} HYPE in</small></span>
        </div>
      ))}
    </div>
  );
}

// ---------- shared ----------
function linksOf(t: Token) {
  return [t.metadata?.website && { l: "Website", u: t.metadata.website }, t.metadata?.twitter && { l: "X", u: t.metadata.twitter }, t.metadata?.telegram && { l: "Telegram", u: t.metadata.telegram }].filter(Boolean) as { l: string; u: string }[];
}

function About({ t, links }: { t: Token; links: { l: string; u: string }[] }) {
  return (
    <div className="panel">
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t.metadata?.description || "The creator did not add a description."}</p>
      {links.length > 0 && <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>{links.map((l) => <a key={l.l} className="btn ghost" href={l.u} target="_blank" rel="noreferrer">{l.l}</a>)}</div>}
    </div>
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
      <div className="seg">
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
        <dt>You get</dt><dd>{amountWei > 0n ? `${side === "buy" ? num(outNum) : hype(outNum)} ${side === "buy" ? symbol : "HYPE"}` : "—"}</dd>
        <dt>Value</dt><dd>{amountWei > 0n ? usd(side === "buy" ? wei(amountWei) * hypeUsd : outNum * hypeUsd) : "—"}</dd>
        <dt>{sim != null ? "Price impact" : "Estimate"}</dt><dd>{sim != null ? (impact != null ? `${Math.max(0, impact).toFixed(2)}%` : "—") : "spot, before impact"}</dd>
        <dt>Fee</dt><dd>{FEES.poolPct}% · {FEES.creatorPct}% creator · {FEES.platformPct}% platform</dd>
      </dl>
      {over && <div className="warn">More than you have.</div>}
      <button className={"big " + (side === "sell" ? "sell" : "")} disabled={isConnected && (amountWei === 0n || over)} onClick={go}>
        {!isConnected ? "Connect wallet" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
      </button>
      <p className="note">Slippage 5%, capped to the real fill so the trade cannot revert on the floor. Trades settle on HyperSwap.</p>
    </>
  );
}

// ---------- rewards (holder share is 0 on this factory; shown only if something accrued) ----------
function Rewards({ token }: { token: Address }) {
  const { address: me } = useAccount();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["rewards", token, me],
    enabled: !!me,
    refetchInterval: 60_000,
    queryFn: () => client.baseRewards(token, me!),
  });
  if (!me || !data || data.claimable === 0n) return null;
  const claimable = wei(data.claimable);
  return (
    <div className="panel pay" style={{ marginTop: 14 }}>
      <div className="between">
        <div>
          <div className="lbl">Your payout</div>
          <div className="v">{hype(claimable, 5)} HYPE</div>
        </div>
        <button className="btn" onClick={async () => {
          await ensureWallet();
          await runTx("Claim rewards", async () => { const hs = await client.claimBaseRewards(token, me); if (!hs.length) throw new Error("Nothing to claim"); return hs[hs.length - 1]; }, async () => { await qc.invalidateQueries({ queryKey: ["rewards", token, me] }); });
        }}>Claim</button>
      </div>
    </div>
  );
}

// ---------- trades / holders ----------
function Trades({ address, symbol, hypeUsd }: { address: Address; symbol: string; hypeUsd: number }) {
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
          <span className="r">{num(wei(tr.tokenAmount))} {symbol}<small>{hype(wei(tr.nativeAmountWei))} HYPE · {usd(wei(tr.nativeAmountWei) * hypeUsd)}</small></span>
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
    <div className="log">
      {holders.length === 0 && <div className="empty">No holders found yet.</div>}
      {holders.map((h, i) => (
        <a key={h.address} className="li" href={`${env.explorerUrl}/address/${h.address}`} target="_blank" rel="noreferrer">
          <span className="t">#{i + 1}</span>
          <span className={tag(h.address) ? "up" : "who"}>{tag(h.address)?.toUpperCase() ?? ""}</span>
          <span className="who">{short(h.address)}</span>
          <span className="r">{h.pct.toFixed(2)}%<small>{num(wei(h.balance))}</small></span>
        </a>
      ))}
    </div>
  );
}
