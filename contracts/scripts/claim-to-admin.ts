import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Sweep every fee the deployer can reach to the admin wallet:
 *  1. push every coin's platform share to the factory's fee recipient (anyone may);
 *  2. claim STONK's creator fees and the deployer's STONK holder rewards as ETH;
 *  3. send the deployer's ETH to the admin wallet, keeping GAS_RESERVE_ETH for later ops.
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... \
 *   npx hardhat run scripts/claim-to-admin.ts --network robinhood
 */
async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ethereum-estonks.json"), "utf8"));
  const factory = await ethers.getContractAt("StockPadFactory", dep.contracts.factory, me);
  const stonk = await ethers.getContractAt("StockPadToken", dep.mainToken, me);
  const admin: string = dep.admin;
  const fmt = ethers.formatEther;
  const bal = () => ethers.provider.getBalance(me.address);
  console.log("signer", me.address, "ETH", fmt(await bal()), "| admin", admin, "| fee recipient", await factory.feeRecipient());

  // 1. Platform share of every coin that has some waiting.
  const n = Number(await factory.totalTokens());
  const waiting: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = await factory.allTokens(i);
    const c = await ethers.getContractAt("StockPadToken", t, me);
    const pf = await c.platformFees();
    console.log(" ", await c.symbol(), "platform waiting", fmt(pf), "of pair", await c.pairAsset());
    if (pf > 0n) waiting.push(t);
  }
  if (waiting.length) {
    const tx = await factory.pushPlatformFees(waiting, { gasLimit: 150_000n * BigInt(waiting.length) + 60_000n });
    await tx.wait();
    console.log("pushed platform fees from", waiting.length, "coins to", await factory.feeRecipient(), "tx", tx.hash);
  }

  // 2. STONK creator fees and the deployer's holder rewards, as ETH.
  const [cf, pr] = [await stonk.creatorFees(), await stonk.pendingRewards(me.address)];
  console.log("STONK creator fees", fmt(cf), "| holder rewards", fmt(pr));
  if (cf > 0n) { const tx = await stonk.claimCreatorFees(true, 0n, "0x", { gasLimit: 250_000n }); await tx.wait(); console.log("claimed creator fees tx", tx.hash); }
  if (pr > 0n) { const tx = await stonk.claimRewardsAsEth(0n, "0x", { gasLimit: 250_000n }); await tx.wait(); console.log("claimed holder rewards tx", tx.hash); }

  // 3. Send it on to the admin wallet, keeping a small float for gas.
  const reserve = ethers.parseEther(process.env.GAS_RESERVE_ETH ?? "0.004");
  const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? 0n;
  const now = await bal();
  const send = now - reserve - 21_000n * gasPrice * 2n;
  if (send > 0n) {
    const tx = await me.sendTransaction({ to: admin, value: send, gasLimit: 21_000n });
    await tx.wait();
    console.log("sent", fmt(send), "ETH to admin tx", tx.hash);
  } else console.log("nothing above the gas reserve to send");
  console.log("signer ETH left", fmt(await bal()), "| admin ETH", fmt(await ethers.provider.getBalance(admin)));
}

main().catch((e) => { console.error(e.shortMessage ?? e.message ?? e); process.exit(1); });
