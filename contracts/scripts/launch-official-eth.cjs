/* eslint-disable no-console */
// Launches the official Stonkreum coin on mainnet: "Stonkreum.fun" / STONKREUM,
// paired with ETH, seal logo on-chain. Plain ethers with timeouts + RPC rotation.
//   PRIVATE_KEY=... FACTORY=0x... LOGO_FILE=<data-uri file> node scripts/launch-official-eth.cjs
const fs = require("fs"); const path = require("path");
const { ethers } = require("ethers");
const RPCS = ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth", "https://ethereum.publicnode.com"];
const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts-size/contracts/v4/eth/StockPadFactory.sol/StockPadFactory.json"), "utf8")).abi;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${what}`)), ms))]);
let i = 0; const provider = () => new ethers.JsonRpcProvider(RPCS[i % RPCS.length], 1, { staticNetwork: true, batchMaxCount: 1 });
async function retry(fn, what) { for (let k = 0; k < 8; k++) { try { return await withTimeout(fn(provider()), 45_000, what); } catch (e) { i++; console.log("  rpc ->", RPCS[i % RPCS.length], String(e.message).slice(0, 70)); await new Promise((r) => setTimeout(r, 2000)); } } throw new Error("gave up " + what); }
(async () => {
  const pk = process.env.PRIVATE_KEY, FACTORY = process.env.FACTORY;
  const logo = fs.readFileSync(process.env.LOGO_FILE, "utf8").trim();
  const meta = JSON.stringify({ description: "Certificate of Stonk Ownership. The official coin of Stonkreum. Holders are paid on every trade, on the spot, for as long as they hold. Redeemable in vibes.", logo, website: "https://www.stonkreum.fun", twitter: "https://x.com/stonkreum" });
  const me = new ethers.Wallet(pk).address;
  console.log("deployer", me, "bal", ethers.formatEther(await retry((p) => p.getBalance(me), "balance")), "meta bytes", Buffer.byteLength(meta));
  const p0 = provider(); const w = new ethers.Wallet(pk, p0); const f = new ethers.Contract(FACTORY, ABI, w);
  const n = Number(await retry((p) => new ethers.Contract(FACTORY, ABI, p).totalTokens(), "totalTokens"));
  const params = { name: "Stonkreum.fun", symbol: "STONKREUM", metadataURI: meta, pair: WETH };
  const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now())), 32);
  const gas = await retry((p) => new ethers.Contract(FACTORY, ABI, p).launch.estimateGas(params, salt, "0x", { from: me }), "estimateGas");
  const fee = await retry((p) => p.getFeeData(), "feeData");
  console.log("estimated gas", gas.toString(), "max cost", ethers.formatEther((gas * 105n / 100n) * fee.maxFeePerGas), "ETH");
  const tx = await f.launch(params, salt, "0x", { gasLimit: (gas * 105n) / 100n, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: 50_000_000n, nonce: await retry((p) => p.getTransactionCount(me, "pending"), "nonce") });
  console.log("tx", tx.hash);
  let rc = null; for (let k = 0; k < 40 && !rc; k++) { rc = await retry((p) => p.getTransactionReceipt(tx.hash), "receipt").catch(() => null); if (!rc) await new Promise((r) => setTimeout(r, 6000)); }
  if (!rc || rc.status !== 1) throw new Error("launch failed " + tx.hash);
  const token = await retry((p) => new ethers.Contract(FACTORY, ABI, p).allTokens(n), "allTokens");
  console.log("launched STONKREUM", token, "block", rc.blockNumber, "gasUsed", rc.gasUsed.toString(), "bal left", ethers.formatEther(await retry((p) => p.getBalance(me), "balance")));
  const depFile = path.join(__dirname, "..", "deployments", "ethereum-stockpad.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  dep.officialToken = { name: "Stonkreum.fun", symbol: "STONKREUM", address: token, pair: "ETH", block: rc.blockNumber, tx: tx.hash };
  fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
})().catch((e) => { console.error("FAILED", e.message || e); process.exit(1); });
