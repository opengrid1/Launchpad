import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { appendFileSync } from "node:fs";
import { robinhoodL2, RPC_URL } from "./config.js";

export const publicClient = createPublicClient({
  chain: robinhoodL2,
  transport: http(RPC_URL),
});

/**
 * Resolve the trading wallet. Uses PRIVATE_KEY from env if present; otherwise
 * generates one, persists it to .env (gitignored), and uses that. This keeps
 * keys out of source while giving a frictionless first run.
 */
function resolveAccount() {
  let pk = process.env.PRIVATE_KEY?.trim();
  if (!pk) {
    pk = generatePrivateKey();
    try {
      appendFileSync(new URL("../.env", import.meta.url), `\nPRIVATE_KEY=${pk}\n`);
      console.log("[chain] No PRIVATE_KEY found — generated a new wallet and saved it to .env");
    } catch {
      console.log("[chain] No PRIVATE_KEY found — generated an ephemeral wallet (could not write .env)");
    }
  }
  if (!pk.startsWith("0x")) pk = `0x${pk}`;
  return privateKeyToAccount(pk as `0x${string}`);
}

export const account = resolveAccount();

export const walletClient = createWalletClient({
  account,
  chain: robinhoodL2,
  transport: http(RPC_URL),
});

export const WALLET_ADDRESS: Address = account.address;
