/* eslint-disable no-console */
// Claims a coin's creator fees to the deployer (its creator) and forwards the claimed ETH to the admin wallet.
//   TOKEN=0x.. npx hardhat --config hardhat.config.cntrlz.ts run scripts/claim-cntrlz.ts --network mainnet
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "eth-cntrlz.json"), "utf8"));
  const [me] = await ethers.getSigners();
  const hook = await ethers.getContractAt("CtrlzHook", dep.contracts.hook);
  const token = process.env.TOKEN!;
  const to = process.env.TO ?? dep.admin;
  const fee = async () => { const base = (await ethers.provider.getBlock("latest"))!.baseFeePerGas ?? 0n; const tip = ethers.parseUnits("0.05", "gwei"); return { maxPriorityFeePerGas: tip, maxFeePerGas: (base * 115n) / 100n + tip }; };
  const owed = await hook.creatorOwed(token);
  console.log("creator owed", ethers.formatEther(owed), "ETH; deployer balance", ethers.formatEther(await ethers.provider.getBalance(me.address)), "ETH");
  if (owed === 0n) return;
  const before = await ethers.provider.getBalance(me.address);
  const tx = await hook.payCreator(token, await fee());
  const rc = await tx.wait();
  const after = await ethers.provider.getBalance(me.address);
  console.log("claimed", tx.hash, "gas", ethers.formatEther(rc!.gasUsed * rc!.gasPrice), "ETH; balance now", ethers.formatEther(after), "ETH");
  const got = after - before + rc!.gasUsed * rc!.gasPrice;
  if (got <= 0n) throw new Error("nothing received");
  const tx2 = await me.sendTransaction({ to, value: got, ...(await fee()) });
  const rc2 = await tx2.wait();
  console.log("sent", ethers.formatEther(got), "ETH to", to, tx2.hash, "gas", ethers.formatEther(rc2!.gasUsed * rc2!.gasPrice), "ETH");
  console.log("deployer left", ethers.formatEther(await ethers.provider.getBalance(me.address)), "ETH; admin", ethers.formatEther(await ethers.provider.getBalance(to)), "ETH");
}
main().catch((e) => { console.error(e); process.exit(1); });
