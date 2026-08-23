import { ethers } from "hardhat";

// Owner admin ops on the live HyperSwap launchpad factory. Explicit EIP-1559
// fees (skip hardhat's feeHistory auto-estimation, which errors on the HyperEVM
// RPC). Run with HARDHAT_CONFIG=hardhat.config.size.ts --network robinhood.
//
//   ACTION=fee-recipient   NEW=0x...            -> setFeeRecipient
//   ACTION=transfer-owner  NEW=0x...            -> transferOwnership
const FACTORY = "0x6F2FaEe74afec6d8798dd18652F9cF0ec9a59027";
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
  } else {
    throw new Error("Set ACTION=fee-recipient|transfer-owner");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
