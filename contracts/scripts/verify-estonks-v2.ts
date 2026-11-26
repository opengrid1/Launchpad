import { ethers, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Verifies the Estonks v2 deployment (deployments/ethereum-estonks-v2.json)
 * on Etherscan, plus the main coin and distributor when recorded. Run with
 * the size-optimized config used for the deploy:
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 \
 *   EXPLORER_API_KEY=... npx hardhat run scripts/verify-estonks-v2.ts --network robinhood
 */
async function main() {
  const file = process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "ethereum-estonks-v2.json");
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const c = d.contracts;
  const src = (n: string) => `contracts/v4/estonks/${n}.sol:${n}`;

  const targets: Array<{ address: string; args: unknown[]; contract?: string }> = [
    { address: c.hookDeployer, args: [], contract: "contracts/v4/test/HookDeployer.sol:HookDeployer" },
    { address: c.hook, args: [d.uniswap.poolManager], contract: src("EstonksHook") },
    { address: c.tokenDeployer, args: [], contract: src("EstonksTokenDeployer") },
    {
      address: c.factory,
      args: [d.factoryOwner, d.admin, d.uniswap.poolManager, c.hook, c.tokenDeployer, d.uniswap.weth, d.ethUsd8, d.fees.taxBps, d.fees.creatorBps, d.fees.holderBps],
      contract: src("EstonksFactory"),
    },
    { address: c.router, args: [d.uniswap.poolManager, c.factory, d.uniswap.weth, d.uniswap.swapRouter02], contract: src("EstonksRouter") },
  ];
  if (c.distributor) targets.push({ address: c.distributor, args: [d.mainToken, d.uniswap.weth, c.router], contract: src("EstonksDistributor") });
  if (d.mainToken) {
    // The coin's constructor struct, read back from the chain so every string matches byte for byte.
    const t = await ethers.getContractAt("EstonksToken", d.mainToken);
    const f = await ethers.getContractAt("EstonksFactory", c.factory);
    const init = {
      name: await t.name(), symbol: await t.symbol(), metadataURI: await t.metadataURI(), supply: await f.TOTAL_SUPPLY(),
      creator: await t.creator(), factory: c.factory, pairAsset: await t.pairAsset(), poolManager: await t.poolManager(),
      hook: await t.hook(), converter: await t.converter(), creatorBps: await t.creatorBps(), holderBps: await t.holderBps(),
      basket: await t.basketAssets(),
    };
    targets.push({ address: d.mainToken, args: [init], contract: src("EstonksToken") });
  }

  for (const t of targets) {
    if (!t.address) continue;
    try {
      await run("verify:verify", { address: t.address, constructorArguments: t.args, ...(t.contract ? { contract: t.contract } : {}) });
      console.log("verified", t.contract, t.address);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/already verified/i.test(msg)) console.log("already verified", t.contract, t.address);
      else console.error("FAILED", t.contract, t.address, msg.split("\n")[0]);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
