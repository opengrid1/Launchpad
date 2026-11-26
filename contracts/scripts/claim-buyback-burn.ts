import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * From the STONK creator (deployer) key: claim STONK creator fees and holder
 * rewards as ETH, spend the claimed ETH buying STONK through the router, and
 * burn exactly the STONK that buy returned.
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... \
 *   npx hardhat run scripts/claim-buyback-burn.ts --network robinhood
 */
async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ethereum-estonks.json"), "utf8"));
  const stonk = await ethers.getContractAt("StockPadToken", dep.mainToken, me);
  const router = await ethers.getContractAt("StockPadRouter", dep.contracts.router, me);
  const bal = () => ethers.provider.getBalance(me.address);
  const fmt = (v: bigint) => ethers.formatEther(v);

  const start = await bal();
  const [creatorFees, pending, held] = await Promise.all([stonk.creatorFees(), stonk.pendingRewards(me.address), stonk.balanceOf(me.address)]);
  console.log("signer", me.address, "ETH", fmt(start), "| creator fees", fmt(creatorFees), "| holder rewards", fmt(pending), "| STONK held", fmt(held));

  let claimed = 0n;
  if (creatorFees > 0n) {
    const b = await bal();
    const tx = await stonk.claimCreatorFees(true, 0n, "0x");
    const rc = await tx.wait();
    const got = (await bal()) - b + rc!.gasUsed * rc!.gasPrice;
    claimed += got;
    console.log("claimed creator fees", fmt(got), "ETH tx", tx.hash);
  }
  if (pending > 0n) {
    const b = await bal();
    const tx = await stonk.claimRewardsAsEth(0n, "0x");
    const rc = await tx.wait();
    const got = (await bal()) - b + rc!.gasUsed * rc!.gasPrice;
    claimed += got;
    console.log("claimed holder rewards", fmt(got), "ETH tx", tx.hash);
  }
  // Spend what was claimed, never the gas float the deployer started with. SPEND_ETH
  // overrides (e.g. to retry a buyback after an earlier claim already landed).
  const spend = process.env.SPEND_ETH ? ethers.parseEther(process.env.SPEND_ETH) : claimed;
  if (spend === 0n) { console.log("nothing to spend; stopping"); return; }
  const quote = await router.buy.staticCall(dep.mainToken, "0x", 0n, { value: spend });
  const minOut = (quote * BigInt(10_000 - Number(process.env.SLIPPAGE_BPS ?? "1000"))) / 10_000n;
  const before = await stonk.balanceOf(me.address);
  const buy = await router.buy(dep.mainToken, "0x", minOut, { value: spend });
  await buy.wait();
  const bought = (await stonk.balanceOf(me.address)) - before;
  console.log("bought", fmt(bought), "STONK for", fmt(spend), "ETH tx", buy.hash);

  const burn = await stonk.burn(bought, { gasLimit: 200_000n }); // the node's estimate runs short
  await burn.wait();
  console.log("burned", fmt(bought), "STONK tx", burn.hash);
  console.log("STONK supply now", fmt(await stonk.totalSupply()), "| signer ETH", fmt(await bal()), "| signer STONK", fmt(await stonk.balanceOf(me.address)));
}

main().catch((e) => { console.error(e); process.exit(1); });
