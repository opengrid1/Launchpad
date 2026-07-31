// Gasless bridge relay: submits Circle Gateway mint attestations to the
// GatewayMinter on Arc from a funded relayer wallet, so first-time bridgers
// with no Arc gas still receive their USDC. The target contract and function
// are fixed; the relayer can spend nothing but gas.
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const GATEWAY_MINTER = "0x2222222d7164433c4C09B0b0D809a9b52C04C205" as const;
const minterAbi = parseAbi(["function gatewayMint(bytes attestationPayload, bytes signature)"]);

const RPC =
  process.env.RPC_UPSTREAM ??
  "https://real-pump-soon-trust-me-bro-again.poptyedev.com/b71fac7173778c3f6a9148c157b8b4f61d275b447b087327";

const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

export default async function handler(req: any, res: any) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) return res.status(503).json({ error: "relayer not configured" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    const { attestation, signature } = body;
    if (!/^0x[0-9a-fA-F]+$/.test(attestation ?? "") || !/^0x[0-9a-fA-F]+$/.test(signature ?? "")) {
      return res.status(400).json({ error: "attestation and signature hex required" });
    }

    const account = privateKeyToAccount(key as `0x${string}`);
    const publicClient = createPublicClient({ chain: arc, transport: http(RPC, { timeout: 20_000 }) });
    const wallet = createWalletClient({ account, chain: arc, transport: http(RPC, { timeout: 20_000 }) });

    // Simulate first so an invalid or replayed attestation costs nothing.
    const { request } = await publicClient.simulateContract({
      account,
      address: GATEWAY_MINTER,
      abi: minterAbi,
      functionName: "gatewayMint",
      args: [attestation, signature],
    });
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    return res.status(200).json({ hash, status: receipt.status });
  } catch (e: any) {
    const msg = String(e?.shortMessage ?? e?.message ?? e).slice(0, 300);
    return res.status(502).json({ error: msg });
  }
}
