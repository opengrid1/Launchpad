import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import { launchTokenAbi, type Address, type TokenSummary } from "@launchpad/sdk";

import { client } from "../lib/client";
import { env } from "../lib/env";
import { fmtWei, compact } from "../lib/format";
import { errorText, useWallet } from "../lib/useWallet";
import { useUi } from "../store";
import { Button, inputClass } from "./ui";

type Side = "buy" | "sell";

export function TradePanel({ token }: { token: TokenSummary }) {
  const { address, isConnected, connectFirst } = useWallet();
  const pushToast = useUi((s) => s.pushToast);

  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [nativeBalance, setNativeBalance] = useState<bigint | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);

  const refreshBalances = async () => {
    if (!address) {
      setNativeBalance(null);
      setTokenBalance(null);
      return;
    }
    const [native, tok] = await Promise.all([
      client.publicClient.getBalance({ address }),
      client.publicClient.readContract({
        address: token.address,
        abi: launchTokenAbi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);
    setNativeBalance(native);
    setTokenBalance(tok);
  };

  useEffect(() => {
    refreshBalances().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, token.address]);

  const parsedAmount = useMemo(() => {
    try {
      return amount ? parseEther(amount as `${number}`) : 0n;
    } catch {
      return null;
    }
  }, [amount]);

  const estimate = useMemo(() => {
    if (!parsedAmount || parsedAmount === 0n) return null;
    const price = Number(token.priceWei) / 1e18; // native per token
    if (price <= 0) return null;
    if (side === "buy") {
      const nativeIn = Number(parsedAmount) / 1e18;
      const afterFee = nativeIn * 0.97;
      return `~ ${compact(afterFee / price)} ${token.symbol}`;
    }
    const tokensIn = Number(parsedAmount) / 1e18;
    return `~ ${(tokensIn * price * 0.97).toFixed(6)} ${env.nativeSymbol}`;
  }, [parsedAmount, side, token.priceWei, token.symbol]);

  const setPct = (pct: number) => {
    if (side === "sell" && tokenBalance != null) {
      setAmount(formatEther((tokenBalance * BigInt(pct)) / 100n));
    } else if (side === "buy" && nativeBalance != null) {
      // Leave headroom for gas on a full-balance buy.
      const usable = pct === 100 ? (nativeBalance * 98n) / 100n : (nativeBalance * BigInt(pct)) / 100n;
      setAmount(formatEther(usable));
    }
  };

  const submit = async () => {
    if (!parsedAmount || parsedAmount === 0n) return;
    setBusy(true);
    try {
      const hash =
        side === "buy"
          ? await client.buyToken(token.address as Address, parsedAmount)
          : await client.sellToken(token.address as Address, parsedAmount);
      pushToast({ kind: "info", title: `${side === "buy" ? "Buy" : "Sell"} submitted`, txHash: hash });
      await client.publicClient.waitForTransactionReceipt({ hash });
      pushToast({ kind: "success", title: `${side === "buy" ? "Buy" : "Sell"} confirmed`, txHash: hash });
      setAmount("");
      await refreshBalances();
    } catch (err) {
      pushToast({ kind: "error", title: "Transaction failed", body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const insufficientFunds =
    parsedAmount != null &&
    ((side === "buy" && nativeBalance != null && parsedAmount > nativeBalance) ||
      (side === "sell" && tokenBalance != null && parsedAmount > tokenBalance));

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-panel-2 p-1">
        {(["buy", "sell"] as Side[]).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
            }}
            className={`rounded-md py-1.5 text-sm font-semibold capitalize transition-colors ${
              side === s
                ? s === "buy"
                  ? "bg-up text-white"
                  : "bg-down text-white"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="font-medium uppercase tracking-wider text-ink-2">
            {side === "buy" ? `Pay (${env.nativeSymbol})` : `Sell (${token.symbol})`}
          </span>
          <button
            className="tnum text-ink-3 hover:text-ink-2"
            onClick={() => setPct(100)}
            title="Use full balance"
          >
            Balance:{" "}
            {side === "buy"
              ? nativeBalance != null
                ? fmtWei(nativeBalance)
                : "-"
              : tokenBalance != null
                ? fmtWei(tokenBalance)
                : "-"}
          </button>
        </div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0.0"
          inputMode="decimal"
          className={`${inputClass} tnum text-lg`}
        />
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              onClick={() => setPct(pct)}
              className="rounded-md border border-edge-2 py-1 text-xs font-medium text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2"
            >
              {pct === 100 ? "Max" : `${pct}%`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2 text-xs">
        <span className="text-ink-3">You receive</span>
        <span className="tnum font-medium text-ink-2">{estimate ?? "-"}</span>
      </div>
      <div className="flex items-center justify-between px-1 text-[11px] text-ink-3">
        <span>Trading fee 3%</span>
        <span>80% of fees go to the creator</span>
      </div>

      {isConnected ? (
        <Button
          variant={side}
          onClick={submit}
          disabled={busy || !parsedAmount || parsedAmount === 0n || Boolean(insufficientFunds)}
          className="py-2.5"
        >
          {busy
            ? "Confirm in wallet"
            : insufficientFunds
              ? "Insufficient balance"
              : side === "buy"
                ? `Buy ${token.symbol}`
                : `Sell ${token.symbol}`}
        </Button>
      ) : (
        <Button onClick={connectFirst} className="py-2.5">
          Connect wallet to trade
        </Button>
      )}
    </div>
  );
}
