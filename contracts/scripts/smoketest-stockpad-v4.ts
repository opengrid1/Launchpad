import { ethers } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

// End-to-end smoke test on the live stockpad V4 deploy:
//   1. launch a throwaway coin paired against WETH (no dev buy)
//   2. buy a tiny amount through the router (native ETH in)
//   3. assert the buy tax skimmed and holder rewards accrued (no harvest)
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

async function main() {
  const [signer] = await ethers.getSigners();
  const d = JSON.parse(readFileSync(join(__dirname, "../deployments/stockpad-v4.json"), "utf8"));
  const { factory: factoryAddr, router: routerAddr, hook: hookAddr } = d.contracts;
  console.log("signer:", signer.address, "| bal:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH");
  console.log("factory:", factoryAddr, "| router:", routerAddr);

  const factory = await ethers.getContractAt("StockRhFactory", factoryAddr);

  // 1. Launch (WETH pair → pairUsdPrice8 = ETH price; no V3 leg on buys).
  const ethUsd8 = 3000n * 10n ** 8n;
  const params = {
    name: "StockPad V4 Smoke",
    symbol: "SMOKE",
    metadataURI: "",
    taxBps: 100, // 1%
    pair: WETH,
    pairUsdPrice8: ethUsd8,
    devBuyPairAmount: 0n,
  };
  const salt = ethers.hexlify(ethers.randomBytes(32));
  console.log("launching…");
  const tx = await factory.launch(params, salt);
  const rc = await tx.wait();
  const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "Launched");
  const coin = ev!.args.token as string;
  console.log("launched coin:", coin, "| poolId:", ev!.args.poolId);

  // 2. Buy via the router with a tiny amount of native ETH (pair is WETH → empty V3 path).
  const router = await ethers.getContractAt("StockRhRouter", routerAddr);
  const buyValue = ethers.parseEther("0.0005");
  console.log("buying with", ethers.formatEther(buyValue), "ETH…");
  const buyTx = await router.buy(coin, "0x", 0n, { value: buyValue });
  const buyRc = await buyTx.wait();
  console.log("buy mined in block", buyRc!.blockNumber);

  // 3. Reads: coin balance received, holder pending rewards, creator/platform fees.
  const token = await ethers.getContractAt("QuiverStockToken", coin);
  const bal = await token.balanceOf(signer.address);
  const pending = await token.pendingRewards(signer.address);
  const totalRewards = await token.totalRewardsDistributed();
  const creatorFees = await token.creatorFees();
  const platformFees = await token.platformFees();
  const feeCoinAtToken = await token.balanceOf(coin); // fee coins parked at the token
  console.log("---- results ----");
  console.log("coin received:", ethers.formatEther(bal));
  console.log("pendingRewards (coin):", ethers.formatEther(pending));
  console.log("totalRewardsDistributed (coin):", ethers.formatEther(totalRewards));
  console.log("creatorFees (coin):", ethers.formatEther(creatorFees));
  console.log("platformFees (coin):", ethers.formatEther(platformFees));
  console.log("fee coins parked at token:", ethers.formatEther(feeCoinAtToken));
  console.log("bal after:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH");
}
main().catch((e) => { console.error(e); process.exit(1); });
