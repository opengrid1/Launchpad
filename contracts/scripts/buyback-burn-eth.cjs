/* eslint-disable no-console */
// Buys a coin through the router with ETH and burns everything received.
//   TOKEN, ETH (amount to spend), PRIVATE_KEY, RPC_URL
const fs = require("fs"); const path = require("path");
const { ethers } = require("ethers");
const R = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts-size/contracts/v4/eth/StockPadRouter.sol/StockPadRouter.json"), "utf8")).abi;
const T = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts-size/contracts/v4/eth/StockPadToken.sol/StockPadToken.json"), "utf8")).abi;
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://ethereum-rpc.publicnode.com", 1, { staticNetwork: true, batchMaxCount: 1 });
  const w = new ethers.Wallet(process.env.PRIVATE_KEY, p);
  const token = ethers.getAddress(process.env.TOKEN); const value = ethers.parseEther(process.env.ETH);
  const router = new ethers.Contract("0x0258Edc01480A836600B0d878B9b52f9431dC5F3", R, w);
  const t = new ethers.Contract(token, T, w);
  const fee = await p.getFeeData(); const opts = { maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: 50_000_000n };
  const before = await t.balanceOf(w.address);
  const quote = await router.buy.staticCall(token, "0x", 0, { value });
  const minOut = (quote * 97n) / 100n;
  console.log("spend", ethers.formatEther(value), "ETH | quote", ethers.formatEther(quote), "| min", ethers.formatEther(minOut));
  const tx = await router.buy(token, "0x", minOut, { value, ...opts });
  const rc = await tx.wait(); if (rc.status !== 1) throw new Error("buy failed " + tx.hash);
  const got = (await t.balanceOf(w.address)) - before;
  console.log("bought", ethers.formatEther(got), "tx", tx.hash, "gas", rc.gasUsed.toString());
  const tx2 = await t.burn(got, opts);
  const rc2 = await tx2.wait(); if (rc2.status !== 1) throw new Error("burn failed " + tx2.hash);
  console.log("burned", ethers.formatEther(got), "tx", tx2.hash, "| totalSupply now", ethers.formatEther(await t.totalSupply()), "| deployer ETH left", ethers.formatEther(await p.getBalance(w.address)));
})().catch((e) => { console.error("FAILED", e.shortMessage || e.message); process.exit(1); });
