/* eslint-disable no-console */
// Deploys the HyperAuction v2 stack on HyperEVM: token deployer, OnairFactory
// with stock pairs (owner-approved quote assets for instant launches) and a
// fresh OnairAuctionHouse. The v1 stack keeps running; the site reads both.
// Needs HYPE for gas and BIG BLOCKS enabled for the deployer (the factory is
// ~24 KB).
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://rpc.hyperliquid.xyz/evm \
//   ROBINHOOD_CHAIN_ID=999 PRIVATE_KEY=... [ADMIN=0x..] [HYPE_USD8=8409000000] \
//     npx hardhat run scripts/deploy-onair-v2.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const HYPERSWAP = {
  factory: "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3",
  positionManager: "0x6eda206207c09e5428f281761ddc0d300851fbc8",
  swapRouter: "0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77",
  whype: "0x5555555555555555555555555555555555555555",
};
const V1_FACTORY = "0x469D1F86485720c60e17538cEf44071E4f299ACe";

async function hypeUsd8(): Promise<bigint> {
  if (process.env.HYPE_USD8) return BigInt(process.env.HYPE_USD8);
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid&vs_currencies=usd");
    const j = (await r.json()) as any;
    const usd = Number(j?.hyperliquid?.usd);
    if (usd > 0) return BigInt(Math.round(usd * 1e8));
  } catch {}
  const v1 = await ethers.getContractAt(["function quoteAssets(address) view returns (bool,uint64,uint8)"], V1_FACTORY);
  const [, p] = await v1.quoteAssets(HYPERSWAP.whype);
  return BigInt(p);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const admin = ethers.getAddress(process.env.ADMIN ?? deployer.address);
  const price = await hypeUsd8();
  const quotes = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "hyperevm-stock-quotes.json"), "utf8")).quotes as { ticker: string; address: string; usd: number }[];
  console.log("chain", net.chainId.toString(), "deployer", deployer.address, "bal", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "HYPE usd8", price.toString(), "admin", admin, "quotes", quotes.length);

  const td = await (await ethers.getContractFactory("OnairTokenDeployer")).deploy();
  await td.waitForDeployment();
  console.log("token deployer", await td.getAddress());

  const factory = await (await ethers.getContractFactory("OnairFactory")).deploy(
    deployer.address, admin, await td.getAddress(), HYPERSWAP.factory, HYPERSWAP.positionManager, HYPERSWAP.swapRouter, HYPERSWAP.whype,
    price, 0, 7000, 10000,
  );
  await factory.waitForDeployment();
  console.log("OnairFactory", await factory.getAddress());
  await (await td.setFactory(await factory.getAddress())).wait();
  const house = await (await ethers.getContractFactory("OnairAuctionHouse")).deploy(await factory.getAddress());
  await house.waitForDeployment();
  console.log("OnairAuctionHouse", await house.getAddress());
  await (await factory.setAuctionHouse(await house.getAddress())).wait();
  console.log("house wired");

  // Stock pairs: every tokenized stock with an EVM contract, priced in USD.
  // Big blocks land about once a minute, so QUOTES=0 defers this to
  // scripts/approve-onair-quotes.ts, run after big blocks are switched off.
  const approved: { ticker: string; address: string; usd: number; usd8: string }[] = [];
  for (const q of process.env.QUOTES === "0" ? [] : quotes) {
    if (!(q.usd > 0)) { console.log("  skip", q.ticker, "no price"); continue; }
    const usd8 = BigInt(Math.round(q.usd * 1e8));
    try {
      const tx = await factory.setQuoteAsset(q.address, true, usd8);
      await tx.wait();
      approved.push({ ticker: q.ticker, address: q.address, usd: q.usd, usd8: usd8.toString() });
      console.log("  +", q.ticker, "$" + q.usd, tx.hash);
    } catch (e: any) {
      console.log("  !", q.ticker, (e.shortMessage ?? e.message ?? String(e)).slice(0, 120));
    }
  }

  // TRANSFER=0 keeps the deployer as owner until the quotes are approved.
  if (process.env.TRANSFER !== "0" && admin.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await factory.transferOwnership(admin)).wait();
    console.log("ownership ->", await factory.owner());
  }

  const out = {
    chainId: Number(net.chainId), version: 2, admin, feeRecipient: admin, hypeUsd8: price.toString(),
    hyperswapV3: HYPERSWAP,
    contracts: { tokenDeployer: await td.getAddress(), factory: await factory.getAddress(), auctionHouse: await house.getAddress() },
    v1: { factory: V1_FACTORY, auctionHouse: "0xad1e5800cde9D3A7aabbfD4D1aD7Ef4ce0941c3e", tokenDeployer: "0xD175CcE73949CB1Db283f64383D148bcb0B49058" },
    auction: { supplyBps: 5000, durationBlocks: 14400, floorMcapUsd8: "300000000000", minRaiseWei: "220000000000000000000", minBidWei: "50000000000000000" },
    fees: { poolFeeTier: 10000, holderBps: 0, creatorBps: 7000, platformBps: 3000 },
    quotes: approved,
    deployBlock: await ethers.provider.getBlockNumber(), deployedAt: new Date().toISOString(),
  };
  const file = path.join(__dirname, "..", "deployments", "hyperevm-onair-v2.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("wrote", file, "bal after", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
}

main().catch((e) => { console.error(e); process.exit(1); });
