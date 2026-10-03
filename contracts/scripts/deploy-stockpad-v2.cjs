const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// Stockpad v2: redeploy StableLaunchpadFactory on Robinhood Chain with the
// anti-snipe SquidRewardToken (pons-style launch protection). Direct ethers,
// tight gas. Deploy with the deployer as owner so it can register quotes, then
// transfer ownership to the final owner.
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN = 4663;
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const POSITION_MANAGER = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
const SWAP_ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const FINAL_OWNER = "0x0315eCb53F64b7A4bA56bb8A4DAB0D96F0856b60";
const HOLDER_FEE_BPS = 5000, CREATOR_FEE_BPS = 4000, POOL_FEE_TIER = 10000;
const WETH_USD8 = "185500000000", USDG_USD8 = "100000000";

const ART = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts-size", rel), "utf8"));
const dir = "/tmp/claude-0/-home-user-Launchpad/dfc4f013-9c73-51ea-a5ff-a0c98e61bbc5/scratchpad/";
const key = () => fs.readFileSync(path.join(__dirname, "..", ".env.robinhood-deployer"), "utf8").match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];
const OUT = path.join(__dirname, "..", "deployments", "stockpad-v2.json");

async function main() {
  const p = new ethers.JsonRpcProvider(RPC, CHAIN);
  const w = new ethers.Wallet(key(), p);
  console.log("deployer:", w.address, "|", ethers.formatEther(await p.getBalance(w.address)), "ETH");

  const fee = await p.getFeeData();
  const maxFee = ((fee.gasPrice ?? 600_000_000n) * 16n) / 10n;
  const F = { maxFeePerGas: maxFee, maxPriorityFeePerGas: 0n };
  console.log("maxFeePerGas:", ethers.formatUnits(maxFee, "gwei"), "gwei");

  // resume support: reuse addresses if a partial run saved them
  let state = {};
  try { state = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
  const depArt = ART("contracts/stable/SquidTokenDeployer.sol/SquidTokenDeployer.json");
  const facArt = ART("contracts/stable/StableLaunchpadFactory.sol/StableLaunchpadFactory.json");

  // 1) SquidTokenDeployer
  let depAddr = state.tokenDeployer;
  if (!depAddr) {
    const d = await new ethers.ContractFactory(depArt.abi, depArt.bytecode, w).deploy({ gasLimit: 3_000_000, ...F });
    await d.waitForDeployment();
    depAddr = await d.getAddress();
    console.log("SquidTokenDeployer:", depAddr);
  } else console.log("reuse SquidTokenDeployer:", depAddr);

  // 2) StableLaunchpadFactory (owner = deployer for setup)
  let facAddr = state.factory;
  if (!facAddr) {
    const f = await new ethers.ContractFactory(facArt.abi, facArt.bytecode, w).deploy(
      w.address, FINAL_OWNER, depAddr, V3_FACTORY, POSITION_MANAGER, SWAP_ROUTER, WETH,
      HOLDER_FEE_BPS, CREATOR_FEE_BPS, POOL_FEE_TIER, { gasLimit: 6_000_000, ...F },
    );
    await f.waitForDeployment();
    facAddr = await f.getAddress();
    console.log("StableLaunchpadFactory:", facAddr);
  } else console.log("reuse factory:", facAddr);

  fs.writeFileSync(OUT, JSON.stringify({ tokenDeployer: depAddr, factory: facAddr }, null, 2));

  const dep = new ethers.Contract(depAddr, depArt.abi, w);
  const fac = new ethers.Contract(facAddr, facArt.abi, w);

  // 3) wire deployer -> factory (idempotent)
  try {
    const cur = await dep.factory().catch(() => ethers.ZeroAddress);
    if (cur.toLowerCase() !== facAddr.toLowerCase()) {
      await (await dep.setFactory(facAddr, { gasLimit: 150_000, ...F })).wait();
      console.log("tokenDeployer.setFactory done");
    } else console.log("deployer.factory already set");
  } catch (e) { console.log("setFactory:", e.shortMessage || e.message); }

  // 4) register quotes (deployer is owner here). Idempotent.
  const prices = JSON.parse(fs.readFileSync(dir + "rh-final-prices.json", "utf8"));
  const quotes = [
    { sym: "WETH", address: WETH, usd8: WETH_USD8 },
    { sym: "USDG", address: USDG, usd8: USDG_USD8 },
    ...prices.map((q) => ({ sym: q.sym, address: q.address, usd8: q.usd8 })),
  ];
  let done = 0, skip = 0, failn = 0;
  for (const q of quotes) {
    try {
      const cur = await fac.quoteAssets(q.address);
      if (cur.approved) { skip++; continue; }
      await (await fac.setQuoteAsset(q.address, true, BigInt(q.usd8), { gasLimit: 150_000, ...F })).wait();
      done++;
      if (done % 20 === 0) console.log(`  registered ${done} (skip ${skip}) ...`);
    } catch (e) { failn++; console.log(`  FAIL ${q.sym}: ${e.shortMessage || e.message}`); }
  }
  console.log(`quotes: ${done} new, ${skip} already, ${failn} failed`);

  // 5) transfer ownership to final owner
  const owner = await fac.owner();
  if (owner.toLowerCase() === w.address.toLowerCase()) {
    await (await fac.transferOwnership(FINAL_OWNER, { gasLimit: 100_000, ...F })).wait();
    console.log("ownership -> ", FINAL_OWNER);
  } else console.log("owner already", owner);

  const rec = {
    network: "robinhood", chainId: CHAIN, version: "v2-antisnipe",
    contracts: { tokenDeployer: depAddr, factory: facAddr },
    owner: FINAL_OWNER, feeRecipient: FINAL_OWNER,
    quoteAsset: { symbol: "USDG", address: USDG, decimals: 6 },
    wrappedNative: WETH,
    uniswapV3: { factory: V3_FACTORY, positionManager: POSITION_MANAGER, swapRouter: SWAP_ROUTER },
    startBlock: await p.getBlockNumber(),
    quotesRegistered: quotes.length,
    config: { poolFeeTier: POOL_FEE_TIER, holderFeeBps: HOLDER_FEE_BPS, creatorFeeBps: CREATOR_FEE_BPS, platformFeeBps: 1000,
      antiSnipe: { protectBlocks: 2, maxHoldBps: 500, maxBuyBps: 550 } },
  };
  fs.writeFileSync(OUT, JSON.stringify(rec, null, 2));
  console.log("saved deployments/stockpad-v2.json | balance left:", ethers.formatEther(await p.getBalance(w.address)), "ETH");
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
