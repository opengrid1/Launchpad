/* eslint-disable no-console */
// Buys a cntrl-z coin for ETH (plain buy, no window) from the deployer and locks the coins in PinkLock (Ethereum),
// with the admin wallet as the lock owner:
//   TOKEN=0x.. ETH=0.2 DAYS=180 npx hardhat --config hardhat.config.cntrlz.ts run scripts/buy-and-lock-cntrlz.ts --network mainnet
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const PINKLOCK = "0x71B5759d73262FBb223956913ecF4ecC51057641"; // PinkLock02, verified on Etherscan
const LOCK_ABI = ["function lock(address owner, address token, bool isLpToken, uint256 amount, uint256 unlockDate, string description) returns (uint256)", "event LockAdded(uint256 indexed id, address token, address owner, uint256 amount, uint256 unlockDate)"];

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "eth-cntrlz.json"), "utf8"));
  const [me] = await ethers.getSigners();
  const token = process.env.TOKEN!; const value = ethers.parseEther(process.env.ETH || "0.2"); const days = Number(process.env.DAYS || 180);
  const owner = process.env.OWNER || dep.admin;
  const router = await ethers.getContractAt("CtrlzRouter", dep.contracts.router);
  const coin = await ethers.getContractAt("CtrlzToken", token);
  const fee = async () => { const base = (await ethers.provider.getBlock("latest"))!.baseFeePerGas ?? 0n; const tip = ethers.parseUnits("0.05", "gwei"); return { maxPriorityFeePerGas: tip, maxFeePerGas: (base * 115n) / 100n + tip }; };
  console.log("buyer", me.address, "balance", ethers.formatEther(await ethers.provider.getBalance(me.address)), "ETH; buying", ethers.formatEther(value), "ETH of", await coin.symbol());
  const quote = await router.buy.staticCall(token, "0x", 0, { value });
  const minOut = (quote * 97n) / 100n;
  const before = await coin.balanceOf(me.address);
  const tx = await router.buy(token, "0x", minOut, { value, ...(await fee()) });
  const rc = await tx.wait();
  const got = (await coin.balanceOf(me.address)) - before;
  console.log("bought", ethers.formatEther(got), "coins", tx.hash, "gas", ethers.formatEther(rc!.gasUsed * rc!.gasPrice), "ETH");
  // lock everything the buyer holds
  const amount = await coin.balanceOf(me.address);
  const unlock = Math.floor(Date.now() / 1000) + days * 86400;
  const lockc = new ethers.Contract(PINKLOCK, LOCK_ABI, me);
  await (await coin.approve(PINKLOCK, amount, await fee())).wait();
  const ltx = await lockc.lock(owner, token, false, amount, unlock, `cntrl-z.fun team buy, locked ${days} days`, await fee());
  const lrc = await ltx.wait();
  const topic = lockc.interface.getEvent("LockAdded")!.topicHash;
  const log = lrc!.logs.find((l) => l.topics[0] === topic);
  const id = log ? BigInt(log.topics[1]).toString() : "?";
  console.log("locked", ethers.formatEther(amount), "coins until", new Date(unlock * 1000).toISOString(), "owner", owner, "lock id", id, ltx.hash, "gas", ethers.formatEther(lrc!.gasUsed * lrc!.gasPrice), "ETH");
  console.log(`https://www.pinksale.finance/pinklock/ethereum/record/${id}`);
  console.log("deployer left", ethers.formatEther(await ethers.provider.getBalance(me.address)), "ETH");
}
main().catch((e) => { console.error(e); process.exit(1); });
