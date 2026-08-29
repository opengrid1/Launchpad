import { ethers, network } from "hardhat";
import { writeFileSync } from "fs";
import { join } from "path";

/**
 * meowstock — HyperEVM (Hyperliquid, chainId 999), HyperSwap V3.
 *
 * A straight fork of the Ink squidpad launchpad: the SAME stock-reward
 * contracts (SquidTokenDeployer + StableLaunchpadFactory launching
 * SquidRewardToken), deployed against HyperSwap V3 instead of Ink's canonical
 * Uniswap V3. One tx per launch opens a real HyperSwap pool seeded with the
 * full supply; every buy skims 1% in coins on the transfer (0.5% holders /
 * 0.4% creator / 0.1% platform), and claims swap the accrued coins into the
 * pair asset (WHYPE or a tokenized stock) through the coin's own pool.
 *
 * Coins pair WHYPE by default. Extra stock quotes are registered from
 * QUOTE_ASSETS (comma-separated `addr:usdPrice8`), since HyperEVM has no
 * Ink-style USDG pricing pool to read on-chain.
 *
 * HyperEVM big blocks: the factory deploy (~3.3M gas) and every launch exceed
 * the ~3M small-block limit, so the deployer address MUST have big blocks
 * enabled (Hyperliquid evmUserModify usingBigBlocks=true) before running.
 *
 * Env:
 *   FACTORY_OWNER  factory owner / platform admin           (default: deployer)
 *   FEE_RECIPIENT  platform 10% fee recipient               (default: owner)
 *   HYPE_USD8      HYPE price, 8 decimals, sizes WHYPE pools (default 40e8 = $40)
 *   QUOTE_ASSETS   comma-separated addr:usdPrice8 stock quotes (optional)
 *   POOL_FEE_TIER  HyperSwap pool fee tier for launches      (default 10000)
 *   TOKEN_DEPLOYER reuse an already-deployed SquidTokenDeployer (optional)
 *   FINAL_OWNER    transfer factory ownership after setup    (optional)
 *
 * Run:  set -a && source .env.meow-deployer && set +a && \
 *       ROBINHOOD_RPC_URL=https://rpc.hyperliquid.xyz/evm ROBINHOOD_CHAIN_ID=999 \
 *       HARDHAT_CONFIG=hardhat.config.size.ts FACTORY_OWNER=0x... HYPE_USD8=4400000000 \
 *       npx hardhat run scripts/deploy-meow-launchpad.ts --network robinhood
 */

// HyperSwap V3 on HyperEVM (on-chain verified via the existing hyper deploy).
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
const POSITION_MANAGER = "0x6eda206207c09e5428f281761ddc0d300851fbc8";
const SWAP_ROUTER = "0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77";
const WHYPE = "0x5555555555555555555555555555555555555555";

async function main() {
  const [signer] = await ethers.getSigners();
  const owner = process.env.FACTORY_OWNER ?? signer.address;
  const feeRecipient = process.env.FEE_RECIPIENT ?? owner;
  const holderFeeBps = Number(process.env.HOLDER_FEE_BPS ?? 5000); // 50% holders
  const creatorFeeBps = Number(process.env.CREATOR_FEE_BPS ?? 4000); // 40% creator / 10% platform
  const poolFeeTier = Number(process.env.POOL_FEE_TIER ?? 10000);
  const hypeUsd8 = BigInt(process.env.HYPE_USD8 ?? String(40n * 10n ** 8n));

  console.log("network:", network.name, "| deployer:", signer.address);
  console.log("owner:", owner, "| feeRecipient:", feeRecipient, "| HYPE usd8:", hypeUsd8.toString(), "| poolFeeTier:", poolFeeTier);

  // HyperEVM: explicit EIP-1559 fees (skip hardhat's flaky fee estimation) and
  // generous gas limits. Big blocks must already be enabled on the deployer.
  const FEES = {
    maxFeePerGas: BigInt(process.env.MAX_FEE_WEI ?? 20_000_000_000),
    maxPriorityFeePerGas: BigInt(process.env.PRIORITY_FEE_WEI ?? 1_000_000_000),
  };
  const DEPLOY_GAS = { gasLimit: 6_000_000, ...FEES };
  const ADMIN_GAS = { gasLimit: 400_000, ...FEES };

  let tokenDeployer;
  if (process.env.TOKEN_DEPLOYER) {
    tokenDeployer = await ethers.getContractAt("SquidTokenDeployer", process.env.TOKEN_DEPLOYER);
    console.log("Reusing SquidTokenDeployer:", process.env.TOKEN_DEPLOYER);
  } else {
    tokenDeployer = await (await ethers.getContractFactory("SquidTokenDeployer")).deploy(DEPLOY_GAS);
    await tokenDeployer.waitForDeployment();
    console.log("SquidTokenDeployer:", await tokenDeployer.getAddress());
  }

  const factory = await (await ethers.getContractFactory("StableLaunchpadFactory")).deploy(
    owner, feeRecipient, await tokenDeployer.getAddress(), V3_FACTORY, POSITION_MANAGER, SWAP_ROUTER, WHYPE, holderFeeBps, creatorFeeBps, poolFeeTier,
    DEPLOY_GAS,
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("StableLaunchpadFactory:", factoryAddr);

  await (await tokenDeployer.setFactory(factoryAddr, ADMIN_GAS)).wait();
  console.log("tokenDeployer.factory set");

  // Quote assets: WHYPE (native) plus any stocks passed via QUOTE_ASSETS.
  const quotes: { ticker: string; address: string; usd8: string }[] = [
    { ticker: "WHYPE", address: WHYPE, usd8: hypeUsd8.toString() },
  ];
  if (process.env.QUOTE_ASSETS) {
    for (const pair of process.env.QUOTE_ASSETS.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [addr, usd8] = pair.split(":");
      if (!addr || !usd8) throw new Error(`bad QUOTE_ASSETS entry: ${pair}`);
      quotes.push({ ticker: addr.slice(0, 8), address: addr, usd8 });
    }
  }

  const isOwner = signer.address.toLowerCase() === owner.toLowerCase();
  for (const q of quotes) {
    if (isOwner) {
      await (await factory.setQuoteAsset(q.address, true, BigInt(q.usd8), ADMIN_GAS)).wait();
      console.log(`quote approved: ${q.ticker} @ usd8 ${q.usd8}`);
    } else {
      console.log(`owner action needed: factory.setQuoteAsset(${q.address}, true, ${q.usd8}) // ${q.ticker}`);
    }
  }

  const finalOwner = process.env.FINAL_OWNER;
  if (finalOwner && isOwner && finalOwner.toLowerCase() !== signer.address.toLowerCase()) {
    await (await factory.transferOwnership(finalOwner, ADMIN_GAS)).wait();
    console.log("ownership transferred to", finalOwner);
  }

  const out = {
    network: "hyperevm", chainId: 999,
    startBlock: await ethers.provider.getBlockNumber(),
    deployer: signer.address, owner, feeRecipient,
    hyperswapV3: { factory: V3_FACTORY, positionManager: POSITION_MANAGER, swapRouter: SWAP_ROUTER, whype: WHYPE },
    contracts: { tokenDeployer: await tokenDeployer.getAddress(), factory: factoryAddr },
    quotes,
    config: { totalSupply: "1000000000e18", poolFeeTier, holderFeeBps, creatorFeeBps, platformFeeBps: 10000 - holderFeeBps - creatorFeeBps, defaultMarketCapUsd: 3000 },
  };
  writeFileSync(join(__dirname, "../deployments/meow-launchpad.json"), JSON.stringify(out, null, 2));
  console.log("saved deployments/meow-launchpad.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
