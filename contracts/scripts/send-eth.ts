/* eslint-disable no-console */
// Sends ETH from the configured signer: TO=0x.. AMOUNT=0.21 DEPLOYER_ENV=.env.backstop-admin npx hardhat --config hardhat.config.cntrlz.ts run scripts/send-eth.ts --network mainnet
import { ethers } from "hardhat";
async function main() {
  const [me] = await ethers.getSigners();
  const base = (await ethers.provider.getBlock("latest"))!.baseFeePerGas ?? 0n; const tip = ethers.parseUnits("0.05", "gwei");
  console.log("from", me.address, "balance", ethers.formatEther(await ethers.provider.getBalance(me.address)), "ETH");
  const tx = await me.sendTransaction({ to: process.env.TO!, value: ethers.parseEther(process.env.AMOUNT!), maxPriorityFeePerGas: tip, maxFeePerGas: (base * 115n) / 100n + tip });
  const rc = await tx.wait();
  console.log("sent", process.env.AMOUNT, "ETH to", process.env.TO, tx.hash, "gas", ethers.formatEther(rc!.gasUsed * rc!.gasPrice));
  console.log("from left", ethers.formatEther(await ethers.provider.getBalance(me.address)), "to now", ethers.formatEther(await ethers.provider.getBalance(process.env.TO!)));
}
main().catch((e) => { console.error(e); process.exit(1); });
