import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Deploy Equo (v3 of the OneHook design: cashback, referral, start cap presets,
 * creator transfer and community takeover) to Ethereum mainnet.
 *
 *   npx hardhat run scripts/deploy-equo.ts --network mainnet   (needs EQUO_CONFIRM_MAINNET=1)
 *   DRY_RUN=1 npx hardhat run scripts/deploy-equo.ts            (local: deploys its own PoolManager, WETH and oracle)
 *
 * Env:
 *   PRIVATE_KEY            deployer (pays gas; keeps setup rights only until RENOUNCE)
 *   ONEHOOK_ADMIN          immutable admin: pause, listings, metadata, fee recipient, collect
 *   ONEHOOK_FEE_RECIPIENT  platform fee sink (default: admin)
 *   ONEHOOK_ORACLE         the mainnet price oracle (IOneOracle)
 *   POOL_MANAGER           Uniswap V4 PoolManager (default: mainnet canonical)
 *   WETH_ADDRESS           WETH9 (default: mainnet canonical)
 *   RENOUNCE=1             renounce the deployer's setup rights at the end
 *   EQUO_CASHBACK_BPS      cashback share of the platform part, bps (admin step; applied here only if deployer is admin)
 *   EQUO_REFERRAL_BPS      referral share of the platform part, bps (same)
 *   EQUO_CAP_PRESETS       start cap presets in whole USD, comma separated, e.g. 5000,12500,25000 (same)
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
  const dry = process.env.DRY_RUN === "1";
  if (network.name === "mainnet" && process.env.EQUO_CONFIRM_MAINNET !== "1") throw new Error("set EQUO_CONFIRM_MAINNET=1 to deploy to mainnet");
  if (dry && network.name !== "hardhat") throw new Error("DRY_RUN only runs on the in-process hardhat network");
  const startBalance = await ethers.provider.getBalance(deployer.address);
  let admin: string, oracle: string, poolManager: string, weth: string;
  if (dry) {
    // a self-contained local stack so the exact deploy steps can be rehearsed
    admin = deployer.address;
    const w = await (await ethers.getContractFactory("WETH9")).deploy();
    weth = await w.getAddress();
    const art = JSON.parse(readFileSync(join(__dirname, "../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"));
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, deployer).deploy(deployer.address);
    poolManager = await pm.getAddress();
    const o = await (await ethers.getContractFactory("MockOneOracle")).deploy();
    await (await o.set(weth, 3000n * 10n ** 18n)).wait();
    oracle = await o.getAddress();
  } else {
    admin = need("ONEHOOK_ADMIN");
    oracle = need("ONEHOOK_ORACLE");
    poolManager = ethers.getAddress(process.env.POOL_MANAGER ?? "0x000000000004444c5dc75cB358380D2e3dE08A90");
    weth = ethers.getAddress(process.env.WETH_ADDRESS ?? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  }
  const feeRecipient = !dry && process.env.ONEHOOK_FEE_RECIPIENT ? ethers.getAddress(process.env.ONEHOOK_FEE_RECIPIENT) : admin;

  console.log(`network ${network.name}, deployer ${deployer.address}, admin ${admin}`);

  // 1. CREATE2 deployer so the hook lands on a flag-encoded address.
  const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
  await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();
  console.log("HookDeployer:", c2Addr);

  // 2. The hook. Its `deployer` is tx.origin, so the same EOA wires the factory below.
  const Hook = await ethers.getContractFactory("EquoHook");
  const hookInit = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [poolManager, weth])]);
  console.log("mining hook flags 0x..CC …");
  const { addr: hookAddr, salt } = mine(c2Addr, ethers.keccak256(hookInit));
  await (await c2.deploy(salt, hookInit)).wait();
  const hook = await ethers.getContractAt("EquoHook", hookAddr);
  console.log("EquoHook:", hookAddr);

  // 3. Token deployer, factory, router.
  const tokenDeployer = await (await ethers.getContractFactory("EquoTokenDeployer")).deploy();
  await tokenDeployer.waitForDeployment();
  const tokenDeployerAddr = await tokenDeployer.getAddress();
  console.log("EquoTokenDeployer:", tokenDeployerAddr);

  const factory = await (await ethers.getContractFactory("EquoFactory")).deploy(
    deployer.address, admin, poolManager, hookAddr, tokenDeployerAddr, weth, oracle, feeRecipient,
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("EquoFactory:", factoryAddr);

  const router = await (await ethers.getContractFactory("EquoRouter")).deploy(poolManager, factoryAddr, weth);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("EquoRouter:", routerAddr);

  // 4. Wiring (each one-time).
  await (await tokenDeployer.setFactory(factoryAddr)).wait();
  await (await hook.setFactory(factoryAddr)).wait();
  await (await factory.setConverter(routerAddr)).wait();
  console.log("wired: tokenDeployer.factory, hook.factory, factory.converter (+ hook.router)");

  // 5. Admin settings (only when the deployer is the admin; otherwise print them for the admin to send).
  const cb = Number(process.env.EQUO_CASHBACK_BPS ?? 0), rf = Number(process.env.EQUO_REFERRAL_BPS ?? 0);
  const presets = (process.env.EQUO_CAP_PRESETS ?? "").split(",").map((v) => v.trim()).filter(Boolean).map((v) => BigInt(v) * 10n ** 8n);
  // the deployer is still the factory owner here, so it can set the launch values before renouncing
  {
    if (cb || rf) { await (await factory.setRewardSplit(cb, rf)).wait(); console.log(`reward split: cashback ${cb} bps, referral ${rf} bps of the platform part`); }
    if (presets.length) { await (await factory.setCapPresets(presets)).wait(); console.log("cap presets:", presets.map((p) => `$${p / 10n ** 8n}`).join(", ")); }
  }

  if (process.env.RENOUNCE === "1") {
    await (await factory.renounceOwnership()).wait();
    console.log("factory setup rights renounced; admin keeps its own");
  }

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    model: "equo-v3: onehook-v2 + cashback, referral, cap presets, creator transfer, takeover (flags 0xCC)",
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    feeRecipient,
    contracts: { hookDeployer: c2Addr, hook: hookAddr, hookSalt: salt, tokenDeployer: tokenDeployerAddr, factory: factoryAddr, router: routerAddr, poolManager, weth, oracle },
  };
  if (dry) { console.log("dry run: nothing written"); return; }
  mkdirSync(join(__dirname, "../deployments"), { recursive: true });
  const file = join(__dirname, `../deployments/equo-${network.name}${dry ? "-dryrun" : ""}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", file);

  const spent = startBalance - (await ethers.provider.getBalance(deployer.address));
  console.log(`deployer spent ${ethers.formatEther(spent)} ETH on gas`);

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
