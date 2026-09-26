import { setupWalletSelector, type WalletSelector, type Action } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { useEffect, useState } from "react";

import { DEMO, env } from "./env";
import { friendlyError, setToast } from "./hooks";

let selector: WalletSelector | null = null;
let modal: WalletSelectorModal | null = null;
let accountId: string | null = null;
const subs = new Set<(a: string | null) => void>();

async function init(): Promise<WalletSelector | null> {
  if (DEMO || !env.factory) return null;
  if (selector) return selector;
  selector = await setupWalletSelector({
    network: env.network,
    modules: [setupMyNearWallet(), setupMeteorWallet(), setupHereWallet()],
  });
  modal = setupModal(selector, { contractId: env.factory, description: "Connect to launch, trade and claim." });
  const sync = () => {
    const s = selector!.store.getState();
    accountId = s.accounts.find((a) => a.active)?.accountId ?? s.accounts[0]?.accountId ?? null;
    subs.forEach((f) => f(accountId));
  };
  selector.store.observable.subscribe(sync);
  sync();
  return selector;
}

export function useAccount(): { accountId: string | null; ready: boolean } {
  const [a, setA] = useState<string | null>(accountId);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    subs.add(setA);
    init().then(() => { setA(accountId); setReady(true); });
    return () => { subs.delete(setA); };
  }, []);
  return { accountId: DEMO ? "you.near" : a, ready: DEMO || ready };
}

export async function openWalletModal() {
  if (DEMO) return setToast({ kind: "err", text: "This is a preview with sample data. Wallets connect on the live site." });
  await init();
  modal?.show();
}

export async function signOut() {
  const s = await init();
  if (!s) return;
  const w = await s.wallet();
  await w.signOut();
}

export type Call = { receiverId: string; methodName: string; args?: Record<string, unknown>; gas?: string; deposit?: string };

const TGAS = (n: number) => (BigInt(n) * 1_000_000_000_000n).toString();

/** Sends one or more function calls, each its own transaction, with one wallet approval. */
export async function send(label: string, calls: Call[], after?: () => Promise<void> | void): Promise<{ hash?: string } | false> {
  if (DEMO) { setToast({ kind: "err", text: "Preview only. Nothing is sent." }); return false; }
  const s = await init();
  if (!s || !accountId) { await openWalletModal(); return false; }
  const w = await s.wallet();
  setToast({ kind: "busy", text: `${label}…` }, 60_000);
  try {
    const txs = calls.map((c) => ({
      signerId: accountId!,
      receiverId: c.receiverId,
      actions: [{ type: "FunctionCall", params: { methodName: c.methodName, args: c.args ?? {}, gas: c.gas ?? TGAS(100), deposit: c.deposit ?? "0" } } as unknown as Action],
    }));
    const res = txs.length === 1 ? await w.signAndSendTransaction(txs[0]) : await w.signAndSendTransactions({ transactions: txs });
    const last = Array.isArray(res) ? res[res.length - 1] : res;
    const hash = (last as { transaction?: { hash?: string } } | undefined)?.transaction?.hash;
    await after?.();
    setToast({ kind: "ok", text: `${label}: done`, hash });
    return { hash };
  } catch (e) {
    setToast({ kind: "err", text: friendlyError(e) });
    return false;
  }
}
