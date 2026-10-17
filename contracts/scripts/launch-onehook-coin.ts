import { ethers, network } from "hardhat";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Launch one OneHook coin from the deployer, from a JSON spec:
 *
 *   COIN_SPEC=path/to/coin.json npx hardhat run scripts/launch-onehook-coin.ts --network mainnet
 *
 * Spec: { name, symbol, metadataURI, genes: {...}, stages: [{ mcapUsd8, genes }] }
 * (genes fields: feeMode, feeBps, snipeBps, snipeBlocks, buybackShareBps,
 * divShareBps, maxWalletBps, maxWalletSecs, buybackThreshold). No dev buy.
 * The coin is appended to deployments/onehook-<network>.json under testCoins.
 */
async function main() {
  const specPath = process.env.COIN_SPEC;
  if (!specPath) throw new Error("COIN_SPEC is required");
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const [deployer] = await ethers.getSigners();
  const file = join(__dirname, `../deployments/onehook-${network.name}.json`);
  const d = JSON.parse(readFileSync(file, "utf8"));
  const factory = await ethers.getContractAt("OneFactory", d.contracts.factory);
  d.testCoins = d.testCoins ?? [];
  if (d.testCoins.some((t: any) => t.symbol === spec.symbol)) { console.log(`${spec.symbol} already launched on this factory, skipping`); return; }

  const p = { name: spec.name, symbol: spec.symbol, metadataURI: spec.metadataURI ?? "", pair: ethers.ZeroAddress, minPairOut: 0, genes: spec.genes, stages: spec.stages ?? [] };
  const salt = ethers.id(`${spec.symbol}-${Date.now()}`);
  console.log(`launching ${spec.name} (${spec.symbol}) from ${deployer.address} on factory ${d.contracts.factory} …`);
  const tx = await factory.launch(p, salt, "0x");
  const rc = await tx.wait();
  const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Launched");
  const token = ev!.args.token as string;
  const dividends = spec.genes.divShareBps > 0 || (spec.stages ?? []).some((s: any) => s.genes.divShareBps > 0);
  console.log(`  token ${token}  tx ${tx.hash}  variant ${dividends ? "OneDivToken" : "OneToken"}`);
  d.testCoins.push({ symbol: spec.symbol, token, dividends, tx: tx.hash });
  writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
  console.log("recorded in", file);
}

main().catch((e) => { console.error(e); process.exit(1); });
