import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/** Verifies the private vault and its SpendVerifier on Etherscan (deployments/ethereum-estonks-v2.json). */
async function main() {
  const d = JSON.parse(fs.readFileSync(process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "ethereum-estonks-v2.json"), "utf8"));
  const c = d.contracts, v = d.vault;
  const targets = [
    { address: c.vaultVerifier, constructorArguments: [], contract: "contracts/v4/estonks/private/SpendVerifier.sol:SpendVerifier" },
    {
      address: c.vault, contract: "contracts/v4/estonks/private/EstonksVault.sol:EstonksVault",
      constructorArguments: [c.vaultVerifier, c.router, c.factory, v.sanctions, v.rewardsRecipient, v.admin],
      libraries: { "poseidon-solidity/PoseidonT3.sol:PoseidonT3": v.poseidonT3, "poseidon-solidity/PoseidonT4.sol:PoseidonT4": v.poseidonT4 },
    },
  ];
  for (const t of targets) {
    try { await run("verify:verify", t); console.log("verified", t.contract, t.address); }
    catch (e: any) { const m = String(e?.message ?? e); console.log(/already verified/i.test(m) ? "already verified" : "FAILED", t.contract, m.split("\n")[0]); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
