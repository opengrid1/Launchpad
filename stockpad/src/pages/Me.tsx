import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { client, publicClient } from "../lib/client";
import { FEES } from "../lib/env";
import { hype, num, short, usd, wei } from "../lib/format";
import { runTx, useTokens } from "../lib/hooks";
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

  if (!isConnected || !me) return <main className="page"><section className="hero"><h1>Your <em>coins</em>.</h1><p className="sub">Connect a wallet to see what you hold, what it has earned you, and the coins you launched.</p><div className="cta"><button className="btn acc" onClick={() => openWalletModal()}>Connect wallet</button></div></section></main>;

  const value = data?.held.reduce((s, h) => s + wei(h.bal) * Number(h.t.priceUsd), 0) ?? 0;
  const earned = data ? [...data.rewards.entries()].reduce((s, [addr, r]) => { const t = tokens?.find((x) => x.address.toLowerCase() === addr); return s + (r && t ? (wei(r.pending) + (r.isCreator ? wei(r.creatorFees) : 0)) * t.pair.usd : 0); }, 0) : 0;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["rewards"] }); };
  const claim = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); const ok = await runTx(label, fn); if (ok) refresh(); };

  return (
    <main className="page">
      <section className="lead">
        <div className="say"><h1>Your <em>coins</em>.</h1><p>{short(me)}. Holdings, what they have earned you, and the coins you launched.</p></div>
        <div className="stats">
          <div className="acc"><b>{usd(value, { compact: true })}</b><span>holdings</span></div>
          <div><b>{usd(earned, { compact: true })}</b><span>claimable now</span></div>
          <div><b>{data?.created.length ?? 0}</b><span>launched</span></div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Holdings</h2></div>
        {!data ? <div className="skeleton" style={{ height: 120 }} /> : data.held.length === 0 ? <div className="panel"><div className="empty">Nothing held yet. <Link to="/" className="acc">Browse coins</Link></div></div> : (
          <>
            <div className="tbl"><table>
              <thead><tr><th>Coin</th><th>Pair</th><th className="num">Balance</th><th className="num">Value</th><th className="num">Rewards</th><th></th></tr></thead>
              <tbody>{data.held.map(({ t, bal }) => { const r = data.rewards.get(t.address.toLowerCase()); const p = r?.pending ?? 0n; const eth = t.pair.ethRoute && !t.pair.isNative; return (
                <tr key={t.address}>
                  <td><Link to={`/t/${t.address}`} className="coin"><Art src={t.metadata?.logo} name={t.name} className="art" /><b>{t.name}</b><small>{t.symbol}</small></Link></td>
                  <td><span className={"tag " + (t.pair.isNative ? "" : "stock")}>{t.pair.symbol}</span></td>
                  <td className="num">{num(wei(bal))}</td>
                  <td className="num">{usd(wei(bal) * Number(t.priceUsd))}</td>
                  <td className={"num " + (p > 0n ? "up" : "faint")}>{hype(wei(p), 5)} {t.pair.symbol}</td>
                  <td className="num">{p > 0n ? <button className="btn acc sm" onClick={claim("Claim rewards", () => client.claimRewards(t.address, eth))}>Claim{eth ? " as ETH" : ""}</button> : <Link className="btn sm" to={`/t/${t.address}`}>Trade</Link>}</td>
                </tr>); })}</tbody>
            </table></div>
            <div className="rows">
              {data.held.map(({ t, bal }) => { const r = data.rewards.get(t.address.toLowerCase()); const p = r?.pending ?? 0n; return (
                <Link key={t.address} to={`/t/${t.address}`}>
                  <Art src={t.metadata?.logo} name={t.name} className="art" />
                  <div><div className="l1">{t.name} <span className="faint">{t.symbol}</span></div><div className="l2">{num(wei(bal))} · pairs {t.pair.symbol}{p > 0n ? ` · ${hype(wei(p), 5)} ${t.pair.symbol} to claim` : ""}</div></div>
                  <div className="r">{usd(wei(bal) * Number(t.priceUsd))}</div>
                </Link>); })}
            </div>
          </>
        )}
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Launched by you</h2></div>
        {!data ? <div className="skeleton" style={{ height: 120 }} /> : data.created.length === 0 ? <div className="panel"><div className="empty">Nothing yet. <Link to="/launch" className="acc">Launch a coin</Link></div></div> : (
          <>
            <div className="tbl"><table>
              <thead><tr><th>Coin</th><th>Pair</th><th className="num">Market cap</th><th className="num">Vol 24h</th><th className="num">Creator fees</th><th className="num">Lifetime</th><th></th></tr></thead>
              <tbody>{data.created.map((t) => { const r = data.rewards.get(t.address.toLowerCase()); const fees = r?.creatorFees ?? 0n; const eth = t.pair.ethRoute && !t.pair.isNative; return (
                <tr key={t.address}>
                  <td><Link to={`/t/${t.address}`} className="coin"><Art src={t.metadata?.logo} name={t.name} className="art" /><b>{t.name}</b><small>{t.symbol}</small></Link></td>
                  <td><span className={"tag " + (t.pair.isNative ? "" : "stock")}>{t.pair.symbol}</span></td>
                  <td className="num">{usd(t.marketCapUsd, { compact: true })}</td>
                  <td className="num">{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })}</td>
                  <td className={"num " + (fees > 0n ? "up" : "faint")}>{hype(wei(fees), 5)} {t.pair.symbol}</td>
                  <td className="num dim">{hype(wei(r?.totalCreator ?? 0n), 4)}</td>
                  <td className="num"><button className="btn acc sm" disabled={fees === 0n} onClick={claim("Claim creator fees", () => client.claimCreatorFees(t.address, eth))}>Claim{eth ? " as ETH" : ""}</button></td>
                </tr>); })}</tbody>
            </table></div>
            <div className="rows">
              {data.created.map((t) => { const r = data.rewards.get(t.address.toLowerCase()); const fees = r?.creatorFees ?? 0n; const eth = t.pair.ethRoute && !t.pair.isNative; return (
                <a key={t.address} href="#" onClick={(e) => { e.preventDefault(); if (fees > 0n) claim("Claim creator fees", () => client.claimCreatorFees(t.address, eth))(); }}>
                  <Art src={t.metadata?.logo} name={t.name} className="art" />
                  <div><div className="l1">{t.name} <span className="faint">{t.symbol}</span></div><div className="l2">{usd(t.marketCapUsd, { compact: true })} cap · pairs {t.pair.symbol}</div></div>
                  <div className="r"><span className={fees > 0n ? "up" : "faint"}>{hype(wei(fees), 5)} {t.pair.symbol}</span><small>{fees > 0n ? "tap to claim" : "no fees yet"}</small></div>
                </a>); })}
            </div>
            <p className="note">Your {FEES.creatorPct}% of every trade fee is credited as the trade happens, in the coin's pair asset. Stock pairs with an ETH route claim straight as ETH.</p>
          </>
        )}
      </section>
    </main>
  );
}
