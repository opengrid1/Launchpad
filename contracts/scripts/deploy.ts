import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys the launchpad suite to the configured network.
 *
 * Required environment:
 *   UNISWAP_V3_FACTORY       Canonical Uniswap V3 factory on the chain
 *   UNISWAP_POSITION_MANAGER NonfungiblePositionManager
 *   UNISWAP_SWAP_ROUTER      SwapRouter (V3)
 *   WETH_ADDRESS             Wrapped native token (WETH equivalent)
 *   ETH_USD_PRICE_8          Native/USD price with 8 decimals (fallback when no feed)
 * Optional:
 *   PRICE_FEED               Chainlink-compatible native/USD aggregator
 *   GRADUATION_CAP_USD_8     Defaults to 40,000 USD (40000e8)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying to ${network.name} as ${deployer.address}`);

  const required = [
    "UNISWAP_V3_FACTORY",
    "UNISWAP_POSITION_MANAGER",
    "UNISWAP_SWAP_ROUTER",
    "WETH_ADDRESS",
    "ETH_USD_PRICE_8",
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env var ${key}`);
  }

  const graduationCap = BigInt(process.env.GRADUATION_CAP_USD_8 ?? String(40_000n * 10n ** 8n));
  const ethUsd = BigInt(process.env.ETH_USD_PRICE_8!);

  const tokenFactory = await (await ethers.getContractFactory("TokenFactory")).deploy();
  await tokenFactory.waitForDeployment();
  console.log(`TokenFactory:    ${await tokenFactory.getAddress()}`);

  const treasury = await (await ethers.getContractFactory("Treasury")).deploy(deployer.address);
  await treasury.waitForDeployment();
  console.log(`Treasury:        ${await treasury.getAddress()}`);

  const feeDistributor = await (
    await ethers.getContractFactory("FeeDistributor")
  ).deploy(deployer.address);
  await feeDistributor.waitForDeployment();
  console.log(`FeeDistributor:  ${await feeDistributor.getAddress()}`);

  const launchpad = await (
    await ethers.getContractFactory("Launchpad")
  ).deploy(
    deployer.address,
    await tokenFactory.getAddress(),
    process.env.UNISWAP_V3_FACTORY!,
    process.env.UNISWAP_POSITION_MANAGER!,
    process.env.UNISWAP_SWAP_ROUTER!,
    process.env.WETH_ADDRESS!,
    await feeDistributor.getAddress(),
    await treasury.getAddress(),
    graduationCap,
    ethUsd
  );
  await launchpad.waitForDeployment();
  console.log(`Launchpad:       ${await launchpad.getAddress()}`);

  await (await feeDistributor.setLaunchpad(await launchpad.getAddress())).wait();
  console.log("FeeDistributor wired to Launchpad");

  if (process.env.PRICE_FEED) {
    await (await launchpad.setPriceFeed(process.env.PRICE_FEED)).wait();
    console.log(`Price feed set:  ${process.env.PRICE_FEED}`);
  }

  const deployment = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      tokenFactory: await tokenFactory.getAddress(),
      treasury: await treasury.getAddress(),
      feeDistributor: await feeDistributor.getAddress(),
      launchpad: await launchpad.getAddress(),
    },
    uniswap: {
      factory: process.env.UNISWAP_V3_FACTORY,
      positionManager: process.env.UNISWAP_POSITION_MANAGER,
      swapRouter: process.env.UNISWAP_SWAP_ROUTER,
      weth: process.env.WETH_ADDRESS,
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));
  console.log(`Deployment written to ${outFile}`);
  console.log("Run 'npm run verify:blockscout' to verify all contracts on Blockscout.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
