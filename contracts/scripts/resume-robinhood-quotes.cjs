const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// Resume the Robinhood Chain factory setup: register any quote assets not yet
// approved on the already-deployed factory, then transfer ownership. Idempotent
// (skips approved quotes), so it is safe to re-run.
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = "0xDaE6C39084485B88b457Da4F9446C9aEAd94D0eB";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const FINAL_OWNER = "0x0315eCb53F64b7A4bA56bb8A4DAB0D96F0856b60";
const dir = "/tmp/claude-0/-home-user-Launchpad/dfc4f013-9c73-51ea-a5ff-a0c98e61bbc5/scratchpad/";

function key() {
  return fs.readFileSync(path.join(__dirname, "..", ".env.robinhood-deployer"), "utf8").match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];
}
const ABI = [
  "function owner() view returns (address)",
  "function quoteAssets(address) view returns (bool approved, uint64 usdPrice8, uint8 decimals)",
  "function setQuoteAsset(address quote, bool approved, uint64 usdPrice8)",
  "function transferOwnership(address)",
];

async function main() {
  const p = new ethers.JsonRpcProvider(RPC, 4663);
  const w = new ethers.Wallet(key(), p);
  const f = new ethers.Contract(FACTORY, ABI, w);
  const fees = { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n };

  const prices = JSON.parse(fs.readFileSync(dir + "rh-final-prices.json", "utf8"));
  const quotes = [
    { sym: "WETH", address: WETH, usd8: "185500000000" },
    { sym: "USDG", address: USDG, usd8: "100000000" },
    ...prices.map((q) => ({ sym: q.sym, address: q.address, usd8: q.usd8 })),
  ];

  let done = 0, skipped = 0, failed = 0;
  for (const q of quotes) {
    try {
      const cur = await f.quoteAssets(q.address);
      if (cur.approved) { skipped++; continue; }
      const tx = await f.setQuoteAsset(q.address, true, BigInt(q.usd8), { gasLimit: 200_000, ...fees });
      await tx.wait();
      done++;
      if (done % 10 === 0) console.log(`  registered ${done} (skipped ${skipped}) ...`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${q.sym} ${q.address}: ${e.shortMessage || e.message}`);
    }
  }
  console.log(`quotes: ${done} newly registered, ${skipped} already approved, ${failed} failed`);

  // Transfer ownership if still ours
  const owner = await f.owner();
  if (owner.toLowerCase() === w.address.toLowerCase()) {
    const tx = await f.transferOwnership(FINAL_OWNER, { gasLimit: 100_000, ...fees });
    await tx.wait();
    console.log("ownership transferred to", FINAL_OWNER);
  } else {
    console.log("owner already", owner);
  }

  const out = {
    network: "robinhood", chainId: 4663,
    contracts: { tokenDeployer: "0x73d18E06007CD8Bfc7ae7731e1F4c5DCD57CA5DF", factory: FACTORY },
    owner: FINAL_OWNER, feeRecipient: "0x0315eCb53F64b7A4bA56bb8A4DAB0D96F0856b60",
    quoteAsset: { symbol: "USDG", address: USDG, decimals: 6 },
    wrappedNative: WETH,
    uniswapV3: { factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA", positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3", swapRouter: "0xCaf681a66D020601342297493863E78C959E5cb2" },
    startBlock: await p.getBlockNumber(),
    quotesRegistered: quotes.length,
    config: { poolFeeTier: 10000, holderFeeBps: 5000, creatorFeeBps: 4000, platformFeeBps: 1000 },
  };
  fs.writeFileSync(path.join(__dirname, "..", "deployments", "robinhood-launchpad-v3.json"), JSON.stringify(out, null, 2));
  console.log("saved deployments/robinhood-launchpad-v3.json");
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
