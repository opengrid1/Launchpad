/* eslint-disable no-console */
// Deploys the Estonks private vault: the Groth16 SpendVerifier (from
// circuits/setup.sh) and EstonksVault, linked to the Poseidon libraries already
// on Ethereum at their deterministic addresses. Screens with the Chainalysis
// sanctions oracle and sends the rewards the vault earns to the STONK
// distributor. Records everything in deployments/ethereum-estonks-v2.json.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... \
//   ADMIN=0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b npx hardhat run scripts/deploy-estonks-vault.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const T3 = "0x3333333C0A88F9BE4fd23ed0536F9B6c427e3B93";
const T4 = "0x4443338EF595F44e0121df4C21102677B142ECF0";
const SANCTIONS = "0x40C57923924B5c5c5455c48D93317139ADDaC8fb"; // Chainalysis oracle

async function main() {
  const [deployer] = await ethers.getSigners();
  const depFile = process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "ethereum-estonks-v2.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  const save = () => fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  const admin = ethers.getAddress(process.env.ADMIN ?? dep.admin);
  const bal0 = await ethers.provider.getBalance(deployer.address);
  console.log("deployer", deployer.address, "bal", ethers.formatEther(bal0), "admin", admin);
  for (const [n, a] of [["PoseidonT3", T3], ["PoseidonT4", T4], ["sanctions", SANCTIONS]]) if ((await ethers.provider.getCode(a)) === "0x") throw new Error(`${n} missing at ${a}`);
  if (!dep.contracts.distributor) throw new Error("no STONK distributor recorded");

  if (!dep.contracts.vaultVerifier) {
    const v = await (await ethers.getContractFactory("SpendVerifier")).deploy();
    await v.waitForDeployment();
    dep.contracts.vaultVerifier = await v.getAddress();
    save();
  }
  console.log("verifier", dep.contracts.vaultVerifier);
  if (!dep.contracts.vault) {
    const V = await ethers.getContractFactory("EstonksVault", { libraries: { "poseidon-solidity/PoseidonT3.sol:PoseidonT3": T3, "poseidon-solidity/PoseidonT4.sol:PoseidonT4": T4 } });
    const vault = await V.deploy(dep.contracts.vaultVerifier, dep.contracts.router, dep.contracts.factory, SANCTIONS, dep.contracts.distributor, admin);
    const rc = await vault.deploymentTransaction()!.wait();
    dep.contracts.vault = await vault.getAddress();
    dep.vaultDeployBlock = rc!.blockNumber;
    dep.vault = { poseidonT3: T3, poseidonT4: T4, sanctions: SANCTIONS, feeBps: 50, rewardsRecipient: dep.contracts.distributor, admin };
    save();
  }
  console.log("vault", dep.contracts.vault, "block", dep.vaultDeployBlock);
  const vault = await ethers.getContractAt("EstonksVault", dep.contracts.vault);
  console.log("check: root", (await vault.root()).toString().slice(0, 12) + "…", "| admin", await vault.admin(), "| fee recipient", await vault.feeRecipient());
  console.log("spent", ethers.formatEther(bal0 - (await ethers.provider.getBalance(deployer.address))), "ETH");
}

main().catch((e) => { console.error(e); process.exit(1); });
