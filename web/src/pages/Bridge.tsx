import { useCallback, useEffect, useState } from "react";
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
  arcGatewayDomain,
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
 * Base -> Arc USDC bridge over Circle Gateway, fully self-custody. The user's
 * own wallet deposits USDC into Circle's GatewayWallet on Base; once the
 * deposit finalizes it becomes a unified balance the same wallet mints on Arc
 * as native USDC via a Circle-attested burn intent. No relayer, no custody:
 * every step is the user's own transaction to Circle's contracts.
 */

const basePublic = createPublicClient({
  transport: http("https://mainnet.base.org", { batch: { wait: 16 } }),
});

const fmt = (v: bigint) =>
  Number(formatUnits(v, USDC_DECIMALS)).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function BridgePage() {
  const { isConnected, connectFirst } = useWallet();
  const { address } = useWallet();
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
  // null = still checking, false = Circle has not enabled Arc minting yet.
  const [arcMintLive, setArcMintLive] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    const a = address as Address;
    void basePublic
      .readContract({ address: BASE_SOURCE.usdc, abi: erc20Abi, functionName: "balanceOf", args: [a] })
      .then((v) => setBaseUsdc(v as bigint))
      .catch(() => {});
    void unifiedBalance(BASE_SOURCE.domain, a).then(setUnified).catch(() => {});
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

  useEffect(() => {
    let on = true;
    const check = () =>
      arcGatewayDomain()
        .then((d) => on && setArcMintLive(Boolean(d)))
        .catch(() => on && setArcMintLive(null));
    check();
    const id = setInterval(check, 60_000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

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
        throw new Error("Arc minting is not yet enabled on Circle Gateway. Your deposit is safe; try again once Circle turns it on.");
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
          Move USDC from Base to Arc over Circle Gateway, the official Circle bridge. Your own wallet
          deposits and mints; nobody custodies your funds. Deposits finalize in {BASE_SOURCE.finalityLabel},
          then you mint native USDC on Arc.
        </p>
      </div>

      {arcMintLive === false && (
        <div className="rounded-xl border border-yellow-600/40 bg-yellow-500/10 px-4 py-3 text-[13px] text-yellow-200">
          <span className="font-semibold">Minting to Arc is not live yet.</span> Circle has not enabled
          Arc on Gateway. You can deposit now and it is held safely in your Circle balance, but the final
          mint step will only work once Circle turns Arc on. Best to wait before bridging large amounts.
        </div>
      )}

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

          {/* Step 1: deposit */}
          <div className="rounded-xl border border-edge bg-panel px-4 py-4">
            <p className="text-[13px] font-semibold text-ink">1. Deposit on Base</p>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Approves and deposits USDC into Circle's Gateway wallet on Base.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
              <Button variant="ghost" onClick={() => baseUsdc !== null && setAmount(formatUnits(baseUsdc, USDC_DECIMALS))}>
                Max
              </Button>
              <Button variant="primary" disabled={busy !== null} onClick={deposit}>
                {busy === "Deposit" ? "Depositing" : "Deposit"}
              </Button>
            </div>
          </div>

          {/* Step 2: finality */}
          <div className="rounded-xl border border-edge bg-panel px-4 py-4">
            <p className="text-[13px] font-semibold text-ink">2. Wait for finality</p>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Base deposits appear in your Gateway balance after {BASE_SOURCE.finalityLabel}. This page
              refreshes it automatically.
            </p>
          </div>

          {/* Step 3: mint */}
          <div className="rounded-xl border border-edge bg-panel px-4 py-4">
            <p className="text-[13px] font-semibold text-ink">3. Mint on Arc</p>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Signs a free off-chain intent, fetches Circle's attestation, and mints native USDC to your
              wallet on Arc.
            </p>
            {arcGasLow && (
              <p className="mt-2 rounded-lg border border-edge bg-bg px-3 py-2 text-[12px] text-ink-3">
                The mint transaction needs a little USDC on Arc for gas (well under a cent). Keep a small
                amount on Arc, or bridge once, then future mints pay their own gas.
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
              <Button variant="ghost" onClick={() => unified !== null && setMintAmount(formatUnits(unified, USDC_DECIMALS))}>
                Max
              </Button>
              <Button variant="primary" disabled={busy !== null || arcMintLive === false} onClick={mint}>
                {busy === "Mint" ? "Minting" : arcMintLive === false ? "Not live yet" : "Mint on Arc"}
              </Button>
            </div>
          </div>

          <p className="text-[11px] text-ink-3">
            Steps: deposit on Base &gt; wait for finality &gt; mint on Arc. Contracts are Circle's
            official Gateway: wallet {GATEWAY_WALLET.slice(0, 10)}... on Base, minter{" "}
            {GATEWAY_MINTER.slice(0, 10)}... on Arc, native USDC {ARC_USDC.slice(0, 10)}... arcx does not
            hold or route your funds.
          </p>
        </>
      )}
    </div>
  );
}
