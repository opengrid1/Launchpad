/* eslint-disable no-console */
// Pays a coin's creator share to the creator (this signer) and forwards the
// pair-token balance (WETH for ETH pairs) to TO. Safe to re-run.
//   COIN=0x... TO=0x... DEPLOYER_ENV=.env.anypair-deployer HARDHAT_CONFIG=hardhat.config.size.ts \
//   ROBINHOOD_RPC_URL=https://mainnet.base.org ROBINHOOD_CHAIN_ID=8453 GAS_PRICE_WEI=20000000 \
//     npx hardhat run scripts/claim-creator-anypair.ts --network robinhood
import { ethers } from "hardhat";

async function main() {
  const [me] = await ethers.getSigners();
  const coin = await ethers.getContractAt("AnypairToken", process.env.COIN!);
  const to = ethers.getAddress(process.env.TO!);
  const pair = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function symbol() view returns (string)"], await coin.pairAsset());
  if ((await coin.creator()).toLowerCase() !== me.address.toLowerCase()) throw new Error("signer is not this coin's creator");
  const owed = await coin.creatorFees();
  console.log("creator fees owed", ethers.formatEther(owed), await pair.symbol());
  if (owed > 0n) { const t = await coin.payCreator(); console.log("payCreator", t.hash); await t.wait(2); }
  const bal = await pair.balanceOf(me.address);
  if (bal === 0n) return console.log("nothing to forward");
  const t = await pair.transfer(to, bal); console.log("transfer", ethers.formatEther(bal), "to", to, t.hash); await t.wait(2);
  console.log("done; signer now holds", ethers.formatEther(await pair.balanceOf(me.address)));
}
main().catch((e) => { console.error(e); process.exit(1); });
