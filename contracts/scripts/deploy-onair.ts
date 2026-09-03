/* eslint-disable no-console */
// Deploys the ONAIR launchpad on HyperEVM: the unmodified Uniswap Continuous
// Clearing Auction factory, the token deployer and OnairFactory (instant +
// auction launches on HyperSwap V3). Needs HYPE for gas and BIG BLOCKS enabled
// for the deployer (the CCA factory and OnairFactory are ~20-24 KB each).
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://rpc.hyperliquid.xyz/evm \
//   ROBINHOOD_CHAIN_ID=999 PRIVATE_KEY=... [ADMIN=0x..] [HYPE_USD8=8114000000] \
//     npx hardhat run scripts/deploy-onair.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const HYPERSWAP = {
  factory: "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3",
  positionManager: "0x6eda206207c09e5428f281761ddc0d300851fbc8",
  swapRouter: "0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77",
  whype: "0x5555555555555555555555555555555555555555",
};
const OLD_FACTORY = "0x8856a0BAa8bfeB39b93d4846c825Ca615Eaf69E3"; // hyperstock: source of the last posted HYPE price

async function hypeUsd8(): Promise<bigint> {
  if (process.env.HYPE_USD8) return BigInt(process.env.HYPE_USD8);
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid&vs_currencies=usd");
    const j = (await r.json()) as any;
    const usd = Number(j?.hyperliquid?.usd);
    if (usd > 0) return BigInt(Math.round(usd * 1e8));
  } catch {}
  const old = await ethers.getContractAt(["function quoteAssets(address) view returns (bool,uint64,uint8)"], OLD_FACTORY);
  const [, p] = await old.quoteAssets(HYPERSWAP.whype);
  return BigInt(p);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const admin = ethers.getAddress(process.env.ADMIN ?? deployer.address);
  const price = await hypeUsd8();
  console.log("chain", net.chainId.toString(), "deployer", deployer.address, "bal", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "HYPE usd8", price.toString(), "admin", admin);

  const cca = await (await ethers.getContractFactory("ContinuousClearingAuctionFactory")).deploy(ethers.ZeroAddress);
  await cca.waitForDeployment();
  console.log("CCA factory", await cca.getAddress());

  const td = await (await ethers.getContractFactory("OnairTokenDeployer")).deploy();
  await td.waitForDeployment();
  console.log("token deployer", await td.getAddress());

  const factory = await (await ethers.getContractFactory("OnairFactory")).deploy(
    admin, admin, await td.getAddress(), HYPERSWAP.factory, HYPERSWAP.positionManager, HYPERSWAP.swapRouter, HYPERSWAP.whype,
    await cca.getAddress(), price, 0, 7000, 10000,
  );
  await factory.waitForDeployment();
  console.log("OnairFactory", await factory.getAddress());
  await (await td.setFactory(await factory.getAddress())).wait();
  console.log("deployer bound");

  const out = {
    chainId: Number(net.chainId), admin, feeRecipient: admin, hypeUsd8: price.toString(),
    hyperswapV3: HYPERSWAP,
    contracts: { ccaFactory: await cca.getAddress(), tokenDeployer: await td.getAddress(), factory: await factory.getAddress() },
    auction: { supplyBps: 5000, durationBlocks: 14400, floorMcapUsd8: "300000000000", minFdvUsd8: "1000000000000" },
    fees: { poolFeeTier: 10000, holderBps: 0, creatorBps: 7000, platformBps: 3000 },
    deployBlock: await ethers.provider.getBlockNumber(), deployedAt: new Date().toISOString(),
  };
  const file = path.join(__dirname, "..", "deployments", "hyperevm-onair.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("wrote", file, "bal after", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
}

main().catch((e) => { console.error(e); process.exit(1); });
