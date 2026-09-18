/* eslint-disable no-console */
// Launches a coin on the Etherstock factory on mainnet, paired with ETH, the
// mark on-chain. Defaults to a test coin; NAME/SYMBOL/DESC/KEY override.
// Plain ethers with timeouts + RPC rotation.
//   PRIVATE_KEY=... FACTORY=0x... LOGO_FILE=<data-uri file> [GAS_PRICE_WEI=250000000] \
//   [NAME="Etherstock.fun" SYMBOL=ETHERSTOCK KEY=officialToken] node scripts/launch-official-etherstock.cjs
const fs = require("fs"); const path = require("path");
const { ethers } = require("ethers");
const RPCS = ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth", "https://ethereum.publicnode.com"];
const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts-size/contracts/v4/etherstock/EtherStockFactory.sol/EtherStockFactory.json"), "utf8")).abi;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${what}`)), ms))]);
let i = 0; const provider = () => new ethers.JsonRpcProvider(RPCS[i % RPCS.length], 1, { staticNetwork: true, batchMaxCount: 1 });
async function retry(fn, what) { for (let k = 0; k < 8; k++) { try { return await withTimeout(fn(provider()), 45_000, what); } catch (e) { i++; console.log("  rpc ->", RPCS[i % RPCS.length], String(e.message).slice(0, 70)); await new Promise((r) => setTimeout(r, 2000)); } } throw new Error("gave up " + what); }
(async () => {
  const pk = process.env.PRIVATE_KEY, FACTORY = process.env.FACTORY;
  const logo = fs.readFileSync(process.env.LOGO_FILE, "utf8").trim();
  const NAME = process.env.NAME ?? "Etherstock Test", SYMBOL = process.env.SYMBOL ?? "ESTEST", KEY = process.env.KEY ?? "testToken";
  const DESC = process.env.DESC ?? (KEY === "officialToken" ? "The official coin of Etherstock. 30% of every trade fee buys it back from its own pool and burns it, forever. Supply only goes down." : "Test coin. Not the official coin, hidden from the board.");
  const meta = JSON.stringify({ description: DESC, logo, website: "https://www.etherstock.fun", twitter: "https://x.com/Etherstock_" });
  const me = new ethers.Wallet(pk).address;
  console.log("deployer", me, "bal", ethers.formatEther(await retry((p) => p.getBalance(me), "balance")), "meta bytes", Buffer.byteLength(meta));
  const p0 = provider(); const w = new ethers.Wallet(pk, p0); const f = new ethers.Contract(FACTORY, ABI, w);
  const n = Number(await retry((p) => new ethers.Contract(FACTORY, ABI, p).totalTokens(), "totalTokens"));
  const params = { name: NAME, symbol: SYMBOL, metadataURI: meta, pair: WETH };
  const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now())), 32);
  const gas = await retry((p) => new ethers.Contract(FACTORY, ABI, p).launch.estimateGas(params, salt, "0x", { from: me }), "estimateGas");
  const fee = await retry((p) => p.getFeeData(), "feeData");
  const gasPrice = process.env.GAS_PRICE_WEI ? BigInt(process.env.GAS_PRICE_WEI) : null;
  console.log("estimated gas", gas.toString(), "max cost", ethers.formatEther((gas * 105n / 100n) * (gasPrice ?? fee.maxFeePerGas)), "ETH");
  const nonce = await retry((p) => p.getTransactionCount(me, "pending"), "nonce");
  const tx = await f.launch(params, salt, "0x", gasPrice
    ? { gasLimit: (gas * 105n) / 100n, gasPrice, nonce }
    : { gasLimit: (gas * 105n) / 100n, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: 50_000_000n, nonce });
  console.log("tx", tx.hash);
  let rc = null; for (let k = 0; k < 60 && !rc; k++) { rc = await retry((p) => p.getTransactionReceipt(tx.hash), "receipt").catch(() => null); if (!rc) await new Promise((r) => setTimeout(r, 6000)); }
  if (!rc || rc.status !== 1) throw new Error("launch failed " + tx.hash);
  const token = await retry((p) => new ethers.Contract(FACTORY, ABI, p).allTokens(n), "allTokens");
  console.log("launched", SYMBOL, token, "block", rc.blockNumber, "gasUsed", rc.gasUsed.toString(), "bal left", ethers.formatEther(await retry((p) => p.getBalance(me), "balance")));
  const depFile = path.join(__dirname, "..", "deployments", "ethereum-etherstock.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  dep[KEY] = { name: NAME, symbol: SYMBOL, address: token, pair: "ETH", block: rc.blockNumber, tx: tx.hash };
  fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
})().catch((e) => { console.error("FAILED", e.message || e); process.exit(1); });
