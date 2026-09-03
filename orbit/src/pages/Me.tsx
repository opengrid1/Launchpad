import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { Art } from "../components/Art";
import { client, onair, publicClient } from "../lib/client";
import { FEES } from "../lib/env";
import { hype, num, short, usd, wei } from "../lib/format";
import { runTx, useHypeUsd, useTokens, type Token } from "../lib/hooks";
import { q96ToFdvWei, type BidView } from "../lib/onair";
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
      // bids on every auction launch, settled or not
      const aucTokens = list.filter((t) => t.mode === "auction");
      const bidSets = await Promise.all(aucTokens.map((t) => onair.bids(t.address as Address, { owner: me!, limit: 50 }).catch(() => [] as BidView[])));
      const bids = aucTokens.flatMap((t, i) => bidSets[i].map((b) => ({ t, b })));
      return { held: held.map((h, i) => ({ ...h, claimable: rewards[i]?.claimable ?? 0n })), created: list.filter((t) => t.creator.toLowerCase() === me!.toLowerCase()), bids };
    },
  });

  if (!isConnected || !me) {
    return (
      <main className="page"><section className="hero" style={{ gridTemplateColumns: "1fr" }}><div><div className="lbl" style={{ marginBottom: 12 }}>Studio</div><h1>Your <em>studio</em>.</h1><p className="sub">Connect a wallet to see what you hold, what you bid on, what you put on air, and what you have earned.</p><div className="cta"><button className="btn red" onClick={() => openWalletModal()}>Connect wallet</button></div></div></section></main>
    );
  }

  const inEscrow = data?.bids.filter((x) => !x.b.exited).reduce((s, x) => s + wei(x.b.budget), 0) ?? 0;
  const value = data?.held.reduce((s, h) => s + wei(h.bal) * Number(h.t.priceUsd), 0) ?? 0;
  // settled auctions (no live state attached, or finalized) with unclaimed bids
  const claimableBids = data?.bids.filter((x) => !x.b.exited && (x.t.auction ? x.t.auction.finalized : true)) ?? [];

  return (
    <main className="page">
      <section className="sec">
        <div className="lbl" style={{ marginBottom: 12 }}>Studio · {short(me)}</div>
        <h1 style={{ fontSize: 56 }}>Your <em>studio</em>.</h1>
        <div className="stats3">
          <div className="stat"><b>{usd(value, { compact: true })}</b><span>Holdings value</span></div>
          <div className="stat"><b>{hype(inEscrow, 3)} HYPE</b><span>In auction bids{claimableBids.length ? ` · ${claimableBids.length} ready to claim` : ""}</span></div>
          <div className="stat"><b>{data?.created.length ?? 0}</b><span>Coins you put on air</span></div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Your bids</h2></div>
        {!data ? <div className="skeleton" style={{ minHeight: 100 }} /> : data.bids.length === 0 ? <p className="small">No auction bids yet. <Link to="/?sort=auctions" style={{ color: "var(--green)" }}>See what is up for auction</Link></p> : (
          <div className="list">
            {data.bids.map(({ t, b }) => {
              const a = t.auction;
              const settled = !a || a.finalized;
              const failed = !!a && a.finalized && !a.graduated;
              const state = b.exited ? "claimed" : settled ? (failed || a?.cancelled ? "refund ready" : "ready to claim") : b.outbid ? "outbid · refund at the end" : "filling";
              return (
                <div key={`${t.address}-${b.id}`} className="li">
                  <Art src={t.metadata?.logo} name={t.name} className="art" size={44} />
                  <div><Link to={`/t/${t.address}`} style={{ color: "inherit", fontWeight: 600 }}>{t.name}</Link><div className="l2">{hype(wei(b.budget), 3)} HYPE · max {usd((Number(q96ToFdvWei(b.maxPriceQ96)) / 1e18) * hypeUsd, { compact: true })} · {state}</div></div>
                  <div className="r">{failed || a?.cancelled ? `${hype(wei(b.budget), 3)} HYPE` : `${num(wei(b.coins))} ${t.symbol}`}<div className="l2">{failed || a?.cancelled ? "refund" : `${hype(wei(b.refund), 3)} HYPE back`}</div></div>
                  <button className="btn" disabled={!settled || b.exited} onClick={async () => { await ensureWallet(); const ok = await runTx("Claim", () => onair.claim(t.address as Address, b.id)); if (ok) qc.invalidateQueries({ queryKey: ["me"] }); }}>{b.exited ? "Claimed" : "Claim"}</button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="sec">
        <div className="sec-h"><h2>Holdings</h2></div>
        {!data ? <div className="skeleton" style={{ minHeight: 100 }} /> : data.held.length === 0 ? <p className="small">You do not hold any coins from here yet. <Link to="/" style={{ color: "var(--green)" }}>Watch the feed</Link></p> : (
          <div className="list">
            {data.held.map(({ t, bal, claimable }) => <Row key={t.address} t={t} me={me} left={`${num(wei(bal))} ${t.symbol}`} right={usd(wei(bal) * Number(t.priceUsd))} claimable={claimable} onClaimed={() => qc.invalidateQueries({ queryKey: ["me"] })} />)}
          </div>
        )}
      </section>

      <section className="sec">
        <div className="sec-h"><h2>On air by you</h2></div>
        {!data ? <div className="skeleton" style={{ minHeight: 100 }} /> : data.created.length === 0 ? <p className="small">Nothing yet. <Link to="/launch" style={{ color: "var(--green)" }}>Go live</Link></p> : (
          <>
          <div className="list">
            {data.created.map((t) => {
              const live = t.auction && !t.auction.finalized;
              return (
                <div key={t.address} className="li">
                  <Art src={t.metadata?.logo} name={t.name} className="art" size={44} />
                  <div><Link to={`/t/${t.address}`} style={{ color: "inherit", fontWeight: 600 }}>{t.name}</Link><div className="l2">{t.symbol} · {live ? `auction · ${hype(wei(t.auction!.raised), 2)} HYPE raised` : `${usd(t.marketCapUsd, { compact: true })} cap · ${usd(wei(t.volume24hWei) * hypeUsd, { compact: true })} today`}</div></div>
                  <div className="r"><div className="l2">{t.mode === "auction" ? "auction" : "instant"} · fee {FEES.creatorPct}%</div></div>
                  <button className="btn" disabled={!!live} onClick={async () => { await ensureWallet(); await runTx("Harvest fees", () => client.claimCreatorFees(t.address as Address)); }}>Harvest</button>
                </div>
              );
            })}
          </div>
          <p className="note">Harvest collects the pool's accrued fees and splits them on-chain in the same transaction: {FEES.creatorPct}% to you, {FEES.platformPct}% to the station. Anyone can trigger it.</p>
          </>
        )}
      </section>
    </main>
  );
}

function Row({ t, me, left, right, claimable, onClaimed }: { t: Token; me: Address; left: string; right: string; claimable: bigint; onClaimed: () => void }) {
  return (
    <div className="li">
      <Art src={t.metadata?.logo} name={t.name} className="art" size={44} />
      <div><Link to={`/t/${t.address}`} style={{ color: "inherit", fontWeight: 600 }}>{t.name}</Link><div className="l2">{left}</div></div>
      <div className="r">{right}<div className="l2">{claimable > 0n ? `${hype(wei(claimable), 4)} HYPE to claim` : t.mode === "auction" ? "from auction" : "instant launch"}</div></div>
      {claimable > 0n ? <button className="btn" onClick={async () => { await ensureWallet(); const ok = await runTx("Claim rewards", async () => { const hs = await client.claimBaseRewards(t.address as Address, me); if (!hs.length) throw new Error("Nothing to claim"); return hs[hs.length - 1]; }); if (ok) onClaimed(); }}>Claim</button> : <Link to={`/t/${t.address}`} className="btn ghost">Trade</Link>}
    </div>
  );
}
