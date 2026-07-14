import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys the launchpad suite to the configured network.
 *
 * Wallet architecture (each part rotates independently):
 *   - Deployer (PRIVATE_KEY, from .env.deployer): a dedicated platform wallet
 *     that only signs deployments. When PLATFORM_ADMIN is set, every role is
 *     granted to it and renounced by the deployer, so the deployer key holds
 *     zero privileges once this script exits.
 *   - PLATFORM_ADMIN: owns the protocol (ideally a team multisig). Holds
 *     DEFAULT_ADMIN_ROLE everywhere plus the liquidity manager, operator and
 *     treasurer roles, and can re-grant or revoke any of them later
 *     (scripts/transfer-admin.ts).
 *   - Treasury contract: the only destination for protocol-owned assets
 *     (LP withdrawals, collected pool fees). Never a personal wallet.
 *   - Trading fees: routed 100% to token creators by the FeeDistributor;
 *     they never touch the deployer or the admin.
 *
 * Required environment:
 *   UNISWAP_V3_FACTORY       Canonical Uniswap V3 factory on the chain
 *   UNISWAP_POSITION_MANAGER NonfungiblePositionManager
 *   UNISWAP_SWAP_ROUTER      SwapRouter (V3)
 *   WETH_ADDRESS             Wrapped native token (WETH equivalent)
 *   ETH_USD_PRICE_8          Native/USD price with 8 decimals (fallback when no feed)
 * Strongly recommended:
 *   PLATFORM_ADMIN           Multisig that receives all admin roles
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

  const platformAdmin = process.env.PLATFORM_ADMIN;
  if (platformAdmin && !ethers.isAddress(platformAdmin)) {
    throw new Error("PLATFORM_ADMIN is not a valid address");
  }
  const handover = Boolean(
    platformAdmin && platformAdmin.toLowerCase() !== deployer.address.toLowerCase()
  );
  if (!handover) {
    console.warn(
      "WARNING: PLATFORM_ADMIN is not set (or equals the deployer). The deployer key will " +
        "keep every admin role. Set PLATFORM_ADMIN to the team multisig for production."
    );
  }

  const graduationCap = BigInt(process.env.GRADUATION_CAP_USD_8 ?? String(40_000n * 10n ** 8n));
  const ethUsd = BigInt(process.env.ETH_USD_PRICE_8!);

  // Contracts are deployed with the deployer as a temporary admin purely so
  // the wiring below can run in the same script; the handover strips it.
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

  const ADMIN = ethers.ZeroHash;
  const LIQUIDITY_MANAGER = ethers.id("LIQUIDITY_MANAGER_ROLE");
  const OPERATOR = ethers.id("OPERATOR_ROLE");
  const TREASURER = ethers.id("TREASURER_ROLE");

  if (handover) {
    console.log(`Handing all privileges to platform admin ${platformAdmin} ...`);

    // Grant first, renounce second, verifying after each contract so a
    // partial failure can never leave the protocol without an admin.
    const plan: Array<{ name: string; contract: any; roles: string[] }> = [
      { name: "Launchpad", contract: launchpad, roles: [ADMIN, LIQUIDITY_MANAGER, OPERATOR] },
      { name: "FeeDistributor", contract: feeDistributor, roles: [ADMIN] },
      { name: "Treasury", contract: treasury, roles: [ADMIN, TREASURER] },
    ];

    for (const step of plan) {
      for (const role of step.roles) {
        await (await step.contract.grantRole(role, platformAdmin)).wait();
        if (!(await step.contract.hasRole(role, platformAdmin))) {
          throw new Error(`${step.name}: platform admin did not receive role ${role}`);
        }
      }
      for (const role of step.roles) {
        await (await step.contract.renounceRole(role, deployer.address)).wait();
        if (await step.contract.hasRole(role, deployer.address)) {
          throw new Error(`${step.name}: deployer still holds role ${role}`);
        }
      }
      console.log(`${step.name}: platform admin holds all roles, deployer holds none`);
    }
    console.log("Handover complete. The deployer key now has zero on-chain privileges.");
  }

  const deployment = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    platformAdmin: handover ? platformAdmin : deployer.address,
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
