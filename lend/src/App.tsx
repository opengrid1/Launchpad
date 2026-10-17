import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, isAddress, parseUnits, type Address, type Hash, type WalletClient } from "viem";
import { useAccount } from "wagmi";

import { ERC20_ABI, MARKET_ABI } from "./abi";
import { EXPLORER, MARKET, STOCKS, USDG, USDG_DECIMALS } from "./config";
import { BPS, WAD, USDG_TO_WAD, borrowAprBps, errorName, publicClient, supplyApyBps, useProtocol, type AccountData, type MarketData } from "./data";
import { ensureWallet, openWalletModal } from "./wallet";

// ---------- formatting ----------
const n = (v: bigint, dec = 18) => Number(formatUnits(v, dec));
const fmt = (x: number, d = 2) => (isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const usd = (x: number) => "$" + fmt(x, x >= 1000 ? 0 : 2);
const pct = (bps: number) => (bps / 100).toFixed(2) + "%";
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const price = (m: MarketData) => (m.twap === null ? 0 : n(m.twap));

const ERRORS: Record<string, string> = {
  InsufficientCash: "Not enough free stock in the market right now (it is lent out). Try a smaller amount or wait for repayments.",
  InsufficientCollateral: "Not enough USDG collateral for that. Deposit more or borrow less.",
  CapExceeded: "This market's cap is reached. Try a smaller amount.",
  NotLiquidatable: "That account is healthy. Nothing to liquidate.",
  TooMuchRepay: "You can repay at most 50% of a debt per liquidation.",
  BorrowsPaused: "Borrowing is paused on this market.",
  SpotDeviation: "The pool price is more than 5% away from its 30-minute average. Borrows and liquidations wait until it settles.",
  OLD: "The pool's price history is too short right now. Try again in a few minutes.",
  ZeroAmount: "Enter an amount.",
  NotListed: "Market not listed.",
};
function friendly(err: unknown): string {
  const name = errorName(err);
  if (name && ERRORS[name]) return ERRORS[name];
  const raw = String((err as any)?.shortMessage ?? (err as any)?.message ?? err);
  if (/user rejected|denied/i.test(raw)) return "Rejected in wallet.";
  if (/insufficient funds/i.test(raw)) return "Not enough ETH for gas.";
  return raw.split("\n")[0].slice(0, 160);
}

// ---------- tx runner ----------
type Status = { kind: "busy" | "ok" | "err"; text: string; hash?: Hash } | null;

function useTx() {
  const [status, setStatus] = useState<Status>(null);
  const qc = useQueryClient();
  useEffect(() => {
    if (status && status.kind !== "busy") {
      const t = setTimeout(() => setStatus(null), 6000);
      return () => clearTimeout(t);
    }
  }, [status]);
  const run = async (label: string, fn: (wc: WalletClient, account: Address) => Promise<Hash | void>) => {
    try {
      setStatus({ kind: "busy", text: "Confirm in wallet…" });
      const wc = await ensureWallet();
      const account = wc.account!.address;
      const hash = await fn(wc, account);
      if (hash) {
        setStatus({ kind: "busy", text: `${label}: waiting for confirmation…`, hash });
        const rc = await publicClient.waitForTransactionReceipt({ hash });
        if (rc.status !== "success") throw new Error("Transaction reverted");
      }
      await qc.invalidateQueries({ queryKey: ["protocol"] });
      setStatus({ kind: "ok", text: `${label}: done`, hash: hash ?? undefined });
      return true;
    } catch (e) {
      setStatus({ kind: "err", text: friendly(e) });
      return false;
    }
  };
  return { status, run, setStatus };
}

/** Approve `spender` for `amount` of `token` if the current allowance is short. */
async function ensureAllowance(wc: WalletClient, owner: Address, token: Address, amount: bigint, current: bigint, setStatus: (s: Status) => void) {
  if (current >= amount) return;
  setStatus({ kind: "busy", text: "Approve spending in wallet…" });
  const hash = await wc.writeContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [MARKET, amount], chain: wc.chain, account: owner });
  setStatus({ kind: "busy", text: "Approval: waiting for confirmation…", hash });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Approval reverted");
}

const write = (wc: WalletClient, account: Address, functionName: any, args: any[]) =>
  wc.writeContract({ address: MARKET, abi: MARKET_ABI, functionName, args, chain: wc.chain, account } as any);

// ---------- app ----------
type Tab = "markets" | "lend" | "borrow" | "portfolio" | "liquidate" | "how";

export default function App() {
  const { address, isConnected } = useAccount();
  const { data, error, isLoading } = useProtocol(address);
  const [tab, setTab] = useState<Tab>("markets");
  const [pick, setPick] = useState<string>(STOCKS[0].sym);
  const tx = useTx();

  const markets = data?.markets ?? [];
  const account = data?.account ?? null;
  const go = (t: Tab, sym?: string) => { if (sym) setPick(sym); setTab(t); window.scrollTo({ top: 0 }); };

  const tape = useMemo(() => {
    let tvl = 0, bor = 0, interest = 0;
    for (const m of markets) { const p = price(m); tvl += n(m.cash + m.totalBorrows) * p; bor += n(m.totalBorrows) * p; interest += (n(m.totalBorrows) * p * m.borrowBps) / 10_000; }
    return [
      ["Total supplied", usd(tvl), ""], ["Total borrowed", usd(bor), "a"], ["Interest / yr", usd(interest), ""],
      ["To lenders / yr", usd(interest * 0.85), "g"], ["Markets", String(markets.length), ""],
    ];
  }, [markets]);

  const NAV: [Tab, string, string][] = [["markets", "01", "Markets"], ["lend", "02", "Lend"], ["borrow", "03", "Borrow"], ["portfolio", "04", "Portfolio"], ["liquidate", "05", "Liquidate"], ["how", "??", "How it works"]];

  return (
    <>
      <header className="top">
        <div className="brand"><span className="mark">B</span>Borrowhood <small>Robinhood Chain</small></div>
        <button className={"wallet" + (isConnected ? "" : " off")} onClick={() => openWalletModal()}>
          <i />{isConnected && address ? <><span className="addr">{short(address)}</span><span>connected</span></> : <span>Connect wallet</span>}
        </button>
      </header>
      <div className="tape">{tape.map(([k, v, c]) => <div key={k}><div className="k">{k}</div><div className={"v " + c}>{v}</div></div>)}</div>
      {error ? <div className="proto err"><b>RPC error</b> {String((error as any).shortMessage ?? error.message)}</div>
        : <div className="proto live"><b>Live</b> Market <a className="link" href={`${EXPLORER}/address/${MARKET}`} target="_blank" rel="noreferrer">{short(MARKET)}</a> · prices from 30-min Uniswap V3 TWAP · {isLoading ? "loading…" : "refreshes every 15s"}</div>}

      <div className="wrap">
        <nav className="rail">{NAV.map(([t, ic, l]) => <button key={t} className={tab === t ? "on" : ""} onClick={() => go(t)}><span className="ic">{ic}</span>{l}</button>)}</nav>
        <main>
          {tab === "markets" && <Markets markets={markets} go={go} />}
          {tab === "lend" && <Lend markets={markets} pick={pick} setPick={setPick} account={account} tx={tx} connected={isConnected} />}
          {tab === "borrow" && <Borrow markets={markets} pick={pick} setPick={setPick} account={account} tx={tx} connected={isConnected} />}
          {tab === "portfolio" && <Portfolio markets={markets} account={account} connected={isConnected} go={go} />}
          {tab === "liquidate" && <Liquidate markets={markets} tx={tx} connected={isConnected} />}
          {tab === "how" && <How markets={markets} />}
        </main>
      </div>

      <div className="tabs">{NAV.slice(0, 5).map(([t, ic, l]) => <button key={t} className={tab === t ? "on" : ""} onClick={() => go(t)}><span className="ic">{ic}</span>{t === "portfolio" ? "Me" : t === "liquidate" ? "Liq" : l}</button>)}</div>

      {tx.status && (
        <div className={"status " + (tx.status.kind === "err" ? "err" : tx.status.kind === "ok" ? "ok" : "")}>
          {tx.status.kind === "busy" && <span className="spin" />}
          <span>{tx.status.text}</span>
          {tx.status.hash && <a href={`${EXPLORER}/tx/${tx.status.hash}`} target="_blank" rel="noreferrer">tx ↗</a>}
        </div>
      )}
    </>
  );
}

// ---------- Markets ----------
function Markets({ markets, go }: { markets: MarketData[]; go: (t: Tab, sym?: string) => void }) {
  return (
    <section>
      <div className="eyebrow">01 · Markets</div>
      <h1>Lend the stock. Earn the stock.</h1>
      <p className="lead">Supply a tokenized stock and earn the borrow fee, paid in that stock. Borrow a stock against USDG. Interest accrues every second, on-chain.</p>
      <div className="tablewrap"><table>
        <thead><tr><th>Stock</th><th>Price (TWAP)</th><th>Supply APY</th><th>Borrow APR</th><th>Utilization</th><th>Supplied</th><th>Borrowed</th><th>LTV / Liq</th><th></th></tr></thead>
        <tbody>{markets.map((m) => {
          const cls = m.util > 0.8 ? "r" : m.util > 0.6 ? "a" : "";
          return (
            <tr key={m.sym}>
              <td className="tk">{m.sym}<small>{m.name}</small></td>
              <td>{m.twap === null ? <span className="r">oracle paused</span> : usd(price(m))}</td>
              <td className="g">{pct(m.supplyBps)}</td>
              <td className="a">{pct(m.borrowBps)}{m.borrowsPaused && <span className="tag">paused</span>}</td>
              <td><span className="util"><span className="bar"><i style={{ width: `${(m.util * 100).toFixed(0)}%` }} /></span><span className={cls}>{(m.util * 100).toFixed(0)}%</span></span></td>
              <td>{fmt(n(m.cash + m.totalBorrows), 2)} <span className="muted">sh</span></td>
              <td>{fmt(n(m.totalBorrows), 2)} <span className="muted">sh</span></td>
              <td><span className="pill">{m.risk.ltv / 100}% / {m.risk.liq / 100}%</span></td>
              <td style={{ whiteSpace: "nowrap" }}><button className="rowbtn g" onClick={() => go("lend", m.sym)}>Lend</button> <button className="rowbtn" onClick={() => go("borrow", m.sym)}>Borrow</button></td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {markets[0] && <div className="note"><b>Why rates move.</b> Borrow APR follows a kinked curve: <span className="formula">{markets[0].rate.base / 100}% + {markets[0].rate.slope1 / 100}% × (util ÷ {markets[0].rate.kink / 100}%)</span> up to the kink, then steepens by {markets[0].rate.slope2 / 100}% to 100%. Supply APY = borrow APR × utilization × {(10_000 - markets[0].risk.reserve) / 100}% ({markets[0].risk.reserve / 100}% is protocol revenue, held as reserves).</div>}
    </section>
  );
}

// ---------- shared pieces ----------
function StockSelect({ markets, pick, setPick }: { markets: MarketData[]; pick: string; setPick: (s: string) => void }) {
  return <select value={pick} onChange={(e) => setPick(e.target.value)}>{markets.map((m) => <option key={m.sym} value={m.sym}>{m.sym} · {m.name}</option>)}</select>;
}
function Amount({ value, set, unit, max, maxLabel }: { value: string; set: (v: string) => void; unit: string; max?: () => void; maxLabel?: string }) {
  return (
    <div className="inrow">
      <input type="number" inputMode="decimal" min="0" step="any" value={value} onChange={(e) => set(e.target.value)} placeholder="0" />
      {max && <button className="max" onClick={max}>{maxLabel ?? "Max"}</button>}
      <span className="unit">{unit}</span>
    </div>
  );
}
function ConnectHint({ connected }: { connected: boolean }) {
  return connected ? null : <div className="hint">Connect a wallet on Robinhood Chain to transact. Previews work without one.</div>;
}
function parse(v: string, dec: number): bigint { try { return v && Number(v) > 0 ? parseUnits(v as `${number}`, dec) : 0n; } catch { return 0n; } }

// ---------- Lend ----------
function Lend({ markets, pick, setPick, account, tx, connected }: { markets: MarketData[]; pick: string; setPick: (s: string) => void; account: AccountData | null; tx: ReturnType<typeof useTx>; connected: boolean }) {
  const m = markets.find((x) => x.sym === pick) ?? markets[0];
  const [mode, setMode] = useState<"supply" | "withdraw">("supply");
  const [amt, setAmt] = useState("1");
  if (!m) return <section><div className="empty">Loading markets…</div></section>;
  const p = price(m);
  const a = parse(amt, 18);
  const total = m.cash + m.totalBorrows;
  const after = mode === "supply" ? total + a : total - a;
  const utilAfter = after === 0n ? 0 : Number((m.totalBorrows * 10_000n) / after) / 10_000;
  const apy = supplyApyBps(m, Math.min(utilAfter, 1));
  const capLeft = m.supplyCap === 0n ? null : m.supplyCap - total;
  const maxSupply = capLeft === null ? m.balance : (m.balance < capLeft ? m.balance : capLeft);
  const maxWithdraw = m.supplied < m.cash ? m.supplied : m.cash;
  const over = mode === "supply" ? a > maxSupply : a > maxWithdraw;

  const submit = () => {
    if (mode === "supply") {
      tx.run(`Supply ${amt} ${m.sym}`, async (wc, acct) => {
        await ensureAllowance(wc, acct, m.address, a, m.allowance, tx.setStatus);
        return write(wc, acct, "supply", [m.address, a]);
      });
    } else {
      // burn shares for the requested amount; "max" burns every share so no dust is left
      const all = a >= m.supplied;
      const sharesToBurn = all ? m.shares : (a * WAD + m.exchangeRate - 1n) / m.exchangeRate;
      tx.run(`Withdraw ${amt} ${m.sym}`, (wc, acct) => write(wc, acct, "withdraw", [m.address, sharesToBurn]));
    }
  };

  return (
    <section>
      <div className="eyebrow">02 · Lend</div>
      <h1>Put your shares to work.</h1>
      <p className="lead">Supply and receive lending shares. Interest accrues into the share price every second. Withdraw any time there is free stock in the market.</p>
      <ConnectHint connected={connected} />
      <div className="desk">
        <div className="panel">
          <div className="seg"><button className={mode === "supply" ? "on" : ""} onClick={() => setMode("supply")}>Supply</button><button className={mode === "withdraw" ? "on" : ""} onClick={() => setMode("withdraw")}>Withdraw</button></div>
          <div className="field"><label>Stock</label><div className="inrow"><StockSelect markets={markets} pick={m.sym} setPick={setPick} /></div></div>
          <div className="field"><label>{mode === "supply" ? "Amount to supply" : "Amount to withdraw"}</label>
            <Amount value={amt} set={setAmt} unit={m.sym} max={() => setAmt(formatUnits(mode === "supply" ? maxSupply : maxWithdraw, 18))} /></div>
          <div className="hint">{mode === "supply" ? <>Wallet <b>{fmt(n(m.balance), 4)} {m.sym}</b>{capLeft !== null && <> · cap room <b>{fmt(n(capLeft), 2)}</b></>}</> : <>Supplied <b>{fmt(n(m.supplied), 4)} {m.sym}</b> · free in market <b>{fmt(n(m.cash), 2)}</b></>}</div>
          {over && <div className="warn on">{mode === "supply" ? "More than your balance or the market cap." : "More than you supplied, or more than is currently free (lent out)."}</div>}
          <button className="btn lend" disabled={!connected || a === 0n || over || tx.status?.kind === "busy"} onClick={submit}>{mode === "supply" ? "Supply" : "Withdraw"} {m.sym}</button>
        </div>
        <div className="panel out">
          <div className="eyebrow">Outcome</div>
          <dl className="kv">
            <div className="big" style={{ display: "contents" }}><dt>Supply APY after</dt><dd className="g">{pct(apy)}</dd></div>
            <dt>Value</dt><dd>{usd(n(a) * p)}</dd>
            <dt>Projected / yr</dt><dd className="g">+{fmt((n(a) * apy) / 10_000, 4)} {m.sym} · {usd((n(a) * p * apy) / 10_000)}</dd>
            <dt>Paid in</dt><dd>{m.sym} (in-kind)</dd>
            <dt>Utilization after</dt><dd>{(utilAfter * 100).toFixed(1)}%</dd>
            <dt>Your position</dt><dd>{fmt(n(m.supplied), 4)} {m.sym}</dd>
            <dt>Share price</dt><dd>{fmt(n(m.exchangeRate), 6)} {m.sym}/share</dd>
          </dl>
          <div className="divider" />
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Yield is interest paid by borrowers. If every share is lent out (100% utilization) withdrawals wait for repayments, and the borrow rate jumps to {(m.rate.base + m.rate.slope1 + m.rate.slope2) / 100}% to bring them in.</p>
        </div>
      </div>
    </section>
  );
}

// ---------- Borrow ----------
function Borrow({ markets, pick, setPick, account, tx, connected }: { markets: MarketData[]; pick: string; setPick: (s: string) => void; account: AccountData | null; tx: ReturnType<typeof useTx>; connected: boolean }) {
  const m = markets.find((x) => x.sym === pick) ?? markets[0];
  const [mode, setMode] = useState<"borrow" | "repay">("borrow");
  const [amt, setAmt] = useState("0.5");
  const [collMode, setCollMode] = useState<"deposit" | "withdraw">("deposit");
  const [collAmt, setCollAmt] = useState("100");
  if (!m) return <section><div className="empty">Loading markets…</div></section>;
  const acc = account;
  const p = price(m);
  const a = parse(amt, 18);
  const c = parse(collAmt, USDG_DECIMALS);

  // contract math: limitUsed += usd*BPS/ltv ; liqUsed += usd*BPS/liq ; HF = coll/liqUsed
  const collUsd = acc ? acc.collateralUsd : 0n;
  const usdAdd = m.twap === null ? 0n : (a * m.twap) / WAD;
  const limitUsed = (acc?.borrowLimitUsed ?? 0n) + (usdAdd * BPS) / BigInt(m.risk.ltv);
  const liqUsed = (acc?.liqLimitUsed ?? 0n) + (usdAdd * BPS) / BigInt(m.risk.liq);
  const hf = liqUsed === 0n ? Infinity : n(collUsd) / n(liqUsed);
  const room = collUsd > (acc?.borrowLimitUsed ?? 0n) ? collUsd - (acc?.borrowLimitUsed ?? 0n) : 0n;
  const maxByColl = m.twap === null || m.twap === 0n ? 0n : (((room * BigInt(m.risk.ltv)) / BPS) * WAD) / m.twap;
  const capRoom = m.borrowCap === 0n ? m.cash : (m.borrowCap - m.totalBorrows < m.cash ? m.borrowCap - m.totalBorrows : m.cash);
  const maxBorrow = maxByColl < capRoom ? maxByColl : capRoom;
  const overBorrow = limitUsed > collUsd || a > capRoom;
  const utilAfter = (() => { const t = m.cash + m.totalBorrows; return t === 0n ? 0 : Number(((m.totalBorrows + a) * 10_000n) / t) / 10_000; })();
  const aprAfter = borrowAprBps(m, Math.min(utilAfter, 1));
  const liqPrice = a > 0n && liqUsed > 0n ? p * hf : 0; // exact when this is your only debt

  const withdrawableColl = (() => {
    if (!acc) return 0n;
    const used = acc.borrowLimitUsed;
    const w = acc.collateralUsd > used ? (acc.collateralUsd - used) / USDG_TO_WAD : 0n;
    return w < acc.collateral ? w : acc.collateral;
  })();

  const submitColl = () => {
    if (collMode === "deposit") {
      tx.run(`Deposit ${collAmt} USDG`, async (wc, acct) => {
        await ensureAllowance(wc, acct, USDG, c, acc?.usdgAllowance ?? 0n, tx.setStatus);
        return write(wc, acct, "depositCollateral", [c]);
      });
    } else tx.run(`Withdraw ${collAmt} USDG`, (wc, acct) => write(wc, acct, "withdrawCollateral", [c]));
  };
  const submit = () => {
    if (mode === "borrow") tx.run(`Borrow ${amt} ${m.sym}`, (wc, acct) => write(wc, acct, "borrow", [m.address, a]));
    else {
      const all = a >= m.debt;
      const need = all ? m.debt + m.debt / 1000n + 1n : a; // small buffer: debt keeps accruing until the tx mines
      tx.run(`Repay ${all ? "all" : amt} ${m.sym}`, async (wc, acct) => {
        await ensureAllowance(wc, acct, m.address, need, m.allowance, tx.setStatus);
        return write(wc, acct, "repay", [m.address, all ? 2n ** 256n - 1n : a]);
      });
    }
  };

  const gauge = Math.max(2, Math.min(98, isFinite(hf) ? (hf / 2.5) * 100 : 98));
  const hfColor = !isFinite(hf) ? "var(--ink3)" : hf < 1 ? "var(--red)" : hf < 1.3 ? "var(--amber-ink)" : "var(--green-ink)";

  return (
    <section>
      <div className="eyebrow">03 · Borrow</div>
      <h1>Borrow shares against USDG.</h1>
      <p className="lead">Deposit USDG once, then borrow any listed stock. Short it, hedge with it, or hold it as inventory. Stay above health factor 1.00 or a liquidator can repay part of your debt and take collateral at an {m.risk.liqBonus / 100}% bonus.</p>
      <ConnectHint connected={connected} />
      {acc?.liquidityError && <div className="warn on">Oracle guard active ({acc.liquidityError}). Borrowing waits until the pool price settles.</div>}
      <div className="desk">
        <div className="panel">
          <div className="eyebrow">Collateral</div>
          <div className="seg"><button className={collMode === "deposit" ? "on" : ""} onClick={() => setCollMode("deposit")}>Deposit</button><button className={collMode === "withdraw" ? "on" : ""} onClick={() => setCollMode("withdraw")}>Withdraw</button></div>
          <div className="field"><label>USDG</label>
            <Amount value={collAmt} set={setCollAmt} unit="USDG" max={() => setCollAmt(formatUnits(collMode === "deposit" ? (acc?.usdgBalance ?? 0n) : withdrawableColl, USDG_DECIMALS))} /></div>
          <div className="hint">Deposited <b>{fmt(n(acc?.collateral ?? 0n, 6), 2)}</b> · wallet <b>{fmt(n(acc?.usdgBalance ?? 0n, 6), 2)}</b> · withdrawable <b>{fmt(n(withdrawableColl, 6), 2)}</b></div>
          <button className="btn ghost" disabled={!connected || c === 0n || tx.status?.kind === "busy" || (collMode === "withdraw" && c > withdrawableColl)} onClick={submitColl}>{collMode === "deposit" ? "Deposit" : "Withdraw"} USDG</button>
          <div className="divider" />
          <div className="eyebrow">Loan</div>
          <div className="seg"><button className={mode === "borrow" ? "on" : ""} onClick={() => setMode("borrow")}>Borrow</button><button className={mode === "repay" ? "on" : ""} onClick={() => setMode("repay")}>Repay</button></div>
          <div className="field"><label>Stock</label><div className="inrow"><StockSelect markets={markets} pick={m.sym} setPick={setPick} /></div></div>
          <div className="field"><label>{mode === "borrow" ? "Amount to borrow" : "Amount to repay"}</label>
            <Amount value={amt} set={setAmt} unit={m.sym} max={() => setAmt(formatUnits(mode === "borrow" ? maxBorrow : m.debt, 18))} maxLabel={mode === "repay" ? "All" : "Max"} /></div>
          <div className="hint">{mode === "borrow" ? <>Max now <b>{fmt(n(maxBorrow), 4)} {m.sym}</b> · free in market <b>{fmt(n(m.cash), 2)}</b></> : <>Your debt <b>{fmt(n(m.debt), 6)} {m.sym}</b> · wallet <b>{fmt(n(m.balance), 4)}</b></>}</div>
          {mode === "borrow" && overBorrow && a > 0n && <div className="warn on">Over your borrow limit or the market's free cash.</div>}
          <button className={"btn " + (mode === "borrow" ? "borrow" : "lend")} disabled={!connected || a === 0n || tx.status?.kind === "busy" || (mode === "borrow" && (overBorrow || m.borrowsPaused || m.twap === null)) || (mode === "repay" && m.debt === 0n)} onClick={submit}>{mode === "borrow" ? "Borrow" : "Repay"} {m.sym}</button>
        </div>
        <div className="panel out">
          <div className="eyebrow">Health after {mode === "borrow" ? "borrowing" : "(current)"}</div>
          <div className="hf"><div className="n" style={{ color: hfColor }}>{isFinite(hf) ? fmt(hf, 2) : "∞"}</div><div className="gauge"><i style={{ left: `${gauge}%` }} /></div></div>
          <div className="hf-label" style={{ color: hfColor }}>{!isFinite(hf) ? "no debt" : hf < 1 ? "LIQUIDATABLE" : hf < 1.3 ? "at risk — near the line" : "healthy"}</div>
          <div className="divider" />
          <dl className="kv">
            <dt>Collateral</dt><dd>{usd(n(collUsd))}</dd>
            <dt>Debt {mode === "borrow" ? "after" : "now"}</dt><dd>{usd(n((acc?.debtUsd ?? 0n) + (mode === "borrow" ? usdAdd : 0n)))}</dd>
            <dt>Borrow limit used</dt><dd>{collUsd > 0n ? ((n(limitUsed) / n(collUsd)) * 100).toFixed(1) + "%" : "—"}</dd>
            <dt>Liquidation price</dt><dd>{liqPrice > 0 ? usd(liqPrice) + " / " + m.sym : "—"}</dd>
            <dt>Borrow APR after</dt><dd className="a">{pct(aprAfter)}</dd>
            <dt>Interest / yr</dt><dd>{fmt((n(a) * aprAfter) / 10_000, 4)} {m.sym} · {usd((n(a) * p * aprAfter) / 10_000)}</dd>
            <dt>LTV / liq. threshold</dt><dd>{m.risk.ltv / 100}% / {m.risk.liq / 100}%</dd>
          </dl>
          <div className="divider" />
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Liquidation price assumes {m.sym} is your only debt. A dividend on {m.sym} raises the value of your raw debt (dividend in lieu), the same as shorting on a broker.</p>
        </div>
      </div>
    </section>
  );
}

// ---------- Portfolio ----------
function Portfolio({ markets, account, connected, go }: { markets: MarketData[]; account: AccountData | null; connected: boolean; go: (t: Tab, sym?: string) => void }) {
  if (!connected || !account) return <section><div className="eyebrow">04 · Portfolio</div><h1>Your positions.</h1><div className="empty">Connect a wallet to see your positions.</div></section>;
  const sup = markets.filter((m) => m.shares > 0n);
  const bor = markets.filter((m) => m.debt > 0n);
  const hf = account.healthFactor === null ? Infinity : n(account.healthFactor);
  return (
    <section>
      <div className="eyebrow">04 · Portfolio</div>
      <h1>Your positions.</h1>
      <div className="tiles">
        <div className="tile"><div className="k">USDG collateral</div><div className="v">{usd(n(account.collateral, 6))}</div></div>
        <div className="tile"><div className="k">Total debt</div><div className="v a">{usd(n(account.debtUsd))}</div></div>
        <div className="tile"><div className="k">Health factor</div><div className={"v " + (hf < 1 ? "r" : hf < 1.3 ? "a" : "g")}>{isFinite(hf) ? fmt(hf, 2) : "∞"}</div></div>
        <div className="tile"><div className="k">Borrow limit used</div><div className="v">{account.collateralUsd > 0n ? ((n(account.borrowLimitUsed) / n(account.collateralUsd)) * 100).toFixed(1) + "%" : "—"}</div></div>
      </div>
      <h2>Supplied</h2>
      <div className="tablewrap" style={{ marginBottom: 18 }}><table><thead><tr><th>Stock</th><th>Shares</th><th>Value</th><th>APY</th><th></th></tr></thead><tbody>
        {sup.length ? sup.map((m) => <tr key={m.sym}><td className="tk">{m.sym}</td><td>{fmt(n(m.supplied), 6)}</td><td>{usd(n(m.supplied) * price(m))}</td><td className="g">{pct(m.supplyBps)}</td><td><button className="rowbtn" onClick={() => go("lend", m.sym)}>Manage</button></td></tr>)
          : <tr><td colSpan={5} className="empty">Nothing supplied yet.</td></tr>}
      </tbody></table></div>
      <h2>Borrowed</h2>
      <div className="tablewrap"><table><thead><tr><th>Stock</th><th>Debt (shares)</th><th>Debt</th><th>APR</th><th></th></tr></thead><tbody>
        {bor.length ? bor.map((m) => <tr key={m.sym}><td className="tk">{m.sym}</td><td>{fmt(n(m.debt), 6)}</td><td>{usd(n(m.debt) * price(m))}</td><td className="a">{pct(m.borrowBps)}</td><td><button className="rowbtn" onClick={() => go("borrow", m.sym)}>Manage</button></td></tr>)
          : <tr><td colSpan={5} className="empty">No open borrows.</td></tr>}
      </tbody></table></div>
    </section>
  );
}

// ---------- Liquidate ----------
function Liquidate({ markets, tx, connected }: { markets: MarketData[]; tx: ReturnType<typeof useTx>; connected: boolean }) {
  const [addr, setAddr] = useState("");
  const [info, setInfo] = useState<{ coll: bigint; debtUsd: bigint; liqUsed: bigint; hf: bigint; debts: { m: MarketData; debt: bigint }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState(STOCKS[0].sym);
  const [amt, setAmt] = useState("");
  const m = markets.find((x) => x.sym === pick) ?? markets[0];

  const check = async () => {
    setErr(null); setInfo(null);
    if (!isAddress(addr)) { setErr("Enter a valid address."); return; }
    try {
      const [liq, hf, ...debts] = await Promise.all([
        publicClient.readContract({ address: MARKET, abi: MARKET_ABI, functionName: "accountLiquidity", args: [addr] }),
        publicClient.readContract({ address: MARKET, abi: MARKET_ABI, functionName: "healthFactor", args: [addr] }),
        ...markets.map((x) => publicClient.readContract({ address: MARKET, abi: MARKET_ABI, functionName: "borrowBalance", args: [x.address, addr] })),
      ]);
      const [coll, debtUsd, , liqUsed] = liq as [bigint, bigint, bigint, bigint];
      setInfo({ coll, debtUsd, liqUsed, hf: hf as bigint, debts: markets.map((x, i) => ({ m: x, debt: debts[i] as bigint })).filter((d) => d.debt > 0n) });
    } catch (e) { setErr(friendly(e)); }
  };

  const target = info?.debts.find((d) => d.m.sym === pick);
  const maxRepay = target ? (target.debt * 5000n) / BPS : 0n;
  const a = parse(amt, 18);
  const liquidatable = info ? info.liqUsed > info.coll : false;
  const seize = m && m.twap !== null && a > 0n ? ((((a * m.twap) / WAD) * (BPS + BigInt(m.risk.liqBonus))) / BPS) / USDG_TO_WAD : 0n;

  return (
    <section>
      <div className="eyebrow">05 · Liquidate</div>
      <h1>Keep the market solvent.</h1>
      <p className="lead">When an account's health factor drops below 1.00, anyone can repay up to 50% of one of its stock debts and receive USDG collateral worth the repayment plus the market's bonus.</p>
      <ConnectHint connected={connected} />
      <div className="desk">
        <div className="panel">
          <div className="field"><label>Borrower address</label><div className="inrow"><input value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="0x…" spellCheck={false} /><button className="max" onClick={check}>Check</button></div></div>
          {err && <div className="warn on">{err}</div>}
          {info && (
            <dl className="kv" style={{ marginBottom: 14 }}>
              <dt>Health factor</dt><dd className={liquidatable ? "r" : "g"}>{info.liqUsed === 0n ? "∞" : fmt(n(info.hf), 3)}</dd>
              <dt>Collateral</dt><dd>{usd(n(info.coll))}</dd>
              <dt>Debt</dt><dd>{usd(n(info.debtUsd))}</dd>
              {info.debts.map((d) => <div key={d.m.sym} style={{ display: "contents" }}><dt>· {d.m.sym}</dt><dd>{fmt(n(d.debt), 6)} sh</dd></div>)}
            </dl>
          )}
          {info && liquidatable && (
            <>
              <div className="field"><label>Repay</label><div className="inrow"><select value={pick} onChange={(e) => setPick(e.target.value)}>{info.debts.map((d) => <option key={d.m.sym} value={d.m.sym}>{d.m.sym}</option>)}</select></div></div>
              <div className="field"><label>Amount (max 50% of that debt)</label><Amount value={amt} set={setAmt} unit={pick} max={() => setAmt(formatUnits(maxRepay, 18))} /></div>
              <div className="hint">Max <b>{fmt(n(maxRepay), 6)} {pick}</b> · your wallet <b>{fmt(n(target?.m.balance ?? 0n), 4)}</b></div>
              <button className="btn borrow" disabled={!connected || a === 0n || a > maxRepay || tx.status?.kind === "busy"} onClick={() => {
                if (!target) return;
                tx.run(`Liquidate ${short(addr)}`, async (wc, acct) => {
                  await ensureAllowance(wc, acct, target.m.address, a, target.m.allowance, tx.setStatus);
                  return write(wc, acct, "liquidate", [target.m.address, addr as Address, a]);
                });
              }}>Liquidate</button>
            </>
          )}
          {info && !liquidatable && <div className="hint">Healthy. Nothing to do.</div>}
        </div>
        <div className="panel out">
          <div className="eyebrow">You receive</div>
          <dl className="kv">
            <div className="big" style={{ display: "contents" }}><dt>USDG seized</dt><dd className="g">{fmt(n(seize, 6), 2)}</dd></div>
            <dt>You repay</dt><dd>{a > 0n ? `${fmt(n(a), 6)} ${pick} · ${usd(n(a) * (m ? price(m) : 0))}` : "—"}</dd>
            <dt>Bonus</dt><dd>{m ? m.risk.liqBonus / 100 : 0}%</dd>
            <dt>Close factor</dt><dd>50% per call</dd>
          </dl>
          <div className="divider" />
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Seizure is capped at the borrower's collateral. The stock you repay is valued at the 30-minute TWAP.</p>
        </div>
      </div>
    </section>
  );
}

// ---------- How ----------
function How({ markets }: { markets: MarketData[] }) {
  const m = markets[0];
  return (
    <section>
      <div className="eyebrow">How it works</div>
      <h1>Three roles, one market. No token.</h1>
      <p className="lead">Securities lending is how stock holders earn in traditional markets, a business that never left institutional desks. This puts it on-chain for Robinhood Chain tokenized stocks.</p>
      <div className="flow">
        <div className="step"><div className="who">Lender</div><h3>Supply shares</h3><p>Deposit a stock, receive lending shares. Interest accrues into the share price every block. Withdraw when free stock is available.</p></div>
        <div className="step"><div className="who">Borrower</div><h3>Post USDG, take shares</h3><p>Over-collateralized at {m ? m.risk.ltv / 100 : 50}% LTV. Pay the utilization-based APR. Sell the shares to short, or hold them as inventory.</p></div>
        <div className="step"><div className="who">Liquidator</div><h3>Keep it solvent</h3><p>When health &lt; 1.00, repay up to 50% of a debt and seize collateral at a {m ? m.risk.liqBonus / 100 : 8}% bonus.</p></div>
      </div>
      <div className="note"><b>Prices.</b> Each stock is priced by the 30-minute time-weighted average of its Uniswap V3 stock/USDG pool, read on-chain. No keeper, no signer. If the pool's spot price moves more than 5% from that average, borrows and liquidations pause until it settles.</div>
      <div className="note"><b>Corporate actions, handled by design.</b> Robinhood stock tokens (ERC-8056) express splits and dividends through a <span className="mono">uiMultiplier</span>; raw balances never change. Every position here is kept in raw units, so a split scales lender claims and borrower debts together. A dividend raises the value of a borrower's raw debt: the short owes the dividend to the lender, <b>dividend in lieu</b>, exactly as on Wall Street.</div>
      <div className="note"><b>Where fees go.</b> Lenders keep {m ? (10_000 - m.risk.reserve) / 100 : 85}% of all borrow interest, paid in the stock. The remaining {m ? m.risk.reserve / 100 : 15}% is protocol revenue, held as reserves in each market. There is no project token, no staking, no buyback.</div>
      <div className="note"><b>Contracts.</b> Market <a className="link" href={`${EXPLORER}/address/${MARKET}`} target="_blank" rel="noreferrer">{MARKET}</a></div>
    </section>
  );
}
