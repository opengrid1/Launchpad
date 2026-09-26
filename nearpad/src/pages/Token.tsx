import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Art } from "../components/Art";
import { PairLogo } from "../components/PairLogo";
import { Chart } from "../components/Chart";
import { Copy } from "../components/Copy";
import { Ring } from "../components/Ring";
import { SplitBar } from "../components/SplitBar";
import { env, PINNED, RHEA, RULES } from "../lib/env";
import { ago, dateShort, num, short, toUnits, units } from "../lib/format";
import { useCandles, useCoin, useCurrency, useHolder, useNearUsd, usePool, useTrades } from "../lib/hooks";
import { accountBalance, view } from "../lib/rpc";
import type { Coin, DexPool, Info } from "../lib/types";
import { isNearPair, pairAccount, pairDecimals, pairSymbol } from "../lib/types";
import { makeValuer, pairKind, progress, unitsFmt } from "../lib/value";
import { openWalletModal, send, useAccount } from "../lib/wallet";

const BUCKETS: { k: string; m: number }[] = [{ k: "5m", m: 5 }, { k: "15m", m: 15 }, { k: "1h", m: 60 }, { k: "4h", m: 240 }, { k: "1d", m: 1440 }];
type Fmt = (raw: string, compact?: boolean) => string;
/** What every holder locks on a coin for storage. */
const STORAGE_MIN = "4000000000000000000000";
/** What a token-pair coin needs attached to open its pool on Rhea. */
const OPEN_POOL_DEPOSIT = "200000000000000000000000";
const HARVEST_MIN = 1000n * 10n ** 18n;
const GAS_MAX = "300000000000000";

/** The Rhea pool's reserves as (pair, tokens), whichever order the pool lists them. */
function reserves(p: DexPool | undefined, coin: string): [bigint, bigint] | null {
  if (!p) return null;
  const ti = p.token_account_ids.indexOf(coin);
  if (ti < 0) return null;
  return [BigInt(p.amounts[1 - ti]), BigInt(p.amounts[ti])];
}

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
  const { data: dexPool } = usePool(i.dex, i.pool_id);
  const [tab, setTab] = useState<"trades" | "tax" | "about">("trades");
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const kind = pairKind(i.pair);
  const sym = pairSymbol(i.pair);
  const pool = i.phase === "Pool";
  const grad = i.phase === "Graduating";
  const near = isNearPair(i.pair);
  const links = [i.links.website && { l: "Website", u: i.links.website }, i.links.x && { l: "X", u: i.links.x }, i.links.telegram && { l: "Telegram", u: i.links.telegram }].filter(Boolean) as { l: string; u: string }[];
  const last = trades?.[0];
  // Once on Rhea, the price is the pool's.
  const res = reserves(dexPool, c.account_id);
  const price = pool && res && res[1] > 0n ? ((res[0] * 10n ** 18n) / res[1]).toString() : i.price;
  const mcap = pool && res && res[1] > 0n ? ((BigInt(price) * BigInt(i.total_supply)) / 10n ** 18n).toString() : i.market_cap;
  const pairToken = near ? RHEA.wnear : pairAccount(i.pair)!;
  const openPool = () => {
    if (!accountId) return openWalletModal();
    return send("Open the pool on Rhea", [{ receiverId: c.account_id, methodName: "open_pool", deposit: near ? "0" : OPEN_POOL_DEPOSIT, gas: GAS_MAX }], () => qc.invalidateQueries());
  };

  return (
    <main>
      <div className="head">
        <div className="id">
          <Art src={i.icon ?? undefined} name={i.name} className="art" size={56} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1>{i.name}<span className="sym">{i.symbol}</span>{PINNED.includes(c.account_id) && <span className="chip official">Official</span>}<span className={"chip " + (pool ? "pool" : grad ? "grad" : kind)}>{pool ? "On Rhea" : grad ? "Opening the pool" : <><PairLogo k={sym} size={16} />Pays {sym}</>}</span></h1>
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
          <div className="v">{v.fmt(mcap, true)}<small>market cap · {unitsFmt(units(price, v.dec))} {sym} per {i.symbol}{pool ? " on Rhea" : ""}</small></div>
          <div className="desk"><span className="chip">{v.fmt(i.dividends_total)} paid to holders</span></div>
        </div>
      </div>

      <div className="grid2">
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card">
            <div className="strip">
              <div><span>{pool ? "In the Rhea pool" : "Raised"}</span><b>{v.fmt(pool ? (res ? res[0].toString() : i.pool_pair) : i.raised, true)}</b></div>
              <div><span>Holders</span><b>{num(i.holders, 0)}</b></div>
              <div><span>Trades</span><b>{num(i.trades, 0)}</b></div>
              <div><span>Paid to holders</span><b className="vi">{v.fmt(i.dividends_total, true)}</b></div>
              <div><span>Tax</span><b>{i.buy_tax_bps / 100}% / {i.sell_tax_bps / 100}%</b></div>
              <div><span>Last curve trade</span><b>{last ? <><span className={last.buy ? "up" : "down"}>{last.buy ? "Buy" : "Sell"}</span> {v.fmt(last.pair)}</> : "—"}</b></div>
            </div>
            {!pool && (
              <div className="progress">
                <div className="bar"><i style={{ width: `${progress(c)}%` }} /></div>
                <div className="l"><span>{unitsFmt(units(i.tokens_sold, 18))} of {unitsFmt(RULES.curveSupply)} sold</span><b>{progress(c).toFixed(1)}%</b></div>
                {grad ? (
                  <div className="warn" style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ flex: 1 }}>The curve filled. The pool opens on Rhea with {v.fmt(i.graduation)} and the 250,000,000 {i.symbol} held back; anyone can open it.{near ? "" : " It costs 0.2 NEAR of Rhea storage."}{i.grad.pool_created ? " A previous attempt got part way; calling again resumes it." : ""}</span>
                    <button className="b pri sm" onClick={openPool}>Open the pool</button>
                  </div>
                ) : (
                  <div className="fine" style={{ marginTop: 4 }}>Graduates at {v.fmt(i.graduation)} raised. The pool then opens on Rhea at the last curve price with the 250,000,000 tokens held back.</div>
                )}
              </div>
            )}
            <div className="chart-h">
              <span className="pair"><b>{i.symbol}/{sym}</b>{near && nearUsd > 0 ? <> · NEAR ${nearUsd.toFixed(2)}</> : null}{pool ? <> · <a className="vi" href={RHEA.swap(pairToken, c.account_id)} target="_blank" rel="noreferrer">live on Rhea</a></> : null}</span>
              <div className="row-flex">
                <div className="seg">{BUCKETS.map((b) => <button key={b.k} className={bucket === b.m ? "on" : ""} onClick={() => setBucket(b.m)}>{b.k}</button>)}</div>
                <div className="seg"><button className={mode === "mcap" ? "on" : ""} onClick={() => setMode("mcap")}>Mcap</button><button className={mode === "price" ? "on" : ""} onClick={() => setMode("price")}>Price</button></div>
              </div>
            </div>
            <div className="chart-b">{candles && candles.length > 0 ? <Chart candles={candles} pairDecimals={v.dec} scale={v.scale} unit={v.unit} mode={mode} supply={units(i.total_supply, 18)} bucketMinutes={bucket} /> : <div className="gc-empty">Chart loads with the first trade.</div>}</div>
            {pool && <p className="fine" style={{ padding: "0 14px 12px" }}>The chart shows the curve. Since graduation, trades happen on Rhea; the price above is the pool's, live.</p>}
          </div>

          <div className="card">
            <div className="tabs">{(["trades", "tax", "about"] as const).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k === "tax" ? "Where the tax goes" : k}</button>)}</div>
            {tab === "trades" && <Trades c={c} fmt={v.fmt} />}
            {tab === "tax" && <TaxPanel c={c} fmt={v.fmt} />}
            {tab === "about" && <div className="about">{i.description || "The creator did not add a description."}</div>}
          </div>

          <div className="card">
            <div className="card-h"><h2>The coin</h2><span className="eyebrow">fixed at launch</span></div>
            <div className="card-b">
              <dl className="kv">
                <dt>Pair</dt><dd>{sym}{!near && <span className="dim" style={{ wordBreak: "break-all" }}>{pairAccount(i.pair)}</span>}</dd>
                <dt>Tax buy / sell</dt><dd>{i.buy_tax_bps / 100}% / {i.sell_tax_bps / 100}%<span className="dim">on the curve in {sym}; on Rhea, in {i.symbol} on every trade with the pool</span></dd>
                <dt>Supply</dt><dd>{unitsFmt(units(i.total_supply, 18))}<span className="dim">{units(i.burned, 18) > 0 ? `${unitsFmt(units(i.burned, 18))} burned` : "1,000,000,000 minted once"}</span></dd>
                <dt>Pool</dt><dd>{pool ? <><a className="vi" href={RHEA.swap(pairToken, c.account_id)} target="_blank" rel="noreferrer">Rhea pool #{i.pool_id}</a><span className="dim">{res ? `${v.fmt(res[0].toString())} and ${unitsFmt(units(res[1].toString(), 18))} ${i.symbol}` : "loading"} · 0.3% pool fee to the LP</span></> : <>Opens on Rhea at graduation<span className="dim">{v.fmt(i.graduation)} plus 250,000,000 {i.symbol}</span></>}</dd>
                {pool && <><dt>LP</dt><dd>Held by the coin<span className="dim">{unitsFmt(units(i.lp_shares, 24))} shares{BigInt(i.lp_collected) > 0n ? ` · ${unitsFmt(units(i.lp_collected, 24))} moved by the platform` : ""}</span></dd></>}
                <dt>Fee wallet</dt><dd style={{ wordBreak: "break-all" }}>{i.fee_wallet}</dd>
                <dt>Explorer</dt><dd><a className="vi" href={`${env.explorerUrl}/address/${c.account_id}`} target="_blank" rel="noreferrer">NearBlocks</a></dd>
              </dl>
            </div>
          </div>
        </div>

        <aside style={{ display: "grid", gap: 12 }}>
          <div className="card desk"><div className="card-b"><TradeBox c={c} nearUsd={nearUsd} dexPool={dexPool} /></div></div>
          <div className="card"><Yours c={c} fmt={v.fmt} /></div>
        </aside>
      </div>

      <div className="actionbar">
        {grad ? <button className="b pri" onClick={openPool}>Open the pool on Rhea</button> : (
          <>
            <button className="b buy" onClick={() => setSheet("buy")}>Buy {i.symbol}</button>
            <button className="b sell" onClick={() => setSheet("sell")}>Sell</button>
          </>
        )}
      </div>
      {sheet && (
        <>
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet"><div className="grab" /><TradeBox c={c} nearUsd={nearUsd} dexPool={dexPool} initial={sheet} /></div>
        </>
      )}
    </main>
  );
}

function TaxPanel({ c, fmt }: { c: Coin; fmt: Fmt }) {
  const i = c.info;
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const waiting = BigInt(i.tax_tokens);
  const running = i.harvest.step > 0 || i.harvest.lock_until > 0;
  const harvest = () => {
    if (!accountId) return openWalletModal();
    return send("Harvest the tax", [{ receiverId: c.account_id, methodName: "harvest", gas: GAS_MAX }], () => qc.invalidateQueries());
  };
  return (
    <div className="card-b" style={{ display: "grid", gap: 14 }}>
      <SplitBar split={i.split} taxPct={i.buy_tax_bps / 100} />
      <dl className="kv">
        <dt>Holder dividends</dt><dd>{fmt(i.dividends_total)}<span className="dim">to everyone holding, in proportion</span></dd>
        <dt>Creator fees</dt><dd>{fmt(i.creator_fees_total)}<span className="dim">credited to the fee wallet</span></dd>
        <dt>Burned</dt><dd>{unitsFmt(units(i.burned, 18))} {i.symbol}<span className="dim">{units(i.buyback_spent, 24) > 0 ? `${fmt(i.buyback_spent)} spent buying back` : "bought back at graduation, then straight from the tax"}{units(i.pending_buyback, 24) > 0 ? ` · ${fmt(i.pending_buyback)} waiting for the pool` : ""}</span></dd>
        <dt>Added to liquidity</dt><dd>{fmt(i.liquidity_added)}<span className="dim">{units(i.pending_liquidity, 24) > 0 ? `${fmt(i.pending_liquidity)} waiting for the pool` : "into the Rhea pool, LP held by the coin"}</span></dd>
        <dt>Platform</dt><dd>{fmt(i.platform_fees_total)}<span className="dim">20% of every tax, paid as it happens</span></dd>
      </dl>
      {i.phase === "Pool" && (
        <div className="creditbox">
          <div><b>{unitsFmt(units(i.tax_tokens, 18))} {i.symbol}</b> of tax waiting to be divided</div>
          <p className="fine" style={{ margin: "4px 0 8px" }}>Since graduation the tax is taken in {i.symbol} on every Rhea trade. A harvest burns the burn share, sells the rest on Rhea for {pairSymbol(i.pair)} and pays it out like a curve tax. Anyone can run it once {unitsFmt(Number(HARVEST_MIN / 10n ** 18n))} {i.symbol} have gathered.</p>
          <button className="b pri sm" disabled={waiting < HARVEST_MIN && !running} onClick={harvest}>{running ? "Resume the harvest" : waiting < HARVEST_MIN ? "Not enough yet" : "Harvest now"}</button>
        </div>
      )}
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
        <p className="fine" style={{ marginTop: 8 }}>{i.phase === "Pool" ? "Dividends keep coming from every harvest." : "A sale credits you; claiming pays your wallet in " + pairSymbol(i.pair) + "."} Nothing is pushed.</p>
      </div>
    </>
  );
}

function TradeBox({ c, nearUsd, dexPool, initial = "buy" }: { c: Coin; nearUsd: number; dexPool?: DexPool; initial?: "buy" | "sell" }) {
  const i = c.info;
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">(initial);
  const [amt, setAmt] = useState("");
  const near = isNearPair(i.pair);
  const sym = pairSymbol(i.pair);
  const dec = pairDecimals(i.pair);
  const pairAcct = pairAccount(i.pair);
  const pool = i.phase === "Pool";
  const pairToken = near ? RHEA.wnear : pairAcct!;
  const { data: holder } = useHolder(c.account_id, accountId);
  const { data: payBal } = useQuery({
    queryKey: ["paybal", accountId, pairAcct],
    enabled: !!accountId,
    refetchInterval: env.pollMs,
    queryFn: async () => (near ? accountBalance(accountId!) : BigInt((await view<string>(pairAcct!, "ft_balance_of", { account_id: accountId })) || "0")),
  });
  // Once on Rhea, a NEAR coin's sales pay wNEAR: show it and offer to unwrap.
  const { data: wnearBal } = useQuery({
    queryKey: ["wnear", accountId],
    enabled: !!accountId && near && pool,
    refetchInterval: env.pollMs,
    queryFn: async () => BigInt((await view<string>(RHEA.wnear, "ft_balance_of", { account_id: accountId }).catch(() => "0")) || "0"),
  });
  const { data: wnearReg } = useQuery({
    queryKey: ["wnearreg", accountId],
    enabled: !!accountId && near && pool,
    queryFn: async () => !!(await view<unknown>(RHEA.wnear, "storage_balance_of", { account_id: accountId }).catch(() => null)),
  });
  const raw = useMemo(() => toUnits(amt, side === "buy" ? dec : 18), [amt, side, dec]);
  const { data: quote } = useQuery({
    queryKey: ["quote", c.account_id, side, raw.toString()],
    enabled: raw > 0n && i.phase === "Curve",
    staleTime: 4_000,
    queryFn: () => view<string>(c.account_id, side === "buy" ? "quote_buy" : "quote_sell", side === "buy" ? { pair_in: raw.toString() } : { tokens_in: raw.toString() }).catch(() => "0"),
  });
  // On Rhea: constant product over the pool's reserves, its fee, then the tax in tokens.
  const res = reserves(dexPool, c.account_id);
  const feeBps = BigInt(dexPool?.total_fee ?? 30);
  const out = useMemo(() => {
    if (!pool) return BigInt(quote ?? "0");
    if (!res || raw === 0n) return 0n;
    const [rp, rt] = res;
    if (side === "buy") {
      const inNet = raw - (raw * feeBps) / 10000n;
      const tokens = (rt * inNet) / (rp + inNet);
      return tokens - (tokens * BigInt(i.buy_tax_bps)) / 10000n;
    }
    const afterTax = raw - (raw * BigInt(i.sell_tax_bps)) / 10000n;
    const inNet = afterTax - (afterTax * feeBps) / 10000n;
    return (rp * inNet) / (rt + inNet);
  }, [pool, quote, res, raw, side, feeBps, i.buy_tax_bps, i.sell_tax_bps]);
  const tokenBal = BigInt(holder?.balance ?? "0");
  const over = side === "buy" ? payBal != null && raw > payBal : raw > tokenBal;
  const taxPct = (side === "buy" ? i.buy_tax_bps : i.sell_tax_bps) / 100;
  const registered = !!holder && (holder.balance !== "0" || holder.credit !== "0" || holder.claimable_dividends !== "0");
  const max = () => {
    if (side === "buy") { if (payBal == null) return; const keep = near ? toUnits("0.05", 24) : 0n; const m = payBal > keep ? payBal - keep : 0n; setAmt((Number(m) / 10 ** dec).toString()); }
    else setAmt((Number(tokenBal) / 1e18).toString());
  };
  const chip = (f: number) => { if (side === "buy") setAmt(String(f)); else setAmt(((Number(tokenBal) / 1e18) * f).toString()); };
  const register = registered ? [] : [{ receiverId: c.account_id, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: STORAGE_MIN, gas: "30000000000000" }];
  const unwrap = () => send("Unwrap wNEAR", [{ receiverId: RHEA.wnear, methodName: "near_withdraw", args: { amount: (wnearBal ?? 0n).toString() }, deposit: "1", gas: "30000000000000" }], () => qc.invalidateQueries());
  const go = async () => {
    if (!accountId) return openWalletModal();
    if (i.phase === "Graduating") return send("Open the pool on Rhea", [{ receiverId: c.account_id, methodName: "open_pool", deposit: near ? "0" : OPEN_POOL_DEPOSIT, gas: GAS_MAX }], () => qc.invalidateQueries());
    const floor = ((out * 95n) / 100n).toString();
    let ok: { hash?: string } | false;
    if (!pool) {
      ok = side === "buy"
        ? near
          ? await send(`Buy ${i.symbol}`, [{ receiverId: c.account_id, methodName: "buy", args: { min_out: floor, for_account: null }, deposit: raw.toString() }], () => qc.invalidateQueries())
          : await send(`Buy ${i.symbol}`, [
              ...register,
              { receiverId: pairAcct!, methodName: "ft_transfer_call", args: { receiver_id: c.account_id, amount: raw.toString(), msg: JSON.stringify({ min_out: floor }) }, deposit: "1", gas: "100000000000000" },
            ], () => qc.invalidateQueries())
        : await send(`Sell ${i.symbol}`, [{ receiverId: c.account_id, methodName: "sell", args: { amount: raw.toString(), min_out: floor } }], () => qc.invalidateQueries());
    } else if (side === "buy") {
      // Pay the pair into Rhea; Rhea sends the tokens, the coin keeps the tax.
      const msg = JSON.stringify({ force: 0, actions: [{ pool_id: i.pool_id, token_in: pairToken, token_out: c.account_id, min_amount_out: ((out * 95n) / 100n / (10000n - BigInt(i.buy_tax_bps)) * 10000n).toString() }] });
      ok = await send(`Buy ${i.symbol} on Rhea`, [
        ...register,
        ...(near ? [
          ...(wnearReg ? [] : [{ receiverId: RHEA.wnear, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: "1250000000000000000000", gas: "30000000000000" }]),
          { receiverId: RHEA.wnear, methodName: "near_deposit", args: {}, deposit: raw.toString(), gas: "30000000000000" },
        ] : []),
        { receiverId: pairToken, methodName: "ft_transfer_call", args: { receiver_id: RHEA.dex, amount: raw.toString(), msg }, deposit: "1", gas: "180000000000000" },
      ], () => qc.invalidateQueries());
    } else {
      // Send tokens into Rhea; the coin keeps the tax and forwards the rest.
      const msg = JSON.stringify({ force: 0, actions: [{ pool_id: i.pool_id, token_in: c.account_id, token_out: pairToken, min_amount_out: floor }] });
      ok = await send(`Sell ${i.symbol} on Rhea`, [
        ...(near && !wnearReg ? [{ receiverId: RHEA.wnear, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: "1250000000000000000000", gas: "30000000000000" }] : []),
        { receiverId: c.account_id, methodName: "ft_transfer_call", args: { receiver_id: RHEA.dex, amount: raw.toString(), msg }, deposit: "1", gas: "180000000000000" },
      ], () => qc.invalidateQueries());
    }
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
        <dt>You receive</dt><dd><b>{raw > 0n ? (side === "buy" ? `${unitsFmt(units(out, 18))} ${i.symbol}` : `${unitsFmt(units(out, dec))} ${pool && near ? "wNEAR" : sym}`) : "—"}</b></dd>
        {payUsd > 0 && <><dt>Value</dt><dd><b>{raw > 0n ? `$${(side === "buy" ? units(raw, dec) * payUsd : units(out, dec) * payUsd).toFixed(2)}` : "—"}</b></dd></>}
        <dt>Tax</dt><dd><b>{taxPct}%{pool ? ` + ${Number(feeBps) / 100}% pool fee` : ""}</b><span className="faint"> · {i.split.dividends_bps / 100}% of it to holders</span></dd>
        <dt>Where</dt><dd><b>{pool ? "Rhea pool" : "The curve"}</b></dd>
      </dl>
      {i.phase === "Graduating" && <div className="warn" style={{ marginBottom: 10 }}>The curve just filled. Open the pool on Rhea to resume trading; anyone can.{near ? "" : " It costs 0.2 NEAR of Rhea storage."}</div>}
      {over && <div className="warn" style={{ marginBottom: 10 }}>Amount is more than your balance.{!near && side === "buy" && <> <Link to={`/get/${sym}`} className="vi">Get {sym} with NEAR</Link>.</>}</div>}
      {!near && side === "buy" && !over && payBal === 0n && <div className="warn" style={{ marginBottom: 10 }}>You have no {sym} yet. <Link to={`/get/${sym}`} className="vi">Swap NEAR for {sym}</Link> first.</div>}
      <button className={"b lg wide " + (side === "sell" ? "sell" : "buy")} disabled={!!accountId && i.phase !== "Graduating" && (raw === 0n || over || (pool && !res))} onClick={go}>{!accountId ? "Connect wallet" : i.phase === "Graduating" ? "Open the pool" : side === "buy" ? `Buy ${i.symbol}` : `Sell ${i.symbol}`}</button>
      {pool && near && (wnearBal ?? 0n) > 0n && <div className="row-flex" style={{ marginTop: 10, justifyContent: "space-between" }}><span className="fine">{unitsFmt(units(wnearBal!.toString(), 24))} wNEAR in your wallet from sales</span><button className="b ghost sm" onClick={unwrap}>Unwrap to NEAR</button></div>}
      <p className="fine" style={{ marginTop: 10 }}>{pool
        ? near ? "Buys wrap your NEAR and swap on Rhea in one approval. A sale pays wNEAR to your wallet; unwrap it here any time. Slippage 5%." : `Trades swap on Rhea in one approval and settle in ${sym} to your wallet. Slippage 5%.`
        : near ? "You pay NEAR from your wallet in one approval." : `You pay ${sym} from your wallet. A first buy also registers you on the coin (0.004 NEAR, returned if you ever leave).`} {!pool && <>A sale credits you in {sym}; claim it any time. Slippage 5%.</>}</p>
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
      {c.info.phase === "Pool" && trades.length > 0 && <div className="fine" style={{ padding: "8px 12px 0" }}>Curve trades. Trades since graduation are on <a className="vi" href={`${env.explorerUrl}/address/${c.account_id}`} target="_blank" rel="noreferrer">NearBlocks</a> and Rhea.</div>}
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
