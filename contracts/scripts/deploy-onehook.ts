import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * Deploy OneHook (factory-held liquidity model) to Ethereum mainnet.
 *
 *   npx hardhat run scripts/deploy-onehook.ts --network mainnet
 *
 * Env:
 *   PRIVATE_KEY            deployer (pays gas; keeps setup rights only until RENOUNCE)
 *   ONEHOOK_ADMIN          immutable admin: pause, listings, metadata, fee recipient, collect
 *   ONEHOOK_FEE_RECIPIENT  platform fee sink (default: admin)
 *   ONEHOOK_ORACLE         the mainnet price oracle (IOneOracle)
 *   POOL_MANAGER           Uniswap V4 PoolManager (default: mainnet canonical)
 *   WETH_ADDRESS           WETH9 (default: mainnet canonical)
 *   RENOUNCE=1             renounce the deployer's setup rights at the end
 *
 * The hook address must encode exactly beforeSwap | afterSwap |
 * beforeSwapReturnDelta | afterSwapReturnDelta (0x..CC): the hook has no
 * initialize, liquidity or donate permissions, so it can never gate, hold or
 * move liquidity. The launch position lives in the factory; only the admin's
 * disclosed `collect` can touch it.
 */

const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

function mine(deployer: string, initCodeHash: string): { addr: string; salt: string } {
  for (let i = 0n; i < 20_000_000n; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const addr = ethers.getCreate2Address(deployer, salt, initCodeHash);
    if ((BigInt(addr) & FLAG_MASK) === HOOK_FLAGS) return { addr, salt };
  }
  throw new Error("hook salt not found");
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return ethers.getAddress(v);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = need("ONEHOOK_ADMIN");
  const oracle = need("ONEHOOK_ORACLE");
  const feeRecipient = process.env.ONEHOOK_FEE_RECIPIENT ? ethers.getAddress(process.env.ONEHOOK_FEE_RECIPIENT) : admin;
  const poolManager = ethers.getAddress(process.env.POOL_MANAGER ?? "0x000000000004444c5dc75cB358380D2e3dE08A90");
  const weth = ethers.getAddress(process.env.WETH_ADDRESS ?? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");

  console.log(`network ${network.name}, deployer ${deployer.address}, admin ${admin}`);

  // 1. CREATE2 deployer so the hook lands on a flag-encoded address.
  const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
  await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();
  console.log("HookDeployer:", c2Addr);

  // 2. The hook. Its `deployer` is tx.origin, so the same EOA wires the factory below.
  const Hook = await ethers.getContractFactory("OneHook");
  const hookInit = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [poolManager, weth])]);
  console.log("mining hook flags 0x..CC …");
  const { addr: hookAddr, salt } = mine(c2Addr, ethers.keccak256(hookInit));
  await (await c2.deploy(salt, hookInit)).wait();
  const hook = await ethers.getContractAt("OneHook", hookAddr);
  console.log("OneHook:", hookAddr);

  // 3. Token deployer, factory, router.
  const tokenDeployer = await (await ethers.getContractFactory("OneTokenDeployer")).deploy();
  await tokenDeployer.waitForDeployment();
  const tokenDeployerAddr = await tokenDeployer.getAddress();
  console.log("OneTokenDeployer:", tokenDeployerAddr);

  const factory = await (await ethers.getContractFactory("OneFactory")).deploy(
    deployer.address, admin, poolManager, hookAddr, tokenDeployerAddr, weth, oracle, feeRecipient,
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("OneFactory:", factoryAddr);

  const router = await (await ethers.getContractFactory("OneRouter")).deploy(poolManager, factoryAddr, weth);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("OneRouter:", routerAddr);

  // 4. Wiring (each one-time).
  await (await tokenDeployer.setFactory(factoryAddr)).wait();
  await (await hook.setFactory(factoryAddr)).wait();
  await (await factory.setConverter(routerAddr)).wait();
  console.log("wired: tokenDeployer.factory, hook.factory, factory.converter");

  if (process.env.RENOUNCE === "1") {
    await (await factory.renounceOwnership()).wait();
    console.log("factory setup rights renounced; admin keeps its own");
  }

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    model: "onehook-v2: factory-held liquidity, swap-only hook (flags 0xCC)",
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    feeRecipient,
    contracts: { hookDeployer: c2Addr, hook: hookAddr, hookSalt: salt, tokenDeployer: tokenDeployerAddr, factory: factoryAddr, router: routerAddr, poolManager, weth, oracle },
  };
  mkdirSync(join(__dirname, "../deployments"), { recursive: true });
  const file = join(__dirname, `../deployments/onehook-${network.name}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", file);

  console.log("\nVerify (full config, ETHERSCAN_API_KEY in contracts/.env):");
  console.log(`  npx hardhat verify --network ${network.name} ${c2Addr}`);
  console.log(`  npx hardhat verify --network ${network.name} ${hookAddr} ${poolManager} ${weth}`);
  console.log(`  npx hardhat verify --network ${network.name} ${tokenDeployerAddr}`);
  console.log(`  npx hardhat verify --network ${network.name} ${factoryAddr} ${deployer.address} ${admin} ${poolManager} ${hookAddr} ${tokenDeployerAddr} ${weth} ${oracle} ${feeRecipient}`);
  console.log(`  npx hardhat verify --network ${network.name} ${routerAddr} ${poolManager} ${factoryAddr} ${weth}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
