import { ethers, network } from "hardhat";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Launch one coin of each token variant from the deployer so both coin
 * bytecodes exist on chain and can be source-verified:
 *
 *   npx hardhat run scripts/launch-onehook-test.ts --network mainnet
 *
 *   - "OneHook Scan A" (OHSA): flat 1% fee, no pots      -> OneToken
 *   - "OneHook Scan B" (OHSB): flat 1% fee, 30% dividends -> OneDivToken
 *
 * Both coins read their name, symbol and metadata back from the token
 * deployer during construction, so their init code is constant: every coin a
 * user launches later has byte-identical creation code and inherits the
 * verification as an Etherscan similar match. No dev buy is sent. The admin
 * can hide the two coins from the listing with factory.setHidden.
 *
 * Appends the coins to deployments/onehook-<network>.json under `testCoins`;
 * then run verify-onehook.ts.
 */

const FLAT = { feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n };

async function main() {
  const [deployer] = await ethers.getSigners();
  const file = join(__dirname, `../deployments/onehook-${network.name}.json`);
  const d = JSON.parse(readFileSync(file, "utf8"));
  const factory = await ethers.getContractAt("OneFactory", d.contracts.factory);
  d.testCoins = d.testCoins ?? [];

  const plans = [
    { name: "OneHook Scan A", symbol: "OHSA", genes: FLAT, dividends: false },
    { name: "OneHook Scan B", symbol: "OHSB", genes: { ...FLAT, divShareBps: 3_000 }, dividends: true },
  ];

  for (const plan of plans) {
    if (d.testCoins.some((t: any) => t.symbol === plan.symbol)) {
      console.log(`${plan.symbol} already launched, skipping`);
      continue;
    }
    const p = { name: plan.name, symbol: plan.symbol, metadataURI: "", pair: ethers.ZeroAddress, minPairOut: 0, genes: plan.genes, stages: [] as any[] };
    const salt = ethers.id(`${plan.symbol}-${Date.now()}`);
    console.log(`launching ${plan.name} (${plan.symbol}) from ${deployer.address} …`);
    const tx = await factory.launch(p, salt, "0x");
    const rc = await tx.wait();
    const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Launched");
    const token = ev!.args.token as string;
    console.log(`  token ${token}  tx ${tx.hash}`);
    d.testCoins.push({ symbol: plan.symbol, token, dividends: plan.dividends, tx: tx.hash });
    writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
  }
  console.log("recorded in", file);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
