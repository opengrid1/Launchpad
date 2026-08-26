import { ethers, network } from "hardhat";
import { writeFileSync } from "fs";
import { join } from "path";

/**
 * squidpad — Ink chain (Kraken L2, chainId 57073), canonical Uniswap V3.
 * Deploys RewardTokenDeployer + StableLaunchpadFactory: one tx per launch
 * opens a real Uniswap pool seeded with the full supply; the pool's 1% fee
 * harvests 50% to holders (manual claim), 40% creator, 10% platform.
 *
 * Env:  FACTORY_OWNER (required), FEE_RECIPIENT (default owner),
 *       ETH_USD8 (WETH price, 8 decimals), TOKEN_DEPLOYER (reuse).
 * Run:  set -a && source .env.ink-deployer && set +a && \
 *       ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com ROBINHOOD_CHAIN_ID=57073 \
 *       HARDHAT_CONFIG=hardhat.config.size.ts FACTORY_OWNER=0x... ETH_USD8=252455000000 \
 *       npx hardhat run scripts/deploy-ink-launchpad.ts --network robinhood
 */
const V3_FACTORY = "0x640887a9ba3a9c53ed27d0f7e8246a4f933f3424";
const POSITION_MANAGER = "0xC0836E5B058BBE22ae2266e1AC488A1A0fD8DCE8";
const SWAP_ROUTER = "0x177778F19E89Dd1012bdBE603F144088A95C4b53";
const WETH = "0x4200000000000000000000000000000000000006";

async function main() {
  const [signer] = await ethers.getSigners();
  const owner = process.env.FACTORY_OWNER ?? signer.address;
  const feeRecipient = process.env.FEE_RECIPIENT ?? owner;
  const ethUsd8 = BigInt(process.env.ETH_USD8 ?? String(2500n * 10n ** 8n));
  const holderFeeBps = Number(process.env.HOLDER_FEE_BPS ?? 5000);
  const creatorFeeBps = Number(process.env.CREATOR_FEE_BPS ?? 4000);

  console.log("network:", network.name, "| deployer:", signer.address);
  console.log("owner:", owner, "| feeRecipient:", feeRecipient, "| ETH usd8:", ethUsd8.toString());

  let tokenDeployer;
  if (process.env.TOKEN_DEPLOYER) {
    tokenDeployer = await ethers.getContractAt("SquidTokenDeployer", process.env.TOKEN_DEPLOYER);
    console.log("Reusing RewardTokenDeployer:", process.env.TOKEN_DEPLOYER);
  } else {
    tokenDeployer = await (await ethers.getContractFactory("SquidTokenDeployer")).deploy();
    await tokenDeployer.waitForDeployment();
    console.log("SquidTokenDeployer:", await tokenDeployer.getAddress());
  }

  const factory = await (await ethers.getContractFactory("StableLaunchpadFactory")).deploy(
    owner, feeRecipient, await tokenDeployer.getAddress(), V3_FACTORY, POSITION_MANAGER, SWAP_ROUTER, WETH, holderFeeBps, creatorFeeBps, 500,
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("StableLaunchpadFactory:", factoryAddr);

  await (await tokenDeployer.setFactory(factoryAddr)).wait();
  console.log("tokenDeployer.factory set");

  if (signer.address.toLowerCase() === owner.toLowerCase()) {
    await (await factory.setQuoteAsset(WETH, true, ethUsd8)).wait();
    console.log("WETH priced at usd8", ethUsd8.toString());
  } else {
    console.log(`owner action needed: factory.setQuoteAsset(${WETH}, true, ${ethUsd8})`);
  }

  const out = {
    network: "ink", chainId: 57073,
    startBlock: await ethers.provider.getBlockNumber(),
    deployer: signer.address, owner, feeRecipient,
    uniswapV3: { factory: V3_FACTORY, positionManager: POSITION_MANAGER, swapRouter: SWAP_ROUTER, weth: WETH },
    contracts: { tokenDeployer: await tokenDeployer.getAddress(), factory: factoryAddr },
    config: { totalSupply: "1000000000e18", poolFeeTier: 500, holderFeeBps, creatorFeeBps, platformFeeBps: 10000 - holderFeeBps - creatorFeeBps, defaultMarketCapUsd: 3000 },
  };
  writeFileSync(join(__dirname, "../deployments/ink-launchpad.json"), JSON.stringify(out, null, 2));
  console.log("saved deployments/ink-launchpad.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
