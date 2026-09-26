import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PairLogo } from "../components/PairLogo";
import { DEMO, env } from "../lib/env";
import { toUnits, units } from "../lib/format";
import { setToast, useNearUsd, usePairs } from "../lib/hooks";
import { INTENTS_APP, INTENTS_CONTRACT, NoLiquidity, pancakeUrl, quoteNearToStock, submitDeposit, swapStatus, type Quote, type SwapStatus } from "../lib/intents";
import { accountBalance, view } from "../lib/rpc";
import type { Pair } from "../lib/types";
import { pairKind, unitsFmt } from "../lib/value";
import { openWalletModal, send, useAccount } from "../lib/wallet";

type Step = { phase: "idle" } | { phase: "quoted"; q: Quote } | { phase: "deposited"; q: Quote; status: SwapStatus | "SENT" } | { phase: "done"; q: Quote; amountOut: string } | { phase: "withdrawn"; amountOut: string };

/** Turn NEAR into a tokenized stock without leaving NEAR, through NEAR
 *  Intents. Two approvals: the deposit, then the withdrawal to the wallet. */
export default function GetStock() {
  const { key } = useParams<{ key: string }>();
  const { data: pairs } = usePairs();
  const stocks = useMemo(() => (pairs ?? []).filter((p) => p.enabled && p.asset !== "Near" && pairKind(p.asset) === "stock"), [pairs]);
  const [sel, setSel] = useState<string | undefined>(key);
  useEffect(() => { if (key) setSel(key); }, [key]);
  const pair = stocks.find((p) => p.key === sel) ?? stocks[0];
  return (
    <main>
      <div style={{ marginBottom: 12 }}><h1 style={{ fontSize: 22 }}>Get a stock token</h1><p className="fine" style={{ marginTop: 4 }}>Coins paired with a stock are bought with that stock's token. Swap NEAR for it here, through NEAR Intents, and it lands in your wallet.</p></div>
      {stocks.length === 0 ? <div className="card"><div className="empty">No stock pairs are listed yet.</div></div> : (
        <>
          <div className="scroll-x" style={{ marginBottom: 6 }}>
            {stocks.map((p) => (
              <Link key={p.key} to={`/get/${p.key}`} className={"pill " + (pair?.key === p.key ? "on" : "")} onClick={() => setSel(p.key)}>
                <PairLogo k={p.key} size={22} />{p.key}
              </Link>
            ))}
          </div>
          {pair && <SwapBox pair={pair} />}
        </>
      )}
    </main>
  );
}

function SwapBox({ pair }: { pair: Pair }) {
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const { data: nearUsd = 0 } = useNearUsd();
  const token = pair.asset !== "Near" ? pair.asset.Token.account_id : "";
  const dec = pair.asset !== "Near" ? pair.asset.Token.decimals : 18;
  const sym = pair.key;
  const [amt, setAmt] = useState("10");
  const [step, setStep] = useState<Step>({ phase: "idle" });
  const raw = useMemo(() => toUnits(amt, 24), [amt]);
  useEffect(() => { setStep({ phase: "idle" }); }, [pair.key]);
  const { data: bal } = useQuery({ queryKey: ["nearbal", accountId], enabled: !!accountId && !DEMO, queryFn: () => accountBalance(accountId!) });
  const { data: stockBal } = useQuery({ queryKey: ["stockbal", accountId, token], enabled: !!accountId && !DEMO, refetchInterval: env.pollMs, queryFn: async () => BigInt((await view<string>(token, "ft_balance_of", { account_id: accountId }).catch(() => "0")) || "0") });
  // A dry quote prices it; it is refreshed as the amount changes.
  const { data: dry, error: dryErr, isFetching } = useQuery({
    queryKey: ["dryquote", token, raw.toString(), accountId ?? "anon"],
    enabled: raw > 0n && !DEMO,
    staleTime: 20_000,
    retry: false,
    queryFn: () => quoteNearToStock({ account: accountId ?? "chipfi.near", stockAccount: token, yoctoIn: raw.toString(), dry: true }),
  });
  const noLiq = dryErr instanceof NoLiquidity;
  const pancake = pancakeUrl(token);

  // Poll the swap once the deposit is sent.
  useEffect(() => {
    if (step.phase !== "deposited" || !step.q.depositAddress) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const s = await swapStatus(step.q.depositAddress!, step.q.depositMemo);
        if (!alive) return;
        if (s.status === "SUCCESS") { setStep({ phase: "done", q: step.q, amountOut: s.swapDetails?.amountOut ?? step.q.minAmountOut }); }
        else if (s.status === "REFUNDED" || s.status === "FAILED") { setToast({ kind: "err", text: s.status === "REFUNDED" ? "The swap was refunded to your wallet." : "The swap failed." }); setStep({ phase: "idle" }); }
        else setStep({ phase: "deposited", q: step.q, status: s.status });
      } catch { /* try again next tick */ }
    }, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [step]);

  const start = async () => {
    if (!accountId) return openWalletModal();
    if (raw === 0n) return;
    if (bal != null && raw > bal - toUnits("0.1", 24)) return setToast({ kind: "err", text: "Leave at least 0.1 NEAR for gas." });
    let q: Quote;
    try { q = await quoteNearToStock({ account: accountId, stockAccount: token, yoctoIn: raw.toString(), dry: false }); }
    catch (e) { setToast({ kind: "err", text: e instanceof NoLiquidity ? "No one is quoting this stock right now. Try again later." : String((e as Error).message) }); return; }
    if (!q.depositAddress) { setToast({ kind: "err", text: "No deposit address in the quote." }); return; }
    setStep({ phase: "quoted", q });
    const registered = !!(await view<unknown>("wrap.near", "storage_balance_of", { account_id: accountId }).catch(() => null));
    const res = await send(`Swap ${unitsFmt(units(raw, 24))} NEAR for ${sym}`, [
      ...(registered ? [] : [{ receiverId: "wrap.near", methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: "1250000000000000000000", gas: "30000000000000" }]),
      { receiverId: "wrap.near", methodName: "near_deposit", args: {}, deposit: raw.toString(), gas: "30000000000000" },
      { receiverId: "wrap.near", methodName: "ft_transfer", args: { receiver_id: q.depositAddress, amount: raw.toString(), memo: q.depositMemo ?? null }, deposit: "1", gas: "30000000000000" },
    ]);
    if (!res) { setStep({ phase: "idle" }); return; }
    if (res.hash) submitDeposit(q.depositAddress, res.hash, q.depositMemo);
    setStep({ phase: "deposited", q, status: "SENT" });
  };

  const withdraw = async (amountOut: string) => {
    if (!accountId) return;
    const registered = !!(await view<unknown>(token, "storage_balance_of", { account_id: accountId }).catch(() => null));
    const res = await send(`Withdraw ${sym} to your wallet`, [
      ...(registered ? [] : [{ receiverId: token, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: "12500000000000000000000", gas: "30000000000000" }]),
      { receiverId: INTENTS_CONTRACT, methodName: "ft_withdraw", args: { token, receiver_id: accountId, amount: amountOut }, deposit: "1", gas: "100000000000000" },
    ], () => qc.invalidateQueries());
    if (res) setStep({ phase: "withdrawn", amountOut });
  };

  const busy = step.phase === "quoted" || step.phase === "deposited";
  return (
    <div className="card">
      <div className="card-h"><h2><PairLogo k={pair.key} size={22} /> Get {sym}</h2><span className="eyebrow">via NEAR Intents</span></div>
      <div className="card-b">
        {step.phase === "withdrawn" ? (
          <div className="creditbox">
            <b>{unitsFmt(units(step.amountOut, dec))} {sym} is in your wallet.</b>
            <p className="fine" style={{ margin: "6px 0 10px" }}>You can now buy any coin paired with {sym}.</p>
            <div className="row-flex"><Link to="/" className="b pri sm">Find a coin paired with {sym}</Link><button className="b ghost sm" onClick={() => setStep({ phase: "idle" })}>Swap more</button></div>
          </div>
        ) : step.phase === "done" ? (
          <div className="creditbox">
            <b>Swapped. {unitsFmt(units(step.amountOut, dec))} {sym} is waiting in your Intents account.</b>
            <p className="fine" style={{ margin: "6px 0 10px" }}>One more approval moves it into your wallet, where coins can take it.{stockBal != null ? "" : ""}</p>
            <button className="b pri" onClick={() => withdraw(step.amountOut)}>Withdraw {sym} to my wallet</button>
          </div>
        ) : step.phase === "deposited" ? (
          <div className="creditbox">
            <div className="row-flex"><span className="spin" /><b>{step.status === "SENT" || step.status === "PENDING_DEPOSIT" || step.status === "KNOWN_DEPOSIT_TX" ? "Deposit sent, waiting for the solver" : step.status === "PROCESSING" ? "Swapping" : step.status.toLowerCase().replace(/_/g, " ")}</b></div>
            <p className="fine" style={{ marginTop: 6 }}>Usually under a minute. Keep this page open; if it takes longer, the NEAR goes back to your wallet.</p>
          </div>
        ) : (
          <>
            <div className="amount">
              <div className="lbl"><span>You pay</span><button type="button" onClick={() => bal != null && setAmt((Number(bal > toUnits("0.1", 24) ? bal - toUnits("0.1", 24) : 0n) / 1e24).toFixed(2))}>{bal != null ? `${unitsFmt(units(bal, 24))} NEAR` : "Max"}</button></div>
              <div className="in-row"><input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="u">NEAR</span></div>
            </div>
            <div className="chips">{[5, 10, 25, 50].map((x) => <button key={x} onClick={() => setAmt(String(x))}>{x}</button>)}</div>
            <dl className="quote">
              <dt>You receive</dt><dd><b>{dry ? `${unitsFmt(Number(dry.amountOutFormatted))} ${sym}` : isFetching ? "…" : "—"}</b></dd>
              {dry && <><dt>Value</dt><dd><b>${Number(dry.amountOutUsd).toFixed(2)}</b><span className="faint"> for ${Number(dry.amountInUsd).toFixed(2)} of NEAR</span></dd></>}
              {stockBal != null && stockBal > 0n && <><dt>In your wallet</dt><dd><b>{unitsFmt(units(stockBal.toString(), dec))} {sym}</b></dd></>}
            </dl>
            {noLiq && (
              <div className="warn" style={{ marginBottom: 10 }}>
                No solver is quoting {sym} on NEAR Intents right now. It tends to come back with market hours. Meanwhile: the token also trades on BNB Chain{pancake ? <>, <a className="vi" href={pancake} target="_blank" rel="noreferrer">on PancakeSwap</a></> : null}, and the <a className="vi" href={INTENTS_APP} target="_blank" rel="noreferrer">NEAR Intents app</a> can bring it to NEAR.
              </div>
            )}
            {dryErr && !noLiq && <div className="warn" style={{ marginBottom: 10 }}>{String((dryErr as Error).message)}</div>}
            <button className="b pri lg wide" disabled={!!accountId && (raw === 0n || !dry || busy)} onClick={start}>{!accountId ? "Connect wallet" : busy ? "Waiting…" : `Swap for ${sym}`}</button>
            <p className="fine" style={{ marginTop: 10 }}>Two approvals: the NEAR goes to NEAR Intents and comes back as {sym} in your Intents account, then you withdraw it to your wallet. Slippage 1%. {nearUsd > 0 ? `NEAR $${nearUsd.toFixed(2)}.` : ""}</p>
          </>
        )}
      </div>
    </div>
  );
}
