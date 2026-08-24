import { ethers } from "hardhat";

// Owner admin ops on the live HyperSwap launchpad factory. Explicit EIP-1559
// fees (skip hardhat's feeHistory auto-estimation, which errors on the HyperEVM
// RPC). Run with HARDHAT_CONFIG=hardhat.config.size.ts --network robinhood.
//
//   ACTION=fee-recipient   NEW=0x...            -> setFeeRecipient
//   ACTION=transfer-owner  NEW=0x...            -> transferOwnership
//   ACTION=quote-price     NEW=0x... PRICE8=n   -> setQuoteAsset(NEW, true, n)
const FACTORY = "0x46A402242fBA63f014409106f620C91658691534";
const FEES = { maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 300_000 };

async function main() {
  const [signer] = await ethers.getSigners();
  const action = process.env.ACTION;
  const next = process.env.NEW as string;
  const f = await ethers.getContractAt("StableLaunchpadFactory", FACTORY, signer);
  console.log("signer:", signer.address, "owner:", await f.owner(), "feeRecipient:", await f.feeRecipient());

  if (action === "fee-recipient") {
    if (!ethers.isAddress(next)) throw new Error("NEW must be an address");
    const tx = await f.setFeeRecipient(next, FEES);
    console.log("setFeeRecipient tx:", tx.hash);
    await tx.wait();
    console.log("feeRecipient now:", await f.feeRecipient());
  } else if (action === "transfer-owner") {
    if (!ethers.isAddress(next)) throw new Error("NEW must be an address");
    const tx = await f.transferOwnership(next, FEES);
    console.log("transferOwnership tx:", tx.hash);
    await tx.wait();
    console.log("owner now:", await f.owner());
  } else if (action === "quote-price") {
    if (!ethers.isAddress(next)) throw new Error("NEW must be an address");
    const price8 = BigInt(process.env.PRICE8 ?? "0");
    if (price8 <= 0n) throw new Error("PRICE8 must be > 0 (USD per token, 8 decimals)");
    const tx = await f.setQuoteAsset(next, true, price8, FEES);
    console.log("setQuoteAsset tx:", tx.hash);
    await tx.wait();
    console.log("quoteAssets now:", await f.quoteAssets(next));
  } else {
    throw new Error("Set ACTION=fee-recipient|transfer-owner|quote-price");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
