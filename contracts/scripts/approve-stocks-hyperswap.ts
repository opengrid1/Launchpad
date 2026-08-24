import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Approve the 35 Ondo tokenized stocks as launch-pair quote assets on the live
// HyperSwap launchpad factory. Each setQuoteAsset records the quote's USD price
// (8 decimals) so the factory can size the initial market cap correctly when a
// coin is launched against that stock.
//
// Run with the factory owner signer:
//   HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat run \
//     scripts/approve-stocks-hyperswap.ts --network robinhood
const FACTORY = "0xE1DF818afA3154B56D719D92e25A69686b7046d4";
const FEES = { maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 200_000 };

// Most-recent-close USD prices (Yahoo Finance, ~2026-08-20/21), keyed by the
// underlying ticker (the Ondo symbol without its "on" suffix).
const PRICES: Record<string, number> = {
  AAPL: 309.35, AMD: 473.25, AMZN: 258.63, BABA: 119.34, COIN: 186.49,
  COPX: 94.59, CRCL: 87.98, CRWV: 87.85, EWY: 178.34, FCX: 76.66,
  GLD: 423.36, GOOGL: 344.82, HOOD: 108.13, IAU: 86.79, INTC: 90.07,
  IVV: 769.31, META: 549.9, MSFT: 483.24, MSTR: 119.25, MU: 966.78,
  NFLX: 79.59, NVDA: 214.72, ORCL: 146.47, PALL: 24.45, PLTR: 179.94,
  PPLT: 17.02, QQQ: 713.44, RIVN: 16.97, SLV: 62.72, SNDK: 1596.08,
  SPY: 765.72, TSLA: 362.86, TSM: 418.95, UNG: 9.99, USO: 134.64,
};

function usdPrice8(price: number): bigint {
  // Round to the nearest cent, then scale to 8 decimals ($1.00 = 1e8).
  return BigInt(Math.round(price * 100)) * 1_000_000n;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const f = await ethers.getContractAt("StableLaunchpadFactory", FACTORY, signer);
  const owner = await f.owner();
  console.log("signer:", signer.address, "owner:", owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`signer is not the factory owner (owner=${owner})`);
  }

  const file = path.join(__dirname, "..", "deployments", "hyperevm-ondo-stocks.json");
  const { tokens } = JSON.parse(fs.readFileSync(file, "utf8")) as {
    tokens: { symbol: string; name: string; address: string; decimals: number }[];
  };

  let nonce = await ethers.provider.getTransactionCount(signer.address);
  const done: string[] = [];
  const skipped: string[] = [];

  for (const t of tokens) {
    const ticker = t.symbol.replace(/on$/, "");
    const price = PRICES[ticker];
    if (price === undefined) {
      console.warn(`  ! no price for ${t.symbol} (${ticker}) - skipping`);
      skipped.push(t.symbol);
      continue;
    }

    // Skip if already approved at the same price (idempotent re-runs).
    const cur = await f.quoteAssets(t.address);
    const target = usdPrice8(price);
    if (cur.approved && cur.usdPrice8 === target) {
      console.log(`  = ${t.symbol.padEnd(8)} already set @ $${price}`);
      done.push(t.symbol);
      continue;
    }

    const tx = await f.setQuoteAsset(t.address, true, target, { ...FEES, nonce: nonce++ });
    console.log(`  + ${t.symbol.padEnd(8)} $${String(price).padEnd(8)} price8=${target}  tx=${tx.hash}`);
    await tx.wait();
    done.push(t.symbol);
  }

  console.log(`\napproved/confirmed ${done.length}/${tokens.length}`);
  if (skipped.length) console.log("skipped (no price):", skipped.join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
