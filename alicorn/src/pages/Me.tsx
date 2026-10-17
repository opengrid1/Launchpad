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

  if (!isConnected || !me) return <main className="gate"><h1>Rewards</h1><p>Connect a wallet to see what every coin you hold has paid you, and claim it.</p><button className="b pri" onClick={() => openWalletModal()}>Connect wallet</button></main>;

  const value = data?.held.reduce((s, h) => s + wei(h.bal) * Number(h.t.priceUsd), 0) ?? 0;
  const owed = data ? [...data.rewards.entries()].reduce((s, [addr, r]) => { const t = tokens?.find((x) => x.address.toLowerCase() === addr); return s + (r && t ? (wei(r.pending, t.pair.decimals) + (r.isCreator ? wei(r.creatorFees, t.pair.decimals) : 0)) * t.pair.usd : 0); }, 0) : 0;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["rewards"] }); };
  const claim = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); const ok = await runTx(label, fn); if (ok) refresh(); };
  const kindOf = (t: { pair: { isNative: boolean; address: string; v3Fee?: number } }) => (t.pair.isNative ? "eth" : isTokenPair(t.pair.address) || t.pair.v3Fee ? "token" : "stock");

  return (
    <main>
      <div className="row-flex" style={{ justifyContent: "space-between", marginBottom: 14 }}><h1>Rewards</h1><span className="eyebrow">{short(me)}</span></div>
      <div className="cards">
        <div className="card"><span>Claimable now</span><b className="vi">{usd(owed, { compact: true })}</b></div>
        <div className="card"><span>Holdings value</span><b>{usd(value, { compact: true })}</b></div>
        <div className="card"><span>Coins held</span><b>{data?.held.length ?? 0}</b></div>
        <div className="card"><span>Coins launched</span><b>{data?.created.length ?? 0}</b></div>
      </div>

      <section className="sec">
        <div className="sec-h"><h2>Held</h2><span className="eyebrow">Paid in the pair asset on every trade</span></div>
        {!data ? <div className="skel" style={{ height: 120 }} /> : data.held.length === 0 ? <div className="card"><div className="empty">Nothing held yet. <Link to="/" className="vi">Browse coins</Link></div></div> : (
          <div className="tbl"><table>
            <thead><tr><th>Coin</th><th>Pays in</th><th className="r">Balance</th><th className="r">Value</th><th className="r">Claimable</th><th></th></tr></thead>
            <tbody>{data.held.map(({ t, bal }) => { const r = data.rewards.get(t.address.toLowerCase()); const p = r?.pending ?? 0n; const eth = t.pair.ethRoute && !t.pair.isNative; return (
              <tr key={t.address}>
                <td><Link to={`/t/${t.address}`} className="coin"><Art src={t.metadata?.logo} name={t.name} className="art" /><span><b>{t.name}</b><small>{t.symbol}</small></span></Link></td>
                <td><span className={"chip " + kindOf(t)}>{t.pair.symbol}</span></td>
                <td className="r">{num(wei(bal))}</td>
                <td className="r">{usd(wei(bal) * Number(t.priceUsd))}</td>
                <td className={"r " + (p > 0n ? "up" : "faint")}>{hype(wei(p, t.pair.decimals), 5)} {t.pair.symbol}<small>{usd(wei(p, t.pair.decimals) * t.pair.usd)}</small></td>
                <td className="r">{p > 0n ? <button className="b pri sm" onClick={claim("Claim rewards", () => client.claimRewards(t.address, eth))}>Claim{eth ? " as ETH" : ""}</button> : <Link className="b ghost sm" to={`/t/${t.address}`}>Trade</Link>}</td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Launched</h2><span className="eyebrow">{FEES.creatorPct}% of every fee, forever</span></div>
        {!data ? <div className="skel" style={{ height: 120 }} /> : data.created.length === 0 ? <div className="card"><div className="empty">Nothing yet. <Link to="/launch" className="vi">Launch a coin</Link></div></div> : (
          <div className="tbl"><table>
            <thead><tr><th>Coin</th><th>Pays in</th><th className="r">Market cap</th><th className="r">Volume 24h</th><th className="r">Paid to holders</th><th className="r">Your fees</th><th className="r">Lifetime</th><th></th></tr></thead>
            <tbody>{data.created.map((t) => { const r = data.rewards.get(t.address.toLowerCase()); const fees = r?.creatorFees ?? 0n; const eth = t.pair.ethRoute && !t.pair.isNative; return (
              <tr key={t.address}>
                <td><Link to={`/t/${t.address}`} className="coin"><Art src={t.metadata?.logo} name={t.name} className="art" /><span><b>{t.name}</b><small>{t.symbol}</small></span></Link></td>
                <td><span className={"chip " + kindOf(t)}>{t.pair.symbol}</span></td>
                <td className="r">{usd(t.marketCapUsd, { compact: true })}</td>
                <td className="r">{usd(wei(t.volume24hWei, t.pair.decimals) * t.pair.usd, { compact: true })}</td>
                <td className="r vi">{usd(wei(r?.totalHolder ?? 0n, t.pair.decimals) * t.pair.usd, { compact: true })}</td>
                <td className={"r " + (fees > 0n ? "up" : "faint")}>{hype(wei(fees, t.pair.decimals), 5)} {t.pair.symbol}</td>
                <td className="r dim">{hype(wei(r?.totalCreator ?? 0n, t.pair.decimals), 4)}</td>
                <td className="r"><button className="b pri sm" disabled={fees === 0n} onClick={claim("Claim creator fees", () => client.claimCreatorFees(t.address, eth))}>Claim{eth ? " as ETH" : ""}</button></td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </section>
      <p className="note">Rewards are credited as each trade settles, in the coin's pair asset. Pairs with an ETH route can be claimed straight as ETH.</p>
    </main>
  );
}
