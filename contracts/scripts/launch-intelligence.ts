/* One-off: launch the "Intelligence" coin on the live OneHook factory (Ethereum mainnet),
   with a 3-stage evolution path. Reads the deployer key from .env.onehook-deployer.
     npx hardhat --config hardhat.config.onehook.ts run scripts/launch-intelligence.ts --network mainnet */
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const E = ethers.parseEther;
const G = (o: any = {}) => ({ feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n, ...o });
const S = (usd: number, o: any = {}) => ({ mcapUsd8: BigInt(usd) * 10n ** 8n, genes: G(o) });

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "eth-onehook.json"), "utf8"));
  const [me] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(me.address);
  console.log("network", network.name, "sender", me.address, "balance", ethers.formatEther(bal), "ETH");
  const factory = await ethers.getContractAt("OneFactory", dep.contracts.factory, me);

  const params = {
    name: "Intelligence",
    symbol: "INTEL",
    metadataURI: JSON.stringify({ description: "Intelligence — a memecoin that evolves on OneHook: boots guarded, turns on reflexive buyback, then goes autonomous with ETH dividends.", image: "" }),
    pair: ethers.ZeroAddress, // -> WETH
    minPairOut: 0,
    genes: G({ feeMode: 0, feeBps: 200 }),
    stages: [
      S(10_000, { feeBps: 150, buybackShareBps: 2000, buybackThreshold: E("0.01") }),
      S(50_000, { feeBps: 100, buybackShareBps: 2000, buybackThreshold: E("0.01"), divShareBps: 3000 }),
    ],
  };

  const base = (await ethers.provider.getBlock("latest"))!.baseFeePerGas ?? 0n;
  const tip = ethers.parseUnits("0.05", "gwei");
  const fee = { maxPriorityFeePerGas: tip, maxFeePerGas: (base * 115n) / 100n + tip };

  // find a salt whose CREATE2 coin address sorts below WETH (factory requires token < pair)
  let salt = "", gas = 0n;
  for (let i = 0; i < 40; i++) {
    const s = ethers.hexlify(ethers.randomBytes(32));
    try { gas = await factory.launch.estimateGas(params, s, "0x", { value: 0n }); salt = s; break; }
    catch (e: any) { const m = String(e?.shortMessage || e?.message || e); if (/InvalidParams|token|sort|0x/i.test(m) && i < 39) continue; if (i >= 39) throw e; }
  }
  if (!salt) throw new Error("no valid salt found");
  console.log("estimated gas", gas.toString(), "salt", salt);

  const tx = await factory.launch(params, salt, "0x", { value: 0n, gasLimit: (gas * 12n) / 10n, ...fee });
  console.log("launch tx", tx.hash);
  const rc = await tx.wait();
  let token: string | null = null, poolId: string | null = null;
  for (const l of rc!.logs) {
    try { const d = factory.interface.parseLog(l as any); if (d && d.name === "Launched") { token = d.args.token; poolId = d.args.poolId; } } catch {}
  }
  console.log("\n  Intelligence (INTEL) launched");
  console.log("  token  ", token);
  console.log("  poolId ", poolId);
  console.log("  gasUsed", rc!.gasUsed.toString());
  console.log("  etherscan https://etherscan.io/address/" + token);
  console.log("  onehook   https://onehook.vercel.app/token/" + token);
}

main().catch((e) => { console.error(e); process.exit(1); });
