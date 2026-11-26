/* eslint-disable no-console */
// Claim the deployer's creator fees on every coin, use all of it (minus a gas reserve) to buy a coin through the
// router, and send what was bought to the dead address. TOKEN=<address> picks the coin (default: the official coin).
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com \
//   ROBINHOOD_CHAIN_ID=57073 npx hardhat run scripts/buyback-burn-ink.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const WETH = "0x4200000000000000000000000000000000000006";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const WETH_ABI = ["function balanceOf(address) view returns (uint256)", "function withdraw(uint256)"];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const retry = async <T>(fn: () => Promise<T>): Promise<T> => { for (let i = 0; i < 8; i++) { try { return await fn(); } catch { await sleep(1500); } } return fn(); };

async function main() {
  const [me] = await ethers.getSigners();
  const file = path.join(__dirname, "..", "deployments", "ink-inkypump.json");
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const target: string = process.env.TOKEN || dep.official.token;
  const tokens: string[] = [dep.smoke?.token, dep.official?.token, ...(dep.launches || []).map((l: any) => l.token)].filter(Boolean);
  const weth = await ethers.getContractAt(WETH_ABI, WETH, me);
  const router = await ethers.getContractAt("InkypumpRouter", dep.contracts.router, me);
  // 1. creator fees -> deployer (WETH)
  for (const t of tokens) {
    const coin = await ethers.getContractAt("InkypumpToken", t, me); const fees = await coin.creatorFees();
    if (fees > 0n) { const rc = await (await coin.payCreator()).wait(); console.log(await coin.symbol(), "creator fees paid", ethers.formatEther(fees), "WETH tx", rc!.hash); }
  }
  await sleep(3000);
  let wbal = 0n; for (let i = 0; i < 8; i++) { wbal = await retry(() => weth.balanceOf(me.address)); if (wbal > 0n) break; await sleep(1500); }
  if (wbal > 0n) { const rc = await (await weth.withdraw(wbal)).wait(); console.log("unwrapped", ethers.formatEther(wbal), "WETH tx", rc!.hash); await sleep(3000); }
  // 2. buy the coin with everything above the gas reserve
  const reserve = ethers.parseEther("0.004");
  let bal = 0n; for (let i = 0; i < 8; i++) { bal = await ethers.provider.getBalance(me.address); if (bal > reserve + wbal / 2n) break; await sleep(1500); }
  const spend = bal > reserve ? bal - reserve : 0n;
  if (spend === 0n) { console.log("nothing to spend"); return; }
  const coin = await ethers.getContractAt("InkypumpToken", target, me);
  const quote: bigint = await router.buy.staticCall(target, "0x", 0, { value: spend });
  const minOut = quote * 97n / 100n;
  const rc = await (await router.buy(target, "0x", minOut, { value: spend })).wait();
  console.log("bought", await coin.symbol(), "with", ethers.formatEther(spend), "ETH, quote", ethers.formatEther(quote), "tx", rc!.hash);
  await sleep(3000);
  // 3. burn: send the whole balance to the dead address
  let got = 0n; for (let i = 0; i < 8; i++) { got = await retry(() => coin.balanceOf(me.address)); if (got > 0n) break; await sleep(1500); }
  const rb = await (await coin.transfer(DEAD, got)).wait();
  console.log("burned", ethers.formatEther(got), await coin.symbol(), "to", DEAD, "tx", rb!.hash);
  console.log("dead balance now", ethers.formatEther(await retry(() => coin.balanceOf(DEAD))), "| deployer ETH left", ethers.formatEther(await ethers.provider.getBalance(me.address)));
}

main().catch((e) => { console.error(e); process.exit(1); });
