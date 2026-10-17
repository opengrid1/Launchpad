/* eslint-disable no-console */
// Move the platform share: each coin -> treasury (pushPlatformFees), then treasury -> payout pool (1/8) + fee recipient (7/8).
// Anyone may call both; the destinations are fixed in the contracts.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com \
//   ROBINHOOD_CHAIN_ID=57073 npx hardhat run scripts/sweep-platform-ink.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const WETH = "0x4200000000000000000000000000000000000006";
const ERC20 = ["function balanceOf(address) view returns (uint256)"];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ink-inkypump.json"), "utf8"));
  const factory = await ethers.getContractAt("InkypumpFactory", dep.contracts.factory, me);
  const treasury = await ethers.getContractAt("InkypumpTreasury", dep.contracts.treasury, me);
  const weth = await ethers.getContractAt(ERC20, WETH, me);
  const n = Number(await factory.totalTokens());
  const tokens: string[] = []; for (let i = 0; i < n; i++) tokens.push(await factory.allTokens(i));
  const owed: string[] = [];
  for (const t of tokens) { const c = await ethers.getContractAt("InkypumpToken", t, me); const v = await c.platformFees(); console.log(await c.symbol(), "platform owed", ethers.formatEther(v)); if (v > 0n) owed.push(t); }
  if (owed.length) { const rc = await (await factory.pushPlatformFees(owed)).wait(); console.log("pushed to treasury tx", rc!.hash); await sleep(3000); }
  const bal = await weth.balanceOf(dep.contracts.treasury);
  console.log("treasury WETH", ethers.formatEther(bal), "| recipient", await treasury.recipient());
  if (bal > 0n) { const rc = await (await treasury.sweep(WETH)).wait(); console.log("swept tx", rc!.hash); await sleep(3000); }
  console.log("payout pool WETH", ethers.formatEther(await weth.balanceOf(dep.contracts.payout)), "| admin WETH", ethers.formatEther(await weth.balanceOf(dep.admin)));
}

main().catch((e) => { console.error(e); process.exit(1); });
