import { ethers } from "hardhat";

// Approve the tradable Backed xStocks as launch-pair quote assets on the live
// HyperSwap launchpad factory. Each has a real Hyperliquid Core spot market
// (buy with USDC, transfer to EVM) and real EVM supply, unlike the earlier
// Ondo list. Prices are USD with 8 decimals; refresh them when they drift.
//
// Run with the factory OWNER signer:
//   HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat run \
//     scripts/approve-stocks-hyperswap.ts --network robinhood
const FACTORY = "0x82Ca3B8D4B90a6237f399B1f33cB8833Ff196ec1";
const FEES = { maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 200_000 };

// Hyperliquid Core spot mids, 2026-08-24.
const XSTOCKS: { ticker: string; address: string; usd: number }[] = [
  { ticker: "NVDAX", address: "0xa8ddb5cd96b5222afe198316e9a57caa642850d5", usd: 215.34 },
  { ticker: "SPYX", address: "0xe7e553cd128f0011777323a0b44a7b96ea1cb540", usd: 768.80 },
  { ticker: "QQQX", address: "0x4c1ae29c159838fc1b224636e28e086eb69101f7", usd: 710.20 },
  { ticker: "MUX", address: "0xe2047ee3bddb5c99ae428ab83df63f8730698e30", usd: 935.74 },
  { ticker: "SKHYX", address: "0x6215a58ed045d71f2561aaabe54f4c885c522998", usd: 158.25 },
];

async function main() {
  const [signer] = await ethers.getSigners();
  const f = await ethers.getContractAt("StableLaunchpadFactory", FACTORY, signer);
  const owner = await f.owner();
  console.log("signer:", signer.address, "owner:", owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) throw new Error("signer is not the factory owner");

  for (const s of XSTOCKS) {
    const price8 = BigInt(Math.round(s.usd * 100)) * 10n ** 6n;
    const cur = await f.quoteAssets(s.address);
    if (cur.approved && cur.usdPrice8 === price8) { console.log(`  = ${s.ticker} already set`); continue; }
    const tx = await f.setQuoteAsset(s.address, true, price8, FEES);
    console.log(`  + ${s.ticker} $${s.usd} tx=${tx.hash}`);
    await tx.wait();
  }
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); });
