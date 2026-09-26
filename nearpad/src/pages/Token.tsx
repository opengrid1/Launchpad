import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Art } from "../components/Art";
import { Chart } from "../components/Chart";
import { Copy } from "../components/Copy";
import { Ring } from "../components/Ring";
import { SplitBar } from "../components/SplitBar";
import { env, PINNED, RULES } from "../lib/env";
import { ago, dateShort, num, short, toUnits, units } from "../lib/format";
import { useCandles, useCoin, useCurrency, useHolder, useNearUsd, useTrades } from "../lib/hooks";
import { accountBalance, view } from "../lib/rpc";
import type { Coin, Info } from "../lib/types";
import { isNearPair, pairAccount, pairDecimals, pairSymbol } from "../lib/types";
import { makeValuer, pairKind, progress, unitsFmt } from "../lib/value";
import { openWalletModal, send, useAccount } from "../lib/wallet";

const BUCKETS: { k: string; m: number }[] = [{ k: "5m", m: 5 }, { k: "15m", m: 15 }, { k: "1h", m: 60 }, { k: "4h", m: 240 }, { k: "1d", m: 1440 }];
type Fmt = (raw: string, compact?: boolean) => string;

export default function TokenPage() {
  const { account } = useParams<{ account: string }>();
  const { data: c, isLoading } = useCoin(account);
  if (isLoading) return <main><div className="skel" style={{ height: 80, marginBottom: 12 }} /><div className="skel" style={{ height: 380 }} /></main>;
  if (!c) return <main className="gate"><h1>Coin not found</h1><p>That account was not launched on this factory.</p><Link to="/" className="b">Back to coins</Link></main>;
  return <CoinView c={c} />;
}

function CoinView({ c }: { c: Coin }) {
  const i = c.info;
  const { data: nearUsd = 0 } = useNearUsd();
  const [ccy] = useCurrency();
  const v = useMemo(() => makeValuer(ccy, nearUsd)(i.pair), [ccy, nearUsd, i.pair]);
  const [bucket, setBucket] = useState(15);
  const [mode, setMode] = useState<"mcap" | "price">("mcap");
  const { data: candles } = useCandles(c.account_id);
  const { data: trades } = useTrades(c.account_id);
  const [tab, setTab] = useState<"trades" | "tax" | "about">("trades");
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const kind = pairKind(i.pair);
  const sym = pairSymbol(i.pair);
  const pool = i.phase === "Pool";
  const links = [i.links.website && { l: "Website", u: i.links.website }, i.links.x && { l: "X", u: i.links.x }, i.links.telegram && { l: "Telegram", u: i.links.telegram }].filter(Boolean) as { l: string; u: string }[];
  const last = trades?.[0];

  return (
    <main>
      <div className="head">
        <div className="id">
          <Art src={i.icon ?? undefined} name={i.name} className="art" size={56} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1>{i.name}<span className="sym">{i.symbol}</span>{PINNED.includes(c.account_id) && <span className="chip official">Official</span>}<span className={"chip " + (pool ? "pool" : i.phase === "Graduating" ? "grad" : kind)}>{pool ? "Graduated" : i.phase === "Graduating" ? "Opening the pool" : `Pays ${sym}`}</span></h1>
            <div className="meta">
              <span>by <a href={`${env.explorerUrl}/address/${i.creator}`} target="_blank" rel="noreferrer">{i.creator}</a></span>
              <span>{dateShort(i.created_at_ms)}</span>
              <Copy value={c.account_id} label="contract" />
              {links.map((l) => <a key={l.l} href={l.u} target="_blank" rel="noreferrer">{l.l}</a>)}
            </div>
          </div>
          {!pool && <Ring pct={progress(c)} size={52} stroke={5} />}
        </div>
        <div className="big">
          <div className="v">{v.fmt(i.market_cap, true)}<small>market cap · {unitsFmt(units(i.price, v.dec))} {sym} per {i.symbol}</small></div>
          <div className="desk"><span className="chip">{v.fmt(i.dividends_total)} paid to holders</span></div>
        </div>
      </div>

      <div className="grid2">
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card">
            <div className="strip">
              <div><span>{pool ? "In the pool" : "Raised"}</span><b>{v.fmt(pool ? i.pool_pair : i.raised, true)}</b></div>
              <div><span>Holders</span><b>{num(i.holders, 0)}</b></div>
              <div><span>Trades</span><b>{num(i.trades, 0)}</b></div>
              <div><span>Paid to holders</span><b className="vi">{v.fmt(i.dividends_total, true)}</b></div>
              <div><span>Tax</span><b>{i.buy_tax_bps / 100}% / {i.sell_tax_bps / 100}%</b></div>
              <div><span>Last trade</span><b>{last ? <><span className={last.buy ? "up" : "down"}>{last.buy ? "Buy" : "Sell"}</span> {v.fmt(last.pair)}</> : "—"}</b></div>
            </div>
            {!pool && (
              <div className="progress">
                <div className="bar"><i style={{ width: `${progress(c)}%` }} /></div>
                <div className="l"><span>{unitsFmt(units(i.tokens_sold, 18))} of {unitsFmt(RULES.curveSupply)} sold</span><b>{progress(c).toFixed(1)}%</b></div>
                <div className="fine" style={{ marginTop: 4 }}>Graduates at {v.fmt(i.graduation)} raised. The pool then opens at the last curve price with the 250,000,000 tokens held back.</div>
              </div>
            )}
            <div className="chart-h">
              <span className="pair"><b>{i.symbol}/{sym}</b>{isNearPair(i.pair) && nearUsd > 0 ? <> · NEAR ${nearUsd.toFixed(2)}</> : null}</span>
              <div className="row-flex">
                <div className="seg">{BUCKETS.map((b) => <button key={b.k} className={bucket === b.m ? "on" : ""} onClick={() => setBucket(b.m)}>{b.k}</button>)}</div>
                <div className="seg"><button className={mode === "mcap" ? "on" : ""} onClick={() => setMode("mcap")}>Mcap</button><button className={mode === "price" ? "on" : ""} onClick={() => setMode("price")}>Price</button></div>
              </div>
            </div>
            <div className="chart-b">{candles ? <Chart candles={candles} pairDecimals={v.dec} scale={v.scale} unit={v.unit} mode={mode} supply={units(i.total_supply, 18)} bucketMinutes={bucket} /> : <div className="gc-empty">Chart loads with the first trade.</div>}</div>
          </div>

          <div className="card">
            <div className="tabs">{(["trades", "tax", "about"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k === "tax" ? "Where the tax goes" : k}</button>)}</div>
            {tab === "trades" && <Trades c={c} fmt={v.fmt} />}
            {tab === "tax" && <TaxPanel i={i} fmt={v.fmt} />}
            {tab === "about" && <div className="about">{i.description || "The creator did not add a description."}</div>}
          </div>

          <div className="card">
            <div className="card-h"><h2>The coin</h2><span className="eyebrow">fixed at launch</span></div>
            <div className="card-b">
              <dl className="kv">
                <dt>Pair</dt><dd>{sym}{!isNearPair(i.pair) && <span className="dim" style={{ wordBreak: "break-all" }}>{pairAccount(i.pair)}</span>}</dd>
                <dt>Tax buy / sell</dt><dd>{i.buy_tax_bps / 100}% / {i.sell_tax_bps / 100}%<span className="dim">plus a 1% pool fee once graduated</span></dd>
                <dt>Supply</dt><dd>{unitsFmt(units(i.total_supply, 18))}<span className="dim">{units(i.burned, 18) > 0 ? `${unitsFmt(units(i.burned, 18))} burned` : "1,000,000,000 minted once"}</span></dd>
                <dt>Pool</dt><dd>{pool ? <>{v.fmt(i.pool_pair)}<span className="dim">{unitsFmt(units(i.pool_tokens, 18))} {i.symbol}</span></> : <>Opens at graduation<span className="dim">{v.fmt(i.graduation)} plus 250,000,000 {i.symbol}</span></>}</dd>
                <dt>Fee wallet</dt><dd style={{ wordBreak: "break-all" }}>{i.fee_wallet}</dd>
                <dt>Explorer</dt><dd><a className="vi" href={`${env.explorerUrl}/address/${c.account_id}`} target="_blank" rel="noreferrer">NearBlocks</a></dd>
              </dl>
            </div>
          </div>
        </div>

        <aside style={{ display: "grid", gap: 12 }}>
          <div className="card desk"><div className="card-b"><TradeBox c={c} nearUsd={nearUsd} /></div></div>
          <div className="card"><Yours c={c} fmt={v.fmt} /></div>
        </aside>
      </div>

      <div className="actionbar">
        <button className="b buy" onClick={() => setSheet("buy")}>Buy {i.symbol}</button>
        <button className="b sell" onClick={() => setSheet("sell")}>Sell</button>
      </div>
      {sheet && (
        <>
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet"><div className="grab" /><TradeBox c={c} nearUsd={nearUsd} initial={sheet} /></div>
        </>
      )}
    </main>
  );
}

function TaxPanel({ i, fmt }: { i: Info; fmt: Fmt }) {
  return (
    <div className="card-b" style={{ display: "grid", gap: 14 }}>
      <SplitBar split={i.split} taxPct={i.buy_tax_bps / 100} />
      <dl className="kv">
        <dt>Holder dividends</dt><dd>{fmt(i.dividends_total)}<span className="dim">to everyone holding, in proportion</span></dd>
        <dt>Creator fees</dt><dd>{fmt(i.creator_fees_total)}<span className="dim">credited to the fee wallet</span></dd>
        <dt>Bought back and burned</dt><dd>{unitsFmt(units(i.burned, 18))} {i.symbol}<span className="dim">{fmt(i.buyback_spent)} spent{units(i.pending_buyback, 24) > 0 ? ` · ${fmt(i.pending_buyback)} waiting for the pool` : ""}</span></dd>
        <dt>Added to liquidity</dt><dd>{fmt(i.liquidity_added)}<span className="dim">{units(i.pending_liquidity, 24) > 0 ? `${fmt(i.pending_liquidity)} waiting for the pool` : "from the day the pool opens"}</span></dd>
        <dt>Platform</dt><dd>{fmt(i.platform_fees_total)}<span className="dim">20% of every tax, paid as it happens</span></dd>
      </dl>
    </div>
  );
}

function Yours({ c, fmt }: { c: Coin; fmt: Fmt }) {
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const { data } = useHolder(c.account_id, accountId);
  const i = c.info;
  const owed = data ? BigInt(data.claimable_dividends) + BigInt(data.credit) : 0n;
  const isFeeWallet = accountId && i.fee_wallet === accountId;
  const claim = () => send("Claim", [{ receiverId: c.account_id, methodName: "claim", gas: "50000000000000" }], () => qc.invalidateQueries());
  return (
    <>
      <div className="card-h"><h2>Yours</h2><span className="eyebrow">{i.split.dividends_bps / 100}% of the split to holders</span></div>
      <div className="card-b rw">
        <span className="eyebrow">Owed to you</span>
        <div className="bigv">{data ? fmt(owed.toString()) : "—"}</div>
        <div className="sub">{!accountId ? "Connect a wallet to see your balance and what you are owed." : data ? `${unitsFmt(units(data.balance, 18))} ${i.symbol} held · ${fmt(data.claimable_dividends)} dividends · ${fmt(data.credit)} credits` : "Loading…"}</div>
        {!accountId && <div className="row-flex"><button className="b sm" onClick={() => openWalletModal()}>Connect wallet</button></div>}
        {owed > 0n && <div className="row-flex"><button className="b pri sm" onClick={claim}>Claim {fmt(owed.toString())}</button></div>}
        {isFeeWallet && <p className="fine" style={{ marginTop: 8 }}>You are this coin's fee wallet. Creator fees are part of your credits, lifetime {fmt(i.creator_fees_total)}.</p>}
        <p className="fine" style={{ marginTop: 8 }}>A sale credits you; claiming pays your wallet in {pairSymbol(i.pair)}. Nothing is pushed.</p>
      </div>
    </>
  );
}

function TradeBox({ c, nearUsd, initial = "buy" }: { c: Coin; nearUsd: number; initial?: "buy" | "sell" }) {
  const i = c.info;
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">(initial);
  const [amt, setAmt] = useState("");
  const near = isNearPair(i.pair);
  const sym = pairSymbol(i.pair);
  const dec = pairDecimals(i.pair);
  const pairAcct = pairAccount(i.pair);
  const { data: holder } = useHolder(c.account_id, accountId);
  const { data: payBal } = useQuery({
    queryKey: ["paybal", accountId, pairAcct],
    enabled: !!accountId,
    refetchInterval: env.pollMs,
    queryFn: async () => (near ? accountBalance(accountId!) : BigInt((await view<string>(pairAcct!, "ft_balance_of", { account_id: accountId })) || "0")),
  });
  const raw = useMemo(() => toUnits(amt, side === "buy" ? dec : 18), [amt, side, dec]);
  const { data: quote } = useQuery({
    queryKey: ["quote", c.account_id, side, raw.toString()],
    enabled: raw > 0n && i.phase !== "Graduating",
    staleTime: 4_000,
    queryFn: () => view<string>(c.account_id, side === "buy" ? "quote_buy" : "quote_sell", side === "buy" ? { pair_in: raw.toString() } : { tokens_in: raw.toString() }).catch(() => "0"),
  });
  const out = BigInt(quote ?? "0");
  const tokenBal = BigInt(holder?.balance ?? "0");
  const over = side === "buy" ? payBal != null && raw > payBal : raw > tokenBal;
  const taxPct = (side === "buy" ? i.buy_tax_bps : i.sell_tax_bps) / 100;
  const registered = !!holder && (holder.balance !== "0" || holder.credit !== "0");
  const max = () => {
    if (side === "buy") { if (payBal == null) return; const keep = near ? toUnits("0.05", 24) : 0n; const m = payBal > keep ? payBal - keep : 0n; setAmt((Number(m) / 10 ** dec).toString()); }
    else setAmt((Number(tokenBal) / 1e18).toString());
  };
  const chip = (f: number) => { if (side === "buy") setAmt(String(f)); else setAmt(((Number(tokenBal) / 1e18) * f).toString()); };
  const go = async () => {
    if (!accountId) return openWalletModal();
    if (i.phase === "Graduating") return send("Open the pool", [{ receiverId: c.account_id, methodName: "open_pool", gas: "100000000000000" }], () => qc.invalidateQueries());
    const floor = ((out * 95n) / 100n).toString();
    const ok = side === "buy"
      ? near
        ? await send(`Buy ${i.symbol}`, [{ receiverId: c.account_id, methodName: "buy", args: { min_out: floor, for_account: null }, deposit: raw.toString() }], () => qc.invalidateQueries())
        : await send(`Buy ${i.symbol}`, [
            ...(registered ? [] : [{ receiverId: c.account_id, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: "1250000000000000000000", gas: "30000000000000" }]),
            { receiverId: pairAcct!, methodName: "ft_transfer_call", args: { receiver_id: c.account_id, amount: raw.toString(), msg: JSON.stringify({ min_out: floor }) }, deposit: "1", gas: "100000000000000" },
          ], () => qc.invalidateQueries())
      : await send(`Sell ${i.symbol}`, [{ receiverId: c.account_id, methodName: "sell", args: { amount: raw.toString(), min_out: floor } }], () => qc.invalidateQueries());
    if (ok) setAmt("");
  };
  const payUsd = near ? nearUsd : 0;
  return (
    <>
      <div className="seg" style={{ display: "flex" }}>
        <button style={{ flex: 1 }} className={side === "buy" ? "on buy" : ""} onClick={() => { setSide("buy"); setAmt(""); }}>Buy</button>
        <button style={{ flex: 1 }} className={side === "sell" ? "on sell" : ""} onClick={() => { setSide("sell"); setAmt(""); }}>Sell</button>
      </div>
      <div className="amount">
        <div className="lbl"><span>{side === "buy" ? "You pay" : "You sell"}</span><button type="button" onClick={max}>{side === "buy" ? (payBal != null ? `${unitsFmt(units(payBal, dec))} ${sym}` : "Max") : holder ? `${unitsFmt(units(tokenBal, 18))} ${i.symbol}` : "Max"}</button></div>
        <div className="in-row"><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="u">{side === "buy" ? sym : i.symbol}</span></div>
      </div>
      <div className="chips">{side === "buy" ? (near ? [1, 5, 10, 50] : [0.01, 0.05, 0.1, 0.5]).map((x) => <button key={x} onClick={() => chip(x)}>{x}</button>) : [0.25, 0.5, 0.75, 1].map((x) => <button key={x} onClick={() => chip(x)}>{x * 100}%</button>)}</div>
      <dl className="quote">
        <dt>You receive</dt><dd><b>{raw > 0n ? (side === "buy" ? `${unitsFmt(units(out, 18))} ${i.symbol}` : `${unitsFmt(units(out, dec))} ${sym}`) : "—"}</b></dd>
        {payUsd > 0 && <><dt>Value</dt><dd><b>{raw > 0n ? `$${(side === "buy" ? units(raw, dec) * payUsd : units(out, dec) * payUsd).toFixed(2)}` : "—"}</b></dd></>}
        <dt>Tax</dt><dd><b>{taxPct}%{i.phase === "Pool" ? " + 1% pool fee" : ""}</b><span className="faint"> · {i.split.dividends_bps / 100}% of it to holders</span></dd>
        <dt>Price</dt><dd><b>{unitsFmt(units(i.price, dec))} {sym}</b></dd>
      </dl>
      {i.phase === "Graduating" && <div className="warn" style={{ marginBottom: 10 }}>The curve just filled. Open the pool to resume trading; anyone can.</div>}
      {over && <div className="warn" style={{ marginBottom: 10 }}>Amount is more than your balance.</div>}
      <button className={"b lg wide " + (side === "sell" ? "sell" : "buy")} disabled={!!accountId && i.phase !== "Graduating" && (raw === 0n || over)} onClick={go}>{!accountId ? "Connect wallet" : i.phase === "Graduating" ? "Open the pool" : side === "buy" ? `Buy ${i.symbol}` : `Sell ${i.symbol}`}</button>
      <p className="fine" style={{ marginTop: 10 }}>{near ? "You pay NEAR from your wallet in one approval." : `You pay ${sym} from your wallet. A first buy also registers you on the coin (0.00125 NEAR).`} A sale credits you in {sym}; claim it any time. Slippage 5%.</p>
    </>
  );
}

const PAGE = 12;

function Trades({ c, fmt }: { c: Coin; fmt: Fmt }) {
  const { data: trades } = useTrades(c.account_id);
  const [page, setPage] = useState(0);
  if (!trades) return <div className="skel" style={{ height: 140, margin: 12 }} />;
  const slice = trades.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(trades.length / PAGE));
  return (
    <div className="log">
      {trades.length === 0 && <div className="empty">No trades yet. The first buy sets the price.</div>}
      {slice.map((tr, k) => (
        <a key={`${tr.t}-${k}`} className="li" href={`${env.explorerUrl}/address/${tr.account}`} target="_blank" rel="noreferrer">
          <span className="t">{ago(tr.t)}</span>
          <span className={"side " + (tr.buy ? "up" : "down")}>{tr.buy ? "Buy" : "Sell"}</span>
          <span className="who">{short(tr.account, 9)}</span>
          <span className="r">{unitsFmt(units(tr.tokens, 18))} {c.info.symbol}<small>{fmt(tr.pair)}</small></span>
        </a>
      ))}
      {pages > 1 && (
        <div className="pager">
          <button className="b ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
          <span>{page * PAGE + 1}–{Math.min(trades.length, (page + 1) * PAGE)} of {trades.length}</span>
          <button className="b ghost sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
