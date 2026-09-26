const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// One-off launch: RUNNER (ticker RUNNER) paired with RUN (Sunrun) on the
// Robinhood Chain StableLaunchpadFactory. Gas-only (no dev buy): the factory
// mints the full supply and seeds the coin single-sided against RUN.
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = "0xDaE6C39084485B88b457Da4F9446C9aEAd94D0eB";
const RUN = "0x756Bc80af765C82da966a788858d65aDF14f3793"; // Sunrun on Robinhood Chain

const NAME = "RUNNER";
const SYMBOL = "RUNNER";

const META = JSON.stringify({
  description: "",
  logo: "",
  website: "",
  twitter: "",
  telegram: "",
  pair: "RUN",
  pairAddress: RUN,
});

const ABI = [
  "function createToken((string name,string symbol,string metadataURI,address quote,uint256 marketCapUsd8,uint256 devBuyQuote) p) payable returns (address token, address pool, uint256 positionId)",
  "function quoteAssets(address) view returns (bool approved, uint64 usdPrice8, uint8 decimals)",
  "event TokenCreated(address indexed token, address indexed pool, string name, string symbol, string metadataURI, uint256 marketCapUsd8)",
];

function key() {
  return fs.readFileSync(path.join(__dirname, "..", ".env.robinhood-deployer"), "utf8").match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];
}

async function main() {
  const p = new ethers.JsonRpcProvider(RPC, 4663);
  const w = new ethers.Wallet(key(), p);
  const f = new ethers.Contract(FACTORY, ABI, w);

  // sanity: the pair must be an approved quote
  const q = await f.quoteAssets(RUN);
  if (!q.approved) throw new Error("RUN is not an approved quote on the factory");
  console.log("pair RUN approved | usd8:", q.usdPrice8.toString(), "dec:", q.decimals);

  const params = { name: NAME, symbol: SYMBOL, metadataURI: META, quote: RUN, marketCapUsd8: 0n, devBuyQuote: 0n };

  const bal = await p.getBalance(w.address);
  console.log("deployer:", w.address, "|", ethers.formatEther(bal), "ETH");

  const gas = await f.createToken.estimateGas(params);
  const fee = await p.getFeeData();
  // Keep gasLimit * maxFee under the wallet balance (the node checks the max up
  // front). Gas price here is ~0.375 gwei, so a modest cap + 12% buffer fits.
  const gasLimit = (gas * 112n) / 100n;
  let maxFee = ((fee.gasPrice ?? 400_000_000n) * 115n) / 100n;
  const cap = (bal * 90n) / 100n / gasLimit; // stay under 90% of balance
  if (maxFee > cap) maxFee = cap;
  console.log("gasLimit:", gasLimit.toString(), "maxFee:", maxFee.toString(), "| max cost:", ethers.formatEther(gasLimit * maxFee), "ETH");

  const tx = await f.createToken(params, { gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: 0n });
  console.log("tx sent:", tx.hash);
  const rc = await tx.wait();
  console.log("mined in block", rc.blockNumber, "| gas used", rc.gasUsed.toString());

  const ev = rc.logs.map((l) => { try { return f.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenCreated");
  if (ev) {
    console.log("TOKEN:", ev.args.token);
    console.log("POOL: ", ev.args.pool);
    fs.writeFileSync(path.join(__dirname, "..", "deployments", "runner-launch.json"), JSON.stringify({
      name: NAME, symbol: SYMBOL, token: ev.args.token, pool: ev.args.pool, pair: "RUN", pairAddress: RUN,
      factory: FACTORY, chainId: 4663, txHash: tx.hash, creator: w.address,
    }, null, 2));
    console.log("saved deployments/runner-launch.json");
  } else {
    console.log("TokenCreated event not found in receipt logs");
  }
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
