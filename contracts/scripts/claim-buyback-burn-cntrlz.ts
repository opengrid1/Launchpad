/* eslint-disable no-console */
// Claims a coin's creator fees to the deployer (its creator), buys the coin back with all of it (plain buy, no window)
// and burns what was bought:  TOKEN=0x.. npx hardhat --config hardhat.config.cntrlz.ts run scripts/claim-buyback-burn-cntrlz.ts --network mainnet
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "eth-cntrlz.json"), "utf8"));
  const [me] = await ethers.getSigners();
  const token = process.env.TOKEN!;
  const hook = await ethers.getContractAt("CtrlzHook", dep.contracts.hook);
  const router = await ethers.getContractAt("CtrlzRouter", dep.contracts.router);
  const coin = await ethers.getContractAt("CtrlzToken", token);
  const fee = async () => { const base = (await ethers.provider.getBlock("latest"))!.baseFeePerGas ?? 0n; const tip = ethers.parseUnits("0.05", "gwei"); return { maxPriorityFeePerGas: tip, maxFeePerGas: (base * 115n) / 100n + tip }; };
  const gasOf = (rc: any) => rc.gasUsed * rc.gasPrice;
  const owed = await hook.creatorOwed(token);
  console.log("creator owed", ethers.formatEther(owed), "ETH; deployer", ethers.formatEther(await ethers.provider.getBalance(me.address)), "ETH");
  if (owed === 0n) return;
  const r1 = await (await hook.payCreator(token, await fee())).wait();
  console.log("claimed", r1!.hash, "gas", ethers.formatEther(gasOf(r1)));
  const quote = await router.buy.staticCall(token, "0x", 0, { value: owed });
  const before = await coin.balanceOf(me.address);
  const r2 = await (await router.buy(token, "0x", (quote * 97n) / 100n, { value: owed, ...(await fee()) })).wait();
  const got = (await coin.balanceOf(me.address)) - before;
  console.log("bought", ethers.formatEther(got), "coins with", ethers.formatEther(owed), "ETH", r2!.hash, "gas", ethers.formatEther(gasOf(r2)));
  const supplyBefore = await coin.totalSupply();
  const r3 = await (await coin.burn(got, await fee())).wait();
  const supplyAfter = await coin.totalSupply();
  console.log("burned", ethers.formatEther(got), "coins", r3!.hash, "gas", ethers.formatEther(gasOf(r3)), "| supply", ethers.formatEther(supplyBefore), "->", ethers.formatEther(supplyAfter));
  console.log("deployer left", ethers.formatEther(await ethers.provider.getBalance(me.address)), "ETH");
}
main().catch((e) => { console.error(e); process.exit(1); });
