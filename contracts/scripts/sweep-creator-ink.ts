/* eslint-disable no-console */
// Pay out everything the deployer wallet has earned as a creator or holder on Ink
// (creator fees and holder rewards, in WETH), unwrap it and send the ETH to the admin.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com \
//   ROBINHOOD_CHAIN_ID=57073 npx hardhat run scripts/sweep-creator-ink.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const WETH = "0x4200000000000000000000000000000000000006";
const WETH_ABI = ["function balanceOf(address) view returns (uint256)", "function withdraw(uint256)"];
const retry = async <T>(fn: () => Promise<T>): Promise<T> => { for (let i = 0; i < 8; i++) { try { return await fn(); } catch { await new Promise(r => setTimeout(r, 1500)); } } return fn(); };

async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ink-inkypump.json"), "utf8"));
  const admin: string = dep.admin;
  const tokens: string[] = [dep.smoke?.token, dep.official?.token, ...(dep.launches || []).map((l: any) => l.token)].filter(Boolean);
  const weth = await ethers.getContractAt(WETH_ABI, WETH, me);
  console.log("deployer", me.address, "-> admin", admin);
  for (const t of tokens) {
    const coin = await ethers.getContractAt("InkypumpToken", t, me);
    const sym = await coin.symbol();
    const fees = await coin.creatorFees();
    if (fees > 0n) { const rc = await (await coin.payCreator()).wait(); console.log(sym, "creator fees paid", ethers.formatEther(fees), "WETH tx", rc!.hash); }
    const pending = await coin.pendingRewards(me.address);
    if (pending > 0n) { const rc = await (await coin.claimRewards()).wait(); console.log(sym, "holder rewards claimed", ethers.formatEther(pending), "WETH tx", rc!.hash); }
  }
  // the public RPC is load-balanced: wait until a node shows the balance the payouts imply
  let wbal = 0n; for (let i = 0; i < 10; i++) { wbal = await retry(() => weth.balanceOf(me.address)); if (wbal > 0n) { await new Promise(r => setTimeout(r, 2000)); const again = await retry(() => weth.balanceOf(me.address)); if (again === wbal) break; wbal = again; } else await new Promise(r => setTimeout(r, 1500)); }
  if (wbal > 0n) { const rc = await (await weth.withdraw(wbal)).wait(); console.log("unwrapped", ethers.formatEther(wbal), "WETH tx", rc!.hash); }
  // forward everything above a small gas reserve (covers ETH unwrapped by an earlier run whose transfer failed)
  await new Promise(r => setTimeout(r, 3000));
  const reserve = ethers.parseEther("0.005");
  let bal = 0n; for (let i = 0; i < 6; i++) { bal = await ethers.provider.getBalance(me.address); if (bal > reserve) break; await new Promise(r => setTimeout(r, 1500)); }
  const send = bal > reserve ? bal - reserve : 0n;
  if (send > 0n) {
    const tx = await me.sendTransaction({ to: admin, value: send, gasLimit: 30000n });
    const rc = await tx.wait();
    console.log("sent", ethers.formatEther(send), "ETH to admin tx", rc!.hash);
  } else console.log("nothing to send");
  console.log("deployer ETH left", ethers.formatEther(await ethers.provider.getBalance(me.address)));
}

main().catch((e) => { console.error(e); process.exit(1); });
