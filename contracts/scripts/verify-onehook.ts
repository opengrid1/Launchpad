import hre from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Verify every OneHook v2 contract on Etherscan and Sourcify, from the record
 * deploy-onehook.ts wrote:
 *
 *   npx hardhat run scripts/verify-onehook.ts --network mainnet
 *
 * Covers the HookDeployer, OneHook, OneTokenDeployer, OneFactory, OneRouter,
 * and every coin listed under `testCoins` (see launch-onehook-test.ts). Coins
 * launched by users share constant init code with those test coins, so once
 * one OneToken and one OneDivToken are verified, Etherscan marks every later
 * coin as a similar-match verified contract automatically.
 *
 * Needs ETHERSCAN_API_KEY in contracts/.env (full hardhat.config.ts).
 */

const ONEHOOK = "contracts/v4/onehook";

async function verify(label: string, address: string, contract: string, constructorArguments: unknown[]) {
  console.log(`\n== ${label}: ${address}`);
  try {
    await hre.run("verify:verify", { address, contract, constructorArguments });
    console.log("   etherscan: ok");
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.log(/already verified/i.test(msg) ? "   etherscan: already verified" : `   etherscan: FAILED ${msg.split("\n")[0]}`);
  }
  try {
    await hre.run("verify:sourcify", { address, contract });
    console.log("   sourcify: ok");
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.log(/already verified/i.test(msg) ? "   sourcify: already verified" : `   sourcify: FAILED ${msg.split("\n")[0]}`);
  }
}

async function main() {
  const file = join(__dirname, `../deployments/onehook-${hre.network.name}.json`);
  const d = JSON.parse(readFileSync(file, "utf8"));
  const c = d.contracts;

  await verify("HookDeployer", c.hookDeployer, "contracts/v4/test/HookDeployer.sol:HookDeployer", []);
  await verify("OneHook", c.hook, `${ONEHOOK}/OneHook.sol:OneHook`, [c.poolManager, c.weth]);
  await verify("OneTokenDeployer", c.tokenDeployer, `${ONEHOOK}/OneTokenDeployer.sol:OneTokenDeployer`, []);
  await verify("OneFactory", c.factory, `${ONEHOOK}/OneFactory.sol:OneFactory`, [
    d.deployer, d.admin, c.poolManager, c.hook, c.tokenDeployer, c.weth, c.oracle, d.feeRecipient,
  ]);
  await verify("OneRouter", c.router, `${ONEHOOK}/OneRouter.sol:OneRouter`, [c.poolManager, c.factory, c.weth]);

  for (const t of d.testCoins ?? []) {
    const contract = t.dividends ? `${ONEHOOK}/OneDivToken.sol:OneDivToken` : `${ONEHOOK}/OneToken.sol:OneToken`;
    await verify(`${t.dividends ? "OneDivToken" : "OneToken"} (${t.symbol})`, t.token, contract, []);
  }
  if (!(d.testCoins ?? []).length) {
    console.log("\nNo test coins recorded yet. Run launch-onehook-test.ts, then re-run this script so every future coin inherits a similar-match verification.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
