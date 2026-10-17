/* eslint-disable no-console */
// Launches a coin on the Alicorn factory on Ethereum mainnet, paired with any
// ERC-20 the registry can price (or WETH). The signer is the coin's creator.
// Plain ethers with timeouts + RPC rotation; the deployer key is read from
// contracts/.env.deployer unless PRIVATE_KEY is set.
//   NAME=PAWSINU SYMBOL=PAWSINU PAIR=0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984 \
//   [DESC="..."] [LOGO_FILE=<data-uri file>] [WEBSITE=... TWITTER=...] [KEY=pawsinu] \
//   [GAS_PRICE_WEI=600000000] node scripts/launch-alicorn-coin.cjs
const fs = require("fs"); const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.deployer") });
const RPCS = ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth", "https://ethereum.publicnode.com"];
const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ethereum-alicorn.json"), "utf8"));
const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts-size/contracts/v4/alicorn/AlicornFactory.sol/AlicornFactory.json"), "utf8")).abi;
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${what}`)), ms))]);
let i = 0; const provider = () => new ethers.JsonRpcProvider(RPCS[i % RPCS.length], 1, { staticNetwork: true, batchMaxCount: 1 });
async function retry(fn, what) { for (let k = 0; k < 8; k++) { try { return await withTimeout(fn(provider()), 45_000, what); } catch (e) { i++; console.log("  rpc ->", RPCS[i % RPCS.length], String(e.message).slice(0, 70)); await new Promise((r) => setTimeout(r, 2000)); } } throw new Error("gave up " + what); }
(async () => {
  const pk = process.env.PRIVATE_KEY; if (!pk) throw new Error("no PRIVATE_KEY");
  const FACTORY = process.env.FACTORY ?? dep.contracts.factory;
  const NAME = process.env.NAME, SYMBOL = process.env.SYMBOL, KEY = process.env.KEY ?? SYMBOL.toLowerCase();
  if (!NAME || !SYMBOL) throw new Error("NAME and SYMBOL required");
  const PAIR = ethers.getAddress(process.env.PAIR ?? dep.uniswap.weth);
  const meta = {};
  if (process.env.DESC) meta.description = process.env.DESC;
  if (process.env.LOGO_FILE) meta.logo = fs.readFileSync(process.env.LOGO_FILE, "utf8").trim();
  if (process.env.WEBSITE) meta.website = process.env.WEBSITE;
  if (process.env.TWITTER) meta.twitter = process.env.TWITTER;
  const metadataURI = JSON.stringify(meta);
  const me = new ethers.Wallet(pk).address;
  console.log("creator", me, "bal", ethers.formatEther(await retry((p) => p.getBalance(me), "balance")), "factory", FACTORY, "pair", PAIR, "meta bytes", Buffer.byteLength(metadataURI));
  const p0 = provider(); const w = new ethers.Wallet(pk, p0); const f = new ethers.Contract(FACTORY, ABI, w);
  const n = Number(await retry((p) => new ethers.Contract(FACTORY, ABI, p).totalTokens(), "totalTokens"));
  const params = { name: NAME, symbol: SYMBOL, metadataURI, pair: PAIR };
  const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now())), 32);
  const gas = await retry((p) => new ethers.Contract(FACTORY, ABI, p).launch.estimateGas(params, salt, "0x", { from: me }), "estimateGas");
  const fee = await retry((p) => p.getFeeData(), "feeData");
  const gasPrice = process.env.GAS_PRICE_WEI ? BigInt(process.env.GAS_PRICE_WEI) : null;
  console.log("estimated gas", gas.toString(), "max cost", ethers.formatEther((gas * 105n / 100n) * (gasPrice ?? fee.maxFeePerGas)), "ETH");
  if (process.env.DRY) { console.log("dry run, not sending"); return; }
  const nonce = await retry((p) => p.getTransactionCount(me, "pending"), "nonce");
  const tx = await f.launch(params, salt, "0x", gasPrice
    ? { gasLimit: (gas * 105n) / 100n, gasPrice, nonce }
    : { gasLimit: (gas * 105n) / 100n, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: 50_000_000n, nonce });
  console.log("tx", tx.hash);
  let rc = null; for (let k = 0; k < 60 && !rc; k++) { rc = await retry((p) => p.getTransactionReceipt(tx.hash), "receipt").catch(() => null); if (!rc) await new Promise((r) => setTimeout(r, 6000)); }
  if (!rc || rc.status !== 1) throw new Error("launch failed " + tx.hash);
  const token = await retry((p) => new ethers.Contract(FACTORY, ABI, p).allTokens(n), "allTokens");
  console.log("launched", SYMBOL, token, "block", rc.blockNumber, "gasUsed", rc.gasUsed.toString(), "bal left", ethers.formatEther(await retry((p) => p.getBalance(me), "balance")));
  dep.coins = dep.coins ?? {};
  dep.coins[KEY] = { name: NAME, symbol: SYMBOL, address: token, pair: PAIR, creator: me, block: rc.blockNumber, tx: tx.hash };
  fs.writeFileSync(path.join(__dirname, "..", "deployments", "ethereum-alicorn.json"), JSON.stringify(dep, null, 2));
})().catch((e) => { console.error("FAILED", e.message || e); process.exit(1); });
