import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "@launchpad/sdk/react";
import type { TokenSummary } from "@launchpad/sdk";
import type { Address } from "viem";
import { formatUnits } from "viem";

import { TokenLogo } from "../components/TokenLogo";
import { client, v4Client } from "../lib/client";
import { IS_INK } from "../lib/brand";
import { addresses, env } from "../lib/env";
import { fmtUsd } from "../lib/format";
import { ensureSdkWallet, errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";

const ERC20_META_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

interface Row {
  t: TokenSummary;
  claimable: bigint;
  stock: Address;
  sym: string;
  dec: number;
  usd: number; // USD value of the claimable amount
}

const fmtAmt = (v: bigint, dec: number) => {
  const n = Number(formatUnits(v, dec));
  if (n === 0) return "0";
  return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toPrecision(3);
};

/**
 * Rewards — every coin where the connected wallet has claimable holder
 * rewards. 50% of every trade's 1% pool fee streams to holders in the coin's
 * pair asset (HYPE or the stock); it accrues per wallet on-chain and is
 * claimed manually here or on the coin page.
 */
export function RewardsPage() {
  const { address, isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);
  const { data: tokens } = useTokens(client, { sort: "new", limit: 100 });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address || !tokens) { setRows(address ? [] : null); return; }
    // Per-stock metadata cache: several coins share the same pair asset.
    const meta = new Map<string, { sym: string; dec: number; usd: number }>();
    const out: Row[] = [];
    await Promise.all(
      tokens.map(async (t) => {
        try {
          const info = await (v4Client as any).baseRewards(t.address as Address, address as Address);
          if (!info || info.claimable <= 0n) return;
          const key = String(info.stock).toLowerCase();
          // squidpad coins pay rewards in the coin itself: price it off its
          // own market cap (fixed 1B supply) instead of the quote registry.
          if (key === t.address.toLowerCase()) {
            const px = Number(t.marketCapUsd) / 1_000_000_000;
            out.push({ t, claimable: info.claimable, stock: info.stock, sym: t.symbol, dec: 18, usd: Number(formatUnits(info.claimable, 18)) * px });
            return;
          }
          if (!meta.has(key)) {
            const isWhype = key === String(addresses.weth).toLowerCase();
            const [dec, sym, usd] = await Promise.all([
              isWhype ? 18 : (v4Client as any).publicClient.readContract({ address: info.stock, abi: ERC20_META_ABI, functionName: "decimals" }).then(Number).catch(() => 18),
              isWhype ? env.nativeSymbol : (v4Client as any).publicClient.readContract({ address: info.stock, abi: ERC20_META_ABI, functionName: "symbol" }).then(String).catch(() => ""),
              (v4Client as any).assetUsdPrice(info.stock).catch(() => 0),
            ]);
            meta.set(key, { sym, dec, usd });
          }
          const m = meta.get(key)!;
          out.push({ t, claimable: info.claimable, stock: info.stock, sym: m.sym, dec: m.dec, usd: Number(formatUnits(info.claimable, m.dec)) * m.usd });
        } catch { /* coin without a reward tracker: skip */ }
      }),
    );
    out.sort((a, b) => b.usd - a.usd);
    setRows(out);
  }, [address, tokens]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) void refresh(); }, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const claim = async (r: Row) => {
    setBusy(r.t.address);
    try {
      if (!isConnected) { await connectFirst(); return; }
      if (!(await ensureSdkWallet())) throw new Error("Wallet session expired. Reconnect and try again.");
      const hashes = await (v4Client as any).claimBaseRewards(r.t.address as Address, address as Address);
      if (hashes.length === 0) pushToast({ kind: "info", title: "Nothing to claim yet" });
      else pushToast({ kind: "success", title: `Claimed ${fmtAmt(r.claimable, r.dec)} ${r.sym}`, body: "Sent to your wallet.", txHash: hashes[hashes.length - 1] });
      await refresh();
    } catch (err) {
      pushToast({ kind: "error", title: "Claim failed", body: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const totalUsd = (rows ?? []).reduce((s, r) => s + r.usd, 0);

  return (
    <div className="kf kf-page">
      <h1 className="kf-page-h1">Rewards</h1>
      <p style={{ margin: "0 18px 12px", fontSize: 13, lineHeight: 1.55, color: "var(--color-ink-2)" }}>
        {IS_INK
          ? `Hold any coin and 0.5% of every buy accrues to holders automatically on the trade. When you claim, it is paid out in the coin's pair, the tokenized stock (or ${env.nativeSymbol}). Nothing to trigger: rewards land on-chain as people buy, and you claim them here or on the coin's page.`
          : "Hold any coin and 50% of every trade's 1% fee streams to holders in the coin's pair, HYPE or the stock itself. Rewards accrue to your wallet on-chain and are claimed manually, here or on the coin's page."}
      </p>

      {!address ? (
        <div className="kf-empty">
          Connect your wallet to see your claimable rewards.
          <div style={{ marginTop: 14 }}>
            <button className="kf-reward-claim-btn" onClick={() => connectFirst()}>Connect wallet</button>
          </div>
        </div>
      ) : rows === null ? (
        <div className="kf-empty">Checking your rewards…</div>
      ) : rows.length === 0 ? (
        <div className="kf-empty">
          {IS_INK ? (
            <>No claimable rewards yet. Buy and hold any <Link to="/">coin</Link>; your share accrues automatically on every buy after yours.</>
          ) : (
            <>No claimable rewards yet. Buy and hold any <Link to="/">coin</Link>; your share starts accruing as soon as its fees are harvested.</>
          )}
        </div>
      ) : (
        <div style={{ margin: "0 16px 20px" }}>
          {totalUsd > 0 ? (
            <p style={{ margin: "2px 2px 10px", fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>
              Total claimable <span style={{ color: "var(--color-accent-ink)" }}>{fmtUsd(totalUsd)}</span>
            </p>
          ) : null}
          {rows.map((r) => (
            <div key={r.t.address} className="kf-reward-claim" style={{ marginTop: 10 }}>
              <Link to={`/token/${r.t.address}`} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, textDecoration: "none" }}>
                <TokenLogo token={r.t} size={34} />
                <div className="kf-reward-claim-info">
                  <span className="kf-reward-claim-label">{r.t.symbol}</span>
                  <span className="kf-reward-claim-amt">
                    {fmtAmt(r.claimable, r.dec)} {r.sym}
                    {r.usd > 0 ? <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)" }}>≈ {fmtUsd(r.usd)}</span> : null}
                  </span>
                </div>
              </Link>
              <button className="kf-reward-claim-btn" disabled={busy === r.t.address} onClick={() => claim(r)}>
                {busy === r.t.address ? "Claiming…" : "Claim"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
