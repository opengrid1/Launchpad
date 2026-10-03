import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Sweep Estonks v2 fees to the admin wallet:
 *  1. push every v2 coin's platform share to the fee recipient (anyone may);
 *  2. pay STONK's creator share to its creator (this signer), unwrap the WETH;
 *  3. pay the private vault's trade fees to its fee recipient;
 *  4. send the signer's ETH to the admin wallet, keeping GAS_RESERVE_ETH.
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... \
 *   npx hardhat run scripts/claim-v2-to-admin.ts --network robinhood
 */
async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ethereum-estonks-v2.json"), "utf8"));
  const admin: string = dep.admin;
  const fmt = ethers.formatEther;
  const bal = () => ethers.provider.getBalance(me.address);
  const factory = await ethers.getContractAt("EstonksFactory", dep.contracts.factory, me);
  const weth = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)", "function withdraw(uint256)"], dep.uniswap.weth, me);
  console.log("signer", me.address, "ETH", fmt(await bal()), "| admin", admin, "| fee recipient", await factory.feeRecipient());

  // 1. Platform shares.
  const n = Number(await factory.totalTokens());
  const waiting: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = await factory.allTokens(i);
    const c = await ethers.getContractAt("EstonksToken", t, me);
    const pf = await c.platformFees();
    console.log(" ", await c.symbol(), "platform waiting", fmt(pf));
    if (pf > 0n) waiting.push(t);
  }
  if (waiting.length) {
    const tx = await factory.pushPlatformFees(waiting, { gasLimit: 150_000n * BigInt(waiting.length) + 60_000n });
    await tx.wait();
    console.log("pushed platform fees to", await factory.feeRecipient(), "tx", tx.hash);
  }

  // 2. Creator share of every coin this signer created, as WETH, then unwrapped.
  for (let i = 0; i < n; i++) {
    const c = await ethers.getContractAt("EstonksToken", await factory.allTokens(i), me);
    if ((await c.creator()).toLowerCase() !== me.address.toLowerCase()) continue;
    const cf = await c.creatorFees();
    if (cf > 0n) { const tx = await c.payCreator({ gasLimit: 200_000n }); await tx.wait(); console.log("creator share", fmt(cf), "of", await c.pairAsset(), "tx", tx.hash); }
  }
  const w = await weth.balanceOf(me.address);
  if (w > 0n) { const tx = await weth.withdraw(w, { gasLimit: 60_000n }); await tx.wait(); console.log("unwrapped", fmt(w), "WETH tx", tx.hash); }

  // 3. Private vault fees.
  if (dep.contracts.vault) {
    const vault = await ethers.getContractAt("EstonksVault", dep.contracts.vault, me);
    const owed = await vault.feesOwed();
    if (owed > 0n) { const tx = await vault.claimFees({ gasLimit: 80_000n }); await tx.wait(); console.log("vault fees", fmt(owed), "to", await vault.feeRecipient(), "tx", tx.hash); }
  }

  // 4. On to the admin wallet, keeping a float for gas.
  const reserve = ethers.parseEther(process.env.GAS_RESERVE_ETH ?? "0.004");
  const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? 0n;
  const send = (await bal()) - reserve - 21_000n * gasPrice * 2n;
  if (send > 0n) {
    const tx = await me.sendTransaction({ to: admin, value: send, gasLimit: 21_000n });
    await tx.wait();
    console.log("sent", fmt(send), "ETH to admin tx", tx.hash);
  } else console.log("nothing above the gas reserve to send");
  console.log("signer ETH left", fmt(await bal()), "| admin ETH", fmt(await ethers.provider.getBalance(admin)), "WETH", fmt(await weth.balanceOf(admin)));
}

main().catch((e) => { console.error(e.shortMessage ?? e.message ?? e); process.exit(1); });
