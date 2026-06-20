import "dotenv/config";
import { defineChain } from "viem";

/**
 * Robinhood L2 — Arbitrum-Nitro chain, native symbol ETH.
 * Verified live via eth_chainId (0x1237 = 4663) and web3_clientVersion (nitro).
 */
export const RPC_URL = process.env.RPC_URL || "https://poptye-always-win.poptyedev.com/";
export const EXPLORER_URL = "https://so-explorer.poptyedev.com";
export const EXPLORER_API = `${EXPLORER_URL}/api/v2`;

export const robinhoodL2 = defineChain({
  id: 4663,
  name: "Robinhood L2",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "RobinScan", url: EXPLORER_URL } },
});

/** Uniswap-V3-fork DEX contracts (verified on-chain — see README). */
export const ADDRESSES = {
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  swapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
} as const;

/** $MARIAN — "ye first meme of Robinhood Chain". Used as the default token. */
export const DEFAULT_TOKEN = "0x01637b14B7378B99dE75A64d50656d98488D9a4d";

/** V3 fee tiers to probe when locating a token's WETH pool. */
export const FEE_TIERS = [10000, 3000, 500, 100] as const;

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  allowedIds: (process.env.TELEGRAM_ALLOWED_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
  slippageBps: BigInt(process.env.SLIPPAGE_BPS || "500"),
};
