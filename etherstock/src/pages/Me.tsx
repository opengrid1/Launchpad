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

/** Portfolio: what the wallet holds and what it launched, as two ledgers. */
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
      const ledgers = await Promise.all(created.map(async (t) => ({ t, r: await client.ledger(t.address, me!).catch(() => null) })));
      return { held, created, ledgers: new Map(ledgers.map((x) => [x.t.address.toLowerCase(), x.r])) };
    },
  });

  if (!isConnected || !me) return <main className="gate"><h1>Your book.</h1><p>Connect a wallet to see what you hold, how much of it has burned, and the coins you launched.</p><button className="b pri" onClick={() => openWalletModal()}>Connect wallet</button></main>;

  const value = data?.held.reduce((s, h) => s + wei(h.bal) * Number(h.t.priceUsd), 0) ?? 0;
  const earned = data ? [...data.ledgers.entries()].reduce((s, [addr, r]) => { const t = tokens?.find((x) => x.address.toLowerCase() === addr); return s + (r && t ? wei(r.creatorFees) * t.pair.usd : 0); }, 0) : 0;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["ledger"] }); };
  const claim = (label: string, fn: () => Promise<`0x${string}`>) => async () => { await ensureWallet(); const ok = await runTx(label, fn); if (ok) refresh(); };
  const burnedOf = (t: { burn?: { burned: bigint } }) => (t.burn ? (Number(t.burn.burned) / 1e27) * 100 : 0);

  return (
    <main>
      <section className="band">
        <div><h1>Your <em>book</em>.</h1><p className="mono" style={{ fontSize: 13 }}>{me}</p></div>
        <div className="figs">
          <div><span className="lbl">Holdings</span><b>{usd(value, { compact: true })}</b></div>
          <div><span className="lbl">Creator fees</span><b className="ember">{usd(earned, { compact: true })}</b></div>
          <div><span className="lbl">Launched</span><b>{data?.created.length ?? 0}</b></div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Holdings</h2><span className="lbl">{data?.held.length ?? 0} coins</span></div>
        {!data ? <div className="skel" style={{ height: 120 }} /> : data.held.length === 0 ? <div className="box"><div className="empty">Nothing held yet. <Link to="/" className="ember">Browse the board</Link></div></div> : (
          <div className="tbl"><table>
            <thead><tr><th>Coin</th><th>Pair</th><th className="num">Balance</th><th className="num">Value</th><th className="num">Burned</th><th></th></tr></thead>
            <tbody>{data.held.map(({ t, bal }) => { const b = burnedOf(t); return (
              <tr key={t.address}>
                <td><Link to={`/t/${t.address}`} className="coin"><Art src={t.metadata?.logo} name={t.name} className="art" /><span><b>{t.name}</b><small>{t.symbol}</small></span></Link></td>
                <td><span className={"chip " + (t.pair.isNative ? "eth" : "stock")}>{t.pair.symbol}</span></td>
                <td className="num">{num(wei(bal))}</td>
                <td className="num">{usd(wei(bal) * Number(t.priceUsd))}</td>
                <td className={"num " + (b > 0 ? "ember" : "faint")}>{b.toFixed(2)}%</td>
                <td className="num"><Link className="b sm" to={`/t/${t.address}`}>Trade</Link></td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Launched by you</h2><span className="lbl">{FEES.creatorPct}% of every fee, forever</span></div>
        {!data ? <div className="skel" style={{ height: 120 }} /> : data.created.length === 0 ? <div className="box"><div className="empty">Nothing yet. <Link to="/launch" className="ember">Launch a coin</Link></div></div> : (
          <>
            <div className="tbl"><table>
              <thead><tr><th>Coin</th><th>Pair</th><th className="num">Market cap</th><th className="num">Vol 24h</th><th className="num">Burned</th><th className="num">Fees to claim</th><th className="num">Lifetime</th><th></th></tr></thead>
              <tbody>{data.created.map((t) => { const r = data.ledgers.get(t.address.toLowerCase()); const fees = r?.creatorFees ?? 0n; const eth = t.pair.ethRoute && !t.pair.isNative; return (
                <tr key={t.address}>
                  <td><Link to={`/t/${t.address}`} className="coin"><Art src={t.metadata?.logo} name={t.name} className="art" /><span><b>{t.name}</b><small>{t.symbol}</small></span></Link></td>
                  <td><span className={"chip " + (t.pair.isNative ? "eth" : "stock")}>{t.pair.symbol}</span></td>
                  <td className="num">{usd(t.marketCapUsd, { compact: true })}</td>
                  <td className="num">{usd(wei(t.volume24hWei) * t.pair.usd, { compact: true })}</td>
                  <td className="num ember">{burnedOf(t).toFixed(2)}%</td>
                  <td className={"num " + (fees > 0n ? "up" : "faint")}>{hype(wei(fees), 5)} {t.pair.symbol}</td>
                  <td className="num dim">{hype(wei(r?.totalCreator ?? 0n), 4)}</td>
                  <td className="num"><button className="b pri sm" disabled={fees === 0n} onClick={claim("Claim creator fees", () => client.claimCreatorFees(t.address, eth))}>Claim{eth ? " as ETH" : ""}</button></td>
                </tr>); })}</tbody>
            </table></div>
            <p className="note">Credited as each trade happens, in the coin's pair asset. Stock pairs with an ETH route claim straight as ETH. The {FEES.burnPct}% burn share never touches a wallet.</p>
          </>
        )}
      </section>
      <p className="note">{short(me)} · <Link to="/" className="ember">Board</Link></p>
    </main>
  );
}
