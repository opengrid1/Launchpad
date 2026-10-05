/* eslint-disable no-console */
// Sweeps every Anypair fee to the admin: pushes platform fees on every coin of
// every factory (they always go to the factory's fee wallet), claims creator fees
// on coins this signer created, forwards the pair tokens received, then sends the
// signer's ETH minus a small reserve for the L1 data fee. DRY=1 prints the plan.
//   TO=0x... DEPLOYER_ENV=.env.anypair-deployer HARDHAT_CONFIG=hardhat.config.size.ts \
//   ROBINHOOD_RPC_URL=https://mainnet.base.org ROBINHOOD_CHAIN_ID=8453 GAS_PRICE_WEI=20000000 \
//     npx hardhat run scripts/sweep-anypair.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const DRY = process.env.DRY === "1";
async function main() {
  const [me] = await ethers.getSigners();
  const to = ethers.getAddress(process.env.TO!);
  const dir = path.join(__dirname, "..", "deployments");
  const factories = ["base-anypair-v1.json", "base-anypair.json"].map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).contracts.factory);
  const ERC = ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"];
  const pairsToForward = new Set<string>();
  for (const fa of factories) {
    const f = await ethers.getContractAt("AnypairFactory", fa);
    const n = Number(await f.totalTokens());
    for (let i = 0; i < n; i++) {
      const coin = await ethers.getContractAt("AnypairToken", await f.allTokens(i));
      const [sym, pair, creator, plat, cre] = [await coin.symbol(), await coin.pairAsset(), await coin.creator(), await coin.platformFees(), await coin.creatorFees()];
      const p = await ethers.getContractAt(ERC, pair); const d = await p.decimals(); const ps = await p.symbol();
      const mine = creator.toLowerCase() === me.address.toLowerCase();
      console.log(`${sym} ${await coin.getAddress()} | platform waiting ${ethers.formatUnits(plat, d)} ${ps} | creator ${mine ? "(us) " + ethers.formatUnits(cre, d) + " " + ps : "(someone else)"}`);
      if (plat > 0n && !DRY) { const t = await coin.payPlatform(); await t.wait(2); console.log("  platform fees pushed to fee wallet", t.hash); }
      if (mine && cre > 0n && !DRY) { const t = await coin.payCreator(); await t.wait(2); console.log("  creator fees claimed", t.hash); }
      if (mine) pairsToForward.add(pair);
    }
  }
  for (const pair of pairsToForward) {
    const p = await ethers.getContractAt(ERC, pair); const bal = await p.balanceOf(me.address); const d = await p.decimals(); const s = await p.symbol();
    if (bal === 0n) continue;
    console.log(`forward ${ethers.formatUnits(bal, d)} ${s} -> ${to}`);
    if (!DRY) { const t = await p.transfer(to, bal); await t.wait(2); console.log("  ", t.hash); }
  }
  const eth = await ethers.provider.getBalance(me.address);
  const gasPrice = BigInt(process.env.GAS_PRICE_WEI ?? "20000000");
  const reserve = 21000n * gasPrice + ethers.parseEther("0.00001"); // L2 gas plus the L1 data fee
  const send = eth > reserve ? eth - reserve : 0n;
  console.log(`ETH ${ethers.formatEther(eth)} -> send ${ethers.formatEther(send)} to ${to}`);
  if (!DRY && send > 0n) { const t = await me.sendTransaction({ to, value: send, gasLimit: 21000n }); await t.wait(2); console.log("  ", t.hash); }
  console.log("signer ETH left", ethers.formatEther(await ethers.provider.getBalance(me.address)));
}
main().catch((e) => { console.error(e); process.exit(1); });
