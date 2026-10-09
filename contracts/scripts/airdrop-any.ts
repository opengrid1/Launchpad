/* eslint-disable no-console */
// Airdrops the relaunched coin to the old coin's holders, from a snapshot file:
// each wallet gets its snapshot balance (same 1B supply, so the same share). The
// launcher's own wallet and contracts holding dust are skipped. If the launcher
// holds less than the total, everyone is scaled down equally. Safe to re-run:
// a wallet that already holds its amount is skipped.
//   COIN=0x... SNAPSHOT=deployments/any-snapshot-52214992.json [DRY=1] DEPLOYER_ENV=... \
//     npx hardhat run scripts/airdrop-any.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const [me] = await ethers.getSigners();
  const snap = JSON.parse(fs.readFileSync(path.join(__dirname, "..", process.env.SNAPSHOT!), "utf8"));
  const coin = await ethers.getContractAt("AnypairToken", process.env.COIN!);
  const list = snap.holders.filter((h: any) => h.address.toLowerCase() !== me.address.toLowerCase() && !(h.isContract && h.shareOfHeld < 0.0001) && BigInt(h.balance) > 0n);
  const want = list.reduce((s: bigint, h: any) => s + BigInt(h.balance), 0n);
  const have = await coin.balanceOf(me.address);
  const scale = (x: bigint) => (have >= want ? x : (x * have) / want);
  console.log("airdropping", list.length, "wallets, want", ethers.formatEther(want), "ANY, launcher holds", ethers.formatEther(have), have >= want ? "" : "(scaled down)");
  for (const h of list) {
    const amt = scale(BigInt(h.balance)); const already = await coin.balanceOf(h.address);
    if (already >= amt) { console.log(" skip", h.address, "already holds", ethers.formatEther(already)); continue; }
    const send = amt - already;
    if (process.env.DRY === "1") { console.log(" would send", ethers.formatEther(send), "to", h.address); continue; }
    const t = await coin.transfer(h.address, send); console.log(" sent", ethers.formatEther(send), "to", h.address, t.hash); await t.wait(2);
  }
  console.log("launcher left with", ethers.formatEther(await coin.balanceOf(me.address)));
}
main().catch((e) => { console.error(e); process.exit(1); });
