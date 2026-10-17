/* eslint-disable no-console */
// Approve (or re-price) every stock pair on the HyperAuction v2 factory from
// deployments/hyperevm-stock-quotes.json, then hand ownership to ADMIN when
// TRANSFER=1. Run with the current factory OWNER's key, big blocks OFF.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://rpc.hyperliquid.xyz/evm \
//   ROBINHOOD_CHAIN_ID=999 PRIVATE_KEY=... [ADMIN=0x..] [TRANSFER=1] \
//     npx hardhat run scripts/approve-onair-quotes.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const [signer] = await ethers.getSigners();
  const depFile = path.join(__dirname, "..", "deployments", "hyperevm-onair-v2.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  const quotes = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "hyperevm-stock-quotes.json"), "utf8")).quotes as { ticker: string; address: string; usd: number }[];
  const factory = await ethers.getContractAt("OnairFactory", dep.contracts.factory, signer);
  const owner = await factory.owner();
  console.log("signer", signer.address, "owner", owner, "factory", dep.contracts.factory, "quotes", quotes.length);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) throw new Error("signer is not the factory owner");

  const approved: { ticker: string; address: string; usd: number; usd8: string }[] = dep.quotes ?? [];
  for (const q of quotes) {
    if (!(q.usd > 0)) { console.log("  skip", q.ticker, "no price"); continue; }
    const usd8 = BigInt(Math.round(q.usd * 1e8));
    const cur = await factory.quoteAssets(q.address);
    if (cur.approved && cur.usdPrice8 === usd8) { console.log("  =", q.ticker, "already set"); continue; }
    try {
      const tx = await factory.setQuoteAsset(q.address, true, usd8);
      await tx.wait();
      const i = approved.findIndex((a) => a.address.toLowerCase() === q.address.toLowerCase());
      const row = { ticker: q.ticker, address: q.address, usd: q.usd, usd8: usd8.toString() };
      if (i >= 0) approved[i] = row; else approved.push(row);
      console.log("  +", q.ticker, "$" + q.usd, tx.hash);
    } catch (e: any) {
      console.log("  !", q.ticker, (e.shortMessage ?? e.message ?? String(e)).slice(0, 160));
    }
  }
  dep.quotes = approved;
  fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  console.log("approved", approved.length, "quotes on file");

  const admin = process.env.ADMIN ? ethers.getAddress(process.env.ADMIN) : dep.admin;
  if (process.env.TRANSFER === "1" && admin.toLowerCase() !== signer.address.toLowerCase()) {
    await (await factory.transferOwnership(admin)).wait();
    console.log("ownership ->", await factory.owner());
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
