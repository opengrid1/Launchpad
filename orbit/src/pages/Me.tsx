import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { Logo } from "../components/Logo";
import { client, publicClient } from "../lib/client";
import { hype, num, short, usd, wei } from "../lib/format";
import { runTx, useHypeUsd, useTokens, type Token } from "../lib/hooks";
import { ensureWallet, openWalletModal } from "../lib/wallet";

const BAL_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

export default function Me() {
  const { address: me, isConnected } = useAccount();
  const { data: tokens } = useTokens();
  const { data: hypeUsd = 0 } = useHypeUsd();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["me", me, tokens?.length],
    enabled: !!me && !!tokens,
    refetchInterval: 30_000,
    queryFn: async () => {
      const list = tokens!;
      const bals = await publicClient.multicall({ contracts: list.map((t) => ({ address: t.address, abi: BAL_ABI, functionName: "balanceOf", args: [me!] })), allowFailure: true });
      const held = list.map((t, i) => ({ t, bal: bals[i].status === "success" ? (bals[i].result as bigint) : 0n })).filter((x) => x.bal > 0n);
      const rewards = await Promise.all(held.map((h) => client.baseRewards(h.t.address, me!).catch(() => null)));
      return { held: held.map((h, i) => ({ ...h, claimable: rewards[i]?.claimable ?? 0n })), created: list.filter((t) => t.creator.toLowerCase() === me!.toLowerCase()) };
    },
  });

  if (!isConnected || !me) {
    return (
      <main className="page"><section className="hero"><h1>Your coins.</h1><p className="sub">Connect a wallet to see what you hold, what you launched, and what you have earned.</p><div className="cta"><button className="go" onClick={() => openWalletModal()}>Connect wallet</button></div></section></main>
    );
  }

  const totalClaimable = data?.held.reduce((s, h) => s + wei(h.claimable), 0) ?? 0;
  const value = data?.held.reduce((s, h) => s + wei(h.bal) * Number(h.t.priceUsd), 0) ?? 0;

  return (
    <main className="page">
      <section className="section">
        <div className="eyebrow">{short(me)}</div>
        <h1>Your coins.</h1>
        <div className="features" style={{ marginTop: 18 }}>
          <div className="feature"><div className="big">{usd(value, { compact: true })}</div><p>Holdings value</p></div>
          <div className="feature"><div className="big">{hype(totalClaimable, 4)} HYPE</div><p>Rewards waiting to be claimed</p></div>
          <div className="feature"><div className="big">{data?.created.length ?? 0}</div><p>Coins you launched</p></div>
        </div>
      </section>

      <section className="section">
        <h2>Holdings</h2>
        {!data ? <div className="skeleton" style={{ minHeight: 100 }} /> : data.held.length === 0 ? <p className="small">You do not hold any coins from here yet. <Link to="/">Browse coins</Link></p> : (
          <div className="list">
            {data.held.map(({ t, bal, claimable }) => <Row key={t.address} t={t} me={me} left={`${num(wei(bal))} ${t.symbol}`} right={usd(wei(bal) * Number(t.priceUsd))} claimable={claimable} onClaimed={() => qc.invalidateQueries({ queryKey: ["me"] })} />)}
          </div>
        )}
      </section>

      <section className="section">
        <h2>Launched by you</h2>
        {!data ? <div className="skeleton" style={{ minHeight: 100 }} /> : data.created.length === 0 ? <p className="small">Nothing yet. <Link to="/launch">Launch a coin</Link></p> : (
          <div className="list">
            {data.created.map((t) => (
              <div key={t.address} className="li" style={{ gridTemplateColumns: "auto 1fr auto auto" }}>
                <Logo src={t.metadata?.logo} name={t.name} className="art" size={40} />
                <div><Link to={`/t/${t.address}`} style={{ color: "inherit", fontWeight: 600 }}>{t.name}</Link><div className="l2">{t.symbol} · {usd(t.marketCapUsd, { compact: true })} cap · {usd(wei(t.volume24hWei) * hypeUsd, { compact: true })} today</div></div>
                <div className="r"><div className="l2">creator fee 40%</div></div>
                <button className="pillbtn quiet" onClick={async () => { await ensureWallet(); await runTx("Harvest fees", () => client.claimCreatorFees(t.address as Address)); }}>Harvest</button>
              </div>
            ))}
            <p className="note">Harvest collects the pool's accrued fees and splits them on-chain in the same transaction: 50% to holders, 40% to you, 10% platform. Anyone can trigger it.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function Row({ t, me, left, right, claimable, onClaimed }: { t: Token; me: Address; left: string; right: string; claimable: bigint; onClaimed: () => void }) {
  return (
    <div className="li" style={{ gridTemplateColumns: "auto 1fr auto auto" }}>
      <Logo src={t.metadata?.logo} name={t.name} className="art" size={40} />
      <div><Link to={`/t/${t.address}`} style={{ color: "inherit", fontWeight: 600 }}>{t.name}</Link><div className="l2">{left}</div></div>
      <div className="r">{right}<div className="l2">{claimable > 0n ? `${hype(wei(claimable), 4)} HYPE to claim` : "no rewards yet"}</div></div>
      <button className="pillbtn" disabled={claimable === 0n} onClick={async () => { await ensureWallet(); const ok = await runTx("Claim rewards", async () => { const hs = await client.claimBaseRewards(t.address as Address, me); if (!hs.length) throw new Error("Nothing to claim"); return hs[hs.length - 1]; }); if (ok) onClaimed(); }}>Claim</button>
    </div>
  );
}
