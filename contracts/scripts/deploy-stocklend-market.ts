/* eslint-disable no-console */
// Resume step for deploy-stocklend.ts: the oracle is already live, deploy the
// market against it, list markets, and hand both contracts to ADMIN.
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const ADMIN = ethers.getAddress("0x5dddea56774f01fc9d207bbd7b7633596a2f4a0b");
const ORACLE = "0x1e779b64A0D6C83BedA478bffF71A93eb6F45A40";
const TWAP_WINDOW = 1800;

const MARKETS = [
  { sym: "TSLA", stock: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", pool: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3", borrowCap: 500n, supplyCap: 1_500n },
  { sym: "AAPL", stock: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", pool: "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D", borrowCap: 500n, supplyCap: 1_500n },
  { sym: "NVDA", stock: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", pool: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", borrowCap: 2_000n, supplyCap: 6_000n },
  { sym: "AMZN", stock: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", pool: "0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef", borrowCap: 300n, supplyCap: 900n },
];
const RATE = { baseRateBps: 200n, slope1Bps: 1000n, slope2Bps: 5000n, kinkBps: 8000n };
const RISK = { ltvBps: 5000, liqThresholdBps: 6500, liqBonusBps: 800, reserveFactorBps: 1500 };

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log("chain", net.chainId.toString(), "deployer", deployer.address, "bal", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const oracle = await ethers.getContractAt("V3TwapOracle", ORACLE);
  for (const m of MARKETS) console.log(`  ${m.sym} twap $${ethers.formatEther(await oracle.getPrice(m.stock))}`);

  const market = await (await ethers.getContractFactory("StockLendMarket")).deploy(deployer.address, USDG, ORACLE, ADMIN);
  await market.waitForDeployment();
  const M = await market.getAddress();
  console.log("StockLendMarket", M);

  const WAD = 10n ** 18n;
  for (const m of MARKETS) {
    await (await market.listMarket(m.stock, RATE, RISK, m.supplyCap * WAD, m.borrowCap * WAD)).wait();
    console.log(`  listed ${m.sym}`);
  }

  if ((await oracle.owner()).toLowerCase() !== ADMIN.toLowerCase()) await (await oracle.transferOwnership(ADMIN)).wait();
  await (await market.transferOwnership(ADMIN)).wait();
  console.log("ownership -> ADMIN", ADMIN);

  const out = {
    chainId: Number(net.chainId), oracle: ORACLE, market: M, usdg: USDG, admin: ADMIN, feeRecipient: ADMIN, twapWindow: TWAP_WINDOW,
    rate: Object.fromEntries(Object.entries(RATE).map(([k, v]) => [k, Number(v)])), risk: RISK,
    markets: MARKETS.map((m) => ({ ...m, borrowCap: Number(m.borrowCap), supplyCap: Number(m.supplyCap) })),
    deployedAt: new Date().toISOString(), deployBlock: await ethers.provider.getBlockNumber(),
  };
  const file = path.join(__dirname, "..", "deployments", "stocklend.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("wrote", file, "bal after", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
}

main().catch((e) => { console.error(e); process.exit(1); });
