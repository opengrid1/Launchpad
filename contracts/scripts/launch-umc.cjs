const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// United Million Coin (UMC), paired with the UMC stock (United Microelectronics)
// on the live Dividenz V4 factory. Holders earn UMC stock.
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = "0x7B7C415898C3DFF9535d3eE12919ff4f48E8e8a3";
const UMC_STOCK = "0x0E6e67Ba88e7b5d9B67636A215c76779B948dE79";
const UMC_USD = 24.6;

const FACTORY_ABI = [
  "function launch((string name,string symbol,string metadataURI,address pair,uint16 taxBps,uint256 pairUsdPrice8) p, bytes32 salt) returns (address token, bytes32 poolId)",
  "event Launched(address indexed token, address indexed creator, address indexed pair, uint16 taxBps, bytes32 poolId)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const env = fs.readFileSync(path.join(__dirname, "../.env.robinhood-deployer"), "utf8");
  const pk = env.match(/(0x[0-9a-fA-F]{64})/)[1];
  const wallet = new ethers.Wallet(pk, provider);
  console.log("creator:", wallet.address, "| bal:", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);
  const metadata = JSON.stringify({
    description: "United Million Coin — hold UMC, earn UMC (United Microelectronics) stock, paid out like dividends.",
    image: "",
  });
  const params = {
    name: "United Million Coin",
    symbol: "UMC",
    metadataURI: metadata,
    pair: UMC_STOCK,
    taxBps: 100, // 1%
    pairUsdPrice8: BigInt(Math.round(UMC_USD * 1e8)),
  };
  const salt = ethers.hexlify(ethers.randomBytes(32));
  console.log("launching United Million Coin (UMC) paired with UMC stock…");
  const tx = await factory.launch(params, salt);
  console.log("tx:", tx.hash);
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "Launched");
  const token = ev.args.token;
  console.log("✅ launched coin:", token);
  console.log("   poolId:", ev.args.poolId);
  console.log("   pair (reward stock):", ev.args.pair);
  console.log("   gasUsed:", rc.gasUsed.toString());

  fs.writeFileSync(path.join(__dirname, "../deployments/umc-launch.json"), JSON.stringify({
    name: "United Million Coin", symbol: "UMC", token, pair: UMC_STOCK,
    poolId: ev.args.poolId, creator: wallet.address, factory: FACTORY,
    txHash: tx.hash, block: rc.blockNumber,
  }, null, 2));
  console.log("bal after:", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
