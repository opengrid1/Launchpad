import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, formatUnits, http, parseUnits, type Address, type Hex } from "viem";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";

import { Button } from "../components/ui";
import { v4Client } from "../lib/client";
import { env } from "../lib/env";
import { errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";
import {
  ARC_USDC,
  BASE_SOURCE,
  EIP712_DOMAIN,
  EIP712_TYPES,
  GATEWAY_MINTER,
  GATEWAY_WALLET,
  USDC_DECIMALS,
  buildBurnIntent,
  burnIntentJson,
  erc20Abi,
  expectedHeightFrom,
  gatewayDomains,
  gatewayMinterAbi,
  gatewayWalletAbi,
  requestAttestation,
  unifiedBalance,
} from "../lib/bridge/gateway";

/**
 * Base -> Arc USDC bridge over Circle Gateway. Deposit USDC into Circle's
 * GatewayWallet on Base; once the deposit finalizes it becomes a unified
 * balance that mints on Arc as native USDC via a signed burn intent.
 */

const basePublic = createPublicClient({
  transport: http("https://mainnet.base.org", { batch: { wait: 16 } }),
});

const fmt = (v: bigint) => {
  const s = Number(formatUnits(v, USDC_DECIMALS));
  return s.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const STEPS = ["Deposit on Base", "Wait for finality", "Mint on Arc"];

export function BridgePage() {
  const { address, isConnected, connectFirst } = useWallet();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { chain: connectedChain } = useAccount();
  const pushToast = useUi((s) => s.pushToast);

  const [amount, setAmount] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [baseUsdc, setBaseUsdc] = useState<bigint | null>(null);
  const [unified, setUnified] = useState<bigint | null>(null);
  const [arcUsdc, setArcUsdc] = useState<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    const a = address as Address;
    void basePublic
      .readContract({ address: BASE_SOURCE.usdc, abi: erc20Abi, functionName: "balanceOf", args: [a] })
      .then((v) => setBaseUsdc(v as bigint))
      .catch(() => {});
    void unifiedBalance(BASE_SOURCE.domain, a)
      .then(setUnified)
      .catch(() => {});
    void v4Client.publicClient
      .getBalance({ address: a })
      .then((wei) => setArcUsdc(wei / 10n ** 12n))
      .catch(() => {});
  }, [address]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      pushToast({ kind: "error", title: `${label} failed`, body: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const ensureChain = async (chainId: number) => {
    if (connectedChain?.id !== chainId) await switchChainAsync({ chainId });
  };

  const deposit = () =>
    run("Deposit", async () => {
      if (!walletClient?.account) throw new Error("Connect a wallet first.");
      const value = parseUnits(amount || "0", USDC_DECIMALS);
      if (value <= 0n) throw new Error("Enter an amount.");
      if (baseUsdc !== null && value > baseUsdc) throw new Error("Amount exceeds your Base USDC balance.");
      await ensureChain(BASE_SOURCE.chainId);
      const me = walletClient.account.address as Address;
      const allowance = (await basePublic.readContract({
        address: BASE_SOURCE.usdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [me, GATEWAY_WALLET],
      })) as bigint;
      if (allowance < value) {
        const h = await walletClient.writeContract({
          address: BASE_SOURCE.usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [GATEWAY_WALLET, value],
          chain: walletClient.chain,
          account: walletClient.account,
        });
        await basePublic.waitForTransactionReceipt({ hash: h });
      }
      const hash = await walletClient.writeContract({
        address: GATEWAY_WALLET,
        abi: gatewayWalletAbi,
        functionName: "deposit",
        args: [BASE_SOURCE.usdc, value],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await basePublic.waitForTransactionReceipt({ hash });
      pushToast({
        kind: "success",
        title: "Deposited to Circle Gateway",
        body: `Your USDC becomes mintable on Arc after Base finality (${BASE_SOURCE.finalityLabel}).`,
      });
      setAmount("");
      refresh();
    });

  const mint = () =>
    run("Mint", async () => {
      if (!walletClient?.account) throw new Error("Connect a wallet first.");
      const value = parseUnits(mintAmount || "0", USDC_DECIMALS);
      if (value <= 0n) throw new Error("Enter an amount.");
      if (unified !== null && value > unified) throw new Error("Amount exceeds your Gateway balance.");
      const me = walletClient.account.address as Address;

      const domains = await gatewayDomains();
      if (!domains.some((d) => d.domain === 26)) {
        throw new Error("Arc minting is temporarily paused on Circle Gateway. Your deposit is safe; try again later.");
      }
      const src = domains.find((d) => d.domain === BASE_SOURCE.domain);
      if (!src) throw new Error("Base is unavailable on Circle Gateway right now.");

      const sign = async (height: string) => {
        const intent = buildBurnIntent(BASE_SOURCE, me, value, height);
        const signature = (await walletClient.signTypedData({
          account: walletClient.account!,
          domain: EIP712_DOMAIN,
          types: EIP712_TYPES as any,
          primaryType: "BurnIntent",
          message: intent as any,
        })) as Hex;
        return requestAttestation(burnIntentJson(intent), signature);
      };

      let att;
      try {
        att = await sign(src.burnIntentExpirationHeight);
      } catch (err) {
        const h = expectedHeightFrom(err);
        if (!h) throw err;
        att = await sign(h);
      }

      // Gasless path first: the site's relayer submits the mint so first-time
      // bridgers with no Arc gas still receive their USDC. Falls back to the
      // user's own wallet when the relay is unavailable.
      try {
        const r = await fetch("/api/bridge-mint", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ attestation: att.attestation, signature: att.signature }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.hash) {
          pushToast({ kind: "success", title: "USDC minted on Arc (gasless)", txHash: j.hash });
          setMintAmount("");
          refresh();
          return;
        }
      } catch {
        /* relay unreachable; fall through to self-mint */
      }

      await ensureChain(env.chainId);
      const hash = await walletClient.writeContract({
        address: GATEWAY_MINTER,
        abi: gatewayMinterAbi,
        functionName: "gatewayMint",
        args: [att.attestation, att.signature],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await v4Client.publicClient.waitForTransactionReceipt({ hash });
      pushToast({ kind: "success", title: "USDC minted on Arc", txHash: hash });
      setMintAmount("");
      refresh();
    });

  const arcGasLow = arcUsdc !== null && arcUsdc < 10_000n; // under 0.01 USDC

  // Instant bridge (custodial relay): the UI sends USDC on Base to the
  // relayer from the connected wallet, then auto-claims; the payout goes to
  // the same address that sent the deposit, minus a 1% fee.
  const RELAYER_DEPOSIT = "0xe5b498a00596ab2fa0e8a86cdde15502b2552208";
  const [bridgeAmount, setBridgeAmount] = useState("");
  const [claimTx, setClaimTx] = useState("");
  const [claimResult, setClaimResult] = useState<string | null>(null);
  const [bridgeStage, setBridgeStage] = useState<string | null>(null);

  const submitClaim = async (tx: string): Promise<{ done: boolean; message: string }> => {
    const r = await fetch("/api/bridge-claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash: tx }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 425) return { done: false, message: j.error ?? "Waiting for confirmations" };
    if (r.status === 202 && j.queued) return { done: true, message: j.message };
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return { done: true, message: `Sent ${j.amountUsdc} USDC on Arc to ${j.to}. Tx: ${j.hash}` };
  };

  const bridge = () =>
    run("Bridge", async () => {
      if (!walletClient?.account) throw new Error("Connect a wallet first.");
      setClaimResult(null);
      const value = parseUnits(bridgeAmount || "0", USDC_DECIMALS);
      if (value <= 0n) throw new Error("Enter an amount.");
      if (baseUsdc !== null && value > baseUsdc) throw new Error("Amount exceeds your Base USDC balance.");

      setBridgeStage("Sending USDC on Base...");
      await ensureChain(BASE_SOURCE.chainId);
      const hash = await walletClient.writeContract({
        address: BASE_SOURCE.usdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: [RELAYER_DEPOSIT as Address, value],
        chain: walletClient.chain,
        account: walletClient.account,
      });
      await basePublic.waitForTransactionReceipt({ hash });
      setClaimTx(hash);

      // Auto-claim: the relay wants ~10 Base confirmations (~20s); poll until
      // it accepts, then surface the outcome.
      setBridgeStage("Confirming on Base (about half a minute)...");
      for (let i = 0; i < 24; i++) {
        try {
          const out = await submitClaim(hash);
          if (out.done) {
            setClaimResult(out.message);
            pushToast({ kind: "success", title: "Bridge submitted", body: out.message });
            setBridgeAmount("");
            setBridgeStage(null);
            refresh();
            return;
          }
          setBridgeStage(out.message + "...");
        } catch (err) {
          setBridgeStage(null);
          throw err;
        }
        await new Promise((r) => setTimeout(r, 8_000));
      }
      setBridgeStage(null);
      setClaimResult("Deposit sent. Claim below with the transaction hash once Base confirms.");
    });
  const claim = () =>
    run("Claim", async () => {
      setClaimResult(null);
      const tx = claimTx.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new Error("Paste the full Base transaction hash (0x...).");
      const out = await submitClaim(tx);
      setClaimResult(out.message);
      pushToast({ kind: out.done ? "success" : "info", title: out.done ? "Claim processed" : "Not ready yet", body: out.message });
      if (out.done) refresh();
    });

  const stat = (label: string, value: string) => (
    <div className="rounded-xl border border-edge bg-panel px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className="tnum mt-0.5 text-[15px] font-semibold text-ink">{value}</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold text-ink">Bridge USDC to Arc</h1>
        <p className="mt-1 text-[13px] text-ink-2">
          Send USDC on Base to the bridge address, claim with your transaction hash, and receive native
          USDC on Arc at the same wallet. Fee is 1%.
        </p>
      </div>

      {!isConnected ? (
        <div className="rounded-xl border border-edge bg-panel px-4 py-8 text-center">
          <p className="text-sm text-ink-2">Connect your wallet to bridge.</p>
          <div className="mt-3">
            <Button variant="primary" onClick={() => connectFirst()}>
              Connect Wallet
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {stat("USDC on Base", baseUsdc === null ? "-" : fmt(baseUsdc))}
            {stat("In Gateway", unified === null ? "-" : fmt(unified))}
            {stat("USDC on Arc", arcUsdc === null ? "-" : fmt(arcUsdc))}
          </div>

          {/* One-click bridge from the connected wallet. */}
          <div className="rounded-xl border border-accent/30 bg-panel px-4 py-4">
            <p className="text-[13px] font-semibold text-ink">Bridge from Base</p>
            <p className="mt-0.5 text-[12px] text-ink-3">
              One tap: your wallet sends USDC on Base and the payout lands as native USDC on Arc at the
              same address, minus a 1% fee.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={bridgeAmount}
                onChange={(e) => setBridgeAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
              <Button
                variant="ghost"
                onClick={() => baseUsdc !== null && setBridgeAmount(formatUnits(baseUsdc, USDC_DECIMALS))}
              >
                Max
              </Button>
              <Button variant="primary" disabled={busy !== null} onClick={bridge}>
                {busy === "Bridge" ? "Bridging" : "Bridge"}
              </Button>
            </div>
            {bridgeStage && <p className="mt-2 text-[12px] text-ink-2">{bridgeStage}</p>}
            {claimResult && <p className="mt-2 break-all text-[12px] text-up">{claimResult}</p>}

            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] text-ink-3">
                Manual: send from an exchange or re-claim a deposit
              </summary>
              <p className="mt-2 text-[12px] text-ink-3">
                Send USDC on Base to the bridge address below from any wallet you control (not from an
                exchange account, since payouts return to the sending address), then claim with the
                transaction hash.
              </p>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge bg-bg px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">{RELAYER_DEPOSIT}</code>
                <Button
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard?.writeText(RELAYER_DEPOSIT);
                    pushToast({ kind: "info", title: "Address copied" });
                  }}
                >
                  Copy
                </Button>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={claimTx}
                  onChange={(e) => setClaimTx(e.target.value)}
                  placeholder="Base tx hash (0x...)"
                  className="w-full rounded-lg border border-edge bg-bg px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-accent"
                />
                <Button variant="primary" disabled={busy !== null} onClick={claim}>
                  {busy === "Claim" ? "Claiming" : "Claim"}
                </Button>
              </div>
            </details>
          </div>

          {/* Recovery card for wallets holding a Circle Gateway balance from
              earlier direct deposits; hidden otherwise. */}
          {unified !== null && unified > 0n && (
            <div className="rounded-xl border border-edge bg-panel px-4 py-4">
              <p className="text-[13px] font-semibold text-ink">Your Circle Gateway balance</p>
              <p className="mt-0.5 text-[12px] text-ink-3">
                This wallet holds {fmt(unified)} USDC inside Circle Gateway from an earlier deposit. Mint
                it to your wallet on Arc here once Circle enables Arc minting.
              </p>
              {arcGasLow && (
                <p className="mt-2 rounded-lg border border-edge bg-bg px-3 py-2 text-[12px] text-ink-3">
                  No Arc gas? No problem: the site's relayer submits the mint for you, free.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <input
                  value={mintAmount}
                  onChange={(e) => setMintAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                <Button variant="ghost" onClick={() => setMintAmount(formatUnits(unified, USDC_DECIMALS))}>
                  Max
                </Button>
                <Button variant="primary" disabled={busy !== null} onClick={mint}>
                  {busy === "Mint" ? "Minting" : "Mint on Arc"}
                </Button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-ink-3">
            The bridge is a relay run by arcx: deposits to the address above are forwarded into Circle
            Gateway ({GATEWAY_WALLET.slice(0, 10)}...) and paid out on Arc as native USDC to the sending
            address. Fee 1%. Native USDC on Arc: {ARC_USDC.slice(0, 10)}...
          </p>
        </>
      )}
    </div>
  );
}
