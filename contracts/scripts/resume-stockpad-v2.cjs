const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// Resume stockpad v2: register any still-unapproved quote assets on the v2
// factory (idempotent), with per-quote retry to ride out the RPC's transient
// "could not coalesce" bursts, then transfer ownership to the final owner.
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = "0x80b16b2E6bba2C82A2991E048C10EFcDdb99598E";
const TOKEN_DEPLOYER = "0x28cA10C48E7C0eF16F356b33284968Da2A5bbD2C";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const FINAL_OWNER = "0x0315eCb53F64b7A4bA56bb8A4DAB0D96F0856b60";
const WETH_USD8 = "185500000000", USDG_USD8 = "100000000";
const dir = "/tmp/claude-0/-home-user-Launchpad/dfc4f013-9c73-51ea-a5ff-a0c98e61bbc5/scratchpad/";
const key = () => fs.readFileSync(path.join(__dirname, "..", ".env.robinhood-deployer"), "utf8").match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const p = new ethers.JsonRpcProvider(RPC, 4663);
  const w = new ethers.Wallet(key(), p);
  const abi = [
    "function owner() view returns (address)",
    "function quoteAssets(address) view returns (bool approved, uint64 usdPrice8, uint8 decimals)",
    "function setQuoteAsset(address quote, bool approved, uint64 usdPrice8)",
    "function transferOwnership(address)",
  ];
  const f = new ethers.Contract(FACTORY, abi, w);
  const prices = JSON.parse(fs.readFileSync(dir + "rh-final-prices.json", "utf8"));
  const quotes = [
    { sym: "WETH", address: WETH, usd8: WETH_USD8 },
    { sym: "USDG", address: USDG, usd8: USDG_USD8 },
    ...prices.map((q) => ({ sym: q.sym, address: q.address, usd8: q.usd8 })),
  ];
  const fees = () => ({ gasLimit: 150_000, maxPriorityFeePerGas: 0n });

  let done = 0, skip = 0, failn = 0;
  for (const q of quotes) {
    let cur;
    try { cur = await f.quoteAssets(q.address); } catch { await sleep(500); try { cur = await f.quoteAssets(q.address); } catch { cur = null; } }
    if (cur && cur.approved) { skip++; continue; }
    let ok = false;
    for (let attempt = 1; attempt <= 5 && !ok; attempt++) {
      try {
        const fee = await p.getFeeData();
        const maxFeePerGas = ((fee.gasPrice ?? 600_000_000n) * 16n) / 10n;
        const tx = await f.setQuoteAsset(q.address, true, BigInt(q.usd8), { ...fees(), maxFeePerGas });
        await tx.wait();
        ok = true; done++;
        if (done % 10 === 0) console.log(`  registered ${done} (skip ${skip}) ...`);
      } catch (e) {
        if (attempt === 5) { failn++; console.log(`  FAIL ${q.sym}: ${e.shortMessage || e.message}`); }
        else await sleep(800 * attempt);
      }
    }
  }
  console.log(`quotes: ${done} new, ${skip} already, ${failn} failed`);

  // transfer ownership (retry)
  const owner = await f.owner();
  if (owner.toLowerCase() === w.address.toLowerCase() && failn === 0) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const fee = await p.getFeeData();
        const tx = await f.transferOwnership(FINAL_OWNER, { gasLimit: 100_000, maxPriorityFeePerGas: 0n, maxFeePerGas: ((fee.gasPrice ?? 600_000_000n) * 16n) / 10n });
        await tx.wait();
        console.log("ownership ->", FINAL_OWNER);
        break;
      } catch (e) { if (attempt === 5) console.log("transferOwnership FAIL:", e.shortMessage || e.message); else await sleep(800 * attempt); }
    }
  } else if (failn > 0) {
    console.log("holding ownership: still", failn, "quotes unregistered; re-run to finish before transfer");
  } else {
    console.log("owner already", owner);
  }

  // finalize record only when everything is done
  const ownerNow = await f.owner();
  if (ownerNow.toLowerCase() === FINAL_OWNER.toLowerCase()) {
    const rec = {
      network: "robinhood", chainId: 4663, version: "v2-antisnipe",
      contracts: { tokenDeployer: TOKEN_DEPLOYER, factory: FACTORY },
      owner: FINAL_OWNER, feeRecipient: FINAL_OWNER,
      quoteAsset: { symbol: "USDG", address: USDG, decimals: 6 }, wrappedNative: WETH,
      uniswapV3: { factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA", positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3", swapRouter: "0xCaf681a66D020601342297493863E78C959E5cb2" },
      startBlock: await p.getBlockNumber(),
      quotesRegistered: quotes.length,
      config: { poolFeeTier: 10000, holderFeeBps: 5000, creatorFeeBps: 4000, platformFeeBps: 1000, antiSnipe: { protectBlocks: 2, maxHoldBps: 500, maxBuyBps: 550 } },
    };
    fs.writeFileSync(path.join(__dirname, "..", "deployments", "stockpad-v2.json"), JSON.stringify(rec, null, 2));
    console.log("saved deployments/stockpad-v2.json");
  }
  console.log("balance left:", ethers.formatEther(await p.getBalance(w.address)), "ETH");
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
