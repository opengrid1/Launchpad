import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { Art } from "../components/Art";
import { units } from "../lib/format";
import { useCurrency, useNearUsd, usePortfolio } from "../lib/hooks";
import { pairSymbol } from "../lib/types";
import { makeValuer, unitsFmt } from "../lib/value";
import { openWalletModal, send, useAccount } from "../lib/wallet";

export default function Portfolio() {
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const { data: rows, isLoading } = usePortfolio(accountId);
  const { data: nearUsd = 0 } = useNearUsd();
  const [ccy] = useCurrency();
  const val = useMemo(() => makeValuer(ccy, nearUsd), [ccy, nearUsd]);
  if (!accountId) return <main className="gate"><h1>Your portfolio</h1><p>Connect a wallet to see what you hold and what you are owed.</p><button className="b pri" onClick={() => openWalletModal()}>Connect wallet</button></main>;
  const owed = (rows ?? []).filter((r) => BigInt(r.h.claimable_dividends) + BigInt(r.h.credit) > 0n);
  return (
    <main>
      <div className="sec" style={{ marginTop: 4 }}><h2>Portfolio</h2><span className="eyebrow">{accountId}</span></div>
      {owed.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-h"><h2>Owed to you</h2><span className="eyebrow">{owed.length} coin{owed.length === 1 ? "" : "s"}</span></div>
          <div className="card-b" style={{ display: "grid", gap: 10 }}>
            {owed.map((r) => {
              const v = val(r.coin.info.pair);
              const total = (BigInt(r.h.claimable_dividends) + BigInt(r.h.credit)).toString();
              return (
                <div key={r.coin.account_id} className="row-flex" style={{ justifyContent: "space-between" }}>
                  <span><b>{r.coin.symbol}</b> <span className="fine">{v.fmt(r.h.claimable_dividends)} dividends · {v.fmt(r.h.credit)} credits</span></span>
                  <button className="b pri sm" onClick={() => send(`Claim ${r.coin.symbol}`, [{ receiverId: r.coin.account_id, methodName: "claim", gas: "50000000000000" }], () => qc.invalidateQueries())}>Claim {v.fmt(total)}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {isLoading && !rows ? <div className="skel" style={{ height: 240 }} /> : (
        <div className="rows">
          {(rows ?? []).length === 0 && <div className="empty">You do not hold any coin yet.</div>}
          {(rows ?? []).map((r) => {
            const v = val(r.coin.info.pair);
            const value = BigInt(r.coin.info.price) * BigInt(r.h.balance) / 10n ** 18n;
            const owedRaw = (BigInt(r.h.claimable_dividends) + BigInt(r.h.credit)).toString();
            return (
              <Link key={r.coin.account_id} to={`/t/${r.coin.account_id}`} className="hold">
                <Art src={r.coin.info.icon ?? undefined} name={r.coin.name} className="art" />
                <div className="nm"><b>{r.coin.symbol} <span className="chip" style={{ height: 20 }}>{pairSymbol(r.coin.info.pair)}</span>{r.coin.info.fee_wallet === accountId && <span className="chip official" style={{ height: 20, marginLeft: 4 }}>Creator</span>}</b><small>{unitsFmt(units(r.h.balance, 18))} {r.coin.symbol} · worth {v.fmt(value.toString(), true)}</small></div>
                <div className="r"><b className="vi">{v.fmt(owedRaw)}</b><small>owed</small></div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
