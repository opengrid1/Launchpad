/* eslint-disable no-console */
// Sells the launcher's whole balance of one Anypair coin back to ETH through the
// live router (exact approval, never unlimited). Safe to re-run: it reads the
// balance and allowance first and does nothing once the balance is zero.
//
//   COIN=0x... DEPLOYER_ENV=.env.anypair-deployer HARDHAT_CONFIG=hardhat.config.size.ts \
//   ROBINHOOD_RPC_URL=https://mainnet.base.org ROBINHOOD_CHAIN_ID=8453 GAS_PRICE_WEI=20000000 \
//     npx hardhat run scripts/sell-test-anypair.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-anypair.json"), "utf8"));
  const [me] = await ethers.getSigners();
  const coinAddr = ethers.getAddress(process.env.COIN!);
  const coin = await ethers.getContractAt("AnypairToken", coinAddr);
  const router = await ethers.getContractAt("AnypairRouter", dep.contracts.router);
  const bal = await coin.balanceOf(me.address);
  const eth0 = await ethers.provider.getBalance(me.address);
  console.log("seller", me.address, "holds", ethers.formatEther(bal), await coin.symbol(), "| ETH", ethers.formatEther(eth0));
  if (bal === 0n) return console.log("nothing to sell");
  if ((await coin.allowance(me.address, dep.contracts.router)) < bal) {
    const a = await coin.approve(dep.contracts.router, bal);
    console.log("approve", a.hash);
    await a.wait(2);
  }
  const s = await router.sell(coinAddr, bal, "0x", 0);
  console.log("sell", s.hash);
  await s.wait(2);
  console.log("ETH now", ethers.formatEther(await ethers.provider.getBalance(me.address)));
}

main().catch((e) => { console.error(e); process.exit(1); });
