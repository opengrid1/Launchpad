import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { client, publicClient } from "../lib/client";
import { FEES } from "../lib/env";
import { hype, num, short, usd, wei } from "../lib/format";
import { runTx, useTokens, type Token } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const BAL_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

export default function Me() {
  const { address: me, isConnected } = useAccount();
  const { data: tokens } = useTokens();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["me", me, tokens?.length],
    enabled: !!me && !!tokens,
    refetchInterval: 30_000,
    queryFn: async () => {
      const list = tokens!;
      const bals = await publicClient.multicall({ contracts: list.map((t) => ({ address: t.address, abi: BAL_ABI, functionName: "balanceOf", args: [me!] })), allowFailure: true });
      const held = list.map((t, i) => ({ t, bal: bals[i].status === "success" ? (bals[i].result as bigint) : 0n })).filter((x) => x.bal > 0n);
      const created = list.filter((t) => t.creator.toLowerCase() === me!.toLowerCase());
      const rewards = await Promise.all([...new Set([...held.map((h) => h.t), ...created])].map(async (t) => ({ t, r: await client.rewards(t.address, me!).catch(() => null) })));
      return { held, created, rewards: new Map(rewards.map((x) => [x.t.address.toLowerCase(), x.r])) };
    },
  });

  if (!isConnected || !me) {
    return <main className="page"><section className="hero" style={{ gridTemplateColumns: "1fr" }}><div><div className="lbl" style={{ marginBottom: 12 }}>My coins</div><h1>Your <em>coins</em>.</h1><p className="sub">Connect a wallet to see what you hold, what it has earned you, and the coins you launched.</p><div className="cta"><button className="btn red" onClick={() => openWalletModal()}>Connect wallet</button></div></div></section></main>;
  }

  const value = data?.held.reduce((s, h) => s + wei(h.bal) * Number(h.t.priceUsd), 0) ?? 0;
  const earnedUsd = data ? [...data.rewards.entries()].reduce((s, [addr, r]) => { const t = tokens?.find((x) => x.address.toLowerCase() === addr); return s + (r && t ? wei(r.pending) * t.pair.usd : 0); }, 0) : 0;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["rewards"] }); };
  const claim = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); const ok = await runTx(label, fn); if (ok) refresh(); };

  return (
    <main className="page">
      <section className="sec">
        <div className="lbl" style={{ marginBottom: 12 }}>My coins · {short(me)}</div>
        <h1 style={{ fontSize: 56 }}>Your <em>coins</em>.</h1>
        <div className="stats3">
          <div className="stat"><b>{usd(value, { compact: true })}</b><span>Holdings value</span></div>
          <div className="stat"><b>{usd(earnedUsd, { compact: true })}</b><span>Rewards waiting</span></div>
          <div className="stat"><b>{data?.created.length ?? 0}</b><span>Coins you launched</span></div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Holdings</h2></div>
        {!data ? <div className="skeleton" style={{ minHeight: 100 }} /> : data.held.length === 0 ? <p className="small">You do not hold any coins from here yet. <Link to="/" style={{ color: "var(--green)" }}>Browse coins</Link></p> : (
          <div className="list">
            {data.held.map(({ t, bal }) => {
              const r = data.rewards.get(t.address.toLowerCase());
              const pending = r?.pending ?? 0n;
              return (
                <div key={t.address} className="li">
                  <Art src={t.metadata?.logo} name={t.name} className="art" size={44} />
                  <div><Link to={`/t/${t.address}`} style={{ color: "inherit", fontWeight: 600 }}>{t.name}</Link><div className="l2">{num(wei(bal))} {t.symbol} · pairs {t.pair.symbol}</div></div>
                  <div className="r">{usd(wei(bal) * Number(t.priceUsd))}<div className="l2">{pending > 0n ? `${hype(wei(pending), 5)} ${t.pair.symbol} to claim` : "no rewards yet"}</div></div>
                  {pending > 0n ? <button className="btn" onClick={claim("Claim rewards", () => client.claimRewards(t.address, t.pair.ethRoute && !t.pair.isNative))}>Claim{t.pair.ethRoute && !t.pair.isNative ? " as ETH" : ""}</button> : <Link to={`/t/${t.address}`} className="btn ghost">Trade</Link>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Coins you launched</h2></div>
        {!data ? <div className="skeleton" style={{ minHeight: 100 }} /> : data.created.length === 0 ? <p className="small">Nothing yet. <Link to="/launch" style={{ color: "var(--green)" }}>Launch a coin</Link></p> : (
          <>
            <div className="list">
              {data.created.map((t) => {
                const r = data.rewards.get(t.address.toLowerCase());
                const fees = r?.creatorFees ?? 0n;
                return (
                  <div key={t.address} className="li">
                    <Art src={t.metadata?.logo} name={t.name} className="art" size={44} />
                    <div><Link to={`/t/${t.address}`} style={{ color: "inherit", fontWeight: 600 }}>{t.name}</Link><div className="l2">{t.symbol} · pairs {t.pair.symbol} · {usd(t.marketCapUsd, { compact: true })} cap · {usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })} today</div></div>
                    <div className="r">{hype(wei(fees), 5)} {t.pair.symbol}<div className="l2">creator fees waiting · lifetime {hype(wei(r?.totalCreator ?? 0n), 4)}</div></div>
                    <button className="btn" disabled={fees === 0n} onClick={claim("Claim creator fees", () => client.claimCreatorFees(t.address, t.pair.ethRoute && !t.pair.isNative))}>Claim{t.pair.ethRoute && !t.pair.isNative ? " as ETH" : ""}</button>
                  </div>
                );
              })}
            </div>
            <p className="note">Your {FEES.creatorPct}% of every trade fee is credited the moment the trade happens, in the coin's pair asset. Claim any time; stock pairs with an ETH route can be claimed straight as ETH.</p>
          </>
        )}
      </section>
    </main>
  );
}

export type { Address, Token };
