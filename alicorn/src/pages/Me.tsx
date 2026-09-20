import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { client, publicClient } from "../lib/client";
import { FEES } from "../lib/env";
import { hype, num, short, usd, wei } from "../lib/format";
import { runTx, useTokens } from "../lib/hooks";
import { isTokenPair } from "../lib/stocks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const BAL_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

/** Rewards page: everything this wallet is owed, per coin, plus the coins it launched. */
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

  if (!isConnected || !me) return <main className="gate"><h1>Your <span className="horn-text">rewards</span>.</h1><p>Connect a wallet to see what every coin you hold has paid you, and claim it.</p><button className="b horn" onClick={() => openWalletModal()}>Connect wallet</button></main>;

  const value = data?.held.reduce((s, h) => s + wei(h.bal) * Number(h.t.priceUsd), 0) ?? 0;
  const owed = data ? [...data.rewards.entries()].reduce((s, [addr, r]) => { const t = tokens?.find((x) => x.address.toLowerCase() === addr); return s + (r && t ? (wei(r.pending) + (r.isCreator ? wei(r.creatorFees) : 0)) * t.pair.usd : 0); }, 0) : 0;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["rewards"] }); };
  const claim = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); const ok = await runTx(label, fn); if (ok) refresh(); };
  const kindOf = (t: { pair: { isNative: boolean; address: string } }) => (t.pair.isNative ? "eth" : isTokenPair(t.pair.address) ? "token" : "stock");

  return (
    <main>
      <section className="hero">
        <div><div className="eyebrow mono">{me}</div><h1 style={{ marginTop: 10 }}>Your <span className="horn-text">rewards</span>.</h1></div>
        <div className="stats">
          <div className="horn"><span className="eyebrow">Claimable now</span><b>{usd(owed, { compact: true })}</b></div>
          <div><span className="eyebrow">Holdings</span><b>{usd(value, { compact: true })}</b></div>
          <div><span className="eyebrow">Launched</span><b>{data?.created.length ?? 0}</b></div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Coins you hold</h2><span className="eyebrow">paid in the pair asset, per trade</span></div>
        {!data ? <div className="skel" style={{ height: 120 }} /> : data.held.length === 0 ? <div className="list"><div className="empty">Nothing held yet. <Link to="/" className="vi">Browse coins</Link></div></div> : (
          <div className="tbl"><table>
            <thead><tr><th>Coin</th><th>Pair</th><th className="num">Balance</th><th className="num">Value</th><th className="num">Owed to you</th><th></th></tr></thead>
            <tbody>{data.held.map(({ t, bal }) => { const r = data.rewards.get(t.address.toLowerCase()); const p = r?.pending ?? 0n; const eth = t.pair.ethRoute && !t.pair.isNative; return (
              <tr key={t.address}>
                <td><Link to={`/t/${t.address}`} className="coin"><Art src={t.metadata?.logo} name={t.name} className="art" /><span><b>{t.name}</b><small>{t.symbol}</small></span></Link></td>
                <td><span className={"chip " + kindOf(t)}>{t.pair.symbol}</span></td>
                <td className="num">{num(wei(bal))}</td>
                <td className="num">{usd(wei(bal) * Number(t.priceUsd))}</td>
                <td className={"num " + (p > 0n ? "up" : "faint")}>{hype(wei(p), 5)} {t.pair.symbol}<br /><small className="faint">{usd(wei(p) * t.pair.usd)}</small></td>
                <td className="num">{p > 0n ? <button className="b horn sm" onClick={claim("Claim rewards", () => client.claimRewards(t.address, eth))}>Claim{eth ? " as ETH" : ""}</button> : <Link className="b ghost sm" to={`/t/${t.address}`}>Trade</Link>}</td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Coins you launched</h2><span className="eyebrow">{FEES.creatorPct}% of every fee, forever</span></div>
        {!data ? <div className="skel" style={{ height: 120 }} /> : data.created.length === 0 ? <div className="list"><div className="empty">Nothing yet. <Link to="/launch" className="vi">Launch a coin</Link></div></div> : (
          <div className="tbl"><table>
            <thead><tr><th>Coin</th><th>Pair</th><th className="num">Market cap</th><th className="num">Vol 24h</th><th className="num">Paid to holders</th><th className="num">Your fees</th><th className="num">Lifetime</th><th></th></tr></thead>
            <tbody>{data.created.map((t) => { const r = data.rewards.get(t.address.toLowerCase()); const fees = r?.creatorFees ?? 0n; const eth = t.pair.ethRoute && !t.pair.isNative; return (
              <tr key={t.address}>
                <td><Link to={`/t/${t.address}`} className="coin"><Art src={t.metadata?.logo} name={t.name} className="art" /><span><b>{t.name}</b><small>{t.symbol}</small></span></Link></td>
                <td><span className={"chip " + kindOf(t)}>{t.pair.symbol}</span></td>
                <td className="num">{usd(t.marketCapUsd, { compact: true })}</td>
                <td className="num">{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })}</td>
                <td className="num vi">{usd(wei(r?.totalHolder ?? 0n) * t.pair.usd, { compact: true })}</td>
                <td className={"num " + (fees > 0n ? "up" : "faint")}>{hype(wei(fees), 5)} {t.pair.symbol}</td>
                <td className="num dim">{hype(wei(r?.totalCreator ?? 0n), 4)}</td>
                <td className="num"><button className="b horn sm" disabled={fees === 0n} onClick={claim("Claim creator fees", () => client.claimCreatorFees(t.address, eth))}>Claim{eth ? " as ETH" : ""}</button></td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </section>
      <p className="note">{short(me)} · Rewards are credited as each trade happens, in the coin's pair asset. Pairs with an ETH route claim straight as ETH.</p>
    </main>
  );
}
