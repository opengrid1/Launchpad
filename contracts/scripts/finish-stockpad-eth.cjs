/* eslint-disable no-console */
// Finishes a mainnet Stonkreum deploy with plain ethers: approves any pair
// from deployments/ethereum-stock-quotes.json not yet approved on-chain,
// renounces factory ownership, and (LAUNCH=1) launches the test coin.
// Every RPC call has a timeout and the endpoint rotates on failure.
//   PRIVATE_KEY=... FACTORY=0x... [LAUNCH=1] node scripts/finish-stockpad-eth.cjs
const fs = require("fs"); const path = require("path");
const { ethers } = require("ethers");
const RPCS = ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth", "https://ethereum.publicnode.com", "https://eth.drpc.org"];
const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts-size/contracts/v4/eth/StockPadFactory.sol/StockPadFactory.json"), "utf8")).abi;
const TOKEN_ABI = ["function balanceOf(address) view returns (uint256)"];
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", NVDA = "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE";
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const NVDA_ROUTE = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [ethers.solidityPacked(["address", "uint24", "address"], [WETH, 500, USDC]), { currency0: NVDA, currency1: USDC, fee: 9000, tickSpacing: 90, hooks: ethers.ZeroAddress }]);
const LOGO = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0D1017"/><polygon points="32,12 47,34 32,43 17,34" fill="#F1F2F5"/><polygon points="32,47 47,38 32,56 17,38" fill="#F1F2F5"/></svg>').toString("base64");
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${what}`)), ms))]);
let rpcIdx = 0;
const provider = () => new ethers.JsonRpcProvider(RPCS[rpcIdx % RPCS.length], 1, { staticNetwork: true, batchMaxCount: 1 });
const rotate = (why) => { rpcIdx++; console.log("  rpc ->", RPCS[rpcIdx % RPCS.length], "(" + String(why).slice(0, 80) + ")"); };
async function retry(fn, what, tries = 8) {
  for (let i = 0; i < tries; i++) { try { return await withTimeout(fn(provider()), 45_000, what); } catch (e) { rotate(e.message || e); await new Promise((r) => setTimeout(r, 2000)); } }
  throw new Error("gave up: " + what);
}
async function waitMined(hash) {
  for (let i = 0; i < 40; i++) {
    const rc = await retry((p) => p.getTransactionReceipt(hash), "receipt " + hash.slice(0, 10)).catch(() => null);
    if (rc) return rc;
    await new Promise((r) => setTimeout(r, 6000));
  }
  throw new Error("not mined: " + hash);
}
async function send(pk, build, what) {
  const p = provider(); const w = new ethers.Wallet(pk, p);
  const nonce = await retry((pp) => pp.getTransactionCount(w.address, "pending"), "nonce");
  const fee = await retry((pp) => pp.getFeeData(), "feeData");
  const tx = await build(w, { nonce, maxFeePerGas: fee.maxFeePerGas * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 1_000_000_000n });
  console.log(" ", what, "tx", tx.hash);
  const rc = await waitMined(tx.hash);
  if (rc.status !== 1) throw new Error(what + " reverted " + tx.hash);
  return { tx, rc };
}
(async () => {
  const pk = process.env.PRIVATE_KEY; const FACTORY = process.env.FACTORY;
  const depFile = path.join(__dirname, "..", "deployments", "ethereum-stockpad.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  const quotes = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ethereum-stock-quotes.json"), "utf8")).quotes;
  const me = new ethers.Wallet(pk).address;
  console.log("deployer", me, "factory", FACTORY, "bal", ethers.formatEther(await retry((p) => p.getBalance(me), "balance")));
  const have = new Set(dep.quotes.map((q) => q.address.toLowerCase()));
  for (const q of quotes) {
    if (!(q.usd > 0)) continue;
    const qa = await retry((p) => new ethers.Contract(FACTORY, ABI, p).quoteAssets(q.address), "quoteAssets " + q.symbol);
    const usd8 = BigInt(Math.round(q.usd * 1e8));
    if (qa.approved) { if (!have.has(q.address.toLowerCase())) { dep.quotes.push({ symbol: q.symbol, address: q.address, usd: q.usd, usd8: usd8.toString() }); have.add(q.address.toLowerCase()); console.log("  = already approved", q.symbol); } continue; }
    await send(pk, (w, o) => new ethers.Contract(FACTORY, ABI, w).setQuoteAsset(q.address, true, usd8, ethers.ZeroAddress, o), "approve " + q.symbol + " $" + q.usd);
    dep.quotes.push({ symbol: q.symbol, address: q.address, usd: q.usd, usd8: usd8.toString() }); have.add(q.address.toLowerCase());
    fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  }
  fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  console.log("approved on-chain:", (await retry((p) => new ethers.Contract(FACTORY, ABI, p).quoteCount(), "quoteCount")).toString(), "(incl. WETH)");
  const owner = await retry((p) => new ethers.Contract(FACTORY, ABI, p).owner(), "owner");
  if (owner.toLowerCase() === me.toLowerCase()) { await send(pk, (w, o) => new ethers.Contract(FACTORY, ABI, w).renounceOwnership(o), "renounceOwnership"); }
  console.log("owner now", await retry((p) => new ethers.Contract(FACTORY, ABI, p).owner(), "owner"), "admin", await retry((p) => new ethers.Contract(FACTORY, ABI, p).admin(), "admin"));
  if (process.env.LAUNCH === "1") {
    const n = Number(await retry((p) => new ethers.Contract(FACTORY, ABI, p).totalTokens(), "totalTokens"));
    const meta = JSON.stringify({ description: "First coin on Stonkreum. A test launch paired with NVDAon: every trade pays holders in NVIDIA.", logo: LOGO, twitter: "https://x.com/stonkreum" });
    const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now())), 32);
    const value = ethers.parseEther(process.env.DEV_BUY ?? "0.001");
    const { rc } = await send(pk, (w, o) => new ethers.Contract(FACTORY, ABI, w).launch({ name: "Stonkreum Test", symbol: "STEST", metadataURI: meta, pair: NVDA }, salt, NVDA_ROUTE, { ...o, value, gasLimit: 3_900_000 }), "launch STEST");
    const token = await retry((p) => new ethers.Contract(FACTORY, ABI, p).allTokens(n), "allTokens");
    const held = await retry((p) => new ethers.Contract(token, TOKEN_ABI, p).balanceOf(me), "balanceOf");
    console.log("launched STEST", token, "block", rc.blockNumber, "gasUsed", rc.gasUsed.toString(), "creator holds", ethers.formatEther(held));
    dep.testToken = { symbol: "STEST", address: token, block: rc.blockNumber, tx: rc.hash };
    fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  }
  console.log("bal left", ethers.formatEther(await retry((p) => p.getBalance(me), "balance")));
})().catch((e) => { console.error("FAILED", e.message || e); process.exit(1); });
