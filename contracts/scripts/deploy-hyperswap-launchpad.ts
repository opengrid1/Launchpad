import { ethers, network } from "hardhat";
import { writeFileSync } from "fs";
import { join } from "path";

/**
 * HyperSwap V3 launchpad — HyperEVM mainnet (Hyperliquid, chain 999).
 *
 * Reuses the proven StableLaunchpadFactory unchanged: one tx deploys a plain,
 * ownerless, tax-free ERC20, opens its HyperSwap V3 pool at a target market
 * cap, and seeds the entire supply single-sided through HyperSwap's
 * NonfungiblePositionManager (HyperSwap's pool rejects a direct pool.mint, so
 * the NPM periphery is required). The LP position is custodied by the factory
 * forever; the pool's 1% fee tier is the only trading cost, harvested 80% to
 * the coin's creator / 20% to the platform.
 *
 * Coins pair WHYPE by default; tokenized stocks (Ondo *on tokens) can be
 * approved as extra quote assets via QUOTE_ASSETS (addr:usdPrice8 pairs).
 *
 * IMPORTANT — HyperEVM big blocks: this factory deploy and EVERY launch
 * (token + V3 pool creation) exceed the ~2M-gas "small block" limit, so the
 * deployer address MUST have big blocks enabled (Hyperliquid `evmUserModify`
 * usingBigBlocks=true) before running, and launchers need them too.
 *
 * Env:
 *   FACTORY_OWNER   factory owner / platform admin              (required)
 *   FEE_RECIPIENT   platform 20% fee recipient (default: owner)
 *   HYPE_USD8       HYPE price, 8 decimals, to size WHYPE pools (default 4000e8 = $40)
 *   QUOTE_ASSETS    comma-separated addr:usdPrice8 stock quotes (optional)
 *
 *   set -a && source .env.deployer && set +a
 *   ROBINHOOD_RPC_URL=https://rpc.hyperliquid.xyz/evm ROBINHOOD_CHAIN_ID=999 \
 *   FACTORY_OWNER=0x... HYPE_USD8=4400000000 \
 *   npx hardhat run scripts/deploy-hyperswap-launchpad.ts --network robinhood
 */

// HyperSwap V3 on HyperEVM (all on-chain verified: factory()/WETH9() match).
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
const POSITION_MANAGER = "0x6eda206207c09e5428f281761ddc0d300851fbc8"; // "Hyperswap V3 Positions NFT-V1"
const SWAP_ROUTER = "0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77"; // SwapRouter02
const WHYPE = "0x5555555555555555555555555555555555555555";

async function main() {
  const [signer] = await ethers.getSigners();
  const owner = process.env.FACTORY_OWNER ?? signer.address;
  const feeRecipient = process.env.FEE_RECIPIENT ?? owner;
  const hypeUsd8 = BigInt(process.env.HYPE_USD8 ?? String(40n * 10n ** 8n)); // default $40
  const creatorFeeBps = Number(process.env.CREATOR_FEE_BPS ?? 7000); // 70% creator / 30% platform

  console.log("network:", network.name, "| deployer:", signer.address);
  console.log("owner:", owner, "| feeRecipient:", feeRecipient, "| HYPE usd8:", hypeUsd8.toString(), "| creatorFeeBps:", creatorFeeBps);

  const tokenDeployer = await (await ethers.getContractFactory("TokenDeployer")).deploy();
  await tokenDeployer.waitForDeployment();
  console.log("TokenDeployer:", await tokenDeployer.getAddress());

  const factory = await (await ethers.getContractFactory("StableLaunchpadFactory")).deploy(
    owner, feeRecipient, await tokenDeployer.getAddress(), V3_FACTORY, POSITION_MANAGER, SWAP_ROUTER, WHYPE, creatorFeeBps,
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("StableLaunchpadFactory:", factoryAddr);

  await (await tokenDeployer.setFactory(factoryAddr)).wait();
  console.log("tokenDeployer.factory set");

  const canAdmin = signer.address.toLowerCase() === owner.toLowerCase();

  // WHYPE is approved at construction with usdPrice8 = 1e8 ($1), which is wrong
  // for HYPE — correct it so WHYPE-paired pools open at a sane market cap.
  if (canAdmin) {
    await (await factory.setQuoteAsset(WHYPE, true, hypeUsd8)).wait();
    console.log("WHYPE priced at usd8", hypeUsd8.toString());
  } else {
    console.log(`owner action needed: factory.setQuoteAsset(${WHYPE}, true, ${hypeUsd8})`);
  }

  // Optional tokenized-stock quote assets: addr:usdPrice8, comma-separated.
  const quotes = (process.env.QUOTE_ASSETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const approved: { quote: string; usdPrice8: string }[] = [];
  for (const q of quotes) {
    const [addr, price] = q.split(":");
    if (!addr || !price) { console.log("skip malformed QUOTE_ASSETS entry:", q); continue; }
    if (canAdmin) {
      await (await factory.setQuoteAsset(addr, true, BigInt(price))).wait();
      console.log("approved quote:", addr, "usd8", price);
    } else {
      console.log(`owner action needed: factory.setQuoteAsset(${addr}, true, ${price})`);
    }
    approved.push({ quote: addr, usdPrice8: price });
  }

  const out = {
    network: network.name,
    chainId: 999,
    startBlock: await ethers.provider.getBlockNumber(),
    deployer: signer.address,
    owner,
    feeRecipient,
    hyperswapV3: { factory: V3_FACTORY, positionManager: POSITION_MANAGER, swapRouter: SWAP_ROUTER, whype: WHYPE },
    contracts: { tokenDeployer: await tokenDeployer.getAddress(), factory: factoryAddr },
    quoteAssets: { whypeUsd8: hypeUsd8.toString(), stocks: approved },
    config: { totalSupply: "1000000000e18", poolFeeTier: 10000, creatorFeeBps, platformFeeBps: 10000 - creatorFeeBps, defaultMarketCapUsd: 3000 },
  };
  writeFileSync(join(__dirname, "../deployments/hyperswap-launchpad.json"), JSON.stringify(out, null, 2));
  console.log("saved deployments/hyperswap-launchpad.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
