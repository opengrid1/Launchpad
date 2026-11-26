import { ethers, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Check the Jeet Wars wiring on BNB Chain and verify the sources on BscScan.
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://bsc-dataseed.bnbchain.org ROBINHOOD_CHAIN_ID=56 \
 *   EXPLORER_API_KEY=... npx hardhat run scripts/verify-jeetwars.ts --network robinhood
 */
async function main() {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "bsc-jeetwars.json"), "utf8"));
  const C = d.contracts;
  const arena = await ethers.getContractAt("JeetWarsArena", C.arena);
  const hook = await ethers.getContractAt("JeetWarsHook", C.hook);
  const redeemer = await ethers.getContractAt("JeetWarsRedeemer", C.redeemer);
  const td = await ethers.getContractAt("JeetWarsTokenDeployer", C.tokenDeployer);
  const checks: [string, boolean][] = [
    ["hook.arena", (await hook.arena()) === C.arena],
    ["redeemer.arena", (await redeemer.arena()) === C.arena],
    ["tokenDeployer.arena", (await td.arena()) === C.arena],
    ["arena.converter", (await arena.converter()) === C.router],
    ["arena.admin", (await arena.admin()).toLowerCase() === d.admin.toLowerCase()],
    ["arena.feeRecipient", (await arena.feeRecipient()).toLowerCase() === d.admin.toLowerCase()],
    ["arena.armies", (await arena.armies()).length === d.armies.length],
    ["arena.genesis", Number(await arena.genesis()) === d.genesis],
  ];
  for (const [k, ok] of checks) console.log(ok ? "ok  " : "FAIL", k);
  if (checks.some(([, ok]) => !ok)) throw new Error("wiring check failed");

  const config = {
    owner: d.owner, admin: d.admin, vault: d.infinity.vault, poolManager: d.infinity.clPoolManager, hook: C.hook,
    tokenDeployer: C.tokenDeployer, redeemer: C.redeemer, genesis: d.genesis, startTick: d.startTick,
    bstockCodehash: await arena.bstockCodehash(), tip: d.tipWei,
  };
  const jobs: [string, string, any[]][] = [
    ["JeetWarsHook", C.hook, [d.infinity.vault, d.infinity.clPoolManager]],
    ["JeetWarsRedeemer", C.redeemer, []],
    ["JeetWarsTokenDeployer", C.tokenDeployer, []],
    ["JeetWarsArena", C.arena, [config]],
    ["JeetWarsRouter", C.router, [d.infinity.vault, d.infinity.clPoolManager, C.arena, d.infinity.wbnb, d.infinity.v3SmartRouter]],
  ];
  for (const [name, address, constructorArguments] of jobs) {
    try {
      await run("verify:verify", { address, constructorArguments, contract: `contracts/jeetwars/${name}.sol:${name}` });
      console.log("verified", name);
    } catch (e: any) {
      const m = String(e.message ?? e);
      console.log(/already verified/i.test(m) ? `already verified ${name}` : `verify failed ${name}: ${m.split("\n")[0]}`);
    }
  }
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
