// Estonks private relay (Vercel serverless function).
// Submits private-vault spends from the relay wallet so no user wallet is linked
// to them. It only ever sends what the proof already fixes: the spend is
// simulated first (an invalid proof costs nothing), and it is sent only when
// the relayer fee bound into the proof covers the gas.
//
// Env: RELAYER_KEY (hex private key, funded with ETH), VAULT, RPC_URL.
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const VAULT = process.env.VAULT;
const RPC = process.env.RPC_URL || "https://ethereum-rpc.publicnode.com";
const FACTORY = "0x462cC9885188FE0f08597C9Df407f62E86c6D345";
const STATE_VIEW = "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const ETH = "0x0000000000000000000000000000000000000000";
// Gas the relay charges for, per kind (a little above measured use).
const UNITS = { 0: 1_400_000n, 1: 1_400_000n, 2: 2_000_000n, 3: 2_000_000n };
const MARGIN = 110n; // % of the live cost the fee must cover

const vaultAbi = parseAbi([
  "struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }",
  "struct Pub { uint256 root; uint256[2] nullifier; uint256[2] outCommitment; uint256 partialOut; uint256 asset; uint256 publicOut; }",
  "struct Ext { uint8 kind; address recipient; address relayer; uint256 relayerFee; address coin; bytes route; uint256 minOut; }",
  "function spend(Proof proof, Pub pub, Ext ext, bytes[3] encrypted)",
]);
const factoryAbi = parseAbi([
  "function listings(address) view returns (address creator, address pair, uint16 taxBps, uint64 createdAt, bytes32 poolId)",
  "function pairUsdPrice(address) view returns (uint256)",
]);
const stateViewAbi = parseAbi(["function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);

const account = process.env.RELAYER_KEY ? privateKeyToAccount(process.env.RELAYER_KEY) : null;
const pc = createPublicClient({ chain: mainnet, transport: http(RPC) });
const wc = account ? createWalletClient({ account, chain: mainnet, transport: http(RPC) }) : null;

const big = (v) => BigInt(v);
const reply = (res, code, body) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v))); };

/** Value of `amount` of an Estonks coin in ETH wei, from its pool price. */
async function coinInEth(coin, amount) {
  const [, pair, , , poolId] = await pc.readContract({ address: FACTORY, abi: factoryAbi, functionName: "listings", args: [coin] });
  const [sqrtP] = await pc.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [poolId] });
  const Q = 2n ** 96n;
  const coinIs0 = BigInt(coin) < BigInt(pair);
  const pairAmount = coinIs0 ? (amount * sqrtP * sqrtP) / (Q * Q) : (amount * Q * Q) / (sqrtP * sqrtP);
  if (pair.toLowerCase() === WETH) return pairAmount;
  const [pu, eu] = await Promise.all([pair, WETH].map((a) => pc.readContract({ address: FACTORY, abi: factoryAbi, functionName: "pairUsdPrice", args: [a] })));
  return (pairAmount * pu) / eu;
}

async function readBody(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export default async function handler(req, res) {
  try {
    if (!account || !VAULT) return reply(res, 503, { error: "relay_offline", reason: "The relay is not set up yet." });
    const gasPrice = await pc.getGasPrice();
    if (req.method === "GET") {
      const balance = await pc.getBalance({ address: account.address });
      return reply(res, 200, { relayer: account.address, gasPrice, units: UNITS, margin: MARGIN, online: balance > gasPrice * 2_000_000n });
    }
    if (req.method !== "POST") return reply(res, 405, { error: "method" });
    const b = await readBody(req);
    const ext = { ...b.ext, kind: Number(b.ext.kind), relayerFee: big(b.ext.relayerFee), minOut: big(b.ext.minOut) };
    const pub = { root: big(b.pub.root), nullifier: b.pub.nullifier.map(big), outCommitment: b.pub.outCommitment.map(big), partialOut: big(b.pub.partialOut), asset: big(b.pub.asset), publicOut: big(b.pub.publicOut) };
    const proof = { a: b.proof.a.map(big), b: b.proof.b.map((r) => r.map(big)), c: b.proof.c.map(big) };
    if (String(ext.relayer).toLowerCase() !== account.address.toLowerCase()) return reply(res, 400, { error: "relayer", reason: "The spend does not pay this relay." });

    const args = [proof, pub, ext, b.encrypted];
    let gas;
    try {
      gas = await pc.estimateContractGas({ address: VAULT, abi: vaultAbi, functionName: "spend", args, account: account.address });
    } catch (e) {
      return reply(res, 400, { error: "rejected", reason: String(e.shortMessage || e.message || e).split("\n")[0] });
    }
    // Fee check: ETH for trades and ETH spends, the coin's ETH value otherwise.
    const cost = (gas * gasPrice * MARGIN) / 100n;
    const coinFee = ext.kind < 2 && pub.asset !== 0n;
    const feeEth = coinFee ? await coinInEth(`0x${pub.asset.toString(16).padStart(40, "0")}`, ext.relayerFee) : ext.relayerFee;
    if (feeEth < cost) return reply(res, 400, { error: "fee", reason: "The relay fee no longer covers gas. Try again.", need: cost });

    const hash = await wc.writeContract({ address: VAULT, abi: vaultAbi, functionName: "spend", args, gas: (gas * 12n) / 10n });
    return reply(res, 200, { hash });
  } catch (e) {
    return reply(res, 500, { error: "internal", reason: String(e.shortMessage || e.message || e).split("\n")[0] });
  }
}

