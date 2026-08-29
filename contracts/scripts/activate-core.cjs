const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function loadKey() {
  const env = fs.readFileSync(path.join(__dirname, "..", ".env.meow-deployer"), "utf8");
  return env.match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];
}
// Send native HYPE to the HYPE system address -> credits the sender's HyperCore
// spot HYPE, registering the deployer as a Core user (needed for big blocks).
const HYPE_SYS = "0x2222222222222222222222222222222222222222";

async function main() {
  const amount = process.argv[2] ?? "0.05";
  const p = new ethers.JsonRpcProvider("https://rpc.hyperliquid.xyz/evm", 999);
  const w = new ethers.Wallet(loadKey(), p);
  const bal = await p.getBalance(w.address);
  console.log("deployer EVM balance:", ethers.formatEther(bal), "HYPE");
  const tx = await w.sendTransaction({
    to: HYPE_SYS, value: ethers.parseEther(amount),
    gasLimit: 40_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 100_000_000n,
  });
  console.log("sent", amount, "HYPE to Core system addr, tx:", tx.hash);
  const r = await tx.wait();
  console.log("confirmed in block", r.blockNumber, "| status", r.status);
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
