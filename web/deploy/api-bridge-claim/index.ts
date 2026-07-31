// Relayer-driven Gateway bridge: users send USDC on Base to the relayer
// address; this endpoint verifies the deposit, forwards it into Circle's
// GatewayWallet (so the relayer's unified balance backs the bridge), then
// mints native USDC on Arc to the ORIGINAL SENDER via a Circle-attested burn
// intent, minus the 1% bridge fee. The intent's salt is derived from the Base
// tx hash, so each deposit can mint exactly once; while Circle's Arc flag is
// off (or finality is pending) claims queue and complete on a later retry.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  pad,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RELAYER_DEPOSIT: Address = "0xe5b498a00596ab2fa0e8a86cdde15502b2552208";
const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const GATEWAY_WALLET: Address = "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE";
const GATEWAY_MINTER: Address = "0x2222222d7164433c4C09B0b0D809a9b52C04C205";
const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
const ARC_DOMAIN = 26;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const FEE_BPS = 100n; // 1% bridge fee, kept in the relayer's Gateway balance
const CIRCLE_MAX_FEE = 10_000n; // 0.01 USDC cap on Circle's own transfer fee
const MIN_CONFIRMATIONS = 10n;
const MAX_USDC_RAW = BigInt(Number(process.env.BRIDGE_MAX_USDC ?? 500)) * 1_000_000n;
const GATEWAY_API = "https://gateway-api.circle.com";

const ARC_RPC =
  process.env.RPC_UPSTREAM ??
  "https://real-pump-soon-trust-me-bro-again.poptyedev.com/b71fac7173778c3f6a9148c157b8b4f61d275b447b087327";

const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);
const walletAbi = parseAbi(["function deposit(address token, uint256 amount)"]);
const minterAbi = parseAbi(["function gatewayMint(bytes attestationPayload, bytes signature)"]);

const EIP712_DOMAIN = { name: "GatewayWallet", version: "1" } as const;
const EIP712_TYPES = {
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
} as const;

const queued = (res: any, note: string) =>
  res.status(202).json({
    queued: true,
    message: `Deposit received and secured with Circle. ${note} Re-claim with the same tx hash later to finish the payout.`,
  });

export default async function handler(req: any, res: any) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) return res.status(503).json({ error: "bridge relay not configured yet" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    const txHash = String(body.txHash ?? "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return res.status(400).json({ error: "txHash required" });

    // 1. Verify the user's USDC deposit to the relayer on Base.
    const basePub = createPublicClient({ chain: base, transport: http("https://mainnet.base.org", { timeout: 20_000 }) });
    const receipt = await basePub.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null);
    if (!receipt || receipt.status !== "success") return res.status(400).json({ error: "Base transaction not found or failed" });
    const head = await basePub.getBlockNumber();
    if (head - receipt.blockNumber < MIN_CONFIRMATIONS) {
      return res.status(425).json({ error: "Waiting for confirmations on Base; retry in a minute" });
    }
    const transfer = receipt.logs.find(
      (l) =>
        l.address.toLowerCase() === BASE_USDC.toLowerCase() &&
        l.topics[0] === TRANSFER_TOPIC &&
        l.topics[2] &&
        `0x${l.topics[2].slice(26)}`.toLowerCase() === RELAYER_DEPOSIT.toLowerCase(),
    );
    if (!transfer) return res.status(400).json({ error: "No USDC transfer to the bridge address in that transaction" });
    const sender = `0x${transfer.topics[1]!.slice(26)}` as Address;
    const amountRaw = BigInt(transfer.data);
    if (amountRaw === 0n) return res.status(400).json({ error: "Zero amount" });
    if (amountRaw > MAX_USDC_RAW) return res.status(400).json({ error: `Amount exceeds the ${Number(MAX_USDC_RAW / 1_000_000n)} USDC per-transaction cap` });

    const account = privateKeyToAccount(key as Hex);
    const baseWallet = createWalletClient({ account, chain: base, transport: http("https://mainnet.base.org", { timeout: 20_000 }) });

    // 2. Forward everything sitting on the relayer into Circle's GatewayWallet.
    const relayerUsdc = (await basePub.readContract({
      address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    })) as bigint;
    if (relayerUsdc > 0n) {
      const allowance = (await basePub.readContract({
        address: BASE_USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, GATEWAY_WALLET],
      })) as bigint;
      if (allowance < relayerUsdc) {
        const a = await baseWallet.writeContract({
          address: BASE_USDC, abi: erc20Abi, functionName: "approve",
          args: [GATEWAY_WALLET, 2n ** 200n], chain: base, account,
        });
        await basePub.waitForTransactionReceipt({ hash: a });
      }
      // Public RPCs are load balanced; a lagging replica may not see the fresh
      // approval yet, failing gas estimation. Retry briefly instead of erroring.
      let deposited = false;
      let lastErr: unknown;
      for (let i = 0; i < 4 && !deposited; i++) {
        try {
          const d = await baseWallet.writeContract({
            address: GATEWAY_WALLET, abi: walletAbi, functionName: "deposit",
            args: [BASE_USDC, relayerUsdc], chain: base, account,
          });
          await basePub.waitForTransactionReceipt({ hash: d });
          deposited = true;
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 2_500));
        }
      }
      if (!deposited) throw lastErr;
    }

    // 3. Mint leg: pay the original sender on Arc from the relayer's unified
    //    balance. Deterministic salt = one mint per deposit, enforced by Circle.
    const info = await (await fetch(`${GATEWAY_API}/v1/info`)).json();
    const domains: any[] = info.domains ?? [];
    if (!domains.some((d) => d.domain === ARC_DOMAIN)) {
      return queued(res, "Arc minting is not yet enabled by Circle.");
    }
    const src = domains.find((d) => d.domain === 6);
    if (!src) return queued(res, "Base is temporarily unavailable on Circle Gateway.");

    const net = amountRaw - (amountRaw * FEE_BPS) / 10_000n;
    const asB32 = (a: Address) => pad(a, { size: 32 });
    const buildAndSign = async (height: string) => {
      const intent = {
        maxBlockHeight: BigInt(height) + 5_000n,
        maxFee: CIRCLE_MAX_FEE,
        spec: {
          version: 1,
          sourceDomain: 6,
          destinationDomain: ARC_DOMAIN,
          sourceContract: asB32(GATEWAY_WALLET),
          destinationContract: asB32(GATEWAY_MINTER),
          sourceToken: asB32(BASE_USDC),
          destinationToken: asB32(ARC_USDC),
          sourceDepositor: asB32(account.address),
          destinationRecipient: asB32(sender),
          sourceSigner: asB32(account.address),
          destinationCaller: asB32(zeroAddress),
          value: net,
          salt: keccak256(txHash as Hex),
          hookData: "0x" as Hex,
        },
      };
      const signature = await account.signTypedData({
        domain: EIP712_DOMAIN, types: EIP712_TYPES as any, primaryType: "BurnIntent", message: intent as any,
      });
      const r = await fetch(`${GATEWAY_API}/v1/transfer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ burnIntent: { maxBlockHeight: intent.maxBlockHeight.toString(), maxFee: CIRCLE_MAX_FEE.toString(), spec: { ...intent.spec, value: net.toString() } }, signature }]),
      });
      const text = await r.text();
      const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();
      if (!r.ok) throw new Error(parsed?.message || parsed?.error || text.slice(0, 200));
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!first?.attestation || !first?.signature) throw new Error("Transfer response missing attestation");
      return first as { attestation: Hex; signature: Hex };
    };

    let att;
    try {
      att = await buildAndSign(src.burnIntentExpirationHeight);
    } catch (e: any) {
      const m = /expected at least (\d+)/i.exec(String(e?.message ?? e));
      if (m) att = await buildAndSign(m[1]);
      else if (/insufficient|balance/i.test(String(e?.message ?? e))) {
        return queued(res, "The forwarded deposit is still finalizing on Base (about 20 minutes).");
      } else throw e;
    }

    // 4. Submit the mint on Arc.
    try {
      const arcPub = createPublicClient({ chain: arc, transport: http(ARC_RPC, { timeout: 20_000 }) });
      const arcWallet = createWalletClient({ account, chain: arc, transport: http(ARC_RPC, { timeout: 20_000 }) });
      const { request } = await arcPub.simulateContract({
        account, address: GATEWAY_MINTER, abi: minterAbi, functionName: "gatewayMint",
        args: [att.attestation, att.signature],
      });
      const hash = await arcWallet.writeContract(request);
      const rc = await arcPub.waitForTransactionReceipt({ hash, timeout: 60_000 });
      return res.status(200).json({ hash, status: rc.status, to: sender, amountUsdc: Number(net) / 1e6 });
    } catch {
      return queued(res, "The Arc network is unreachable right now; the mint attestation is ready.");
    }
  } catch (e: any) {
    const msg = String(e?.shortMessage ?? e?.message ?? e).slice(0, 300);
    return res.status(502).json({ error: msg });
  }
}
