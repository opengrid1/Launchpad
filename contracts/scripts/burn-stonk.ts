import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/** Burn BURN_AMOUNT STONK from the signer, with a fixed gas limit (the estimate runs short). */
async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ethereum-estonks.json"), "utf8"));
  const stonk = await ethers.getContractAt("StockPadToken", dep.mainToken, me);
  const amount = ethers.parseEther(process.env.BURN_AMOUNT!);
  const before = await stonk.totalSupply();
  const tx = await stonk.burn(amount, { gasLimit: 200_000n });
  const rc = await tx.wait();
  console.log("burn tx", tx.hash, "status", rc!.status, "gasUsed", rc!.gasUsed.toString());
  console.log("supply", ethers.formatEther(before), "->", ethers.formatEther(await stonk.totalSupply()), "| signer STONK", ethers.formatEther(await stonk.balanceOf(me.address)), "| ETH", ethers.formatEther(await ethers.provider.getBalance(me.address)));
}
main().catch((e) => { console.error(e.shortMessage ?? e.message); process.exit(1); });
