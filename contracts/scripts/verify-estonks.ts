import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Verifies the Estonks mainnet deployment (deployments/ethereum-estonks.json)
 * on Etherscan. Run with the same size-optimized config used for the deploy:
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 \
 *   EXPLORER_API_KEY=... DEPLOYER=0x... npx hardhat run scripts/verify-estonks.ts --network robinhood
 */
async function main() {
  const file = process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "ethereum-estonks.json");
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const c = d.contracts;
  const deployer = process.env.DEPLOYER;
  if (!deployer) throw new Error("DEPLOYER (the address that ran the deploy) is required for the factory's constructor args");

  const targets: Array<{ name: string; address: string; args: unknown[]; file?: string }> = [
    { name: "HookDeployer", address: c.hookDeployer, args: [] },
    { name: "StockPadTokenDeployer", address: c.tokenDeployer, args: [] },
    { name: "StockPadHook", address: c.hook, args: [d.uniswap.poolManager, d.admin] },
    {
      name: "StockPadFactory",
      address: c.factory,
      args: [deployer, d.admin, d.uniswap.poolManager, c.hook, c.tokenDeployer, d.uniswap.weth, d.ethUsd8, d.fees.taxBps, d.fees.creatorBps, d.fees.holderBps],
    },
    { name: "StockPadRouter", address: c.router, args: [d.uniswap.poolManager, c.factory, d.uniswap.weth, d.uniswap.swapRouter02], file: "StockPadRouter.sol" },
  ];
  if (c.distributor) targets.push({ name: "ChipDistributor", address: c.distributor, args: [d.mainToken, d.uniswap.weth, c.router], file: "ChipDistributor.sol" });
  if (d.mainToken) {
    // The coin's constructor args, read back from the chain so the metadata string matches byte for byte.
    const { ethers } = await import("hardhat");
    const t = await ethers.getContractAt("StockPadToken", d.mainToken);
    const f = await ethers.getContractAt("StockPadFactory", c.factory);
    const [name, symbol, uri, creator, pair, pm, cb, hb, supply] = await Promise.all([t.name(), t.symbol(), t.metadataURI(), t.creator(), t.pairAsset(), t.poolManager(), t.creatorBps(), t.holderBps(), f.TOTAL_SUPPLY()]);
    targets.push({ name: "StockPadToken", address: d.mainToken, args: [name, symbol, uri, supply, creator, c.factory, pair, pm, cb, hb], file: "StockPadToken.sol" });
  }

  for (const t of targets) {
    if (!t.address) continue;
    try {
      await run("verify:verify", { address: t.address, constructorArguments: t.args, ...(t.file ? { contract: `contracts/v4/eth/${t.file}:${t.name}` } : {}) });
      console.log("verified", t.name, t.address);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/already verified/i.test(msg)) console.log("already verified", t.name, t.address);
      else console.error("FAILED", t.name, t.address, msg.split("\n")[0]);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
