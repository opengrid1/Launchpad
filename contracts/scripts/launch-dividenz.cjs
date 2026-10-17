const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// The official Dividenz token, paired with WETH (holders earn ETH).
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = "0x7B7C415898C3DFF9535d3eE12919ff4f48E8e8a3";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";

const FACTORY_ABI = [
  "function launch((string name,string symbol,string metadataURI,address pair,uint16 taxBps,uint256 pairUsdPrice8) p, bytes32 salt) returns (address token, bytes32 poolId)",
  "event Launched(address indexed token, address indexed creator, address indexed pair, uint16 taxBps, bytes32 poolId)",
];
const V3F_ABI = ["function getPool(address,address,uint24) view returns(address)"];
const V3POOL_ABI = ["function slot0() view returns(uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)", "function token0() view returns(address)"];

async function ethUsd(provider) {
  // Read live ETH/USDG price from the canonical WETH/USDG V3 pool (both 18-dec,
  // USDG = $1). Fall back to a snapshot if the pool can't be read.
  for (const fee of [100, 500, 3000, 10000]) {
    const pool = await new ethers.Contract(V3_FACTORY, V3F_ABI, provider).getPool(WETH, USDG, fee).catch(() => ethers.ZeroAddress);
    if (pool === ethers.ZeroAddress) continue;
    const c = new ethers.Contract(pool, V3POOL_ABI, provider);
    const [s0, t0] = await Promise.all([c.slot0(), c.token0()]);
    const sqrt = Number(s0.sqrtPriceX96) / 2 ** 96;
    const p = sqrt * sqrt; // token1 per token0
    const wethIs0 = t0.toLowerCase() === WETH.toLowerCase();
    const usd = wethIs0 ? p : 1 / p; // USDG(≈$1) per WETH
    if (usd > 50 && usd < 100000) return usd;
  }
  return 1855;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const env = fs.readFileSync(path.join(__dirname, "../.env.robinhood-deployer"), "utf8");
  const pk = env.match(/(0x[0-9a-fA-F]{64})/)[1];
  const wallet = new ethers.Wallet(pk, provider);
  console.log("creator:", wallet.address, "| bal:", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");

  const usd = await ethUsd(provider);
  console.log("live ETH/USD:", usd.toFixed(2));

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);
  const metadata = JSON.stringify({
    description: "Dividenz — the launchpad token. Hold DIVIDENZ, earn ETH from every buy. dividendz.fun",
    website: "https://dividendz.fun",
    image: "https://dividendz.fun/dividenz-feather.png",
  });
  const params = {
    name: "Dividenz",
    symbol: "DIVIDENZ",
    metadataURI: metadata,
    pair: WETH,
    taxBps: 100, // 1%
    pairUsdPrice8: BigInt(Math.round(usd * 1e8)),
  };
  const salt = ethers.hexlify(ethers.randomBytes(32));
  console.log("launching Dividenz (DIVIDENZ) paired with ETH…");
  const tx = await factory.launch(params, salt);
  console.log("tx:", tx.hash);
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "Launched");
  const token = ev.args.token;
  console.log("✅ launched:", token, "| poolId:", ev.args.poolId, "| gas:", rc.gasUsed.toString());

  fs.writeFileSync(path.join(__dirname, "../deployments/dividenz-launch.json"), JSON.stringify({
    name: "Dividenz", symbol: "DIVIDENZ", token, pair: WETH, poolId: ev.args.poolId,
    creator: wallet.address, factory: FACTORY, txHash: tx.hash, block: rc.blockNumber, ethUsdAtLaunch: usd,
  }, null, 2));
  console.log("bal after:", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
