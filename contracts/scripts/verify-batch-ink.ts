import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Verifies the Batch deployment (deployments/ink-batch.json) on the Ink
 * explorer (Blockscout). Run with the size-optimized config used to deploy:
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com ROBINHOOD_CHAIN_ID=57073 \
 *   EXPLORER_API_URL=https://explorer.inkonchain.com/api EXPLORER_BROWSER_URL=https://explorer.inkonchain.com \
 *   npx hardhat run scripts/verify-batch-ink.ts --network robinhood
 */
async function main() {
  const file = process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "ink-batch.json");
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const c = d.contracts;
  const src = (n: string) => `contracts/v4/batch/${n}.sol:${n}`;
  const targets: Array<{ address: string; args: unknown[]; contract: string }> = [
    { address: c.hookDeployer, args: [], contract: "contracts/v4/test/HookDeployer.sol:HookDeployer" },
    { address: c.hook, args: [d.uniswap.poolManager], contract: src("BatchHook") },
    { address: c.tokenDeployer, args: [], contract: src("BatchTokenDeployer") },
    { address: c.factory, args: [d.factoryOwner, d.admin, d.uniswap.poolManager, c.hook, c.tokenDeployer, d.uniswap.weth, d.ethUsd8, d.fees.taxBps, d.fees.creatorBps, d.fees.holderBps, c.treasury], contract: src("BatchFactory") },
    { address: c.ledger, args: [c.hook, d.uniswap.weth], contract: src("BatchLedger") },
    { address: c.router, args: [d.uniswap.poolManager, c.factory, d.uniswap.weth, d.uniswap.swapRouter02], contract: src("BatchRouter") },
    { address: c.payout, args: [d.uniswap.weth, d.admin, c.ledger], contract: src("BatchPayout") },
    { address: c.treasury, args: [d.uniswap.weth, d.admin, c.payout], contract: src("BatchTreasury") },
  ];
  for (const t of targets) {
    if (!t.address) continue;
    try {
      await run("verify:verify", { address: t.address, constructorArguments: t.args, contract: t.contract });
      console.log("verified", t.contract, t.address);
    } catch (e: any) {
      console.log("skip", t.contract, t.address, (e.message ?? String(e)).split("\n")[0].slice(0, 160));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
