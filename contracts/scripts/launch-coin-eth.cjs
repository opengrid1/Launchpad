/* eslint-disable no-console */
// Launches a coin on the mainnet StockPad factory from the deployer wallet.
//   NAME, SYMBOL, PAIR (address or "ETH"), DESC, LOGO_FILE (data URI text),
//   WEBSITE, TWITTER, TELEGRAM (optional), RPC_URL (optional)
// Records the coin under deployments/ethereum-stockpad.json -> coins[].
const fs = require("fs"); const path = require("path");
const { ethers } = require("ethers");
const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts-size/contracts/v4/eth/StockPadFactory.sol/StockPadFactory.json"), "utf8")).abi;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const FACTORY = process.env.FACTORY || "0x88e21f36829f692FA1fF29fcC8Cc5E61afE77922";
(async () => {
  const { NAME, SYMBOL, DESC } = process.env;
  if (!NAME || !SYMBOL || !process.env.PAIR || !process.env.PRIVATE_KEY) throw new Error("NAME, SYMBOL, PAIR, PRIVATE_KEY required");
  const pair = process.env.PAIR.toUpperCase() === "ETH" ? WETH : ethers.getAddress(process.env.PAIR);
  const logo = process.env.LOGO_FILE ? fs.readFileSync(process.env.LOGO_FILE, "utf8").trim() : undefined;
  const meta = JSON.stringify({ description: DESC || "", ...(logo ? { logo } : {}), website: process.env.WEBSITE || "https://www.stonkreum.fun", twitter: process.env.TWITTER || "https://x.com/stonkreum", ...(process.env.TELEGRAM ? { telegram: process.env.TELEGRAM } : {}) });
  const p = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://ethereum-rpc.publicnode.com", 1, { staticNetwork: true, batchMaxCount: 1 });
  const w = new ethers.Wallet(process.env.PRIVATE_KEY, p);
  const f = new ethers.Contract(FACTORY, ABI, w);
  const q = await f.quoteAssets(pair);
  if (!q.approved) throw new Error("pair not approved: " + pair);
  const pairSym = pair === WETH ? "ETH" : await new ethers.Contract(pair, ["function symbol() view returns (string)"], p).symbol();
  console.log("deployer", w.address, "bal", ethers.formatEther(await p.getBalance(w.address)), "| pair", pairSym, "| meta bytes", Buffer.byteLength(meta));
  const n = Number(await f.totalTokens());
  const params = { name: NAME, symbol: SYMBOL, metadataURI: meta, pair };
  const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now())), 32);
  const gas = await f.launch.estimateGas(params, salt, "0x");
  const fee = await p.getFeeData();
  const opts = { gasLimit: (gas * 105n) / 100n, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: 50_000_000n };
  console.log("gas", gas.toString(), "max cost", ethers.formatEther(opts.gasLimit * fee.maxFeePerGas), "ETH");
  const tx = await f.launch(params, salt, "0x", opts);
  console.log("tx", tx.hash);
  const rc = await tx.wait();
  if (rc.status !== 1) throw new Error("launch failed " + tx.hash);
  const token = await f.allTokens(n);
  console.log("launched", SYMBOL, token, "block", rc.blockNumber, "gasUsed", rc.gasUsed.toString(), "| bal left", ethers.formatEther(await p.getBalance(w.address)));
  const depFile = path.join(__dirname, "..", "deployments", "ethereum-stockpad.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  dep.coins = dep.coins || [];
  dep.coins.push({ name: NAME, symbol: SYMBOL, address: token, pair: pairSym, pairAddress: pair, block: rc.blockNumber, tx: tx.hash });
  fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
})().catch((e) => { console.error("FAILED", e.shortMessage || e.message || e); process.exit(1); });
